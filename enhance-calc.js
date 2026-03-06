/**
 * MWI Enhancement Cost Calculator (JavaScript port)
 * Implements the same Markov chain math as Python enhance_calc.py
 * 
 * Slimmed: price resolution moved to price-resolver.js,
 * item resolution moved to item-resolver.js.
 * This file contains only simulation + gear config.
 */

// Default player config (same as Python USER_CONFIG)
const DEFAULT_CONFIG = {
    enhancingLevel: 110,
    observatoryLevel: 4,
    
    // Gear with enhancement levels
    enchantedGlovesLevel: 10,
    enchantedGlovesEquipped: true,
    guzzlingPouchLevel: 6,
    guzzlingPouchEquipped: true,
    enhancerTopLevel: 0,
    enhancerTopEquipped: false,
    enhancerBotLevel: 0,
    enhancerBotEquipped: false,
    
    // Necklace (type: 'philo' or 'speed')
    neckType: 'speed',
    philoNeckLevel: 0,
    philoNeckEquipped: false,
    speedNeckLevel: 6,
    speedNeckEquipped: true,
    
    // Cape
    capeLevel: 0,
    capeEquipped: false,
    capeRefined: false,
    
    charmLevel: 0,
    charmTier: 'none',
    
    // Buffs (0 = disabled, 1-20 = level)
    enhancingBuffLevel: 20,
    experienceBuffLevel: 20,
    
    // Enhancer tool
    enhancer: 'celestial_enhancer',
    enhancerLevel: 8,
    
    // Teas
    teaEnhancing: false,
    teaSuperEnhancing: false,
    teaUltraEnhancing: true,
    teaBlessed: true,
    teaWisdom: true,
    artisanTea: true,
    
    // Achievement bonus
    achievementSuccessBonus: 0,
};

