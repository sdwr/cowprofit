"""
Extract test cases from current Python calculations for JS verification.
Run this to generate test-cases.json that the JS calculator can compare against.
"""

import json
import requests
from enhance_calc import EnhancementCalculator, PriceMode

OUTPUT_FILE = 'test-cases.json'

# Sample items across different categories and price ranges
TEST_ITEMS = [
    ('/items/furious_spear_refined', [10, 12]),
    ('/items/furious_spear', [10, 12]),
    ('/items/sundering_crossbow_refined', [10, 12]),
    ('/items/sundering_crossbow', [10, 12]),
    ('/items/acrobatic_hood', [8, 10, 12]),
    ('/items/kraken_tunic_refined', [10, 12]),
    ('/items/rippling_trident_refined', [10, 12]),
    ('/items/celestial_enhancer', [10, 12, 14]),
    ('/items/enchanted_gloves', [8, 10]),
    ('/items/guzzling_pouch', [8, 10]),
    ('/items/mirror_of_protection', [8, 10]),  # Check if this works
]


def main():
    print("Fetching market data...")
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    market_ts = market_data.get('timestamp', 0)
    
    print("Loading calculator...")
    calc = EnhancementCalculator('init_client_info.json')
    
    test_cases = {
        'marketTimestamp': market_ts,
        'gameVersion': calc.game_version,
        'playerConfig': {
            'enhancing_level': 125,
            'observatory_level': 8,
            'guzzling_bonus': calc.get_guzzling_bonus(),
            'enhancer_bonus': calc.get_enhancer_bonus(),
            'effective_level': calc.get_effective_level(),
            'artisan_multiplier': calc.get_artisan_tea_multiplier(),
        },
        'cases': []
    }
    
    for item_hrid, target_levels in TEST_ITEMS:
        item = calc.item_detail_map.get(item_hrid)
        if not item:
            print(f"  Skipping {item_hrid} - not found")
            continue
        
        for target_level in target_levels:
            for mode in [PriceMode.PESSIMISTIC, PriceMode.MIDPOINT, PriceMode.OPTIMISTIC]:
                result = calc.calculate_profit(item_hrid, target_level, market_data, mode)
                
                if not result:
                    print(f"  Skipping {item_hrid} +{target_level} {mode.value} - no result")
                    continue
                
                # Store key values for comparison
                case = {
                    'item_hrid': item_hrid,
                    'target_level': target_level,
                    'mode': mode.value,
                    
                    # Core calculated values
                    'actions': result['actions'],
                    'protect_count': result['protect_count'],
                    'protect_at': result['protect_at'],
                    'mat_cost': result['mat_cost'],
                    'total_cost': result['total_cost'],
                    'time_hours': result['time_hours'],
                    'total_xp': result['total_xp'],
                    
                    # Price inputs (for debugging)
                    'base_price': result['base_price'],
                    'base_source': result['base_source'],
                    'sell_price': result['sell_price'],
                    'protect_price': result['protect_price'],
                    
                    # Profit outputs
                    'profit': result['profit'],
                    'profit_after_fee': result['profit_after_fee'],
                    'roi': result['roi'],
                }
                
                test_cases['cases'].append(case)
                print(f"  {item_hrid.split('/')[-1]} +{target_level} {mode.value}: actions={result['actions']:.2f}")
    
    print(f"\nGenerated {len(test_cases['cases'])} test cases")
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(test_cases, f, indent=2)
    
    print(f"Saved to {OUTPUT_FILE}")


if __name__ == '__main__':
    main()
