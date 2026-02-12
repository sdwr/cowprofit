"""
MWI Enhancement Cost Calculator
Implements the same Markov chain math as Enhancelator
https://doh-nuts.github.io/Enhancelator/
"""

import json
import numpy as np
from pathlib import Path

# Enhancement bonus multipliers for levels +0 to +20
ENHANCE_BONUS = [
    1.000, 1.020, 1.042, 1.066, 1.092,  # +0 to +4
    1.120, 1.150, 1.182, 1.216, 1.252,  # +5 to +9
    1.290, 1.334, 1.384, 1.440, 1.502,  # +10 to +14
    1.570, 1.644, 1.724, 1.810, 1.902,  # +15 to +19
    2.000  # +20
]

# Base success rates for levels +1 to +20
SUCCESS_RATE = [
    50, 45, 45, 40, 40, 40, 35, 35, 35, 35,  # +1 to +10
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30   # +11 to +20
]

# User's gear configuration (HARDCODED)
USER_CONFIG = {
    'enhancing_level': 125,
    'observatory_level': 0,
    
    # Gear with enhancement levels
    'enchanted_gloves_level': 10,
    'guzzling_pouch_level': 8,
    'enhancer_top_level': 8,
    'enhancer_bot_level': 8,
    'philo_neck_level': 7,
    'charm_level': 6,
    'charm_tier': 'advanced',  # advanced enhancing charm
    
    # Buffs
    'enhancing_buff_level': 20,
    'experience_buff_level': 20,
    
    # Enhancer tool
    'enhancer': 'celestial_enhancer',
    'enhancer_level': 14,
    
    # Teas (not using any for base calculation)
    'tea_enhancing': False,
    'tea_super_enhancing': False,
    'tea_ultra_enhancing': False,
    'tea_blessed': False,
    'tea_wisdom': False,
}


