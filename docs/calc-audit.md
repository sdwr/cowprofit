# CowProfit Calculation Logic Audit

**Date:** 2026-02-14  
**File:** `main.js` (2117 lines)  
**Auditor:** Subagent calc-audit

---

## 1. `computeSessionDisplay()` (lines ~445–540)

### Fields cross-reference

**Fields returned by `computeSessionDisplay`:**
`session`, `sessionKey`, `enhanceProfit`, `isSuccess`, `isSold`, `effectiveResultLevel`, `salePrice`, `estimatedSale`, `estimatedSource`, `estimatedSourceIcon`, `totalTeaCost`, `fee`, `baseItemCost`, `profit`, `profitPerDay`, `hours`, `duration`, `hasPriceErrors`, `hashMismatch`

**Fields accessed by `renderCardBody(d, isSubCard)`:**
- `d.enhanceProfit` (ep) → `.protLevel`, `.currentLevel`, `.highestLevel`, `.itemName`, `.actionCount`, `.protsUsed`, `.totalMatCost`, `.totalProtCost`, `.protPrice`, `.matPriceMissing`, `.protPriceMissing`, `.baseItemSourceIcon` ✅ all exist in `calculateEnhanceSessionProfit` return
- `d.isSuccess`, `d.isSold`, `d.effectiveResultLevel`, `d.sessionKey`, `d.hashMismatch` ✅
- `d.session.startTime` ✅
- `d.totalTeaCost`, `d.baseItemCost`, `d.estimatedSale`, `d.estimatedSource`, `d.estimatedSourceIcon` ✅
- `d.salePrice`, `d.fee` ✅
- `d.profit`, `d.profitPerDay`, `d.hasPriceErrors`, `d.duration` ✅

**Fields accessed by `renderSessionCard(d, options)`:**
- `d.sessionKey`, `d.enhanceProfit.itemName`, `d.session.startTime` ✅
- `d.isSuccess`, `d.isSold`, `d.effectiveResultLevel` ✅
- `d.profit`, `d.hasPriceErrors` ✅

**Verdict:** ✅ All fields match. No missing fields.

### Logic review

- **Tea cost** calculation assumes all 3 teas (ultra enhancing, blessed, wisdom) are always active. No check for calculator config. This is a **minor assumption issue** — if user doesn't use all teas, tea cost is overstated. Not a bug per se, but worth noting.
- **Profit formula:**
  - Failure: `-(matCost + protCost + teaCost)` ✅ correct (no base item consumed)
  - Success: `(salePrice - fee) - (matCost + protCost + baseItemCost + teaCost)` ✅ correct
- **`effectiveResultLevel`** falls back to `highestTargetLevel` — works for manual success toggles where `resultLevel` may be 0. ✅

---

## 2. `calculateEnhanceSessionProfit()` (lines ~822–975)

### Mat costs
- Iterates `itemData.enhancementCosts`, looks up ask price for each mat. ✅
- Coins handled separately (price=1). ✅
- Total = `actionCount * matCostPerAction`. ✅

### Protection costs
- Uses `calculateProtectionFromDrops()` cascade method to count prots. ✅
- Prot price = min(mirror price, base item ask, protection items from item data). ✅
- All prices use ask (buying). ✅

### Base item cost
- Only calculated when `isSuccessful` is true. ✅
- Uses `estimatePrice()` with historical fallback chain. ✅

### Success detection
- `resultLevel >= 10` AND exactly 1 item at that level. ✅
- This means +8 successes are NOT detected as successful. **⚠️ POTENTIAL ISSUE** — if someone enhances to +8, it won't count as success. However, `highestTargetLevel` checks `[8, 10, 12, 14]`, so manual toggle can fix this. The UI allows forcing success. Acceptable design choice.

### Level tracking
- `currentLevel` from `primaryItemHash` parsing. ✅
- `highestLevel` from max of all drop keys. ✅
- `highestTargetLevel` from drops matching `[8, 10, 12, 14]`. ✅

