import json
import requests
from enhance_calc import EnhancementCalculator, PriceMode

with open('init_client_info.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Check trainee charm vendor price
trainee = data['itemDetailMap'].get('/items/trainee_melee_charm', {})
print("Trainee Melee Charm vendor info:")
print(f"  sellPrice: {trainee.get('sellPrice')}")
print(f"  buyPrice: {trainee.get('buyPrice')}")
print()

# Find enhancement costs for Grandmaster Melee Charm
item = data['itemDetailMap'].get('/items/grandmaster_melee_charm', {})
print('Grandmaster Melee Charm enhancement costs:')
for cost in item.get('enhancementCosts', []):
    hrid = cost['itemHrid']
    count = cost['count']
    mat_item = data['itemDetailMap'].get(hrid, {})
    print(f"  {count}x {mat_item.get('name', hrid)}")

# Get market data
resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
market_data = resp.json()

# Check material prices
calc = EnhancementCalculator()
print("\nMaterial prices (pessimistic):")
for cost in item.get('enhancementCosts', []):
    hrid = cost['itemHrid']
    count = cost['count']
    price = calc.get_item_price(hrid, 0, market_data, PriceMode.PESSIMISTIC)
    craft_cost = calc.get_crafting_cost(hrid, market_data, PriceMode.PESSIMISTIC)
    raw = calc._get_raw_market_price(hrid, 0, market_data, PriceMode.PESSIMISTIC)
    mat_item = data['itemDetailMap'].get(hrid, {})
    print(f"  {mat_item.get('name', hrid)}: raw={raw:,.0f}, craft={craft_cost:,.0f}, final={price:,.0f}")

# Check what Enhancelator uses
print("\nMarket data for Master Melee Charm:")
market = market_data['marketData'].get('/items/master_melee_charm', {})
print(f"  {market}")

print("\nCalculate enhancement cost:")
result = calc.calculate_enhancement_cost('/items/grandmaster_melee_charm', 10, market_data, PriceMode.PESSIMISTIC)
if result:
    print(f"  Actions: {result['actions']:,.0f}")
    print(f"  Mat cost: {result['mat_cost']:,.0f}")
    print(f"  Base price: {result['base_price']:,.0f}")
    print(f"  Total cost: {result['total_cost']:,.0f}")
