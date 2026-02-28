"""
Generate volume.js — rolling 24h trade volume + average price.

Data flow:
  1. Read existing volume.js (contains entries from previous runs)
  2. Fetch fresh market data from MWI API
  3. For each item with trades (v > 0): append [timestamp, avgPrice, volume]
  4. Prune entries older than 24 hours
  5. Write updated volume.js
  6. Git commit & push happens externally (cron job)

volume.js format (assigned to window.VOLUME):
  {
    data: {
      "<item_hrid>:<level>": [[timestamp, avgPrice, volume], ...],
    },
    ts: <market_timestamp>,
    generated: <generation_timestamp>
  }

Entries are sorted newest-first. Zero-volume updates are not stored.
Hard prune at 24h — no baseline entries kept.
"""

import json
import requests
from datetime import datetime
from pathlib import Path

OUTPUT_FILE = Path(__file__).parent / 'volume.js'
VOLUME_WINDOW = 24 * 60 * 60  # 24 hours in seconds


def load_previous_state():
    """Load volume data from existing volume.js."""
    if not OUTPUT_FILE.exists():
        return {'data': {}, 'lastTs': 0}

    raw = OUTPUT_FILE.read_text(encoding='utf-8')
    prefix = 'window.VOLUME = '
    if not raw.startswith(prefix):
        return {'data': {}, 'lastTs': 0}

    try:
        obj = json.loads(raw[len(prefix):-1])  # strip trailing ;
        return {
            'data': obj.get('data', {}),
            'lastTs': obj.get('ts', 0),
        }
    except (json.JSONDecodeError, ValueError):
        return {'data': {}, 'lastTs': 0}


def update_volume(market_data, state):
    """
    Append new volume entries from market data.
    Returns (updated_state, is_new_data, new_entries_count).
    """
    market_ts = market_data.get('timestamp', 0)

    if market_ts == state.get('lastTs', 0):
        return state, False, 0

    vol_data = state.get('data', {})
    new_entries = 0

    for item_hrid, levels in market_data.get('marketData', {}).items():
        for level_str, price_data in levels.items():
            v = price_data.get('v', 0)
            p = price_data.get('p', 0)

            if v <= 0 or p <= 0:
                continue

            key = f"{item_hrid}:{level_str}"
            entries = vol_data.get(key, [])
            entries.insert(0, [market_ts, p, v])
            vol_data[key] = entries
            new_entries += 1

    state['data'] = vol_data
    state['lastTs'] = market_ts

    return state, True, new_entries


def prune_volume(vol_data, now_ts):
    """Remove entries older than 24 hours. Drop empty items."""
    cutoff = now_ts - VOLUME_WINDOW
    pruned = {}

    for key, entries in vol_data.items():
        recent = [e for e in entries if e[0] >= cutoff]
        if recent:
            pruned[key] = recent

    return pruned


def build_volume_js(vol_data, market_ts):
    """Build the volume.js file content."""
    now_ts = int(datetime.now().timestamp())

    output = {
        'data': vol_data,
        'ts': market_ts,
        'generated': now_ts,
    }

    return f"window.VOLUME = {json.dumps(output, separators=(',', ':'))};"


def main():
    print("Fetching market data...")
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    market_ts = market_data.get('timestamp', 0)
    print(f"  Market timestamp: {datetime.fromtimestamp(market_ts)}")

    print("Loading previous volume data...")
    state = load_previous_state()
    prev_ts = state.get('lastTs', 0)
    if prev_ts:
        print(f"  Previous timestamp: {datetime.fromtimestamp(prev_ts)}")
    else:
        print("  No previous data (fresh start)")

    print("Updating volume...")
    state, is_new_data, new_entries = update_volume(market_data, state)

    if not is_new_data:
        print("  No new market data")
    else:
        print(f"  {new_entries} items with trades")

    now_ts = int(datetime.now().timestamp())
    state['data'] = prune_volume(state['data'], now_ts)

    print("Writing volume.js...")
    volume_js = build_volume_js(state['data'], market_ts)
    OUTPUT_FILE.write_text(volume_js, encoding='utf-8')

    total_items = len(state['data'])
    total_entries = sum(len(v) for v in state['data'].values())
    size_kb = len(volume_js) / 1024
    print(f"  {OUTPUT_FILE} ({size_kb:.1f} KB)")
    print(f"  {total_items} items tracked, {total_entries} total entries")

    return is_new_data


if __name__ == '__main__':
    main()
