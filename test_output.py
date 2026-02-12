#!/usr/bin/env python3
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('price_tracker.html', encoding='utf-8') as f:
    content = f.read()

# Find rows with arrows
arrow_rows = re.findall(r'<tr data-name="([^"]+)".*?<span class="arrow ([^"]*)">(.*?)</span>.*?</tr>', content, re.DOTALL)

print("Items with price change arrows:")
for name, cls, arrow in arrow_rows:
    if arrow.strip():
        print(f"  {name}: {arrow} ({cls})")

# Count items by duration category
fresh = content.count('class="duration fresh"')
stale = content.count('class="duration stale"')
normal = content.count('class="duration "')
print(f"\nDuration breakdown: {fresh} fresh, {normal} normal, {stale} stale")

# Check specific items
for item_name in ['abyssal essence', 'apple']:
    match = re.search(rf'<tr data-name="{item_name}".*?</tr>', content, re.DOTALL)
    if match:
        row = match.group()
        duration = re.search(r'class="duration[^"]*">([^<]+)', row)
        arrow = re.search(r'class="arrow[^"]*">([^<]*)', row)
        print(f"\n{item_name}:")
        print(f"  Duration: {duration.group(1) if duration else 'N/A'}")
        print(f"  Arrow: '{arrow.group(1).strip() if arrow else 'N/A'}'")
