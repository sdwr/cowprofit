# Protection Estimation — Robust Test Results

**Date:** 2025-02-14  
**Function:** `calculateProtectionFromDrops(levelDrops, protLevel, startLevel, finalLevel)`  
**Result:** **20 PASS, 1 FAIL** (intentional bug-finder) out of 21 tests

---

## Summary

| # | Test Name | Expected | Got | Result |
|---|-----------|----------|-----|--------|
| 1 | start=0, final=0 — simple fail, both below prot | 0 | 0 | ✅ PASS |
| 2 | start=0, final=maxLevel — success with one prot failure | 1 | 1 | ✅ PASS |
| 3 | start above prot, final=0 — cascading fail from above prot | 3 | 3 | ✅ PASS |
| 4 | start above prot, final=0 — missing lower drops (negative attempts[0]) | 3 | 3 | ✅ PASS |
| 5 | start above prot, final=maxLevel — success from above prot | 1 | 1 | ✅ PASS |
| 6 | start AT prot, final=0 — fail from prot boundary | 2 | 2 | ✅ PASS |
| 7 | start AT prot, final=maxLevel — success from prot boundary | 1 | 1 | ✅ PASS |
| 8 | start=0, final AT prot — end exactly at prot boundary | 0 | 0 | ✅ PASS |
| 9 | start below prot, final above prot (mid-level end) | 1 | 1 | ✅ PASS |
| 10 | both start and final above prot | 1 | 1 | ✅ PASS |
| 11 | start=final — no net progress (round-trip) | 1 | 1 | ✅ PASS |
| 12 | single-level cycling — repeated fail at same level | 3 | 3 | ✅ PASS |
| 13 | protLevel=0 — all failures protected | 1 | 1 | ✅ PASS |
| 14 | protLevel > maxLevel — no protections possible | 0 | 0 | ✅ PASS |
| 15 | Chain session 1/3 — fail from +5 back to 0 | 3 | 3 | ✅ PASS |
| 16 | Chain session 2/3 — fail from +4 back to 0 | 2 | 2 | ✅ PASS |
| 17 | Chain session 3/3 — success to +8 with one prot fail | 1 | 1 | ✅ PASS |
| 18 | **BUG FINDER: startLevel > maxLevel from drops** | **3** | **1** | ❌ FAIL |
| 19 | Empty drops — no enhancement activity | 0 | 0 | ✅ PASS |
| 20 | Multiple failures at same protected level | 2 | 2 | ✅ PASS |
| 21 | All failures just below prot boundary | 0 | 0 | ✅ PASS |

**Chain total (tests 15-17):** Expected 6, Got 6 ✅

---

## Detailed Test Reasoning

### Test 1: start=0, final=0 — simple fail, both below prot
- **Input:** drops={0:1, 1:1, 2:1}, prot=3, start=0, final=0
- **Scenario:** Item starts at 0, enhances to 1→2, fails at 2→0 (below prot, no protection), ends at 0.
- **Expected prots:** 0 (all activity below protLevel=3)
- **Algorithm trace:** failures[2]=1 (correct), but 2 < prot=3, so not counted.
- **Result:** ✅ PASS (got 0)

### Test 2: start=0, final=maxLevel — success with one prot failure
- **Input:** drops={0:1, 1:2, 2:3, 3:2, 4:1, 5:1}, prot=3, start=0, final=5
- **Scenario:** 0→1→2→fail(2→0)→0→1→2→3→fail(3→2, **PROT**)→2→3→4→5
- **Expected prots:** 1 (one failure at level 3, which is ≥ protLevel)
- **Algorithm trace:** Cascade correctly identifies failures[3]=1, failures[2]=1. Only failures[3] counts.
- **Result:** ✅ PASS (got 1)

### Test 3: start above prot, final=0 — cascading fail from above prot
- **Input:** drops={0:1, 2:1, 3:1, 4:1, 5:1}, prot=3, start=4, final=0
- **Scenario:** Start at 4→5(s)→fail(5→4, **P**)→fail(4→3, **P**)→fail(3→2, **P**)→fail(2→0)→end at 0
- **Expected prots:** 3 (failures at levels 5, 4, 3 — all ≥ prot=3)
- **Key detail:** attempts[0] = drops[0] - 1(final) = 1 - 1 = 0 (no negative)
- **Result:** ✅ PASS (got 3)

### Test 4: start above prot, final=0 — missing lower drops (negative attempts)
- **Input:** drops={3:1, 4:1, 5:1}, prot=3, start=4, final=0
- **Scenario:** Same as test 3 but drops at levels 0 and 2 are missing (data gap).
- **Key detail:** attempts[0] = 0 - 1(final) = **-1** (NEGATIVE!). Algorithm clamps failures[0]=max(0, -1-0)=0 so no crash.
- **Expected prots:** 3 (same failures at 5,4,3)
- **Note:** Despite the negative attempts[0], the cascade still correctly counts the 3 prot failures because they're computed top-down from maxLevel. The missing lower-level data doesn't affect the upper cascade.
- **Result:** ✅ PASS (got 3)

