import requests
import json
d = requests.get("https://www.milkywayidle.com/game_data/marketplace.json").json()

from enhance_calc import EnhancementCalculator, PriceMode
calc = EnhancementCalculator()

# Check the raw enhancement costs for an item
item = calc.item_detail_map.get('/items/furious_spear_refined', {})
print("Enhancement costs (raw from game data):")
for cost in item.get('enhancementCosts', []):
    hrid = cost['itemHrid']
    count = cost['count']
    market = d["marketData"].get(hrid, {}).get("0", {})
    print(f"  {hrid}: count={count}, market a={market.get('a', 'N/A')}, b={market.get('b', 'N/A')}")

print()
result = calc.calculate_enhancement_cost("/items/furious_spear_refined", 12, d, PriceMode.PESSIMISTIC)
if result:
    print("Materials in result (should be enhancement mats):")
    for m in result["materials"]:
        print(f"  {m['name']} ({m['hrid']}): price={m['price']:,.0f}")
    
    print()
    print("Craft materials (for base item):")
    for m in result.get("craft_materials", []):
        print(f"  {m['name']}: price={m['price']:,.0f}")
    
    print()
    print(f"Base item: {result['base_price']:,.0f} ({result['base_source']})")
