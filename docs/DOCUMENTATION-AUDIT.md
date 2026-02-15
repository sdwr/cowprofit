# Documentation Audit — CowProfit / mwi-tracker

**Date:** 2026-02-14  
**Scope:** All files in `docs/`

---

## 1. File Inventory

| File | Category | Description | Accuracy | Recommendation |
|------|----------|-------------|----------|----------------|
| `CLIENT_SIDE_CALCS.md` | Historical/completed | Plan for moving calcs from Python to JS (v2 migration) | Outdated — v2 is shipped, architecture section describes old state | **Archive** — useful as historical reference only |
| `LOOT_TRACKER_DESIGN.md` | Historical/completed | Design doc for loot tracker / profit history feature | Mostly accurate — describes data format and import flow | **Keep** — still useful reference for loot log format |
| `PROTECTION_ESTIMATION.md` | Active design doc | Summary of protection estimation algorithm + known prot levels | Accurate — matches deployed code | **Keep** — valuable algorithm reference |
| `calc-audit.md` | Results/analysis | Audit of `main.js` calculation logic, field cross-references | Accurate as of audit date | **Keep** — useful for future audits |
| `grouping-design.md` | Historical/completed | Original design for session grouping (stored groups + exclusion) | Superseded by final-plan | **Archive** — keep for design rationale |
| `grouping-final-plan.md` | Historical/completed | Final data model for grouping (groups + seen, version 2) | Accurate — this is what was implemented | **Keep** — canonical grouping reference |
| `grouping-implementation-plan.md` | Outdated/superseded | Detailed implementation plan, superseded by final-plan | Partially outdated | **Archive** — final-plan is the canonical version |
| `grouping-robustness-review.md` | Results/analysis | Review of grouping plan for edge cases | Accurate | **Archive** — one-time review, findings incorporated |
| `historical-prices-plan.md` | Historical/completed | Plan for historical price lookups in session profit calcs | Implemented | **Archive** |
| `historical-prices-review.md` | Results/analysis | Code review of historical prices implementation | Accurate, found dead cache code bug | **Keep** — documents known issue |
| `price-cache-review.md` | Results/analysis | Review of price cache refactor | Accurate | **Archive** |
| `chained-startlevel-plan.md` | Historical/completed | Plan for chained start levels across grouped sessions | Implemented | **Archive** |
| `startlevel-bias-investigation.md` | Results/analysis | Investigation of start-level bias — concluded likely sim artifact | Resolved — verdict documented | **Archive** |
| `blessed-tea-sim-results-1.md` | Results/analysis | Sim results for blessed tea effect on prot estimation (attempt 1) | Accurate data | **Archive** |
| `blessed-tea-sim-results-2.md` | Results/analysis | Sim results attempt 2 — found baseline algorithm bug | Accurate, key finding | **Keep** — documents root cause |
| `prot-robust-results.md` | Results/analysis | 21-test suite results for protection estimation | Accurate — 20 pass, 1 intentional fail | **Keep** — test documentation |
| `blessed-tea-debug.js` | Test file | Debug script for blessed tea start=prot error | One-off investigation | **Delete** — findings captured in results MDs |
| `blessed-tea-sim.js` | Test file | Blessed tea enhancement simulation | One-off | **Delete** — findings captured |
| `prot-chained-test.js` | Test file | Tests for mid-level finalLevel + chained starts | One-off | **Delete** — results in prot-robust-results.md |
| `prot-final-level-test.js` | Test file | Tests for finalLevel=0 vs maxLevel prot calc | One-off | **Delete** |
| `prot-mid-level-tests.js` | Test file | Tests for oscillating start/final/prot levels | One-off | **Delete** |
| `prot-robust-tests.js` | Test file | Comprehensive 21-case test suite for prot estimation | Reusable test suite | **Keep** — can re-run for regressions |
| `startlevel-bias-test.js` | Test file | Investigation test for start-level bias | One-off | **Delete** — findings in investigation MD |

