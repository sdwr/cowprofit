"""
Generate static HTML site with enhancement profit rankings.
"""

import json
import requests
from datetime import datetime
from pathlib import Path
from enhance_calc import EnhancementCalculator

# Target enhancement levels to calculate
TARGET_LEVELS = [8, 10, 12, 14]

# Minimum profit to show (filter out tiny profits)
MIN_PROFIT = 1_000_000  # 1M coins


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


def generate_table_rows(results):
    """Generate HTML table rows from results."""
    rows = []
    for i, r in enumerate(results, 1):
        profit_class = "positive" if r['profit'] > 0 else "negative" if r['profit'] < 0 else "neutral"
        roi_class = profit_class
        
        row = f'''<tr data-level="{r['target_level']}">
            <td>{i}</td>
            <td class="item-name">{r['item_name']}</td>
            <td><span class="level-badge">+{r['target_level']}</span></td>
            <td class="number hide-mobile">{format_coins(r['base_price'])}</td>
            <td class="number hide-mobile">{format_coins(r['mat_cost'])}</td>
            <td class="number">{format_coins(r['total_cost'])}</td>
            <td class="number">{format_coins(r['sell_price'])}</td>
            <td class="number {profit_class}">{format_coins(r['profit'])}</td>
            <td class="number {roi_class}">{r['roi']:.1f}%</td>
        </tr>'''
        rows.append(row)
    
    return '\n'.join(rows)


def generate_html(timestamp, profitable_count, best_roi, best_profit, table_rows):
    """Generate the full HTML page."""
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MWI Enhancement Profit Tracker</title>
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
            margin-bottom: 10px;
            font-size: 2rem;
        }}
        .subtitle {{
            text-align: center;
            color: #888;
            margin-bottom: 20px;
            font-size: 0.9rem;
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
        .filter-btn {{
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: #e8e8e8;
            padding: 8px 16px;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.2s;
        }}
        .filter-btn:hover, .filter-btn.active {{
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
        @media (max-width: 768px) {{
            table {{ font-size: 0.75rem; }}
            th, td {{ padding: 8px 4px; }}
            .hide-mobile {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>&#11088; MWI Enhancement Profit Tracker</h1>
        <p class="subtitle">Updated: {timestamp}</p>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-value">{profitable_count}</div>
                <div class="stat-label">Profitable Items</div>
            </div>
            <div class="stat">
                <div class="stat-value">{best_roi:.0f}%</div>
                <div class="stat-label">Best ROI</div>
            </div>
            <div class="stat">
                <div class="stat-value">{format_coins(best_profit)}</div>
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
                    <th>#</th>
                    <th>Item</th>
                    <th>Level</th>
                    <th class="number hide-mobile">Buy Price</th>
                    <th class="number hide-mobile">Enhance Cost</th>
                    <th class="number">Total Cost</th>
                    <th class="number">Sell Price</th>
                    <th class="number">Profit</th>
                    <th class="number">ROI</th>
                </tr>
            </thead>
            <tbody>
                {table_rows}
            </tbody>
        </table>
        
        <div class="footer">
            <p>Data from <a href="https://www.milkywayidle.com" target="_blank">Milky Way Idle</a> market API</p>
            <p>Calculations based on <a href="https://doh-nuts.github.io/Enhancelator/" target="_blank">Enhancelator</a></p>
            <p>Gear: Celestial +14, Gloves +10, Pouch +8, Top/Bot +8, Neck +7, Adv Charm +6, Skill 125</p>
        </div>
    </div>
    
    <script>
        function filterLevel(level) {{
            const rows = document.querySelectorAll('#results tbody tr');
            const btns = document.querySelectorAll('.filter-btn');
            btns.forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            rows.forEach(row => {{
                if (level === 'all' || row.dataset.level == level) {{
                    row.style.display = '';
                }} else {{
                    row.style.display = 'none';
                }}
            }});
        }}
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
    results = calc.get_all_profits(market_data, TARGET_LEVELS)
    
    # Filter to profitable items with reasonable ROI (filter bad market data)
    MAX_ROI = 1000  # Ignore items with >1000% ROI (likely bad data)
    profitable = [r for r in results if r['profit'] > MIN_PROFIT and r['roi'] < MAX_ROI]
    
    # Also include top losses for reference
    losses = [r for r in results if r['profit'] < -MIN_PROFIT]
    losses.sort(key=lambda x: x['profit'])  # Most negative first
    
    # Combine: profitable first, then top 20 losses
    display_results = profitable + losses[:20]
    
    print(f"Found {len(profitable)} profitable opportunities")
    
    # Calculate stats
    best_profit = max(r['profit'] for r in results) if results else 0
    best_roi = max(r['roi'] for r in results if r['profit'] > 0) if profitable else 0
    
    # Generate HTML
    table_rows = generate_table_rows(display_results)
    html = generate_html(
        timestamp=timestamp.strftime('%Y-%m-%d %H:%M UTC'),
        profitable_count=len(profitable),
        best_roi=best_roi,
        best_profit=best_profit,
        table_rows=table_rows
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
            'results': results[:100],  # Top 100
            'stats': {
                'total_items': len(results),
                'profitable_count': len(profitable),
                'best_profit': best_profit,
                'best_roi': best_roi,
            }
        }, f, indent=2)
    print("Generated data.json")
    
    # Print top 10
    print("\n=== Top 10 Profitable Enhancements ===\n")
    for i, r in enumerate(profitable[:10], 1):
        print(f"{i}. {r['item_name']} +{r['target_level']}")
        print(f"   Cost: {format_coins(r['total_cost'])} | Sell: {format_coins(r['sell_price'])} | Profit: {format_coins(r['profit'])} ({r['roi']:.1f}%)")


if __name__ == '__main__':
    main()
