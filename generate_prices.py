"""
Generate prices.js with raw market data for client-side calculations.
Includes 7-day rolling price history indexed by item:level.
"""

import json
import requests
from datetime import datetime
from pathlib import Path

PRICE_HISTORY_FILE = Path(__file__).parent / 'price_history_v2.json'
OUTPUT_FILE = Path(__file__).parent / 'prices.js'

# 7 days in seconds
HISTORY_WINDOW = 7 * 24 * 60 * 60


def load_price_history():
    """Load price history from file."""
    if PRICE_HISTORY_FILE.exists():
        with open(PRICE_HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'history': {}, 'lastMarketTs': 0}


def save_price_history(data):
    """Save price history to file."""
    with open(PRICE_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f)


def prune_history(history, now_ts):
    """
    Prune old entries from history.
    Keep: all entries within 7 days + 1 baseline entry older than 7 days.
    """
    cutoff = now_ts - HISTORY_WINDOW
    pruned = {}
    
    for key, entries in history.items():
        if not entries:
            continue
        
        # Split into recent and old
        recent = [e for e in entries if e['t'] >= cutoff]
        old = [e for e in entries if e['t'] < cutoff]
        
        # Keep recent + 1 baseline from old (most recent old entry)
        if old:
            old.sort(key=lambda x: x['t'], reverse=True)
            recent.append(old[0])
        
        if recent:
            # Sort by timestamp descending (newest first)
            recent.sort(key=lambda x: x['t'], reverse=True)
            pruned[key] = recent
    
    return pruned


def update_history(market_data, history_data):
    """
    Update price history with new market data.
    Returns (updated_history_data, is_new_data, change_count).
    """
    market_ts = market_data.get('timestamp', 0)
    now_ts = int(datetime.now().timestamp())
    
    is_new_data = market_ts != history_data.get('lastMarketTs', 0)
    
    if not is_new_data:
        return history_data, False, 0
    
    history = history_data.get('history', {})
    changes = 0
    
    for item_hrid, levels in market_data.get('marketData', {}).items():
        for level_str, prices in levels.items():
            bid = prices.get('b', -1)
            if bid == -1:
                continue
            
            key = f"{item_hrid}:{level_str}"
            
            # Get current history for this item:level
            entries = history.get(key, [])
            
            # Check if price changed
            current_price = entries[0]['p'] if entries else None
            
            if current_price != bid:
                # Add new entry
                entries.insert(0, {'p': bid, 't': market_ts})
                history[key] = entries
                changes += 1
    
    # Prune old entries
    history = prune_history(history, now_ts)
    
    history_data['history'] = history
    history_data['lastMarketTs'] = market_ts
    history_data['lastUpdateTs'] = now_ts
    
    return history_data, True, changes


def generate_prices_js(market_data, history_data):
    """Generate prices.js content."""
    now_ts = int(datetime.now().timestamp())
    market_ts = market_data.get('timestamp', 0)
    
    # Build market prices object (current bid/ask)
    market = {}
    for item_hrid, levels in market_data.get('marketData', {}).items():
        item_prices = {}
        for level_str, prices in levels.items():
            ask = prices.get('a', -1)
            bid = prices.get('b', -1)
            if ask != -1 or bid != -1:
                item_prices[level_str] = {}
                if ask != -1:
                    item_prices[level_str]['a'] = ask
                if bid != -1:
                    item_prices[level_str]['b'] = bid
        if item_prices:
            market[item_hrid] = item_prices
    
    output = {
        'market': market,
        'history': history_data.get('history', {}),
        'ts': market_ts,
        'generated': now_ts,
    }
    
    json_content = json.dumps(output, separators=(',', ':'))
    return f"window.PRICES = {json_content};"


def main():
    print("Fetching market data...")
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    market_ts = market_data.get('timestamp', 0)
    print(f"  Market timestamp: {datetime.fromtimestamp(market_ts)}")
    
    print("Loading price history...")
    history_data = load_price_history()
    
    print("Updating history...")
    history_data, is_new_data, changes = update_history(market_data, history_data)
    
    if is_new_data:
        print(f"  New data! {changes} price changes recorded")
        save_price_history(history_data)
    else:
        print("  No new market data")
    
    print("Generating prices.js...")
    prices_js = generate_prices_js(market_data, history_data)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(prices_js)
    
    size_kb = len(prices_js) / 1024
    history_count = sum(len(v) for v in history_data.get('history', {}).values())
    print(f"  Generated {OUTPUT_FILE} ({size_kb:.1f} KB)")
    print(f"  {len(history_data.get('history', {}))} items tracked, {history_count} total history entries")
    
    return is_new_data


if __name__ == '__main__':
    main()