### Test 5: start above prot, final=maxLevel — success from above prot
- **Input:** drops={5:2, 6:2, 7:1, 8:1}, prot=3, start=4, final=8
- **Scenario:** Start at 4→5→6→fail(6→5, **P**)→5→6→7→8
- **Expected prots:** 1 (one failure at level 6)
- **Result:** ✅ PASS (got 1)

### Test 6: start AT prot, final=0 — fail from prot boundary
- **Input:** drops={0:1, 2:1, 3:1, 4:1}, prot=3, start=3, final=0
- **Scenario:** Start at 3 (=protLevel)→4(s)→fail(4→3, **P**)→fail(3→2, **P**)→fail(2→0)→end at 0
- **Expected prots:** 2 (failures at 4 and 3, both ≥ prot=3)
- **Result:** ✅ PASS (got 2)

### Test 7: start AT prot, final=maxLevel — success from prot boundary
- **Input:** drops={3:1, 4:2, 5:1}, prot=3, start=3, final=5
- **Scenario:** Start at 3→4(s)→fail(4→3, **P**)→3→4(s)→5(s)→end at 5
- **Expected prots:** 1 (one failure at level 4)
- **Result:** ✅ PASS (got 1)

### Test 8: start=0, final AT prot — end exactly at prot boundary
- **Input:** drops={0:1, 1:2, 2:1, 3:1}, prot=3, start=0, final=3
- **Scenario:** 0→1(s)→fail(1→0, no prot)→0→1(s)→2(s)→3(s)→end at 3
- **Expected prots:** 0 (the one failure is at level 1, below prot)
- **Result:** ✅ PASS (got 0)

### Test 9: start below prot, final above prot (mid-level end)
- **Input:** drops={2:1, 3:1, 4:2, 5:1}, prot=3, start=1, final=4
- **Scenario:** Start at 1→2→3→4→5→fail(5→4, **P**)→end at 4
- **Expected prots:** 1 (one failure at level 5)
- **Result:** ✅ PASS (got 1)

### Test 10: both start and final above prot
- **Input:** drops={4:1, 5:2, 6:1}, prot=3, start=4, final=6
- **Scenario:** Start at 4→5(s)→fail(5→4, **P**)→4→5(s)→6(s)→end at 6
- **Expected prots:** 1 (one failure at level 5)
- **Result:** ✅ PASS (got 1)

### Test 11: start=final — no net progress (round-trip)
- **Input:** drops={2:1, 3:1}, prot=3, start=2, final=2
- **Scenario:** Start at 2→3(s)→fail(3→2, **P**)→end at 2. Net progress = 0.
- **Expected prots:** 1 (one failure at level 3)
- **Key insight:** start=final means start adjustment (+1) and final adjustment (-1) cancel at level 2: attempts[2] = 1 + 1 - 1 = 1.
- **Result:** ✅ PASS (got 1)

### Test 12: single-level cycling — repeated fail at same level
- **Input:** drops={4:3, 5:3}, prot=3, start=4, final=4
- **Scenario:** 4→5→fail→4→5→fail→4→5→fail→end at 4. Three identical cycles.
- **Expected prots:** 3 (three failures at level 5)
- **Result:** ✅ PASS (got 3)

### Test 13: protLevel=0 — all failures protected
- **Input:** drops={0:1, 1:2, 2:1, 3:1}, prot=0, start=0, final=3
- **Scenario:** 0→1(s)→fail(1→0, **PROT** since 1≥0)→0→1(s)→2(s)→3(s)
- **Expected prots:** 1 (the failure at level 1 counts since protLevel=0)
- **Note:** With protLevel=0, every failure is "protected." Even failures at level 0 would count (L≥0), though in practice level-0 failures are self-loops.
- **Result:** ✅ PASS (got 1)

### Test 14: protLevel > maxLevel — no protections possible
- **Input:** drops={0:1, 1:2, 2:1, 3:1, 4:1, 5:1}, prot=10, start=0, final=5
- **Scenario:** 0→1→fail(1→0)→0→1→2→3→4→5. prot=10 means no level reaches prot.
- **Expected prots:** 0
- **Key detail:** Algorithm correctly computes failures[1]=1 but doesn't count it (1 < 10). Also, cascade correctly doesn't route failures as "protected" (L+2 < protLevel), so unprotected failures drop to 0 and reappear in lower-level drops.
- **Result:** ✅ PASS (got 0)

### Tests 15-17: Multi-session chain [fail, fail, success]

Each session's `startLevel` = previous session's `finalLevel` (which is 0 for failed sessions).

