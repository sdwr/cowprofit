import requests
from enhance_calc import EnhancementCalculator, PriceMode

calc = EnhancementCalculator()
resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
market = resp.json()

items_to_check = [
    '/items/star_fragment',
    '/items/crushed_philosophers_stone',
    '/items/ring_of_critical_strike',
    '/items/philosophers_stone',
]

print("=== Market Prices vs Our Prices ===\n")
for hrid in items_to_check:
    name = calc.item_detail_map.get(hrid, {}).get('name', hrid)
    m = market.get('marketData', {}).get(hrid, {}).get('0', {})
    ask = m.get('a', -1)
    bid = m.get('b', -1)
    
    our_pessimistic = calc._get_buy_price(hrid, 0, market, PriceMode.PESSIMISTIC)
    our_midpoint = calc._get_buy_price(hrid, 0, market, PriceMode.MIDPOINT)
    
    print(f"{name}")
    print(f"  Market: Ask={ask:,} Bid={bid:,}")
    print(f"  Ours:   Pessimistic={our_pessimistic:,} Midpoint={our_midpoint:,}")
    print()

# Now check what mode _get_crafting_materials is actually using
print("=== Checking _get_crafting_materials mode ===\n")

# The issue: _get_crafting_materials uses mode param, but what's passed?
# Let's trace through calculate_enhancement_cost for philo ring

philo_hrid = '/items/philosophers_ring'
result = calc.calculate_enhancement_cost(philo_hrid, 8, market, PriceMode.PESSIMISTIC)
print("Craft materials from calculate_enhancement_cost:")
for m in result.get('craft_materials', []):
    print(f"  {m['name']}: {m['price']:,}")
