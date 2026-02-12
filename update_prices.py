#!/usr/bin/env python3
"""
Standalone script to update MWI price history and regenerate HTML.
Run this via cron every 30 minutes.
"""

import json
import requests
from datetime import datetime
from pathlib import Path

PRICE_HISTORY_FILE = Path(__file__).parent / 'price_history.json'
HTML_FILE = Path(__file__).parent / 'price_tracker.html'
MARKET_URL = 'https://www.milkywayidle.com/game_data/marketplace.json'

def load_price_history():
    if PRICE_HISTORY_FILE.exists():
        with open(PRICE_HISTORY_FILE, encoding='utf-8') as f:
            return json.load(f)
    return {'last_check': None, 'last_market_timestamp': None, 'items': {}}

def save_price_history(data):
    with open(PRICE_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f)

def format_duration(seconds):
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        return f"{int(seconds / 60)}m"
    elif seconds < 86400:
        return f"{seconds / 3600:.1f}h"
    else:
        return f"{seconds / 86400:.1f}d"

def update_prices():
    history = load_price_history()
    
    resp = requests.get(MARKET_URL, timeout=30)
    resp.raise_for_status()
    market = resp.json()
    
    market_ts = market.get('timestamp', 0)
    now = datetime.now()
    now_iso = now.isoformat()
    now_ts = int(now.timestamp())
    
    is_new_data = market_ts != history.get('last_market_timestamp')
    
    history['last_check'] = now_iso
    history['last_check_ts'] = now_ts
    history['last_market_timestamp'] = market_ts
    history['last_market_time'] = datetime.fromtimestamp(market_ts).isoformat()
    
    changes = []
    
    for item_hrid, levels in market.get('marketData', {}).items():
        if '0' not in levels:
            continue
        ask = levels['0'].get('a', -1)
        if ask == -1:
            continue
        
        if item_hrid not in history['items']:
            history['items'][item_hrid] = {
                'current_price': ask,
                'current_price_since': now_iso,
                'current_price_since_ts': now_ts,
                'last_price': None,
                'last_price_until': None,
                'last_price_until_ts': None,
                'price_direction': None
            }
        else:
            item = history['items'][item_hrid]
            if item['current_price'] != ask:
                direction = 'up' if ask > item['current_price'] else 'down'
                changes.append({
                    'item': item_hrid,
                    'old': item['current_price'],
                    'new': ask,
                    'dir': direction
                })
                item['last_price'] = item['current_price']
                item['last_price_until'] = now_iso
                item['last_price_until_ts'] = now_ts
                item['current_price'] = ask
                item['current_price_since'] = now_iso
                item['current_price_since_ts'] = now_ts
                item['price_direction'] = direction
    
    save_price_history(history)
    return history, is_new_data, changes