---

## 2. Missing Documentation

### Critical gaps:
1. **Enhancement mechanics explainer** — No doc explains how MWI enhancement actually works (success rates, level progression, protection mechanics, blessed tea, material consumption). The code assumes deep domain knowledge. `PROTECTION_ESTIMATION.md` covers the algorithm but not the game mechanics it models.

2. **Architecture overview** — No doc describes the current (v2) system architecture: client-side JS calcs, cron-based price updates, GitHub Pages deployment, userscript import flow. `CLIENT_SIDE_CALCS.md` describes the *migration plan* but not the current state.

3. **Data flow diagram** — How data moves: MWI game → userscript → localStorage → main.js → rendered UI. Also: cron → generate_prices.py → prices.js → GitHub Pages.

4. **`enhance-calc.js` internals** — The Markov chain calculator is complex and undocumented. No doc explains the math, the state transitions, or what `protectAt` means.

5. **Price system documentation** — Four different price lookup paths (noted in `historical-prices-plan.md`) but no unified reference for how prices work end-to-end.

6. **Contributing / onboarding guide** — No overview for new contributors. README covers features but not codebase structure.

---

## 3. Enhancing Mechanics Documentation Gap

**Status: Not documented anywhere.**

The codebase implements a sophisticated Markov chain model for MWI enhancement costs, but the underlying game mechanics are nowhere explained:

- What are enhancement levels? (+0 to +N)
- What are success/failure rates per level?
- What happens on failure? (level drops by 1, or to 0?)
- What is protection? When does it activate? What does it cost?
- What is blessed tea? How does the +2 proc work?
- What are the material costs per enhancement attempt?
- How do different equipment tiers differ?

This knowledge lives entirely in `enhance-calc.js` (the Markov chain calculator) and `init_client_info.json` (game data), but extracting it requires reading dense code. A `docs/ENHANCEMENT-MECHANICS.md` explaining the game system would make the codebase far more accessible.

---

## 4. Suggested Documentation Structure

```
docs/
├── DOCUMENTATION-AUDIT.md          # This file (local only)
├── ARCHITECTURE.md                 # NEW: Current system overview, data flow
├── ENHANCEMENT-MECHANICS.md        # NEW: How MWI enhancement works (game rules)
├── ENHANCEMENT-CALCULATOR.md       # NEW: How enhance-calc.js models the math
├── PROTECTION_ESTIMATION.md        # KEEP: Algorithm reference
├── LOOT_TRACKER_DESIGN.md          # KEEP: Loot log format reference
├── grouping-final-plan.md          # KEEP: Canonical grouping design
├── calc-audit.md                   # KEEP: Calculation audit
├── prot-robust-tests.js            # KEEP: Reusable test suite
├── prot-robust-results.md          # KEEP: Test results
├── blessed-tea-sim-results-2.md    # KEEP: Key finding (baseline bug)
├── historical-prices-review.md     # KEEP: Documents cache bug
└── archive/                        # MOVE here:
    ├── CLIENT_SIDE_CALCS.md
    ├── grouping-design.md
    ├── grouping-implementation-plan.md
    ├── grouping-robustness-review.md
    ├── historical-prices-plan.md
    ├── price-cache-review.md
    ├── chained-startlevel-plan.md
    ├── startlevel-bias-investigation.md
    └── blessed-tea-sim-results-1.md
    # DELETE (one-off test scripts, findings captured in MDs):
    # blessed-tea-debug.js, blessed-tea-sim.js, prot-chained-test.js,
    # prot-final-level-test.js, prot-mid-level-tests.js, startlevel-bias-test.js
```

### Priority for new docs:
1. **ENHANCEMENT-MECHANICS.md** — Highest priority, addresses the noted gap
2. **ARCHITECTURE.md** — Essential for onboarding
3. **ENHANCEMENT-CALCULATOR.md** — Important for anyone touching the math
