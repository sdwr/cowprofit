# Client-Side Calculations Refactor

## Goal
Move enhancement profit calculations from Python (server) to JavaScript (client) to enable:
1. **Enhance History Tracking** - Calculate actual profit/loss per enhance action using loot tracker data
2. **Configurable Gear** - Let users input their own gear/levels instead of hardcoded config
3. **Real-time Recalcs** - Instant updates when toggling price modes, fees, etc.

## Current Architecture

```
Python (generate_site.py)
├── Fetches market data from MWI API
├── Loads game data (init_client_info.json)
├── Runs Markov chain calculations (enhance_calc.py)
├── Pre-computes ALL profits for ALL items × ALL levels × ALL modes
└── Outputs data.js (~2MB of pre-computed results)

JavaScript (index.html)
└── Just renders the pre-computed data
```

**Problems:**
- 2MB data.js payload
- Can't recalculate with different gear
- Can't calculate profit/loss for a specific enhance action
- Hardcoded USER_CONFIG

## Proposed Architecture

```
Python (generate_site.py) - SIMPLIFIED
├── Fetches market data from MWI API
├── Extracts raw bid/ask prices
├── Updates price history (for age/direction)
└── Outputs prices.js (~50-100KB)

JavaScript (client)
├── Loads prices.js (market data)
├── Loads game-data.js (items, recipes, enhancement costs) - cached
├── Loads player config (localStorage or hardcoded default)
├── Runs Markov chain calculations ON DEMAND
└── Calculates profit/loss for enhance history
```

## New Data Format

### prices.js (~50-100KB)
```javascript
window.PRICES = {
  // Raw market prices - bid/ask for all items at all enhancement levels
  market: {
    "/items/furious_spear": {
      "0": { a: 280000000, b: 275000000 },
      "8": { a: 500000000, b: 480000000 },
      "10": { a: 800000000, b: 750000000 },
      "12": { a: 1600000000, b: 1500000000 },
      "14": { a: 3200000000, b: 3000000000 }
    },
    // ~500 items × 5 levels = ~2500 entries
  },
  
  // Price history for age/direction indicators
  history: {
    "/items/furious_spear:12": {
      price: 1500000000,
      since: 1770960618,
      dir: "up",
      prev: 1450000000
    },
    // Only tracked levels (0, 8, 10, 12, 14)
  },
  
  // Metadata
  ts: 1770991945,           // Market data timestamp
  generated: 1770992000,    // When this file was generated
  updateHistory: [...]      // Last 15 market updates
};
```

### game-data.js (~200-300KB minified)
Extracted subset of init_client_info.json:
```javascript
window.GAME_DATA = {
  // Items with enhancement costs
  items: {
    "/items/furious_spear": {
      name: "Furious Spear",
      level: 82,
      sellPrice: 12345,
      enhancementCosts: [
        { item: "/items/enchanted_essence", count: 18 },
        { item: "/items/holy_cheese", count: 8 },
        // ...
      ],
      protectionItems: ["/items/regal_jewel"],
      category: "/item_categories/equipment"
    },
    // ...
  },
  
  // Crafting recipes (for craft cost calculation)
  recipes: {
    "/items/furious_spear_refined": {
      inputs: [
        { item: "/items/enchanted_refinement_shard", count: 296 },
      ],
      upgrade: "/items/furious_spear"  // base item
    },
    // ...
  },
  
  // Gear stats for bonuses (enhancing speed, success, etc.)
  gearStats: {
    "/items/celestial_enhancer": { enhancingSuccess: 0.015 },
    "/items/enchanted_gloves": { enhancingSpeed: 0.005 },
    // ...
  },
  
  // Constants
  enhanceBonus: [1.0, 1.02, 1.042, ...],  // Level multipliers
  successRate: [50, 45, 45, 40, ...],     // Base success rates
};
```

### Player Config (localStorage or default)
```javascript
const DEFAULT_CONFIG = {
  enhancingLevel: 125,
  observatoryLevel: 8,
  gear: {
    enhancer: { item: "/items/celestial_enhancer", level: 14 },
    gloves: { item: "/items/enchanted_gloves", level: 10 },
    pouch: { item: "/items/guzzling_pouch", level: 8 },
    top: { item: "/items/enhancers_top", level: 8 },
    bottoms: { item: "/items/enhancers_bottoms", level: 8 },
    necklace: { item: "/items/philosophers_necklace", level: 7 },
    charm: { item: "/items/advanced_enhancing_charm", level: 6 },
  },
  teas: {
    enhancing: "ultra",  // none | basic | super | ultra
    blessed: true,
    wisdom: true,
    artisan: true,
  },
  buffs: {
    enhancing: 20,
    experience: 20,
  },
  achievementBonus: 0.2,
};
```

