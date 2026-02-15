# Grouping Implementation Plan

## Architecture Decision: Stored Groups + Exclusion Set

**Verdict: The design doc's approach is correct.** Stored groups with an exclusion set is the right architecture.

### Why the current system is broken

The current system recomputes groups from scratch every render via `autoGroupSessions()` called inside `renderLootHistoryPanel()`. Manual ungroups are stored as `manualUngroups` barriers. This creates problems:

1. **Wasted work** — full sort + group-by-item + iterate on every render (card expand, filter toggle, etc.)
2. **Fragile barrier model** — `manualUngroups` acts as a "wall" in chronological order. An ungrouped session blocks grouping of sessions around it, but there's no way to manually *create* groups, only destroy them.
3. **No stable group identity** — groups are ephemeral. Adding a session override or importing new data silently reshuffles all groups.

### Why stored groups + exclusion is better

- **Single source of truth**: `groups` (stored) + `excluded` (stored). No ephemeral/persistent split.
- **Render is a read**: O(n) scan, no sorting/grouping logic.
- **Manual operations are direct mutations**: ungroup = edit stored groups + mark excluded. Group = edit stored groups + unmark excluded.
- **Predictable**: user sees exactly what they set. No auto-reshuffling surprises.

---

## Exact Behavior for Each Scenario

### 1. Auto-group vs manual grouping

**Auto-group runs only on:**
- Data import (new sessions from userscript)
- Success/failure override toggle (changes groupability)
- "Allow auto-group" clicked on an excluded session (removes from excluded, triggers recompute)
- Migration (one-time on first load)

**Auto-group does NOT run on:**
- Render (filter toggle, card expand, panel open)
- Manual group/ungroup actions (these mutate stored state directly)

**Manual grouping** = user clicks a directional handle on a standalone card. This directly mutates the stored `groups` object. No recompute needed.

### 2. Excluded sessions skip auto-group but are manually groupable

When `recomputeGroups` runs, any session key in `excluded` is skipped entirely — treated as if it doesn't exist. It won't be added to any group.

However, excluded sessions still show directional group handles in the UI. Clicking a handle:
1. Removes the session from `excluded`
2. Adds it to the target group (or creates a new 2-member group)
3. Saves and re-renders (no recompute)

### 3. New sessions join groups that contain previously-excluded-then-regrouped members

Groups are keyed by member lists, not by exclusion status. If group [F1, F2, S3] exists and F2 was previously excluded but manually re-added, the group is just [F1, F2, S3]. When new session F1.5 arrives (same item, between F1 and F2 chronologically), `recomputeGroups` checks if F1.5 fits inside this group's time range. It does → F1.5 is inserted → group becomes [F1, F1.5, F2, S3].

The exclusion status of *existing* group members is irrelevant. Only the *new* session's exclusion status matters (is F1.5 in `excluded`? no → eligible to join).

### 4. Ungrouping middle session doesn't dissolve remaining manual pairs

**Example:** Group = [A, B, C]. User ungroups B.

**Result:**
- B → `excluded`, standalone
- Group splits: [A] (too small, dissolved → A is standalone, NOT excluded) and [C] (too small, dissolved → C is standalone, NOT excluded)

**But wait** — the user's concern is about *manually created* groups. Example: User manually groups A+B+C. Then ungroups B. Should [A, C] persist?

**No.** Splitting at B creates [A] and [C], both size 1, both dissolved. This is correct behavior — A and C aren't chronologically adjacent anymore (B was between them). The user can re-group A↔C manually if desired.

**However**, if the group is [A, B, C, D] and user ungroups B: split → [A] (dissolved) and [C, D] (persists as group). This is correct — C and D are still connected.

**Key rule: We don't distinguish manual vs auto groups.** A group is a group. Ungrouping always follows the same split logic regardless of how the group was created.

### 5. Auto-grouping treats excluded sessions as barriers

When `recomputeGroups` processes free sessions for an item chronologically, excluded sessions are **skipped entirely**. They're not in the free session list, so they can't be part of any run.

**Example:** Sessions chronologically: F1, F2(excluded), F3, S4.
- Free sessions: F1, F3, S4
- F1 starts a run. F3 continues it. S4 closes it → group [F1, F3, S4]

**Wait — should F2 act as a barrier?** The design doc says yes: "don't group F1 with F3 by skipping excluded F2."

**Resolution:** Excluded sessions act as **barriers in chronological order**. Even though F2 isn't in the free list, we must check for excluded sessions between consecutive free sessions.