### ⚠️ Bug: Unused `revenue`/`profit` in return value
Lines ~955-965 calculate `fee`, `netSale`, `profit` inside `calculateEnhanceSessionProfit`, but `computeSessionDisplay` **completely recalculates** these using its own logic (with overrides, tea costs, custom sale price). The values in the return object (`fee`, `netSale`, `profit`, `profitPerHour`) are never used by any consumer. **Not a bug, but dead code** — could cause confusion.

---

## 3. `autoGroupSessions()` (lines ~361–415)

### Grouping logic
- Sorts chronologically (oldest first). ✅
- Groups by item name. ✅
- Accumulates failures into `currentGroup`. ✅
- Closes group at success when `currentGroup.length > 1`. ✅
- Single success (no preceding failures) = no group. ✅
- Remaining failures at end stay ungrouped. ✅
- Manual ungroups respected via `ungroupedKeys` set. ✅

### ⚠️ BUG: Redundant `calculateEnhanceSessionProfit` calls (line ~374)

```javascript
for (const s of sorted) {
    const ep = calculateEnhanceSessionProfit(s);  // CALLED HERE
    if (!ep) continue;
    ...
}
```

Then inside the loop body (line ~383):
```javascript
const ep = calculateEnhanceSessionProfit(s);  // CALLED AGAIN
```

Wait — actually looking more carefully, the first call at line ~374 is in the "group by item" loop, and the second at line ~383 is inside the per-item grouping loop. Let me re-read...

Actually, the structure is:
1. **First loop** (lines ~372-378): Groups sessions by item name, calling `calculateEnhanceSessionProfit(s)` for each session to get `itemName`.
2. **Second loop** (lines ~380-403): Iterates per-item sessions, calling `calculateEnhanceSessionProfit(s)` again to check `isSuccessful`.

**This is called BEFORE `computeSessionDisplay` in `renderLootHistoryPanel`.** The render function calls `computeSessionDisplay` (which also calls `calculateEnhanceSessionProfit`) for each session. So each session gets `calculateEnhanceSessionProfit` called **3 times total**:
1. In `autoGroupSessions` grouping-by-item loop
2. In `autoGroupSessions` success-detection loop  
3. In `computeSessionDisplay`

**BUG: 2x redundant calls per session.** The function does non-trivial work (price lookups, cascade calculations, console.log debug output).

**Suggested fix:** In `autoGroupSessions`, use the already-computed `displayData` from `renderLootHistoryPanel` instead of calling `calculateEnhanceSessionProfit` directly. Or memoize the function. Alternatively, pass pre-computed display data into `autoGroupSessions`.

### ⚠️ BUG: autoGroupSessions ignores non-enhance sessions but doesn't filter them

Line ~374: `if (!ep) continue;` skips non-enhance sessions, but they're already filtered by `renderLootHistoryPanel` (line ~690: `.filter(s => s.actionHrid?.includes('enhance'))`). Not a bug, just redundant.

---

## 4. P&L in Grouped Context

### Group profit summation (lines ~730-732)
```javascript
let groupProfit = topData.profit;
for (const sd of subDatas) groupProfit += sd.profit;
```

### Base item cost in failures vs success

In `computeSessionDisplay`:
- **Failure** (`isSuccess = false`): `profit = -failureCost` where `failureCost = matCost + protCost + teaCost`. **No base item cost.** ✅
- **Success** (`isSuccess = true`): `profit = netSale - successCost` where `successCost = matCost + protCost + baseItemCost + teaCost`. **Base cost included.** ✅

**So base item cost is only counted once (in the success session).** ✅ Correct.

### Verification that failures don't consume base item
In the game, a failed enhancement keeps the item (it drops back to a lower level). The base item is only "consumed" when sold after success. The code correctly models this. ✅

---

## 5. `renderLootHistoryPanel()` Totals (lines ~700-720)

