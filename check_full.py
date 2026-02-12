from enhance_calc import EnhancementCalculator, PriceMode
import requests

calc = EnhancementCalculator()
resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
market = resp.json()

result = calc.calculate_profit('/items/philosophers_ring', 8, market, PriceMode.PESSIMISTIC)

print("=== Philosopher's Ring +8 Full Breakdown ===\n")
print(f"Base price: {result['base_price']:,.0f} ({result['base_source']})")
print(f"Mat cost: {result['mat_cost']:,.0f}")
print(f"Total cost: {result['total_cost']:,.0f}")
print(f"Actions: {result['actions']:.0f}")
print(f"Protect at: +{result['protect_at']}")
print(f"Protect uses: {result['protect_count']:.1f}")
print(f"Protect item: {result['protect_name']} @ {result['protect_price']:,.0f}")

# Break down mat_cost
print("\n=== Mat Cost Breakdown ===")
enhance_mult = calc.get_enhance_mat_multiplier()
star_price = calc._get_buy_price('/items/star_fragment', 0, market, PriceMode.PESSIMISTIC)
crushed_price = calc._get_buy_price('/items/crushed_philosophers_stone', 0, market, PriceMode.PESSIMISTIC)

star_count = 300 * enhance_mult
crushed_count = 1 * enhance_mult
coin_cost = 3115

per_attempt = star_count * star_price + crushed_count * crushed_price + coin_cost
print(f"Per attempt: {per_attempt:,.0f}")
print(f"  Star Fragment: {star_count:.2f} x {star_price:,} = {star_count * star_price:,.0f}")
print(f"  Crushed Stone: {crushed_count:.4f} x {crushed_price:,} = {crushed_count * crushed_price:,.0f}")
print(f"  Coins: {coin_cost:,}")

total_mat_no_protect = per_attempt * result['actions']
protect_cost = result['protect_price'] * result['protect_count']
print(f"\nMaterials ({result['actions']:.0f} attempts): {total_mat_no_protect:,.0f}")
print(f"Protection ({result['protect_count']:.1f} uses): {protect_cost:,.0f}")
print(f"Total mat_cost: {total_mat_no_protect + protect_cost:,.0f}")
print(f"Actual mat_cost from result: {result['mat_cost']:,.0f}")

# Check mirror price
mirror_price = calc._get_buy_price('/items/mirror_of_protection', 0, market, PriceMode.PESSIMISTIC)
philo_ring_price = calc._get_buy_price('/items/philosophers_ring', 0, market, PriceMode.PESSIMISTIC)
print(f"\n=== Protection Options ===")
print(f"Mirror of Protection: {mirror_price:,.0f}")
print(f"Philosopher's Ring +0: {philo_ring_price:,.0f}")

# Compare with Enhancelator numbers
print("\n=== Enhancelator Comparison ===")
print("From user's data (appears to be protect level options for +8):")
print("  Protect at 2: 154 actions, mat ~1,536M, total ~2,207M")
print("  Protect at 3: 181 actions, mat ~1,537M, total ~2,207M")
print(f"\nOurs: protect at {result['protect_at']}: {result['actions']:.0f} actions, mat {result['mat_cost']/1e6:.0f}M, total {result['total_cost']/1e6:.0f}M")
