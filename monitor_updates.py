#!/usr/bin/env python3
"""Monitor marketplace.json update times to find the pattern."""

import requests
import json
import time
from datetime import datetime
from pathlib import Path

LOG_FILE = Path('update_log.json')

def load_log():
    if LOG_FILE.exists():
        with open(LOG_FILE) as f:
            return json.load(f)
    return {'checks': [], 'updates': []}

def save_log(log):
    with open(LOG_FILE, 'w') as f:
        json.dump(log, f, indent=2)

def check_update():
    log = load_log()
    
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    data = resp.json()
    
    ts = data.get('timestamp', 0)
    data_time = datetime.fromtimestamp(ts)
    now = datetime.now()
    age_min = (now.timestamp() - ts) / 60
    
    check = {
        'check_time': now.isoformat(),
        'data_timestamp': ts,
        'data_time': data_time.isoformat(),
        'age_minutes': round(age_min, 1)
    }
    
    # Check if this is a new timestamp
    last_ts = log['checks'][-1]['data_timestamp'] if log['checks'] else None
    if last_ts != ts:
        check['is_new'] = True
        log['updates'].append({
            'detected_at': now.isoformat(),
            'data_time': data_time.isoformat(),
            'data_minute': data_time.minute
        })
        print(f"[NEW] Data updated: {data_time} (minute: {data_time.minute})")
    else:
        check['is_new'] = False
        print(f"[---] Same data: {data_time} (age: {age_min:.1f} min)")
    
    log['checks'].append(check)
    
    # Keep only last 200 checks
    log['checks'] = log['checks'][-200:]
    
    save_log(log)
    
    # Print update pattern if we have data
    if len(log['updates']) >= 2:
        print(f"\nUpdates detected: {len(log['updates'])}")
        for u in log['updates'][-5:]:
            print(f"   {u['data_time']} (minute: {u['data_minute']})")

if __name__ == '__main__':
    check_update()
