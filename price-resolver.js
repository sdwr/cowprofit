/**
 * price-resolver.js — Resolve market prices for a shopping list
 * based on category-specific modes + tick logic.
 */

// Buy modes (for materials and protections)
const BuyMode = {
    PESSIMISTIC: 'pessimistic',         // Ask
    PESSIMISTIC_PLUS: 'pessimistic+',   // Ask - 1 tick
    OPTIMISTIC_MINUS: 'optimistic-',    // Bid + 1 tick
    OPTIMISTIC: 'optimistic',           // Bid
};

// Sell modes
const SellMode = {
    PESSIMISTIC: 'pessimistic',         // Bid
    PESSIMISTIC_PLUS: 'pessimistic+',   // Bid + 1 tick
    MIDPOINT: 'midpoint',              // (Bid + Ask) / 2
    OPTIMISTIC_MINUS: 'optimistic-',    // Ask - 1 tick
    OPTIMISTIC: 'optimistic',           // Ask
};

class PriceResolver {
    constructor(gameData, priceTiers) {
        this.items = gameData.items || {};
        this.recipes = gameData.recipes || {};
        this.priceTiers = priceTiers || PRICE_TIERS;
    }

    // ============================================
    // TICK LOGIC
    // ============================================

    getPriceStep(price) {
        for (const [max, step] of this.priceTiers) {
            if (price <= max) return step;
        }
        return 500000000;
    }

    getValidPrice(price) {
        if (price <= 0) return 0;
        const step = this.getPriceStep(price);
        return Math.round(price / step) * step;
    }

    getNextPrice(price) {
        if (price <= 0) return 1;
        const step = this.getPriceStep(price);
        const next = price + step;
        const nextStep = this.getPriceStep(next);
        if (nextStep !== step) {
            return Math.ceil(next / nextStep) * nextStep;
        }
        return next;
    }

    getPrevPrice(price) {
        if (price <= 1) return 0;
        const step = this.getPriceStep(price);
        const prev = price - step;
        if (prev <= 0) return 0;
        const prevStep = this.getPriceStep(prev);
        if (prevStep !== step) {
            return Math.floor(prev / prevStep) * prevStep;
        }
        return prev;
    }

    // ============================================
    // RAW PRICE LOOKUPS
    // ============================================

    /**
     * Get raw bid/ask for an item at a level from market data.
     * @returns {{ bid: number, ask: number }}
     */
    _getRawPrices(hrid, enhLevel, marketPrices) {
        if (hrid === '/items/coin') return { bid: 1, ask: 1 };
        const itemMarket = marketPrices[hrid] || {};
        const levelData = itemMarket[String(enhLevel)] || {};
        return {
            bid: levelData.b ?? -1,
            ask: levelData.a ?? -1,
        };
    }

    /**
     * Check if bid and ask are within 1 tick of each other (tight spread).
     */
    _isTightSpread(bid, ask) {
        if (bid <= 0 || ask <= 0) return false;
        const step = this.getPriceStep(bid);
        return (ask - bid) <= step;
    }

    /**
     * Resolve a buy price using a BuyMode.
     * Returns { price, mode, actualMode, bid, ask }
     */
    _resolveBuyPrice(hrid, enhLevel, marketPrices, mode) {
        const { bid, ask } = this._getRawPrices(hrid, enhLevel, marketPrices);

        if (ask <= 0 && bid <= 0) {
            return { price: 0, mode, actualMode: mode, bid, ask };
        }

        const tight = this._isTightSpread(bid, ask);
        let actualMode = mode;
        let price = 0;

        switch (mode) {
            case BuyMode.PESSIMISTIC: // Ask
                price = ask > 0 ? ask : 0;
                break;

            case BuyMode.PESSIMISTIC_PLUS: // Ask - 1 tick
                if (tight || ask <= 0) {
                    actualMode = BuyMode.PESSIMISTIC;
                    price = ask > 0 ? ask : 0;
                } else {
                    price = this.getPrevPrice(ask);
                }
                break;

            case BuyMode.OPTIMISTIC_MINUS: // Bid + 1 tick
                if (tight || bid <= 0) {
                    actualMode = BuyMode.OPTIMISTIC;
                    price = bid > 0 ? bid : (ask > 0 ? ask : 0);
                } else {
                    price = this.getNextPrice(bid);
                }
                break;

            case BuyMode.OPTIMISTIC: // Bid
                price = bid > 0 ? bid : (ask > 0 ? ask : 0);
                break;

            default:
                price = ask > 0 ? ask : 0;
        }

        return { price, mode, actualMode, bid: bid > 0 ? bid : 0, ask: ask > 0 ? ask : 0 };
    }