**Revised algorithm:** When building runs from free sessions, before adding the next session to the current run, check if any excluded session for the same item exists chronologically between the current run's last member and this session. If so, close the current run and start a new one.

So: F1 starts run. Before adding F3, check: is there an excluded same-item session between F1 and F3? Yes (F2). Close run [F1] (too small, no group). Start new run with F3. S4 closes it → group [F3, S4].

### 6. Auto-group frequency

Exhaustive list of triggers:
1. **`importSessions()`** — new data from userscript
2. **Success/failure toggle** — `forceSuccess` override changed
3. **"Allow auto-group" on excluded card** — removes from excluded, triggers recompute
4. **Migration** — one-time on first load after code update
5. **Session deletion** — if a session is removed, recompute to clean up

That's it. Never on render, filter, expand, or manual group/ungroup.

---

## Data Model (localStorage)

### New schema: `cowprofit_session_groups`

```js
{
  "groups": {
    // Key = group ID (last/most-recent member key)
    // Value = array of session keys, chronological (oldest first)
    "2026-02-14T10:30:00Z": [
      "2026-02-13T08:00:00Z",
      "2026-02-13T14:00:00Z",
      "2026-02-14T10:30:00Z"
    ]
  },
  "excluded": {
    // Key = session key, value = true
    "2026-02-13T14:00:00Z": true
  }
}
```

### Old schema (to migrate from)

```js
{
  "groups": { /* ephemeral, recomputed */ },
  "manualUngroups": { "sessionKey": true }
}
```

---

## Function Signatures and Pseudocode

### `recomputeGroups(sessions)`

Called on import, override toggle, allow-auto-group, migration.

```js
function recomputeGroups(sessions) {
  const state = getGroupState();
  const excluded = state.excluded || {};
  const oldGroups = state.groups || {};

  // 1. Collect all keys currently in any group
  const allGroupedKeys = new Set();
  for (const members of Object.values(oldGroups)) {
    for (const k of members) allGroupedKeys.add(k);
  }

  // 2. Valid session keys (exist in current data)
  const validSessionKeys = new Set(sessions.map(s => s.startTime));

  // 3. Clean up stale groups (remove missing session keys)
  const cleanedGroups = {};
  for (const [gid, members] of Object.entries(oldGroups)) {
    const valid = members.filter(k => validSessionKeys.has(k));
    if (valid.length >= 2) {
      const newId = valid[valid.length - 1];
      cleanedGroups[newId] = valid;
    }
  }

  // 4. Rebuild allGroupedKeys from cleaned groups
  const groupedKeys = new Set();
  for (const members of Object.values(cleanedGroups)) {
    for (const k of members) groupedKeys.add(k);
  }

  // 5. Identify free sessions (not grouped, not excluded)
  const freeSessions = sessions.filter(s =>
    !groupedKeys.has(s.startTime) && !excluded[s.startTime]
  );

  // 6. Build excluded keys set per item (for barrier checking)
  const excludedByItem = {};
  for (const s of sessions) {
    if (excluded[s.startTime]) {
      const itemName = getItemName(s);
      if (!excludedByItem[itemName]) excludedByItem[itemName] = new Set();
      excludedByItem[itemName].add(s.startTime);
    }
  }

  // 7. Try to insert free sessions into existing groups
  const remainingFree = [];
  for (const s of freeSessions) {
    const itemName = getItemName(s);
    const ts = new Date(s.startTime).getTime();
    let inserted = false;

    for (const [gid, members] of Object.entries(cleanedGroups)) {
      if (getItemName(sessionByKey[members[0]]) !== itemName) continue;

      const firstTs = new Date(members[0]).getTime();
      const lastTs = new Date(members[members.length - 1]).getTime();

      // Check if session fits within or adjacent to this group's time range
      // "Adjacent" = no excluded barrier between session and group edge
      if (ts >= firstTs && ts <= lastTs) {
        // Fits inside — check no excluded barrier between nearest members
        // Find insertion point
        let insertIdx = members.findIndex(k => new Date(k).getTime() > ts);
        if (insertIdx === -1) insertIdx = members.length;

        const prevKey = members[insertIdx - 1];
        const nextKey = members[insertIdx];

        // Check barriers between prev and session, and session and next
        if (!hasExcludedBetween(excludedByItem[itemName], prevKey, s.startTime) &&
            (!nextKey || !hasExcludedBetween(excludedByItem[itemName], s.startTime, nextKey))) {
          members.splice(insertIdx, 0, s.startTime);
          inserted = true;
          break;
        }
      }
      // Adjacent before first member
      else if (ts < firstTs && !hasExcludedBetween(excludedByItem[itemName], s.startTime, members[0])) {
        members.unshift(s.startTime);
        inserted = true;
        break;
      }
      // Adjacent after last member — only if group is in-progress (no success at end)
      else if (ts > lastTs && !isSuccess(sessionByKey[members[members.length - 1]]) &&
               !hasExcludedBetween(excludedByItem[itemName], members[members.length - 1], s.startTime)) {
        members.push(s.startTime);
        // Re-key the group
        delete cleanedGroups[gid];
        cleanedGroups[s.startTime] = members;
        inserted = true;
        break;
      }
    }

    if (!inserted) remainingFree.push(s);
  }

  // 8. Group remaining free sessions using standard chronological algorithm
  const sorted = remainingFree.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const byItem = groupBy(sorted, getItemName);

  for (const [itemName, itemSessions] of Object.entries(byItem)) {
    const barriers = excludedByItem[itemName] || new Set();
    let currentRun = [];

    for (const s of itemSessions) {
      // Check barrier between last run member and this session
      if (currentRun.length > 0 && hasExcludedBetween(barriers, currentRun[currentRun.length - 1], s.startTime)) {
        // Barrier found — close current run
        if (currentRun.length > 1) {
          cleanedGroups[currentRun[currentRun.length - 1]] = [...currentRun];
        }
        currentRun = [];
      }

      currentRun.push(s.startTime);

      if (isSuccess(s)) {
        if (currentRun.length > 1) {
          cleanedGroups[s.startTime] = [...currentRun];
        }
        currentRun = [];
      }
    }
    // Leftover failures
    if (currentRun.length > 1) {
      cleanedGroups[currentRun[currentRun.length - 1]] = [...currentRun];
    }
  }

  // 9. Clean up excluded set (remove keys for deleted sessions)
  const cleanedExcluded = {};
  for (const k of Object.keys(excluded)) {
    if (validSessionKeys.has(k)) cleanedExcluded[k] = true;
  }

  // 10. Save
  state.groups = cleanedGroups;
  state.excluded = cleanedExcluded;
  saveGroupState(state);
  return cleanedGroups;
}
```

