/**
 * main-v2.js - CowProfit with client-side calculations
 * Uses prices.js + game-data.js + enhance-calc.js
 */

// Data from loaded scripts
const prices = window.PRICES || {};
const gameData = window.GAME_DATA_STATIC || {};

// State
let calculator = null;
let currentMode = 'pessimistic';
let currentLevel = 'all';
let sortCol = 9;
let sortAsc = false;
let showFee = true;
let showSuperPessimistic = false;
let expandedRows = new Set();
let costFilters = { '100m': true, '500m': true, '1b': true, '2b': true, 'over2b': true };
let allResults = { pessimistic: [], midpoint: [], optimistic: [] };
let gearOpen = false;
let historyOpen = false;
let lootHistoryOpen = false;

// Inventory data (set via event from userscript)
let inventoryData = null;

// Loot history (set via event from userscript)
let lootHistoryData = [];

// Inventory helpers (for userscript integration)
function getInventoryCount(hrid) {
    const inv = inventoryData?.inventory || {};
    return inv[hrid] || 0;
}

function hasInventory() {
    return inventoryData && Object.keys(inventoryData.inventory || {}).length > 0;
}

function getCoins() {
    return inventoryData?.gameCoins || 0;
}

function calculateMatPercent(r) {
    if (!hasInventory()) return null;
    
    let totalValue = 0;
    let ownedValue = 0;
    
    // Get materials for this item
    const materials = getMaterialDetails(r.item_hrid, 1, currentMode);
    
    // Enhancement materials (per attempt * actions)
    for (const m of materials) {
        if (m.name === 'Coins') continue;
        const needed = m.count * r.actions;
        const owned = Math.min(getInventoryCount(m.hrid), needed);
        const price = m.price || 0;
        totalValue += needed * price;
        ownedValue += owned * price;
    }
    
    // Protection items
    if (r.protectHrid && r.protectCount > 0) {
        const needed = Math.ceil(r.protectCount);
        const owned = Math.min(getInventoryCount(r.protectHrid), needed);
        const price = r.protectPrice || 0;
        totalValue += needed * price;
        ownedValue += owned * price;
    }
    
    if (totalValue === 0) return 100;
    return (ownedValue / totalValue) * 100;
}

// Listen for inventory data from userscript
window.addEventListener('cowprofit-inventory-loaded', function(e) {
    console.log('[CowProfit v2] Inventory event received:', e.detail);
    inventoryData = e.detail;
    console.log('[CowProfit v2] hasInventory():', hasInventory());
    renderTable();
});

// Listen for loot history from userscript
window.addEventListener('cowprofit-loot-loaded', function(e) {
    console.log('[CowProfit v2] Loot history received:', e.detail?.length, 'entries');
    // Always use fresh data from userscript - it's the source of truth
    lootHistoryData = e.detail || [];
    // Sort by startTime descending (most recent first)
    lootHistoryData.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    console.log('[CowProfit v2] Loot sessions loaded:', lootHistoryData.map(s => 
        `${s.actionHrid?.split('/').pop()} @ ${s.startTime} (${s.actionCount} actions)`
    ).slice(0, 5));
    // Update loot history panel if open
    if (lootHistoryOpen) {
        renderLootHistoryPanel();
    }
});

const TARGET_LEVELS = [8, 10, 12, 14];
const MIN_PROFIT = 1_000_000;
const MAX_ROI = 1000;

const modeInfo = {
    'pessimistic': 'Buy at Ask, Sell at Bid (safest estimate)',
    'midpoint': 'Buy/Sell at midpoint of Ask and Bid',
    'optimistic': 'Buy at Bid, Sell at Ask (best case)'
};

// Initialize calculator and compute all results
function init() {
    console.log('[CowProfit v2] Initializing...');
    
    if (!gameData.items) {
        console.error('Game data not loaded!');
        document.getElementById('status').textContent = 'Error: game-data.js not loaded';
        return;
    }
    
    if (!prices.market) {
        console.error('Prices not loaded!');
        document.getElementById('status').textContent = 'Error: prices.js not loaded';
        return;
    }
    
    calculator = new EnhanceCalculator(gameData);
    console.log(`[CowProfit v2] Calculator ready. ${Object.keys(gameData.items).length} items loaded.`);
    
    // Display version
    document.getElementById('version-tag').textContent = gameData.version + ' (v2)';
    
    // Calculate all profits
    calculateAllProfits();
    
    // Update timestamps
    updateTimes();
    setInterval(updateTimes, 60000);
    
    // Render
    renderTable();
    
    document.getElementById('status').textContent = '';
}

function calculateAllProfits() {
    console.log('[CowProfit v2] Calculating profits...');
    const startTime = performance.now();
    
    const modes = [PriceMode.PESSIMISTIC, PriceMode.MIDPOINT, PriceMode.OPTIMISTIC];
    const modeNames = ['pessimistic', 'midpoint', 'optimistic'];
    
    for (let i = 0; i < modes.length; i++) {
        const mode = modes[i];
        const modeName = modeNames[i];
        const results = [];
        
        for (const [hrid, item] of Object.entries(gameData.items)) {
            if (!item.enhancementCosts) continue;
            
            // Skip junk
            const name = item.name?.toLowerCase() || '';
            if (['cheese_', 'verdant_', 'wooden_', 'rough_'].some(s => name.includes(s))) continue;
            
            for (const target of TARGET_LEVELS) {
                const result = calculator.calculateProfit(hrid, target, prices, mode);
                if (result && result.sellPrice > 0 && result.roi < MAX_ROI) {
                    result.item_name = item.name;
                    result.item_hrid = hrid;
                    result.target_level = target;
                    results.push(result);
                }
            }
        }
        
        results.sort((a, b) => b.profit - a.profit);
        allResults[modeName] = results;
    }
    
    const elapsed = performance.now() - startTime;
    console.log(`[CowProfit v2] Calculated ${allResults.pessimistic.length} items in ${elapsed.toFixed(0)}ms`);
}

// Formatting helpers
function formatCoins(value) {
    if (value === 0 || value === null || value === undefined) return '-';
    if (Math.abs(value) >= 1e9) return (value/1e9).toFixed(2) + 'B';
    if (Math.abs(value) >= 1e6) return (value/1e6).toFixed(2) + 'M';
    if (Math.abs(value) >= 1e3) return (value/1e3).toFixed(2) + 'K';
    return value.toFixed(0);
}

function formatXP(value) {
    if (Math.abs(value) >= 1e6) return (value/1e6).toFixed(1) + 'M';
    if (Math.abs(value) >= 1e3) return (value/1e3).toFixed(1) + 'K';
    return value.toFixed(0);
}

