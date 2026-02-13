"""
Generate static HTML site with enhancement profit rankings.
Includes price history tracking (consolidated from update_prices.py).
"""

import json
import requests
from datetime import datetime
from pathlib import Path
from enhance_calc import EnhancementCalculator, PriceMode

TARGET_LEVELS = [8, 10, 12, 14]
TRACKED_LEVELS = [0, 8, 10, 12, 14]  # Levels to track in price history
MIN_PROFIT = 1_000_000
MAX_ROI = 1000

PRICE_HISTORY_FILE = Path(__file__).parent / 'price_history.json'


def load_price_history():
    """Load price history for price age tracking."""
    if PRICE_HISTORY_FILE.exists():
        with open(PRICE_HISTORY_FILE, encoding='utf-8') as f:
            return json.load(f)
    return {'items': {}}


def save_price_history(data):
    """Save price history to file."""
    with open(PRICE_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f)


def update_price_history(market_data, history):
    """
    Update price history with current market data.
    Tracks prices at multiple enhancement levels using keys like 'hrid:level'.
    Returns (updated_history, changes_list).
    """
    market_ts = market_data.get('timestamp', 0)
    now = datetime.now()
    now_iso = now.isoformat()
    now_ts = int(now.timestamp())
    
    is_new_data = market_ts != history.get('last_market_timestamp')
    
    history['last_check'] = now_iso
    history['last_check_ts'] = now_ts
    history['last_market_timestamp'] = market_ts
    history['last_market_time'] = datetime.fromtimestamp(market_ts).isoformat()
    
    # Track market update history (last 15 entries)
    if 'update_history' not in history:
        history['update_history'] = []
    
    if is_new_data:
        history['update_history'].insert(0, {
            'ts': market_ts,
            'check_ts': now_ts,
            'time': datetime.fromtimestamp(market_ts).isoformat()
        })
        # Keep only last 15
        history['update_history'] = history['update_history'][:15]
    
    if 'items' not in history:
        history['items'] = {}
    
    changes = []
    
    for item_hrid, levels in market_data.get('marketData', {}).items():
        for level in TRACKED_LEVELS:
            level_str = str(level)
            if level_str not in levels:
                continue
            
            # Get bid price (what buyers will pay - pessimistic sell price)
            bid = levels[level_str].get('b', -1)
            if bid == -1:
                continue
            
            # Key format: "hrid:level"
            key = f"{item_hrid}:{level}"
            
            if key not in history['items']:
                history['items'][key] = {
                    'current_price': bid,
                    'current_price_since': now_iso,
                    'current_price_since_ts': now_ts,
                    'last_price': None,
                    'last_price_until': None,
                    'last_price_until_ts': None,
                    'price_direction': None
                }
            else:
                item = history['items'][key]
                if item['current_price'] != bid:
                    direction = 'up' if bid > item['current_price'] else 'down'
                    changes.append({
                        'key': key,
                        'old': item['current_price'],
                        'new': bid,
                        'dir': direction
                    })
                    item['last_price'] = item['current_price']
                    item['last_price_until'] = now_iso
                    item['last_price_until_ts'] = now_ts
                    item['current_price'] = bid
                    item['current_price_since'] = now_iso
                    item['current_price_since_ts'] = now_ts
                    item['price_direction'] = direction
    
    return history, is_new_data, changes


def get_price_age_info(item_hrid, target_level, price_history, now_ts):
    """Get price age and direction for an item at a specific enhancement level."""
    items = price_history.get('items', {})
    
    # Look up by hrid:level key
    key = f"{item_hrid}:{target_level}"
    data = items.get(key, {})
    
    if not data:
        return {'price_since_ts': 0, 'price_direction': None, 'last_price': None, 'tracked_price': None}
    
    price_since_ts = data.get('current_price_since_ts', 0)
    direction = data.get('price_direction')  # 'up', 'down', or None
    last_price = data.get('last_price')
    tracked_price = data.get('current_price')  # The actual tracked ask price
    
    return {
        'price_since_ts': price_since_ts,
        'price_direction': direction,
        'last_price': last_price,
        'tracked_price': tracked_price
    }


def format_coins(value):
    """Format coin value with K/M/B suffix and 2 decimal places."""
    if abs(value) >= 1_000_000_000:
        return f"{value/1_000_000_000:.2f}B"
    elif abs(value) >= 1_000_000:
        return f"{value/1_000_000:.2f}M"
    elif abs(value) >= 1_000:
        return f"{value/1_000:.2f}K"
    else:
        return f"{value:.0f}"


