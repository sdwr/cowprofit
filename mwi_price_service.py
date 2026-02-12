#!/usr/bin/env python3
"""
MWI Price Tracker Service
- Runs on port 8081 (separate from linksite on 8080)
- Updates prices every 30 minutes
- Serves price_tracker.html
"""

import threading
import time
import json
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import requests

PRICE_HISTORY_FILE = Path('price_history.json')
HTML_FILE = Path('price_tracker.html')
MARKET_URL = 'https://www.milkywayidle.com/game_data/marketplace.json'
CLIENT_INFO_FILE = Path('init_client_info.json')
UPDATE_INTERVAL = 30 * 60  # 30 minutes

def load_client_info():
    """Load item names from client info."""
    if CLIENT_INFO_FILE.exists():
        with open(CLIENT_INFO_FILE, encoding='utf-8') as f:
            data = json.load(f)
            items = {}
            for item in data.get('itemDetailMap', {}).values():
                hrid = item.get('hrid', '')
                name = item.get('name', hrid)
                items[hrid] = name
            return items
    return {}

def load_price_history():
    if PRICE_HISTORY_FILE.exists():
        with open(PRICE_HISTORY_FILE, encoding='utf-8') as f:
            return json.load(f)
    return {'last_check': None, 'last_market_timestamp': None, 'items': {}}