function formatTimeAgo(ts) {
    if (!ts) return '-';
    const seconds = Math.floor(Date.now() / 1000) - ts;
    if (seconds < 60) return Math.floor(seconds) + 's ago';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h ago';
    return (seconds / 86400).toFixed(1) + 'd ago';
}

function updateTimes() {
    document.getElementById('time-check').textContent = formatTimeAgo(prices.generated);
    document.getElementById('time-market').textContent = formatTimeAgo(prices.ts);
}

function formatAge(seconds) {
    if (!seconds || seconds <= 0) return '-';
    if (seconds < 60) return Math.floor(seconds) + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h';
    return (seconds / 86400).toFixed(1) + 'd';
}

// History dropdown
function toggleHistory(e) {
    if (e) e.stopPropagation();
    historyOpen = !historyOpen;
    gearOpen = false;
    document.getElementById('gear-panel').classList.remove('visible');
    document.getElementById('gear-arrow').innerHTML = '&#9660;';
    const panel = document.getElementById('history-panel');
    panel.classList.toggle('visible', historyOpen);
    document.getElementById('history-arrow').innerHTML = historyOpen ? '&#9650;' : '&#9660;';
    if (historyOpen) renderHistoryPanel();
}

function renderHistoryPanel() {
    // Get unique market update timestamps from history
    const historyData = prices.history || {};
    const timestamps = new Set();
    
    for (const entries of Object.values(historyData)) {
        if (Array.isArray(entries)) {
            for (const e of entries) {
                if (e.t) timestamps.add(e.t);
            }
        }
    }
    
    // Sort descending, take last 10
    const sorted = [...timestamps].sort((a, b) => b - a).slice(0, 10);
    
    const entries = sorted.map(ts => `
        <div class="history-entry">
            <span class="time">${new Date(ts * 1000).toLocaleString()}</span>
            <span class="ago">${formatTimeAgo(ts)}</span>
        </div>
    `).join('');
    
    document.getElementById('history-panel').innerHTML = `
        <h5>Market Update History</h5>
        ${entries || '<div class="history-entry">No history yet</div>'}
    `;
}

// Gear dropdown
function toggleGear(e) {
    if (e) e.stopPropagation();
    gearOpen = !gearOpen;
    historyOpen = false;
    document.getElementById('history-panel').classList.remove('visible');
    document.getElementById('history-arrow').innerHTML = '&#9660;';
    document.getElementById('gear-panel').classList.toggle('visible', gearOpen);
    document.getElementById('gear-arrow').innerHTML = gearOpen ? '&#9650;' : '&#9660;';
    if (gearOpen) renderGearPanel();
}

function renderGearPanel() {
    if (!calculator) {
        document.getElementById('gear-panel').innerHTML = '<div style="padding:10px;color:#888;">Calculator not loaded</div>';
        return;
    }
    
    const c = calculator.config;
    const guzzling = calculator.getGuzzlingBonus();
    const enhancerBonus = calculator.getEnhancerBonus();
    const effectiveLevel = calculator.getEffectiveLevel();
    const artisanMult = calculator.getArtisanTeaMultiplier();
    
    document.getElementById('gear-panel').innerHTML = `
        <div class="gear-section">
            <h5>🎯 Enhancing</h5>
            <div class="gear-row"><span class="label">Base Level</span><span class="value">${c.enhancingLevel}</span></div>
            <div class="gear-row"><span class="label">Effective Level</span><span class="value highlight">${effectiveLevel.toFixed(1)}</span></div>
            <div class="gear-row"><span class="label">Observatory</span><span class="value">+${c.observatoryLevel}</span></div>
        </div>
        <div class="gear-section">
            <h5>🔧 Tool & Success</h5>
            <div class="gear-row"><span class="label">${c.enhancer.replace(/_/g, ' ')} +${c.enhancerLevel}</span><span class="value">+${enhancerBonus.toFixed(2)}%</span></div>
            <div class="gear-row"><span class="label">Achievement Bonus</span><span class="value">+${(c.achievementSuccessBonus * 100).toFixed(2)}%</span></div>
        </div>
        <div class="gear-section">
            <h5>⚡ Speed Gear</h5>
            <div class="gear-row"><span class="label">Gloves +${c.enchantedGlovesLevel}</span><span class="value">equipped</span></div>
            <div class="gear-row"><span class="label">Top +${c.enhancerTopLevel}</span><span class="value">equipped</span></div>
            <div class="gear-row"><span class="label">Bot +${c.enhancerBotLevel}</span><span class="value">equipped</span></div>
            <div class="gear-row"><span class="label">Neck +${c.philoNeckLevel}</span><span class="value">equipped</span></div>
        </div>
        <div class="gear-section">
            <h5>🍵 Active Teas</h5>
            <div class="gear-row"><span class="label">Enhancing Tea</span><span class="value">${c.teaUltraEnhancing ? 'Ultra ✓' : c.teaSuperEnhancing ? 'Super ✓' : c.teaEnhancing ? '✓' : '✗'}</span></div>
            <div class="gear-row"><span class="label">Blessed Tea</span><span class="value">${c.teaBlessed ? '✓' : '✗'}</span></div>
            <div class="gear-row"><span class="label">Wisdom Tea</span><span class="value">${c.teaWisdom ? '✓' : '✗'}</span></div>
            <div class="gear-row"><span class="label">Artisan Tea</span><span class="value">${c.artisanTea ? ((1 - artisanMult) * 100).toFixed(1) + '% mat reduction' : '✗'}</span></div>
            <div class="gear-row"><span class="label">Guzzling Bonus</span><span class="value highlight">${guzzling.toFixed(4)}x</span></div>
        </div>
        <div class="gear-section">
            <h5>💎 Charm</h5>
            <div class="gear-row"><span class="label">${c.charmTier.charAt(0).toUpperCase() + c.charmTier.slice(1)} +${c.charmLevel}</span><span class="value">XP bonus</span></div>
        </div>
    `;
}

// Loot History dropdown
function toggleLootHistory(e) {
    if (e) e.stopPropagation();
    lootHistoryOpen = !lootHistoryOpen;
    // Close other dropdowns
    gearOpen = false;
    historyOpen = false;
    document.getElementById('gear-panel').classList.remove('visible');
    document.getElementById('history-panel').classList.remove('visible');
    document.getElementById('gear-arrow').innerHTML = '&#9660;';
    document.getElementById('history-arrow').innerHTML = '&#9660;';
    
    const panel = document.getElementById('loot-history-panel');
    panel.classList.toggle('visible', lootHistoryOpen);
    document.getElementById('loot-history-arrow').innerHTML = lootHistoryOpen ? '&#9650;' : '&#9660;';
    if (lootHistoryOpen) renderLootHistoryPanel();
}

