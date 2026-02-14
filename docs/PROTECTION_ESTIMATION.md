# Protection Estimation — Summary

## Algorithm (deployed Feb 14 2026)

Cascade method: work top-down from maxLevel, computing attempts/successes/failures per level.

```
attempts[L] = drops[L] + (L == startLevel ? 1 : 0) - (L == finalLevel ? 1 : 0)
failures[maxLevel] = attempts[maxLevel]  (all attempts at top are failures)
successes[L] = drops[L+1] - failures[L+2]  (if L+2 >= protLevel)
failures[L] = attempts[L] - successes[L]
protCount = Σ failures[L] for L >= protLevel
```

Key fix: `startLevel` from `primaryItemHash` is passed in, and `maxLevel` itself is included in the cascade (fixes maxLevel == protLevel case).

## Protection Levels (manually verified)

| Item | Prot @ |
|------|:------:|
| Soul Hunter Crossbow | 5 |
| Sundering Crossbow | 8 |
| Enhancer's Top | 8 |
| Royal Fire Robe Bottoms (Refined) | 7 |
| Red Culinary Hat | 5 |
| Dairyhands Top | 8 |
| Celestial Shears | 7 |

On site, protLevel is computed per-item by the calculator (`calcResult.protectAt`), fallback to 8.

## Known Limitations

### 1. Blessed Tea (+2 skips)
Blessed tea success goes L → L+2 instead of L+1. The algorithm assumes ±1 steps only, so a blessed skip creates a gap in drops (e.g., drops[10]=0 but drops[11]>0). This causes:
- The skipped success is misattributed as a failure
- Error cascades downward through the protected zone
- Example: Royal Fire Robe +8→+11 reports 5 prots instead of correct 3

**Fix approach:** Detect gaps in drops within protected zone. If drops[L]=0 but drops above/below exist, credit a blessed skip from L-1 to L+1 before running cascade.

### 2. Final Level Uncertainty
Algorithm assumes `finalLevel = maxLevel` (item rests at highest level reached). In reality:
- Multi-item sessions: item may have completed at target and a new one started
- Item could be at any level when session ended
- Wrong finalLevel affects attempts by ±1, so prot estimate can be off by ~1

This is inherently underdetermined from drops data alone. The ±1 error is acceptable for most sessions.

## Test Results (with real prot levels)

| Session | Actions | Start | Prot@ | Prots |
|---------|---------|-------|-------|-------|
| Soul Hunter Crossbow (0→+9) | 1027 | +0 | 5 | 30 |
| Sundering Crossbow (+10) | 3618 | +0 | 8 | 5 |
| Enhancers Top (0→+9) | 813 | +0 | 8 | 6 |
| Royal Fire Robe Refined (0→+9) | 2186 | +0 | 7 | 13 |
| Red Culinary Hat (+12 from +4) | 261 | +4 | 5 | 9 |
| Red Culinary Hat (multi-result) | 319 | +1 | 5 | 38 |
| Dairyhands Top (+8 target) | 2211 | +0 | 8 | 5 |
| Celestial Shears (+8 success) | 320 | +0 | 7 | 0 |
| Enhancers Top (large, +2 start) | 4215 | +2 | 8 | 3 |
| Royal Fire Robe (+11 from +8) | 212 | +8 | 7 | 5* |
| Red Culinary Hat (209 actions) | 209 | +0 | 5 | 19 |

*Blessed tea affected — true value likely ~3
