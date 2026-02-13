# CowProfit Roadmap

## Implemented (2026-02-12/13)

### Core Features
- [x] Enhancement profit calculator using Markov chain math
- [x] Three price modes: pessimistic, midpoint, optimistic
- [x] Price age tracking with direction arrows (↑↓)
- [x] Profit bars (green/red visual indicator)
- [x] Cost filters (<100M, 100-500M, etc.)
- [x] Level filters (+8, +10, +12, +14)
- [x] Super pessimistic mode (-Mat Loss toggle)
- [x] 2% market fee toggle
- [x] Gear dropdown showing player stats
- [x] Market update history dropdown
- [x] Expandable detail rows with full cost breakdown

### Architecture (2026-02-13)
- [x] Refactored from monolithic HTML to separate files:
  - `index.html` - static template (21KB)
  - `main.js` - rendering/interactivity (27KB)
  - `data.js` - generated data (~2MB)
- [x] Python generates only `data.js`, not full HTML
- [x] Cron job updates prices every 30 min

### Inventory Integration (2026-02-13)
- [x] Tampermonkey userscript (`cowprofit-inventory.user.js`)
- [x] Captures inventory from MWI WebSocket
- [x] Bridges data to CowProfit via GM_setValue/CustomEvent
- [x] Material % bar in item column
- [x] Shopping list in detail panel (Owned/Need/Cost)
- [x] Works with or without inventory synced

---

## Planned: Client-Side Calculation

### Goal
Move all profit calculations to browser JavaScript, enabling:
- Per-user gear configuration
- Massive data.js reduction (~2MB → ~150KB)
- No Python needed for gear changes
- Faster iteration on UI changes

### Data Architecture

**Current (Server-Side):**
```
marketplace.json → Python (calc all items) → data.js (2MB pre-computed)
                                                ↓
                                        Browser renders
```

**Proposed (Client-Side):**
```
marketplace.json → Python (extract prices) → prices.js (~150KB raw prices)
                                                ↓
                                    Browser calculates on load
                                                ↓
                                        Render results
```

### prices.js Structure
```javascript
window.MARKET_DATA = {
  timestamp: 1234567890,
  lastCheckTs: 1234567890,
  updateHistory: [...],
  
  // Raw bid/ask for enhanced items
  prices: {
    "/items/furious_spear": {
      "0": { a: 275000000, b: 270000000 },
      "8": { a: 500000000, b: 490000000 },
      "10": { a: 800000000, b: 780000000 },
      "12": { a: 2950000000, b: 2900000000 },
      "14": { a: null, b: null }
    },
    // ... all enhanceable items
  },
  
  // Material prices (for enhancement costs)
  materials: {
    "/items/enchanted_essence": { a: 1600, b: 1550 },
    "/items/holy_cheese": { a: 4000, b: 3900 },
    // ... all enhancement materials
  },
  
  // Price history for age tracking
  history: {
    "/items/furious_spear:12": {
      price: 2950000000,
      since: 1234567890,
      direction: "up",
      lastPrice: 2900000000
    }
  }
};
```

### JavaScript Calculator (enhance-calc.js)

Port from Python:
1. **Markov chain math** - matrix inversion for expected attempts
2. **Success rate calculation** - level bonuses, tool bonuses
3. **Time calculation** - speed bonuses from gear
4. **XP calculation** - wisdom tea, gear bonuses
5. **Protection optimization** - find cheapest protection level
6. **Crafting cost** - recursive material pricing

Key functions to port:
- `_markov_enhance()` - core matrix math (~50 lines)
- `get_total_bonus()` - success rate multiplier
- `get_attempt_time()` - time per attempt
- `get_crafting_cost()` - recursive craft pricing
- `calculate_profit()` - orchestrates everything

### Gear Settings UI

Add collapsible settings panel:
```
┌─ Your Gear ─────────────────────────────┐
│ Enhancing Level: [125]                  │
│ Observatory:     [8]                    │
│                                         │
│ Tool: [Celestial Enhancer ▼] +[14]     │
│                                         │
│ Gloves +[10]  Top +[8]  Bot +[8]       │
│ Necklace +[7]  Charm: [Advanced ▼] +[6]│
│                                         │
│ Teas: [x] Ultra Enhancing              │
│       [x] Blessed  [x] Wisdom          │
│       [x] Artisan                       │
│                                         │
│ [Save to LocalStorage]                  │
└─────────────────────────────────────────┘
```

### Performance Estimate
- 518 items × 4 levels = 2072 calculations
- Each: 15×15 matrix inversion + 8-12 protection iterations
- Target: <500ms total on modern browser
- Can lazy-calculate (only visible rows) if needed

### Static Data Required
- `init_client_info.json` (4MB) - item details, enhancement costs
  - Could extract only needed fields (~500KB)
  - Or fetch from MWI CDN at runtime

### Migration Steps

1. **Benchmark** - Test JS calculation speed (this file: `benchmark-calc.html`)
2. **Port calculator** - `enhance-calc.js` with same math as Python
3. **Create prices.js generator** - Slim Python script
4. **Add gear UI** - Settings panel with localStorage
5. **Update main.js** - Use new calculator instead of pre-computed data
6. **Keep Python fallback** - For users who want pre-computed

### Files to Create
- [ ] `enhance-calc.js` - Ported calculator
- [ ] `gear-settings.js` - Gear UI component
- [ ] `generate_prices.py` - Slim price extractor
- [ ] `benchmark-calc.html` - Performance test

---

## Other Ideas (Low Priority)

### Data Optimization
- Deduplicate shared fields across modes (50% size reduction)
- Compress with gzip (browser handles automatically)
- Use shorter keys in JSON

### Repo Management
- Add `git gc --aggressive` to cron
- Squash old price-update commits periodically
- Or use separate branch for data history

### Features
- Filter by item type (weapons, armor, tools)
- Search by item name
- Bookmark/favorite items
- Price alerts (notify when item becomes profitable)
- Historical profit charts
