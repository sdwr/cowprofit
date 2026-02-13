/**
 * MWI Enhancement Cost Calculator (JavaScript port)
 * Implements the same Markov chain math as Python enhance_calc.py
 */

// Default player config (same as Python USER_CONFIG)
const DEFAULT_CONFIG = {
    enhancingLevel: 125,
    observatoryLevel: 8,
    
    // Gear with enhancement levels
    enchantedGlovesLevel: 10,
    guzzlingPouchLevel: 8,
    enhancerTopLevel: 8,
    enhancerBotLevel: 8,
    philoNeckLevel: 7,
    charmLevel: 6,
    charmTier: 'advanced',
    
    // Buffs
    enhancingBuffLevel: 20,
    experienceBuffLevel: 20,
    
    // Enhancer tool
    enhancer: 'celestial_enhancer',
    enhancerLevel: 14,
    
    // Teas
    teaEnhancing: false,
    teaSuperEnhancing: false,
    teaUltraEnhancing: true,
    teaBlessed: true,
    teaWisdom: true,
    artisanTea: true,
    
    // Achievement bonus
    achievementSuccessBonus: 0.2,
};

// Price modes
const PriceMode = {
    PESSIMISTIC: 'pessimistic',
    OPTIMISTIC: 'optimistic',
    MIDPOINT: 'midpoint',
};

class EnhanceCalculator {
    constructor(gameData, config = DEFAULT_CONFIG) {
        this.items = gameData.items || {};
        this.recipes = gameData.recipes || {};
        this.constants = gameData.constants || {};
        this.config = { ...DEFAULT_CONFIG, ...config };
        
        // Constants from game data or defaults
        this.enhanceBonus = this.constants.enhanceBonus || [
            1.000, 1.020, 1.042, 1.066, 1.092,
            1.120, 1.150, 1.182, 1.216, 1.252,
            1.290, 1.334, 1.384, 1.440, 1.502,
            1.570, 1.644, 1.724, 1.810, 1.902,
            2.000
        ];
        this.successRate = this.constants.successRate || [
            50, 45, 45, 40, 40, 40, 35, 35, 35, 35,
            30, 30, 30, 30, 30, 30, 30, 30, 30, 30
        ];
    }
    
    // Get noncombat stat from an item
    _getNoncombatStat(hrid, statName) {
        const item = this.items[hrid];
        if (!item || !item.stats) return 0;
        return item.stats[statName] || 0;
    }
    
    // Calculate guzzling pouch concentration bonus
    getGuzzlingBonus() {
        const base = this._getNoncombatStat('/items/guzzling_pouch', 'drinkConcentration');
        const level = this.config.guzzlingPouchLevel;
        const bonus = base * 100 * this.enhanceBonus[level];
        return 1 + bonus / 100;
    }
    
    // Get material cost multiplier from artisan tea
    getArtisanTeaMultiplier() {
        if (!this.config.artisanTea) return 1.0;
        const guzzling = this.getGuzzlingBonus();
        const reduction = 0.10 * guzzling;
        return 1.0 - reduction;
    }
    
    // Calculate enhancer tool success bonus
    getEnhancerBonus() {
        const enhancerHrid = `/items/${this.config.enhancer}`;
        const base = this._getNoncombatStat(enhancerHrid, 'enhancingSuccess');
        const level = this.config.enhancerLevel;
        return base * 100 * this.enhanceBonus[level];
    }
    
    // Get effective enhancing level including tea bonuses
    getEffectiveLevel() {
        let level = this.config.enhancingLevel;
        const guzzling = this.getGuzzlingBonus();
        
        if (this.config.teaEnhancing) level += 3 * guzzling;
        if (this.config.teaSuperEnhancing) level += 6 * guzzling;
        if (this.config.teaUltraEnhancing) level += 8 * guzzling;
        
        return level;
    }
    
    // Calculate total success rate multiplier for an item level
    getTotalBonus(itemLevel) {
        const enhancerBonus = this.getEnhancerBonus();
        const achievementBonus = this.config.achievementSuccessBonus || 0;
        const totalToolBonus = enhancerBonus + achievementBonus;
        
        const effectiveLevel = this.getEffectiveLevel();
        const observatory = this.config.observatoryLevel;
        
        let bonus;
        if (effectiveLevel >= itemLevel) {
            bonus = 1 + (0.05 * (effectiveLevel + observatory - itemLevel) + totalToolBonus) / 100;
        } else {
            bonus = (1 - (0.5 * (1 - effectiveLevel / itemLevel))) + (0.05 * observatory + totalToolBonus) / 100;
        }
        
        return bonus;
    }
    
