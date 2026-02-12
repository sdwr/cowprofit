"""
Generate static HTML site with enhancement profit rankings.
Supports multiple price modes and sortable columns.
"""

import json
import requests
from datetime import datetime
from pathlib import Path
from enhance_calc import EnhancementCalculator, PriceMode

# Target enhancement levels to calculate
TARGET_LEVELS = [8, 10, 12, 14]

# Minimum profit to show (filter out tiny profits)
MIN_PROFIT = 1_000_000  # 1M coins
MAX_ROI = 1000  # Filter unrealistic ROI


def format_coins(value):
    """Format coin value with K/M/B suffix."""
    if abs(value) >= 1_000_000_000:
        return f"{value/1_000_000_000:.1f}B"
    elif abs(value) >= 1_000_000:
        return f"{value/1_000_000:.1f}M"
    elif abs(value) >= 1_000:
        return f"{value/1_000:.1f}K"
    else:
        return f"{value:.0f}"


def generate_html(timestamp, data_by_mode):
    """Generate the full HTML page with embedded data for all modes."""
    
    # Convert data to JSON for embedding
    json_data = json.dumps(data_by_mode)
    
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
        .container {{ max-width: 1400px; margin: 0 auto; }}
        h1 {{
            text-align: center;
            color: #eeb357;
            margin-bottom: 5px;
            font-size: 2rem;
        }}
        .subtitle {{
            text-align: center;
            color: #888;
            margin-bottom: 20px;
            font-size: 0.9rem;
        }}
        .controls {{
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-bottom: 20px;
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
            gap: 30px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }}
        .stat {{
            background: rgba(255,255,255,0.05);
            padding: 10px 20px;
            border-radius: 8px;
            text-align: center;
        }}
        .stat-value {{ font-size: 1.5rem; color: #eeb357; font-weight: bold; }}
        .stat-label {{ font-size: 0.8rem; color: #888; }}
        .filters {{
            display: flex;
            justify-content: center;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }}
        .filter-btn, .mode-btn {{
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: #e8e8e8;
            padding: 8px 16px;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.9rem;
        }}
        .filter-btn:hover, .filter-btn.active,
        .mode-btn:hover, .mode-btn.active {{
            background: #eeb357;
            color: #1a1a2e;
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
            padding: 12px 8px;
            text-align: left;
            font-weight: 600;
            font-size: 0.85rem;
            white-space: nowrap;
            cursor: pointer;
            user-select: none;
            position: relative;
        }}
        th:hover {{
            background: rgba(238,179,87,0.35);
        }}
        th .sort-arrow {{
            margin-left: 4px;
            opacity: 0.5;
        }}
        th.sorted .sort-arrow {{
            opacity: 1;
        }}
        td {{
            padding: 10px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.9rem;
        }}
        tr:hover {{ background: rgba(255,255,255,0.05); }}
        .positive {{ color: #4ade80; }}
        .negative {{ color: #f87171; }}
        .neutral {{ color: #888; }}
        .item-name {{ font-weight: 500; }}
        .level-badge {{
            background: rgba(238,179,87,0.3);
            color: #eeb357;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.8rem;
            font-weight: bold;
        }}
        .number {{ text-align: right; font-family: 'SF Mono', Monaco, monospace; }}
        .footer {{
            text-align: center;
            margin-top: 30px;
            padding: 20px;
            color: #666;
            font-size: 0.8rem;
        }}
        .footer a {{ color: #eeb357; text-decoration: none; }}
        .footer a:hover {{ text-decoration: underline; }}
        .mode-info {{
            text-align: center;
            color: #666;
            font-size: 0.75rem;
            margin-top: -10px;
            margin-bottom: 15px;
        }}
        @media (max-width: 768px) {{
            table {{ font-size: 0.75rem; }}
            th, td {{ padding: 8px 4px; }}
            .hide-mobile {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>&#x1F404; CowProfit</h1>
        <p class="subtitle">MWI Enhancement Profit Tracker | Market data: {timestamp} (updates every ~15 min)</p>
        
        <div class="controls">
            <div class="control-group">
                <span class="control-label">Price Mode:</span>
                <button class="mode-btn active" onclick="setMode('pessimistic')" id="btn-pessimistic">Pessimistic</button>
                <button class="mode-btn" onclick="setMode('midpoint')" id="btn-midpoint">Midpoint</button>
                <button class="mode-btn" onclick="setMode('optimistic')" id="btn-optimistic">Optimistic</button>
            </div>
        </div>
        <p class="mode-info" id="mode-info">Buy at Ask, Sell at Bid (safest estimate)</p>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-value" id="stat-profitable">-</div>
                <div class="stat-label">Profitable Items</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="stat-roi">-</div>
                <div class="stat-label">Best ROI</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="stat-profit">-</div>
                <div class="stat-label">Top Profit</div>
            </div>
        </div>
        
        <div class="filters">
            <button class="filter-btn active" onclick="filterLevel('all')">All</button>
            <button class="filter-btn" onclick="filterLevel(8)">+8</button>
            <button class="filter-btn" onclick="filterLevel(10)">+10</button>
            <button class="filter-btn" onclick="filterLevel(12)">+12</button>
            <button class="filter-btn" onclick="filterLevel(14)">+14</button>
        </div>
        
        <table id="results">
            <thead>
                <tr>
                    <th onclick="sortTable(0, 'num')">#<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(1, 'str')">Item<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(2, 'num')">Lvl<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(3, 'num')" class="number hide-mobile">Buy<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(4, 'num')" class="number hide-mobile">Enhance<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(5, 'num')" class="number">Total Cost<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(6, 'num')" class="number">Sell<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(7, 'num')" class="number">Profit<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(8, 'num')" class="number">ROI<span class="sort-arrow">&#9650;</span></th>
                </tr>
            </thead>
            <tbody id="table-body">
            </tbody>
        </table>
        
        <div class="footer">
            <p>Data from <a href="https://www.milkywayidle.com" target="_blank">Milky Way Idle</a> market API</p>
            <p>Calculations based on <a href="https://doh-nuts.github.io/Enhancelator/" target="_blank">Enhancelator</a></p>
            <p>Gear: Celestial +14, Gloves +10, Pouch +8, Top/Bot +8, Neck +7, Adv Charm +6, Skill 125</p>
        </div>
    </div>
    
    <script>
        const allData = {json_data};
        let currentMode = 'pessimistic';
        let currentLevel = 'all';
        let sortCol = 7; // Default sort by profit
        let sortAsc = false;
        
        const modeInfo = {{
            'pessimistic': 'Buy at Ask, Sell at Bid (safest estimate)',
            'midpoint': 'Buy/Sell at midpoint of Ask and Bid',
            'optimistic': 'Buy at Bid, Sell at Ask (best case)'
        }};
        
        function formatCoins(value) {{
            if (Math.abs(value) >= 1e9) return (value/1e9).toFixed(1) + 'B';
            if (Math.abs(value) >= 1e6) return (value/1e6).toFixed(1) + 'M';
            if (Math.abs(value) >= 1e3) return (value/1e3).toFixed(1) + 'K';
            return value.toFixed(0);
        }}
        
        function setMode(mode) {{
            currentMode = mode;
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('btn-' + mode).classList.add('active');
            document.getElementById('mode-info').textContent = modeInfo[mode];
            renderTable();
        }}
        
        function filterLevel(level) {{
            currentLevel = level;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            renderTable();
        }}
        
        function sortTable(col, type) {{
            if (sortCol === col) {{
                sortAsc = !sortAsc;
            }} else {{
                sortCol = col;
                sortAsc = (col <= 2); // Ascending for #, name, level; descending for numbers
            }}
            renderTable();
        }}
        
        function renderTable() {{
            const data = allData[currentMode] || [];
            
            // Filter by level
            let filtered = currentLevel === 'all' ? data : 
                data.filter(r => r.target_level == currentLevel);
            
            // Sort
            const sortKeys = ['_idx', 'item_name', 'target_level', 'base_price', 'mat_cost', 'total_cost', 'sell_price', 'profit', 'roi'];
            filtered = filtered.map((r, i) => ({{...r, _idx: i + 1}}));
            filtered.sort((a, b) => {{
                let va = a[sortKeys[sortCol]];
                let vb = b[sortKeys[sortCol]];
                if (typeof va === 'string') {{
                    return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                }}
                return sortAsc ? va - vb : vb - va;
            }});
            
            // Update stats
            const profitable = data.filter(r => r.profit > 1000000 && r.roi < 1000);
            const bestProfit = data.length ? Math.max(...data.map(r => r.profit)) : 0;
            const bestRoi = profitable.length ? Math.max(...profitable.map(r => r.roi)) : 0;
            
            document.getElementById('stat-profitable').textContent = profitable.length;
            document.getElementById('stat-roi').textContent = bestRoi.toFixed(0) + '%';
            document.getElementById('stat-profit').textContent = formatCoins(bestProfit);
            
            // Render rows
            const tbody = document.getElementById('table-body');
            tbody.innerHTML = filtered.slice(0, 200).map((r, i) => {{
                const profitClass = r.profit > 0 ? 'positive' : r.profit < 0 ? 'negative' : 'neutral';
                return `<tr data-level="${{r.target_level}}">
                    <td>${{i + 1}}</td>
                    <td class="item-name">${{r.item_name}}</td>
                    <td><span class="level-badge">+${{r.target_level}}</span></td>
                    <td class="number hide-mobile">${{formatCoins(r.base_price)}}</td>
                    <td class="number hide-mobile">${{formatCoins(r.mat_cost)}}</td>
                    <td class="number">${{formatCoins(r.total_cost)}}</td>
                    <td class="number">${{formatCoins(r.sell_price)}}</td>
                    <td class="number ${{profitClass}}">${{formatCoins(r.profit)}}</td>
                    <td class="number ${{profitClass}}">${{r.roi.toFixed(1)}}%</td>
                </tr>`;
            }}).join('');
            
            // Update sort arrows
            document.querySelectorAll('th').forEach((th, i) => {{
                th.classList.toggle('sorted', i === sortCol);
                const arrow = th.querySelector('.sort-arrow');
                if (arrow) arrow.innerHTML = (i === sortCol && sortAsc) ? '&#9650;' : '&#9660;';
            }});
        }}
        
        // Initial render
        renderTable();
    </script>
</body>
</html>
'''


def main():
    print("Fetching market data...")
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    timestamp = datetime.fromtimestamp(market_data.get('timestamp', 0))
    
    print("Loading game data...")
    calc = EnhancementCalculator('init_client_info.json')
    
    print(f"Calculating profits for {len(calc.enhanceable_items)} items in all price modes...")
    
    # Calculate for all modes
    all_modes = calc.get_all_profits_all_modes(market_data, TARGET_LEVELS)
    
    # Filter each mode
    for mode in all_modes:
        all_modes[mode] = [r for r in all_modes[mode] if r['roi'] < MAX_ROI]
    
    profitable_count = len([r for r in all_modes['pessimistic'] if r['profit'] > MIN_PROFIT])
    print(f"Found {profitable_count} profitable opportunities (pessimistic)")
    
    # Generate HTML
    html = generate_html(
        timestamp=timestamp.strftime('%Y-%m-%d %H:%M UTC'),
        data_by_mode=all_modes
    )
    
    # Write HTML
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("Generated index.html")
    
    # Write JSON data
    with open('data.json', 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': market_data.get('timestamp'),
            'generated': datetime.now().isoformat(),
            'modes': {
                mode: results[:100] for mode, results in all_modes.items()
            },
            'stats': {
                'pessimistic': {
                    'profitable_count': len([r for r in all_modes['pessimistic'] if r['profit'] > MIN_PROFIT]),
                },
                'midpoint': {
                    'profitable_count': len([r for r in all_modes['midpoint'] if r['profit'] > MIN_PROFIT]),
                },
                'optimistic': {
                    'profitable_count': len([r for r in all_modes['optimistic'] if r['profit'] > MIN_PROFIT]),
                },
            }
        }, f, indent=2)
    print("Generated data.json")
    
    # Print top 5 for each mode
    for mode_name in ['pessimistic', 'midpoint', 'optimistic']:
        results = all_modes[mode_name]
        profitable = [r for r in results if r['profit'] > MIN_PROFIT]
        print(f"\n=== Top 5 {mode_name.upper()} ===")
        for i, r in enumerate(profitable[:5], 1):
            print(f"{i}. {r['item_name']} +{r['target_level']}: {format_coins(r['profit'])} ({r['roi']:.1f}%)")


if __name__ == '__main__':
    main()