| Session | Start | Final | Drops | Expected Prots | Got |
|---------|-------|-------|-------|----------------|-----|
| 1 (fail) | 0 | 0 | {0:1,1:1,2:2,3:2,4:2,5:1} | 3 | 3 ✅ |
| 2 (fail) | 0 | 0 | {0:1,1:1,2:2,3:2,4:1} | 2 | 2 ✅ |
| 3 (success) | 0 | 8 | {1:1,2:1,3:2,4:2,5:1,6:1,7:1,8:1} | 1 | 1 ✅ |
| **Total** | | | | **6** | **6 ✅** |

**Session 1:** 0→1→2→3→4→5→fail(5→4,P)→fail(4→3,P)→fail(3→2,P)→fail(2→0)→end at 0. Prots at 5,4,3 = 3.
**Session 2:** 0→1→2→3→4→fail(4→3,P)→fail(3→2,P)→fail(2→0)→end at 0. Prots at 4,3 = 2.
**Session 3:** 0→1→2→3→4→fail(4→3,P)→3→4→5→6→7→8→end at 8. Prot at 4 = 1.

---

## ❌ Test 18: BUG FOUND — startLevel > maxLevel from drops

- **Input:** drops={3:1, 4:1, 5:1}, prot=3, start=6, final=3
- **Scenario:** Item starts at +6, fails down: 6→5(**P**)→4(**P**)→3(**P**)→end at 3
- **Expected prots:** 3
- **Got:** 1

### Root Cause

The algorithm computes `maxLevel = Math.max(...Object.keys(levelDrops))`. When `startLevel` exceeds this (item started higher than any drop level), the initialization loop `for (let L = 0; L <= maxLevel; L++)` never reaches `startLevel`, so the `+1` start adjustment is **never applied**.

**What happens:**
1. `maxLevel = 5` (from drops), but item started at level 6
2. Loop goes 0..5, skips level 6 entirely
3. `attempts[6]` is never set — the attempt at level 6 is lost
4. Algorithm thinks item just appeared at level 5, giving only 1 prot failure

**Internal state (buggy):**
```
attempts:  {0:0, 1:0, 2:0, 3:0, 4:1, 5:1}    ← missing level 6!
failures:  {0:0, 1:0, 2:0, 3:0, 4:0, 5:1}
protCount = 1 (only failures[5])
```

**Correct internal state (if maxLevel included startLevel):**
```
attempts:  {0:0, 1:0, 2:0, 3:0, 4:1, 5:1, 6:1}
failures:  {0:0, 1:0, 2:0, 3:0, 4:1, 5:1, 6:1}
protCount = 3 (failures at 6+5+4)
```

### Suggested Fix

Extend `maxLevel` to include `startLevel`:
```js
const maxLevel = Math.max(...levels, startLevel || 0, finalLevel || 0);
```

This ensures the loop covers all relevant levels even when the item started above the highest drop level.

### When Does This Bug Trigger?

This happens when an item starts at a high level and **every** attempt fails (all failures, no successes). The item cascades down without ever reaching a level above `startLevel`, so no drops are recorded at or above `startLevel`. Realistic scenario: item at +10, protection at +5, fails all the way down — drops would only appear at levels 9,8,7,...,0 but not at 10.

---

## Test 19: Empty drops
- **Input:** drops={}, prot=3, start=0, final=0
- **Expected:** 0 (early return)
- **Result:** ✅ PASS

## Test 20: Multiple failures at same protected level
- **Input:** drops={1:1, 2:1, 3:3, 4:3, 5:1}, prot=3, start=0, final=5
- **Scenario:** 0→1→2→3→4→fail(4→3,P)→3→4→fail(4→3,P)→3→4→5→end at 5
- **Expected:** 2 prots (two failures at level 4)
- **Result:** ✅ PASS (got 2)

## Test 21: All failures just below prot boundary
- **Input:** drops={0:2, 1:3, 2:3, 3:1}, prot=3, start=0, final=3
- **Scenario:** 0→1→2→fail(2→0)→0→1→2→fail(2→0)→0→1→2→3→end at 3
- **Expected:** 0 prots (both failures at level 2, below prot=3)
- **Result:** ✅ PASS (got 0)

---

## Conclusions

1. **The algorithm is correct for all normal scenarios** — all 20 "expected to pass" tests pass.
2. **One bug found:** When `startLevel > max(levelDrops keys)`, the algorithm undercounts protections because it doesn't extend its loop range to include `startLevel`.
3. **Negative attempts don't cause crashes** — the `max(0, ...)` clamping prevents issues, and in tested scenarios the cascade still produces correct results despite negative values at level 0.
4. **The multi-session chain works correctly** — computing each session independently with proper start/final chaining produces correct per-session and total prot counts.
5. **Edge cases (protLevel=0, protLevel>max, empty drops, start=final) all behave correctly.**