def save_price_history(data):
    with open(PRICE_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def fetch_marketplace():
    resp = requests.get(MARKET_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()

def format_duration(seconds):
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        mins = int(seconds / 60)
        return f"{mins}m"
    elif seconds < 86400:
        hours = seconds / 3600
        return f"{hours:.1f}h"
    else:
        days = seconds / 86400
        return f"{days:.1f}d"

def update_price_history():
    history = load_price_history()
    market = fetch_marketplace()
    
    market_ts = market.get('timestamp', 0)
    market_time = datetime.fromtimestamp(market_ts).isoformat()
    now = datetime.now()
    now_iso = now.isoformat()
    now_ts = int(now.timestamp())
    
    is_new_data = market_ts != history.get('last_market_timestamp')
    
    history['last_check'] = now_iso
    history['last_check_ts'] = now_ts
    history['last_market_timestamp'] = market_ts
    history['last_market_time'] = market_time
    
    changes = []
    market_data = market.get('marketData', {})
    
    for item_hrid, levels in market_data.items():
        if '0' not in levels:
            continue
        ask = levels['0'].get('a', -1)
        if ask == -1:
            continue
        
        item_key = item_hrid
        
        if item_key not in history['items']:
            history['items'][item_key] = {
                'current_price': ask,
                'current_price_since': now_iso,
                'current_price_since_ts': now_ts,
                'last_price': None,
                'last_price_until': None,
                'last_price_until_ts': None,
                'price_direction': None
            }
        else:
            item = history['items'][item_key]
            if item['current_price'] != ask:
                old_price = item['current_price']
                direction = 'up' if ask > old_price else 'down'
                
                changes.append({
                    'item': item_key,
                    'old_price': old_price,
                    'new_price': ask,
                    'direction': direction
                })
                
                item['last_price'] = old_price
                item['last_price_until'] = now_iso
                item['last_price_until_ts'] = now_ts
                item['current_price'] = ask
                item['current_price_since'] = now_iso
                item['current_price_since_ts'] = now_ts
                item['price_direction'] = direction
    
    save_price_history(history)
    return history, is_new_data, changes

def generate_html(history, item_names=None):
    if item_names is None:
        item_names = {}
    
    now_ts = int(datetime.now().timestamp())
    
    items_list = []
    for item_key, item_data in history['items'].items():
        price_since_ts = item_data.get('current_price_since_ts', now_ts)
        duration_secs = now_ts - price_since_ts
        
        name = item_names.get(item_key, item_key.replace('/items/', '').replace('_', ' ').title())
        
        direction = item_data.get('price_direction')
        arrow = ''
        arrow_class = ''
        if direction == 'up':
            arrow = '↑'
            arrow_class = 'price-up'
        elif direction == 'down':
            arrow = '↓'
            arrow_class = 'price-down'
        
        items_list.append({
            'key': item_key,
            'name': name,
            'current_price': item_data['current_price'],
            'current_price_since': item_data.get('current_price_since', ''),
            'current_price_since_ts': price_since_ts,
            'last_price': item_data.get('last_price'),
            'last_price_until': item_data.get('last_price_until', ''),
            'duration_secs': duration_secs,
            'duration_str': format_duration(duration_secs),
            'arrow': arrow,
            'arrow_class': arrow_class,
            'direction': direction
        })
    
    items_list.sort(key=lambda x: -x['duration_secs'])
    
    last_check = history.get('last_check', 'Never')
    last_market = history.get('last_market_time', 'Unknown')
    
    html = f'''<!DOCTYPE html>
<html>
<head>
    <title>MWI Price Tracker</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            margin: 0;
            padding: 20px;
        }}
        .header {{
            margin-bottom: 20px;
            padding: 15px;
            background: #16213e;
            border-radius: 8px;
        }}
        .header h1 {{
            margin: 0 0 10px 0;
            color: #00d4ff;
        }}
        .meta {{
            font-size: 0.9em;
            color: #888;
        }}
        .meta span {{
            margin-right: 20px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            background: #16213e;
            border-radius: 8px;
            overflow: hidden;
        }}
        th, td {{
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid #2a2a4a;
        }}
        th {{
            background: #0f3460;
            color: #00d4ff;
            font-weight: 600;
            position: sticky;
            top: 0;
        }}
        tr:hover {{
            background: #1f3a5f;
        }}
        .price {{
            font-family: monospace;
            color: #ffd700;
        }}
        .duration {{
            font-family: monospace;
            color: #aaa;
        }}
        .duration.fresh {{
            color: #00ff88;
        }}
        .duration.stale {{
            color: #ff6b6b;
        }}
        .price-up {{
            color: #00ff88;
            font-weight: bold;
        }}
        .price-down {{
            color: #ff6b6b;
            font-weight: bold;
        }}
        .arrow {{
            font-size: 1.2em;
            margin-left: 5px;
        }}
        details {{
            cursor: pointer;
        }}
        details summary {{
            list-style: none;
        }}
        details summary::-webkit-details-marker {{
            display: none;
        }}
        .detail-content {{
            padding: 10px;
            background: #0d1b2a;
            border-radius: 4px;
            margin-top: 5px;
            font-size: 0.85em;
        }}
        .detail-row {{
            display: flex;
            justify-content: space-between;
            padding: 3px 0;
            border-bottom: 1px solid #1a2a3a;
        }}
        .detail-label {{
            color: #888;
        }}
        .search-box {{
            margin-bottom: 15px;
        }}
        .search-box input {{
            width: 100%;
            max-width: 400px;
            padding: 10px 15px;
            border: none;
            border-radius: 4px;
            background: #16213e;
            color: #eee;
            font-size: 1em;
        }}
        .search-box input:focus {{
            outline: 2px solid #00d4ff;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>MWI Price Tracker</h1>
        <div class="meta">
            <span>Last Check: {last_check[:19] if last_check else 'Never'}</span>
            <span>Market Data: {last_market[:19] if last_market else 'Unknown'}</span>
            <span>Items: {len(items_list)}</span>
        </div>
    </div>
    
    <div class="search-box">
        <input type="text" id="search" placeholder="Search items..." onkeyup="filterTable()">
    </div>
    
    <table id="priceTable">
        <thead>
            <tr>
                <th>Item</th>
                <th>Sell Price</th>
                <th>Price Age</th>
                <th>Δ</th>
            </tr>
        </thead>
        <tbody>
'''
    
    for item in items_list:
        duration_class = 'fresh' if item['duration_secs'] < 3600 else ('stale' if item['duration_secs'] > 86400 else '')
        
        detail_html = f'''
            <div class="detail-content">
                <div class="detail-row">
                    <span class="detail-label">Current Price:</span>
                    <span>{item['current_price']:,}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Price Since:</span>
                    <span>{item['current_price_since'][:19] if item['current_price_since'] else 'N/A'}</span>
                </div>'''
        
        if item['last_price'] is not None:
            detail_html += f'''
                <div class="detail-row">
                    <span class="detail-label">Previous Price:</span>
                    <span>{item['last_price']:,}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Changed At:</span>
                    <span>{item['last_price_until'][:19] if item['last_price_until'] else 'N/A'}</span>
                </div>'''
        
        detail_html += '</div>'
        
        html += f'''
            <tr data-name="{item['name'].lower()}">
                <td>
                    <details>
                        <summary>{item['name']}</summary>
                        {detail_html}
                    </details>
                </td>
                <td class="price">{item['current_price']:,}</td>
                <td class="duration {duration_class}">{item['duration_str']}</td>
                <td><span class="arrow {item['arrow_class']}">{item['arrow']}</span></td>
            </tr>
'''
    
    html += '''
        </tbody>
    </table>
    
    <script>
        function filterTable() {
            const query = document.getElementById('search').value.toLowerCase();
            const rows = document.querySelectorAll('#priceTable tbody tr');
            rows.forEach(row => {
                const name = row.getAttribute('data-name');
                row.style.display = name.includes(query) ? '' : 'none';
            });
        }
        
        // Auto-refresh every 5 minutes
        setTimeout(() => location.reload(), 5 * 60 * 1000);
    </script>
</body>
</html>
'''
    
    return html

def update_loop(item_names):
    """Background thread to update prices every 30 minutes."""
    while True:
        try:
            print(f"[{datetime.now().isoformat()}] Updating prices...")
            history, is_new, changes = update_price_history()
            
            if is_new:
                print(f"  New market data! {len(changes)} price changes")
            else:
                print(f"  Same market data")
            
            html = generate_html(history, item_names)
            with open(HTML_FILE, 'w', encoding='utf-8') as f:
                f.write(html)
            print(f"  Generated {HTML_FILE}")
            
        except Exception as e:
            print(f"  Error: {e}")
        
        time.sleep(UPDATE_INTERVAL)

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.path = '/price_tracker.html'
        return super().do_GET()
    
    def log_message(self, format, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]}")

def main():
    print("MWI Price Tracker Service")
    print("=" * 40)
    
    item_names = load_client_info()
    print(f"Loaded {len(item_names)} item names")
    
    # Initial update
    print("Running initial update...")
    history, is_new, changes = update_price_history()
    html = generate_html(history, item_names)
    with open(HTML_FILE, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"Generated {HTML_FILE}")
    
    # Start background update thread
    update_thread = threading.Thread(target=update_loop, args=(item_names,), daemon=True)
    update_thread.start()
    print(f"Started update thread (every {UPDATE_INTERVAL//60} minutes)")
    
    # Start HTTP server
    port = 8081
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f"Serving on http://0.0.0.0:{port}")
    print("=" * 40)
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()

if __name__ == '__main__':
    main()
