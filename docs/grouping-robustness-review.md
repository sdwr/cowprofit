# Grouping Implementation Plan — Robustness Review

**Reviewed:** `docs/grouping-implementation-plan.md`
**Against:** `docs/grouping-design.md` + current `main.js`
**Date:** 2026-02-14

---

## Focus Area Results

### 1. Barrier Semantics — ✅ PASS (after self-correction)

The plan initially gets this wrong (skipping excluded sessions in the free list would group F1+F3), but then **catches and corrects itself** in section 5 ("Auto-grouping treats excluded sessions as barriers"). The revised algorithm explicitly checks `hasExcludedBetween()` before adding consecutive free sessions to a run.

**Un-excluding F2 later:** The plan says "Allow auto-group" removes from `excluded` and triggers `recomputeGroups()`. At that point F2 is no longer a barrier, so F1, F2, F3 would naturally group. ✅ Correct.

**Concern:** The `hasExcludedBetween()` helper iterates the entire `excludedSet` for each pair check. For large excluded sets this is O(E) per pair. Not a correctness issue but noted for performance (see #10).

### 2. Manual Group Persistence — ⚠️ PARTIAL PASS

The plan explicitly states: **"We don't distinguish manual vs auto groups."** This is a deliberate design choice with a clear trade-off.

**Scenario:** User manually groups A+B+C, ungroups B → [A] standalone, [C] standalone (both dissolved, neither excluded). On next import, `recomputeGroups` treats A and C as free sessions. If they're same-item chronological neighbors with no barrier, they **will be re-auto-grouped together** — skipping B (which is excluded/barrier). This creates [A, C] automatically, which is actually the correct grouping since B is excluded.

**But:** If A was manually grouped with B originally (not same-item or not chronological), auto-grouping wouldn't touch it. The concern only applies when manual groups happen to match what auto-grouping would produce.

**Verdict:** Acceptable. The unified model is simpler. Edge case where manual groups get re-absorbed is rare and the result is usually correct. But the plan should **document this explicitly** as a known behavior.

### 3. New Sessions Joining Flagged Groups — ✅ PASS

Plan section 3 explicitly addresses this: "The exclusion status of *existing* group members is irrelevant. Only the *new* session's exclusion status matters." A group is just a list of keys. If F2 was previously excluded then re-added to [F1, F2, S3], the group is now just [F1, F2, S3] — a normal group. New F1.5 arriving will check barriers between F1→F1.5 and F1.5→F2, find none (F2 isn't excluded anymore), and join.

### 4. Multiple Manual Ungroups in Same Group — ✅ PASS

**Group: [F1, F2, F3, F4, S5]**

**Step 1 — Ungroup F2:**
- F2 → excluded. Split: [F1] (dissolved, standalone) + [F3, F4, S5] (persists).
- State: F1 standalone (free), F2 standalone (excluded), [F3, F4, S5] group.

**Step 2 — Ungroup F4 from [F3, F4, S5]:**
- F4 → excluded. Split: [F3] (dissolved, standalone) + [S5] (dissolved, standalone).
- State: F1 free, F2 excluded, F3 free, F4 excluded, S5 free.

The split logic handles this correctly at each step. ✅

### 5. Auto-group Frequency — ⚠️ PARTIAL PASS

The plan lists 5 triggers: import, success/failure toggle, "allow auto-group", migration, session deletion.

**Missing trigger — page reload:** On page reload, the plan does NOT recompute (groups are persisted). This is correct behavior. ✅

**Success/failure toggle:** Listed as trigger. ✅

**Session deletion:** Listed as trigger. ✅

**Concern:** The plan says success override toggle triggers recompute, but doesn't specify the exact mechanism. Does toggling success on a grouped session first remove it from the group, then recompute? Or does recompute handle it? The pseudocode in section 5 of the design doc says "remove the session from its current group first, then recompute" but the implementation plan's `recomputeGroups` doesn't show this removal step — it only handles free sessions. A session still in a group after a toggle would be kept in its group by step 1 ("keep existing groups intact").

**Recommendation:** Add explicit logic: on success toggle, remove the toggled session from its group before calling `recomputeGroups`. Otherwise the session stays grouped with potentially invalid group composition (two successes).

### 6. Group with Two Successes — ⚠️ PARTIAL PASS

**Auto-grouping prevention:** The algorithm closes a run at the first success, so auto-grouping can't produce two successes. ✅

**Manual grouping prevention:** `getGroupHandles` checks "if myIsSuccess and the target group already has a success, skip." ✅

**But:** The success toggle scenario is not fully guarded. If a group is [F1, F2, S3] and user toggles F1 to success, the group now has two successes. The plan says toggle triggers recompute, but as noted in #5, the session might not get removed from the group first.

**Recommendation:** On success toggle, immediately remove the session from its group (same as ungroup but WITHOUT adding to excluded), then recompute.

### 7. Time Gaps — ❌ FAIL

The plan explicitly acknowledges this in edge case #8: "Two sessions for 'Iron Sword +10' three months apart will group if no barrier exists between them." It then says "Consider a time gap threshold... This is a future enhancement — start without it."

This is a real usability problem. A user who enhanced Iron Sword in January and again in March will see them auto-grouped as one giant failure streak. The plan punts on this.

**Recommendation:** Add a configurable time gap threshold (default 7 days). If consecutive same-item sessions are separated by more than this, treat as a natural barrier. This is simple to implement in the chronological run-building loop — just one extra `if` check.

### 8. Empty Groups / Single-Member Groups — ✅ PASS

The plan handles this well:
- `ungroupSession`: 2-member group → dissolve. Middle split produces sub-arrays; any with length < 2 are not stored.
- `recomputeGroups` step 3: `if (valid.length >= 2)` — filters out degenerate groups.
- New group creation: only `if (currentRun.length > 1)`.

No path produces a 0 or 1 member group that persists. ✅

### 9. localStorage Corruption/Migration — ⚠️ PARTIAL PASS

**Migration logic:** Simple — copy `manualUngroups` to `excluded`, clear `groups`, trigger recompute. If it fails halfway (e.g., browser crash after saving `excluded` but before clearing `manualUngroups`), the detection condition `state.manualUngroups && !state.excluded` would be false on next load (because `excluded` now exists), so migration wouldn't re-run. But `manualUngroups` would still be present — harmless, just dead data.

**Stale references:** `recomputeGroups` step 3 filters groups to valid session keys. Step 9 cleans excluded. ✅

**Total corruption (invalid JSON):** `getGroupState` presumably has a try/catch returning `{}`. Not shown in plan but standard practice. Should be verified.

**Recommendation:** Add explicit try/catch in `getGroupState` with fallback to empty state. Add a `version` field to the schema for future migrations.

### 10. Render Performance — ⚠️ PARTIAL PASS

The plan claims O(n) render. Let's verify:

- Building render items: O(groups × members + sessions) = O(n). ✅
- `getGroupHandles`: For each standalone item, scans the filtered list in both directions looking for a same-item match. Worst case: all sessions are standalone, all same item → O(n) scan per item → **O(n²) total**.

**Also:** `hasExcludedBetween` iterates the full excluded set per call. Called from handle computation and from recompute. In recompute, it's called for each pair of consecutive free sessions × excluded set size = O(F × E).

**Recommendation:** 
- Handle computation: cap the scan distance (e.g., only look ±20 items). Users won't manually group sessions that are 50 cards apart.
- `hasExcludedBetween`: convert excluded set to a sorted array and use binary search, or pre-bucket by item.

### 11. Concurrent Modifications (Multi-tab) — ❌ FAIL

The plan acknowledges this in edge case #14: "Not a real risk in single-threaded browser JS." This is wrong. Two tabs both doing read-modify-write on localStorage will race. Tab A reads state, Tab B reads state, Tab A writes, Tab B writes — Tab A's changes are lost.

**Real scenario:** User has cowprofit open in two tabs. Imports data in one, ungroups in another. State corruption.

**Recommendation:** Either:
1. Accept it (it's a niche tool, unlikely scenario) and document the limitation, OR
2. Use `storage` event listener to reload state when another tab modifies it, OR
3. Use a generation counter — read-check-write pattern.

Option 1 is probably fine. Just document it.

### 12. The "Regroup" Flow — ✅ PASS

The plan provides two mechanisms:
1. **"Allow auto-group"** on excluded cards: removes from `excluded`, triggers `recomputeGroups`. Session gets auto-grouped if it fits.
2. **Directional group handles** on excluded cards: removes from `excluded` AND immediately pairs with the specified target. No recompute needed.

Both are clearly specified. The design doc's "Final decision" section confirms: no generic "regroup" button, just handles + "allow auto-group." ✅

---

## Missing Edge Cases

### 13. Item name changes / override conflicts
If `calculateEnhanceSessionProfit` returns different item names for sessions over time (e.g., game data update changes HRID→name mapping), groups could contain sessions with mismatched items. Not addressed.

### 14. Group ID collision
Group ID = last member's session key. If two groups somehow end up with the same last member key (shouldn't happen, but defensive coding), one overwrites the other.

### 15. Sort stability in render
The plan sorts render items by date (most recent first). Groups are placed by their most recent member. If a group and a standalone have the same timestamp, ordering is undefined. Minor but could cause flickering handle visibility.

### 16. Undo
No undo for any operation. Ungrouping is destructive (adds to excluded, splits group). User's only recourse is "allow auto-group" which may not reconstruct the original group.

---

## Scenarios Producing Unexpected Behavior

1. **Success toggle without group removal (see #5/#6):** Toggle F1→success in [F1, F2, S3] creates two successes. If recompute doesn't remove F1 first, the group persists with invalid state.

2. **Time gap surprise (see #7):** Sessions months apart auto-group, showing misleading aggregate P&L.

3. **Manual group gets re-absorbed (see #2):** User carefully constructs a manual group, ungroups one member, remaining members get re-auto-grouped differently on next import.

4. **Handle scan finds distant match (#10):** Standalone failure shows a handle pointing to a same-item session 100 cards away. Clicking it creates a 2-member group spanning months. Related to #7.

---

## Concrete Recommendations

1. **Critical:** On success override toggle, remove session from its current group before recomputing. Prevents two-success groups.

2. **Important:** Add time gap threshold (7 days default) to auto-grouping. Prevents nonsensical long-range groups.

3. **Important:** Cap handle scan distance to ~20 render items. Prevents confusing long-distance manual grouping and fixes O(n²) performance.

4. **Minor:** Add `version` field to localStorage schema. Add try/catch to `getGroupState`.

5. **Minor:** Document multi-tab limitation (or add `storage` event listener).

6. **Minor:** Document that manual groups are not distinguished from auto groups — ungrouped members may be re-absorbed.

---

## Overall Assessment

**The plan needs one more iteration**, primarily for:
- The success toggle → two-success bug (correctness issue)
- Time gap handling (usability issue)
- Handle scan performance (O(n²) in render)

These are straightforward fixes. The core architecture (stored groups + exclusion set) is sound. The barrier semantics, split logic, and migration path are well thought out. The plan is ~90% ready to implement — address the three issues above and it's good to go.