def generate_html(timestamp, data_by_mode, player_stats, price_history_meta=None):
    """Generate the full HTML page."""
    
    json_data = json.dumps(data_by_mode)
    stats_json = json.dumps(player_stats)
    
    # Pass timestamps for dynamic JavaScript calculation
    last_check_ts = price_history_meta.get('last_check_ts', 0) if price_history_meta else 0
    last_market_ts = price_history_meta.get('last_market_ts', 0) if price_history_meta else 0
    update_history = json.dumps(price_history_meta.get('update_history', [])) if price_history_meta else '[]'
    
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CowProfit - MWI Enhancement Tracker</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: #e8e8e8;
            min-height: 100vh;
            padding: 20px;
        }}
        .container {{ max-width: 1800px; margin: 0 auto; }}
        .header-row {{
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
            margin-bottom: 5px;
            position: relative;
        }}
        h1 {{
            color: #eeb357;
            font-size: 2rem;
            margin: 0;
        }}
        .gear-dropdown {{
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
        }}
        .gear-btn {{
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: #eeb357;
            padding: 6px 12px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.8rem;
            display: flex;
            align-items: center;
            gap: 6px;
        }}
        .gear-btn:hover {{ background: rgba(238,179,87,0.2); }}
        .gear-panel {{
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 8px;
            background: #0d1117;
            border: 1px solid rgba(238,179,87,0.5);
            border-radius: 12px;
            padding: 16px;
            min-width: 320px;
            z-index: 1000;
            box-shadow: 0 8px 32px rgba(0,0,0,0.8);
        }}
        .gear-panel.visible {{ display: block; }}
        .gear-section {{
            margin-bottom: 12px;
        }}
        .gear-section:last-child {{ margin-bottom: 0; }}
        .gear-section h5 {{
            color: #eeb357;
            font-size: 0.7rem;
            text-transform: uppercase;
            margin-bottom: 6px;
            letter-spacing: 0.5px;
        }}
        .gear-row {{
            display: flex;
            justify-content: space-between;
            font-size: 0.75rem;
            padding: 2px 0;
        }}
        .gear-row .label {{ color: #888; }}
        .gear-row .value {{ color: #e8e8e8; font-family: 'SF Mono', Monaco, monospace; }}
        .gear-row .value.highlight {{ color: #4ade80; }}
        .subtitle {{
            text-align: center;
            color: #888;
            margin-bottom: 15px;
            font-size: 0.9rem;
        }}
        .history-dropdown {{
            position: relative;
            display: inline-block;
            cursor: pointer;
        }}
        .history-btn {{
            background: transparent;
            border: none;
            color: inherit;
            font: inherit;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
        }}
        .history-btn:hover {{
            background: rgba(255,255,255,0.1);
        }}
        .history-panel {{
            display: none;
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            margin-top: 8px;
            background: #0d1117;
            border: 1px solid rgba(238,179,87,0.5);
            border-radius: 8px;
            padding: 12px;
            min-width: 280px;
            z-index: 1000;
            box-shadow: 0 8px 32px rgba(0,0,0,0.8);
            text-align: left;
        }}
        .history-panel.visible {{ display: block; }}
        .history-panel h5 {{
            color: #eeb357;
            font-size: 0.75rem;
            margin: 0 0 8px;
            text-transform: uppercase;
        }}
        .history-entry {{
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.8rem;
        }}
        .history-entry:last-child {{ border-bottom: none; }}
        .history-entry .time {{ color: #aaa; }}
        .history-entry .ago {{ color: #eeb357; font-family: 'SF Mono', Monaco, monospace; }}
        .controls {{
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-bottom: 15px;
            flex-wrap: wrap;
            align-items: center;
        }}
        .control-group {{
            display: flex;
            align-items: center;
            gap: 8px;
        }}
        .control-label {{
            color: #888;
            font-size: 0.85rem;
        }}
        .stats {{
            display: flex;
            justify-content: center;
            gap: 25px;
            margin-bottom: 15px;
            flex-wrap: wrap;
        }}
        .stat {{
            background: rgba(255,255,255,0.05);
            padding: 8px 16px;
            border-radius: 8px;
            text-align: center;
        }}
        .stat-value {{ font-size: 1.3rem; color: #eeb357; font-weight: bold; }}
        .stat-label {{ font-size: 0.75rem; color: #888; }}
        .filters {{
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 10px;
            flex-wrap: wrap;
            align-items: center;
        }}
        .filter-label {{
            color: #888;
            font-size: 0.8rem;
            margin-right: 4px;
        }}
        .filter-divider {{
            color: #444;
            margin: 0 10px;
        }}
        .filter-btn, .mode-btn {{
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: #e8e8e8;
            padding: 6px 14px;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.85rem;
        }}
        .filter-btn:hover, .mode-btn:hover {{
            background: rgba(238,179,87,0.3);
            border-color: rgba(238,179,87,0.5);
        }}
        .filter-btn.active, .mode-btn.active {{
            background: #eeb357;
            color: #1a1a2e;
            border-color: #eeb357;
        }}
        .toggle-btn {{
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.2);
            color: #888;
            padding: 4px 10px;
            border-radius: 12px;
            cursor: pointer;
            font-size: 0.75rem;
        }}
        .toggle-btn.active {{
            background: rgba(238,179,87,0.3);
            color: #eeb357;
            border-color: #eeb357;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            background: rgba(255,255,255,0.03);
            border-radius: 12px;
            overflow: hidden;
        }}
        th {{
            background: rgba(238,179,87,0.2);
            color: #eeb357;
            padding: 10px 5px;
            text-align: left;
            font-weight: 600;
            font-size: 0.75rem;
            white-space: nowrap;
            cursor: pointer;
            user-select: none;
        }}
        th:hover {{
            background: rgba(238,179,87,0.35);
        }}
        th .sort-arrow {{
            margin-left: 3px;
            opacity: 0.5;
        }}
        th.sorted .sort-arrow {{
            opacity: 1;
        }}
        td {{
            padding: 7px 5px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.8rem;
        }}
        tr.data-row {{ cursor: pointer; }}
        tr.data-row:hover {{ background: rgba(255,255,255,0.05); }}
        tr.data-row.expanded {{ background: rgba(238,179,87,0.1); }}
        .positive {{ color: #4ade80; }}
        .negative {{ color: #f87171; }}
        .neutral {{ color: #888; }}
        .price-up {{ color: #4ade80; font-weight: bold; }}
        .price-down {{ color: #f87171; font-weight: bold; }}
        .item-name {{ font-weight: 500; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }}
        .level-badge {{
            background: rgba(238,179,87,0.3);
            color: #eeb357;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: bold;
        }}
        .number {{ text-align: right; font-family: 'SF Mono', Monaco, monospace; font-size: 0.75rem; }}
        .price-source {{
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            margin-right: 3px;
            vertical-align: middle;
        }}
        .source-market {{ background: #60a5fa; }}
        .source-craft {{ background: #f59e0b; }}
        .source-vendor {{ background: #9ca3af; }}
        
        /* Detail row styles */
        tr.detail-row {{
            display: none;
        }}
        tr.detail-row.visible {{
            display: table-row;
        }}
        tr.detail-row td {{
            padding: 12px 20px;
            background: rgba(0,0,0,0.2);
            border-bottom: 2px solid rgba(238,179,87,0.3);
        }}
        .detail-content {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            font-size: 0.8rem;
        }}
        .detail-section {{
            background: rgba(255,255,255,0.03);
            padding: 12px;
            border-radius: 8px;
        }}
        .detail-section h4 {{
            color: #eeb357;
            font-size: 0.75rem;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .detail-line {{
            display: flex;
            justify-content: space-between;
            padding: 3px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }}
        .detail-line:last-child {{
            border-bottom: none;
        }}
        .detail-line .label {{
            color: #aaa;
        }}
        .detail-line .value {{
            font-family: 'SF Mono', Monaco, monospace;
            color: #e8e8e8;
        }}
        .detail-line .value.alt {{
            color: #888;
            font-size: 0.7rem;
        }}
        .mat-row {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }}
        .mat-row:last-child {{ border-bottom: none; }}
        .mat-row.total-row {{ 
            border-top: 1px solid rgba(238,179,87,0.3);
            margin-top: 4px;
            padding-top: 6px;
            font-weight: bold;
        }}
        .mat-name {{ flex: 1; color: #ccc; }}
        .mat-count {{ color: #888; margin: 0 8px; font-size: 0.7rem; }}
        .mat-price {{ font-family: 'SF Mono', Monaco, monospace; color: #eeb357; }}
        .craft-breakdown {{
            margin: 8px 0;
            padding: 8px;
            background: rgba(0,0,0,0.2);
            border-radius: 4px;
        }}
        .profit-bar-cell {{
            position: relative;
            text-align: center;
        }}
        .profit-bar {{
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            opacity: 0.2;
            border-radius: 2px;
            z-index: 0;
        }}
        .profit-bar.positive {{ background: #4ade80; }}
        .profit-bar.negative {{ background: #f87171; }}
        .profit-bar-value {{
            position: relative;
            z-index: 1;
        }}
        .price-note {{
            font-weight: normal;
            font-size: 0.65rem;
            color: #666;
            text-transform: none;
        }}
        .expand-icon {{
            display: inline-block;
            width: 16px;
            color: #666;
            transition: transform 0.2s;
            margin-right: 4px;
        }}
        tr.data-row.expanded .expand-icon {{
            transform: rotate(90deg);
            color: #eeb357;
        }}
        
        .footer {{
            text-align: center;
            margin-top: 25px;
            padding: 15px;
            color: #666;
            font-size: 0.75rem;
        }}
        .footer a {{ color: #eeb357; text-decoration: none; }}
        .footer a:hover {{ text-decoration: underline; }}
        .mode-info {{
            text-align: center;
            color: #666;
            font-size: 0.7rem;
            margin-bottom: 10px;
        }}
        .legend {{
            display: flex;
            justify-content: center;
            gap: 15px;
            margin-bottom: 10px;
            font-size: 0.7rem;
            color: #888;
        }}
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 4px;
        }}
        @media (max-width: 1000px) {{
            table {{ font-size: 0.65rem; }}
            th, td {{ padding: 5px 3px; }}
            .hide-mobile {{ display: none; }}
            .detail-content {{ grid-template-columns: 1fr; }}
            .gear-dropdown {{ position: static; transform: none; margin-top: 10px; }}
            .header-row {{ flex-wrap: wrap; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header-row">
            <h1>&#x1F404; CowProfit</h1>
            <div class="gear-dropdown">
                <button class="gear-btn" onclick="toggleGear()">&#x2699; Gear <span id="gear-arrow">&#9660;</span></button>
                <div class="gear-panel" id="gear-panel"></div>
            </div>
        </div>
        <p class="subtitle">MWI Enhancement Profit Tracker | Last check: <span id="time-check">-</span> | 
            <span class="history-dropdown">
                <button class="history-btn" onclick="toggleHistory(event)">Market update: <span id="time-market">-</span> <span id="history-arrow">&#9660;</span></button>
                <div class="history-panel" id="history-panel"></div>
            </span>
        </p>
        
        <div class="controls">
            <div class="control-group">
                <span class="control-label">Price:</span>
                <button class="mode-btn active" onclick="setMode('pessimistic')" id="btn-pessimistic">Pessimistic</button>
                <button class="mode-btn" onclick="setMode('midpoint')" id="btn-midpoint">Midpoint</button>
                <button class="mode-btn" onclick="setMode('optimistic')" id="btn-optimistic">Optimistic</button>
            </div>
            <div class="control-group">
                <button class="toggle-btn active" onclick="toggleFee()" id="btn-fee">-2% Fee</button>
                <button class="toggle-btn" onclick="toggleSuperPessimistic()" id="btn-super" title="Include loss from selling 33% leftover materials at market buy price">-Mat Loss</button>
            </div>
        </div>
        <p class="mode-info" id="mode-info">Buy at Ask, Sell at Bid (safest estimate)</p>
        
        <div class="legend">
            <div class="legend-item"><span class="price-source source-market"></span> Market</div>
            <div class="legend-item"><span class="price-source source-craft"></span> Craft</div>
            <div class="legend-item"><span class="price-source source-vendor"></span> Vendor</div>
        </div>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-value" id="stat-profitable">-</div>
                <div class="stat-label">Profitable</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="stat-roi">-</div>
                <div class="stat-label">Best ROI</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="stat-profit">-</div>
                <div class="stat-label">Top Profit</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="stat-profitday">-</div>
                <div class="stat-label">Best $/day</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="stat-xpday">-</div>
                <div class="stat-label">Best XP/day</div>
            </div>
        </div>
        
        <div class="filters">
            <span class="filter-label">Level:</span>
            <button class="filter-btn level-filter active" onclick="filterLevel('all')">All</button>
            <button class="filter-btn level-filter" onclick="filterLevel(8)">+8</button>
            <button class="filter-btn level-filter" onclick="filterLevel(10)">+10</button>
            <button class="filter-btn level-filter" onclick="filterLevel(12)">+12</button>
            <button class="filter-btn level-filter" onclick="filterLevel(14)">+14</button>
            <span class="filter-divider">|</span>
            <span class="filter-label">Cost:</span>
            <button class="filter-btn cost-filter active" data-cost="100m" onclick="toggleCostFilter('100m')">&lt;100M</button>
            <button class="filter-btn cost-filter active" data-cost="500m" onclick="toggleCostFilter('500m')">100-500M</button>
            <button class="filter-btn cost-filter active" data-cost="1b" onclick="toggleCostFilter('1b')">500M-1B</button>
            <button class="filter-btn cost-filter active" data-cost="2b" onclick="toggleCostFilter('2b')">1-2B</button>
            <button class="filter-btn cost-filter active" data-cost="over2b" onclick="toggleCostFilter('over2b')">&gt;2B</button>
        </div>
        
        <table id="results">
            <thead>
                <tr>
                    <th onclick="sortTable(0, 'str')">Item<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(1, 'num')">Lvl<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(2, 'num')" class="number">Buy<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(3, 'num')" class="number hide-mobile">Enhance<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(4, 'num')" class="number hide-mobile">Total<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(5, 'num')" class="number">Sell<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(6, 'num')" class="number" style="text-align:center">$/day<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(7, 'num')" class="number" title="Time since sell price changed">Age<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(8, 'num')" class="number">Profit<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(9, 'num')" class="number">ROI<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(10, 'num')" class="number hide-mobile">XP/day<span class="sort-arrow">&#9650;</span></th>
                </tr>
            </thead>
            <tbody id="table-body">
            </tbody>
        </table>
        
        <div class="footer">
            <p>Data from <a href="https://www.milkywayidle.com" target="_blank">Milky Way Idle</a> | Math from <a href="https://doh-nuts.github.io/Enhancelator/" target="_blank">Enhancelator</a></p>
        </div>
    </div>
    
    <script>
        const allData = {json_data};
        const playerStats = {stats_json};
        const lastCheckTs = {last_check_ts};
        const lastMarketTs = {last_market_ts};
        const updateHistory = {update_history};
        let currentMode = 'pessimistic';
        let currentLevel = 'all';
        let sortCol = 6; // Default to $/day column
        let sortAsc = false;
        let showFee = true; // Fee toggle on by default
        let showSuperPessimistic = false; // Include mat loss toggle
        let expandedRows = new Set();
        let costFilters = {{ '100m': true, '500m': true, '1b': true, '2b': true, 'over2b': true }};
        let gearOpen = false;
        
        const modeInfo = {{
            'pessimistic': 'Buy at Ask, Sell at Bid (safest estimate)',
            'midpoint': 'Buy/Sell at midpoint of Ask and Bid',
            'optimistic': 'Buy at Bid, Sell at Ask (best case)'
        }};
        
        function formatAge(seconds) {{
            if (!seconds || seconds <= 0) return '-';
            if (seconds < 60) return Math.floor(seconds) + 's';
            if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
            if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h';
            return (seconds / 86400).toFixed(1) + 'd';
        }}
        
        function getAgeArrow(direction) {{
            if (direction === 'up') return '<span class="price-up">↑</span>';
            if (direction === 'down') return '<span class="price-down">↓</span>';
            return '-';
        }}
        
        function formatTimeAgo(ts) {{
            if (!ts) return '-';
            const seconds = Math.floor(Date.now() / 1000) - ts;
            if (seconds < 60) return Math.floor(seconds) + 's ago';
            if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
            if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h ago';
            return (seconds / 86400).toFixed(1) + 'd ago';
        }}
        
        function updateTimes() {{
            document.getElementById('time-check').textContent = formatTimeAgo(lastCheckTs);
            document.getElementById('time-market').textContent = formatTimeAgo(lastMarketTs);
        }}
        
        let historyOpen = false;
        function toggleHistory(e) {{
            if (e) e.stopPropagation();
            historyOpen = !historyOpen;
            const panel = document.getElementById('history-panel');
            panel.classList.toggle('visible', historyOpen);
            document.getElementById('history-arrow').innerHTML = historyOpen ? '&#9650;' : '&#9660;';
            if (historyOpen) renderHistoryPanel();
        }}
        
        function renderHistoryPanel() {{
            const entries = updateHistory.map(h => `
                <div class="history-entry">
                    <span class="time">${{new Date(h.ts * 1000).toLocaleString()}}</span>
                    <span class="ago">${{formatTimeAgo(h.ts)}}</span>
                </div>
            `).join('');
            document.getElementById('history-panel').innerHTML = `
                <h5>Market Update History</h5>
                ${{entries || '<div class="history-entry">No history yet</div>'}}
            `;
        }}
        
        function formatCoins(value) {{
            if (value === 0 || value === null || value === undefined) return '-';
            if (Math.abs(value) >= 1e9) return (value/1e9).toFixed(2) + 'B';
            if (Math.abs(value) >= 1e6) return (value/1e6).toFixed(2) + 'M';
            if (Math.abs(value) >= 1e3) return (value/1e3).toFixed(2) + 'K';
            return value.toFixed(0);
        }}
        
        function formatXP(value) {{
            if (Math.abs(value) >= 1e6) return (value/1e6).toFixed(1) + 'M';
            if (Math.abs(value) >= 1e3) return (value/1e3).toFixed(1) + 'K';
            return value.toFixed(0);
        }}
        
        function toggleGear() {{
            gearOpen = !gearOpen;
            document.getElementById('gear-panel').classList.toggle('visible', gearOpen);
            document.getElementById('gear-arrow').innerHTML = gearOpen ? '&#9650;' : '&#9660;';
            if (gearOpen) renderGearPanel();
        }}
        
        function renderGearPanel() {{
            const s = playerStats;
            document.getElementById('gear-panel').innerHTML = `
                <div class="gear-section">
                    <h5>&#x1F3AF; Enhancing</h5>
                    <div class="gear-row"><span class="label">Base Level</span><span class="value">${{s.enhancing_level}}</span></div>
                    <div class="gear-row"><span class="label">Effective Level</span><span class="value highlight">${{s.effective_level.toFixed(1)}}</span></div>
                    <div class="gear-row"><span class="label">Observatory</span><span class="value">+${{s.observatory}}</span></div>
                </div>
                <div class="gear-section">
                    <h5>&#x1F527; Tool & Success</h5>
                    <div class="gear-row"><span class="label">${{s.enhancer}} +${{s.enhancer_level}}</span><span class="value">+${{s.enhancer_success.toFixed(2)}}%</span></div>
                    <div class="gear-row"><span class="label">Achievement Bonus</span><span class="value">+${{s.achievement_success.toFixed(2)}}%</span></div>
                    <div class="gear-row"><span class="label">Total Success Bonus</span><span class="value highlight">+${{s.total_success_bonus.toFixed(2)}}%</span></div>
                </div>
                <div class="gear-section">
                    <h5>&#x26A1; Speed Bonuses</h5>
                    <div class="gear-row"><span class="label">Gloves +${{s.gloves_level}}</span><span class="value">+${{s.gloves_speed.toFixed(2)}}%</span></div>
                    <div class="gear-row"><span class="label">Top +${{s.top_level}}</span><span class="value">+${{s.top_speed.toFixed(2)}}%</span></div>
                    <div class="gear-row"><span class="label">Bot +${{s.bot_level}}</span><span class="value">+${{s.bot_speed.toFixed(2)}}%</span></div>
                    <div class="gear-row"><span class="label">Neck +${{s.neck_level}} (5x)</span><span class="value">+${{s.neck_speed.toFixed(2)}}%</span></div>
                    <div class="gear-row"><span class="label">Buff Lvl ${{s.buff_level}}</span><span class="value">+${{s.buff_speed.toFixed(2)}}%</span></div>
                    <div class="gear-row"><span class="label">${{s.tea_name || 'No'}} Tea</span><span class="value">+${{s.tea_speed.toFixed(2)}}%</span></div>
                </div>
                <div class="gear-section">
                    <h5>&#x1F375; Active Teas</h5>
                    <div class="gear-row"><span class="label">Blessed Tea</span><span class="value">${{s.tea_blessed ? '✓' : '✗'}}</span></div>
                    <div class="gear-row"><span class="label">Wisdom Tea</span><span class="value">${{s.tea_wisdom ? '✓' : '✗'}}</span></div>
                    <div class="gear-row"><span class="label">Artisan Tea</span><span class="value">${{s.artisan_tea ? s.artisan_reduction.toFixed(2) + '% craft red.' : '✗'}}</span></div>
                    <div class="gear-row"><span class="label">Guzzling Bonus</span><span class="value highlight">${{s.guzzling_bonus.toFixed(4)}}x</span></div>
                </div>
                <div class="gear-section">
                    <h5>&#x1F48E; Charm</h5>
                    <div class="gear-row"><span class="label">${{s.charm_tier.charAt(0).toUpperCase() + s.charm_tier.slice(1)}} +${{s.charm_level}}</span><span class="value">XP bonus</span></div>
                </div>
            `;
        }}
        
        function toggleFee() {{
            showFee = !showFee;
            document.getElementById('btn-fee').classList.toggle('active', showFee);
            renderTable();
        }}
        
        function toggleSuperPessimistic() {{
            showSuperPessimistic = !showSuperPessimistic;
            document.getElementById('btn-super').classList.toggle('active', showSuperPessimistic);
            renderTable();
        }}
        
        function toggleCostFilter(cost) {{
            costFilters[cost] = !costFilters[cost];
            document.querySelector(`.cost-filter[data-cost="${{cost}}"]`).classList.toggle('active', costFilters[cost]);
            renderTable();
        }}
        
        function getCostBucket(totalCost) {{
            if (totalCost < 100e6) return '100m';
            if (totalCost < 500e6) return '500m';
            if (totalCost < 1e9) return '1b';
            if (totalCost < 2e9) return '2b';
            return 'over2b';
        }}
        
        function setMode(mode) {{
            currentMode = mode;
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('btn-' + mode).classList.add('active');
            document.getElementById('mode-info').textContent = modeInfo[mode];
            expandedRows.clear();
            renderTable();
        }}
        
        function filterLevel(level) {{
            currentLevel = level;
            document.querySelectorAll('.level-filter').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            renderTable();
        }}
        
        function sortTable(col, type) {{
            if (sortCol === col) {{
                sortAsc = !sortAsc;
            }} else {{
                sortCol = col;
                sortAsc = (col === 0); // Only item name sorts ascending by default
            }}
            renderTable();
        }}
        
        function toggleRow(rowId) {{
            if (expandedRows.has(rowId)) {{
                expandedRows.delete(rowId);
            }} else {{
                expandedRows.add(rowId);
            }}
            renderTable();
        }}
        
        function renderDetailRow(r) {{
            const priceLabel = currentMode === 'pessimistic' ? 'ask' : currentMode === 'optimistic' ? 'bid' : 'mid';
            
            // Craft materials under base item if source is craft
            let craftMatsHtml = '';
            if (r.base_source === 'craft' && r.craft_materials && r.craft_materials.length > 0) {{
                craftMatsHtml = r.craft_materials.map(m => 
                    `<div class="mat-row">
                        <span class="mat-name">${{m.name}}</span>
                        <span class="mat-count">${{m.count.toFixed(2)}}x @ ${{formatCoins(m.price)}}</span>
                        <span class="mat-price">${{formatCoins(m.count * m.price)}}</span>
                    </div>`
                ).join('');
                const craftTotal = r.craft_materials.reduce((sum, m) => sum + m.count * m.price, 0);
                craftMatsHtml = `<div class="craft-breakdown">
                    ${{craftMatsHtml}}
                    <div class="mat-row total-row">
                        <span class="mat-name">Craft Total</span>
                        <span class="mat-count"></span>
                        <span class="mat-price">${{formatCoins(craftTotal)}}</span>
                    </div>
                </div>`;
            }}
            
            // Enhancement materials per attempt
            let matsPerAttempt = 0;
            let matsHtml = '';
            if (r.materials && r.materials.length > 0) {{
                matsHtml = r.materials.map(m => {{
                    const lineTotal = m.count * m.price;
                    matsPerAttempt += lineTotal;
                    return `<div class="mat-row">
                        <span class="mat-name">${{m.name}}</span>
                        <span class="mat-count">${{m.count.toFixed(0)}}x @ ${{formatCoins(m.price)}}</span>
                        <span class="mat-price">${{formatCoins(lineTotal)}}</span>
                    </div>`;
                }}).join('');
            }}
            if (r.coin_cost > 0) {{
                matsPerAttempt += r.coin_cost;
                matsHtml += `<div class="mat-row">
                    <span class="mat-name">Coins</span>
                    <span class="mat-count"></span>
                    <span class="mat-price">${{formatCoins(r.coin_cost)}}</span>
                </div>`;
            }}
            const costPerAttempt = matsPerAttempt;
            const totalEnhanceCost = costPerAttempt * r.actions;
            const totalProtCost = r.protect_price * r.protect_count;
            
            // Price display - 2 lines max
            // Use tracked_price (ask) for direction comparison, sell_price for actual value
            let priceHtml = '';
            if (r.last_price && r.tracked_price && r.price_since_ts) {{
                // Show tracked price change (bid → bid) which matches the direction arrow
                const pctChange = ((r.tracked_price - r.last_price) / r.last_price * 100).toFixed(1);
                const pctClass = pctChange > 0 ? 'positive' : 'negative';
                priceHtml = `<div class="detail-line">
                    <span class="label">Sell price (bid)</span>
                    <span class="value ${{pctClass}}">${{formatCoins(r.last_price)}} → ${{formatCoins(r.tracked_price)}} (${{pctChange > 0 ? '+' : ''}}${{pctChange}}%)</span>
                </div>`;
            }} else {{
                priceHtml = `<div class="detail-line">
                    <span class="label">Sell price (+${{r.target_level}})</span>
                    <span class="value">${{formatCoins(r.sell_price)}}</span>
                </div>`;
            }}
            if (r.price_since_ts) {{
                const ageStr = formatAge(Math.floor(Date.now()/1000) - r.price_since_ts);
                const sinceDate = new Date(r.price_since_ts * 1000).toLocaleString();
                priceHtml += `<div class="detail-line">
                    <span class="label">Since</span>
                    <span class="value">${{sinceDate}} (${{ageStr}})</span>
                </div>`;
            }}
            
            const altLabel = r.base_source === 'craft' ? 'Market' : 'Craft';
            const altPrice = r.alt_price > 0 ? formatCoins(r.alt_price) : 'N/A';
            
            return `<div class="detail-content">
                <div class="detail-section">
                    <h4>&#x1F4E6; Base Item</h4>
                    <div class="detail-line">
                        <span class="label">Source</span>
                        <span class="value">${{r.base_source}} (${{priceLabel}})</span>
                    </div>
                    <div class="detail-line">
                        <span class="label">Base price</span>
                        <span class="value">${{formatCoins(r.base_price)}}</span>
                    </div>
                    ${{r.base_source === 'craft' ? craftMatsHtml : `<div class="detail-line"><span class="label">${{altLabel}} price</span><span class="value alt">${{altPrice}}</span></div>`}}
                </div>
                
                <div class="detail-section">
                    <h4>&#x1F527; Materials</h4>
                    ${{matsHtml || '<div class="detail-line"><span class="label">None</span></div>'}}
                    <div class="mat-row total-row">
                        <span class="mat-name">Total (${{formatCoins(costPerAttempt)}}/attempt × ${{r.actions.toFixed(0)}})</span>
                        <span class="mat-count"></span>
                        <span class="mat-price">${{formatCoins(totalEnhanceCost)}}</span>
                    </div>
                </div>
                
                <div class="detail-section">
                    <h4>&#x1F4B0; Cost Summary</h4>
                    <div class="detail-line">
                        <span class="label">Base item</span>
                        <span class="value">${{formatCoins(r.base_price)}}</span>
                    </div>
                    <div class="detail-line">
                        <span class="label">Materials (${{r.actions.toFixed(0)}} attempts)</span>
                        <span class="value">${{formatCoins(totalEnhanceCost)}}</span>
                    </div>
                    <div class="detail-line">
                        <span class="label">Protection (${{formatCoins(r.protect_price)}} × ${{r.protect_count.toFixed(1)}})</span>
                        <span class="value">${{formatCoins(totalProtCost)}}</span>
                    </div>
                    <div class="mat-row total-row">
                        <span class="mat-name">Total Cost</span>
                        <span class="mat-count"></span>
                        <span class="mat-price">${{formatCoins(r.total_cost)}}</span>
                    </div>
                </div>
                
                <div class="detail-section">
                    <h4>&#x1F4C8; Sell & Time</h4>
                    ${{priceHtml}}
                    <div class="detail-line">
                        <span class="label">Time (${{r.actions.toFixed(0)}} attempts)</span>
                        <span class="value">${{r.time_hours.toFixed(1)}}h (${{r.time_days.toFixed(2)}}d)</span>
                    </div>
                    <div class="detail-line">
                        <span class="label">XP earned</span>
                        <span class="value">${{formatXP(r.total_xp)}}</span>
                    </div>
                </div>
            </div>`;
        }}
        
        function renderTable() {{
            const data = allData[currentMode] || [];
            
            // Filter by level
            let filtered = currentLevel === 'all' ? data : 
                data.filter(r => r.target_level == currentLevel);
            
            // Filter by cost buckets
            filtered = filtered.filter(r => costFilters[getCostBucket(r.total_cost)]);
            
            const profitKey = showFee ? 'profit_after_fee' : 'profit';
            const profitDayKey = showFee ? 'profit_per_day_after_fee' : 'profit_per_day';
            const roiKey = showFee ? 'roi_after_fee' : 'roi';
            
            // Add computed fields with super pessimistic adjustment
            filtered = filtered.map((r, i) => {{
                let profit = r[profitKey];
                let profitDay = r[profitDayKey];
                const roi = r[roiKey] || r.roi;
                
                // Super pessimistic: subtract loss from selling 33% leftover mats
                // Assume mats sell at 90% of buy price, less 2% fee = 88.2% recovery
                if (showSuperPessimistic) {{
                    const matLoss = r.mat_cost * 0.33 * (1 - 0.882); // 11.8% loss on 33% of mats
                    const protLoss = (r.protect_price * r.protect_count) * 0.33 * (1 - 0.882);
                    const totalLoss = matLoss + protLoss;
                    profit -= totalLoss;
                    profitDay = r.time_days > 0 ? profit / r.time_days : 0;
                }}
                
                return {{
                    ...r, 
                    _profit: profit, 
                    _profit_day: profitDay,
                    _roi: roi
                }};
            }});
            
            // Sort keys: item_name, target_level, base_price, mat_cost, total_cost, sell_price, profit_day, age, profit, roi, xp_per_day
            const nowTs = Math.floor(Date.now() / 1000);
            // Add computed _age field for sorting
            filtered = filtered.map(r => ({{...r, _age: r.price_since_ts ? nowTs - r.price_since_ts : 0}}));
            const sortKeys = ['item_name', 'target_level', 'base_price', 'mat_cost', 'total_cost', 'sell_price', '_profit_day', '_age', '_profit', '_roi', 'xp_per_day'];
            filtered.sort((a, b) => {{
                let va = a[sortKeys[sortCol]];
                let vb = b[sortKeys[sortCol]];
                if (typeof va === 'string') {{
                    return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                }}
                return sortAsc ? va - vb : vb - va;
            }});
            
            const profitable = data.filter(r => r[profitKey] > 1000000 && (r[roiKey] || r.roi) < 1000);
            const bestProfit = profitable.length ? Math.max(...profitable.map(r => r[profitKey])) : 0;
            const bestRoi = profitable.length ? Math.max(...profitable.map(r => r[roiKey] || r.roi)) : 0;
            const bestProfitDay = profitable.length ? Math.max(...profitable.map(r => r[profitDayKey])) : 0;
            const bestXpDay = data.length ? Math.max(...data.map(r => r.xp_per_day)) : 0;
            
            document.getElementById('stat-profitable').textContent = profitable.length;
            document.getElementById('stat-roi').textContent = bestRoi.toFixed(0) + '%';
            document.getElementById('stat-profit').textContent = formatCoins(bestProfit);
            document.getElementById('stat-profitday').textContent = formatCoins(bestProfitDay);
            document.getElementById('stat-xpday').textContent = formatXP(bestXpDay);
            
            const tbody = document.getElementById('table-body');
            let html = '';
            
            // Calculate max profit/day for bar scaling (from displayed items)
            const displayItems = filtered.slice(0, 400);
            const maxProfitDay = Math.max(...displayItems.map(r => r._profit_day || 0), 1);
            const minProfitDay = Math.min(...displayItems.map(r => r._profit_day || 0), 0);
            
            displayItems.forEach((r, i) => {{
                const rowId = r.item_hrid + '_' + r.target_level;
                const isExpanded = expandedRows.has(rowId);
                const profit = r._profit;
                const profitDay = r._profit_day;
                const roi = r._roi;
                const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
                const sourceClass = r.base_source === 'market' ? 'source-market' : r.base_source === 'craft' ? 'source-craft' : 'source-vendor';
                
                // Calculate bar width as % of max
                let barWidth = 0;
                let barClass = 'positive';
                if (profitDay > 0) {{
                    barWidth = (profitDay / maxProfitDay) * 100;
                }} else if (profitDay < 0 && minProfitDay < 0) {{
                    barWidth = (profitDay / minProfitDay) * 100;
                    barClass = 'negative';
                }}
                
                html += `<tr class="data-row ${{isExpanded ? 'expanded' : ''}}" onclick="toggleRow('${{rowId}}')" data-level="${{r.target_level}}">
                    <td class="item-name"><span class="expand-icon">&#9654;</span>${{r.item_name}}</td>
                    <td><span class="level-badge">+${{r.target_level}}</span></td>
                    <td class="number"><span class="price-source ${{sourceClass}}"></span>${{formatCoins(r.base_price)}}</td>
                    <td class="number hide-mobile">${{formatCoins(r.mat_cost)}}</td>
                    <td class="number hide-mobile">${{formatCoins(r.total_cost)}}</td>
                    <td class="number">${{formatCoins(r.sell_price)}}</td>
                    <td class="number profit-bar-cell ${{profitClass}}" style="text-align:center"><div class="profit-bar ${{barClass}}" style="width:${{barWidth.toFixed(1)}}%"></div><span class="profit-bar-value">${{formatCoins(profitDay)}}</span></td>
                    <td class="number">${{formatAge(r._age)}} ${{getAgeArrow(r.price_direction)}}</td>
                    <td class="number ${{profitClass}}">${{formatCoins(profit)}}</td>
                    <td class="number ${{profitClass}}">${{roi.toFixed(1)}}%</td>
                    <td class="number hide-mobile">${{formatXP(r.xp_per_day)}}</td>
                </tr>`;
                
                html += `<tr class="detail-row ${{isExpanded ? 'visible' : ''}}">
                    <td colspan="11">${{renderDetailRow(r)}}</td>
                </tr>`;
            }});
            
            tbody.innerHTML = html;
            
            document.querySelectorAll('th').forEach((th, i) => {{
                th.classList.toggle('sorted', i === sortCol);
                const arrow = th.querySelector('.sort-arrow');
                if (arrow) arrow.innerHTML = (i === sortCol && sortAsc) ? '&#9650;' : '&#9660;';
            }});
        }}
        
        // Close panels when clicking outside
        document.addEventListener('click', function(e) {{
            if (gearOpen && !e.target.closest('.gear-dropdown')) {{
                gearOpen = false;
                document.getElementById('gear-panel').classList.remove('visible');
                document.getElementById('gear-arrow').innerHTML = '&#9660;';
            }}
            if (historyOpen && !e.target.closest('.history-dropdown')) {{
                historyOpen = false;
                document.getElementById('history-panel').classList.remove('visible');
            }}
        }});
        
        renderTable();
        updateTimes();
        setInterval(updateTimes, 60000); // Update header times every minute
    </script>
</body>
</html>
'''


def main():
    print("Fetching market data...")
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    timestamp = datetime.fromtimestamp(market_data.get('timestamp', 0))
    
    # Update price history (consolidated from update_prices.py)
    print("Updating price history...")
    price_history = load_price_history()
    price_history, is_new_data, changes = update_price_history(market_data, price_history)
    save_price_history(price_history)
    if is_new_data:
        print(f"  New market data! {len(changes)} price changes")
    else:
        print(f"  Same market data")
    
    print("Loading game data...")
    calc = EnhancementCalculator('init_client_info.json')
    
    print(f"Calculating profits for {len(calc.enhanceable_items)} items...")
    
    all_modes = calc.get_all_profits_all_modes(market_data, TARGET_LEVELS)
    
    for mode in all_modes:
        all_modes[mode] = [r for r in all_modes[mode] if r['roi'] < MAX_ROI]
    
    # Enrich with price age data (now using hrid:level keys)
    now_ts = int(datetime.now().timestamp())
    
    for mode in all_modes:
        for result in all_modes[mode]:
            item_hrid = result.get('item_hrid', '')
            target_level = result.get('target_level', 0)
            age_info = get_price_age_info(item_hrid, target_level, price_history, now_ts)
            result['price_since_ts'] = age_info['price_since_ts']
            result['price_direction'] = age_info['price_direction']
            result['last_price'] = age_info['last_price']
            result['tracked_price'] = age_info['tracked_price']
    
    profitable_count = len([r for r in all_modes['pessimistic'] if r['profit'] > MIN_PROFIT])
    print(f"Found {profitable_count} profitable opportunities (pessimistic)")
    
    # Get player stats for the gear dropdown
    player_stats = calc.get_player_stats()
    
    # Pass timestamps for dynamic JavaScript calculation
    price_history_meta = {
        'last_check_ts': price_history.get('last_check_ts', now_ts),
        'last_market_ts': price_history.get('last_market_timestamp', now_ts),
        'update_history': price_history.get('update_history', [])
    }
    
    html = generate_html(
        timestamp=timestamp.strftime('%Y-%m-%d %H:%M UTC'),
        data_by_mode=all_modes,
        player_stats=player_stats,
        price_history_meta=price_history_meta
    )
    
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("Generated index.html")
    
    with open('data.json', 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': market_data.get('timestamp'),
            'generated': datetime.now().isoformat(),
            'modes': {mode: results[:100] for mode, results in all_modes.items()},
        }, f, indent=2)
    print("Generated data.json")
    
    for mode_name in ['pessimistic']:
        results = all_modes[mode_name]
        profitable = [r for r in results if r['profit_after_fee'] > MIN_PROFIT]
        print(f"\n=== Top 5 {mode_name.upper()} (by $/day after fee) ===")
        profitable.sort(key=lambda r: r['profit_per_day_after_fee'], reverse=True)
        for i, r in enumerate(profitable[:5], 1):
            print(f"{i}. {r['item_name']} +{r['target_level']}: {format_coins(r['profit_after_fee'])} profit, {format_coins(r['total_cost'])} cost, {format_coins(r['profit_per_day_after_fee'])}/day")
    
    # Push to GitHub Pages
    git_push()


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
    subprocess.run(['git', 'add', 'index.html', 'data.json', 'price_history.json'], check=True)
    
    # Commit (may fail if no changes)
    result = subprocess.run(
        ['git', 'commit', '-m', f'Price update {datetime.now().strftime("%Y-%m-%d %H:%M")}'],
        capture_output=True, text=True
    )
    
    if result.returncode == 0:
        print("Committed changes")
        # Push
        push_result = subprocess.run(['git', 'push', 'origin', 'main'], capture_output=True, text=True)
        if push_result.returncode == 0:
            print("Pushed to GitHub")
        else:
            print(f"Push failed: {push_result.stderr}")
    else:
        print("No changes to commit")


if __name__ == '__main__':
    main()
