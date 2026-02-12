#!/usr/bin/env python3
"""
MWI Marketplace Price Tracker
- Tracks sell price history for each item
- Shows how long current price has lasted (from NOW)
- Shows arrow for price direction (up/down from last price)
- Stores current and previous price with timestamps
"""

import requests
import json
from datetime import datetime, timezone
from pathlib import Path

PRICE_HISTORY_FILE = Path('price_history.json')
MARKET_URL = 'https://www.milkywayidle.com/game_data/marketplace.json'
CLIENT_INFO_FILE = Path('init_client_info.json')

def load_client_info():
    """Load item names from client info."""
    if CLIENT_INFO_FILE.exists():
        with open(CLIENT_INFO_FILE, encoding='utf-8') as f:
            data = json.load(f)
            # Build hrid -> name mapping
            items = {}
            for item in data.get('itemDetailMap', {}).values():
                hrid = item.get('hrid', '')
                name = item.get('name', hrid)
                items[hrid] = name
            return items
    return {}

def load_price_history():
    """Load existing price history."""
    if PRICE_HISTORY_FILE.exists():
        with open(PRICE_HISTORY_FILE, encoding='utf-8') as f:
            return json.load(f)
    return {
        'last_check': None,
        'last_market_timestamp': None,
        'items': {}
    }

def save_price_history(data):
    """Save price history."""
    with open(PRICE_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def fetch_marketplace():
    """Fetch current marketplace data."""
    resp = requests.get(MARKET_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()

def update_price_history():
    """
    Fetch marketplace and update price history.
    Returns (history, is_new_data, changes_summary)
    """
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
        # Get base level (enhancement 0) sell price (ask)
        if '0' not in levels:
            continue
        
        ask = levels['0'].get('a', -1)
        if ask == -1:
            continue  # No sell price listed
        
        item_key = item_hrid
        
        if item_key not in history['items']:
            # New item - initialize
            history['items'][item_key] = {
                'current_price': ask,
                'current_price_since': now_iso,
                'current_price_since_ts': now_ts,
                'last_price': None,
                'last_price_until': None,
                'last_price_until_ts': None,
                'price_direction': None  # 'up', 'down', or None
            }
        else:
            item = history['items'][item_key]
            if item['current_price'] != ask:
                # Price changed!
                old_price = item['current_price']
                direction = 'up' if ask > old_price else 'down'
                
                changes.append({
                    'item': item_key,
                    'old_price': old_price,
                    'new_price': ask,
                    'direction': direction
                })
                
                # Shift current to last
                item['last_price'] = old_price
                item['last_price_until'] = now_iso
                item['last_price_until_ts'] = now_ts
                
                # Set new current
                item['current_price'] = ask
                item['current_price_since'] = now_iso
                item['current_price_since_ts'] = now_ts
                item['price_direction'] = direction
    
    save_price_history(history)
    
    return history, is_new_data, changes

def format_duration(seconds):
    """Format seconds into human-readable duration."""
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

def generate_html(history, item_names=None):
    """Generate HTML report with price duration and direction arrows."""
    if item_names is None:
        item_names = {}
    
    now_ts = int(datetime.now().timestamp())
    
    # Build items list with duration
    items_list = []
    for item_key, item_data in history['items'].items():
        price_since_ts = item_data.get('current_price_since_ts', now_ts)
        duration_secs = now_ts - price_since_ts
        
        # Get display name
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
    
    # Sort by duration (longest first = stale prices, good market depth proxy)
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
            <span>Items Tracked: {len(items_list)}</span>
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
                <th>Change</th>
            </tr>
        </thead>
        <tbody>
'''
    
    for item in items_list:
        duration_class = 'fresh' if item['duration_secs'] < 3600 else ('stale' if item['duration_secs'] > 86400 else '')
        
        # Detail content
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

def main():
    """Main entry point."""
    print(f"[{datetime.now().isoformat()}] Checking marketplace...")
    
    item_names = load_client_info()
    history, is_new_data, changes = update_price_history()
    
    if is_new_data:
        print(f"  New market data detected!")
        if changes:
            print(f"  {len(changes)} price changes:")
            for c in changes[:10]:  # Show first 10
                arrow = '^' if c['direction'] == 'up' else 'v'
                print(f"    {c['item']}: {c['old_price']:,} -> {c['new_price']:,} {arrow}")
    else:
        print(f"  Same market data as before")
    
    # Generate HTML
    html = generate_html(history, item_names)
    with open('price_tracker.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"  Generated price_tracker.html")
    
    return history, is_new_data, changes

if __name__ == '__main__':
    main()