    // Calculate time per enhancement attempt in seconds
    getAttemptTime(itemLevel) {
        const guzzling = this.getGuzzlingBonus();
        const effectiveLevel = this.getEffectiveLevel();
        const observatory = this.config.observatoryLevel;
        
        // Tea speed
        let teaSpeed = 0;
        if (this.config.teaEnhancing) teaSpeed = 2 * guzzling;
        else if (this.config.teaSuperEnhancing) teaSpeed = 4 * guzzling;
        else if (this.config.teaUltraEnhancing) teaSpeed = 6 * guzzling;
        
        // Gear speed bonuses
        let itemBonus = 0;
        if (this.config.enchantedGlovesLevel) {
            itemBonus += this._getNoncombatStat('/items/enchanted_gloves', 'enhancingSpeed') * 100 * this.enhanceBonus[this.config.enchantedGlovesLevel];
        }
        if (this.config.enhancerTopLevel) {
            itemBonus += this._getNoncombatStat('/items/enhancers_top', 'enhancingSpeed') * 100 * this.enhanceBonus[this.config.enhancerTopLevel];
        }
        if (this.config.enhancerBotLevel) {
            itemBonus += this._getNoncombatStat('/items/enhancers_bottoms', 'enhancingSpeed') * 100 * this.enhanceBonus[this.config.enhancerBotLevel];
        }
        if (this.config.philoNeckLevel) {
            const base = this._getNoncombatStat('/items/philosophers_necklace', 'skillingSpeed');
            itemBonus += base * 100 * (((this.enhanceBonus[this.config.philoNeckLevel] - 1) * 5) + 1);
        }
        
        // Enhancing buff
        if (this.config.enhancingBuffLevel) {
            itemBonus += 19.5 + this.config.enhancingBuffLevel * 0.5;
        }
        
        let speedBonus;
        if (effectiveLevel > itemLevel) {
            speedBonus = (effectiveLevel + observatory - itemLevel) + itemBonus + teaSpeed;
        } else {
            speedBonus = observatory + itemBonus + teaSpeed;
        }
        
        return 12 / (1 + speedBonus / 100);
    }
    
    // Calculate XP per enhancement action
    getXpPerAction(itemLevel, enhanceLevel) {
        const guzzling = this.getGuzzlingBonus();
        const baseXp = 1.4 * (1 + enhanceLevel) * (10 + itemLevel);
        
        let xpBonus = 0;
        
        // Wisdom tea
        if (this.config.teaWisdom) {
            xpBonus += 0.12 * guzzling;
        }
        
        // Enhancer bottoms XP bonus
        if (this.config.enhancerBotLevel) {
            const base = this._getNoncombatStat('/items/enhancers_bottoms', 'enhancingExperience');
            xpBonus += base * this.enhanceBonus[this.config.enhancerBotLevel];
        }
        
        // Philosopher's necklace (5x scaling)
        if (this.config.philoNeckLevel) {
            const base = this._getNoncombatStat('/items/philosophers_necklace', 'skillingExperience');
            xpBonus += base * (((this.enhanceBonus[this.config.philoNeckLevel] - 1) * 5) + 1);
        }
        
        // Experience buff
        if (this.config.experienceBuffLevel) {
            xpBonus += 0.195 + this.config.experienceBuffLevel * 0.005;
        }
        
        return baseXp * (1 + xpBonus);
    }
    
    // Get vendor price for an item
    getVendorPrice(hrid) {
        const item = this.items[hrid];
        return item?.sellPrice || 0;
    }
    
    // Get buy price from market data
    _getBuyPrice(hrid, enhancementLevel, prices, mode = PriceMode.MIDPOINT) {
        if (hrid === '/items/coin') return 1;
        
        const market = prices.market || {};
        const itemMarket = market[hrid] || {};
        const levelData = itemMarket[String(enhancementLevel)] || {};
        
        const ask = levelData.a ?? -1;
        const bid = levelData.b ?? -1;
        
        if (ask === -1 && bid === -1) return 0;
        
        if (mode === PriceMode.PESSIMISTIC) {
            return ask > 0 ? ask : 0;
        } else if (mode === PriceMode.OPTIMISTIC) {
            return bid > 0 ? bid : (ask > 0 ? ask : 0);
        } else {
            if (ask > 0 && bid > 0) return (ask + bid) / 2;
            return ask > 0 ? ask : 0;
        }
    }
    