function renderLootHistoryPanel() {
    const panel = document.getElementById('loot-history-panel');
    
    if (!lootHistoryData.length) {
        panel.innerHTML = `
            <h5>📜 Enhance History</h5>
            <div class="loot-empty">
                No loot data yet. Play the game with the userscript active to capture enhance sessions.
            </div>
        `;
        return;
    }
    
    // Filter to only enhance sessions with meaningful data
    const enhanceSessions = lootHistoryData
        .filter(s => s.actionHrid?.includes('enhance'))
        .slice(0, 30);
    
    if (!enhanceSessions.length) {
        panel.innerHTML = `
            <h5>📜 Enhance History</h5>
            <div class="loot-empty">
                No enhance sessions found. Start enhancing with the userscript active!
            </div>
        `;
        return;
    }
    
    let entriesHtml = '';
    let totalProfit = 0;
    let totalHours = 0;
    let validCount = 0;
    
    for (const session of enhanceSessions) {
        const enhanceProfit = calculateEnhanceSessionProfit(session);
        if (!enhanceProfit) continue;
        
        const duration = calculateDuration(session.startTime, session.endTime);
        const durationMs = new Date(session.endTime) - new Date(session.startTime);
        const hours = durationMs / 3600000;
        
        // Skip very short sessions (< 1 min) with no targets
        if (hours < 0.02 && enhanceProfit.revenue === 0) continue;
        
        validCount++;
        
        // Only add to totals if we have all prices
        const hasPriceErrors = enhanceProfit.matPriceMissing || enhanceProfit.protPriceMissing || enhanceProfit.revenuePriceMissing;
        if (!hasPriceErrors) {
            totalProfit += enhanceProfit.profit;
            totalHours += hours;
        }
        
        const profitClass = hasPriceErrors ? 'warning' : (enhanceProfit.profit > 0 ? 'positive' : (enhanceProfit.profit < 0 ? 'negative' : 'neutral'));
        
        // Format costs - show error if price missing
        let matCostStr = '-';
        if (enhanceProfit.matPriceMissing) {
            matCostStr = '⚠️ no price';
        } else if (enhanceProfit.totalMatCost > 0) {
            matCostStr = formatCoins(enhanceProfit.totalMatCost);
        }
        
        let protCostStr = '-';
        if (enhanceProfit.protsUsed > 0) {
            if (enhanceProfit.protPriceMissing) {
                protCostStr = `⚠️ no price (${enhanceProfit.protsUsed}×)`;
            } else {
                protCostStr = `${formatCoins(enhanceProfit.totalProtCost)} (${enhanceProfit.protsUsed}×)`;
            }
        }
        
        let revenueStr = '-';
        if (enhanceProfit.revenuePriceMissing) {
            revenueStr = '⚠️ no price';
        } else if (enhanceProfit.revenue > 0) {
            revenueStr = formatCoins(enhanceProfit.revenue);
        }
        
        // Only show profit/rate if we have all prices (hasPriceErrors already defined above)
        const profitStr = hasPriceErrors ? '⚠️' : (enhanceProfit.profit !== 0 ? formatCoins(enhanceProfit.profit) : '-');
        const rateStr = hasPriceErrors ? '-' : (enhanceProfit.profitPerHour !== 0 ? `${formatCoins(enhanceProfit.profitPerHour)}/hr` : '-');
        
        // Build title with current level from primaryItem
        const levelStr = enhanceProfit.currentLevel > 0 ? ` +${enhanceProfit.currentLevel}` : '';
        const itemTitle = `${enhanceProfit.itemName || 'Unknown'}${levelStr}`;
        
        // Result is just the current level (from primaryItem)
        const resultStr = enhanceProfit.currentLevel > 0 ? `+${enhanceProfit.currentLevel}` : '-';
        
        entriesHtml += `
            <div class="loot-entry enhance-entry">
                <div class="loot-header">
                    <span class="loot-action">⚔️ ${itemTitle}</span>
                    <span class="loot-time">${formatLootTime(session.startTime)}</span>
                </div>
                <div class="loot-details">
                    <span class="loot-duration">${duration}</span>
                    <span class="loot-actions">${enhanceProfit.actionCount} actions</span>
                    <span class="loot-prots">${enhanceProfit.protsUsed} prots</span>
                </div>
                <div class="loot-costs">
                    <span>Mats: ${matCostStr}</span>
                    <span>Prot: ${protCostStr}</span>
                </div>
                <div class="loot-revenue">
                    <span>Result: ${resultStr}</span>
                    <span>Revenue: ${revenueStr}</span>
                </div>
                <div class="loot-values">
                    <span class="loot-value ${profitClass}">Profit: ${profitStr}</span>
                    <span class="loot-rate">${rateStr}</span>
                </div>
            </div>
        `;
    }
    
    // Summary
    const avgPerHour = totalHours > 0 ? totalProfit / totalHours : 0;
    const profitClass = totalProfit >= 0 ? 'positive' : 'negative';
    
    panel.innerHTML = `
        <h5>📜 Enhance History</h5>
        <div class="loot-summary">
            <span>${validCount} sessions</span>
            <span class="loot-summary-value ${profitClass}">Total: ${formatCoins(totalProfit)}</span>
            <span class="loot-summary-value">Avg: ${formatCoins(avgPerHour)}/hr</span>
        </div>
        <div class="loot-entries">
            ${entriesHtml}
        </div>
    `;
}

function calculateLootSessionValue(session) {
    const drops = session.drops || {};
    let bidValue = 0;
    let askValue = 0;
    let dropCount = 0;
    
    for (const [hrid, count] of Object.entries(drops)) {
        if (count <= 0) continue;
        dropCount += count;
        
        // Parse enhanced items: /items/item_hrid::N means +N enhancement
        let itemHrid = hrid;
        let level = 0;
        if (hrid.includes('::')) {
            const parts = hrid.split('::');
            itemHrid = parts[0];
            level = parseInt(parts[1]) || 0;
        }
        
        // Look up prices
        const itemPrices = prices.market?.[itemHrid]?.[String(level)] || {};
        const bid = itemPrices.b || 0;
        const ask = itemPrices.a || 0;
        
        bidValue += bid * count;
        askValue += ask * count;
    }
    
    // Calculate $/hour
    const durationMs = new Date(session.endTime) - new Date(session.startTime);
    const hours = durationMs / 3600000;
    const bidPerHour = hours > 0 ? bidValue / hours : 0;
    const askPerHour = hours > 0 ? askValue / hours : 0;
    
    return { bidValue, askValue, dropCount, bidPerHour, askPerHour };
}