def generate_html(history):
    now_ts = int(datetime.now().timestamp())
    
    items_list = []
    for key, data in history.get('items', {}).items():
        price_since_ts = data.get('current_price_since_ts', now_ts)
        duration_secs = max(0, now_ts - price_since_ts)
        
        # Convert hrid to name
        name = key.replace('/items/', '').replace('_', ' ').title()
        
        direction = data.get('price_direction')
        arrow = '↑' if direction == 'up' else ('↓' if direction == 'down' else '')
        arrow_class = 'price-up' if direction == 'up' else ('price-down' if direction == 'down' else '')
        
        items_list.append({
            'key': key,
            'name': name,
            'price': data['current_price'],
            'since': data.get('current_price_since', '')[:19],
            'last_price': data.get('last_price'),
            'last_until': (data.get('last_price_until') or '')[:19],
            'duration': duration_secs,
            'duration_str': format_duration(duration_secs),
            'arrow': arrow,
            'arrow_class': arrow_class
        })
    
    items_list.sort(key=lambda x: -x['duration'])
    
    last_check = (history.get('last_check') or 'Never')[:19]
    last_market = (history.get('last_market_time') or 'Unknown')[:19]
    
    rows = []
    for item in items_list:
        dc = 'fresh' if item['duration'] < 3600 else ('stale' if item['duration'] > 86400 else '')
        
        detail = f'''<div class="detail-content">
            <div class="detail-row"><span class="detail-label">Current Price:</span><span>{item['price']:,}</span></div>
            <div class="detail-row"><span class="detail-label">Since:</span><span>{item['since']}</span></div>'''
        if item['last_price']:
            detail += f'''<div class="detail-row"><span class="detail-label">Previous:</span><span>{item['last_price']:,}</span></div>
            <div class="detail-row"><span class="detail-label">Changed:</span><span>{item['last_until']}</span></div>'''
        detail += '</div>'
        
        rows.append(f'''<tr data-name="{item['name'].lower()}">
            <td><details><summary>{item['name']}</summary>{detail}</details></td>
            <td class="price">{item['price']:,}</td>
            <td class="duration {dc}">{item['duration_str']}</td>
            <td><span class="arrow {item['arrow_class']}">{item['arrow']}</span></td>
        </tr>''')
    
    html = f'''<!DOCTYPE html>
<html>
<head>
<title>MWI Price Tracker</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#eee;margin:0;padding:20px}}
.header{{margin-bottom:20px;padding:15px;background:#16213e;border-radius:8px}}
.header h1{{margin:0 0 10px;color:#00d4ff}}
.meta{{font-size:.9em;color:#888}}.meta span{{margin-right:20px}}
table{{width:100%;border-collapse:collapse;background:#16213e;border-radius:8px;overflow:hidden}}
th,td{{padding:12px 15px;text-align:left;border-bottom:1px solid #2a2a4a}}
th{{background:#0f3460;color:#00d4ff;font-weight:600;position:sticky;top:0}}
tr:hover{{background:#1f3a5f}}
.price{{font-family:monospace;color:#ffd700}}
.duration{{font-family:monospace;color:#aaa}}
.duration.fresh{{color:#00ff88}}.duration.stale{{color:#ff6b6b}}
.price-up{{color:#00ff88;font-weight:bold}}.price-down{{color:#ff6b6b;font-weight:bold}}
.arrow{{font-size:1.2em;margin-left:5px}}
details{{cursor:pointer}}details summary{{list-style:none}}details summary::-webkit-details-marker{{display:none}}
.detail-content{{padding:10px;background:#0d1b2a;border-radius:4px;margin-top:5px;font-size:.85em}}
.detail-row{{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1a2a3a}}
.detail-label{{color:#888}}
.search-box{{margin-bottom:15px}}.search-box input{{width:100%;max-width:400px;padding:10px 15px;border:none;border-radius:4px;background:#16213e;color:#eee;font-size:1em}}.search-box input:focus{{outline:2px solid #00d4ff}}
</style>
</head>
<body>
<div class="header">
<h1>MWI Price Tracker</h1>
<div class="meta">
<span>Last Check: {last_check}</span>
<span>Market Data: {last_market}</span>
<span>Items: {len(items_list)}</span>
</div>
</div>
<div class="search-box"><input type="text" id="search" placeholder="Search items..." onkeyup="filterTable()"></div>
<table id="priceTable">
<thead><tr><th>Item</th><th>Sell Price</th><th>Price Age</th><th>Δ</th></tr></thead>
<tbody>
{''.join(rows)}
</tbody>
</table>
<script>
function filterTable(){{const q=document.getElementById('search').value.toLowerCase();document.querySelectorAll('#priceTable tbody tr').forEach(r=>{{r.style.display=r.getAttribute('data-name').includes(q)?'':'none'}})}}
setTimeout(()=>location.reload(),5*60*1000);
</script>
</body>
</html>'''
    
    return html

def git_push():
    """Commit and push changes to GitHub."""
    import subprocess
    import os
    
    repo_dir = Path(__file__).parent
    os.chdir(repo_dir)
    
    # Configure git
    subprocess.run(['git', 'config', 'user.email', 'bot@mwi-tracker'], check=True)
    subprocess.run(['git', 'config', 'user.name', 'MWI Tracker Bot'], check=True)
    
    # Add files
    subprocess.run(['git', 'add', 'price_tracker.html', 'price_history.json'], check=True)
    
    # Commit (may fail if no changes)
    result = subprocess.run(
        ['git', 'commit', '-m', f'Price update {datetime.now().strftime("%Y-%m-%d %H:%M")}'],
        capture_output=True, text=True
    )
    
    if result.returncode == 0:
        print("  Committed changes")
        # Push
        push_result = subprocess.run(['git', 'push', 'origin', 'main'], capture_output=True, text=True)
        if push_result.returncode == 0:
            print("  Pushed to GitHub")
        else:
            print(f"  Push failed: {push_result.stderr}")
    else:
        print("  No changes to commit")

def main():
    print(f"[{datetime.now().isoformat()}] Updating prices...")
    
    try:
        history, is_new, changes = update_prices()
        
        if is_new:
            print(f"  New market data! {len(changes)} price changes")
        else:
            print(f"  Same market data")
        
        html = generate_html(history)
        with open(HTML_FILE, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"  Generated {HTML_FILE}")
        
        # Push to GitHub Pages
        git_push()
        
    except Exception as e:
        print(f"  Error: {e}")
        raise

if __name__ == '__main__':
    main()
