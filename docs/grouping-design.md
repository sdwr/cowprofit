# Session Grouping Design — CowProfit Enhancement Tracker

## Problem Statement

Enhancement sessions in MWI follow a pattern: multiple failures for the same item, eventually followed by a success. Users need to see true P&L across those related sessions grouped together.

The current implementation has two problems:
1. **Auto-grouping runs every render** — it recomputes groups from scratch each time `renderLootHistoryPanel()` is called, which is wasteful and makes it hard to reason about state.
2. **Two separate group concepts** — auto-groups are ephemeral (recomputed) while manual ungroups are persisted as barriers (`manualUngroups`). Adding manual grouping on top creates a third concept. Managing interactions between these three becomes a nightmare.

### What We Want
One unified system where:
- Groups are **computed once** when data changes, then **stored explicitly**
- Manual operations (group/ungroup) **mutate the stored groups directly**
- No re-derivation on every render — just read the stored groups and display them

---

## Approach: Stored Groups with Exclusion Set

### Core Idea

There is exactly **one** data structure: a stored list of groups, plus an exclusion set. Auto-grouping is a function that runs **only on data change** (import), producing groups. Manual operations edit the stored groups directly. The exclusion set prevents auto-grouping from re-absorbing manually removed sessions.

### Data Model (localStorage)

```js
// Key: 'cowprofit_session_groups'
{
  // The canonical group list. Each group is an ordered array of session keys (chronological).
  // Group ID = the last key in the array (most recent / success session).
  "groups": {
    "2026-02-14T10:30:00Z": [
      "2026-02-13T08:00:00Z",  // failure
      "2026-02-13T14:00:00Z",  // failure
      "2026-02-14T10:30:00Z"   // success (= group ID)
    ],
    "2026-02-14T06:00:00Z": [
      "2026-02-13T20:00:00Z",  // failure
      "2026-02-14T06:00:00Z"   // failure (in-progress, no success yet)
    ]
  },

  // Sessions that the user has manually detached.
  // These are NEVER auto-grouped. Only cleared by explicit user action ("regroup").
  "excluded": {
    "2026-02-13T14:00:00Z": true
  }
}
```

**That's it.** Two fields. No `manualUngroups` vs `autoGroups` vs `manualGroups` distinction.

### When Auto-Grouping Runs

Auto-grouping runs in exactly **two** situations:

1. **On import** — when new sessions arrive from the game userscript
2. **On override change** — when a user toggles success/failure status (because it changes groupability)

It does **NOT** run on every render. `renderLootHistoryPanel()` just reads `groups` from storage and displays them.

### Auto-Grouping Algorithm

```
function recomputeGroups(sessions):
    state = load from localStorage
    excluded = state.excluded || {}
    oldGroups = state.groups || {}

    // Collect all session keys that are currently in any group
    // (so we know what's "new" vs "already grouped")
    allGroupedKeys = flatten(values(oldGroups))

    // Identify NEW sessions (not in any existing group and not excluded)
    newKeys = sessions.filter(s => !allGroupedKeys.has(s.key) && !excluded[s.key])

    // For each new session, try to attach it to an existing group or form new groups
    // Strategy: sort all ungrouped+new sessions chronologically per item,
    // run the standard "accumulate failures, close at success" logic,
    // but ONLY for sessions that aren't already in a group.

    // Step 1: Keep all existing groups intact (don't re-derive them)
    newGroups = { ...oldGroups }

    // Step 2: Collect "free" sessions — new + any that lost their group
    freeSessions = sessions.filter(s =>
        !anyGroupContains(newGroups, s.key) && !excluded[s.key]
    )

    // Step 3: Run standard chronological grouping on free sessions only
    sorted = freeSessions.sortBy(startTime, ascending)
    byItem = groupBy(sorted, itemName)

    for each (itemName, itemSessions) in byItem:
        currentRun = []
        for each session in itemSessions:
            currentRun.push(session.key)
            if isSuccess(session):
                if currentRun.length > 1:
                    newGroups[session.key] = [...currentRun]
                currentRun = []
        // Leftover failures = in-progress group
        if currentRun.length > 1:
            newGroups[currentRun.last] = [...currentRun]

    // Step 4: Try to merge free sessions into edges of existing groups
    // (handled in Step 3 — if a free failure is chronologically adjacent
    //  to an existing group's edge, it gets picked up. But we might want
    //  to also check if a free session should prepend/append to an existing group.)

    // Actually — let's handle this more carefully. See "Joining Existing Groups" below.

    state.groups = newGroups
    save state
```