## JavaScript Calculator (enhance-calc.js)

Port of Python's `EnhancementCalculator` class:

```javascript
class EnhanceCalculator {
  constructor(gameData, config) {
    this.items = gameData.items;
    this.recipes = gameData.recipes;
    this.gearStats = gameData.gearStats;
    this.config = config;
  }
  
  // Core Markov chain calculation
  calculateEnhancementCost(itemHrid, targetLevel, prices, mode) {
    // ... port of Python _markov_enhance
  }
  
  // Get optimal protection level
  findOptimalProtection(itemHrid, targetLevel, prices, mode) {
    // ... iterate protection levels, find cheapest total cost
  }
  
  // Calculate profit for item
  calculateProfit(itemHrid, targetLevel, prices, mode) {
    // ... port of Python calculate_profit
  }
  
  // NEW: Calculate actual cost for a single enhance action
  // Used for enhance history tracking
  calculateActionCost(itemHrid, fromLevel, toLevel, protLevel, prices, mode) {
    // Materials cost × 1 attempt
    // + protection cost if fromLevel >= protLevel
    // Returns { matCost, protCost, totalCost }
  }
}
```

## Enhance History Tracking

### Loot Tracker Data Format
MWI loot tracker records last 20 actions:
```javascript
{
  action: "enhance",
  timestamp: 1770991234,
  itemHrid: "/items/furious_spear",
  fromLevel: 10,
  toLevel: 11,       // or 9 if failed
  success: true,
  // NOTE: Does NOT include protection/materials spent
}
```

### Calculating Actual Cost
Since loot tracker doesn't record prots spent, we must infer:
1. Get current prices at action timestamp (or closest snapshot)
2. Calculate optimal prot level given those prices
3. Assume player used optimal prot (reasonable assumption)
4. Calculate: `matCost + (protCost if level >= protLevel else 0)`

### Profit/Loss per Action
```javascript
function calculateEnhanceResult(action, prices) {
  const { itemHrid, fromLevel, toLevel, success } = action;
  
  // Get expected costs at optimal prot level
  const costs = calculator.calculateActionCost(
    itemHrid, fromLevel, toLevel,
    optimalProtLevel, prices, "pessimistic"
  );
  
  // Compare to market value change
  const valueBefore = getMarketValue(itemHrid, fromLevel, prices);
  const valueAfter = getMarketValue(itemHrid, toLevel, prices);
  const valueChange = valueAfter - valueBefore;
  
  return {
    cost: costs.totalCost,
    valueChange,
    profit: valueChange - costs.totalCost,
  };
}
```

## Migration Plan

### Phase 1: Data Extraction
1. Create `generate_prices.py` - outputs `prices.js` (just market data)
2. Create `extract_game_data.py` - outputs `game-data.js` (one-time, update on game patches)
3. Keep existing `generate_site.py` as fallback

### Phase 2: JavaScript Calculator
1. Port `enhance_calc.py` → `enhance-calc.js`
2. Create test harness to compare JS vs Python results
3. Ensure identical calculations for same inputs

### Phase 3: UI Integration
1. Update `index.html` to use JS calculator
2. Add price mode toggle that recalculates on-the-fly
3. Add gear config UI (optional, can stay hardcoded initially)

### Phase 4: Enhance History
1. Add loot tracker data import (userscript or paste)
2. Track price snapshots for historical calculations
3. Build enhance history view with profit/loss

## Verification Strategy

To ensure no regressions:

1. **Snapshot current output**
   - Save current `data.json` as `expected_output.json`
   
2. **Compare calculations**
   - For each item × level × mode:
     - Run Python calculator → expected
     - Run JS calculator → actual
     - Assert: `|actual - expected| < 0.01` (floating point tolerance)

3. **Visual diff**
   - Render both sites side-by-side
   - Screenshot comparison

## File Size Estimates

| File | Current | New |
|------|---------|-----|
| data.js | 2MB | - (removed) |
| prices.js | - | ~100KB |
| game-data.js | - | ~300KB |
| enhance-calc.js | - | ~20KB |
| **Total** | 2MB | ~420KB |

Plus: game-data.js only needs to load once (can be cached aggressively).

## Questions to Resolve

1. **Game data updates**: How often does `init_client_info.json` change? On each game patch? Should we version it?

2. **Price history granularity**: Currently tracking 5 levels (0,8,10,12,14). Do we need more for enhance history?

3. **Gear config storage**: localStorage vs URL params vs account system?

4. **Loot tracker integration**: Userscript injection vs manual paste vs companion extension?