    // Get sell price from market data
    getSellPrice(hrid, enhancementLevel, prices, mode = PriceMode.MIDPOINT) {
        if (hrid === '/items/coin') return 1;
        
        const market = prices.market || {};
        const itemMarket = market[hrid] || {};
        const levelData = itemMarket[String(enhancementLevel)] || {};
        
        const ask = levelData.a ?? -1;
        const bid = levelData.b ?? -1;
        
        if (ask === -1 && bid === -1) return 0;
        
        if (mode === PriceMode.PESSIMISTIC) {
            return bid > 0 ? bid : 0;
        } else if (mode === PriceMode.OPTIMISTIC) {
            return ask > 0 ? ask : (bid > 0 ? bid : 0);
        } else {
            if (ask > 0 && bid > 0) return (ask + bid) / 2;
            return bid > 0 ? bid : (ask > 0 ? ask : 0);
        }
    }
    
    // Calculate crafting cost recursively
    getCraftingCost(hrid, prices, mode = PriceMode.MIDPOINT, depth = 0) {
        if (depth > 10) return 0;
        if (hrid === '/items/coin') return 1;
        
        const item = this.items[hrid];
        if (!item) return 0;
        
        const category = item.category || '';
        if (category !== '/item_categories/equipment' && hrid !== '/items/philosophers_mirror') {
            return 0;
        }
        
        const recipe = this.recipes[hrid];
        if (!recipe) return 0;
        
        let cost = 0;
        const artisanMult = this.getArtisanTeaMultiplier();
        
        // Input materials (affected by artisan tea)
        for (const input of (recipe.inputs || [])) {
            const count = input.count * artisanMult;
            let inputPrice = this._getBuyPrice(input.item, 0, prices, mode);
            if (inputPrice <= 0) {
                inputPrice = this.getCraftingCost(input.item, prices, mode, depth + 1);
            }
            if (inputPrice <= 0) {
                inputPrice = this.getVendorPrice(input.item);
            }
            cost += count * inputPrice;
        }
        
        // Upgrade item (NOT affected by artisan tea)
        if (recipe.upgrade) {
            let upgradePrice = this._getBuyPrice(recipe.upgrade, 0, prices, mode);
            if (upgradePrice <= 0) {
                upgradePrice = this.getCraftingCost(recipe.upgrade, prices, mode, depth + 1);
            }
            if (upgradePrice <= 0) {
                upgradePrice = this.getVendorPrice(recipe.upgrade);
            }
            cost += upgradePrice;
        }
        
        return cost;
    }
    
    // Get item price (lower of market or craft)
    getItemPrice(hrid, enhancementLevel, prices, mode = PriceMode.MIDPOINT) {
        if (hrid === '/items/coin') return { price: 1, source: 'fixed' };
        
        // Special case: trainee charms
        if (hrid.includes('trainee') && hrid.includes('charm')) {
            return { price: 250000, source: 'vendor' };
        }
        
        const marketPrice = this._getBuyPrice(hrid, enhancementLevel, prices, mode);
        
        if (enhancementLevel === 0) {
            const craftingCost = this.getCraftingCost(hrid, prices, mode);
            
            if (marketPrice > 0 && craftingCost > 0) {
                if (craftingCost < marketPrice) {
                    return { price: craftingCost, source: 'craft' };
                } else {
                    return { price: marketPrice, source: 'market' };
                }
            } else if (marketPrice > 0) {
                return { price: marketPrice, source: 'market' };
            } else if (craftingCost > 0) {
                return { price: craftingCost, source: 'craft' };
            }
        } else if (marketPrice > 0) {
            return { price: marketPrice, source: 'market' };
        }
        
        const vendor = this.getVendorPrice(hrid);
        if (vendor > 0) {
            return { price: vendor, source: 'vendor' };
        }
        
        return { price: 0, source: 'none' };
    }
    
