# Task: Refactor Enhancement Calculator into 3 Layers

## Context
Working in `C:\Users\roryk\clawd\mwi-tracker` on branch `price-categories`.
This is a client-side MWI (Milky Way Idle) enhancement profit calculator.
Files are served via GitHub Pages — no build step, plain JS.

## Goal
Split the monolithic `enhance-calc.js` into three clean layers so price modes can vary by item category (mats, protections, sell) without the simulation knowing about pricing.

## Current Architecture
`enhance-calc.js` has a single `EnhanceCalculator` class that does everything:
- Enumerates enhancement materials for an item
- Resolves prices from market data using a single `mode` (pessimistic/midpoint/optimistic)
- Finds cheapest protection option
- Runs Markov chain simulation
- Calculates profit

Key methods to decompose:
- `calculateEnhancementCost(itemHrid, targetLevel, prices, mode)` — does item resolution + price resolution + simulation
- `calculateProfit(itemHrid, targetLevel, prices, mode)` — wraps the above + sell price
- `_getBuyPrice(hrid, enhLevel, prices, mode)` — price lookup
- `getSellPrice(hrid, enhLevel, prices, mode)` — price lookup  
- `getItemPrice(hrid, enhLevel, prices, mode)` — buy price with craft fallback
- `getCraftingCost(hrid, prices, mode, depth)` — recursive craft cost
- `_markovEnhance(...)` — pure math, already clean

## New Architecture

### 1. `item-resolver.js` — Item Resolution
Extracts item metadata needed for enhancement calculation.

```js
class ItemResolver {
    constructor(gameData) { ... }
    
    // Returns a "shopping list" — all items involved in enhancing itemHrid to targetLevel
    resolve(itemHrid, targetLevel) {
        return {
            itemHrid,
            itemLevel,           // item's base level (for success/speed calcs)
            targetLevel,
            
            // Enhancement materials: [{hrid, count}, ...]
            materials: [...],
            coinCost: 0,         // coins per attempt
            
            // ALL protection options (cheapest picked AFTER pricing)
            // Each: {hrid, isBaseItem: bool}
            protectionOptions: [
                { hrid: '/items/mirror_of_protection', isBaseItem: false },
                { hrid: itemHrid, isBaseItem: true },  // using base item as fodder
                // ... item-specific protections (exclude _refined)
            ],
            
            // Crafting recipe for base item (if craftable)
            // {inputs: [{hrid, count}, ...], upgrade: hrid|null}
            craftRecipe: null | { inputs: [...], upgrade: '...' },
        };
    }
}
```

**Important:** Protection options must ALL be returned — the cheapest one depends on price mode, so selection happens after pricing.

### 2. `price-resolver.js` — Price Resolution  
Resolves market prices for a shopping list based on category-specific modes.

```js
// Price modes
const BuyMode = {
    PESSIMISTIC: 'pessimistic',       // Ask
    PESSIMISTIC_PLUS: 'pessimistic+', // Ask - 1 tick
    OPTIMISTIC_MINUS: 'optimistic-',  // Bid + 1 tick
    OPTIMISTIC: 'optimistic',         // Bid
};

const SellMode = {
    PESSIMISTIC: 'pessimistic',       // Bid
    PESSIMISTIC_PLUS: 'pessimistic+', // Bid + 1 tick
    MIDPOINT: 'midpoint',             // (Bid + Ask) / 2
    OPTIMISTIC_MINUS: 'optimistic-',  // Ask - 1 tick
    OPTIMISTIC: 'optimistic',         // Ask
};

class PriceResolver {
    constructor(gameData, priceTiers) { ... }
    
    // Resolve all prices for a shopping list
    resolve(shoppingList, marketPrices, modeConfig) {
        // modeConfig = { matMode: BuyMode, protMode: BuyMode, sellMode: SellMode }
        
        return {
            // Material prices resolved with matMode
            matPrices: [[count, resolvedPrice, {hrid, mode, actualMode, bid, ask}], ...],
            
            coinCost: shoppingList.coinCost,
            
            // Base item price (always pessimistic - ask, with craft fallback)
            basePrice, baseSource,
            
            // Cheapest protection after resolving ALL options with protMode
            protectPrice, protectHrid,
            
            // Sell price resolved with sellMode  
            sellPrice,
            
            // Per-item resolved info for UI dots
            // Map<hrid, {price, mode, actualMode, bid, ask}>
            // actualMode may differ from requested mode due to tight spread fallback
            priceDetails: Map,
        };
    }
}
```

**Tick logic** — uses PRICE_TIERS (currently in main.js, move here or pass in):
- `getPriceStep(price)`, `getNextPrice(price)`, `getPrevPrice(price)`
- `getValidPrice(price)` — snap to valid tick