**Helper: `hasExcludedBetween(excludedSet, keyA, keyB)`**
```js
function hasExcludedBetween(excludedSet, keyA, keyB) {
  if (!excludedSet || excludedSet.size === 0) return false;
  const tsA = new Date(keyA).getTime();
  const tsB = new Date(keyB).getTime();
  const [lo, hi] = tsA < tsB ? [tsA, tsB] : [tsB, tsA];
  for (const k of excludedSet) {
    const ts = new Date(k).getTime();
    if (ts > lo && ts < hi) return true;
  }
  return false;
}
```

### `ungroupSession(sessionKey)`

```js
function ungroupSession(sessionKey, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const state = getGroupState();

  // Find group containing this session
  let foundGroupId = null;
  for (const [gid, members] of Object.entries(state.groups)) {
    if (members.includes(sessionKey)) { foundGroupId = gid; break; }
  }
  if (!foundGroupId) return;

  const members = state.groups[foundGroupId];
  const idx = members.indexOf(sessionKey);

  if (members.length === 2) {
    // Dissolve group
    delete state.groups[foundGroupId];
  } else if (idx === 0) {
    // Remove from start
    members.splice(0, 1);
    // Group ID unchanged (it's the last member)
  } else if (idx === members.length - 1) {
    // Remove from end — need to re-key
    members.splice(idx, 1);
    const newId = members[members.length - 1];
    delete state.groups[foundGroupId];
    state.groups[newId] = members;
  } else {
    // Middle — split
    const before = members.slice(0, idx);
    const after = members.slice(idx + 1);
    delete state.groups[foundGroupId];
    if (before.length >= 2) state.groups[before[before.length - 1]] = before;
    if (after.length >= 2) state.groups[after[after.length - 1]] = after;
  }

  // Mark excluded
  if (!state.excluded) state.excluded = {};
  state.excluded[sessionKey] = true;

  saveGroupState(state);
  renderLootHistoryPanel();
}
```

### `manualGroupSession(sessionKey, targetKey)`