/**
 * Calculate enhancement session profit using protection calculator
 * 
 * For enhance sessions:
 * - Revenue: items at +8/+10/+12/+14 × sell price
 * - Costs: materials (actionCount × mat cost) + protection (prots × prot price)
 */
function calculateEnhanceSessionProfit(session) {
    if (!session.actionHrid?.includes('enhance')) {
        return null; // Not an enhance session
    }
    
    const drops = session.drops || {};
    const actionCount = session.actionCount || 0;
    
    // Parse primary item to get the item being enhanced and its current level
    let itemHrid = null;
    let currentLevel = 0;
    
    // primaryItem format: "/items/enhancers_top::10" (item::level)
    if (session.primaryItem) {
        const parts = session.primaryItem.split('::');
        itemHrid = parts[0];
        currentLevel = parseInt(parts[1]) || 0;
    }
    
    // Fallback to primaryItemHash
    if (!itemHrid && session.primaryItemHash) {
        // Format: "charId::/item_locations/inventory::/items/{item_hrid}::{level}"
        const match = session.primaryItemHash.match(/\/items\/([^:]+)/);
        if (match) itemHrid = '/items/' + match[1];
    }
    
    if (!itemHrid) {
        // Try to detect from drops - find the enhanced item (not essences/crates)
        for (const dropKey of Object.keys(drops)) {
            if (dropKey.includes('::') && 
                !dropKey.includes('essence') && 
                !dropKey.includes('crate') &&
                !dropKey.includes('fragment')) {
                itemHrid = dropKey.split('::')[0];
                break;
            }
        }
    }
    
    if (!itemHrid) return null;
    
    // Get item data for material costs - try both gameData.items and direct lookup
    let itemData = gameData.items?.[itemHrid];
    
    // Also try without leading slash if needed
    if (!itemData && itemHrid.startsWith('/items/')) {
        const shortHrid = itemHrid.substring(7); // Remove '/items/'
        for (const [key, val] of Object.entries(gameData.items || {})) {
            if (key.endsWith(shortHrid) || val.hrid === itemHrid) {
                itemData = val;
                break;
            }
        }
    }
    
    // Parse drops into level distribution
    const levelDrops = {};
    let totalItems = 0;
    for (const [dropKey, count] of Object.entries(drops)) {
        if (!dropKey.startsWith(itemHrid)) continue;
        const level = parseInt(dropKey.split('::')[1]) || 0;
        levelDrops[level] = (levelDrops[level] || 0) + count;
        totalItems += count;
    }
    
    if (totalItems === 0) return null;
    
    // Calculate protection used via cascade method
    const protLevel = 8;
    const protResult = calculateProtectionFromDrops(levelDrops, protLevel);
    const protsUsed = protResult.protCount;
    
    // Calculate material cost from game data (ask prices only - we're buying)
    let matCostPerAction = 0;
    let matPriceMissing = false;
    const enhanceCosts = itemData?.enhancementCosts || [];
    
    for (const cost of enhanceCosts) {
        const costHrid = cost.item || cost.itemHrid || cost.hrid;
        const costCount = cost.count || 1;
        
        if (costHrid === '/items/coin') {
            matCostPerAction += costCount;
        } else {
            // Get material price - ask only (we're buying)
            const matPrice = prices.market?.[costHrid]?.['0']?.a || 0;
            if (matPrice === 0) matPriceMissing = true;
            matCostPerAction += costCount * matPrice;
        }
    }
    const totalMatCost = actionCount * matCostPerAction;
    
    // Calculate protection cost - use cheapest option (ask prices only - we're buying)
    const mirrorPrice = prices.market?.['/items/mirror_of_protection']?.['0']?.a || 0;
    const baseItemPrice = prices.market?.[itemHrid]?.['0']?.a || 0;
    
    // Also check item-specific protection items
    let protPrice = Infinity;
    let protPriceMissing = false;
    if (mirrorPrice > 0) protPrice = Math.min(protPrice, mirrorPrice);
    if (baseItemPrice > 0) protPrice = Math.min(protPrice, baseItemPrice);
    
    // Check protection item hrids from item data
    const protItemHrids = itemData?.protectionItemHrids || [];
    for (const protHrid of protItemHrids) {
        const price = prices.market?.[protHrid]?.['0']?.a || 0;
        if (price > 0) protPrice = Math.min(protPrice, price);
    }
    
    if (protPrice === Infinity) {
        protPrice = 0;
        if (protsUsed > 0) protPriceMissing = true;
    }
    const totalProtCost = protsUsed * protPrice;
    
    // Calculate revenue - only count as sellable if:
    // 1. Highest level is a target (+8/+10/+12/+14)
    // 2. There is exactly 1 item at that level (multiple = still working on it)
    let revenue = 0;
    let revenueBreakdown = {};
    let revenuePriceMissing = false;
    
    // Find highest target level with any drops
    let highestTargetLevel = 0;
    for (const targetLevel of [8, 10, 12, 14]) {
        if ((levelDrops[targetLevel] || 0) > 0) {
            highestTargetLevel = targetLevel;
        }
    }
    
    // Only count as revenue if exactly 1 item at highest level (finished product)
    // Multiple items at same level = still working, not sellable yet
    if (highestTargetLevel > 0) {
        const count = levelDrops[highestTargetLevel] || 0;
        if (count === 1) {
            // Single item at target level = finished, count as revenue
            const sellPrice = prices.market?.[itemHrid]?.[String(highestTargetLevel)]?.b || 0;
            if (sellPrice === 0) revenuePriceMissing = true;
            const value = count * sellPrice;
            revenue = value;
            revenueBreakdown[highestTargetLevel] = { count, sellPrice, value };
        }
        // If count > 1, don't count as revenue (work in progress)
    }
    
    const totalCost = totalMatCost + totalProtCost;
    const profit = revenue - totalCost;
    
    // Calculate per hour
    const durationMs = new Date(session.endTime) - new Date(session.startTime);
    const hours = durationMs / 3600000;
    const profitPerHour = hours > 0.01 ? profit / hours : 0;
    
    // Get item name
    const itemName = itemData?.name || itemHrid.split('/').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    
    return {
        itemHrid,
        itemName,
        actionCount,
        totalItems,
        levelDrops,
        currentLevel,
        highestTargetLevel,
        protsUsed,
        matCostPerAction,
        totalMatCost,
        protPrice,
        totalProtCost,
        totalCost,
        revenue,
        revenueBreakdown,
        profit,
        profitPerHour,
        hours,
        // Price error flags
        matPriceMissing,
        protPriceMissing,
        revenuePriceMissing
    };
}

