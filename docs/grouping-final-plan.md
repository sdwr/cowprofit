# Grouping — Final Implementation Plan

## 1. Data Model (localStorage)

Key: `cowprofit_session_groups`

```js
{
  "groups": {
    // Key = group ID (last/most-recent member key)
    // Value = ordered array of session keys, chronological (oldest first)
    "2026-02-14T10:30:00Z": [
      "2026-02-13T08:00:00Z",   // failure
      "2026-02-13T14:00:00Z",   // failure
      "2026-02-14T10:30:00Z"    // success
    ]
  },
  "seen": {
    // Key = session key, value = true
    // Sessions that have been processed by auto-grouping at least once.
    // Seen sessions are NEVER auto-grouped again — only manual handles can move them.
    "2026-02-13T14:00:00Z": true,
    "2026-02-14T10:30:00Z": true
  },
  "version": 2
}
```

No group-level flags. No manual vs auto distinction. Two fields: `groups` and `seen`.

---

## 2. When Auto-Grouping Runs (exhaustive)

1. **Import** — new sessions from userscript (new loot data)

That's it. **Nothing else triggers auto-grouping.**

**Never** on: render, filter toggle, card expand, manual group/ungroup, success/failure toggle, page reload.

Auto-grouping only touches **un-seen sessions** (sessions not in the `seen` map). After auto-grouping runs, ALL processed sessions (whether they joined a group or became standalone) are added to `seen`.

---

## 3. Auto-Grouping Algorithm

Only groups **un-seen** sessions (not in `seen`). Never merges existing groups. Never absorbs already-seen sessions.

```
function autoGroupNewSessions(sessions):
  state = load localStorage

  // 1. Clean stale groups (remove missing session keys, dissolve <2)
  for each group: filter to valid keys, drop if <2
  //   If a group dissolves, remaining member stays in seen (standalone, manual only)

  // 2. Collect all grouped keys
  groupedKeys = flatten all group member arrays

  // 3. Identify new (un-seen) sessions
  newSessions = sessions.filter(s => !seen[s.key])

  // 4. Try inserting new sessions into existing groups
  //    A new session can join ONE existing group if:
  //    - Same item
  //    - Adjacent to group edge chronologically (no other sessions of same item between)
  //    - If appending after last member: last member must NOT be success
  //    - If session is success: group must not already have a success
  //    Joining = insert at correct chronological position, re-key if needed
  //    NOTE: never merge two groups via this step

  // 5. Group remaining new sessions per item, chronologically
  for each item's remaining new sessions (sorted ascending by time):
    // Also consider existing group edges as neighbors
    currentRun = []
    for each session:
      currentRun.push(session)
      if isSuccess(session):
        if currentRun.length > 1 → store as group
        currentRun = []
    if currentRun.length > 1 → store as in-progress group

  // 6. Mark ALL new sessions as seen (grouped or standalone)
  for each session in newSessions:
    seen[session.key] = true

  // 7. Clean seen set (remove deleted session keys)
  save state
```

**Key behaviors:**
- No time gap threshold. Ancient sessions group together.
- New sessions group with whatever same-item neighbors are available (other new sessions, or edges of existing groups).
- Detached (ungrouped) sessions are in `seen`, so auto-grouping ignores them.
- A new session joins at most one existing group.
- Two existing groups never merge.

---

## 4. Ungroup — Edge-Only

**Constraint: can only detach from TOP or BOTTOM of a group. No middle-card splits.**

```
function ungroupSession(sessionKey):
  group = findGroupContaining(sessionKey)
  members = group.members
  idx = members.indexOf(sessionKey)

  // Must be first or last
  if idx !== 0 && idx !== members.length - 1:
    return  // disallow (UI should not show handle here)

  if members.length === 2:
    // Dissolve: both become standalone
    delete group
    // Both are already in seen — neither will be auto-grouped again
  else if idx === 0:
    members.splice(0, 1)  // remove bottom (oldest)
  else:
    members.splice(idx, 1)  // remove top (newest)
    re-key group to new last member

  // Session is already in seen — stays there. Manual handles only going forward.
  // NO auto-grouping triggered.
  save + re-render
```