#### Joining Existing Groups (New Sessions Connecting to Existing Groups)

When a new failure session arrives that's chronologically between an existing group's last failure and the success, or before the first failure, it should join that group. Here's the refined approach:

```
// After Step 2, before Step 3:
// For each free session, check if it should join an existing group:

for each freeSession (sorted chronologically) in freeSessions:
    for each (groupId, members) in newGroups:
        if sameItem(freeSession, members[0]) AND
           freeSession fits chronologically into this group AND
           (freeSession is failure OR it's a success replacing an all-failure group's end):

            // Insert at correct chronological position
            insertIntoGroup(newGroups, groupId, freeSession.key)
            remove freeSession from freeSessions
            break
```

This handles Requirement 4 (new sessions auto-join connectable groups).

### Manual Ungroup

User clicks the ungroup handle on a card within a group.

```
function ungroupSession(sessionKey):
    state = load state
    group = findGroupContaining(sessionKey)

    if group has only 2 members:
        // Dissolve the group entirely
        delete state.groups[groupId]
    else if sessionKey is the first or last member:
        // Remove from edge — simple trim
        state.groups[groupId].remove(sessionKey)
        // If groupId was the removed key, re-key the group
        if sessionKey == groupId:
            newId = group.last  // new most-recent becomes ID
            state.groups[newId] = group.without(sessionKey)
            delete state.groups[groupId]
    else:
        // Middle card — SPLIT into two groups
        splitAt = group.indexOf(sessionKey)
        before = group.slice(0, splitAt)    // earlier failures
        after = group.slice(splitAt + 1)    // later sessions
        delete state.groups[groupId]
        if before.length > 1:
            state.groups[before.last] = before
        if after.length > 1:
            state.groups[after.last] = after

    // Mark as excluded so auto-grouping doesn't re-absorb
    state.excluded[sessionKey] = true
    save state
    re-render  // just reads stored groups, no recomputation
```

**Key insight:** Ungrouping adds to `excluded`. The session becomes standalone. Auto-grouping will never touch it again unless the user explicitly regroups.

### Manual Group

User clicks a directional group handle on a standalone card to connect it to an adjacent same-item session or group.

```
function groupSessionDirection(sessionKey, direction):
    // direction = 'up' (connect to card above) or 'down' (connect to card below)
    state = load state
    target = findAdjacentMatchableSession(sessionKey, direction)

    // Remove from excluded if it was there
    delete state.excluded[sessionKey]
    delete state.excluded[target.key]

    targetGroup = findGroupContaining(target.key)

    if targetGroup exists:
        // Attach sessionKey to edge of existing group
        if direction == 'up':
            // sessionKey is below, target is above — sessionKey is older
            targetGroup.insertAtCorrectChronologicalPosition(sessionKey)
        else:
            targetGroup.insertAtCorrectChronologicalPosition(sessionKey)
        // Re-key if needed
    else:
        // Both standalone — create new 2-member group
        pair = [sessionKey, target.key].sortChronologically()
        groupId = pair.last
        state.groups[groupId] = pair

    save state
    re-render
```

**Constraint enforcement during manual group:**
- Can't group if the target is a different item
- Can't group if it would create a group with two successes
- Both of these are checked before showing the handle

### How the Group Handle Knows What to Show

The group handle is the UI affordance for manual grouping. It appears on a card's top edge (connect upward in display = connect to more recent session) or bottom edge (connect downward = connect to older session).

**Display is sorted most-recent-first**, so:
- **Top handle (▲)** = "connect to the card above me" = connect to a more recent session
- **Bottom handle (▼)** = "connect to the card below me" = connect to an older session