/**
 * Calculate protection used from drops using cascade method
 * 
 * At L >= prot: fail -> L-1 (uses protection)
 * At L < prot: fail -> 0 (no protection)
 */
function calculateProtectionFromDrops(levelDrops, protLevel) {
    const levels = Object.keys(levelDrops).map(Number).sort((a, b) => b - a);
    if (levels.length === 0) return { protCount: 0 };
    
    const maxLevel = Math.max(...levels);
    const successes = {};
    const failures = {};
    
    // Work from target down to prot level
    for (let L = maxLevel - 1; L >= protLevel - 1; L--) {
        const failuresFromAbove = failures[L + 2] || 0;
        successes[L] = (levelDrops[L + 1] || 0) - failuresFromAbove;
        failures[L] = (levelDrops[L] || 0) - successes[L];
    }
    
    // Handle levels below prot (prot-1 receives failures from prot)
    if (protLevel - 1 >= 0) {
        successes[protLevel - 1] = (levelDrops[protLevel] || 0) - (failures[protLevel + 1] || 0);
        failures[protLevel - 1] = (levelDrops[protLevel - 1] || 0) - successes[protLevel - 1];
    }
    if (protLevel - 2 >= 0) {
        successes[protLevel - 2] = (levelDrops[protLevel - 1] || 0) - (failures[protLevel] || 0);
        failures[protLevel - 2] = (levelDrops[protLevel - 2] || 0) - successes[protLevel - 2];
    }
    
    // Sum failures at levels >= prot = protection used
    let protCount = 0;
    for (let L = protLevel; L < maxLevel; L++) {
        protCount += Math.max(0, failures[L] || 0);
    }
    
    return { protCount: Math.round(protCount), successes, failures };
}

function calculateDuration(startTime, endTime) {
    const ms = new Date(endTime) - new Date(startTime);
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

function formatActionName(actionHrid) {
    if (!actionHrid) return 'Unknown';
    // /actions/enhancing/enhance -> Enhancing
    // /actions/mining/iron_rock -> Mining Iron Rock
    const parts = actionHrid.split('/').filter(Boolean);
    if (parts.length >= 2) {
        const category = parts[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (parts.length >= 3) {
            const action = parts[2].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return `${category}: ${action}`;
        }
        return category;
    }
    return actionHrid;
}

function formatLootTime(isoTime) {
    if (!isoTime) return '-';
    const date = new Date(isoTime);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = diffMs / 3600000;
    
    if (diffHours < 24) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffHours < 168) { // 7 days
        return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.gear-dropdown') && !e.target.closest('.history-dropdown') && !e.target.closest('.loot-history-dropdown')) {
        gearOpen = false;
        historyOpen = false;
        lootHistoryOpen = false;
        document.getElementById('gear-panel')?.classList.remove('visible');
        document.getElementById('history-panel')?.classList.remove('visible');
        document.getElementById('loot-history-panel')?.classList.remove('visible');
        const gearArrow = document.getElementById('gear-arrow');
        const histArrow = document.getElementById('history-arrow');
        const lootArrow = document.getElementById('loot-history-arrow');
        if (gearArrow) gearArrow.innerHTML = '&#9660;';
        if (histArrow) histArrow.innerHTML = '&#9660;';
        if (lootArrow) lootArrow.innerHTML = '&#9660;';
    }
});

function getCostBucket(totalCost) {
    if (totalCost < 100e6) return '100m';
    if (totalCost < 500e6) return '500m';
    if (totalCost < 1e9) return '1b';
    if (totalCost < 2e9) return '2b';
    return 'over2b';
}

// Controls
function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-' + mode).classList.add('active');
    document.getElementById('mode-info').textContent = modeInfo[mode];
    expandedRows.clear();
    renderTable();
}

function filterLevel(level) {
    currentLevel = level;
    document.querySelectorAll('.level-filter').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    renderTable();
}

function toggleFee() {
    showFee = !showFee;
    document.getElementById('btn-fee').classList.toggle('active', showFee);
    renderTable();
}

function toggleSuperPessimistic() {
    showSuperPessimistic = !showSuperPessimistic;
    document.getElementById('btn-super').classList.toggle('active', showSuperPessimistic);
    renderTable();
}

function toggleCostFilter(cost) {
    costFilters[cost] = !costFilters[cost];
    document.querySelector(`.cost-filter[data-cost="${cost}"]`).classList.toggle('active', costFilters[cost]);
    renderTable();
}

function sortTable(col, type) {
    if (sortCol === col) {
        sortAsc = !sortAsc;
    } else {
        sortCol = col;
        sortAsc = (col === 0);
    }
    renderTable();
}

function toggleRow(rowId) {
    if (expandedRows.has(rowId)) {
        expandedRows.delete(rowId);
    } else {
        // Close all other rows first (single expand)
        expandedRows.clear();
        expandedRows.add(rowId);
    }
    renderTable();
}

// Get buy price for an item based on mode
function getBuyPrice(hrid, level, mode) {
    const itemPrices = prices.market[hrid]?.[String(level)] || {};
    if (mode === 'pessimistic') {
        return itemPrices.a || itemPrices.b || 0;
    } else if (mode === 'optimistic') {
        return itemPrices.b || itemPrices.a || 0;
    } else {
        const ask = itemPrices.a || 0;
        const bid = itemPrices.b || 0;
        return (ask && bid) ? (ask + bid) / 2 : (ask || bid);
    }
}

// Get enhancement material details for an item (NO artisan tea - these are enhancement mats, not crafting)
function getMaterialDetails(itemHrid, actions, mode) {
    const item = gameData.items[itemHrid];
    if (!item || !item.enhancementCosts) return [];
    
    const materials = [];
    for (const cost of item.enhancementCosts) {
        if (cost.item === '/items/coin') {
            materials.push({
                hrid: cost.item,
                name: 'Coins',
                count: cost.count,
                price: 1,
                total: cost.count * actions
            });
        } else {
            const matItem = gameData.items[cost.item];
            const matName = matItem?.name || cost.item.split('/').pop().replace(/_/g, ' ');
            const price = getBuyPrice(cost.item, 0, mode);
            materials.push({
                hrid: cost.item,
                name: matName,
                count: cost.count,
                price: price,
                total: cost.count * price * actions
            });
        }
    }
    return materials;
}

