# CowProfit - MWI Enhancement Profit Calculator

Find the most profitable item enhancements in [Milky Way Idle](https://www.milkywayidle.com/).

## 🌐 Live Site

**https://sdwr.github.io/cowprofit/**

## Features

### Profit Calculation
- **Three pricing modes:** Pessimistic (bid), Midpoint, Optimistic (ask)
- **ROI-based ranking:** Profit per day normalized by investment
- **Super Pessimistic toggle:** Includes 11.8% loss on leftover materials
- **Market fee toggle:** 2% fee on/off for comparison

### Price Tracking
- **Price Age column:** How long the current sell price has lasted (proxy for market depth)
- **Direction arrows:** ↑↓ show last price movement
- **Market update history:** Click header to see last 15 market updates

### Filtering
- **Level filters:** +8, +10, +12, +14
- **Cost filters:** <100M, 100-500M, 500M-1B, 1-2B, >2B
- **Search:** Filter by item name

### Detail View
Click any item to expand:
- Base item source and price
- Material costs breakdown (per-attempt × expected attempts)
- Enhancement time and XP
- Price change history

### Visual Indicators
- **Profit bars:** Green/red bars showing relative $/day
- **Sortable columns:** Click headers to sort

## Architecture

All calculations run client-side in the browser. The only server-side component is a cron job that fetches market prices.

### Files
```
index.html          — Main site
main.js             — UI rendering and state management
enhance-calc.js     — Markov chain enhancement calculations (runs in browser)
game-data.js        — Static item/recipe data
prices.js           — Market prices + 7-day history (auto-updated by cron)
generate_prices.py  — Fetches market data, updates prices.js
```

### Data Flow
```
                    ┌─────────────────────────────────────────┐
                    │            Cron (every 30 min)          │
                    │                                         │
  MWI Market API ──→ generate_prices.py                      │
                    │   1. Read prices.js (previous history)  │
  prices.js ───────→   2. Diff market vs previous prices     │
  (from git pull)   │   3. Record changes, prune >7 days     │
                    │   4. Write new prices.js                │
                    │   5. git commit + push                  │
                    └─────────────────────────────────────────┘
                                       │
                                       ▼
                              GitHub Pages deploys
                                       │
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │              Browser                    │
                    │                                         │
                    │  prices.js + game-data.js               │
                    │       ↓                                 │
                    │  enhance-calc.js computes profits       │
                    │       ↓                                 │
                    │  main.js renders UI                     │
                    └─────────────────────────────────────────┘
```

### prices.js Format
```js
window.PRICES = {
  market: {                     // Current bid/ask prices
    "/items/abyssal_essence": {
      "0": { a: 235, b: 230 }
    }
  },
  history: {                    // 7-day rolling price change log
    "/items/abyssal_essence:0": {
      b: [{ p: 230, t: 1772166311 }, ...],  // bid changes, newest first
      a: [{ p: 235, t: 1772166311 }, ...]   // ask changes, newest first
    }
  },
  ts: 1772166311,               // Market data timestamp
  generated: 1772169981         // When prices.js was generated
};
```

History is self-contained in `prices.js` — no separate state files needed. A fresh `git clone` has everything required to run the next update.

### Update Schedule
- **Cron:** Every 30 minutes via Clawdbot + Fly.io Sprite
- Runs `generate_prices.py` on the sprite, commits and pushes to GitHub
- GitHub Pages auto-deploys on push

## Gear Assumptions (Hardcoded)

| Slot | Item | Level | Bonus |
|------|------|-------|-------|
| Tool | Celestial Enhancer | +14 | Success rate |
| Gloves | Enchanted Gloves | +10 | Speed |
| Pouch | Guzzling Pouch | +8 | Tea effectiveness |
| Top | Enhancer's Top | +8 | Speed |
| Bottoms | Enhancer's Bottoms | +8 | Speed |
| Necklace | Philosopher's Necklace | +7 | Speed (5x scaling) |
| Charm | Advanced Enhancing Charm | +6 | Speed |
| House | Observatory | 8 | +8% speed, +0.4% success |
| Buffs | Enhancing + XP | Level 20 | +29.5% speed |
| Skill | Enhancing | Level 125 | Base level |
| Teas | Ultra Enhancing, Blessed, Wisdom | — | +8 levels, double success, XP |

## Enhancement Math

Uses Markov chain calculation (same as [Enhancelator](https://doh-nuts.github.io/Enhancelator/)):
- Expected attempts to reach target level
- Material costs × attempts
- Base item cost + protection scrolls
- Compare total cost to market sell price

## Local Development

```bash
pip install requests
python generate_prices.py    # Fetches prices, writes prices.js
open index.html              # View site locally
```

## Credits

- Math: [Enhancelator](https://doh-nuts.github.io/Enhancelator/) by dohnuts, MangoFlavor, guch8017, AyajiLin, Trafalet
- Market data: Milky Way Idle game API