If dissolving leaves 1 member, that remaining member is standalone AND already in `seen` — it won't be auto-grouped. Only manual handles can move it.

---

## 5. Manual Group via Handles

Handles allow connecting: standalone↔standalone, standalone↔group edge, group edge↔group edge.

```
function manualGroupSession(sessionKey, targetKey):
  sourceGroup = findGroupContaining(sessionKey)  // may be null
  targetGroup = findGroupContaining(targetKey)   // may be null

  if sourceGroup AND targetGroup:
    // Merge two groups: combine members, sort chronologically, re-key
    // Constraint checks already passed by handle visibility
    newMembers = [...sourceGroup.members, ...targetGroup.members]
      .sort(chronologically)
    delete both groups
    store as new group keyed by last member

  else if targetGroup:
    // Attach session to edge of target group
    insert sessionKey at correct chronological position
    re-key if needed

  else if sourceGroup:
    // Attach targetKey to edge of source group
    insert targetKey at correct chronological position
    re-key if needed

  else:
    // Both standalone → new 2-member group
    pair = [sessionKey, targetKey].sort(chronologically)
    store as group keyed by last member

  // Both sessions are already in seen. No auto-grouping triggered.
  save + re-render (no recompute)
```

---

## 6. Handle Visibility Rules

### Pre-built Item Map

At render time, build `itemSessionMap`:
```js
// Map<itemName, sortedArray<{key, renderIndex, isSuccess, groupId|null}>>
const itemSessionMap = buildItemSessionMap(filteredRenderItems);
```

For each item, sessions sorted by time. Use binary search for O(log n) neighbor lookup.

### Two Placement Styles

For a standalone card at render index `ri` with item `X`, find the nearest same-item neighbor in each direction using `itemSessionMap[X]`:

1. **Directly adjacent** (next card in render list is the same-item neighbor):
   - Floating handle BETWEEN the two cards: `Card_A [handle] Card_B`

