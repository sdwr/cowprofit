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
- **Price Age column:** Shows how long current sell price has lasted (proxy for market depth)
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
- **Profit bars:** Green bars show relative $/day vs top earner
- **Red bars:** For negative profit items
- **Sortable columns:** Click headers to sort

## How It Works

### Data Flow
```
MWI Market API → generate_site.py → index.html → GitHub Pages
     ↓
price_history.json (tracks price changes over time)
```

### Update Schedule
- **Cron:** Every 30 minutes via Fly.io Sprite
- Market data refreshes every ~20-30 min server-side
- Static HTML regenerated and pushed to GitHub Pages

### Math
Uses Markov chain calculation (same as [Enhancelator](https://doh-nuts.github.io/Enhancelator/)):
- Expected attempts to reach target level
- Material costs × attempts
- Base item cost + protection scrolls
- Compare total cost to market sell price

## Gear Assumptions (Hardcoded)

| Slot | Item | Level |
|------|------|-------|
| Tool | Celestial Enhancer | +14 |
| Gloves | Enchanted Gloves | +10 |
| Pouch | Guzzling Pouch | +8 |
| Top | Enhancer's Top | +8 |
| Bottoms | Enhancer's Bottoms | +8 |
| Necklace | Philosopher's Necklace | +7 |
| Charm | Advanced Enhancing Charm | +6 |
| Buffs | Enhancing + XP | Level 20 |
| Skill | Enhancing | Level 125 |

## Project Structure

```
cowprofit/
├── generate_site.py      # Main script: fetch data, calculate, generate HTML
├── enhance_calc.py       # Enhancement math (Markov chains, cost calculation)
├── price_history.json    # Tracks bid prices over time for age display
├── index.html            # Generated static site (2MB+)
├── data.json             # Cached market data snapshot
└── init_client_info.json # Game item/recipe data (from Enhancelator)
```

### Key Files

| File | Purpose |
|------|---------|
| `generate_site.py` | All-in-one: fetches market data, updates price history, calculates profits, generates HTML |
| `enhance_calc.py` | `EnhancementCalculator` class with Markov chain math |
| `price_history.json` | Tracks `{hrid}:{level}` → price, since timestamp, direction |

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run calculation (generates index.html)
python generate_site.py

# View locally
open index.html
```

## Deployment (Fly.io Sprite)

```bash
# SSH to sprite
sprite console -s mwi-tracker

# Manual run
cd /home/sprite/cowprofit
python3 generate_site.py

# Check cron
# Managed via Clawdbot cron tool: mwi-price-update
```

## Roadmap

### Planned: Inventory Import
- Import player inventory from game via MWITools userscript
- Show materials already owned vs need to buy
- Filter to affordable enhancements (2x cost buffer)

### Technical Notes
- MWITools hooks game WebSocket, stores data in Tampermonkey + TextDB
- `init_character_data` message contains full `characterItems` (inventory)
- Could add `?textdb=<key>` URL param like combat sim does

## Credits

- Math: [Enhancelator](https://doh-nuts.github.io/Enhancelator/) by dohnuts, MangoFlavor, guch8017, AyajiLin, Trafalet
- Market data: Milky Way Idle game API
- Price history idea: Track bid prices to estimate market depth