**Fallback rules for tight spreads:**
- If bid and ask are ≤ 1 tick apart:
  - Buy `pessimistic+` falls back to `pessimistic` (ask)
  - Buy `optimistic-` falls back to `optimistic` (bid)  
  - Sell `pessimistic+` falls back to `pessimistic` (bid)
  - Sell `optimistic-` falls back to `optimistic` (ask)
  - Sell `midpoint` stays as midpoint (it's valid even with tight spread)
- `actualMode` in priceDetails tracks what was actually used after fallback

**Base item pricing** (unchanged from current logic):
- Try market ask price (pessimistic buy)
- Try crafting cost (pessimistic for craft ingredients)
- Fall back to vendor price
- Always pessimistic — no mode toggle for base items

**Protection pricing:**
- Only 2 modes: pessimistic (ask) and optimistic (bid)
- No in-between options (prots are usually 1 tick apart)
- Resolve ALL protection options, then pick cheapest

**Crafting cost** (for base items):
- Recursive, same logic as current `getCraftingCost`
- Always uses pessimistic mode (no toggle)
- Respects artisan tea multiplier

### 3. `enhance-calc.js` — Pure Simulation (slimmed)
Keep ONLY:
- `DEFAULT_CONFIG`, gear config
- `EnhanceCalculator` class with:
  - Constructor, gear/tea/bonus methods (unchanged)
  - `getAttemptTime(itemLevel)` (unchanged)
  - `getXpPerAction(itemLevel, enhanceLevel)` (unchanged)
  - `getTotalBonus(itemLevel)` (unchanged)
  - `getGuzzlingBonus()`, `getArtisanTeaMultiplier()`, `getEnhancerBonus()`, `getEffectiveLevel()` (unchanged)
  - `_markovEnhance(...)` (unchanged)
  - `_invertMatrix(...)` (unchanged)
  
  - NEW orchestration method that takes resolved prices:
    ```js
    simulate(resolvedPrices, targetLevel, itemLevel) {
        const totalBonus = this.getTotalBonus(itemLevel);
        const attemptTime = this.getAttemptTime(itemLevel);
        const useBlessed = this.config.teaBlessed;
        const guzzling = useBlessed ? this.getGuzzlingBonus() : 1;
        
        // Find optimal protection level (iterate 2..targetLevel)
        // Uses resolvedPrices.matPrices, .coinCost, .protectPrice, .basePrice
        // Returns best result with protectAt
        ...
    }
    ```

  - KEEP `calculateEnhancementCost(itemHrid, targetLevel, prices, mode)` as a **legacy wrapper** for enhance history compatibility. It should internally create an ItemResolver + PriceResolver, resolve with the given mode for all categories, then call simulate(). This way enhance history code doesn't need to change at all.

  - REMOVE from enhance-calc.js:
    - `_getBuyPrice`, `getSellPrice`, `getItemPrice`, `getCraftingCost` → move to price-resolver.js
    - `PriceMode` → replaced by BuyMode/SellMode in price-resolver.js

### 4. main.js Changes
Update the orchestration in `calculateProfit` and `calculateAllProfitsAsync`:

```js
// In the profit calculation loop:
const resolver = new ItemResolver(gameData);
const pricer = new PriceResolver(gameData, PRICE_TIERS);

const shopping = resolver.resolve(hrid, target);
const resolved = pricer.resolve(shopping, prices, { matMode, protMode, sellMode });
const simResult = calculator.simulate(resolved, target, shopping.itemLevel);

// Calculate profit from simResult + resolved.sellPrice
const sellPrice = resolved.sellPrice;
const marketFee = sellPrice * 0.02;
const profit = sellPrice - simResult.totalCost;
// ... etc
```

- Remove precomputation of all 3 modes — compute only for current mode config
- Recompute on mode change (same async chunked approach as gear changes)
- Store mode config in localStorage like gear config

### 5. index.html
Add script tags for new files (before main.js):
```html
<script src="item-resolver.js"></script>
<script src="price-resolver.js"></script>
```

## File Checklist
- [ ] Create `item-resolver.js`
- [ ] Create `price-resolver.js` (with tick logic moved from main.js)
- [ ] Slim `enhance-calc.js` — move price methods out, add `simulate()`, keep legacy wrapper
- [ ] Update `main.js` — new orchestration, remove precomputed modes, remove old tick functions (moved to price-resolver)
- [ ] Update `index.html` — add new script tags

## Testing
After refactor, the site should produce IDENTICAL results to current when all modes are pessimistic. Open index.html locally and verify:
1. Main list shows same items, same profit numbers
2. Expanded detail shows same cost breakdowns
3. Gear changes still recalculate correctly
4. Enhance history still works (uses legacy wrapper)

## DO NOT implement in this task:
- UI buttons for mode selection (separate task)
- Colored dots on prices (separate task)
- Any visual changes at all — this is a pure refactor