class EnhancementCalculator:
    def __init__(self, game_data_path='init_client_info.json'):
        self.game_data = None
        self.item_detail_map = {}
        self.action_detail_map = {}
        self.enhanceable_items = []
        self._load_game_data(game_data_path)
    
    def _load_game_data(self, path):
        """Load and parse game data, extracting only what we need."""
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        self.item_detail_map = data.get('itemDetailMap', {})
        self.action_detail_map = data.get('actionDetailMap', {})
        
        # Filter to enhanceable items only
        self.enhanceable_items = [
            item for hrid, item in self.item_detail_map.items()
            if item.get('enhancementCosts') is not None
        ]
        
        # Sort by sortIndex
        self.enhanceable_items.sort(key=lambda x: x.get('sortIndex', 0))
    
    def _get_noncombat_stat(self, hrid, stat_name):
        """Get a noncombat stat from an item."""
        item = self.item_detail_map.get(hrid, {})
        equip_detail = item.get('equipmentDetail', {})
        noncombat = equip_detail.get('noncombatStats', {})
        return noncombat.get(stat_name, 0)
    
    def get_guzzling_bonus(self):
        """Calculate guzzling pouch concentration bonus."""
        base = self._get_noncombat_stat('/items/guzzling_pouch', 'drinkConcentration')
        level = USER_CONFIG['guzzling_pouch_level']
        bonus = base * 100 * ENHANCE_BONUS[level]
        return 1 + bonus / 100
    
    def get_enhancer_bonus(self):
        """Calculate enhancer tool success bonus."""
        enhancer_hrid = f"/items/{USER_CONFIG['enhancer']}"
        base = self._get_noncombat_stat(enhancer_hrid, 'enhancingSuccess')
        level = USER_CONFIG['enhancer_level']
        return base * 100 * ENHANCE_BONUS[level]
    
    def get_total_bonus(self, item_level):
        """Calculate total success rate multiplier for an item level.
        
        Formula from Enhancelator:
        if level >= item_level:
            bonus = 1 + (0.05 * (level + observatory - item_level) + enhancer_bonus) / 100
        else:
            bonus = (1 - 0.5 * (1 - level/item_level)) + (0.05*observatory + enhancer_bonus) / 100
            
        Note: guzzling_bonus only affects tea effects, not base success rate
        """
        enhancer_bonus = self.get_enhancer_bonus()
        
        effective_level = USER_CONFIG['enhancing_level']
        observatory = USER_CONFIG['observatory_level']
        
        if effective_level >= item_level:
            bonus = 1 + (0.05 * (effective_level + observatory - item_level) + enhancer_bonus) / 100
        else:
            bonus = (1 - (0.5 * (1 - effective_level / item_level))) + (0.05 * observatory + enhancer_bonus) / 100
        
        return bonus
    
    def get_item_price(self, hrid, enhancement_level, market_data, for_selling=False):
        """Get market price for an item at a specific enhancement level.
        
        Args:
            for_selling: If True, return bid price (what you can sell for).
                        If False, return avg of bid/ask (general price).
        """
        if hrid == '/items/coin':
            return 1
        
        market = market_data.get('marketData', {})
        item_market = market.get(hrid, {})
        level_data = item_market.get(str(enhancement_level), {})
        
        ask = level_data.get('a', -1)
        bid = level_data.get('b', -1)
        
        # Handle -1 (no orders)
        if ask == -1 and bid == -1:
            # No market data - return 0 to indicate unavailable
            return 0
        elif for_selling:
            # For selling, use bid price (what buyers are willing to pay)
            return bid if bid > 0 else 0
        elif ask == -1:
            return bid
        elif bid == -1:
            return ask
        else:
            return (ask + bid) / 2
    
    def get_full_item_price(self, hrid, market_data):
        """Get crafting cost of an item (recursive for crafted items)."""
        if hrid == '/items/coin':
            return 1
        
        item = self.item_detail_map.get(hrid, {})
        category = item.get('categoryHrid', '')
        
        # For equipment and philosopher's mirror, check if craftable
        if category == '/item_categories/equipment' or hrid == '/items/philosophers_mirror':
            # Find crafting action
            action = None
            for act in self.action_detail_map.values():
                if (act.get('function') == '/action_functions/production' and
                    act.get('outputItems') and
                    act['outputItems'][0].get('itemHrid') == hrid):
                    action = act
                    break
            
            if action:
                cost = 0
                for input_item in action.get('inputItems', []):
                    input_hrid = input_item['itemHrid']
                    count = input_item['count']
                    input_cost = count * self.get_full_item_price(input_hrid, market_data)
                    # Charms get 10% discount (market efficiency)
                    if 'charm' in hrid:
                        input_cost *= 0.90
                    cost += input_cost
                
                upgrade = action.get('upgradeItemHrid', '')
                if upgrade:
                    cost += self.get_full_item_price(upgrade, market_data)
                
                return cost
        
        # Base item - get from market
        return self.get_item_price(hrid, 0, market_data)
    
    def calculate_enhancement_cost(self, item_hrid, target_level, market_data, protect_at=None):
        """
        Calculate expected enhancement cost using Markov chain.
        
        Returns dict with:
        - actions: expected number of enhancement attempts
        - protect_count: expected number of protections used
        - mat_cost: material cost (excluding base item)
        - total_cost: mat_cost + base item + protection
        """
        item = self.item_detail_map.get(item_hrid, {})
        if not item:
            return None
        
        item_level = item.get('itemLevel', 1)
        enhancement_costs = item.get('enhancementCosts', [])
        
        # Parse enhancement costs
        mat_costs = []  # List of (hrid, count) tuples
        coin_cost = 0
        
        for cost in enhancement_costs:
            if cost['itemHrid'] == '/items/coin':
                coin_cost = cost['count']
            else:
                mat_costs.append((cost['itemHrid'], cost['count']))
        
        # Get material prices
        mat_prices = []
        for hrid, count in mat_costs:
            price = self.get_full_item_price(hrid, market_data)
            mat_prices.append((count, price))
        
        # Get protection options
        mirror_price = self.get_full_item_price('/items/mirror_of_protection', market_data)
        base_price = self.get_item_price(item_hrid, 0, market_data)
        
        # Protection item hrids
        protect_hrids = item.get('protectionItemHrids', [])
        protect_options = [('/items/mirror_of_protection', mirror_price)]
        
        # Add base item as protection option
        protect_options.append((item_hrid, base_price))
        
        # Add other protection options
        for phrid in protect_hrids:
            if '_refined' not in phrid:  # Skip refined variants
                pprice = self.get_item_price(phrid, 0, market_data)
                protect_options.append((phrid, pprice))
        
        # Find cheapest protection
        cheapest_protect = min(protect_options, key=lambda x: x[1])
        protect_price = cheapest_protect[1]
        
        # Calculate total bonus
        total_bonus = self.get_total_bonus(item_level)
        
        # Find optimal protection level and calculate costs
        best_result = None
        best_total = float('inf')
        
        for prot_level in range(2, target_level + 1):
            result = self._markov_enhance(
                target_level, prot_level, total_bonus, 
                mat_prices, coin_cost, protect_price, base_price
            )
            
            if result['total_cost'] < best_total:
                best_total = result['total_cost']
                best_result = result
                best_result['protect_at'] = prot_level
        
        if best_result:
            best_result['item_hrid'] = item_hrid
            best_result['item_level'] = item_level
            best_result['protect_price'] = protect_price
            best_result['base_price'] = base_price
        
        return best_result
    
    def _markov_enhance(self, stop_at, protect_at, total_bonus, mat_prices, coin_cost, protect_price, base_price):
        """
        Use Markov chain to calculate expected enhancement attempts.
        This replicates the Enhancelate() function from Enhancelator.
        """
        # Build transition matrix
        n = stop_at + 1  # States 0 to stop_at
        Q = np.zeros((stop_at, stop_at))  # Transient states
        
        for i in range(stop_at):
            success_chance = (SUCCESS_RATE[i] / 100.0) * total_bonus
            success_chance = min(success_chance, 1.0)  # Cap at 100%
            fail_chance = 1.0 - success_chance
            
            # On fail, go to protect_at-1 if at or above protect level, else go to 0
            destination = (i - 1) if i >= protect_at else 0
            destination = max(0, destination)
            
            if i + 1 < stop_at:
                Q[i, i + 1] = success_chance
            Q[i, destination] += fail_chance
        
        # Calculate fundamental matrix M = (I - Q)^-1
        I = np.eye(stop_at)
        try:
            M = np.linalg.inv(I - Q)
        except np.linalg.LinAlgError:
            # Fallback for singular matrix
            M = np.linalg.pinv(I - Q)
        
        # Expected attempts starting from level 0
        attempts = np.sum(M[0, :])
        
        # Expected protections (attempts at levels >= protect_at that fail)
        protect_count = 0
        for i in range(protect_at, stop_at):
            success_chance = (SUCCESS_RATE[i] / 100.0) * total_bonus
            success_chance = min(success_chance, 1.0)
            fail_chance = 1.0 - success_chance
            protect_count += M[0, i] * fail_chance
        
        # Calculate costs
        mat_cost = sum(count * price * attempts for count, price in mat_prices)
        mat_cost += coin_cost * attempts
        mat_cost += protect_price * protect_count
        
        total_cost = base_price + mat_cost
        
        return {
            'actions': attempts,
            'protect_count': protect_count,
            'mat_cost': mat_cost,
            'total_cost': total_cost,
        }
    
    def calculate_profit(self, item_hrid, target_level, market_data):
        """
        Calculate profit for enhancing an item to target level.
        
        Profit = Sell Price - Total Enhancement Cost
        """
        result = self.calculate_enhancement_cost(item_hrid, target_level, market_data)
        if not result:
            return None
        
        # Get sell price at target level (use bid price - what you can actually sell for)
        sell_price = self.get_item_price(item_hrid, target_level, market_data, for_selling=True)
        
        if sell_price <= 0:
            return None
        
        profit = sell_price - result['total_cost']
        roi = (profit / result['total_cost']) * 100 if result['total_cost'] > 0 else 0
        
        return {
            'item_hrid': item_hrid,
            'item_name': self.item_detail_map.get(item_hrid, {}).get('name', item_hrid),
            'target_level': target_level,
            'base_price': result['base_price'],
            'mat_cost': result['mat_cost'],
            'total_cost': result['total_cost'],
            'sell_price': sell_price,
            'profit': profit,
            'roi': roi,
            'actions': result['actions'],
            'protect_count': result['protect_count'],
            'protect_at': result['protect_at'],
        }
    
    def get_all_profits(self, market_data, target_levels=[8, 10, 12, 14]):
        """Calculate profits for all enhanceable items at target levels."""
        results = []
        
        for item in self.enhanceable_items:
            hrid = item.get('hrid')
            if not hrid:
                continue
            
            # Skip certain item types
            name = item.get('name', '').lower()
            if any(skip in name for skip in ['cheese_', 'verdant_', 'wooden_', 'rough_']):
                continue
            
            for target in target_levels:
                result = self.calculate_profit(hrid, target, market_data)
                if result and result['sell_price'] > 0:
                    results.append(result)
        
        # Sort by profit descending
        results.sort(key=lambda x: x['profit'], reverse=True)
        
        return results


