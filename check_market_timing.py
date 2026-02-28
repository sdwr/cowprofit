import requests, time, sys
from datetime import datetime

item = '/items/abyssal_essence'

print("Polling every 60s...", flush=True)

last_ts = None
last_v = None
checks = []

for i in range(120):
    try:
        r = requests.get('https://www.milkywayidle.com/game_data/marketplace.json', timeout=10)
        data = r.json()
        ts = data['timestamp']
        v = data['marketData'][item]['0']['v']
        p = data['marketData'][item]['0']['p']
        now = datetime.now().strftime('%H:%M:%S')

        if ts != last_ts:
            ts_str = datetime.fromtimestamp(ts).strftime('%H:%M:%S')
            gap = ""
            if last_ts:
                gap = f" (gap {(ts - last_ts)/60:.0f}min)"
            vd = ""
            if last_v is not None:
                vd = f" vdelta={v - last_v:+,}"
            print(f"[{now}] NEW ts={ts_str}{gap} vol={v:,}{vd} p={p:,}", flush=True)
            last_ts = ts
            last_v = v
            checks.append(ts)
        else:
            if i % 5 == 0:
                print(f"[{now}] same ts (waiting...)", flush=True)
    except Exception as e:
        print(f"Error: {e}", flush=True)

    time.sleep(60)

if len(checks) >= 2:
    gaps = [(checks[j+1] - checks[j])/60 for j in range(len(checks)-1)]
    print(f"\nGaps (min): {gaps}", flush=True)