```js
function manualGroupSession(sessionKey, targetKey) {
  const state = getGroupState();

  // Remove both from excluded
  delete state.excluded?.[sessionKey];
  delete state.excluded?.[targetKey];

  // Find if either is in a group
  const sourceGroup = findGroupContaining(state.groups, sessionKey);
  const targetGroup = findGroupContaining(state.groups, targetKey);

  if (targetGroup) {
    // Insert sessionKey into target group at correct chronological position
    const members = state.groups[targetGroup];
    const ts = new Date(sessionKey).getTime();
    let insertIdx = members.findIndex(k => new Date(k).getTime() > ts);
    if (insertIdx === -1) insertIdx = members.length;
    members.splice(insertIdx, 0, sessionKey);

    // Re-key if sessionKey is now the last (most recent)
    if (insertIdx === members.length - 1) {
      delete state.groups[targetGroup];
      state.groups[sessionKey] = members;
    }
  } else if (sourceGroup) {
    // Insert targetKey into source group
    const members = state.groups[sourceGroup];
    const ts = new Date(targetKey).getTime();
    let insertIdx = members.findIndex(k => new Date(k).getTime() > ts);
    if (insertIdx === -1) insertIdx = members.length;
    members.splice(insertIdx, 0, targetKey);

    if (insertIdx === members.length - 1) {
      delete state.groups[sourceGroup];
      state.groups[targetKey] = members;
    }
  } else {
    // Both standalone — create new group
    const pair = [sessionKey, targetKey].sort((a, b) => new Date(a) - new Date(b));
    state.groups[pair[pair.length - 1]] = pair;
  }

  saveGroupState(state);
  renderLootHistoryPanel();
}
```

### `renderGroupHandles(filteredItems, displayData, state)`

Within `renderLootHistoryPanel`, after building the filtered render items list:

```js
function getGroupHandles(ri, filteredItems, displayData, groups, excluded) {
  const item = filteredItems[ri];
  if (item.type !== 'standalone') return { top: null, bottom: null };

  const myKey = item.sessionKey;
  const myItem = getItemName(myKey);
  const myIsSuccess = displayData[myKey].isSuccess;

  function findMatchInDirection(startIdx, step) {
    for (let i = startIdx; i >= 0 && i < filteredItems.length; i += step) {
      const other = filteredItems[i];
      let otherItem, otherKey, otherGroup;

      if (other.type === 'standalone') {
        otherKey = other.sessionKey;
        otherItem = getItemName(otherKey);
        if (otherItem === myItem) {
          // Check constraint: no two successes
          if (myIsSuccess && displayData[otherKey].isSuccess) continue;
          return { targetKey: otherKey };
        }
      } else if (other.type === 'group') {
        // Check edge session of group
        // step < 0 means looking up (more recent) → check group's last member (bottom edge visually)
        // step > 0 means looking down (older) → check group's first member (top edge visually)
        const edgeKey = step < 0
          ? other.memberKeys[0]  // oldest member = bottom of group visually (rendered newest-first within group)
          : other.memberKeys[other.memberKeys.length - 1]; // newest = top
        // Actually: display is newest-first. Groups render top=success, sub=failures newest-first.
        // "Up" in display = more recent. Group's top edge = most recent member.
        // Looking up (step=-1) → we'd hit the bottom of the group above → that group's oldest member
        // Looking down (step=+1) → we'd hit the top of the group below → that group's newest member
        const groupItemName = getItemName(edgeKey);
        if (groupItemName === myItem) {
          // Check constraint: can't add success to group that already has success
          const groupHasSuccess = other.memberKeys.some(k => displayData[k]?.isSuccess);
          if (myIsSuccess && groupHasSuccess) continue;
          return { targetKey: edgeKey, targetGroupId: other.groupId };
        }
      }
      // If we hit a different-item entry, keep searching (handles are for nearest same-item match)
    }
    return null;
  }

  // Up = toward index 0 (more recent in display)
  const topMatch = findMatchInDirection(ri - 1, -1);
  // Down = toward end (older in display)
  const bottomMatch = findMatchInDirection(ri + 1, 1);

  return { top: topMatch, bottom: bottomMatch };
}
```

For group edge cards (extending a group), similar logic applies but only for the first/last member of the group.

---

## Migration Steps

### One-time migration on first load after code update

```js
function migrateGroupState() {
  const state = getGroupState();

  // Detect old schema: has manualUngroups, no excluded
  if (state.manualUngroups && !state.excluded) {
    // 1. Copy manualUngroups → excluded
    state.excluded = { ...state.manualUngroups };

    // 2. Delete manualUngroups
    delete state.manualUngroups;

    // 3. Clear ephemeral groups (will be recomputed)
    state.groups = {};

    // 4. Save migrated state
    saveGroupState(state);

    // 5. Trigger full recompute
    // (caller should call recomputeGroups after migration)
    return true; // signal that recompute is needed
  }
  return false;
}
```

