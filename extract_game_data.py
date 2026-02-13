"""
Extract game data for client-side calculations.
Downloads from Enhancelator if no local file, extracts what JS needs.

Run manually when game patches or you notice missing items.
"""

import json
import requests
from pathlib import Path

ENHANCELATOR_URL = 'https://doh-nuts.github.io/Enhancelator/init_client_info.json'
LOCAL_FILE = Path(__file__).parent / 'init_client_info.json'
OUTPUT_FILE = Path(__file__).parent / 'game-data.js'

# Enhancement bonus multipliers for levels +0 to +20
ENHANCE_BONUS = [
    1.000, 1.020, 1.042, 1.066, 1.092,  # +0 to +4
    1.120, 1.150, 1.182, 1.216, 1.252,  # +5 to +9
    1.290, 1.334, 1.384, 1.440, 1.502,  # +10 to +14
    1.570, 1.644, 1.724, 1.810, 1.902,  # +15 to +19
    2.000  # +20
]

# Base success rates for levels +1 to +20
SUCCESS_RATE = [
    50, 45, 45, 40, 40, 40, 35, 35, 35, 35,  # +1 to +10
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30   # +11 to +20
]


def download_game_data():
    """Download fresh game data from Enhancelator."""
    print(f"Downloading from {ENHANCELATOR_URL}...")
    resp = requests.get(ENHANCELATOR_URL)
    resp.raise_for_status()
    
    with open(LOCAL_FILE, 'w', encoding='utf-8') as f:
        f.write(resp.text)
    
    print(f"Saved to {LOCAL_FILE}")
    return resp.json()


def load_game_data():
    """Load game data from local file or download if missing."""
    if LOCAL_FILE.exists():
        print(f"Loading from {LOCAL_FILE}...")
        with open(LOCAL_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    else:
        return download_game_data()


def extract_item_data(item_detail_map):
    """Extract item data needed for calculations."""
    items = {}
    
    for hrid, item in item_detail_map.items():
        # Skip items without enhancement costs (not enhanceable)
        enhancement_costs = item.get('enhancementCosts')
        
        extracted = {
            'name': item.get('name', hrid.split('/')[-1]),
            'level': item.get('itemLevel', 1),
            'sellPrice': item.get('sellPrice', 0),
            'category': item.get('categoryHrid', ''),
        }
        
        # Enhancement data (only for enhanceable items)
        if enhancement_costs:
            extracted['enhancementCosts'] = [
                {'item': c['itemHrid'], 'count': c['count']}
                for c in enhancement_costs
            ]
            extracted['protectionItems'] = item.get('protectionItemHrids', [])
        
        # Equipment stats (for gear bonuses)
        equip_detail = item.get('equipmentDetail', {})
        noncombat = equip_detail.get('noncombatStats', {})
        if noncombat:
            stats = {}
            for stat_name, value in noncombat.items():
                if value != 0:
                    stats[stat_name] = value
            if stats:
                extracted['stats'] = stats
        
        items[hrid] = extracted
    
    return items


def extract_recipes(action_detail_map, item_detail_map):
    """Extract crafting recipes for cost calculation."""
    recipes = {}
    
    for hrid, action in action_detail_map.items():
        # Only production actions
        if action.get('function') != '/action_functions/production':
            continue
        
        output_items = action.get('outputItems', [])
        if not output_items:
            continue
        
        output_hrid = output_items[0].get('itemHrid')
        if not output_hrid:
            continue
        
        # Only equipment and special items
        item = item_detail_map.get(output_hrid, {})
        category = item.get('categoryHrid', '')
        if category != '/item_categories/equipment' and output_hrid != '/items/philosophers_mirror':
            continue
        
        recipe = {
            'inputs': [
                {'item': inp['itemHrid'], 'count': inp['count']}
                for inp in action.get('inputItems', [])
            ]
        }
        
        upgrade_hrid = action.get('upgradeItemHrid')
        if upgrade_hrid:
            recipe['upgrade'] = upgrade_hrid
        
        recipes[output_hrid] = recipe
    
    return recipes


def main():
    data = load_game_data()
    
    game_version = data.get('gameVersion', 'unknown')
    print(f"Game version: {game_version}")
    
    item_detail_map = data.get('itemDetailMap', {})
    action_detail_map = data.get('actionDetailMap', {})
    
    print(f"Processing {len(item_detail_map)} items...")
    items = extract_item_data(item_detail_map)
    
    print(f"Processing {len(action_detail_map)} actions...")
    recipes = extract_recipes(action_detail_map, item_detail_map)
    
    # Count enhanceable items
    enhanceable = [h for h, i in items.items() if 'enhancementCosts' in i]
    print(f"Found {len(enhanceable)} enhanceable items")
    print(f"Found {len(recipes)} crafting recipes")
    
    # Build output
    output = {
        'version': game_version,
        'items': items,
        'recipes': recipes,
        'constants': {
            'enhanceBonus': ENHANCE_BONUS,
            'successRate': SUCCESS_RATE,
        }
    }
    
    # Write as JS
    json_content = json.dumps(output, separators=(',', ':'))  # Minified
    js_content = f"window.GAME_DATA_STATIC = {json_content};"
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(js_content)
    
    # Calculate size
    size_kb = len(js_content) / 1024
    print(f"Generated {OUTPUT_FILE} ({size_kb:.1f} KB)")


if __name__ == '__main__':
    main()