#### When to show handles:

A handle appears on a standalone card in direction D if:

1. **There exists an adjacent render item** in that direction (up or down in the rendered list)
2. **That adjacent item is either:**
   - A standalone card for the same item, OR
   - A group whose edge session (top for ▼, bottom for ▲) is for the same item
3. **Grouping wouldn't violate constraints:**
   - No two successes in one group
   - Same item only

**"Adjacent" means the next rendered card in that direction**, not just any card anywhere. This keeps the UI simple — you can only connect to your immediate neighbor.

Wait — but what if there are 3 standalone failures for the same item with other items interleaved? The middle one can connect up or down, but the first and last might not be adjacent to each other.

**Decision:** Only show handles for **immediate visual neighbors**. This is simpler and avoids confusing long-distance grouping. If sessions aren't adjacent, the user can group step by step (group A+B, then the resulting group is adjacent to C, group that too).

Actually, let me reconsider. The render order is by date (most recent first). Same-item sessions that should be grouped are likely chronologically close, but other items' sessions might interleave. For the handle to be useful, we should check for the **nearest same-item standalone session** in that direction, not just immediate neighbor.

**Revised rule:** Show the handle if there exists a **same-item, standalone (or edge-of-group) session** in that direction within the rendered list, and grouping wouldn't violate constraints. The handle connects to the **nearest** such match.

But this creates a UX problem: clicking a handle would "jump" across intervening cards, which might confuse users.

**Final decision:** Show the handle when **the nearest same-item matchable session** exists in that direction. The connection is still one-click, one-pair. The handle tooltip shows what it'll connect to (e.g., "Group with Iron Sword +10 failure from Feb 13"). Interleaved other-item cards don't matter — the grouping is logical, not positional.

#### Handle appearance rules:

```
For each standalone card (sessionKey, itemName, isSuccess):

  // Check upward (toward more recent)
  showTopHandle = exists a session above (more recent) where:
    - same itemName
    - is standalone OR is the bottom edge of a group
    - if isSuccess, the target must not also be a success
    - if target is a group, the group must not already contain a success
                    (unless this session is a failure)

  // Check downward (toward older)
  showBottomHandle = exists a session below (older) where:
    - same itemName
    - is standalone OR is the top edge of a group
    - same success constraint as above
```

For cards **within a group**, only the top and bottom edge cards of the group get handles (to extend the group). Middle cards get ungroup handles instead.

### Edge Cases

#### 1. Ungrouping the middle card of a 3+ group

**Example:** Group = [F1, F2, F3, S4] (3 failures + success). User ungroups F2.

**Result:**
- F2 goes to `excluded`, becomes standalone
- Group splits: [F1] (standalone, too small for group) and [F3, S4] (new group)
- F1 is NOT added to excluded — it's just orphaned. It remains available for auto-grouping on next import, or the user can manually group it.

Actually, should F1 become excluded too? No — F1 didn't ask to be ungrouped. It was part of a group that split. It should remain "free" (eligible for auto-grouping). Only the explicitly ungrouped card (F2) gets excluded.

But wait — if auto-grouping doesn't run until next import, F1 will just sit there as standalone until then. That's fine. On next import/recompute, F1 could get grouped with other free sessions for the same item.

#### 2. Ungrouping the success from a failures+success group

**Example:** Group = [F1, F2, S3]. User ungroups S3.

**Result:**
- S3 → excluded, standalone
- [F1, F2] remains as an all-failures group (in-progress appearance)
- This is valid — represents sunk cost before eventual success

#### 3. Ungrouping a failure from a 2-member group

**Example:** Group = [F1, S2]. User ungroups F1.

