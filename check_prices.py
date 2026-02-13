import requests
import json
d = requests.get("https://www.milkywayidle.com/game_data/marketplace.json").json()

from enhance_calc import EnhancementCalculator, PriceMode
calc = EnhancementCalculator()

result = calc.calculate_enhancement_cost("/items/furious_spear_refined", 12, d, PriceMode.PESSIMISTIC)
if result:
    print("=== CHECKING ALL PRICES ===")
    print()
    
    # Enhancement materials
    print("ENHANCEMENT MATERIALS (should use ASK/a for buying):")
    for m in result["materials"]:
        market = d["marketData"].get(m['hrid'], {}).get("0", {})
        correct = market.get('a', 'N/A')
        wrong = market.get('b', 'N/A')
        status = "✓" if m['price'] == correct else "✗ WRONG"
        print(f"  {m['name']}: shown={m['price']:,}, ask(a)={correct}, bid(b)={wrong} {status}")
    
    print()
    print("CRAFT MATERIALS (should use ASK/a for buying):")
    for m in result.get("craft_materials", []):
        market = d["marketData"].get(m['hrid'], {}).get("0", {})
        correct = market.get('a', 'N/A')
        wrong = market.get('b', 'N/A')
        status = "✓" if m['price'] == correct else "✗ WRONG" if wrong != 'N/A' and m['price'] == wrong else "?"
        print(f"  {m['name']}: shown={m['price']:,}, ask(a)={correct}, bid(b)={wrong} {status}")
    
    print()
    print("PROTECTION ITEM (should use ASK/a for buying):")
    market = d["marketData"].get(result['protect_hrid'], {}).get("0", {})
    correct = market.get('a', 'N/A')
    wrong = market.get('b', 'N/A')
    status = "✓" if result['protect_price'] == correct else "✗ WRONG"
    print(f"  {result['protect_name']}: shown={result['protect_price']:,}, ask(a)={correct}, bid(b)={wrong} {status}")
    
    print()
    print("BASE ITEM (should use ASK/a for buying):")
    market = d["marketData"].get('/items/furious_spear_refined', {}).get("0", {})
    correct = market.get('a', 'N/A')
    wrong = market.get('b', 'N/A')
    print(f"  Furious Spear R +0: shown={result['base_price']:,}, ask(a)={correct}, bid(b)={wrong}, source={result['base_source']}")
