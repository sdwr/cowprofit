"""
MWI Enhancement Cost Calculator
Implements the same Markov chain math as Enhancelator
https://doh-nuts.github.io/Enhancelator/
"""

import json
import numpy as np
from pathlib import Path
from enum import Enum

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


class PriceMode(Enum):
    """Price mode for calculations."""
    PESSIMISTIC = "pessimistic"  # Buy at ask, sell at bid
    OPTIMISTIC = "optimistic"    # Buy at bid, sell at ask  
    MIDPOINT = "midpoint"        # Use average of bid/ask


# User's gear configuration (HARDCODED)
USER_CONFIG = {
    'enhancing_level': 125,
    'observatory_level': 8,  # Observatory buff
    
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
    
    # Teas - ENABLED for production
    'tea_enhancing': False,  # +3 effective levels, +2% speed
    'tea_super_enhancing': False,  # +6 effective levels, +4% speed
    'tea_ultra_enhancing': True,  # +8 effective levels, +6% speed
    'tea_blessed': True,  # 1% chance to gain +2 levels on success
    'tea_wisdom': True,  # +12% enhancing XP
    
    # Artisan tea - affects CRAFTING material costs only (not enhancement)
    'artisan_tea': True,  # 10% material reduction (affected by guzzling)
    
    # Achievement bonus - affects enhancement material costs
    'achievement_mat_reduction': 0.002,  # 0.2% from achievements
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
    
    def get_artisan_tea_multiplier(self):
        """Get material cost multiplier from artisan tea."""
        if not USER_CONFIG.get('artisan_tea'):
            return 1.0
        guzzling = self.get_guzzling_bonus()
        # 10% reduction, boosted by guzzling
        reduction = 0.10 * guzzling
        return 1.0 - reduction
    
    def get_enhancer_bonus(self):
        """Calculate enhancer tool success bonus."""
        enhancer_hrid = f"/items/{USER_CONFIG['enhancer']}"
        base = self._get_noncombat_stat(enhancer_hrid, 'enhancingSuccess')
        level = USER_CONFIG['enhancer_level']
        return base * 100 * ENHANCE_BONUS[level]
    
    def get_effective_level(self):
        """Get effective enhancing level including tea bonuses."""
        level = USER_CONFIG['enhancing_level']
        guzzling = self.get_guzzling_bonus()
        
        if USER_CONFIG.get('tea_enhancing'):
            level += 3 * guzzling
        if USER_CONFIG.get('tea_super_enhancing'):
            level += 6 * guzzling
        if USER_CONFIG.get('tea_ultra_enhancing'):
            level += 8 * guzzling
        
        return level
    
    def get_total_bonus(self, item_level):
        """Calculate total success rate multiplier for an item level."""
        enhancer_bonus = self.get_enhancer_bonus()
        
        effective_level = self.get_effective_level()
        observatory = USER_CONFIG['observatory_level']
        
        if effective_level >= item_level:
            bonus = 1 + (0.05 * (effective_level + observatory - item_level) + enhancer_bonus) / 100
        else:
            bonus = (1 - (0.5 * (1 - effective_level / item_level))) + (0.05 * observatory + enhancer_bonus) / 100
        
        return bonus
    
    def get_attempt_time(self, item_level):
        """Calculate time per enhancement attempt in seconds."""
        guzzling = self.get_guzzling_bonus()
        effective_level = self.get_effective_level()
        observatory = USER_CONFIG['observatory_level']
        
        # Speed bonuses from teas
        tea_speed = 0
        if USER_CONFIG.get('tea_enhancing'):
            tea_speed = 2 * guzzling
        elif USER_CONFIG.get('tea_super_enhancing'):
            tea_speed = 4 * guzzling
        elif USER_CONFIG.get('tea_ultra_enhancing'):
            tea_speed = 6 * guzzling
        
        # Item gear speed bonuses
        item_bonus = 0
        if USER_CONFIG.get('enchanted_gloves_level'):
            item_bonus += self._get_noncombat_stat('/items/enchanted_gloves', 'enhancingSpeed') * 100 * ENHANCE_BONUS[USER_CONFIG['enchanted_gloves_level']]
        if USER_CONFIG.get('enhancer_top_level'):
            item_bonus += self._get_noncombat_stat('/items/enhancers_top', 'enhancingSpeed') * 100 * ENHANCE_BONUS[USER_CONFIG['enhancer_top_level']]
        if USER_CONFIG.get('enhancer_bot_level'):
            item_bonus += self._get_noncombat_stat('/items/enhancers_bottoms', 'enhancingSpeed') * 100 * ENHANCE_BONUS[USER_CONFIG['enhancer_bot_level']]
        if USER_CONFIG.get('philo_neck_level'):
            # Philosopher's necklace uses 5x scaling
            base = self._get_noncombat_stat('/items/philosophers_necklace', 'skillingSpeed')
            item_bonus += base * 100 * (((ENHANCE_BONUS[USER_CONFIG['philo_neck_level']] - 1) * 5) + 1)
        
        # Enhancing buff
        if USER_CONFIG.get('enhancing_buff_level'):
            item_bonus += 19.5 + USER_CONFIG['enhancing_buff_level'] * 0.5
        
        # Base time is 12 seconds
        if effective_level > item_level:
            speed_bonus = (effective_level + observatory - item_level) + item_bonus + tea_speed
        else:
            speed_bonus = observatory + item_bonus + tea_speed
        
        return 12 / (1 + speed_bonus / 100)
    
    def get_xp_per_action(self, item_level, enhance_level):
        """Calculate XP per enhancement action."""
        guzzling = self.get_guzzling_bonus()
        
        # Base XP formula
        base_xp = 1.4 * (1 + enhance_level) * (10 + item_level)
        
        # XP bonuses
        xp_bonus = 0
        
        # Wisdom tea
        if USER_CONFIG.get('tea_wisdom'):
            xp_bonus += 0.12 * guzzling
        
        # Enhancer bottoms XP bonus
        if USER_CONFIG.get('enhancer_bot_level'):
            base = self._get_noncombat_stat('/items/enhancers_bottoms', 'enhancingExperience')
            xp_bonus += base * ENHANCE_BONUS[USER_CONFIG['enhancer_bot_level']]
        
        # Philosopher's necklace (skilling XP, 5x scaling)
        if USER_CONFIG.get('philo_neck_level'):
            base = self._get_noncombat_stat('/items/philosophers_necklace', 'skillingExperience')
            xp_bonus += base * (((ENHANCE_BONUS[USER_CONFIG['philo_neck_level']] - 1) * 5) + 1)
        
        # Experience buff
        if USER_CONFIG.get('experience_buff_level'):
            xp_bonus += 0.195 + USER_CONFIG['experience_buff_level'] * 0.005
        
        return base_xp * (1 + xp_bonus)
    
    def get_vendor_price(self, hrid):
        """Get vendor sell price for an item."""
        item = self.item_detail_map.get(hrid, {})
        return item.get('sellPrice', 0)
    
    def get_crafting_cost(self, hrid, market_data, mode=PriceMode.MIDPOINT, depth=0):
        """Calculate the crafting cost of an item (recursive).
        
        Uses pessimistic pricing for materials regardless of mode.
        """
        if depth > 10:
            return 0
        if hrid == '/items/coin':
            return 1
        
        item = self.item_detail_map.get(hrid, {})
        category = item.get('categoryHrid', '')
        
        # Only calculate crafting cost for equipment and special items
        if category != '/item_categories/equipment' and hrid != '/items/philosophers_mirror':
            return 0
        
        # Find the crafting action for this item
        action = None
        for act in self.action_detail_map.values():
            if (act.get('function') == '/action_functions/production' and
                act.get('outputItems') and
                act['outputItems'][0].get('itemHrid') == hrid):
                action = act
                break
        
        if not action:
            return 0
        
        cost = 0
        artisan_mult = self.get_artisan_tea_multiplier()
        
        # Add input materials cost (affected by artisan tea)
        # Always use PESSIMISTIC for crafting costs (buy at ask)
        for input_item in action.get('inputItems', []):
            input_hrid = input_item['itemHrid']
            count = input_item['count'] * artisan_mult
            
            # Get ask price for materials
            input_price = self._get_buy_price(input_hrid, 0, market_data, mode)
            if input_price <= 0:
                input_price = self.get_crafting_cost(input_hrid, market_data, mode, depth + 1)
            if input_price <= 0:
                input_price = self.get_vendor_price(input_hrid)
            cost += count * input_price
        
        # Add upgrade item cost (NOT affected by artisan tea - it's the base item)
        upgrade_hrid = action.get('upgradeItemHrid', '')
        if upgrade_hrid:
            upgrade_price = self._get_buy_price(upgrade_hrid, 0, market_data, mode)
            if upgrade_price <= 0:
                upgrade_price = self.get_crafting_cost(upgrade_hrid, market_data, mode, depth + 1)
            if upgrade_price <= 0:
                upgrade_price = self.get_vendor_price(upgrade_hrid)
            cost += upgrade_price
        
        return cost
    
    def _get_buy_price(self, hrid, enhancement_level, market_data, mode=PriceMode.MIDPOINT):
        """Get market price for BUYING an item (what you'd pay)."""
        if hrid == '/items/coin':
            return 1
        
        market = market_data.get('marketData', {})
        item_market = market.get(hrid, {})
        level_data = item_market.get(str(enhancement_level), {})
        
        ask = level_data.get('a', -1)
        bid = level_data.get('b', -1)
        
        if ask == -1 and bid == -1:
            return 0
        
        if mode == PriceMode.PESSIMISTIC:
            # Buy at ask price (what sellers want)
            return ask if ask > 0 else 0
        elif mode == PriceMode.OPTIMISTIC:
            # Buy at bid price (lucky if someone sells to us at our bid)
            if bid > 0:
                return bid
            return ask if ask > 0 else 0
        else:  # MIDPOINT
            # Use midpoint only if both exist
            if ask > 0 and bid > 0:
                return (ask + bid) / 2
            # If only ask exists, use it
            if ask > 0:
                return ask
            # If only bid exists, not a real buy price
            return 0
    
    def _get_raw_market_price(self, hrid, enhancement_level, market_data, mode=PriceMode.MIDPOINT):
        """Get raw market price without fallbacks (for debugging)."""
        return self._get_buy_price(hrid, enhancement_level, market_data, mode)
    
    def get_item_price(self, hrid, enhancement_level, market_data, mode=PriceMode.MIDPOINT):
        """Get price for buying an item.
        
        For craftable items, uses LOWER of market price or crafting cost.
        Falls back to vendor price if no market/craft price.
        
        Returns (price, source) tuple where source is 'market', 'craft', or 'vendor'.
        """
        if hrid == '/items/coin':
            return 1, 'fixed'
        
        # Special case: trainee charms (Enhancelator hardcodes this)
        if 'trainee' in hrid and 'charm' in hrid:
            return 250000, 'vendor'
        
        market_price = self._get_buy_price(hrid, enhancement_level, market_data, mode)
        
        # For +0 items, check crafting cost
        if enhancement_level == 0:
            crafting_cost = self.get_crafting_cost(hrid, market_data, mode)
            
            if market_price > 0 and crafting_cost > 0:
                # Use LOWER of market or craft
                if crafting_cost < market_price:
                    return crafting_cost, 'craft'
                else:
                    return market_price, 'market'
            elif market_price > 0:
                return market_price, 'market'
            elif crafting_cost > 0:
                return crafting_cost, 'craft'
        elif market_price > 0:
            return market_price, 'market'
        
        # Fallback to vendor price
        vendor = self.get_vendor_price(hrid)
        if vendor > 0:
            return vendor, 'vendor'
        
        return 0, 'none'
    
    def get_sell_price(self, hrid, enhancement_level, market_data, mode=PriceMode.MIDPOINT):
        """Get the price you can sell an item for."""
        if hrid == '/items/coin':
            return 1
        
        market = market_data.get('marketData', {})
        item_market = market.get(hrid, {})
        level_data = item_market.get(str(enhancement_level), {})
        
        ask = level_data.get('a', -1)
        bid = level_data.get('b', -1)
        
        if ask == -1 and bid == -1:
            return 0
        
        if mode == PriceMode.PESSIMISTIC:
            # Sell at bid (what buyers will pay)
            return bid if bid > 0 else 0
        elif mode == PriceMode.OPTIMISTIC:
            # Sell at ask (hope someone pays your price)
            return ask if ask > 0 else bid if bid > 0 else 0
        else:  # MIDPOINT
            if ask > 0 and bid > 0:
                return (ask + bid) / 2
            if bid > 0:
                return bid
            if ask > 0:
                return ask
            return 0
    
    def get_full_item_price(self, hrid, market_data, mode=PriceMode.MIDPOINT):
        """Get price of an item for enhancement calculations."""
        if hrid == '/items/coin':
            return 1
        price, _ = self.get_item_price(hrid, 0, market_data, mode)
        return price
    
    def get_enhance_mat_multiplier(self):
        """Get enhancement material cost multiplier from achievements."""
        reduction = USER_CONFIG.get('achievement_mat_reduction', 0)
        return 1.0 - reduction
    
    def calculate_enhancement_cost(self, item_hrid, target_level, market_data, mode=PriceMode.MIDPOINT):
        """Calculate expected enhancement cost using Markov chain."""
        item = self.item_detail_map.get(item_hrid, {})
        if not item:
            return None
        
        item_level = item.get('itemLevel', 1)
        enhancement_costs = item.get('enhancementCosts', [])
        
        # Parse enhancement costs
        mat_costs = []
        coin_cost = 0
        # Enhancement materials use achievement bonus only (NOT artisan tea)
        enhance_mat_mult = self.get_enhance_mat_multiplier()
        
        # Build detailed materials list
        materials_detail = []
        for cost in enhancement_costs:
            if cost['itemHrid'] == '/items/coin':
                coin_cost = cost['count']
            else:
                # Enhancement materials only reduced by achievement bonus (0.2%)
                # Artisan tea does NOT affect enhancement materials
                mat_hrid = cost['itemHrid']
                mat_count = cost['count'] * enhance_mat_mult
                mat_costs.append((mat_hrid, mat_count))
        
        # Get material prices and build detail
        mat_prices = []
        for hrid, count in mat_costs:
            price = self.get_full_item_price(hrid, market_data, mode)
            mat_prices.append((count, price))
            mat_name = self.item_detail_map.get(hrid, {}).get('name', hrid.split('/')[-1])
            materials_detail.append({
                'hrid': hrid,
                'name': mat_name,
                'count': count,
                'price': price,
            })
        
        # Get base item price and alternative
        base_price, base_source = self.get_item_price(item_hrid, 0, market_data, mode)
        
        # Get alternative price (market if craft, craft if market)
        market_price = self._get_buy_price(item_hrid, 0, market_data, mode)
        craft_price = self.get_crafting_cost(item_hrid, market_data, mode)
        
        if base_source == 'craft':
            alt_price = market_price if market_price > 0 else 0
            alt_source = 'market'
        elif base_source == 'market':
            alt_price = craft_price if craft_price > 0 else 0
            alt_source = 'craft'
        else:
            alt_price = market_price if market_price > 0 else craft_price
            alt_source = 'market' if market_price > 0 else 'craft'
        
        # Get crafting materials if it's craftable
        craft_materials = []
        if craft_price > 0:
            craft_materials = self._get_crafting_materials(item_hrid, market_data, mode)
        
        # Get protection options
        mirror_price = self.get_full_item_price('/items/mirror_of_protection', market_data, mode)
        
        protect_hrids = item.get('protectionItemHrids', [])
        protect_options = [('/items/mirror_of_protection', mirror_price)]
        protect_options.append((item_hrid, base_price))
        
        for phrid in protect_hrids:
            if '_refined' not in phrid:
                pprice = self.get_full_item_price(phrid, market_data, mode)
                if pprice > 0:
                    protect_options.append((phrid, pprice))
        
        # Find cheapest valid protection
        valid_protects = [(h, p) for h, p in protect_options if p > 0]
        if not valid_protects:
            return None
        
        cheapest_protect = min(valid_protects, key=lambda x: x[1])
        protect_hrid = cheapest_protect[0]
        protect_price = cheapest_protect[1]
        protect_name = self.item_detail_map.get(protect_hrid, {}).get('name', protect_hrid.split('/')[-1])
        
        total_bonus = self.get_total_bonus(item_level)
        attempt_time = self.get_attempt_time(item_level)
        
        # Check for blessed tea (+1% chance for double success)
        use_blessed = USER_CONFIG.get('tea_blessed', False)
        guzzling = self.get_guzzling_bonus() if use_blessed else 1
        
        # Find optimal protection level
        best_result = None
        best_total = float('inf')
        
        for prot_level in range(2, target_level + 1):
            result = self._markov_enhance(
                target_level, prot_level, total_bonus, 
                mat_prices, coin_cost, protect_price, base_price,
                use_blessed, guzzling, item_level
            )
            
            if result['total_cost'] < best_total:
                best_total = result['total_cost']
                best_result = result
                best_result['protect_at'] = prot_level
        
        if best_result:
            best_result['item_hrid'] = item_hrid
            best_result['item_level'] = item_level
            best_result['protect_price'] = protect_price
            best_result['protect_hrid'] = protect_hrid
            best_result['protect_name'] = protect_name
            best_result['base_price'] = base_price
            best_result['base_source'] = base_source
            best_result['alt_price'] = alt_price
            best_result['alt_source'] = alt_source
            best_result['attempt_time'] = attempt_time
            best_result['materials'] = materials_detail
            best_result['coin_cost'] = coin_cost
            best_result['craft_materials'] = craft_materials
        
        return best_result
    
    def _get_crafting_materials(self, hrid, market_data, mode=PriceMode.MIDPOINT):
        """Get the list of crafting materials for an item."""
        item = self.item_detail_map.get(hrid, {})
        category = item.get('categoryHrid', '')
        
        if category != '/item_categories/equipment' and hrid != '/items/philosophers_mirror':
            return []
        
        # Find the crafting action for this item
        action = None
        for act in self.action_detail_map.values():
            if (act.get('function') == '/action_functions/production' and
                act.get('outputItems') and
                act['outputItems'][0].get('itemHrid') == hrid):
                action = act
                break
        
        if not action:
            return []
        
        materials = []
        artisan_mult = self.get_artisan_tea_multiplier()
        
        for input_item in action.get('inputItems', []):
            input_hrid = input_item['itemHrid']
            count = input_item['count'] * artisan_mult
            price = self._get_buy_price(input_hrid, 0, market_data, mode)
            if price <= 0:
                price = self.get_vendor_price(input_hrid)
            mat_name = self.item_detail_map.get(input_hrid, {}).get('name', input_hrid.split('/')[-1])
            materials.append({
                'hrid': input_hrid,
                'name': mat_name,
                'count': count,
                'price': price,
            })
        
        # Add upgrade item if present
        upgrade_hrid = action.get('upgradeItemHrid', '')
        if upgrade_hrid:
            upgrade_price = self._get_buy_price(upgrade_hrid, 0, market_data, mode)
            if upgrade_price <= 0:
                upgrade_price = self.get_vendor_price(upgrade_hrid)
            upgrade_name = self.item_detail_map.get(upgrade_hrid, {}).get('name', upgrade_hrid.split('/')[-1])
            materials.append({
                'hrid': upgrade_hrid,
                'name': upgrade_name,
                'count': 1,
                'price': upgrade_price,
                'is_upgrade': True,
            })
        
        return materials
    
    def _markov_enhance(self, stop_at, protect_at, total_bonus, mat_prices, coin_cost, protect_price, base_price, use_blessed=False, guzzling=1, item_level=1):
        """Use Markov chain to calculate expected enhancement attempts."""
        n = stop_at + 1
        Q = np.zeros((stop_at, stop_at))
        
        for i in range(stop_at):
            success_chance = (SUCCESS_RATE[i] / 100.0) * total_bonus
            success_chance = min(success_chance, 1.0)
            
            remaining_success = success_chance
            
            # Blessed tea: 1% chance (boosted by guzzling) to gain +2 instead of +1
            if use_blessed and i + 2 <= stop_at:
                blessed_chance = success_chance * 0.01 * guzzling
                if i + 2 < stop_at:
                    Q[i, i + 2] = blessed_chance
                remaining_success -= blessed_chance
            
            fail_chance = 1.0 - success_chance
            
            destination = (i - 1) if i >= protect_at else 0
            destination = max(0, destination)
            
            if i + 1 < stop_at:
                Q[i, i + 1] = remaining_success
            
            Q[i, destination] += fail_chance
        
        I = np.eye(stop_at)
        try:
            M = np.linalg.inv(I - Q)
        except np.linalg.LinAlgError:
            M = np.linalg.pinv(I - Q)
        
        attempts = np.sum(M[0, :])
        
        protect_count = 0
        for i in range(protect_at, stop_at):
            success_chance = (SUCCESS_RATE[i] / 100.0) * total_bonus
            success_chance = min(success_chance, 1.0)
            fail_chance = 1.0 - success_chance
            protect_count += M[0, i] * fail_chance
        
        mat_cost = sum(count * price * attempts for count, price in mat_prices)
        mat_cost += coin_cost * attempts
        mat_cost += protect_price * protect_count
        
        total_cost = base_price + mat_cost
        
        # Calculate total XP (sum of XP at each level weighted by attempts)
        total_xp = 0
        for i in range(stop_at):
            success_chance = (SUCCESS_RATE[i] / 100.0) * total_bonus
            success_chance = min(success_chance, 1.0)
            xp_per_action = self.get_xp_per_action(item_level, i)
            # XP = attempts at level * (success_xp + fail_xp)
            # Success gives full XP, fail gives 10%
            total_xp += M[0, i] * xp_per_action * (success_chance + 0.1 * (1 - success_chance))
        
        return {
            'actions': attempts,
            'protect_count': protect_count,
            'mat_cost': mat_cost,
            'total_cost': total_cost,
            'total_xp': total_xp,
        }
    
    def calculate_profit(self, item_hrid, target_level, market_data, mode=PriceMode.PESSIMISTIC):
        """Calculate profit for enhancing an item to target level."""
        result = self.calculate_enhancement_cost(item_hrid, target_level, market_data, mode)
        if not result:
            return None
        
        sell_price = self.get_sell_price(item_hrid, target_level, market_data, mode)
        
        if sell_price <= 0:
            return None
        
        # Market fee is 2% of sell price
        market_fee = sell_price * 0.02
        
        profit = sell_price - result['total_cost']
        profit_after_fee = profit - market_fee
        roi = (profit / result['total_cost']) * 100 if result['total_cost'] > 0 else 0
        roi_after_fee = (profit_after_fee / result['total_cost']) * 100 if result['total_cost'] > 0 else 0
        
        # Calculate per day metrics
        total_time_hours = result['actions'] * result['attempt_time'] / 3600
        total_time_days = total_time_hours / 24
        
        profit_per_day = profit / total_time_days if total_time_days > 0 else 0
        profit_per_day_after_fee = profit_after_fee / total_time_days if total_time_days > 0 else 0
        xp_per_day = result['total_xp'] / total_time_days if total_time_days > 0 else 0
        
        return {
            'item_hrid': item_hrid,
            'item_name': self.item_detail_map.get(item_hrid, {}).get('name', item_hrid),
            'target_level': target_level,
            'base_price': result['base_price'],
            'base_source': result['base_source'],
            'alt_price': result['alt_price'],
            'alt_source': result['alt_source'],
            'mat_cost': result['mat_cost'],
            'total_cost': result['total_cost'],
            'sell_price': sell_price,
            'market_fee': market_fee,
            'profit': profit,
            'profit_after_fee': profit_after_fee,
            'roi': roi,
            'roi_after_fee': roi_after_fee,
            'profit_per_day': profit_per_day,
            'profit_per_day_after_fee': profit_after_fee / total_time_days if total_time_days > 0 else 0,
            'xp_per_day': xp_per_day,
            'total_xp': result['total_xp'],
            'actions': result['actions'],
            'time_hours': total_time_hours,
            'time_days': total_time_days,
            'protect_count': result['protect_count'],
            'protect_at': result['protect_at'],
            'protect_hrid': result['protect_hrid'],
            'protect_name': result['protect_name'],
            'protect_price': result['protect_price'],
            'materials': result['materials'],
            'coin_cost': result['coin_cost'],
            'craft_materials': result['craft_materials'],
            'mode': mode.value,
        }
    
    def get_all_profits(self, market_data, target_levels=[8, 10, 12, 14], mode=PriceMode.PESSIMISTIC):
        """Calculate profits for all enhanceable items at target levels."""
        results = []
        
        for item in self.enhanceable_items:
            hrid = item.get('hrid')
            if not hrid:
                continue
            
            # Skip junk items
            name = item.get('name', '').lower()
            if any(skip in name for skip in ['cheese_', 'verdant_', 'wooden_', 'rough_']):
                continue
            
            for target in target_levels:
                result = self.calculate_profit(hrid, target, market_data, mode)
                if result and result['sell_price'] > 0:
                    results.append(result)
        
        results.sort(key=lambda x: x['profit'], reverse=True)
        
        return results
    
    def get_all_profits_all_modes(self, market_data, target_levels=[8, 10, 12, 14]):
        """Calculate profits for all items in all price modes."""
        return {
            'pessimistic': self.get_all_profits(market_data, target_levels, PriceMode.PESSIMISTIC),
            'midpoint': self.get_all_profits(market_data, target_levels, PriceMode.MIDPOINT),
            'optimistic': self.get_all_profits(market_data, target_levels, PriceMode.OPTIMISTIC),
        }


def test_calculator():
    """Test the calculator."""
    import requests
    
    calc = EnhancementCalculator()
    
    resp = requests.get('https://www.milkywayidle.com/game_data/marketplace.json')
    market_data = resp.json()
    
    print("=== Enhancement Calculator Test ===\n")
    print(f"Enhancer bonus: {calc.get_enhancer_bonus():.2f}%")
    print(f"Guzzling bonus: {calc.get_guzzling_bonus():.4f}x")
    print(f"Artisan tea multiplier: {calc.get_artisan_tea_multiplier():.4f}")
    print(f"Effective level: {calc.get_effective_level():.1f}")
    print(f"Observatory: {USER_CONFIG['observatory_level']}")
    
    test_items = [
        ('/items/acrobatic_hood', 10),
        ('/items/rippling_trident_refined', 10),
    ]
    
    print("\n=== PESSIMISTIC MODE ===\n")
    for hrid, target in test_items:
        result = calc.calculate_profit(hrid, target, market_data, PriceMode.PESSIMISTIC)
        if result:
            print(f"{result['item_name']} +0 -> +{target}")
            print(f"  Base: {result['base_price']:,.0f} ({result['base_source']})")
            print(f"  Mat cost: {result['mat_cost']:,.0f}")
            print(f"  Total: {result['total_cost']:,.0f}")
            print(f"  Sell: {result['sell_price']:,.0f}")
            print(f"  Fee: {result['market_fee']:,.0f}")
            print(f"  Profit: {result['profit']:,.0f} -> {result['profit_after_fee']:,.0f} after fee")
            print(f"  Time: {result['time_days']:.2f} days")
            print(f"  Profit/day: {result['profit_per_day']:,.0f}")
            print(f"  XP/day: {result['xp_per_day']:,.0f}")
            print()


if __name__ == '__main__':
    test_calculator()
