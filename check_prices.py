import requests
d = requests.get("https://www.milkywayidle.com/game_data/marketplace.json").json()

mats = ["/items/glass", "/items/mirror_shard", "/items/glowing_shard", "/items/glittering_shard"]
print("Market data (a=ask/buy, b=bid/sell):")
for m in mats:
    data = d["marketData"].get(m, {}).get("0", {})
    a_val = data.get("a", "N/A")
    b_val = data.get("b", "N/A")
    print(f"  {m.split('/')[-1]}: a={a_val}, b={b_val}")

print()
print("Calculator prices (pessimistic mode):")
from enhance_calc import EnhancementCalculator, PriceMode
calc = EnhancementCalculator()
result = calc.calculate_enhancement_cost("/items/furious_spear_refined", 12, d, PriceMode.PESSIMISTIC)
if result:
    for m in result["materials"]:
        print(f"  {m['name']}: {m['price']:,.0f}")
    print(f"\nBase item price: {result['base_price']:,.0f} ({result['base_source']})")
    print(f"Sell price: {result.get('sell_price', 'N/A')}")
