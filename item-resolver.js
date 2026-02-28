/**
 * item-resolver.js — Extract item metadata needed for enhancement calculation.
 * Returns a "shopping list" of all items involved in enhancing an item to a target level.
 */

class ItemResolver {
    constructor(gameData) {
        this.items = gameData.items || {};
        this.recipes = gameData.recipes || {};
    }

    /**
     * Resolve item metadata for enhancement calculation.
     * @param {string} itemHrid - Item HRID to enhance
     * @param {number} targetLevel - Target enhancement level
     * @returns {Object|null} Shopping list, or null if item can't be enhanced
     */
    resolve(itemHrid, targetLevel) {
        const item = this.items[itemHrid];
        if (!item || !item.enhancementCosts) return null;

        const itemLevel = item.level || 1;

        // Parse enhancement costs into materials + coin cost
        const materials = [];
        let coinCost = 0;

        for (const cost of item.enhancementCosts) {
            if (cost.item === '/items/coin') {
                coinCost = cost.count;
            } else {
                materials.push({ hrid: cost.item, count: cost.count });
            }
        }

        // Collect ALL protection options (cheapest picked after pricing)
        const protectionOptions = [
            { hrid: '/items/mirror_of_protection', isBaseItem: false },
            { hrid: itemHrid, isBaseItem: true },
        ];

        const protectHrids = item.protectionItems || [];
        for (const phrid of protectHrids) {
            if (!phrid.includes('_refined')) {
                protectionOptions.push({ hrid: phrid, isBaseItem: false });
            }
        }

        // Crafting recipe for base item (if craftable)
        let craftRecipe = null;
        const recipe = this.recipes[itemHrid];
        if (recipe) {
            const category = item.category || '';
            if (category === '/item_categories/equipment' || itemHrid === '/items/philosophers_mirror') {
                craftRecipe = {
                    inputs: (recipe.inputs || []).map(inp => ({ hrid: inp.item, count: inp.count })),
                    upgrade: recipe.upgrade || null,
                };
            }
        }

        return {
            itemHrid,
            itemLevel,
            targetLevel,
            materials,
            coinCost,
            protectionOptions,
            craftRecipe,
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ItemResolver };
} else if (typeof window !== 'undefined') {
    window.ItemResolver = ItemResolver;
}