// Get price history for an item at a level
function getPriceAge(itemHrid, level) {
    const key = `${itemHrid}:${level}`;
    const history = prices.history?.[key];
    if (!history || history.length === 0) return null;
    
    // history[0] is most recent entry
    const currentEntry = history[0];
    const now = Math.floor(Date.now() / 1000);
    const age = now - currentEntry.t;
    
    // Get direction and previous price if there's a previous entry
    let direction = null;
    let lastPrice = null;
    if (history.length > 1) {
        lastPrice = history[1].p;
        if (currentEntry.p > lastPrice) direction = 'up';
        else if (currentEntry.p < lastPrice) direction = 'down';
    }
    
    return { age, direction, price: currentEntry.p, lastPrice, since: currentEntry.t };
}

// Get crafting materials for an item (WITH artisan tea - these are crafting inputs)
function getCraftingMaterials(itemHrid, mode) {
    const recipe = gameData.recipes[itemHrid];
    if (!recipe || !recipe.inputs) return null;
    
    const item = gameData.items[itemHrid];
    const itemName = item?.name || itemHrid.split('/').pop().replace(/_/g, ' ');
    const artisanMult = calculator?.getArtisanTeaMultiplier() || 1;
    
    const materials = [];
    let total = 0;
    
    // Recipe inputs (with artisan tea)
    for (const input of recipe.inputs) {
        const matItem = gameData.items[input.item];
        const matName = matItem?.name || input.item.split('/').pop().replace(/_/g, ' ');
        const price = getBuyPrice(input.item, 0, mode);
        // Apply artisan tea to crafting inputs
        const adjustedCount = input.count * artisanMult;
        const lineTotal = adjustedCount * price;
        total += lineTotal;
        materials.push({
            hrid: input.item,
            name: matName,
            count: adjustedCount,
            price: price,
            total: lineTotal
        });
    }
    
    // Base item (the "upgrade" source) - NO artisan tea, count 1
    let baseItemHrid = null;
    let baseItemName = null;
    if (recipe.upgrade) {
        baseItemHrid = recipe.upgrade;
        const baseItem = gameData.items[baseItemHrid];
        baseItemName = baseItem?.name || baseItemHrid.split('/').pop().replace(/_/g, ' ');
        const basePrice = getBuyPrice(baseItemHrid, 0, mode);
        total += basePrice;
        materials.push({
            hrid: baseItemHrid,
            name: baseItemName,
            count: 1,
            price: basePrice,
            total: basePrice
        });
    }
    
    return { itemName, materials, total, baseItemHrid, baseItemName };
}

// Format number with commas
function formatWithCommas(num) {
    if (num >= 1000) {
        return num.toLocaleString('en-US', { maximumFractionDigits: 1 });
    }
    return num.toFixed(1);
}

// Shopping list for detail row - 3 column layout with progress bars
function renderShoppingList(r, materials) {
    let rows = '';
    let totalCost = 0;
    let totalOwned = 0;
    let totalNeed = 0;
    const invLoaded = hasInventory();
    
    // Enhancement materials (exclude coins)
    for (const m of materials) {
        if (m.name === 'Coins') continue;
        const total = m.count * r.actions;
        const owned = invLoaded ? getInventoryCount(m.hrid) : 0;
        const need = Math.max(0, total - owned);
        const pct = Math.min(total > 0 ? (owned / total) * 100 : 0, 100);
        const lineCost = need * m.price;
        totalCost += lineCost;
        totalOwned += owned;
        totalNeed += total;
        
        rows += `<div class="shop-row">
            <span class="shop-name">${m.name}</span>
            <span class="shop-qty">
                <span class="shop-progress" style="width:${pct.toFixed(0)}%"></span>
                <span class="shop-qty-text"><span class="shop-need-num">${formatWithCommas(need)}</span> <span class="shop-total-num">/ ${formatWithCommas(total)}</span></span>
            </span>
            <span class="shop-price">${formatCoins(m.price)}</span>
        </div>`;
    }
    
    // Protection item
    if (r.protectHrid && r.protectCount > 0) {
        const protItem = gameData.items[r.protectHrid];
        const protName = protItem?.name || r.protectHrid.split('/').pop().replace(/_/g, ' ');
        const total = r.protectCount;
        const owned = invLoaded ? getInventoryCount(r.protectHrid) : 0;
        const need = Math.max(0, total - owned);
        const pct = Math.min(total > 0 ? (owned / total) * 100 : 0, 100);
        const lineCost = need * r.protectPrice;
        totalCost += lineCost;
        totalOwned += owned;
        totalNeed += total;
        
        rows += `<div class="shop-row prot-row">
            <span class="shop-name">${protName}</span>
            <span class="shop-qty">
                <span class="shop-progress" style="width:${pct.toFixed(0)}%"></span>
                <span class="shop-qty-text"><span class="shop-need-num">${formatWithCommas(need)}</span> <span class="shop-total-num">/ ${formatWithCommas(total)}</span></span>
            </span>
            <span class="shop-price">${formatCoins(r.protectPrice)}</span>
        </div>`;
    }
    
    if (!rows) return '';
    
    // Overall progress bar inline with title (0-100%), capped at 100
    const overallPct = Math.min(totalNeed > 0 ? (totalOwned / totalNeed) * 100 : 0, 100);
    const pctDisplay = `${overallPct.toFixed(0)}%`;
    const barWidth = overallPct.toFixed(1);
    
    // Total cost row at bottom (no progress bar)
    rows += `<div class="shop-row total-row">
        <span class="shop-name">Total Cost</span>
        <span class="shop-qty"></span>
        <span class="shop-price">${formatCoins(totalCost)}</span>
    </div>`;
    
    return `<div class="detail-section shopping-list">
        <h4>🛒 Shopping List${invLoaded ? '' : ' <span class="price-note">(no inventory)</span>'} <span class="shop-pct-bar"><span class="shop-pct-fill" style="width:${barWidth}%"></span><span class="shop-pct-text">${pctDisplay}</span></span></h4>
        <div class="shop-header">
            <span class="shop-col">Item</span>
            <span class="shop-col">Need / Total</span>
            <span class="shop-col">Unit</span>
        </div>
        ${rows}
    </div>`;
}

