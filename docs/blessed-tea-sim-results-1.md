# Blessed Tea Simulation Results — Attempt 1

## Setup
- Simulated enhancement sessions with configurable blessed tea (1% chance for +2 on success)
- Success rates: 50% at +0, -5% per level, min 10%
- Protection: below prot → level 0, at/above prot → level - 1
- 100 runs per scenario, deterministic PRNG
- Tested existing `calculateProtectionFromDrops` algorithm against known ground truth

## Results

| Scenario | Mean Error | Mean |Error| | Max |Error| | Avg Prots | Avg BT Procs |
|---|---|---|---|---|---|
| 100 actions, NO blessed tea, start=0, prot=3 | -0.06 | 0.14 | 2 | 11.7 | 0.00 |
| 100 actions, NO blessed tea, start=0, prot=5 | 0.00 | 0.02 | 1 | 0.9 | 0.00 |
| 100 actions, 1% blessed tea, start=0, prot=3 | -0.14 | 0.28 | 2 | 11.9 | 0.44 |
| 100 actions, 1% blessed tea, start=0, prot=5 | -0.02 | 0.02 | 2 | 1.0 | 0.45 |
| 100 actions, 1% blessed tea, start=3, prot=3 | 0.84 | 0.88 | 2 | 14.1 | 0.40 |
| 100 actions, 1% blessed tea, start=5, prot=5 | 0.96 | 0.98 | 1 | 3.0 | 0.42 |
| 100 actions, 1% blessed tea, start=0, prot=8 | 0.00 | 0.00 | 0 | 0.0 | 0.45 |
| 500 actions, NO blessed tea, start=0, prot=3 | -0.14 | 0.14 | 1 | 60.9 | 0.00 |
| 500 actions, 1% blessed tea, start=0, prot=3 | -0.53 | 0.53 | 3 | 62.6 | 2.32 |
| 500 actions, 1% blessed tea, start=0, prot=5 | -0.04 | 0.04 | 1 | 5.3 | 2.44 |
| 500 actions, 1% blessed tea, start=0, prot=8 | 0.00 | 0.00 | 0 | 0.0 | 2.46 |
| 500 actions, 1% blessed tea, start=5, prot=8 | 0.00 | 0.00 | 0 | 0.0 | 2.45 |
| 500 actions, 5% blessed tea, start=0, prot=5 | -0.24 | 0.24 | 2 | 7.3 | 10.92 |

## Key Findings

### 1. Baseline (no blessed tea) is already slightly off
Even without blessed tea, the algorithm has small errors (mean |error| ~0.14 for prot=3). This is a known limitation of the estimation approach.

### 2. Blessed tea impact depends heavily on scenario
- **start=0, low prot (3):** Modest increase in error. Mean |error| goes from 0.14 → 0.28 (100 actions) and 0.14 → 0.53 (500 actions). The algorithm slightly **underestimates** prots (negative mean error).
- **start=0, high prot (5, 8):** Minimal impact. Most activity happens below prot level, so blessed tea procs there don't affect prot counting.
- **start AT prot level:** Significant **overestimate** (~+0.84 to +0.96 mean error). This is the worst case — blessed tea procs create "phantom" drops that the algorithm misinterprets.

### 3. Why start=protLevel is problematic
When starting at the prot level, the item spends most time near/above prot. A blessed tea +2 proc means a drop is recorded at level L but the item jumped to L+2, not L+1. The algorithm sees the L+1 drop count and attributes it to a success from L, but actually L succeeded to L+2. The "missing" L+1 arrival gets misattributed as a failure landing.

### 4. High prot levels (8) are immune
If prot=8, the item rarely reaches level 8 with these success rates, so there are ~0 prots regardless of blessed tea.

### 5. Overall assessment
For typical use cases (start=0, moderate prot), the error from blessed tea is **small** (< 1 prot on average). The worst case is start=protLevel with 1% blessed tea, where overestimate averages ~1 prot. This may be acceptable but could be improved.

## Next Steps (Attempt 2)
- Investigate if blessed tea procs can be detected from drop patterns
- Try adjusting the algorithm to account for +2 jumps