    /**
     * Resolve a sell price using a SellMode.
     * Returns { price, mode, actualMode, bid, ask }
     */
    _resolveSellPrice(hrid, enhLevel, marketPrices, mode) {
        const { bid, ask } = this._getRawPrices(hrid, enhLevel, marketPrices);

        if (ask <= 0 && bid <= 0) {
            return { price: 0, mode, actualMode: mode, bid: 0, ask: 0 };
        }

        const tight = this._isTightSpread(bid, ask);
        let actualMode = mode;
        let price = 0;

        switch (mode) {
            case SellMode.PESSIMISTIC: // Bid
                price = bid > 0 ? bid : 0;
                break;

            case SellMode.PESSIMISTIC_PLUS: // Bid + 1 tick
                if (tight || bid <= 0) {
                    actualMode = SellMode.PESSIMISTIC;
                    price = bid > 0 ? bid : 0;
                } else {
                    price = this.getNextPrice(bid);
                }
                break;

            case SellMode.MIDPOINT: // (Bid + Ask) / 2
                if (ask > 0 && bid > 0) {
                    price = (ask + bid) / 2;
                } else {
                    price = bid > 0 ? bid : (ask > 0 ? ask : 0);
                }
                break;

            case SellMode.OPTIMISTIC_MINUS: // Ask - 1 tick
                if (tight || ask <= 0) {
                    actualMode = SellMode.OPTIMISTIC;
                    price = ask > 0 ? ask : (bid > 0 ? bid : 0);
                } else {
                    price = this.getPrevPrice(ask);
                }
                break;

            case SellMode.OPTIMISTIC: // Ask
                price = ask > 0 ? ask : (bid > 0 ? bid : 0);
                break;

            default:
                price = bid > 0 ? bid : 0;
        }

        return { price, mode, actualMode, bid: bid > 0 ? bid : 0, ask: ask > 0 ? ask : 0 };
    }

    // ============================================
    // CRAFTING COST (always pessimistic, recursive)
    // ============================================

    /**
     * Calculate crafting cost recursively.
     * @param {string} hrid - Item HRID
     * @param {Object} marketPrices - prices.market
     * @param {number} artisanMult - Artisan tea multiplier
     * @param {number} depth - Recursion depth
     * @returns {number} Crafting cost
     */
    getCraftingCost(hrid, marketPrices, artisanMult = 1.0, depth = 0) {
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

        // Input materials (affected by artisan tea)
        for (const input of (recipe.inputs || [])) {
            const count = input.count * artisanMult;
            let inputPrice = this._resolveBuyPrice(input.item, 0, marketPrices, BuyMode.PESSIMISTIC).price;
            if (inputPrice <= 0) {
                inputPrice = this.getCraftingCost(input.item, marketPrices, artisanMult, depth + 1);
            }
            if (inputPrice <= 0) {
                const vendorItem = this.items[input.item];
                inputPrice = vendorItem?.sellPrice || 0;
            }
            cost += count * inputPrice;
        }

        // Upgrade item (NOT affected by artisan tea)
        if (recipe.upgrade) {
            let upgradePrice = this._resolveBuyPrice(recipe.upgrade, 0, marketPrices, BuyMode.PESSIMISTIC).price;
            if (upgradePrice <= 0) {
                upgradePrice = this.getCraftingCost(recipe.upgrade, marketPrices, artisanMult, depth + 1);
            }
            if (upgradePrice <= 0) {
                const vendorItem = this.items[recipe.upgrade];
                upgradePrice = vendorItem?.sellPrice || 0;
            }
            cost += upgradePrice;
        }

        return cost;
    }

    // ============================================
    // MAIN RESOLVE
    // ============================================

