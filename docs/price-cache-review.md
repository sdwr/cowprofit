# Price Cache Refactor + Historical Prices — Review

**Reviewed:** 2026-02-14  
**File:** `main.js` (2453 lines)  
**Verdict:** Implementation is solid. A few minor edge cases noted below.

---

## Checklist

### 1. ✅ Cache format stores individual prices, not combined matCostPerAction

`cacheSessionPrices` (line ~1530) stores:
- `matPrices` (hrid→price map)
- `protPrice`, `protHrid`
- `teaPrices` (ultraEnhancing, blessed, wisdom)
- `baseItemCost`, `baseItemSource`, `baseItemSourceIcon`
- `estimatedSale`, `estimatedSaleSource`, `estimatedSaleSourceIcon`, `estimatedSaleLevel`
- `matPriceMissing`, `protPriceMissing`, `dataHash`

No `matCostPerAction` stored. ✅

### 2. ✅ Cache read recomputes matCostPerAction from matPrices × counts

Lines ~1465-1475: When `useCached`, individual `matPrices` are read. Then lines ~1477-1484 loop over `enhancementCosts` and reconstruct `matCostPerAction` by summing `costCount * matPrices[costHrid]`. ✅

### 3. ✅ All sessions get base/sale prices

- `baseItemCost` computed for ALL sessions (line ~1510: "Calculate baseItemCost for ALL sessions")
- `estimatedSale` computed for ALL sessions at `saleLevelForEstimate` (line ~1525), using `highestTargetLevel || 10` for failures. ✅

### 4. ✅ Tea prices flow from cached/historical, not current market

`computeSessionDisplay` reads `enhanceProfit.teaPrices` (line ~459: `const sessionTeaPrices = enhanceProfit.teaPrices || {}`), NOT `prices.market`. Tea prices in `enhanceProfit` come from either cache or `getBuyPriceAtTime`. ✅

### 5. ✅ Soft migration — old format treated as cache miss

Line ~1445: `const useCached = cachedPrices && cachedPrices.matPrices;`  
Old format has `matCostPerAction` but no `matPrices` key → falsy → cache miss → prices recomputed from history. ✅

### 6. ✅ renderDetailRow and calculateMatPercent use current market prices

- `renderDetailRow` calls `getMaterialDetails(r.item_hrid, 1, mode)` with no `lootTs` → uses `getBuyPrice` (current market). ✅
- `calculateMatPercent` calls `getMaterialDetails(r.item_hrid, 1, currentMode)` with no `lootTs` → current market. ✅
- `renderDetailRow` calls `getBuyPrice(r.item_hrid, 0, mode)` for market price display. ✅

### 7. ✅ enhance-calc.js untouched

Not in scope of main.js. Calculator is used via `calculator.calculateEnhancementCost()` and `calculator.calculateProfit()` — both called correctly with appropriate price objects.

### 8. ✅ Historical price flow

- `getBuyPriceAtTime` exists (line ~1636) — walks history array to find price at timestamp, falls back to current market.
- `buildPricesAtTime` exists (line ~1659) — builds a `{ market, history }` object for enhance-calc.js.
- All session price lookups in `calculateEnhanceSessionProfit` use `getBuyPriceAtTime` with `lootTs`. ✅
- Calculator calls use `buildPricesAtTime` for prot-level optimization and cost-to-create. ✅

### 9. ✅ No stale prices.market reads in session profit paths

Searched all session calculation paths:
- `calculateEnhanceSessionProfit`: uses `getBuyPriceAtTime` or cache for mats, prots, teas, base item, sale estimate
- `computeSessionDisplay`: reads from `enhanceProfit` object (which used historical prices)
- **One exception (correct):** Line ~1498, `revenue` uses `prices.market?.[itemHrid]?.[String(resultLevel)]?.b` — this is the CURRENT bid for display purposes (the "estimated sale" shown in the UI). This is actually the `estimatedSale` path handled separately via `estimatePrice()`. Wait — no, `revenue` is set from current market bid but is only used for the returned `profit` which is NOT used by `computeSessionDisplay` (it recalculates profit from `estimatedSale`/`customSale`). So this is harmless dead-ish code. See finding below.

---

## Findings

### Minor Issue: `revenue` computed from current market in calculateEnhanceSessionProfit

Line ~1498: `const sellPrice = prices.market?.[itemHrid]?.[String(resultLevel)]?.b || 0;`

This reads current market for `revenue`, `fee`, `netSale`, `profit` in the returned object. However, `computeSessionDisplay` does NOT use these fields — it recalculates everything from `estimatedSale`/`customSale` and cached prices. The returned `profit` and `revenue` are effectively unused (only logged in console.log debug output). **No bug, but misleading.** Could be cleaned up for clarity.

### Edge Case: Missing material in cached matPrices

If game data adds a new material to `enhancementCosts` after a session was cached, the reconstruction loop (line ~1477-1484) does `matPrices[costHrid] || 0` — the new material gets price 0. This is correct defensive behavior (same as a price miss). The `matPriceMissing` flag from cache won't reflect this new material though. **Acceptable — unlikely scenario, and the warning won't show.**

### Edge Case: Cache size growth

Each session stores ~15-20 keys of price data. At 100 sessions × ~500 bytes each = ~50KB in localStorage. localStorage limit is typically 5-10MB. **No concern** even at hundreds of sessions.

### Edge Case: Cache always written on every call

Line ~1530: `cacheSessionPrices` is called every time `calculateEnhanceSessionProfit` runs, even on cache hit (to update `dataHash`). When `useCached=true`, the tea prices use `cachedPrices.teaPrices` (preserving originals) and mat/prot prices are from cache too, so the write is idempotent. **No bug, slight inefficiency.**

### Note: `estimatePrice` has no circular recursion risk

`estimatePrice` → `calculateCostToCreate` → `estimatePrice` (for base item at level 0) → `calculateCostToCreate` (level=0) → `getCraftingMaterials` (no recursion). The level=0 path in `calculateCostToCreate` goes to crafting recipe, not back to `estimatePrice`. ✅

### Note: `getBuyPriceAtTime` fallback is current market ask (pessimistic)

When history doesn't cover the loot timestamp, it falls back to `getBuyPrice` which reads current `prices.market`. This is the best available fallback. Sessions from before price history existed will use current prices until cached. ✅

---

## Summary

The price pipeline is correct end-to-end. Historical prices flow through `getBuyPriceAtTime` → cached per-session → reconstructed on read. The soft migration from old cache format works. No stale `prices.market` reads in session profit calculations (the one in `revenue` is unused by display code). No regressions in calculator table display paths.
