/**
 * price-resolver.js — Price Resolution Layer
 * Resolves market prices for a shopping list based on category-specific modes.
 * Contains tick logic (PRICE_TIERS) and all price lookup methods.
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

// MWI marketplace price tiers: [maxPrice, stepSize]
const PRICE_TIERS = [
    [50, 1],
    [100, 2],
    [300, 5],
    [500, 10],
    [1000, 20],
    [3000, 50],
    [5000, 100],
    [10000, 200],
    [30000, 500],
    [50000, 1000],
    [100000, 2000],
    [300000, 5000],
    [500000, 10000],
    [1000000, 20000],
    [3000000, 50000],
    [5000000, 100000],
    [10000000, 200000],
    [30000000, 500000],
    [50000000, 1000000],
    [100000000, 2000000],
    [300000000, 5000000],
    [500000000, 10000000],
    [1000000000, 20000000],
    [3000000000, 50000000],
    [5000000000, 100000000],
    [10000000000, 200000000],
];

function getPriceStep(price) {
    for (const [max, step] of PRICE_TIERS) {
        if (price <= max) return step;
    }
    return 500000000;
}

function getValidPrice(price) {
    if (price <= 0) return 0;
    const step = getPriceStep(price);
    return Math.round(price / step) * step;
}

function getNextPrice(price) {
    if (price <= 0) return 1;
    const step = getPriceStep(price);
    const next = price + step;
    const nextStep = getPriceStep(next);
    if (nextStep !== step) {
        return Math.ceil(next / nextStep) * nextStep;
    }
    return next;
}

function getPrevPrice(price) {
    if (price <= 1) return 0;
    const step = getPriceStep(price);
    const prev = price - step;
    if (prev <= 0) return 0;
    const prevStep = getPriceStep(prev);
    if (prevStep !== step) {
        return Math.floor(prev / prevStep) * prevStep;
    }
    return prev;
}

class PriceResolver {
    constructor(gameData) {
        this.items = gameData.items || {};
        this.recipes = gameData.recipes || {};
    }

    /**
     * Resolve a buy price for an item from market data.
     */
    _resolveBuyPrice(hrid, enhLevel, marketPrices, mode) {
        if (hrid === '/items/coin') {
            return { price: 1, mode, actualMode: mode, bid: 1, ask: 1 };
        }

        const market = marketPrices.market || {};
        const itemMarket = market[hrid] || {};
        const levelData = itemMarket[String(enhLevel)] || {};

        const ask = levelData.a ?? -1;
        const bid = levelData.b ?? -1;

        if (ask === -1 && bid === -1) {
            return { price: 0, mode, actualMode: mode, bid: 0, ask: 0 };
        }

        const validAsk = ask > 0 ? ask : 0;
        const validBid = bid > 0 ? bid : 0;

        // Tight spread: bid and ask ≤ 1 tick apart
        const isTight = validAsk > 0 && validBid > 0 &&
            (validAsk <= getNextPrice(validBid));

        let price = 0;
        let actualMode = mode;

        switch (mode) {
            case BuyMode.PESSIMISTIC:
                price = validAsk || 0;
                break;
            case BuyMode.PESSIMISTIC_PLUS:
                if (isTight) {
                    price = validAsk;
                    actualMode = BuyMode.PESSIMISTIC;
                } else if (validAsk > 0) {
                    price = getPrevPrice(validAsk);
                }
                break;
            case BuyMode.OPTIMISTIC_MINUS:
                if (isTight) {
                    price = validBid || validAsk;
                    actualMode = BuyMode.OPTIMISTIC;
                } else if (validBid > 0) {
                    price = getNextPrice(validBid);
                } else {
                    price = validAsk || 0;
                }
                break;
            case BuyMode.OPTIMISTIC:
                price = validBid || validAsk || 0;
                break;
            default:
                price = validAsk || 0;
                actualMode = BuyMode.PESSIMISTIC;
        }

        return { price, mode, actualMode, bid: validBid, ask: validAsk };
    }

    /**
     * Resolve a sell price for an item from market data.
     */
    _resolveSellPrice(hrid, enhLevel, marketPrices, mode) {
        if (hrid === '/items/coin') {
            return { price: 1, mode, actualMode: mode, bid: 1, ask: 1 };
        }

        const market = marketPrices.market || {};
        const itemMarket = market[hrid] || {};
        const levelData = itemMarket[String(enhLevel)] || {};

        const ask = levelData.a ?? -1;
        const bid = levelData.b ?? -1;

        if (ask === -1 && bid === -1) {
            return { price: 0, mode, actualMode: mode, bid: 0, ask: 0 };
        }

        const validAsk = ask > 0 ? ask : 0;
        const validBid = bid > 0 ? bid : 0;

        const isTight = validAsk > 0 && validBid > 0 &&
            (validAsk <= getNextPrice(validBid));

        let price = 0;
        let actualMode = mode;

        switch (mode) {
            case SellMode.PESSIMISTIC:
                price = validBid || 0;
                break;
            case SellMode.PESSIMISTIC_PLUS:
                if (isTight) {
                    price = validBid;
                    actualMode = SellMode.PESSIMISTIC;
                } else if (validBid > 0) {
                    price = getNextPrice(validBid);
                }
                break;
            case SellMode.MIDPOINT:
                if (validAsk > 0 && validBid > 0) {
                    price = (validAsk + validBid) / 2;
                } else {
                    price = validBid || validAsk || 0;
                }
                break;
            case SellMode.OPTIMISTIC_MINUS:
                if (isTight) {
                    price = validAsk || validBid;
                    actualMode = SellMode.OPTIMISTIC;
                } else if (validAsk > 0) {
                    price = getPrevPrice(validAsk);
                } else {
                    price = validBid || 0;
                }
                break;
            case SellMode.OPTIMISTIC:
                price = validAsk || validBid || 0;
                break;
            default:
                price = validBid || 0;
                actualMode = SellMode.PESSIMISTIC;
        }

        return { price, mode, actualMode, bid: validBid, ask: validAsk };
    }

    /**
     * Get vendor price for an item.
     */
    _getVendorPrice(hrid) {
        const item = this.items[hrid];
        return item?.sellPrice || 0;
    }

    /**
     * Calculate crafting cost recursively. Always pessimistic (ask).
     */
    _getCraftingCost(hrid, marketPrices, artisanMult, depth = 0) {
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

        for (const input of (recipe.inputs || [])) {
            const count = input.count * artisanMult;
            let inputPrice = this._resolveBuyPrice(input.item, 0, marketPrices, BuyMode.PESSIMISTIC).price;
            if (inputPrice <= 0) {
                inputPrice = this._getCraftingCost(input.item, marketPrices, artisanMult, depth + 1);
            }
            if (inputPrice <= 0) {
                inputPrice = this._getVendorPrice(input.item);
            }
            cost += count * inputPrice;
        }

        if (recipe.upgrade) {
            let upgradePrice = this._resolveBuyPrice(recipe.upgrade, 0, marketPrices, BuyMode.PESSIMISTIC).price;
            if (upgradePrice <= 0) {
                upgradePrice = this._getCraftingCost(recipe.upgrade, marketPrices, artisanMult, depth + 1);
            }
            if (upgradePrice <= 0) {
                upgradePrice = this._getVendorPrice(recipe.upgrade);
            }
            cost += upgradePrice;
        }

        return cost;
    }

    /**
     * Get item price — lower of market (pessimistic) or craft.
     */
    _getItemPrice(hrid, enhLevel, marketPrices, artisanMult) {
        if (hrid === '/items/coin') return { price: 1, source: 'fixed' };

        if (hrid.includes('trainee') && hrid.includes('charm')) {
            return { price: 250000, source: 'vendor' };
        }

        const marketPrice = this._resolveBuyPrice(hrid, enhLevel, marketPrices, BuyMode.PESSIMISTIC).price;

        if (enhLevel === 0) {
            const craftingCost = this._getCraftingCost(hrid, marketPrices, artisanMult);

            if (marketPrice > 0 && craftingCost > 0) {
                return craftingCost < marketPrice
                    ? { price: craftingCost, source: 'craft' }
                    : { price: marketPrice, source: 'market' };
            } else if (marketPrice > 0) {
                return { price: marketPrice, source: 'market' };
            } else if (craftingCost > 0) {
                return { price: craftingCost, source: 'craft' };
            }
        } else if (marketPrice > 0) {
            return { price: marketPrice, source: 'market' };
        }

        const vendor = this._getVendorPrice(hrid);
        if (vendor > 0) return { price: vendor, source: 'vendor' };

        return { price: 0, source: 'none' };
    }

    /**
     * Resolve all prices for a shopping list.
     *
     * @param {Object} shoppingList - from ItemResolver.resolve()
     * @param {Object} marketPrices - prices object with .market
     * @param {Object} modeConfig - { matMode, protMode, sellMode }
     * @param {number} artisanMult - artisan tea multiplier
     * @returns {Object} resolved prices
     */
    resolve(shoppingList, marketPrices, modeConfig, artisanMult) {
        const { matMode, protMode, sellMode } = modeConfig;

        // Material prices with matMode
        const matPrices = [];
        const priceDetails = new Map();

        for (const mat of shoppingList.materials) {
            const detail = this._resolveBuyPrice(mat.hrid, 0, marketPrices, matMode);
            matPrices.push([mat.count, detail.price, {
                hrid: mat.hrid,
                mode: matMode,
                actualMode: detail.actualMode,
                bid: detail.bid,
                ask: detail.ask,
            }]);
            priceDetails.set(mat.hrid, detail);
        }

        // Base item — always pessimistic with craft fallback
        const { price: basePrice, source: baseSource } = this._getItemPrice(
            shoppingList.itemHrid, 0, marketPrices, artisanMult
        );

        // Protection — resolve ALL options, pick cheapest
        let protectPrice = 0;
        let protectHrid = null;
        const validProtects = [];

        for (const opt of shoppingList.protectionOptions) {
            let price;
            if (opt.isBaseItem) {
                price = basePrice;
            } else {
                const detail = this._resolveBuyPrice(opt.hrid, 0, marketPrices, protMode);
                price = detail.price;
                // Craft/vendor fallback
                if (price <= 0) {
                    const craftCost = this._getCraftingCost(opt.hrid, marketPrices, artisanMult);
                    if (craftCost > 0) {
                        price = craftCost;
                    } else {
                        price = this._getVendorPrice(opt.hrid);
                    }
                }
                priceDetails.set(opt.hrid + ':prot', { ...detail, price });
            }
            if (price > 0) {
                validProtects.push({ hrid: opt.hrid, price });
            }
        }

        if (validProtects.length > 0) {
            validProtects.sort((a, b) => a.price - b.price);
            protectPrice = validProtects[0].price;
            protectHrid = validProtects[0].hrid;
        }

        // Sell price
        const sellDetail = this._resolveSellPrice(
            shoppingList.itemHrid, shoppingList.targetLevel, marketPrices, sellMode
        );

        // Get prot actualMode from priceDetails if available
        let protectActualMode = protMode;
        if (protectHrid) {
            const protDetail = priceDetails.get(protectHrid + ':prot');
            if (protDetail) protectActualMode = protDetail.actualMode;
        }

        return {
            matPrices,
            coinCost: shoppingList.coinCost,
            basePrice,
            baseSource,
            protectPrice,
            protectHrid,
            protectActualMode,
            sellPrice: sellDetail.price,
            sellActualMode: sellDetail.actualMode,
            priceDetails,
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PriceResolver, BuyMode, SellMode, PRICE_TIERS, getPriceStep, getValidPrice, getNextPrice, getPrevPrice };
} else if (typeof window !== 'undefined') {
    window.PriceResolver = PriceResolver;
    window.BuyMode = BuyMode;
    window.SellMode = SellMode;
    // Expose tick functions as globals (used by main.js loot history)
    window.PRICE_TIERS = PRICE_TIERS;
    window.getPriceStep = getPriceStep;
    window.getValidPrice = getValidPrice;
    window.getNextPrice = getNextPrice;
    window.getPrevPrice = getPrevPrice;
}