def test_calculator():
    """Test the calculator against known Enhancelator values."""
    import requests
    
    calc = EnhancementCalculator()
    
    # Fetch market data
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    
    print("=== Enhancement Calculator Test ===\n")
    print(f"Enhancer bonus: {calc.get_enhancer_bonus():.2f}%")
    print(f"Guzzling bonus: {calc.get_guzzling_bonus():.4f}x")
    
    # Test a few items
    test_items = [
        ('/items/acrobatic_hood', 10),
        ('/items/holy_enhancer', 10),
        ('/items/advanced_enhancing_charm', 5),
    ]
    
    print("\n=== Test Results ===\n")
    
    for hrid, target in test_items:
        result = calc.calculate_profit(hrid, target, market_data)
        if result:
            print(f"{result['item_name']} +0 -> +{target}")
            print(f"  Base price: {result['base_price']:,.0f}")
            print(f"  Enhancement cost: {result['mat_cost']:,.0f}")
            print(f"  Total cost: {result['total_cost']:,.0f}")
            print(f"  Sell price: {result['sell_price']:,.0f}")
            print(f"  Profit: {result['profit']:,.0f}")
            print(f"  ROI: {result['roi']:.1f}%")
            print(f"  Actions: {result['actions']:.0f}")
            print(f"  Protects: {result['protect_count']:.1f}")
            print(f"  Protect at: +{result['protect_at']}")
            print()


if __name__ == '__main__':
    test_calculator()
