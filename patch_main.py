#!/usr/bin/env python3
"""Patch linksite main.py to add price tracker route."""

import re

MAIN_PY = '/home/sprite/linksite/main.py'

# Read current content
with open(MAIN_PY, 'r', encoding='utf-8') as f:
    content = f.read()

# Check if already patched
if '/prices' in content:
    print("Already patched!")
    exit(0)

# Add import for Path if not present
if 'from pathlib import Path' not in content:
    content = content.replace(
        'from datetime import datetime',
        'from datetime import datetime\nfrom pathlib import Path'
    )

# Add route before main block
route_code = '''

# ============================================================
# MWI Price Tracker Route
# ============================================================

@app.get("/prices", response_class=HTMLResponse)
async def mwi_prices():
    """Serve the MWI Price Tracker HTML."""
    price_html = Path("/home/sprite/mwi-tracker/price_tracker.html")
    if price_html.exists():
        return HTMLResponse(content=price_html.read_text(encoding='utf-8'))
    return HTMLResponse(content="<h1>Price tracker not available</h1>", status_code=503)

'''

# Insert before main block
content = content.replace(
    '# ============================================================\n# Main\n# ============================================================',
    route_code + '# ============================================================\n# Main\n# ============================================================'
)

# Write back
with open(MAIN_PY, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched successfully!")