Call `migrateGroupState()` at app init, before first render. If it returns true, run `recomputeGroups(sessions)`.

---

## Edge Case Handling

### From the design doc

1. **Ungrouping middle of 3+ group** → Split into before/after. Pieces < 2 members dissolve. Only the explicitly ungrouped session is excluded.

2. **Ungrouping success from failures+success** → Success excluded + standalone. Failures remain as in-progress group.

3. **Ungrouping from 2-member group** → Both become standalone. Only the clicked session is excluded.

4. **New session fits inside existing group** → Inserted at correct chronological position (if no excluded barrier in the way).

5. **New session bridges two groups** → Joins at most ONE group (or neither). Never auto-merges two existing groups.

6. **Deleted sessions** → Cleaned up during recompute. Missing keys filtered out of groups. Groups < 2 members dissolved.

7. **Success override toggle** → Triggers recompute. Session removed from current group first, then recompute places it correctly.

### Additional edge cases

8. **Same item, months apart** → Auto-grouping is purely chronological within an item. Two sessions for "Iron Sword +10" three months apart will group if no barrier exists between them. This could be wrong (user likely did multiple independent enhance attempts). **Mitigation:** Consider a time gap threshold (e.g., 7 days). If consecutive same-item sessions are > 7 days apart, treat as a natural barrier. This is a future enhancement — start without it and see if it's needed.

9. **Session fits between two groups but excluded barriers on both sides** → Session stays standalone. Correct behavior.

10. **Re-importing same sessions** → Sessions already in groups are skipped (not "free"). No change to existing groups. Idempotent.

11. **Group with success in middle** → Shouldn't happen via auto-group (success closes the run). Could happen via manual grouping. Constraint: `manualGroupSession` should prevent adding to a group if it would create a success that isn't the last member. Actually — just prevent two successes per group. A success in the middle is weird but not catastrophic.

12. **Multiple items interleaved chronologically** → Grouping is per-item. Items never cross-contaminate.

13. **All filters off then back on** → Group/ungroup handles only show when all filters are on (existing behavior, keep it). Stored groups unchanged by filter state.

14. **Concurrent recomputes** → Not a real risk in single-threaded browser JS, but save should be atomic (read-modify-write pattern already used).

---

## Implementation Order

### Phase 1: Data layer (no UI changes yet)
1. Add `migrateGroupState()` function
2. Implement `recomputeGroups(sessions)` with:
   - Existing group preservation
   - Free session insertion into existing groups
   - Barrier-aware chronological grouping of remaining free sessions
   - Stale cleanup
3. Helper: `hasExcludedBetween()`
4. Helper: `findGroupContaining()`
5. **Test:** Import data, verify groups match current behavior. Migration works correctly.

### Phase 2: Decouple render from grouping
1. Remove `autoGroupSessions()` call from `renderLootHistoryPanel()`
2. `renderLootHistoryPanel()` reads `state.groups` directly
3. Call `recomputeGroups()` only from import and override toggle paths
4. **Test:** Groups persist across re-renders. Filter toggles don't recompute.

### Phase 3: Updated ungroup
1. Replace `ungroupSession()` with new version (split logic, excluded marking)
2. Remove `regroupSession()` (replaced by manual group handles in Phase 4)
3. Remove `manualUngroups` references from render
4. **Test:** Ungroup works for edge, middle, 2-member cases. Excluded sessions don't auto-regroup on import.

### Phase 4: Manual group handles
1. Implement `getGroupHandles()` — directional handle visibility
2. Implement `manualGroupSession(sessionKey, targetKey)` 
3. Update render to show directional handles (▲/▼) on standalone cards
4. Add "allow auto-group" indicator on excluded cards
5. Extend handles to group edge cards (extending existing groups)
6. **Test:** Can manually group two standalones. Can attach to existing group. Excluded cards show handles + allow-auto-group.

### Phase 5: Polish
1. Clean up old `autoGroupSessions()` function (remove entirely)
2. Clean up old `regroupSession()` function
3. Tooltip on handles ("Group with Iron Sword +10 failure from Feb 13")
4. Handle edge case: success override toggle removes from group + recomputes
5. Periodic excluded cleanup (remove keys for deleted sessions)
