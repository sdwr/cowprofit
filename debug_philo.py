import json

with open('data.json') as f:
    data = json.load(f)

# Find Philosopher's Ring
for item in data['modes']['pessimistic']:
    if "Philosopher" in item['item_name'] and "Ring" in item['item_name']:
        print(f"Item: {item['item_name']} +{item['target_level']}")
        print(f"Base source: {item['base_source']}")
        print(f"Base price: {item['base_price']:,.0f}")
        print()
        print("Craft materials:")
        for m in item.get('craft_materials', []):
            total = m['count'] * m['price']
            print(f"  {m['name']}: {m['count']:.2f}x @ {m['price']:,.0f} = {total:,.0f}")
        print()
        
        print("Enhancement materials per attempt:")
        for m in item.get('materials', []):
            print(f"  {m['name']}: {m['count']:.2f}x @ {m['price']:,.0f}")
        break
