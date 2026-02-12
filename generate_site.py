"""
Generate static HTML site with enhancement profit rankings.
"""

import json
import requests
from datetime import datetime
from pathlib import Path
from enhance_calc import EnhancementCalculator, PriceMode

TARGET_LEVELS = [8, 10, 12, 14]
MIN_PROFIT = 1_000_000
MAX_ROI = 1000


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


def generate_html(timestamp, data_by_mode):
    """Generate the full HTML page."""
    
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
        .container {{ max-width: 1800px; margin: 0 auto; }}
        h1 {{
            text-align: center;
            color: #eeb357;
            margin-bottom: 5px;
            font-size: 2rem;
        }}
        .subtitle {{
            text-align: center;
            color: #888;
            margin-bottom: 15px;
            font-size: 0.9rem;
        }}
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
            margin-bottom: 15px;
            flex-wrap: wrap;
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
        .filter-btn:hover, .filter-btn.active,
        .mode-btn:hover, .mode-btn.active {{
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
        tr:hover {{ background: rgba(255,255,255,0.05); }}
        .positive {{ color: #4ade80; }}
        .negative {{ color: #f87171; }}
        .neutral {{ color: #888; }}
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
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>&#x1F404; CowProfit</h1>
        <p class="subtitle">MWI Enhancement Profit Tracker | Market data: {timestamp} (updates ~15 min)</p>
        
        <div class="controls">
            <div class="control-group">
                <span class="control-label">Price:</span>
                <button class="mode-btn active" onclick="setMode('pessimistic')" id="btn-pessimistic">Pessimistic</button>
                <button class="mode-btn" onclick="setMode('midpoint')" id="btn-midpoint">Midpoint</button>
                <button class="mode-btn" onclick="setMode('optimistic')" id="btn-optimistic">Optimistic</button>
            </div>
            <div class="control-group">
                <button class="toggle-btn" onclick="toggleFee()" id="btn-fee">-2% Fee</button>
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
                    <th onclick="sortTable(3, 'num')" class="number">Buy<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(4, 'num')" class="number hide-mobile">Enhance<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(5, 'num')" class="number hide-mobile">Total<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(6, 'num')" class="number">Sell<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(7, 'num')" class="number">Profit<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(8, 'num')" class="number">ROI<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(9, 'num')" class="number hide-mobile">Days<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(10, 'num')" class="number">$/day<span class="sort-arrow">&#9650;</span></th>
                    <th onclick="sortTable(11, 'num')" class="number hide-mobile">XP/day<span class="sort-arrow">&#9650;</span></th>
                </tr>
            </thead>
            <tbody id="table-body">
            </tbody>
        </table>
        
        <div class="footer">
            <p>Data from <a href="https://www.milkywayidle.com" target="_blank">Milky Way Idle</a> | Math from <a href="https://doh-nuts.github.io/Enhancelator/" target="_blank">Enhancelator</a></p>
            <p>Celestial +14 | Gloves +10 | Pouch +8 | Top/Bot +8 | Neck +7 | Adv Charm +6 | Skill 125 | Observatory +8</p>
            <p>Teas: Ultra Enhancing, Blessed, Wisdom, Artisan (11.2% mat reduction)</p>
        </div>
    </div>
    
    <script>
        const allData = {json_data};
        let currentMode = 'pessimistic';
        let currentLevel = 'all';
        let sortCol = 7;
        let sortAsc = false;
        let showFee = false;
        
        const modeInfo = {{
            'pessimistic': 'Buy at Ask, Sell at Bid (safest estimate)',
            'midpoint': 'Buy/Sell at midpoint of Ask and Bid',
            'optimistic': 'Buy at Bid, Sell at Ask (best case)'
        }};
        
        function formatCoins(value) {{
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
        
        function toggleFee() {{
            showFee = !showFee;
            document.getElementById('btn-fee').classList.toggle('active', showFee);
            renderTable();
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
                sortAsc = (col <= 2);
            }}
            renderTable();
        }}
        
        function renderTable() {{
            const data = allData[currentMode] || [];
            
            let filtered = currentLevel === 'all' ? data : 
                data.filter(r => r.target_level == currentLevel);
            
            // Choose profit field based on fee toggle
            const profitKey = showFee ? 'profit_after_fee' : 'profit';
            const profitDayKey = showFee ? 'profit_per_day_after_fee' : 'profit_per_day';
            
            const sortKeys = ['_idx', 'item_name', 'target_level', 'base_price', 'mat_cost', 'total_cost', 'sell_price', profitKey, 'roi', 'time_days', profitDayKey, 'xp_per_day'];
            filtered = filtered.map((r, i) => ({{...r, _idx: i + 1, _profit: r[profitKey], _profit_day: r[profitDayKey]}}));
            filtered.sort((a, b) => {{
                let va = a[sortKeys[sortCol]] ?? a['_profit'];
                let vb = b[sortKeys[sortCol]] ?? b['_profit'];
                if (typeof va === 'string') {{
                    return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                }}
                return sortAsc ? va - vb : vb - va;
            }});
            
            const profitable = data.filter(r => r[profitKey] > 1000000 && r.roi < 1000);
            const bestProfit = profitable.length ? Math.max(...profitable.map(r => r[profitKey])) : 0;
            const bestRoi = profitable.length ? Math.max(...profitable.map(r => r.roi)) : 0;
            const bestProfitDay = profitable.length ? Math.max(...profitable.map(r => r[profitDayKey])) : 0;
            const bestXpDay = data.length ? Math.max(...data.map(r => r.xp_per_day)) : 0;
            
            document.getElementById('stat-profitable').textContent = profitable.length;
            document.getElementById('stat-roi').textContent = bestRoi.toFixed(0) + '%';
            document.getElementById('stat-profit').textContent = formatCoins(bestProfit);
            document.getElementById('stat-profitday').textContent = formatCoins(bestProfitDay);
            document.getElementById('stat-xpday').textContent = formatXP(bestXpDay);
            
            const tbody = document.getElementById('table-body');
            tbody.innerHTML = filtered.slice(0, 400).map((r, i) => {{
                const profit = showFee ? r.profit_after_fee : r.profit;
                const profitDay = showFee ? r.profit_per_day_after_fee : r.profit_per_day;
                const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
                const sourceClass = r.base_source === 'market' ? 'source-market' : r.base_source === 'craft' ? 'source-craft' : 'source-vendor';
                return `<tr data-level="${{r.target_level}}">
                    <td>${{i + 1}}</td>
                    <td class="item-name">${{r.item_name}}</td>
                    <td><span class="level-badge">+${{r.target_level}}</span></td>
                    <td class="number"><span class="price-source ${{sourceClass}}"></span>${{formatCoins(r.base_price)}}</td>
                    <td class="number hide-mobile">${{formatCoins(r.mat_cost)}}</td>
                    <td class="number hide-mobile">${{formatCoins(r.total_cost)}}</td>
                    <td class="number">${{formatCoins(r.sell_price)}}</td>
                    <td class="number ${{profitClass}}">${{formatCoins(profit)}}</td>
                    <td class="number ${{profitClass}}">${{r.roi.toFixed(1)}}%</td>
                    <td class="number hide-mobile">${{r.time_days.toFixed(2)}}</td>
                    <td class="number ${{profitClass}}">${{formatCoins(profitDay)}}</td>
                    <td class="number hide-mobile">${{formatXP(r.xp_per_day)}}</td>
                </tr>`;
            }}).join('');
            
            document.querySelectorAll('th').forEach((th, i) => {{
                th.classList.toggle('sorted', i === sortCol);
                const arrow = th.querySelector('.sort-arrow');
                if (arrow) arrow.innerHTML = (i === sortCol && sortAsc) ? '&#9650;' : '&#9660;';
            }});
        }}
        
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
    
    print(f"Calculating profits for {len(calc.enhanceable_items)} items...")
    
    all_modes = calc.get_all_profits_all_modes(market_data, TARGET_LEVELS)
    
    for mode in all_modes:
        all_modes[mode] = [r for r in all_modes[mode] if r['roi'] < MAX_ROI]
    
    profitable_count = len([r for r in all_modes['pessimistic'] if r['profit'] > MIN_PROFIT])
    print(f"Found {profitable_count} profitable opportunities (pessimistic)")
    
    html = generate_html(
        timestamp=timestamp.strftime('%Y-%m-%d %H:%M UTC'),
        data_by_mode=all_modes
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
        profitable = [r for r in results if r['profit'] > MIN_PROFIT]
        print(f"\n=== Top 5 {mode_name.upper()} ===")
        for i, r in enumerate(profitable[:5], 1):
            print(f"{i}. {r['item_name']} +{r['target_level']}: {format_coins(r['profit'])} ({r['roi']:.1f}%) - {format_coins(r['profit_per_day'])}/day - {format_coins(r['xp_per_day'])} XP/day")


if __name__ == '__main__':
    main()
