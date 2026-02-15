# Historical Prices Implementation Review

**Date:** 2026-02-14
**Reviewer:** Subagent (automated code review)

## Verification Checklist

### 1. `getBuyPriceAtTime` function exists, no craft fallback
**✅ PASS** — Lines ~1697-1714. Does history array lookup, falls back to current `getBuyPrice()` (market only). No craft fallback — avoids circular recursion.

### 2. `getMaterialDetails` accepts optional `lootTs`, uses `getBuyPriceAtTime`
**✅ PASS** — Signature: `getMaterialDetails(itemHrid, actions, mode, lootTs)`. Uses `getBuyPriceAtTime` when `lootTs` provided, else `getBuyPrice`.

### 3. `getCraftingMaterials` accepts optional `lootTs`, uses `getBuyPriceAtTime`
**✅ PASS** — Signature: `getCraftingMaterials(itemHrid, mode, lootTs)`. Same pattern — historical when `lootTs` provided.

### 4. `calculateEnhanceSessionProfit` uses historical prices for ALL cost lookups
**✅ PASS** — Mat costs use `getBuyPriceAtTime(costHrid, 0, lootTs, 'pessimistic')`. Prot costs use `getBuyPriceAtTime` for mirror, base item, and protection items. Base item uses `estimatePrice(itemHrid, 0, lootTs, ...)`. Enhancement calculator gets `buildPricesAtTime(lootTs, ...)`.

### 5. `computeSessionDisplay` uses historical tea prices
**✅ PASS** — Tea prices use `getBuyPriceAtTime('/items/ultra_enhancing_tea', 0, lootTs, ...)` etc. instead of direct `prices.market` reads.

### 6. `calculateCostToCreate` passes `lootTs` through to sub-calls
**✅ PASS** — Passes `lootTs` to `getCraftingMaterials(itemHrid, mode, lootTs)` and `estimatePrice(itemHrid, 0, lootTs, mode)`. Also builds `buildPricesAtTime(lootTs, ...)` for calculator.

### 7. `buildPricesAtTime` exists and is used with `calculator.calculateEnhancementCost`
**✅ PASS** — Function exists (~line 1717). Used in both `calculateEnhanceSessionProfit` and `calculateCostToCreate`.

### 8. Session price caching in localStorage
**⚠️ PARTIAL FAIL** — Cache functions exist (`cacheSessionPrices`, `getCachedSessionPrices`, `getSessionPricesCache`, `saveSessionPricesCache`). However, the caching code in `calculateEnhanceSessionProfit` is **dead code** — it appears AFTER a `return` statement (~line 1497-1509). The function returns `enhanceProfit` result object at line ~1493, and the `cacheSessionPrices()` call and `return result;` come after that return. **The cache is never written to.**

Additionally, the cache is **never read** — there's no code that calls `getCachedSessionPrices()` to check for cached prices before doing lookups.

### 9. `renderDetailRow` and `calculateMatPercent` still use current prices (no regression)
**✅ PASS** — `renderDetailRow` calls `getMaterialDetails(r.item_hrid, 1, mode)` without `lootTs` (current prices). `calculateMatPercent` calls `getMaterialDetails(r.item_hrid, 1, currentMode)` without `lootTs`. Both use current prices as intended.

### 10. No circular recursion
**✅ PASS** — `getBuyPriceAtTime` does history lookup → falls back to current market `getBuyPrice`. No craft fallback. The chain `estimatePrice` → `calculateCostToCreate` → `getCraftingMaterials` → `getBuyPriceAtTime` is safe — `getBuyPriceAtTime` never calls `estimatePrice` or `calculateCostToCreate`.

## Bugs Found

### BUG 1: Dead code — session price caching never executes (CRITICAL)
In `calculateEnhanceSessionProfit()`, the `cacheSessionPrices()` call and `return result;` are placed after an earlier `return { ... }` statement. The code after the first return is unreachable. This means:
- Session prices are never cached to localStorage
- Old sessions whose history rolls off the 7-day window will lose their correct prices
- The `getCachedSessionPrices()` function is never called anywhere to read cached data

**Fix:** Move the caching logic before the return, or restructure to assign to a variable first, cache it, then return.

### BUG 2: `prices.market` still used for sell price in `calculateEnhanceSessionProfit`
Line in the success block: `const sellPrice = prices.market?.[itemHrid]?.[String(resultLevel)]?.b || 0;`
This reads the current market bid for the sell price. However, this is arguably correct — the sell price should reflect what you'd get NOW (or at time of sale), not historical. The estimated sale price IS calculated via `estimatePrice` with `lootTs`. **Minor / design decision — not a bug per se.**

## Questionable Design Decisions

1. **History key format mismatch?** — `getBuyPriceAtTime` uses key `${hrid}:${level}` but the plan doc mentions keys like `/items/item:10`. Need to verify the actual `prices.history` key format matches. If history uses `item:level` format (e.g., `/items/godsword:10`), the current code's `${hrid}:${level}` would produce `/items/godsword:0` which should work for level-0 lookups.

2. **Artisan tea in `getCraftingMaterials` uses `calculator?.getArtisanTeaMultiplier()`** — This reflects the CURRENT tea config, not what was active at `lootTs`. Since we don't have historical gear/tea config, this is an acceptable approximation but worth noting.

3. **`getBuyPriceAtTime` returns ask price from history** — History entries contain a single `p` value. The plan says "buy at ask" for pessimistic mode, but history `p` is presumably the ask price at that time. This should be fine but worth confirming the history format stores ask prices.

## Summary Recommendation

**Implementation is 90% correct.** The core architecture matches the plan — historical prices propagate through all calculation paths, `getBuyPriceAtTime` avoids circular recursion, `buildPricesAtTime` feeds the calculator, and current-price paths (`renderDetailRow`, `calculateMatPercent`) are untouched.

**One critical bug:** The localStorage session price caching is completely broken (dead code after return statement). This defeats the plan's Step 2 goal of preserving prices after history rolls off. Needs a quick fix to move the caching code before the return, and add a cache-read path at the top of the function.