2. **Non-adjacent** (other items' cards in between):
   - Handle ON the card itself (edge of card): `Card_A[handle] ... [handle]Card_C`

```
function getHandlePlacement(myRenderIndex, neighborRenderIndex):
  if Math.abs(myRenderIndex - neighborRenderIndex) === 1:
    return 'floating'  // between cards
  else:
    return 'on-card'   // on the card's edge
```

### When to Show

A handle appears if there exists a same-item matchable target in that direction AND constraints pass.

For **standalone cards**: check both directions.
For **group edge cards**: check outward direction only (top card checks up, bottom card checks down).
For **middle cards of groups**: NO handles (no ungroup handle either — edge-only constraint).

Edge cards of groups get an ungroup handle (to detach themselves) AND optionally a group-outward handle (to connect to adjacent same-item session/group).

---

## 7. Group Handles

A group's edge session can show a handle to connect to an adjacent same-item standalone or another group's edge.

**Top edge** (most recent member):
- If session is SUCCESS: handle only shown if target is chronologically BEFORE this session (can't add failure after success). Effectively: top of a success-capped group shows NO outward group handle (nothing valid can go above it chronologically since it's the most recent and a success).
- If session is FAILURE (in-progress group): handle shown if same-item target exists above (more recent).

**Bottom edge** (oldest member):
- Handle shown if same-item target exists below (older). No chronological constraint issue here — adding older failures is always valid.

**Constraint check before showing:**
- Same item
- No two successes in resulting group
- No failure chronologically after a success

---

## 8. Constraint Enforcement

### No two successes in one group
- **Auto-grouping:** run closes at first success. Impossible to produce two.
- **Manual grouping:** handle visibility checks `groupHasSuccess && sessionIsSuccess → hide handle`.
- **Success toggle:** Does NOT trigger auto-grouping. Only re-renders with updated handle visibility. If you toggle S4 to failure, sessions near it stay standalone — they must be manually grouped via handles.

### No failure after success (chronologically)
- A group's success must be the chronologically last member.
- Auto-grouping enforces this (success closes run).
- Manual grouping: if target group has a success, only allow attaching to the BOTTOM edge (adding older failures). The top edge handle of a success-capped group is hidden.

### Same item only
- All handle visibility checks filter by `itemName`.
- Auto-grouping groups per-item.

### Success toggle only on top card
- Only the most recent member (top of group) can have its success status toggled.
- UI hides the toggle for non-top-card group members.

---

## 9. Migration

```js
function migrateGroupState():
  state = load localStorage

  if state has manualUngroups and no version field:
    // Old schema → new schema
    // Mark ALL existing sessions as seen (they've been processed before)
    state.seen = {}
    for each session in allSessions:
      state.seen[session.key] = true
    // Also ensure all sessions in existing groups are seen
    for each group in state.groups:
      for each memberKey in group.members:
        state.seen[memberKey] = true
    delete state.manualUngroups
    state.groups = state.groups || {}  // keep existing groups
    state.version = 2
    save state
    return true

  // Add try/catch around JSON parse with fallback to {}
  return false
```

---

## 10. Render Flow

```
function renderLootHistoryPanel():
  sessions = loadSessions()
  state = getGroupState()  // just READ, no recompute

  // 1. Build render items — O(n)
  renderItems = []
  groupedKeys = new Set()

  for each (groupId, members) in state.groups:
    validMembers = members.filter(exists in sessions)
    if validMembers.length < 2: continue
    validMembers.forEach(k => groupedKeys.add(k))
    renderItems.push({ type: 'group', members: validMembers, groupId })

  for each session not in groupedKeys:
    renderItems.push({ type: 'standalone', key: session.key })

  sort renderItems by date (most recent first)
  // Groups sorted by their most recent member

  // 2. Build item→sessions map — O(n log n)
  itemSessionMap = {}
  for (let ri = 0; ri < renderItems.length; ri++):
    item = renderItems[ri]
    keys = item.type === 'group' ? [first, last] : [item.key]
    for each key: add { key, ri, isSuccess, groupId } to itemSessionMap[itemName]
  // Sort each item's array by time

  // 3. Compute handle visibility using itemSessionMap — O(n log n) total
  for each renderItem:
    if standalone: find nearest same-item neighbors via binary search
    if group: check edges only
    determine placement style (floating vs on-card) by comparing render indices

  // 4. Render — O(n)
  for each renderItem:
    if group:
      render collapsed group card
      top card: success toggle (if applicable) + ungroup handle + outward group handle
      bottom card: ungroup handle + outward group handle
      middle cards: NO handles
    if standalone:
      render card with group handles (if visible) at correct placement
```

**Total: O(n log n)** dominated by sorting. Render itself is O(n). Handle computation is O(n log n) via pre-built map + binary search.

---

## Implementation Phases

### Phase 1: Data Layer
- `getGroupState()` / `saveGroupState()` with try/catch, version field
- `migrateGroupState()` — convert `manualUngroups` → `seen`, mark all sessions seen
- `autoGroupNewSessions(sessions)` — only processes un-seen sessions
- Helpers: `findGroupContaining()`, `buildItemSessionMap()`

### Phase 2: Decouple Render
- Remove `autoGroupSessions()` from render path
- Render reads stored groups directly
- Wire `autoGroupNewSessions()` to import ONLY (not toggle, not reload, not ungroup)

### Phase 3: Ungroup (edge-only)
- New `ungroupSession()` — top/bottom only, no middle splits
- Session stays in `seen` after ungroup (manual-only going forward)
- Dissolved groups: both members stay in `seen`
- UI: ungroup handles only on edge cards

### Phase 4: Manual Group Handles
- `buildItemSessionMap()` in render
- Handle visibility with two placement styles
- `manualGroupSession()` — all four pairing combos
- Group edge handles
- Constraint enforcement in UI

### Phase 5: Polish
- Remove legacy `autoGroupSessions`, `regroupSession`, `manualUngroups`
- Handle tooltips
- Success toggle re-render only (no auto-grouping)
- Stale `seen` cleanup (remove keys for deleted sessions)