// Render detail row
function renderDetailRow(r) {
    const mode = currentMode;
    
    // Get enhancement materials (NO artisan tea - these are for enhancing, not crafting)
    const materials = getMaterialDetails(r.item_hrid, 1, mode); // per attempt, actions=1
    
    // Materials HTML (per attempt, no artisan tea adjustments here)
    let matsHtml = '';
    let matsPerAttempt = 0;
    for (const m of materials) {
        const lineTotal = m.count * m.price;
        matsPerAttempt += lineTotal;
        matsHtml += `<div class="mat-row">
            <span class="mat-name">${m.name}</span>
            <span class="mat-count">${m.count.toFixed(m.name === 'Coins' ? 0 : 0)}x @ ${formatCoins(m.price)}</span>
            <span class="mat-price">${formatCoins(lineTotal)}</span>
        </div>`;
    }
    const totalEnhanceCost = matsPerAttempt * r.actions;
    const totalProtCost = r.protectPrice * r.protectCount;
    
    // Protection item name (shorter version without level)
    const protItem = gameData.items[r.protectHrid];
    let protName = protItem?.name || (r.protectHrid ? r.protectHrid.split('/').pop().replace(/_/g, ' ') : 'Protection');
    // Strip "Protection" prefix for display
    protName = protName.replace(/^Protection /, '');
    
    // Base item section - check for craft alternative
    const marketPrice = getBuyPrice(r.item_hrid, 0, mode);
    const craftData = getCraftingMaterials(r.item_hrid, mode); // WITH artisan tea
    
    let baseItemHtml = '';
    if (r.baseSource === 'craft' && craftData) {
        // Craft is cheaper - show breakdown (base item now included in materials)
        const craftMatsHtml = craftData.materials.map(m => `
            <div class="mat-row">
                <span class="mat-name">${m.name}</span>
                <span class="mat-count">${m.count.toFixed(2)}x @ ${formatCoins(m.price)}</span>
                <span class="mat-price">${formatCoins(m.total)}</span>
            </div>
        `).join('');
        
        baseItemHtml = `
            <div class="detail-line">
                <span class="label">Market price</span>
                <span class="value alt">${marketPrice > 0 ? formatCoins(marketPrice) : '--'}</span>
            </div>
            <div class="detail-line">
                <span class="label">Craft price</span>
                <span class="value">${formatCoins(r.basePrice)}</span>
            </div>
            <div class="craft-breakdown">
                ${craftMatsHtml}
                <div class="mat-row total-row">
                    <span class="mat-name">Craft Total</span>
                    <span class="mat-count"></span>
                    <span class="mat-price">${formatCoins(craftData.total)}</span>
                </div>
            </div>`;
    } else {
        // Market is cheaper (or only option)
        baseItemHtml = `
            <div class="detail-line">
                <span class="label">Market price</span>
                <span class="value">${marketPrice > 0 ? formatCoins(marketPrice) : '--'}</span>
            </div>`;
        if (craftData) {
            baseItemHtml += `
            <div class="detail-line">
                <span class="label">Craft price</span>
                <span class="value alt">${formatCoins(craftData.total)}</span>
            </div>`;
        }
    }
    
    // Price history - show change if available
    const priceInfo = getPriceAge(r.item_hrid, r.target_level);
    let priceHtml = '';
    
    if (priceInfo && priceInfo.lastPrice && priceInfo.lastPrice !== priceInfo.price) {
        // Show price change
        const pctChange = ((priceInfo.price - priceInfo.lastPrice) / priceInfo.lastPrice * 100).toFixed(1);
        const pctClass = pctChange > 0 ? 'positive' : 'negative';
        priceHtml = `<div class="detail-line">
            <span class="label">Sell price (bid)</span>
            <span class="value ${pctClass}">${formatCoins(priceInfo.lastPrice)} → ${formatCoins(priceInfo.price)} (${pctChange > 0 ? '+' : ''}${pctChange}%)</span>
        </div>`;
    } else {
        priceHtml = `<div class="detail-line">
            <span class="label">Sell price (+${r.target_level})</span>
            <span class="value">${formatCoins(r.sellPrice)}</span>
        </div>`;
    }
    
    if (priceInfo) {
        const ageStr = formatAge(priceInfo.age);
        const sinceDate = new Date(priceInfo.since * 1000).toLocaleString();
        priceHtml += `<div class="detail-line">
            <span class="label">Since</span>
            <span class="value">${sinceDate} (${ageStr})</span>
        </div>`;
    }
    
    return `<div class="detail-content">
        <div class="detail-section">
            <h4>📦 Base Item</h4>
            ${baseItemHtml}
        </div>
        
        ${renderShoppingList(r, materials)}
        
        <div class="detail-section enhance-panel">
            <div class="enhance-header">
                <h4>⚡ Enhance</h4>
            </div>
            <div class="enhance-prot-row">
                <span class="protect-badge">Prot @ ${r.protectAt}</span>
                <span class="protect-count">${r.protectCount.toFixed(1)}</span>
                <span class="protect-name">${protName}</span>
                <span class="protect-price">${formatCoins(r.protectPrice)}</span>
            </div>
            <div class="enhance-mats">
                <div class="enhance-mats-label">Cost per click:</div>
                ${matsHtml || '<div class="detail-line"><span class="label">None</span></div>'}
            </div>
            <div class="mat-row total-row">
                <span class="mat-name">${r.actions.toFixed(0)} enhances</span>
                <span class="mat-count"></span>
                <span class="mat-price">${formatCoins(matsPerAttempt)} / click</span>
            </div>
        </div>
        
        <div class="detail-section">
            <h4>📈 Sell & Time</h4>
            ${priceHtml}
            <div class="detail-line">
                <span class="label">Time (${r.actions.toFixed(0)} attempts)</span>
                <span class="value">${r.timeHours.toFixed(1)}h (${r.timeDays.toFixed(2)}d)</span>
            </div>
            <div class="detail-line">
                <span class="label">XP earned</span>
                <span class="value">${formatXP(r.totalXp)}</span>
            </div>
            <div class="cost-summary-divider"></div>
            <h4>💰 Cost Summary</h4>
            <div class="detail-line">
                <span class="label">Base item</span>
                <span class="value">${formatCoins(r.basePrice)}</span>
            </div>
            <div class="detail-line">
                <span class="label">Materials (${r.actions.toFixed(0)} × ${formatCoins(matsPerAttempt)})</span>
                <span class="value">${formatCoins(totalEnhanceCost)}</span>
            </div>
            <div class="detail-line">
                <span class="label">Protection (${r.protectCount.toFixed(1)} × ${formatCoins(r.protectPrice)})</span>
                <span class="value">${formatCoins(totalProtCost)}</span>
            </div>
            <div class="mat-row total-row">
                <span class="mat-name">Total Cost</span>
                <span class="mat-count"></span>
                <span class="mat-price">${formatCoins(r.totalCost)}</span>
            </div>
        </div>
    </div>`;
}