**Result:**
- Group dissolves (can't have a 1-member group)
- F1 → excluded, standalone
- S2 → standalone (NOT excluded — available for future grouping)

#### 4. Regrouping a previously excluded session

User clicks "regroup" (or a group handle) on an excluded standalone card.

**Result:**
- Remove from `excluded`
- Either: run auto-grouping to see if it naturally groups, OR just manually pair it with the target
- If using a directional handle, pair it with the indicated target
- If using a generic "regroup" button, just remove from excluded and trigger a recompute

**Decision:** The "regroup" action should just **remove from excluded** and trigger `recomputeGroups()`. If the session naturally groups, great. If not (e.g., the chronological neighbors are now in other groups), it stays standalone but is available for auto-grouping on future imports.

Alternatively, we could skip the generic "regroup" button entirely and only allow directional group handles. This is cleaner — the user always specifies exactly what to connect to.

**Final decision:** No generic "regroup" button. Excluded sessions show group handles just like any other standalone card. Clicking a group handle removes from excluded AND creates the specified pairing. If the user just wants to un-exclude without pairing, we could have a small "×" on the excluded indicator, but this is a rare case.

Actually, let's keep a simple "allow auto-group" toggle on excluded cards. It removes from `excluded` and triggers recompute. Plus, excluded cards still show directional group handles for manual pairing.

#### 5. New sessions arriving that should join an existing group

**Example:** Existing group = [F1, S3]. New session F2 arrives (same item, chronologically between F1 and S3).

**During recomputeGroups:**
- F2 is a "free" session (not in any group, not excluded)
- Algorithm detects F2 fits chronologically inside the [F1, S3] group
- F2 is inserted: group becomes [F1, F2, S3]

**Implementation note:** To detect this, the recompute algorithm needs to check if a free session's timestamp falls within an existing group's time range AND is for the same item. This is the "join existing groups" logic described above.

#### 6. New session arriving that could connect two separate groups

**Example:** Group A = [F1, F2], Group B = [F4, S5]. New session F3 arrives (same item, between F2 and F4).

**Should F3 merge the two groups?** This is tricky. If we're conservative (Requirement 5 — manual groups stay separate), we should NOT auto-merge. F3 joins one group or becomes standalone.

**Rule:** A new free session joins at most one existing group. It joins the group whose time range it falls within or is adjacent to (within some tolerance). If it's between two groups, it joins neither — it becomes standalone and the user can manually connect.

Actually, for auto-groups this is fine to merge. The distinction in Requirement 5 is about not merging a *manual* group into an *auto* group. If both are auto-groups and a new session bridges them, merging is the correct behavior.

**But we don't track which groups are manual vs auto.** That's the whole point of the unified model.

**Resolution:** Since we don't distinguish manual vs auto groups, we need a different approach to Requirement 5. The answer is: **we don't auto-merge existing groups, period.** A new session can join ONE existing group or form a new group with other free sessions. It never causes two existing groups to merge. If the user wants to merge groups, they do it manually via handles.

This is a clean rule that satisfies both the spirit of Requirement 5 and avoids the manual/auto distinction.

#### 7. Deleted sessions

If a session is deleted (cleared from history), any group containing it should gracefully degrade:
- Remove the key from its group
- If group drops to 1 member, dissolve
- Clean up `excluded` entries for deleted sessions

This cleanup runs during `recomputeGroups()` or on render (cheap — just filter out missing keys).

#### 8. Success override toggling

User toggles a failure to success (or vice versa). This changes groupability.

**On toggle:** Trigger `recomputeGroups()`. The session might need to leave its current group (if it was a failure in a group that now has two successes) or could become a group-closer.

**Simpler approach:** On success toggle, just remove the session from its current group (if any) and recompute. The recompute will place it correctly.

### Render Flow

```
function renderLootHistoryPanel():
    sessions = loadSessions()
    groups = getGroupState().groups    // just READ, no recompute
    excluded = getGroupState().excluded

    // Build render items from stored groups
    renderItems = []
    groupedKeys = new Set()

    for (groupId, members) in groups:
        validMembers = members.filter(exists in sessions)
        if validMembers.length < 2: continue  // dissolved
        for key in validMembers: groupedKeys.add(key)
        renderItems.push({ type: 'group', members: validMembers, ... })

    for session in sessions:
        if session.key not in groupedKeys:
            renderItems.push({ type: 'standalone', key: session.key, ... })

    sort renderItems by date (most recent first)

    // Compute handle visibility
    for each standalone item:
        compute showTopHandle, showBottomHandle based on rules above

    // Render
    for each renderItem:
        if group: render group card with ungroup handles
        if standalone: render card with optional group handles
```

### Pros

1. **Single source of truth** — one `groups` object, one `excluded` set. No auto vs manual distinction.
2. **No recomputation on render** — groups are stable. Render just reads and displays.
3. **Clean manual operations** — ungroup = remove from group + add to excluded. Group = pair/attach + remove from excluded. Both directly mutate stored state.
4. **Predictable behavior** — user actions have immediate, obvious effects. No "why did auto-grouping undo my change?"
5. **Efficient** — auto-grouping only runs on import/override change. Render is O(groups + sessions), no sorting/grouping logic.

### Cons

1. **Stale groups possible** — if session data changes externally (e.g., clearing localStorage of sessions but not groups), groups reference missing sessions. Mitigated by filtering on render.
2. **Joining logic is complex** — determining where a new session fits in existing groups requires chronological comparison. Not hard, but more code than "recompute everything."
3. **No automatic merging** — two groups that "should" be one (based on chronology) won't merge without user action. This is a feature (predictability) but could feel like a limitation.
4. **Excluded set grows** — over time, `excluded` accumulates keys. Should periodically clean up keys for sessions that no longer exist.

### Migration from Current System

Current state has `manualUngroups` and recomputed `groups`. Migration:

1. Run current `autoGroupSessions()` one final time to get groups
2. Copy `manualUngroups` keys to `excluded`
3. Store the groups
4. Delete `manualUngroups`
5. Switch render to read-only mode

This is a one-time migration on first load after the code update.

---

## Alternative Considered: Pure Recompute with Overrides

For completeness, here's the approach we're moving away from and why.

### Idea

Keep auto-grouping on every render but add an override layer:
- `excluded`: sessions that can't be auto-grouped (same as current `manualUngroups`)
- `manualPairs`: explicit pairings that override auto-grouping
- Auto-grouping produces base groups, then manual pairs are overlaid

### Why It's Worse

1. **Two group sources** — auto-computed and manual. Merge logic is complex (what if a manual pair conflicts with an auto group?).
2. **Render cost** — recomputing every render scales poorly with session count.
3. **Unpredictable** — auto-grouping can produce different results as sessions are added, making manual overrides interact in unexpected ways.
4. **Harder to reason about** — "why is this session grouped?" requires understanding both auto logic and manual overrides.

This is essentially a more formalized version of what we have now, and it has the same fundamental problems.

---

## Implementation Plan

### Phase 1: Core Infrastructure
- New `recomputeGroups(sessions)` function (runs on import, not render)
- New localStorage schema: `{ groups: {}, excluded: {} }`
- Migration from old schema on first load
- Render reads stored groups (no computation)

### Phase 2: Manual Ungroup
- Click ungroup handle → remove from group, add to excluded, save, re-render
- Handle splitting (middle card) and dissolution (2-member group)

### Phase 3: Manual Group Handles
- Compute handle visibility in render (based on adjacent matchable sessions)
- Click handle → pair/attach sessions, remove from excluded, save, re-render
- Enforce constraints (same item, no double success)

### Phase 4: Polish
- "Allow auto-group" indicator on excluded cards
- Cleanup stale excluded/group entries
- Group summary P&L
- Animation for group/ungroup transitions

---

## Summary

The stored-groups approach replaces the current "recompute every render + barrier flags" system with a clean model:

| Aspect | Current | Proposed |
|--------|---------|----------|
| Groups computed | Every render | On import only |
| Groups stored | Ephemeral (recomputed) | Persistent |
| Manual ungroup | Barrier flag (`manualUngroups`) | Remove from group + add to `excluded` |
| Manual group | Not implemented | Direct mutation of stored groups |
| Data structures | `groups` (computed) + `manualUngroups` (stored) | `groups` (stored) + `excluded` (stored) |
| Render complexity | O(n log n) sort + group logic | O(n) read + display |
| Predictability | Auto-grouping can surprise | User actions are final until explicitly changed |
