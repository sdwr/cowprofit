# Historical Prices Plan

## Problem
Session profit calculations use current market prices for mats/prots/teas instead of prices at the time of the session. Old sessions get wrong costs. Also, price history is only ~7 days, so old session prices are lost forever.

## Current State (what's already done this session)
- **Chained final levels** — committed. Groups walk backwards: session N+1's startLevel becomes session N's finalLevelOverride for prot calculation. Only affects failure sessions (success keeps original prot cost). Two commits on `main` branch.

## Architecture: Price Lookup Today

### 4 different lookup paths (the problem):
1. **Direct `prices.market[hrid]['0'].a`** — in `calculateEnhanceSessionProfit()` for mats, prots, teas
2. **`getBuyPrice(hrid, level, mode)`** — in `getCraftingMaterials()`, `getMaterialDetails()` — current market only
3. **`estimatePrice(itemHrid, level, lootTs, mode)`** — does historical lookup via `prices.history`, falls back to `calculateCostToCreate()` → but sub-lookups use current market
4. **`enhance-calc.js` `_getBuyPrice`/`getItemPrice`** — separate implementation, current market only

### `estimatePrice` flow:
1. Look up `prices.history[item:level]` for closest price before `lootTs`
2. If no history → fall back to `calculateCostToCreate(item, level, lootTs)`
   - Level 0: `getCraftingMaterials()` → calls `getBuyPrice()` (current market!)
   - Level N: `estimatePrice(item, 0, lootTs)` for base + `calculator.calculateEnhancementCost()` (current market!)

## The Plan

### Step 1: Make `estimatePrice` historical all the way down

`estimatePrice` is already the right unified function — just needs to propagate `lootTs` into its fallback paths.

**New helper:** `getBuyPriceAtTime(hrid, level, lootTs, mode)` — does history array lookup (no craft fallback, to avoid circular recursion). Returns price or 0.

**Changes:**
- `getCraftingMaterials(itemHrid, mode)` → add `lootTs` param → use `getBuyPriceAtTime` instead of `getBuyPrice` for each material
- `calculateCostToCreate` → pass `lootTs` to `getCraftingMaterials`
- `calculateEnhanceSessionProfit()` → replace all direct `prices.market` reads with `estimatePrice(hrid, 0, lootTs, 'pessimistic').price` for mats, prots, teas
- For `calculator.calculateEnhancementCost(itemHrid, level, prices, mode)` — pre-build a `pricesAtTime` object (same shape as `prices`) using `getBuyPriceAtTime` for the items that session needs, pass that instead of `prices`

### Step 2: Cache prices per session in localStorage

**Key:** `session-prices-{sessionKey}` or a single object keyed by sessionKey.

**What to cache:** The resolved prices for that session — mat prices, prot price, tea prices, estimated sale, base item cost. Basically all the price inputs to the profit calculation.

**When to cache:** After first calculation of a session's prices.

**When to use cache:** On subsequent renders, if cache exists for a session, use cached prices instead of re-looking up. This means even after history rolls off the 7-day window, old sessions keep their correct prices.

**Updated sessions** (same sessionKey, data changed) can reuse the same cached prices — prices don't change when the session data updates, only quantities/levels do.

### Step 3: Pre-build pricesAtTime for enhance-calc.js

Rather than modifying enhance-calc.js, build a prices-shaped object before calling it:
```js
function buildPricesAtTime(lootTs, itemHrids) {
    const market = {};
    for (const hrid of itemHrids) {
        market[hrid] = { '0': { a: getBuyPriceAtTime(hrid, 0, lootTs, 'pessimistic') } };
    }
    return { market, history: prices.history };
}
```
Then pass this to `calculator.calculateEnhancementCost()`.

## Data Notes
- 806 items tracked at level 0, covering all enhancement mats (82 unique) and protection items (89 unique)
- Only 21 items missing (trainee charms + a few rare items) — negligible
- History arrays are small (5-15 entries per item) — individual lookups are fast
- ~10-20 lookups per session × ~30 sessions = ~600 tiny array scans = negligible perf

## Files to Modify
- `main.js`: `calculateEnhanceSessionProfit`, `getCraftingMaterials`, `calculateCostToCreate`, `getBuyPrice`, new `getBuyPriceAtTime`, localStorage caching logic
- `enhance-calc.js`: NO changes needed (pass pre-built prices object)