    /**
     * Resolve all prices for a shopping list.
     *
     * @param {Object} shoppingList - From ItemResolver.resolve()
     * @param {Object} marketPrices - prices.market
     * @param {Object} modeConfig - { matMode: BuyMode, protMode: BuyMode, sellMode: SellMode }
     * @param {number} artisanMult - Artisan tea multiplier (from calculator)
     * @returns {Object} Resolved prices
     */
    resolve(shoppingList, marketPrices, modeConfig, artisanMult = 1.0) {
        const { matMode, protMode, sellMode } = modeConfig;

        // --- Material prices ---
        const matPrices = [];
        const priceDetails = {};

        for (const mat of shoppingList.materials) {
            const resolved = this._resolveBuyPrice(mat.hrid, 0, marketPrices, matMode);
            // Match legacy getItemPrice: compare market vs craft, take cheaper
            let price = resolved.price;
            const craftPrice = this.getCraftingCost(mat.hrid, marketPrices, artisanMult);
            if (price > 0 && craftPrice > 0) {
                price = Math.min(price, craftPrice);
            } else if (price <= 0 && craftPrice > 0) {
                price = craftPrice;
            }
            if (price <= 0) {
                const vendorItem = this.items[mat.hrid];
                price = vendorItem?.sellPrice || 0;
            }
            matPrices.push([mat.count, price, { hrid: mat.hrid, ...resolved, price }]);
            priceDetails[mat.hrid] = { ...resolved, price };
        }

        // --- Base item price (always pessimistic, with craft fallback) ---
        const baseMarketResolved = this._resolveBuyPrice(shoppingList.itemHrid, 0, marketPrices, BuyMode.PESSIMISTIC);
        let baseMarketPrice = baseMarketResolved.price;

        // Special case: trainee charms
        if (shoppingList.itemHrid.includes('trainee') && shoppingList.itemHrid.includes('charm')) {
            return this._buildResult(shoppingList, matPrices, priceDetails,
                250000, 'vendor', null, marketPrices, protMode, sellMode, artisanMult);
        }

        let basePrice = baseMarketPrice;
        let baseSource = baseMarketPrice > 0 ? 'market' : 'none';

        // Try crafting cost
        const craftCost = this.getCraftingCost(shoppingList.itemHrid, marketPrices, artisanMult);
        if (craftCost > 0 && (baseMarketPrice <= 0 || craftCost < baseMarketPrice)) {
            basePrice = craftCost;
            baseSource = 'craft';
        }

        // Vendor fallback
        if (basePrice <= 0) {
            const vendorItem = this.items[shoppingList.itemHrid];
            const vendorPrice = vendorItem?.sellPrice || 0;
            if (vendorPrice > 0) {
                basePrice = vendorPrice;
                baseSource = 'vendor';
            }
        }

        return this._buildResult(shoppingList, matPrices, priceDetails,
            basePrice, baseSource, baseMarketResolved, marketPrices, protMode, sellMode, artisanMult);
    }

    /**
     * Build the final resolved prices object.
     */
    _buildResult(shoppingList, matPrices, priceDetails, basePrice, baseSource,
                 baseMarketResolved, marketPrices, protMode, sellMode, artisanMult) {

        // --- Protection pricing ---
        let bestProtPrice = Infinity;
        let bestProtHrid = null;
        let bestProtResolved = null;

        for (const opt of shoppingList.protectionOptions) {
            let resolved;
            if (opt.isBaseItem) {
                // Base item as protection — use already-resolved base price
                resolved = { price: basePrice, mode: protMode, actualMode: protMode, bid: 0, ask: 0 };
            } else {
                // Special case: trainee charms
                if (opt.hrid.includes('trainee') && opt.hrid.includes('charm')) {
                    resolved = { price: 250000, mode: protMode, actualMode: protMode, bid: 0, ask: 0 };
                } else {
                    resolved = this._resolveBuyPrice(opt.hrid, 0, marketPrices, protMode);
                }
                // Craft/vendor fallback for protection items too
                if (resolved.price <= 0) {
                    const craftCost = this.getCraftingCost(opt.hrid, marketPrices, artisanMult);
                    if (craftCost > 0) {
                        resolved = { ...resolved, price: craftCost };
                    } else {
                        const vendorItem = this.items[opt.hrid];
                        const vp = vendorItem?.sellPrice || 0;
                        if (vp > 0) resolved = { ...resolved, price: vp };
                    }
                }
            }

            if (resolved.price > 0 && resolved.price < bestProtPrice) {
                bestProtPrice = resolved.price;
                bestProtHrid = opt.hrid;
                bestProtResolved = resolved;
            }
        }

        if (bestProtPrice === Infinity) {
            bestProtPrice = 0;
            bestProtHrid = null;
        }

        // --- Sell price ---
        const sellResolved = this._resolveSellPrice(
            shoppingList.itemHrid, shoppingList.targetLevel, marketPrices, sellMode
        );

        return {
            matPrices,      // [[count, resolvedPrice, detail], ...]
            coinCost: shoppingList.coinCost,
            basePrice,
            baseSource,
            protectPrice: bestProtPrice,
            protectHrid: bestProtHrid,
            sellPrice: sellResolved.price,
            priceDetails,
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PriceResolver, BuyMode, SellMode };
} else if (typeof window !== 'undefined') {
    window.PriceResolver = PriceResolver;
    window.BuyMode = BuyMode;
    window.SellMode = SellMode;
}
