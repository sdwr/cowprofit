import requests
from enhance_calc import EnhancementCalculator, PriceMode

calc = EnhancementCalculator()
resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
market = resp.json()

philo_hrid = '/items/philosophers_ring'

# Check what get_crafting_cost returns
craft_cost = calc.get_crafting_cost(philo_hrid, market, PriceMode.PESSIMISTIC)
print(f"Crafting cost (pessimistic): {craft_cost:,.0f}")

# Manual calculation
artisan = calc.get_artisan_tea_multiplier()
print(f"Artisan multiplier: {artisan:.4f} ({(1-artisan)*100:.2f}% reduction)")

rings = [
    ('/items/ring_of_critical_strike', 1),
    ('/items/ring_of_rare_find', 1),
    ('/items/ring_of_resistance', 1),
    ('/items/ring_of_armor', 1),
    ('/items/ring_of_regeneration', 1),
    ('/items/ring_of_essence_find', 1),
    ('/items/ring_of_gathering', 1),
]

total = 0
print("\nManual ring calculation (with artisan):")
for hrid, count in rings:
    name = calc.item_detail_map.get(hrid, {}).get('name', hrid)
    price = calc._get_buy_price(hrid, 0, market, PriceMode.PESSIMISTIC)
    reduced_count = count * artisan
    subtotal = reduced_count * price
    total += subtotal
    print(f"  {name}: {reduced_count:.4f} x {price:,} = {subtotal:,.0f}")

# Philosopher's Stone (upgrade item - NOT reduced by artisan)
stone_price = calc._get_buy_price('/items/philosophers_stone', 0, market, PriceMode.PESSIMISTIC)
print(f"\nPhilosopher's Stone (base item, no artisan): {stone_price:,}")
total += stone_price

print(f"\nTotal: {total:,.0f}")
print(f"Calculated by get_crafting_cost: {craft_cost:,.0f}")
print(f"Match: {abs(total - craft_cost) < 1}")