class EnhanceCalculator {
    constructor(gameData, config = DEFAULT_CONFIG) {
        this.items = gameData.items || {};
        this.recipes = gameData.recipes || {};
        this.constants = gameData.constants || {};
        this.config = { ...DEFAULT_CONFIG, ...config };
        this._gameData = gameData;
        
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
    
    // Check if a gear piece is equipped (defaults to true for backwards compat)
    _isEquipped(hrid) {
        const equipMap = {
            '/items/enchanted_gloves': 'enchantedGlovesEquipped',
            '/items/enhancers_top': 'enhancerTopEquipped',
            '/items/enhancers_bottoms': 'enhancerBotEquipped',
            '/items/philosophers_necklace': 'philoNeckEquipped',
            '/items/necklace_of_speed': 'speedNeckEquipped',
            '/items/chance_cape': 'capeEquipped',
            '/items/chance_cape_refined': 'capeEquipped',
            '/items/guzzling_pouch': 'guzzlingPouchEquipped',
        };
        const key = equipMap[hrid];
        return key ? (this.config[key] !== false) : true;
    }
    
    // Get noncombat stat from an item (returns 0 if unequipped)
    _getNoncombatStat(hrid, statName) {
        if (!this._isEquipped(hrid)) return 0;
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
        
        // Gear speed bonuses (_getNoncombatStat returns 0 if unequipped)
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
        // Necklace speed (5x scaling) - either philo or speed neck
        if (this.config.neckType === 'speed' && this.config.speedNeckLevel) {
            const base = this._getNoncombatStat('/items/necklace_of_speed', 'skillingSpeed');
            itemBonus += base * 100 * (((this.enhanceBonus[this.config.speedNeckLevel] - 1) * 5) + 1);
        } else if (this.config.philoNeckLevel) {
            const base = this._getNoncombatStat('/items/philosophers_necklace', 'skillingSpeed');
            itemBonus += base * 100 * (((this.enhanceBonus[this.config.philoNeckLevel] - 1) * 5) + 1);
        }
        
        // Chance cape speed (5x scaling)
        if (this.config.capeLevel) {
            const capeHrid = this.config.capeRefined ? '/items/chance_cape_refined' : '/items/chance_cape';
            const base = this._getNoncombatStat(capeHrid, 'enhancingSpeed');
            if (base) {
                itemBonus += base * 100 * (((this.enhanceBonus[this.config.capeLevel] - 1) * 5) + 1);
            }
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
        
        // Enhancer tool XP bonus (1x scaling)
        if (this.config.enhancerLevel && this.config.enhancer) {
            const enhancerHrid = `/items/${this.config.enhancer}`;
            const base = this._getNoncombatStat(enhancerHrid, 'enhancingExperience');
            if (base) {
                xpBonus += base * this.enhanceBonus[this.config.enhancerLevel];
            }
        }
        
        // Enhancer bottoms XP bonus (1x scaling)
        if (this.config.enhancerBotLevel) {
            const base = this._getNoncombatStat('/items/enhancers_bottoms', 'enhancingExperience');
            xpBonus += base * this.enhanceBonus[this.config.enhancerBotLevel];
        }
        
        // Philosopher's necklace XP (5x scaling) - only if using philo neck
        if (this.config.neckType !== 'speed' && this.config.philoNeckLevel) {
            const base = this._getNoncombatStat('/items/philosophers_necklace', 'skillingExperience');
            xpBonus += base * (((this.enhanceBonus[this.config.philoNeckLevel] - 1) * 5) + 1);
        }
        
        // Chance cape XP (5x scaling)
        if (this.config.capeLevel) {
            const capeHrid = this.config.capeRefined ? '/items/chance_cape_refined' : '/items/chance_cape';
            const base = this._getNoncombatStat(capeHrid, 'enhancingExperience');
            if (base) {
                xpBonus += base * (((this.enhanceBonus[this.config.capeLevel] - 1) * 5) + 1);
            }
        }
        
        // Enhancing charm XP bonus (5x scaling, like philosopher's necklace)
        if (this.config.charmLevel && this.config.charmTier && this.config.charmTier !== 'none') {
            const charmHrid = `/items/${this.config.charmTier}_enhancing_charm`;
            const base = this._getNoncombatStat(charmHrid, 'enhancingExperience');
            if (base) {
                xpBonus += base * (((this.enhanceBonus[this.config.charmLevel] - 1) * 5) + 1);
            }
        }
        
        // Experience buff
        if (this.config.experienceBuffLevel) {
            xpBonus += 0.195 + this.config.experienceBuffLevel * 0.005;
        }
        
        return baseXp * (1 + xpBonus);
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

    /**
     * simulate() — Run enhancement simulation with pre-resolved prices.
     *
     * @param {Object} resolvedPrices - From PriceResolver.resolve()
     *   { matPrices: [[count, price, detail], ...], coinCost, basePrice, baseSource,
     *     protectPrice, protectHrid, sellPrice }
     * @param {number} targetLevel
     * @param {number} itemLevel
     * @returns {Object|null} Best simulation result
     */
    simulate(resolvedPrices, targetLevel, itemLevel) {
        const totalBonus = this.getTotalBonus(itemLevel);
        const attemptTime = this.getAttemptTime(itemLevel);
        const useBlessed = this.config.teaBlessed;
        const guzzling = useBlessed ? this.getGuzzlingBonus() : 1;

        // Extract [count, price] pairs from matPrices (strip detail)
        const matPricesSimple = resolvedPrices.matPrices.map(([count, price]) => [count, price]);

        // Find optimal protection level (iterate 2..targetLevel)
        let bestResult = null;
        let bestTotal = Infinity;

        for (let protLevel = 2; protLevel <= targetLevel; protLevel++) {
            const result = this._markovEnhance(
                targetLevel, protLevel, totalBonus,
                matPricesSimple, resolvedPrices.coinCost,
                resolvedPrices.protectPrice, resolvedPrices.basePrice,
                useBlessed, guzzling, itemLevel
            );

            if (result.totalCost < bestTotal) {
                bestTotal = result.totalCost;
                bestResult = { ...result, protectAt: protLevel };
            }
        }

        if (bestResult) {
            bestResult.itemLevel = itemLevel;
            bestResult.protectPrice = resolvedPrices.protectPrice;
            bestResult.protectHrid = resolvedPrices.protectHrid;
            bestResult.basePrice = resolvedPrices.basePrice;
            bestResult.baseSource = resolvedPrices.baseSource;
            bestResult.attemptTime = attemptTime;
        }

        return bestResult;
    }
    
}

// Export for use in browser and tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EnhanceCalculator, DEFAULT_CONFIG };
} else if (typeof window !== 'undefined') {
    window.EnhanceCalculator = EnhanceCalculator;
    window.DEFAULT_CONFIG = DEFAULT_CONFIG;
}
