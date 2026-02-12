import json

with open('init_client_info.json', encoding='utf-8') as f:
    data = json.load(f)

# Find enhancing charm items
print("=== Enhancing Charms ===")
for hrid, item in data['itemDetailMap'].items():
    if 'charm' in hrid.lower() and 'enhancing' in hrid.lower():
        print(f'{hrid}')
        print(f'  Name: {item.get("name")}')
        equip = item.get('equipmentDetail', {})
        noncombat = equip.get('noncombatStats', {})
        print(f'  Stats: {noncombat}')
        print()

# Also check what Enhancelator config would look like
print("\n=== Debug time calculation ===")
from enhance_calc import EnhancementCalculator, USER_CONFIG, ENHANCE_BONUS

calc = EnhancementCalculator()

# Check for Cursed Bow R
item = data['itemDetailMap'].get('/items/cursed_bow_refined', {})
item_level = item.get('itemLevel', 1)
print(f"Cursed Bow R item level: {item_level}")

# Check attempt time
attempt_time = calc.get_attempt_time(item_level)
print(f"Attempt time: {attempt_time:.4f} sec")

# Calculate what 10k actions would take
actions = 10014
hours = actions * attempt_time / 3600
print(f"{actions} actions = {hours:.2f} hours = {hours/24:.2f} days")

# What would 22.5 hours require?
target_hours = 22.5
required_time = target_hours * 3600 / actions
print(f"\nTo get 22.5 hours with {actions} actions:")
print(f"  Need {required_time:.4f} sec/action")
print(f"  Current: {attempt_time:.4f} sec/action")
print(f"  Ratio: {required_time/attempt_time:.2f}x slower expected")
