# MWI Enhancement Profit Tracker

Automated enhancement profit calculator for [Milky Way Idle](https://www.milkywayidle.com/).

## Live Site

🌐 **https://sdwr.github.io/mwi-tracker/**

## How It Works

1. **Data Sources:**
   - Market prices: `https://www.milkywayidle.com/game_data/marketplace.json` (live)
   - Item data: Cached from Enhancelator's `init_client_info.json`

2. **Calculation:**
   - Uses Markov chain math (same as [Enhancelator](https://doh-nuts.github.io/Enhancelator/))
   - Calculates expected enhancement cost for each item
   - Compares to market sell price to find profit opportunities

3. **Update Schedule:**
   - Runs 4x daily via Fly.io Sprite cron
   - Static HTML pushed to GitHub Pages

## Gear Assumptions

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
| Skill | Enhancing | 125 |

## Target Enhancement Levels

- +8, +10, +12, +14

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run calculation
python generate_site.py

# View locally
open index.html
```

## Credits

- Math based on [Enhancelator](https://doh-nuts.github.io/Enhancelator/) by dohnuts, MangoFlavor, guch8017, AyajiLin, Trafalet
- Market data from Milky Way Idle game API
