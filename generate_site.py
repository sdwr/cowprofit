"""
Generate data.js with enhancement profit rankings.
Includes price history tracking.
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
    Returns (updated_history, is_new_data, changes_list).
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


def generate_data_js(all_modes, player_stats, price_history_meta):
    """Generate the data.js file with all data as window.GAME_DATA."""
    data = {
        'modes': all_modes,
        'playerStats': player_stats,
        'lastCheckTs': price_history_meta.get('last_check_ts', 0),
        'lastMarketTs': price_history_meta.get('last_market_ts', 0),
        'updateHistory': price_history_meta.get('update_history', []),
        'generated': datetime.now().isoformat()
    }
    
    json_content = json.dumps(data)
    return f"window.GAME_DATA = {json_content};"


def main():
    print("Fetching market data...")
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    timestamp = datetime.fromtimestamp(market_data.get('timestamp', 0))
    
    # Update price history
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
    
    # Enrich with price age data
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
    
    # Timestamps for dynamic JavaScript calculation
    price_history_meta = {
        'last_check_ts': price_history.get('last_check_ts', now_ts),
        'last_market_ts': price_history.get('last_market_timestamp', now_ts),
        'update_history': price_history.get('update_history', [])
    }
    
    # Generate data.js
    data_js = generate_data_js(all_modes, player_stats, price_history_meta)
    
    with open('data.js', 'w', encoding='utf-8') as f:
        f.write(data_js)
    print("Generated data.js")
    
    # Also keep data.json for debugging/API use
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
    
    # Add files - now only data.js and price_history.json change
    subprocess.run(['git', 'add', 'data.js', 'data.json', 'price_history.json'], check=True)
    
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