```javascript
for (const d of Object.values(displayData)) {
    validCount++;
    if (!d.hasPriceErrors) {
        totalProfit += d.profit;
        totalHours += d.hours;
        if (d.isSuccess && !d.isSold) {
            unsoldProfit += d.profit;
            unsoldCount++;
        } else {
            soldProfit += d.profit;
        }
    }
}
```

### Analysis
- Iterates ALL sessions in `displayData` (both grouped and standalone). ✅
- `totalProfit = soldProfit + unsoldProfit` — verified: every session goes into either sold or unsold bucket. ✅
- Failures (`!isSuccess`) go to `soldProfit` — reasonable since failures are realized losses. ✅
- Unsold successes tracked separately. ✅

### ⚠️ ISSUE: Grouped sessions counted individually in totals

The totals iterate `Object.values(displayData)` which includes every individual session. Grouped sessions are NOT aggregated differently — each member's profit is counted individually. Since group profit = sum of member profits (line ~731), and totals also sum member profits individually, the numbers are **consistent**. ✅

However, there's a subtle issue: **the group summary shows `groupProfit` but the top-level totals compute the same sum independently.** This is correct but could diverge if group summary ever applies adjustments. Currently fine.

---

## 6. Event Handlers in `attachLootHistoryHandlers()` (lines ~790-870)

### Toggle success (lines ~793-820)
- Cycles: `undefined → true → false → undefined`. ✅
- Saves `forceSuccess` + `dataHash` to localStorage. ✅
- Clears override completely if no other overrides exist. ✅
- Calls `renderLootHistoryPanel()` to re-render. ✅

### Sold toggle (lines ~823-837)
- Toggles `isSold` between `true` and `false`. ✅
- Only shown for successful sessions (enforced in `renderCardBody`). ✅
- Saves hash. ✅

### Sale price adjustment (lines ~839-857)
- Up/down buttons use `getNextPrice`/`getPrevPrice` for MWI price tiers. ✅
- Saves `customSale` override. ✅
- Direct input parsing supports K/M/B suffixes. ✅
- Snaps to valid MWI price via `getValidPrice`. ✅

### ⚠️ Minor: All handlers call `renderLootHistoryPanel()` which re-runs `autoGroupSessions`

Every toggle/adjustment triggers a full re-render including `autoGroupSessions` (which calls `calculateEnhanceSessionProfit` 2x per session). For 30 sessions, that's 60 redundant calculations per click. Performance concern for large histories.

---

## Summary of Bugs Found

| # | Severity | Location | Description | Suggested Fix |
|---|----------|----------|-------------|---------------|
| 1 | **Medium** | `autoGroupSessions` lines ~374, ~383 | `calculateEnhanceSessionProfit` called 2x per session redundantly (plus 1x in `computeSessionDisplay` = 3x total) | Pass pre-computed `displayData` into `autoGroupSessions`, or memoize results |
| 2 | **Low** | `calculateEnhanceSessionProfit` lines ~955-965 | `fee`, `netSale`, `profit`, `profitPerHour` computed but never used (overridden by `computeSessionDisplay`) | Remove dead calculations or document as "raw estimate" |
| 3 | **Low** | `computeSessionDisplay` lines ~491-494 | Tea cost assumes all 3 teas always active, doesn't check calculator config | Check `calculator.config.teaUltraEnhancing`, etc. before including each tea price |
| 4 | **Info** | `calculateEnhanceSessionProfit` line ~920 | Success detection requires level ≥ 10, so +8 enhancements never auto-detect as success | Document this limitation; manual toggle covers it |
| 5 | **Info** | `renderLootHistoryPanel` + handlers | Every user interaction triggers full re-render with 3x redundant profit calculations per session | Consider caching `displayData` and only invalidating on data changes |

### No Critical Bugs Found

The core P&L logic is correct:
- Failures exclude base item cost ✅
- Successes include base item cost once ✅  
- Group totals = sum of member profits ✅
- Sold/unsold breakdown is accurate ✅
- Override system (success toggle, sold toggle, custom sale) works correctly ✅