// Main render
function renderTable() {
    const data = allResults[currentMode] || [];
    
    // Filter by level
    let filtered = currentLevel === 'all' ? data : 
        data.filter(r => r.target_level == currentLevel);
    
    // Filter by cost
    filtered = filtered.filter(r => costFilters[getCostBucket(r.totalCost)]);
    
    const profitKey = showFee ? 'profitAfterFee' : 'profit';
    const profitDayKey = showFee ? 'profitPerDayAfterFee' : 'profitPerDay';
    const roiKey = showFee ? 'roiAfterFee' : 'roi';
    
    // Add computed fields
    filtered = filtered.map(r => {
        let profit = r[profitKey];
        let profitDay = r[profitDayKey];
        const roi = r[roiKey] || r.roi;
        
        if (showSuperPessimistic) {
            const matLoss = r.matCost * 0.33 * (1 - 0.882);
            const protLoss = (r.protectPrice * r.protectCount) * 0.33 * (1 - 0.882);
            profit -= matLoss + protLoss;
            profitDay = r.timeDays > 0 ? profit / r.timeDays : 0;
        }
        
        // Get price age for sorting
        const priceInfo = getPriceAge(r.item_hrid, r.target_level);
        const _age = priceInfo ? priceInfo.age : Infinity;
        
        return { ...r, _profit: profit, _profit_day: profitDay, _roi: roi, _age };
    });
    
    // Sort
    const sortKeys = ['item_name', 'target_level', '_age', 'basePrice', 'matCost', 'totalCost', 'sellPrice', '_profit', '_roi', '_profit_day', 'timeDays', 'xpPerDay'];
    filtered.sort((a, b) => {
        let va = a[sortKeys[sortCol]];
        let vb = b[sortKeys[sortCol]];
        if (typeof va === 'string') {
            return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return sortAsc ? va - vb : vb - va;
    });
    
    // Stats
    const profitable = data.filter(r => r[profitKey] > MIN_PROFIT);
    const bestProfit = profitable.length ? Math.max(...profitable.map(r => r[profitKey])) : 0;
    const bestRoi = profitable.length ? Math.max(...profitable.map(r => r[roiKey] || r.roi)) : 0;
    const bestProfitDay = profitable.length ? Math.max(...profitable.map(r => r[profitDayKey])) : 0;
    const bestXpDay = data.length ? Math.max(...data.map(r => r.xpPerDay)) : 0;
    
    document.getElementById('stat-profitable').textContent = profitable.length;
    document.getElementById('stat-roi').textContent = bestRoi.toFixed(0) + '%';
    document.getElementById('stat-profit').textContent = formatCoins(bestProfit);
    document.getElementById('stat-profitday').textContent = formatCoins(bestProfitDay);
    document.getElementById('stat-xpday').textContent = formatXP(bestXpDay);
    
    // Render table
    const tbody = document.getElementById('table-body');
    const displayItems = filtered.slice(0, 400);
    const maxProfitDay = Math.max(...displayItems.map(r => r._profit_day || 0), 1);
    const minProfitDay = Math.min(...displayItems.map(r => r._profit_day || 0), 0);
    
    let html = '';
    displayItems.forEach(r => {
        const rowId = r.item_hrid + '_' + r.target_level;
        const isExpanded = expandedRows.has(rowId);
        const profit = r._profit;
        const profitDay = r._profit_day;
        const roi = r._roi;
        const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
        const sourceClass = r.baseSource === 'market' ? 'source-market' : r.baseSource === 'craft' ? 'source-craft' : 'source-vendor';
        
        // Get price age
        const priceInfo = getPriceAge(r.item_hrid, r.target_level);
        const ageStr = priceInfo ? formatAge(priceInfo.age) : '-';
        const ageArrow = priceInfo?.direction === 'up' ? ' <span class="price-up">↑</span>' : 
                         priceInfo?.direction === 'down' ? ' <span class="price-down">↓</span>' : '';
        
        // Material % bar in item name (from inventory)
        const matPct = calculateMatPercent(r);
        const matBarStyle = matPct !== null ? `width:${Math.min(matPct, 100).toFixed(1)}%` : 'display:none';
        
        let barWidth = 0;
        let barClass = 'positive';
        if (profitDay > 0) {
            barWidth = (profitDay / maxProfitDay) * 100;
        } else if (profitDay < 0 && minProfitDay < 0) {
            barWidth = (profitDay / minProfitDay) * 100;
            barClass = 'negative';
        }
        
        html += `<tr class="data-row ${isExpanded ? 'expanded' : ''}" onclick="toggleRow('${rowId}')" data-level="${r.target_level}" data-matpct="${matPct !== null ? matPct : -1}">
            <td class="item-name"><div class="mat-pct-bar" style="${matBarStyle}"></div><span class="expand-icon">▶</span>${r.item_name}</td>
            <td><span class="level-badge">+${r.target_level}</span></td>
            <td class="number">${ageStr}${ageArrow}</td>
            <td class="number"><span class="price-source ${sourceClass}"></span>${formatCoins(r.basePrice)}</td>
            <td class="number hide-mobile">${formatCoins(r.matCost)}</td>
            <td class="number hide-mobile">${formatCoins(r.totalCost)}</td>
            <td class="number cost-${getCostBucket(r.totalCost)}" style="text-align:center">${formatCoins(r.sellPrice)}</td>
            <td class="number ${profitClass}">${formatCoins(profit)}</td>
            <td class="number ${profitClass}">${roi.toFixed(1)}%</td>
            <td class="number profit-bar-cell ${profitClass}"><div class="profit-bar ${barClass}" style="width:${barWidth.toFixed(1)}%"></div><span class="profit-bar-value">${formatCoins(profitDay)}</span></td>
            <td class="number hide-mobile">${r.timeDays.toFixed(2)}</td>
            <td class="number hide-mobile">${formatXP(r.xpPerDay)}</td>
        </tr>`;
        
        // Detail row
        html += `<tr class="detail-row ${isExpanded ? 'visible' : ''}">
            <td colspan="12">
                ${renderDetailRow(r)}
            </td>
        </tr>`;
    });
    
    tbody.innerHTML = html;
    
    // Update sort arrows
    document.querySelectorAll('th').forEach((th, i) => {
        th.classList.toggle('sorted', i === sortCol);
        const arrow = th.querySelector('.sort-arrow');
        if (arrow) arrow.innerHTML = (i === sortCol && sortAsc) ? '▲' : '▼';
    });
}

// Start when DOM ready
document.addEventListener('DOMContentLoaded', init);
