from enhance_calc import EnhancementCalculator, PriceMode, USER_CONFIG
import requests

calc = EnhancementCalculator()
resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
market = resp.json()

# Check Philosopher's Ring enhancement materials
philo = calc.item_detail_map.get('/items/philosophers_ring', {})
print('Enhancement costs (raw from game):')
for cost in philo.get('enhancementCosts', []):
    name = calc.item_detail_map.get(cost['itemHrid'], {}).get('name', cost['itemHrid'])
    print(f"  {name}: {cost['count']}")

artisan = calc.get_artisan_tea_multiplier()
enhance_mult = calc.get_enhance_mat_multiplier()
print(f'\nArtisan tea mult: {artisan:.4f} ({(1-artisan)*100:.2f}% reduction) - CRAFT ONLY')
print(f'Achievement mult: {enhance_mult:.4f} ({(1-enhance_mult)*100:.2f}% reduction) - ENHANCE MATS')

# What our fixed calculation gives
result = calc.calculate_enhancement_cost('/items/philosophers_ring', 8, market, PriceMode.PESSIMISTIC)
print(f"\nFixed mat_cost for +8: {result['mat_cost']:,.0f}")
print(f"Actions: {result['actions']:.0f}")

# Verify per-attempt cost
print("\nMaterials in result (should show 0.2% reduction):")
for m in result['materials']:
    print(f"  {m['name']}: {m['count']:.2f}x @ {m['price']:,}")

# Calculate expected
star_frag_price = calc._get_buy_price('/items/star_fragment', 0, market, PriceMode.PESSIMISTIC)
crushed_price = calc._get_buy_price('/items/crushed_philosophers_stone', 0, market, PriceMode.PESSIMISTIC)
coin_cost = 3115

# With 0.2% achievement reduction
star_count = 300 * enhance_mult
crushed_count = 1 * enhance_mult

per_attempt = star_count * star_frag_price + crushed_count * crushed_price + coin_cost
print(f"\nExpected per-attempt cost (0.2% achieve):")
print(f"  Star Fragment: {star_count:.2f} x {star_frag_price:,} = {star_count * star_frag_price:,.0f}")
print(f"  Crushed Stone: {crushed_count:.4f} x {crushed_price:,} = {crushed_count * crushed_price:,.0f}")
print(f"  Coins: {coin_cost:,}")
print(f"  Total: {per_attempt:,.0f}")

# Compare with Enhancelator
print("\n=== Comparison with Enhancelator ===")
print("Enhancelator +8 mat cost (from your message): ~1,536,177,826")
print(f"Our +8 mat cost: {result['mat_cost']:,.0f}")
