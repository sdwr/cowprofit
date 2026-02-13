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

## Deployment (Fly.io Sprite + GitHub Actions)

### Automatic Updates
- **GitHub Actions** runs every 30 minutes (`.github/workflows/update.yml`)
- Wakes the Sprite, pulls latest code, runs `generate_site.py`, pushes to GitHub Pages
- Requires `SPRITE_TOKEN` secret in repo settings

### Manual Run
```bash
# SSH to sprite
sprite console -s mwi-tracker

# Manual run
cd /home/sprite/cowprofit
python3 generate_site.py
```

### Setup (if cloning)
1. Create a Fly.io Sprite: `sprite create mwi-tracker`
2. Get org token from https://fly.io/dashboard → Tokens
3. Add `SPRITE_TOKEN` secret to GitHub repo settings
4. Push to trigger first run

### Troubleshooting

**GitHub Actions failing at "Auth and Run Update":**
- Check `SPRITE_TOKEN` secret is set and valid
- Token may have expired — generate new one at Fly.io dashboard

**Sprite exec hangs or returns no output:**
- Use `bash -c "..."` wrapper for complex commands
- Direct `python3 /path/to/script.py` may fail on module imports
- ✅ Works: `sprite exec -s mwi-tracker -- bash -c "cd /home/sprite/cowprofit && python3 generate_site.py"`
- ❌ Fails: `sprite exec -s mwi-tracker -- python3 /home/sprite/cowprofit/generate_site.py`

**Module not found (requests, etc):**
- Sprite uses pyenv — pip3 installs to correct location
- But running python directly without bash may use different PATH
- Always use `bash -c "cd /path && python3 script.py"` pattern

**v2 site (client-side calcs):**
- Branch: `client-side-calcs`
- Uses `prices.js` + `game-data.js` instead of server-side calculation
- Cron job updates `prices.js` every 30 min via separate workflow

## Roadmap

### Planned: Inventory Import
- Import player inventory from game via companion userscript
- Show materials already owned vs need to buy
- Material % bar on each item (value-weighted % of mats owned)
- Filter to affordable enhancements (2x cost buffer)
- Shopping list with owned/total/need-to-buy counts

### Technical: Userscript Data Bridge

The companion userscript uses **Tampermonkey's cross-site storage** (`GM_setValue`/`GM_getValue`) to bridge data between the game and CowProfit:

1. Script runs on `milkywayidle.com`, hooks WebSocket
2. Captures `init_character_data` message (contains `characterItems` inventory + `gameCoins`)
3. Stores data via `GM_setValue('cowprofit_inventory', data)`
4. Same script also runs on `sdwr.github.io/cowprofit/*`
5. On CowProfit, reads via `GM_getValue('cowprofit_inventory')` and injects into page

This works because Tampermonkey storage belongs to the **extension**, not the websites — it acts as a secure bridge between domains without needing external services like TextDB.

**Note:** TextDB (textdb.online) is used by some MWI tools for shareable links, but local-only import is simpler and doesn't depend on external services.

## Credits

- Math: [Enhancelator](https://doh-nuts.github.io/Enhancelator/) by dohnuts, MangoFlavor, guch8017, AyajiLin, Trafalet
- Market data: Milky Way Idle game API
- Price history idea: Track bid prices to estimate market depth
