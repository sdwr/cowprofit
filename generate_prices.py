"""
Generate prices.js — market prices + 7-day rolling price history.

Data flow:
  1. Read existing prices.js (contains history from last run)
  2. Fetch fresh market data from MWI API
  3. Diff current vs previous prices, record changes in history
  4. Prune history entries older than 7 days
  5. Write updated prices.js (market + history + timestamps)
  6. Git commit & push happens externally (cron job)

prices.js format (assigned to window.PRICES):
  {
    market: { "<item_hrid>": { "<level>": { a: <ask>, b: <bid> } } },
    history: { "<item_hrid>:<level>": { b: [{p, t}, ...], a: [{p, t}, ...] } },
    ts: <market_timestamp>,
    generated: <generation_timestamp>
  }

History entries are sorted newest-first. Only price *changes* are recorded.
One baseline entry older than 7 days is kept per item for age calculation.
"""

import json
import requests
from datetime import datetime
from pathlib import Path

OUTPUT_FILE = Path(__file__).parent / 'prices.js'
HISTORY_WINDOW = 7 * 24 * 60 * 60  # 7 days in seconds


def load_previous_state():
    """Load history and last market timestamp from existing prices.js."""
    if not OUTPUT_FILE.exists():
        return {'history': {}, 'lastMarketTs': 0}

    raw = OUTPUT_FILE.read_text(encoding='utf-8')
    prefix = 'window.PRICES = '
    if not raw.startswith(prefix):
        return {'history': {}, 'lastMarketTs': 0}

    try:
        obj = json.loads(raw[len(prefix):-1])  # strip trailing ;
        return {
            'history': obj.get('history', {}),
            'lastMarketTs': obj.get('ts', 0),
        }
    except (json.JSONDecodeError, ValueError):
        return {'history': {}, 'lastMarketTs': 0}


def prune_list(entries, cutoff):
    """
    Keep entries within 7 days + 1 baseline entry beyond the window.
    Returns list sorted newest-first.
    """
    if not entries:
        return []

    recent = [e for e in entries if e['t'] >= cutoff]
    old = [e for e in entries if e['t'] < cutoff]

    if old:
        old.sort(key=lambda x: x['t'], reverse=True)
        recent.append(old[0])

    recent.sort(key=lambda x: x['t'], reverse=True)
    return recent


def prune_history(history, now_ts):
    """Prune all history entries, dropping items with no remaining data."""
    cutoff = now_ts - HISTORY_WINDOW
    pruned = {}

    for key, entry in history.items():
        b_list = prune_list(entry.get('b', []), cutoff)
        a_list = prune_list(entry.get('a', []), cutoff)
        if b_list or a_list:
            pruned[key] = {'b': b_list, 'a': a_list}

    return pruned


def update_history(market_data, state):
    """
    Compare fresh market data against previous state.
    Record bid/ask changes in history.
    Returns (updated_state, is_new_data, change_count).
    """
    market_ts = market_data.get('timestamp', 0)
    now_ts = int(datetime.now().timestamp())

    if market_ts == state.get('lastMarketTs', 0):
        return state, False, 0

    history = state.get('history', {})
    changes = 0

    for item_hrid, levels in market_data.get('marketData', {}).items():
        for level_str, price_data in levels.items():
            bid = price_data.get('b', -1)
            ask = price_data.get('a', -1)

            if bid == -1 and ask == -1:
                continue

            key = f"{item_hrid}:{level_str}"
            entry = history.get(key, {'b': [], 'a': []})

            if bid != -1:
                b_list = entry.get('b', [])
                current_bid = b_list[0]['p'] if b_list else None
                if current_bid != bid:
                    b_list.insert(0, {'p': bid, 't': market_ts})
                    entry['b'] = b_list
                    changes += 1

            if ask != -1:
                a_list = entry.get('a', [])
                current_ask = a_list[0]['p'] if a_list else None
                if current_ask != ask:
                    a_list.insert(0, {'p': ask, 't': market_ts})
                    entry['a'] = a_list
                    changes += 1

            history[key] = entry

    history = prune_history(history, now_ts)

    state['history'] = history
    state['lastMarketTs'] = market_ts

    return state, True, changes


def build_prices_js(market_data, history, market_ts):
    """Build the prices.js file content."""
    now_ts = int(datetime.now().timestamp())

    market = {}
    for item_hrid, levels in market_data.get('marketData', {}).items():
        item_prices = {}
        for level_str, prices in levels.items():
            ask = prices.get('a', -1)
            bid = prices.get('b', -1)
            if ask != -1 or bid != -1:
                level_entry = {}
                if ask != -1:
                    level_entry['a'] = ask
                if bid != -1:
                    level_entry['b'] = bid
                item_prices[level_str] = level_entry
        if item_prices:
            market[item_hrid] = item_prices

    output = {
        'market': market,
        'history': history,
        'ts': market_ts,
        'generated': now_ts,
    }

    return f"window.PRICES = {json.dumps(output, separators=(',', ':'))};"


def main():
    print("Fetching market data...")
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    market_ts = market_data.get('timestamp', 0)
    print(f"  Market timestamp: {datetime.fromtimestamp(market_ts)}")

    print("Loading previous state from prices.js...")
    state = load_previous_state()
    prev_ts = state.get('lastMarketTs', 0)
    if prev_ts:
        print(f"  Previous market timestamp: {datetime.fromtimestamp(prev_ts)}")
    else:
        print("  No previous state (fresh start)")

    print("Updating history...")
    state, is_new_data, changes = update_history(market_data, state)

    if not is_new_data:
        print("  No new market data")

    if is_new_data:
        print(f"  {changes} price changes recorded")

    print("Writing prices.js...")
    prices_js = build_prices_js(market_data, state['history'], market_ts)

    OUTPUT_FILE.write_text(prices_js, encoding='utf-8')

    history = state['history']
    bid_entries = sum(len(v.get('b', [])) for v in history.values())
    ask_entries = sum(len(v.get('a', [])) for v in history.values())
    size_kb = len(prices_js) / 1024
    print(f"  {OUTPUT_FILE} ({size_kb:.1f} KB)")
    print(f"  {len(history)} items tracked, {bid_entries} bid + {ask_entries} ask history entries")

    # Also update volume.js using the same market data
    try:
        from generate_volume import load_previous_state as load_vol_state
        from generate_volume import update_volume, prune_volume, build_volume_js
        from generate_volume import OUTPUT_FILE as VOL_OUTPUT

        print("\nUpdating volume.js...")
        vol_state = load_vol_state()
        vol_state, vol_new, vol_count = update_volume(market_data, vol_state)
        now_ts = int(datetime.now().timestamp())
        vol_state['data'] = prune_volume(vol_state['data'], now_ts)
        vol_js = build_volume_js(vol_state['data'], market_ts)
        VOL_OUTPUT.write_text(vol_js, encoding='utf-8')

        total_items = len(vol_state['data'])
        total_entries = sum(len(v) for v in vol_state['data'].values())
        vol_kb = len(vol_js) / 1024
        print(f"  {VOL_OUTPUT} ({vol_kb:.1f} KB)")
        print(f"  {total_items} items, {total_entries} entries")
        if not vol_new:
            print("  (no new data)")
        else:
            print(f"  {vol_count} items with trades")
    except Exception as e:
        print(f"  Volume update failed: {e}")

    return is_new_data


if __name__ == '__main__':
    main()
