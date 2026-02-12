#!/usr/bin/env python3
"""Test script to understand the data structure and test price age integration."""

import json
from datetime import datetime
from pathlib import Path

def format_duration(seconds):
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        return f"{int(seconds / 60)}m"
    elif seconds < 86400:
        return f"{seconds / 3600:.1f}h"
    else:
        return f"{seconds / 86400:.1f}d"

def test_price_history():
    """Check the price history structure."""
    history_file = Path(__file__).parent / 'price_history.json'
    
    if not history_file.exists():
        print("No price_history.json found")
        return
    
    with open(history_file, encoding='utf-8') as f:
        history = json.load(f)
    
    print(f"Last check: {history.get('last_check')}")
    print(f"Last market time: {history.get('last_market_time')}")
    print(f"Items tracked: {len(history.get('items', {}))}")
    
    # Show a few items with their price history
    now_ts = int(datetime.now().timestamp())
    
    print("\nSample items:")
    for i, (hrid, data) in enumerate(list(history.get('items', {}).items())[:5]):
        price_since_ts = data.get('current_price_since_ts', now_ts)
        age_secs = now_ts - price_since_ts
        direction = data.get('price_direction')
        arrow = '↑' if direction == 'up' else ('↓' if direction == 'down' else '-')
        
        print(f"  {hrid}:")
        print(f"    Price: {data.get('current_price'):,}")
        print(f"    Since: {data.get('current_price_since')}")
        print(f"    Age: {format_duration(age_secs)} ({age_secs}s)")
        print(f"    Direction: {arrow}")
        if data.get('last_price'):
            print(f"    Previous: {data.get('last_price'):,}")

def test_mock_data():
    """Create mock data with different ages to test display."""
    now_ts = int(datetime.now().timestamp())
    
    mock_items = {
        '/items/test_5min': {
            'current_price': 1000,
            'current_price_since_ts': now_ts - 300,  # 5 min ago
            'price_direction': 'up',
            'last_price': 900
        },
        '/items/test_2hours': {
            'current_price': 5000,
            'current_price_since_ts': now_ts - 7200,  # 2 hours ago
            'price_direction': 'down',
            'last_price': 5500
        },
        '/items/test_2days': {
            'current_price': 10000,
            'current_price_since_ts': now_ts - 172800,  # 2 days ago
            'price_direction': None,  # No previous price
            'last_price': None
        }
    }
    
    print("\nMock data test:")
    for hrid, data in mock_items.items():
        age_secs = now_ts - data['current_price_since_ts']
        direction = data.get('price_direction')
        arrow = '↑' if direction == 'up' else ('↓' if direction == 'down' else '-')
        
        print(f"  {hrid}: {format_duration(age_secs)} {arrow}")

if __name__ == '__main__':
    test_price_history()
    test_mock_data()