    // Matrix inversion using Gaussian elimination
    _invertMatrix(matrix) {
        const n = matrix.length;
        const augmented = matrix.map((row, i) => {
            const newRow = [...row];
            for (let j = 0; j < n; j++) {
                newRow.push(i === j ? 1 : 0);
            }
            return newRow;
        });
        
        // Forward elimination
        for (let i = 0; i < n; i++) {
            // Find pivot
            let maxRow = i;
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
                    maxRow = k;
                }
            }
            [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
            
            // Scale pivot row
            const pivot = augmented[i][i];
            if (Math.abs(pivot) < 1e-10) continue;
            
            for (let j = 0; j < 2 * n; j++) {
                augmented[i][j] /= pivot;
            }
            
            // Eliminate column
            for (let k = 0; k < n; k++) {
                if (k !== i) {
                    const factor = augmented[k][i];
                    for (let j = 0; j < 2 * n; j++) {
                        augmented[k][j] -= factor * augmented[i][j];
                    }
                }
            }
        }
        
        // Extract inverse
        return augmented.map(row => row.slice(n));
    }
    
    // Markov chain enhancement calculation
    _markovEnhance(stopAt, protectAt, totalBonus, matPrices, coinCost, protectPrice, basePrice, useBlessed = false, guzzling = 1, itemLevel = 1) {
        const n = stopAt;
        
        // Build transition matrix Q
        const Q = Array(n).fill(null).map(() => Array(n).fill(0));
        
        for (let i = 0; i < n; i++) {
            let successChance = (this.successRate[i] / 100.0) * totalBonus;
            successChance = Math.min(successChance, 1.0);
            
            let remainingSuccess = successChance;
            
            // Blessed tea: 1% chance to gain +2
            if (useBlessed && i + 2 <= stopAt) {
                const blessedChance = successChance * 0.01 * guzzling;
                if (i + 2 < n) {
                    Q[i][i + 2] = blessedChance;
                }
                remainingSuccess -= blessedChance;
            }
            
            const failChance = 1.0 - successChance;
            
            let destination = (i >= protectAt) ? (i - 1) : 0;
            destination = Math.max(0, destination);
            
            if (i + 1 < n) {
                Q[i][i + 1] = remainingSuccess;
            }
            
            Q[i][destination] += failChance;
        }
        
        // Calculate (I - Q)^(-1)
        const I_minus_Q = Q.map((row, i) => row.map((val, j) => (i === j ? 1 : 0) - val));
        const M = this._invertMatrix(I_minus_Q);
        
        // Expected attempts = sum of first row of M
        let attempts = 0;
        for (let j = 0; j < n; j++) {
            attempts += M[0][j];
        }
        
        // Expected protection uses
        let protectCount = 0;
        for (let i = protectAt; i < n; i++) {
            let successChance = (this.successRate[i] / 100.0) * totalBonus;
            successChance = Math.min(successChance, 1.0);
            const failChance = 1.0 - successChance;
            protectCount += M[0][i] * failChance;
        }
        
        // Calculate costs
        let matCost = 0;
        for (const [count, price] of matPrices) {
            matCost += count * price * attempts;
        }
        matCost += coinCost * attempts;
        matCost += protectPrice * protectCount;
        
        const totalCost = basePrice + matCost;
        
        // Calculate XP
        let totalXp = 0;
        for (let i = 0; i < n; i++) {
            let successChance = (this.successRate[i] / 100.0) * totalBonus;
            successChance = Math.min(successChance, 1.0);
            const xpPerAction = this.getXpPerAction(itemLevel, i);
            totalXp += M[0][i] * xpPerAction * (successChance + 0.1 * (1 - successChance));
        }
        
        return {
            actions: attempts,
            protectCount,
            matCost,
            totalCost,
            totalXp,
        };
    }
    
    // Calculate enhancement cost for an item
    calculateEnhancementCost(itemHrid, targetLevel, prices, mode = PriceMode.MIDPOINT) {
        const item = this.items[itemHrid];
        if (!item || !item.enhancementCosts) return null;
        
        const itemLevel = item.level || 1;
        
        // Parse enhancement costs
        const matCosts = [];
        let coinCost = 0;
        
        for (const cost of item.enhancementCosts) {
            if (cost.item === '/items/coin') {
                coinCost = cost.count;
            } else {
                matCosts.push([cost.item, cost.count]);
            }
        }
        
        // Get material prices
        const matPrices = [];
        for (const [hrid, count] of matCosts) {
            const { price } = this.getItemPrice(hrid, 0, prices, mode);
            matPrices.push([count, price]);
        }
        
        // Get base item price
        const { price: basePrice, source: baseSource } = this.getItemPrice(itemHrid, 0, prices, mode);
        
        // Get protection options
        const mirrorPrice = this.getItemPrice('/items/mirror_of_protection', 0, prices, mode).price;
        
        const protectHrids = item.protectionItems || [];
        const protectOptions = [
            ['/items/mirror_of_protection', mirrorPrice],
            [itemHrid, basePrice],
        ];
        
        for (const phrid of protectHrids) {
            if (!phrid.includes('_refined')) {
                const pprice = this.getItemPrice(phrid, 0, prices, mode).price;
                if (pprice > 0) {
                    protectOptions.push([phrid, pprice]);
                }
            }
        }
        
        // Find cheapest valid protection
        const validProtects = protectOptions.filter(([, p]) => p > 0);
        if (validProtects.length === 0) return null;
        
        validProtects.sort((a, b) => a[1] - b[1]);
        const [protectHrid, protectPrice] = validProtects[0];
        
        const totalBonus = this.getTotalBonus(itemLevel);
        const attemptTime = this.getAttemptTime(itemLevel);
        
        const useBlessed = this.config.teaBlessed;
        const guzzling = useBlessed ? this.getGuzzlingBonus() : 1;
        
        // Find optimal protection level
        let bestResult = null;
        let bestTotal = Infinity;
        
        for (let protLevel = 2; protLevel <= targetLevel; protLevel++) {
            const result = this._markovEnhance(
                targetLevel, protLevel, totalBonus,
                matPrices, coinCost, protectPrice, basePrice,
                useBlessed, guzzling, itemLevel
            );
            
            if (result.totalCost < bestTotal) {
                bestTotal = result.totalCost;
                bestResult = { ...result, protectAt: protLevel };
            }
        }
        
        if (bestResult) {
            bestResult.itemHrid = itemHrid;
            bestResult.itemLevel = itemLevel;
            bestResult.protectPrice = protectPrice;
            bestResult.protectHrid = protectHrid;
            bestResult.basePrice = basePrice;
            bestResult.baseSource = baseSource;
            bestResult.attemptTime = attemptTime;
        }
        
        return bestResult;
    }
    
    // Calculate profit for enhancing to target level
    calculateProfit(itemHrid, targetLevel, prices, mode = PriceMode.PESSIMISTIC) {
        const result = this.calculateEnhancementCost(itemHrid, targetLevel, prices, mode);
        if (!result) return null;
        
        const sellPrice = this.getSellPrice(itemHrid, targetLevel, prices, mode);
        if (sellPrice <= 0) return null;
        
        const marketFee = sellPrice * 0.02;
        const profit = sellPrice - result.totalCost;
        const profitAfterFee = profit - marketFee;
        const roi = result.totalCost > 0 ? (profit / result.totalCost) * 100 : 0;
        const roiAfterFee = result.totalCost > 0 ? (profitAfterFee / result.totalCost) * 100 : 0;
        
        const totalTimeHours = result.actions * result.attemptTime / 3600;
        const totalTimeDays = totalTimeHours / 24;
        
        const profitPerDay = totalTimeDays > 0 ? profit / totalTimeDays : 0;
        const profitPerDayAfterFee = totalTimeDays > 0 ? profitAfterFee / totalTimeDays : 0;
        const xpPerDay = totalTimeDays > 0 ? result.totalXp / totalTimeDays : 0;
        
        return {
            itemHrid,
            targetLevel,
            basePrice: result.basePrice,
            baseSource: result.baseSource,
            matCost: result.matCost,
            totalCost: result.totalCost,
            sellPrice,
            marketFee,
            profit,
            profitAfterFee,
            roi,
            roiAfterFee,
            profitPerDay,
            profitPerDayAfterFee,
            xpPerDay,
            totalXp: result.totalXp,
            actions: result.actions,
            timeHours: totalTimeHours,
            timeDays: totalTimeDays,
            protectCount: result.protectCount,
            protectAt: result.protectAt,
            protectHrid: result.protectHrid,
            protectPrice: result.protectPrice,
            mode,
        };
    }
}

// Export for use in browser and tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EnhanceCalculator, PriceMode, DEFAULT_CONFIG };
} else if (typeof window !== 'undefined') {
    window.EnhanceCalculator = EnhanceCalculator;
    window.PriceMode = PriceMode;
    window.DEFAULT_CONFIG = DEFAULT_CONFIG;
}
