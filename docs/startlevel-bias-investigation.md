# Start-Level Bias Investigation

## Verdict: LIKELY A SIM ARTIFACT — NOT A REAL BUG

**Update (2026-02-14):** The sim recorded drops BEFORE each action (at current level), meaning `levelDrops[startLevel]` included the starting action. Real game data does NOT work this way — drops are the *results* of actions (items produced), not a record of where you were when you acted. So `levelDrops` does NOT include a drop for the starting position, and the `attempts[startLevel] += 1` is CORRECT — it accounts for the item starting at that level without a corresponding drop entry. The robust tests were crafted with this same assumption and passed correctly.

The analysis below assumed the sim's drop model matched reality. It doesn't.

---

## Original Analysis (sim-based, likely incorrect)

The `attempts[startLevel] += 1` in `calculateProtectionFromDrops` double-counts the starting position, inflating prot estimates by ~1 when `startLevel >= protLevel`.

## Root Cause

The algorithm's `attempts[L]` is meant to represent "number of enhancement attempts made at level L." In the real game (and simulation), each enhancement action produces a drop at the item's current level. So `levelDrops[L]` **already includes** the first action at `startLevel`. The `+1` adjustment adds a phantom extra attempt.

When `startLevel < protLevel`, this phantom attempt is at a level below protection — any resulting phantom "failure" doesn't count toward `protCount`, so the error is hidden. When `startLevel >= protLevel`, the phantom attempt creates ~1 extra failure counted as a prot use.

### Minimal Reproducing Case

```
Path: start at 3, succeed to 4, end.
Drops: {3:1} (one action at level 3 → success)
Expected prots: 0

calculateProtectionFromDrops({3:1}, 3, 3, 4)
→ attempts[3] = 1 (drop) + 1 (start) = 2
→ successes[3] = drops[4] (0) = 0  (no drops at 4 since it's finalLevel, attempts[4]=-1→clamped)
→ failures[3] = 2 - 0 = 2
→ protCount = 2  ← WRONG, should be 0
```

### Simulation Confirmation

100 runs, NO blessed tea, start=3, prot=3, 100 actions each:
- **Original algorithm:** mean error = **+0.94** (systematic overestimate)
- **Without the `+1`:** mean error = **-0.06** (noise-level, correct)

Start=0 is unaffected by the fix (mean error stays at -0.06 either way).

## Why Existing Robust Tests Didn't Catch It

**The hand-crafted test drops were inconsistent with their described paths.** They were crafted as if `levelDrops` does NOT include the starting action, making the `+1` correct for those specific test inputs.

Example — Robust Test 6:
- Described path: `3→4(s)→fail(4→3,P)→3→4(s)→5(s)→end at 5`
- This path visits level 3 **twice** (start + return from fail), so real drops should be `{3:2, 4:2, 5:1}`
- But the test used `{3:1, 4:2, 5:1}` — only 1 drop at level 3, as if the starting position doesn't count
- With that under-counted input, the `+1` compensates perfectly and the test passes

When you feed **actual** drops (from simulation or real game data, which DO include the starting action), the `+1` becomes a double-count.

## Suggested Fix

Remove the `+1` for `startLevel`:

```javascript
for (let L = 0; L <= maxLevel; L++) {
    attempts[L] = (levelDrops[L] || 0);
    // REMOVED: if (L === startLevel) attempts[L] += 1;
    if (L === finalLevel) attempts[L] -= 1;
}
```

**But wait** — the `finalLevel` adjustment (`-1`) follows the same logic. If the item ends at `finalLevel` and there's no action taken there (session ended), then `levelDrops[finalLevel]` should be 0 and the `-1` would make it negative (clamped to 0, no harm). But if the last action WAS at `finalLevel` (e.g., the item succeeded to finalLevel on the last action, and the drop was recorded before that action at the level below), then the `-1` might also need review.

Actually, looking at the sim: drops are recorded BEFORE each action. The last action's drop is at the pre-action level. If the item ends at `finalLevel` via success, the last drop is at `finalLevel - 1`. So `levelDrops[finalLevel]` only has drops from times the item was AT finalLevel and then acted (failed back down or succeeded higher). The `-1` adjustment would be wrong too in that case.

**Tested all combinations** (200 runs each, start=0 and start=3):

| Adjustments | start=0 error | start=3 error |
|---|---|---|
| Original (+start, -final) | -0.07 | **+0.93** ← bug |
| **No +start, keep -final** | **-0.07** | **-0.07** ← fix |
| Neither | +0.10 | +0.10 |
| +start only, no -final | +0.10 | +1.10 |

**Correct fix:** Remove only the `+1` for startLevel. Keep the `-1` for finalLevel.

```javascript
for (let L = 0; L <= maxLevel; L++) {
    attempts[L] = (levelDrops[L] || 0);
    // REMOVED: if (L === startLevel) attempts[L] += 1;
    if (L === finalLevel) attempts[L] -= 1;
}
```

The `-1` for finalLevel is correct because the item sitting at `finalLevel` at session end means there's one "arrival" at that level that didn't result in an action (no drop recorded for it). So `levelDrops[finalLevel]` undercounts by 0 if the item never visited finalLevel during actions, but the algorithm's cascade needs to account for the item being there. Actually, the `-1` works because it prevents the algorithm from counting the final resting position as an attempt.

## Files

- `docs/startlevel-bias-test.js` — test script with all evidence (run with `node`)
- `docs/blessed-tea-sim.js` — original simulation that discovered the bias
