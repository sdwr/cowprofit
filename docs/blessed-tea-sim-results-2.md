# Blessed Tea Simulation Results — Attempt 2

## Key Discovery: The Error Isn't From Blessed Tea

The ~+1 overestimate error seen in `start=protLevel` scenarios **exists even without blessed tea**:

| Scenario | Mean Error | Mean |Error| | Max |Error| |
|---|---|---|---|
| NO BT, start=0, prot=3 | -0.06 | 0.14 | 2 |
| NO BT, start=3, prot=3 | **+0.94** | **0.94** | 3 |
| 1% BT, start=3, prot=3 | +0.84 | 0.88 | 2 |

The +0.94 mean error with NO blessed tea proves this is a **baseline algorithm bug** unrelated to blessed tea.

## Root Cause Analysis

When `startLevel >= protLevel`, the algorithm adds +1 to `attempts[startLevel]` to account for the starting position. This extra attempt at a level ≥ protLevel gets partially misattributed as a failure, inflating the prot count by ~1.

The algorithm works top-down: at each level, it estimates successes as `arrivals_at_L+1 - failures_landing_at_L+1`. The residual `attempts[L] - successes[L]` becomes failures. The +1 start adjustment creates an imbalance that propagates as ~1 extra failure at the prot level.

## Blessed Tea Actual Impact

After isolating the start-level bug, blessed tea's impact is quite small:

| Scenario (start=0) | V1 Mean |Error| | Notes |
|---|---|---|
| 100 actions, NO BT, prot=3 | 0.14 | Baseline |
| 100 actions, 1% BT, prot=3 | 0.28 | +0.14 from BT |
| 500 actions, NO BT, prot=3 | 0.14 | Baseline scales well |
| 500 actions, 1% BT, prot=3 | 0.53 | More actions → more BT procs → more error |

With start=0 (typical use case), blessed tea adds ~0.14 mean absolute error for 100 actions and ~0.39 for 500 actions. At 1% proc rate with ~50% of actions being successes, that's ~0.5-2.5 blessed tea procs per session — each slightly confusing the algorithm.

## V2 Algorithm Attempt

Tried adjusting by estimating blessed tea procs as 1% of successes at each level. This had **zero effect** because per-level success counts are small (typically 5-20), and `round(count * 0.01)` = 0. The correction granularity is too coarse.

A fractional (non-rounded) approach would help, but the improvement would be tiny (~0.3 prots over 500 actions).

## Conclusions

1. **Blessed tea is a non-issue for prot estimation.** The error it introduces (< 0.5 prots on average) is within the noise floor of the algorithm.

2. **The real bug is start=protLevel.** The algorithm systematically overestimates by ~1 prot when the item starts at or above the protection level. This affects ALL sessions, not just blessed tea ones.

3. **Recommendation:** Fix the start-level bug rather than worry about blessed tea. The fix would be to handle the start-level adjustment more carefully — perhaps not counting the starting position as an "attempt" in the same way, or subtracting 1 from the prot count when `startLevel >= protLevel`.

4. **For blessed tea detection:** It's not worth trying. At 1% proc rate, the signal is too weak to reliably detect from drop distributions alone. The algorithm's existing error margin is larger than the blessed tea effect.

## Files Created
- `docs/blessed-tea-sim.js` — simulation script (V1 vs V2 comparison)
- `docs/blessed-tea-debug.js` — debug script that isolated the start-level bug
- `docs/blessed-tea-sim-results-1.md` — initial results
- `docs/blessed-tea-sim-results-2.md` — this file
