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

// Sync status indicator - show userscript link if no data after timeout
let userscriptDetected = false;
window.addEventListener('cowprofit-inventory-loaded', () => { userscriptDetected = true; updateSyncStatus(); });
window.addEventListener('cowprofit-loot-loaded', () => { userscriptDetected = true; updateSyncStatus(); });

setTimeout(() => {
    if (!userscriptDetected) updateSyncStatus();
}, 3000);

function updateSyncStatus() {
    const el = document.getElementById('sync-status');
    if (!el) return;
    if (userscriptDetected) {
        el.innerHTML = '<span class="sync-ok">✓ Synced</span>';
    } else {
        el.innerHTML = `<span class="sync-none">No userscript detected — <a href="https://github.com/sdwr/cowprofit/blob/main/cowprofit-inventory.user.js" target="_blank">Install CowProfit Bridge</a> to sync enhance history</span>`;
    }
}

// ============================================
// SESSION OVERRIDES (localStorage)
// ============================================

const SESSION_OVERRIDES_KEY = 'cowprofit_session_overrides';

function getSessionOverrides() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_OVERRIDES_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function saveSessionOverride(startTime, override) {
    const overrides = getSessionOverrides();
    overrides[startTime] = { ...overrides[startTime], ...override };
    localStorage.setItem(SESSION_OVERRIDES_KEY, JSON.stringify(overrides));
}

function clearSessionOverride(startTime) {
    const overrides = getSessionOverrides();
    delete overrides[startTime];
    localStorage.setItem(SESSION_OVERRIDES_KEY, JSON.stringify(overrides));
}

function getSessionHash(session) {
    const dropCount = Object.values(session.drops || {}).reduce((a, b) => a + b, 0);
    return `${session.actionHrid || ''}:${session.actionCount || 0}:${dropCount}`;
}

// ============================================
// MWI PRICE INCREMENT LOGIC
// ============================================

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
    return 500000000; // fallback for very high prices
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
    // Check if we crossed into a new tier
    const nextStep = getPriceStep(next);
    if (nextStep !== step) {
        // Snap to first valid price in new tier
        return Math.ceil(next / nextStep) * nextStep;
    }
    return next;
}

function getPrevPrice(price) {
    if (price <= 1) return 0;
    const step = getPriceStep(price);
    const prev = price - step;
    if (prev <= 0) return 0;
    // Check if we crossed into a lower tier
    const prevStep = getPriceStep(prev);
    if (prevStep !== step) {
        // Snap to last valid price in lower tier
        return Math.floor(prev / prevStep) * prevStep;
    }
    return prev;
}

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
    lootHistoryOpen = false;
    document.getElementById('gear-panel').classList.remove('visible');
    document.getElementById('gear-arrow').innerHTML = '&#9660;';
    document.getElementById('loot-history-panel').classList.remove('visible');
    document.getElementById('loot-history-arrow').innerHTML = '&#9660;';
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
    lootHistoryOpen = false;
    document.getElementById('history-panel').classList.remove('visible');
    document.getElementById('history-arrow').innerHTML = '&#9660;';
    document.getElementById('loot-history-panel').classList.remove('visible');
    document.getElementById('loot-history-arrow').innerHTML = '&#9660;';
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

// --- Session Grouping State ---
let expandedCardId = null;
let showSold = true;
let showUnsold = true;
let showFailed = true;

function getGroupState() {
    try {
        return JSON.parse(localStorage.getItem('cowprofit_session_groups') || '{}');
    } catch { return {}; }
}

function saveGroupState(state) {
    localStorage.setItem('cowprofit_session_groups', JSON.stringify(state));
}

// Auto-group sessions: walk chronologically per item, accumulate failures, close at success
function autoGroupSessions(sessions) {
    const state = getGroupState();
    const manualUngroups = state.manualUngroups || {};
    const existingGroups = state.groups || {};

    // Build set of manually ungrouped session keys
    const ungroupedKeys = new Set(Object.keys(manualUngroups));

    // Sort chronologically (oldest first)
    const sorted = [...sessions].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    // Group by item name
    const byItem = {};
    for (const s of sorted) {
        const ep = calculateEnhanceSessionProfit(s);
        if (!ep) continue;
        const itemName = ep.itemName || 'Unknown';
        if (!byItem[itemName]) byItem[itemName] = [];
        byItem[itemName].push(s);
    }

    const groups = {};
    for (const [itemName, itemSessions] of Object.entries(byItem)) {
        let currentGroup = [];
        for (const s of itemSessions) {
            const key = s.startTime;
            const overrides = getSessionOverrides();
            const override = overrides[key] || {};
            const ep = calculateEnhanceSessionProfit(s);
            const isSuccess = override.forceSuccess !== undefined ? override.forceSuccess : ep?.isSuccessful;

            // Manually ungrouped sessions act as a barrier — close any pending group
            if (ungroupedKeys.has(key)) {
                if (currentGroup.length > 1) {
                    const gid = currentGroup[currentGroup.length - 1];
                    groups[gid] = [...currentGroup];
                }
                currentGroup = [];
                continue;
            }

            currentGroup.push(key);

            if (isSuccess && currentGroup.length > 1) {
                // Close the group — use the success session key as group ID
                groups[key] = [...currentGroup];
                currentGroup = [];
            } else if (isSuccess) {
                // Single success, no group needed
                currentGroup = [];
            }
        }
        // Remaining failures form a group too (in-progress, no success yet)
        if (currentGroup.length > 1) {
            const groupId = currentGroup[currentGroup.length - 1]; // most recent as ID
            groups[groupId] = [...currentGroup];
        }
    }

    // Save updated groups
    state.groups = groups;
    saveGroupState(state);
    return groups;
}

function ungroupSession(sessionKey, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const state = getGroupState();
    if (!state.manualUngroups) state.manualUngroups = {};
    state.manualUngroups[sessionKey] = true;
    saveGroupState(state);
    renderLootHistoryPanel();
}

function regroupSession(sessionKey, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const state = getGroupState();
    if (state.manualUngroups) {
        delete state.manualUngroups[sessionKey];
    }
    saveGroupState(state);
    renderLootHistoryPanel();
}

function toggleFilter(category, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    if (category === 'sold') showSold = !showSold;
    else if (category === 'unsold') showUnsold = !showUnsold;
    else if (category === 'failed') showFailed = !showFailed;
    renderLootHistoryPanel();
}

function toggleCardExpand(sessionKey, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    if (expandedCardId === sessionKey) {
        expandedCardId = null;
    } else {
        expandedCardId = sessionKey;
    }
    renderLootHistoryPanel();
}

function formatSessionDate(startTime) {
    const d = new Date(startTime);
    return d.toLocaleDateString('en-CA'); // YYYY-MM-DD format
}

function computeSessionDisplay(session) {
    const enhanceProfit = calculateEnhanceSessionProfit(session);
    if (!enhanceProfit) return null;

    const sessionKey = session.startTime;
    const overrides = getSessionOverrides();
    const override = overrides[sessionKey] || {};
    const currentHash = getSessionHash(session);
    const hashMismatch = override.dataHash && override.dataHash !== currentHash;

    const duration = calculateDuration(session.startTime, session.endTime);
    const durationMs = new Date(session.endTime) - new Date(session.startTime);
    const hours = durationMs / 3600000;

    // Skip very short sessions (< 1 min) with no results and no override
    if (hours < 0.02 && !enhanceProfit.isSuccessful && override.forceSuccess !== true) return null;

    // Determine success status (override takes precedence)
    const isSuccess = override.forceSuccess !== undefined ? override.forceSuccess : enhanceProfit.isSuccessful;

    // Determine the actual result level (for manual toggles, use highestTargetLevel)
    const effectiveResultLevel = enhanceProfit.resultLevel || enhanceProfit.highestTargetLevel || 0;

    // Determine sale price (custom > estimated > 0)
    let salePrice = 0;
    let estimatedSale = enhanceProfit.estimatedSale || 0;
    let estimatedSource = enhanceProfit.estimatedSaleSource || null;
    let estimatedSourceIcon = enhanceProfit.estimatedSaleSourceIcon || null;

    // If manually toggled to success but no auto-calculated estimate, calculate it now
    if (isSuccess && estimatedSale === 0 && effectiveResultLevel > 0) {
        const saleEstimate = estimatePrice(enhanceProfit.itemHrid, effectiveResultLevel, enhanceProfit.lootTs, 'pessimistic');
        estimatedSale = saleEstimate.price;
        estimatedSource = saleEstimate.source;
        estimatedSourceIcon = saleEstimate.sourceIcon;
    }

    if (isSuccess) {
        if (override.customSale !== undefined && override.customSale !== null) {
            salePrice = override.customSale;
        } else {
            salePrice = getValidPrice(estimatedSale);
        }
    }

    // Tea cost calculation
    const guzzlingBonus = calculator?.getGuzzlingBonus() || 1.1216;
    const teaDurationSec = 300 / guzzlingBonus;
    const sessionDurationSec = hours * 3600;
    const teaUses = sessionDurationSec / teaDurationSec;

    const ultraEnhancingPrice = prices.market?.['/items/ultra_enhancing_tea']?.['0']?.a || 0;
    const blessedPrice = prices.market?.['/items/blessed_tea']?.['0']?.a || 0;
    const wisdomPrice = prices.market?.['/items/wisdom_tea']?.['0']?.a || 0;
    const teaCostPerUse = ultraEnhancingPrice + blessedPrice + wisdomPrice;
    const totalTeaCost = teaUses * teaCostPerUse;

    // Calculate fee (2%) and profit
    const fee = Math.floor(salePrice * 0.02);
    const netSale = salePrice - fee;
    const failureCost = enhanceProfit.totalMatCost + enhanceProfit.totalProtCost + totalTeaCost;

    // For manual success toggles, baseItemCost may be 0 - calculate it if needed
    let baseItemCost = enhanceProfit.baseItemCost || 0;
    if (isSuccess && baseItemCost === 0 && effectiveResultLevel > 0) {
        const baseEstimate = estimatePrice(enhanceProfit.itemHrid, 0, enhanceProfit.lootTs, 'pessimistic');
        baseItemCost = baseEstimate.price;
    }
    const successCost = enhanceProfit.totalMatCost + enhanceProfit.totalProtCost + baseItemCost + totalTeaCost;
    const profit = isSuccess ? netSale - successCost : -failureCost;
    const profitPerDay = hours > 0.01 ? (profit / hours) * 24 : 0;

    // Check for price errors
    const hasPriceErrors = enhanceProfit.matPriceMissing || enhanceProfit.protPriceMissing ||
        (isSuccess && salePrice === 0);

    // Determine sold status (only for successful sessions, default true)
    const isSold = !isSuccess ? true : (override.isSold !== undefined ? override.isSold : true);

    return {
        session,
        sessionKey,
        enhanceProfit,
        isSuccess,
        isSold,
        effectiveResultLevel,
        salePrice,
        estimatedSale,
        estimatedSource,
        estimatedSourceIcon,
        totalTeaCost,
        fee,
        baseItemCost,
        profit,
        profitPerDay,
        hours,
        duration,
        hasPriceErrors,
        hashMismatch
    };
}

function renderCardBody(d, isSubCard) {
    const ep = d.enhanceProfit;
    const profitClass = d.hasPriceErrors ? 'warning' : (d.profit > 0 ? 'positive' : (d.profit < 0 ? 'negative' : 'neutral'));
    const protAtLevel = ep.protLevel || 8;

    const startLevel = ep.currentLevel || 0;
    const highLevel = ep.highestLevel || 0;
    const levelInfo = `+${startLevel}→+${highLevel}`;

    let headerHtml;
    if (isSubCard) {
        headerHtml = `<div class="loot-header">
            <span class="loot-action">
                <span class="result-badge fail">✗</span>
                <span class="item-name">${ep.itemName || 'Unknown'}</span>
                <span class="level-info">${levelInfo}</span>
            </span>
            <span class="loot-time">${formatLootTime(d.session.startTime)}</span>
        </div>`;
    } else {
        const resultBadge = d.isSuccess
            ? `<span class="result-badge">+${d.effectiveResultLevel || '?'}</span>`
            : '<span class="result-badge fail">✗</span>';
        const toggleIcon = d.isSuccess ? '✓' : '✗';
        const toggleClass = d.isSuccess ? 'toggle-success' : 'toggle-failure';
        const hashWarning = d.hashMismatch ? '<span class="hash-warning" title="Session data changed">⚠️</span>' : '';
        const soldToggleHtml = d.isSuccess
            ? `<button class="sold-toggle ${d.isSold ? 'is-sold' : 'is-unsold'}" data-session="${d.sessionKey}" title="${d.isSold ? 'Sold' : 'Unsold'}">${d.isSold ? '💰' : '📦'}</button>`
            : '';

        headerHtml = `<div class="loot-header">
            <span class="loot-action">
                ${resultBadge}
                <button class="toggle-btn ${toggleClass}" data-session="${d.sessionKey}" title="Toggle success/failure">${toggleIcon}</button>
                ${soldToggleHtml}
                ${hashWarning}
                <span class="item-name">${ep.itemName || 'Unknown'}</span>
                <span class="level-info">${levelInfo}</span>
            </span>
            <span class="loot-time">${formatLootTime(d.session.startTime)}</span>
        </div>`;
    }

    const detailsHtml = `<div class="loot-details">
        <span class="loot-duration">${d.duration}</span>
        <span class="loot-actions">${ep.actionCount} actions</span>
        <span class="loot-prots">${ep.protsUsed} prots @${protAtLevel}</span>
    </div>`;

    let matCostStr = ep.matPriceMissing ? '⚠️ no price' : (ep.totalMatCost > 0 ? formatCoins(ep.totalMatCost) : '-');
    let protStr = '-';
    if (ep.protsUsed > 0) {
        protStr = ep.protPriceMissing
            ? `⚠️ (${ep.protsUsed}×)`
            : `${formatCoins(ep.totalProtCost)} (${ep.protsUsed} × ${formatCoins(ep.protPrice)})`;
    }
    const teaStr = d.totalTeaCost > 0 ? formatCoins(d.totalTeaCost) : '-';

    let costsHtml = `<div class="loot-costs">
        <span>Mats: ${matCostStr}</span>
        <span>Prot: ${protStr}</span>
        <span>Teas: ${teaStr}</span>
        ${d.isSuccess && !isSubCard ? `<span>Base: ${ep.baseItemSourceIcon || ''} ${formatCoins(d.baseItemCost)}</span>` : ''}
    </div>`;

    let saleHtml = '';
    if (d.isSuccess && !isSubCard) {
        const estIcon = d.estimatedSourceIcon || '';
        const estSaleStr = (d.estimatedSale > 0 && d.estimatedSource)
            ? `${estIcon} ${formatCoins(d.estimatedSale)}` : '⚠️ no price';
        const saleFormatted = d.salePrice > 0 ? formatCoins(d.salePrice) : '0';
        const feeStr = d.fee > 0 ? `-${formatCoins(d.fee)}` : '-';

        saleHtml = `<div class="loot-sale">
            <span>Est: ${estSaleStr}</span>
            <span>Sale: <span class="sale-input-group">
                <button class="sale-btn sale-down" data-session="${d.sessionKey}" data-dir="down">◀</button>
                <input type="text" class="sale-input" data-session="${d.sessionKey}" value="${saleFormatted}" data-raw="${d.salePrice}">
                <button class="sale-btn sale-up" data-session="${d.sessionKey}" data-dir="up">▶</button>
            </span></span>
            <span class="fee">Fee: ${feeStr}</span>
        </div>`;
    }

    const profitStr = d.hasPriceErrors ? '⚠️' : formatCoins(d.profit);
    const rateStr = d.hasPriceErrors ? '-' : `${formatCoins(d.profitPerDay)}/day`;
    const valuesHtml = `<div class="loot-values">
        <span class="loot-value ${profitClass}">Profit: ${profitStr}</span>
        <span class="loot-rate">${rateStr}</span>
    </div>`;

    return headerHtml + detailsHtml + costsHtml + saleHtml + valuesHtml;
}

function renderSessionCard(d, options) {
    const isSubCard = options?.isSubCard || false;
    const isGrouped = options?.isGrouped || false;
    const isExpanded = expandedCardId === d.sessionKey;
    const bgClass = !d.isSuccess ? 'session-failure' : (d.isSold ? 'session-success' : 'session-unsold');
    const profitClass = d.hasPriceErrors ? 'warning' : (d.profit > 0 ? 'positive' : (d.profit < 0 ? 'negative' : 'neutral'));

    const itemTitle = d.enhanceProfit.itemName || 'Unknown';
    const dateStr = formatSessionDate(d.session.startTime);
    const profitDisplay = d.hasPriceErrors ? '⚠️' : formatCoins(d.profit);

    const moneyIcon = (d.isSuccess && !d.isSold) ? '📦' : '💰';
    let titleContent;
    if (isSubCard) {
        titleContent = `<span class="result-badge fail">✗</span> <span class="card-title-text">${itemTitle}</span> <span class="card-title-sep">|</span> ${dateStr} <span class="card-title-sep">|</span> ${moneyIcon} <span class="${profitClass}">${profitDisplay}</span>`;
    } else if (d.isSuccess) {
        titleContent = `<span class="result-badge">+${d.effectiveResultLevel || '?'}</span> <span class="card-title-text">${itemTitle}</span> <span class="card-title-sep">|</span> ${dateStr} <span class="card-title-sep">|</span> ${moneyIcon} <span class="${profitClass}">${profitDisplay}</span>`;
    } else {
        titleContent = `<span class="result-badge fail">✗</span> <span class="card-title-text">${itemTitle}</span> <span class="card-title-sep">|</span> ${dateStr} <span class="card-title-sep">|</span> ${moneyIcon} <span class="${profitClass}">${profitDisplay}</span>`;
    }

    const expandIcon = isExpanded ? '▼' : '▶';

    return `<div class="session-card ${bgClass} ${isExpanded ? 'card-expanded' : 'card-collapsed'}" data-card-id="${d.sessionKey}">
        <div class="card-title" onclick="toggleCardExpand('${d.sessionKey}', event)">
            <span class="card-expand-icon">${expandIcon}</span>
            ${titleContent}
        </div>
        ${isExpanded ? `<div class="card-body">${renderCardBody(d, isSubCard)}</div>` : ''}
    </div>`;
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

    // Compute display data for all sessions
    const displayData = {};
    for (const s of enhanceSessions) {
        const d = computeSessionDisplay(s);
        if (d) displayData[s.startTime] = d;
    }

    // Auto-group sessions
    const validSessions = enhanceSessions.filter(s => displayData[s.startTime]);
    const groups = autoGroupSessions(validSessions);
    const groupState = getGroupState();
    const manualUngroups = groupState.manualUngroups || {};

    // Build render items
    const groupedKeys = new Set();
    const renderItems = [];

    for (const [groupId, memberKeys] of Object.entries(groups)) {
        const validKeys = memberKeys.filter(k => displayData[k]);
        if (validKeys.length < 2) continue;

        for (const k of validKeys) groupedKeys.add(k);
        const topKey = validKeys[validKeys.length - 1]; // success (last/most recent)
        const subKeys = validKeys.slice(0, -1).reverse(); // failures, newest first

        renderItems.push({
            type: 'group', groupId, topKey, subKeys, memberKeys: validKeys,
            sortDate: new Date(topKey)
        });
    }

    for (const key of Object.keys(displayData)) {
        if (!groupedKeys.has(key)) {
            renderItems.push({ type: 'standalone', sessionKey: key, sortDate: new Date(key) });
        }
    }

    renderItems.sort((a, b) => b.sortDate - a.sortDate);

    // Clear expanded card if it no longer exists in data
    if (expandedCardId !== null && !displayData[expandedCardId]) {
        expandedCardId = null;
    }

    // Calculate totals + categorize render items
    let totalProfit = 0, soldProfit = 0, unsoldProfit = 0, failedProfit = 0;
    let totalHours = 0, validCount = 0;

    // Determine category for each render item (for filtering)
    function getRenderItemCategory(item) {
        if (item.type === 'group') {
            const topData = displayData[item.topKey];
            if (topData?.isSuccess) return topData.isSold ? 'sold' : 'unsold';
            return 'failed'; // all-failure group
        } else {
            const d = displayData[item.sessionKey];
            if (d?.isSuccess) return d.isSold ? 'sold' : 'unsold';
            return 'failed';
        }
    }

    for (const d of Object.values(displayData)) {
        validCount++;
        if (!d.hasPriceErrors) {
            totalProfit += d.profit;
            totalHours += d.hours;
        }
    }

    // Calculate per-category profit based on render items (group-aware)
    for (const item of renderItems) {
        const cat = getRenderItemCategory(item);
        if (item.type === 'group') {
            let gProfit = 0;
            for (const k of item.memberKeys) {
                const d = displayData[k];
                if (d && !d.hasPriceErrors) gProfit += d.profit;
            }
            if (cat === 'sold') soldProfit += gProfit;
            else if (cat === 'unsold') unsoldProfit += gProfit;
            else failedProfit += gProfit;
        } else {
            const d = displayData[item.sessionKey];
            if (d && !d.hasPriceErrors) {
                if (cat === 'sold') soldProfit += d.profit;
                else if (cat === 'unsold') unsoldProfit += d.profit;
                else failedProfit += d.profit;
            }
        }
    }
    // Ungrouped failures within success groups are counted in their group's category, not as "failed"

    // Disable group/ungroup actions when any filter is off
    const allFiltersOn = showSold && showUnsold && showFailed;

    // Build item name lookup for groupability check
    const itemNameByKey = {};
    for (const [key, d] of Object.entries(displayData)) {
        itemNameByKey[key] = d.enhanceProfit?.itemName || 'Unknown';
    }

    // Filter render items by toggle state
    const filteredItems = renderItems.filter(item => {
        const cat = getRenderItemCategory(item);
        if (cat === 'sold' && !showSold) return false;
        if (cat === 'unsold' && !showUnsold) return false;
        if (cat === 'failed' && !showFailed) return false;
        return true;
    });

    // Render items
    let entriesHtml = '';
    for (let ri = 0; ri < filteredItems.length; ri++) {
        const item = filteredItems[ri];
        if (item.type === 'group') {
            const topData = displayData[item.topKey];
            const subDatas = item.subKeys.map(k => displayData[k]);

            // Group total profit
            let groupProfit = topData.profit;
            for (const sd of subDatas) groupProfit += sd.profit;
            const groupProfitClass = groupProfit > 0 ? 'positive' : (groupProfit < 0 ? 'negative' : 'neutral');

            let groupHtml = '<div class="session-group">';

            // Top card with ungroup overlay (only when all filters on)
            groupHtml += `<div class="group-card-wrapper">`;
            groupHtml += renderSessionCard(topData, { isSubCard: false, isGrouped: true });
            if (allFiltersOn) {
                if (subDatas.length === 1) {
                    groupHtml += `<div class="ungroup-handle" onclick="ungroupSession('${subDatas[0].sessionKey}', event)" title="Ungroup">⇕</div>`;
                } else {
                    groupHtml += `<div class="ungroup-handle" onclick="ungroupSession('${item.topKey}', event)" title="Detach">⇕</div>`;
                }
            }
            groupHtml += `</div>`;

            // Sub-cards (failures)
            for (let i = 0; i < subDatas.length; i++) {
                groupHtml += `<div class="group-card-wrapper">`;
                groupHtml += renderSessionCard(subDatas[i], { isSubCard: true, isGrouped: true });
                // Bottom card ungroup handle (3+ cards only, only when all filters on)
                if (allFiltersOn && subDatas.length >= 2 && i === subDatas.length - 1) {
                    groupHtml += `<div class="ungroup-handle" onclick="ungroupSession('${subDatas[i].sessionKey}', event)" title="Detach">⇕</div>`;
                }
                groupHtml += `</div>`;
            }

            // Group summary
            groupHtml += `<div class="group-summary">
                <span>${item.memberKeys.length} sessions</span>
                <span class="loot-value ${groupProfitClass}">Total: ${formatCoins(groupProfit)}</span>
            </div>`;

            groupHtml += '</div>';
            entriesHtml += groupHtml;
        } else {
            // Standalone card
            const d = displayData[item.sessionKey];
            const myItem = itemNameByKey[d.sessionKey];

            // Find if there's a same-item standalone elsewhere (separated, not adjacent)
            const hasGroupableMatch = filteredItems.some((other, oi) =>
                oi !== ri && other.type === 'standalone' &&
                itemNameByKey[other.sessionKey] === myItem
            );

            // Check for adjacent same-item standalone
            const prevIsGroupable = ri > 0 && filteredItems[ri - 1].type === 'standalone'
                && itemNameByKey[filteredItems[ri - 1].sessionKey] === myItem;
            const nextIsGroupable = ri < filteredItems.length - 1 && filteredItems[ri + 1].type === 'standalone'
                && itemNameByKey[filteredItems[ri + 1].sessionKey] === myItem;

            // Render card with optional group handles (only when all filters on)
            entriesHtml += renderSessionCard(d, { isSubCard: false, isGrouped: false });
            if (allFiltersOn) {
                if (manualUngroups[d.sessionKey]) {
                    entriesHtml += `<div class="group-handle-attached" onclick="regroupSession('${d.sessionKey}', event)" title="Group this session">⇕ group</div>`;
                } else if (hasGroupableMatch && !prevIsGroupable && !nextIsGroupable) {
                    entriesHtml += `<div class="group-handle-attached" onclick="regroupSession('${d.sessionKey}', event)" title="Group this session">⇕ group</div>`;
                }
            }
        }
    }

    const avgPerDay = totalHours > 0 ? (totalProfit / totalHours) * 24 : 0;
    const soldClass = soldProfit >= 0 ? 'positive' : 'negative';
    const unsoldClass = unsoldProfit >= 0 ? 'positive' : 'negative';
    const failedClass = failedProfit >= 0 ? 'positive' : 'negative';
    const avgClass = avgPerDay >= 0 ? 'positive' : 'negative';

    const totalClass = totalProfit >= 0 ? 'positive' : 'negative';

    panel.innerHTML = `
        <div class="loot-title-row">
            <h5>📜 Enhance History <span class="session-count">(${validCount})</span> <span class="loot-avg ${avgClass}">${formatCoins(avgPerDay)}/day</span></h5>
            <span class="loot-total ${totalClass}">${formatCoins(totalProfit)}</span>
        </div>
        <div class="loot-summary">
            <button class="filter-toggle ${showSold ? 'active' : 'inactive'}" onclick="toggleFilter('sold', event)">
                <span class="filter-label">Sold:</span> <span class="${soldClass}">${formatCoins(soldProfit)}</span>
            </button>
            <button class="filter-toggle ${showUnsold ? 'active' : 'inactive'}" onclick="toggleFilter('unsold', event)">
                <span class="filter-label">Unsold:</span> <span class="unsold-value">${formatCoins(unsoldProfit)}</span>
            </button>
            <button class="filter-toggle ${showFailed ? 'active' : 'inactive'}" onclick="toggleFilter('failed', event)">
                <span class="filter-label">Failed:</span> <span class="${failedClass}">${formatCoins(failedProfit)}</span>
            </button>
        </div>
        <div class="loot-entries">
            ${entriesHtml}
        </div>
    `;

    // Update session count in button
    const countEl = document.getElementById('loot-session-count');
    if (countEl) countEl.textContent = `(${validCount}) `;

    attachLootHistoryHandlers();
}

// Event handlers for loot history interactions
function attachLootHistoryHandlers() {
    // Toggle buttons (success/failure)
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const sessionKey = btn.dataset.session;
            const overrides = getSessionOverrides();
            const current = overrides[sessionKey]?.forceSuccess;

            const session = lootHistoryData.find(s => s.startTime === sessionKey);
            const hash = session ? getSessionHash(session) : null;

            let newValue;
            if (current === undefined || current === null) {
                newValue = true;
            } else if (current === true) {
                newValue = false;
            } else {
                newValue = undefined;
            }

            const existingOverride = getSessionOverrides()[sessionKey] || {};
            if (newValue === undefined) {
                if (existingOverride.customSale !== undefined || existingOverride.isSold !== undefined) {
                    saveSessionOverride(sessionKey, { forceSuccess: undefined, dataHash: hash });
                } else {
                    clearSessionOverride(sessionKey);
                }
            } else {
                saveSessionOverride(sessionKey, { forceSuccess: newValue, dataHash: hash });
            }
            renderLootHistoryPanel();
        };
    });

    // Sold toggle buttons
    document.querySelectorAll('.sold-toggle').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const sessionKey = btn.dataset.session;
            const overrides = getSessionOverrides();
            const currentSold = overrides[sessionKey]?.isSold;

            const session = lootHistoryData.find(s => s.startTime === sessionKey);
            const hash = session ? getSessionHash(session) : null;

            const newValue = (currentSold === undefined || currentSold === true) ? false : true;

            saveSessionOverride(sessionKey, { isSold: newValue, dataHash: hash });
            renderLootHistoryPanel();
        };
    });

    // Sale up/down buttons
    document.querySelectorAll('.sale-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const sessionKey = btn.dataset.session;
            const dir = btn.dataset.dir;
            const input = document.querySelector(`.sale-input[data-session="${sessionKey}"]`);
            if (!input) return;

            let rawValue = parseInt(input.dataset.raw) || 0;
            const newValue = dir === 'up' ? getNextPrice(rawValue) : getPrevPrice(rawValue);

            const session = lootHistoryData.find(s => s.startTime === sessionKey);
            const hash = session ? getSessionHash(session) : null;

            saveSessionOverride(sessionKey, { customSale: newValue, dataHash: hash });
            renderLootHistoryPanel();
        };
    });

    // Sale input direct edit
    document.querySelectorAll('.sale-input').forEach(input => {
        input.onchange = (e) => {
            const sessionKey = input.dataset.session;
            const rawText = input.value.replace(/[^0-9.]/g, '');

            let value = parseFloat(rawText) || 0;
            if (input.value.toLowerCase().includes('b')) {
                value *= 1_000_000_000;
            } else if (input.value.toLowerCase().includes('m')) {
                value *= 1_000_000;
            } else if (input.value.toLowerCase().includes('k')) {
                value *= 1_000;
            }

            const validValue = getValidPrice(Math.round(value));

            const session = lootHistoryData.find(s => s.startTime === sessionKey);
            const hash = session ? getSessionHash(session) : null;

            saveSessionOverride(sessionKey, { customSale: validValue, dataHash: hash });
            renderLootHistoryPanel();
        };

        input.onfocus = () => input.select();
    });
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
    
    // Parse primaryItemHash to get item and current level
    // Format: "charId::/item_locations/inventory::/items/{item_hrid}::{level}"
    if (session.primaryItemHash) {
        const match = session.primaryItemHash.match(/\/items\/([^:]+)::(\d+)/);
        if (match) {
            itemHrid = '/items/' + match[1];
            currentLevel = parseInt(match[2]) || 0;
        }
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
    
    // Get optimal protection level from calculator (instead of hardcoding 8)
    // The calculator finds the most cost-effective prot level for this item
    let protLevel = 8; // fallback
    if (calculator && typeof calculator.calculateEnhancementCost === 'function') {
        try {
            // Use highest level reached as target for prot calculation
            const targetForProt = Math.max(...Object.keys(levelDrops).map(Number), 10);
            const calcResult = calculator.calculateEnhancementCost(itemHrid, targetForProt, prices, 'pessimistic');
            if (calcResult && calcResult.protectAt) {
                protLevel = calcResult.protectAt;
            }
        } catch (e) {
            console.warn('[Loot] Failed to get optimal prot level, using 8:', e);
        }
    }
    
    // Calculate protection used via cascade method (pass startLevel for accurate counting)
    const protResult = calculateProtectionFromDrops(levelDrops, protLevel, currentLevel);
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
    
    // Check protection item hrids from item data (key is "protectionItems" not "protectionItemHrids")
    const protItemHrids = itemData?.protectionItems || [];
    for (const protHrid of protItemHrids) {
        const price = prices.market?.[protHrid]?.['0']?.a || 0;
        if (price > 0) protPrice = Math.min(protPrice, price);
    }
    
    if (protPrice === Infinity) {
        protPrice = 0;
        if (protsUsed > 0) protPriceMissing = true;
    }
    const totalProtCost = protsUsed * protPrice;
    
    // Find highest level from any drops (for display)
    let highestLevel = 0;
    for (const [lvl, count] of Object.entries(levelDrops)) {
        const level = parseInt(lvl) || 0;
        if (level > highestLevel) highestLevel = level;
    }
    
    // Calculate revenue - check drops for completion:
    // Success = exactly 1 item at level 10+ (sellable result)
    // Multiple items at highest level = still working on it
    let revenue = 0;
    let revenueBreakdown = {};
    let revenuePriceMissing = false;
    
    // Find highest level in drops that is 10+ AND highest target level (for debug)
    let resultLevel = 0;
    let highestTargetLevel = 0;
    for (const [lvl, count] of Object.entries(levelDrops)) {
        const level = parseInt(lvl) || 0;
        if (level >= 10 && level > resultLevel) {
            resultLevel = level;
        }
        if ([8, 10, 12, 14].includes(level) && level > highestTargetLevel) {
            highestTargetLevel = level;
        }
    }
    
    // Only count as successful if exactly 1 item at that level
    let isSuccessful = false;
    let baseItemCost = 0;
    let baseItemSource = null;
    let baseItemSourceIcon = null;
    
    // Get loot timestamp for historical price lookup
    const lootTs = session.startTime ? Math.floor(new Date(session.startTime).getTime() / 1000) : Math.floor(Date.now() / 1000);
    
    if (resultLevel >= 10 && (levelDrops[resultLevel] || 0) === 1) {
        // Single item at 10+ = completed enhancement, use for revenue
        isSuccessful = true;
        const sellPrice = prices.market?.[itemHrid]?.[String(resultLevel)]?.b || 0;
        if (sellPrice === 0) revenuePriceMissing = true;
        revenue = sellPrice;
        revenueBreakdown[resultLevel] = { count: 1, sellPrice, value: sellPrice };
        
        // Get base item cost using historical price estimation
        const baseEstimate = estimatePrice(itemHrid, 0, lootTs, 'pessimistic');
        baseItemCost = baseEstimate.price;
        baseItemSource = baseEstimate.source;
        baseItemSourceIcon = baseEstimate.sourceIcon;
    }
    
    const totalCost = totalMatCost + totalProtCost + baseItemCost;
    
    // Calculate estimated sale price using historical price estimation
    // Priority: history (closest to loot time) > oldest history > market bid > craft cost
    let estimatedSale = 0;
    let estimatedSaleSource = null;
    let estimatedSaleSourceIcon = null;
    
    if (isSuccessful && resultLevel >= 10) {
        const saleEstimate = estimatePrice(itemHrid, resultLevel, lootTs, 'pessimistic');
        estimatedSale = saleEstimate.price;
        estimatedSaleSource = saleEstimate.source;
        estimatedSaleSourceIcon = saleEstimate.sourceIcon;
    }
    
    // Fee is 2% of sale price (will be recalculated with actual sale in render)
    const fee = Math.floor(revenue * 0.02);
    const netSale = revenue - fee;
    const profit = netSale - totalCost;
    
    // Calculate per hour
    const durationMs = new Date(session.endTime) - new Date(session.startTime);
    const hours = durationMs / 3600000;
    const profitPerHour = hours > 0.01 ? profit / hours : 0;
    
    // Get item name
    const itemName = itemData?.name || itemHrid.split('/').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    
    // Debug logging for protection calculation
    console.log(`[Enhance] ${itemName}:`, {
        levelDrops,
        protsUsed,
        protCalc: protResult,
        isSuccessful,
        resultLevel,
        costs: { mats: totalMatCost, prots: totalProtCost, baseItem: baseItemCost, total: totalCost },
        estimatedSale,
        estimatedSaleSource,
        revenue,
        fee,
        netSale,
        profit
    });
    
    return {
        itemHrid,
        itemName,
        actionCount,
        totalItems,
        levelDrops,
        currentLevel,
        highestLevel,
        highestTargetLevel,
        resultLevel,  // actual final level from drops (10+ with 1 item)
        isSuccessful,
        protsUsed,
        protLevel,  // optimal protection level from calculator
        matCostPerAction,
        totalMatCost,
        protPrice,
        totalProtCost,
        baseItemCost,
        baseItemSource,
        baseItemSourceIcon,
        totalCost,
        revenue,
        revenueBreakdown,
        estimatedSale,
        estimatedSaleSource,
        estimatedSaleSourceIcon,
        fee,
        netSale,
        profit,
        profitPerHour,
        hours,
        lootTs,
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
function calculateProtectionFromDrops(levelDrops, protLevel, startLevel = 0) {
    const levels = Object.keys(levelDrops).map(Number).sort((a, b) => b - a);
    if (levels.length === 0) return { protCount: 0 };
    
    const maxLevel = Math.max(...levels);
    const finalLevel = maxLevel; // item rests at highest level reached
    
    const successes = {};
    const failures = {};
    const attempts = {};
    
    // Calculate attempts at each level
    // attempts[L] = drops landing at L + (started here?) - (ended here?)
    for (let L = 0; L <= maxLevel; L++) {
        attempts[L] = (levelDrops[L] || 0);
        if (L === startLevel) attempts[L] += 1;
        if (L === finalLevel) attempts[L] -= 1;
    }
    
    // Work top-down from maxLevel
    // At maxLevel: no levels above, so all attempts are failures
    successes[maxLevel] = 0;
    failures[maxLevel] = Math.max(0, attempts[maxLevel]);
    
    for (let L = maxLevel - 1; L >= 0; L--) {
        // successes[L] = drops at L+1 minus failures landing at L+1 from above
        let failuresLandingAtLPlus1 = 0;
        if (L + 2 <= maxLevel && L + 2 >= protLevel) {
            failuresLandingAtLPlus1 = failures[L + 2] || 0;
        }
        successes[L] = (levelDrops[L + 1] || 0) - failuresLandingAtLPlus1;
        if (successes[L] < 0) successes[L] = 0; // clamp (data anomaly, e.g. blessed tea)
        
        failures[L] = attempts[L] - successes[L];
        if (failures[L] < 0) failures[L] = 0;
    }
    
    // Sum failures at levels >= prot = protections used
    let protCount = 0;
    for (let L = protLevel; L <= maxLevel; L++) {
        protCount += failures[L];
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

/**
 * Estimate price for an item using historical data with fallbacks.
 * Priority:
 *   1. 📈 Most recent history entry BEFORE loot timestamp
 *   2. 📈 Newest history entry (if loot is more recent than all history)
 *   3. 📜 Oldest available history entry (if loot predates all history)
 *   4. 🔨 Cost to create (craft for +0 w/ artisan tea, base+enhance for +N)
 * 
 * Note: Market bid is NOT used as fallback - only historical or calculated prices.
 * 
 * @param {string} itemHrid - Item path
 * @param {number} level - Enhancement level (0 for base)
 * @param {number} lootTs - Unix timestamp of when loot was obtained
 * @param {string} mode - Price mode ('pessimistic'|'midpoint'|'optimistic')
 * @returns {{ price: number, source: string, sourceIcon: string }}
 */
function estimatePrice(itemHrid, level, lootTs, mode = 'pessimistic') {
    const key = `${itemHrid}:${level}`;
    const history = prices.history?.[key];
    
    // 1. Check history - find most recent entry BEFORE loot timestamp
    if (history && history.length > 0) {
        // History is sorted newest-first
        const newestTs = history[0].t;
        const oldestTs = history[history.length - 1].t;
        
        // If loot is newer than all history, use newest price
        if (lootTs >= newestTs) {
            return { price: history[0].p, source: 'history (newest)', sourceIcon: '📈' };
        }
        
        // If loot is older than all history, use oldest price
        if (lootTs <= oldestTs) {
            return { price: history[history.length - 1].p, source: 'history (oldest)', sourceIcon: '📜' };
        }
        
        // Find most recent entry BEFORE loot timestamp
        // History is newest-first, so find first entry where t <= lootTs
        let bestEntry = null;
        for (const entry of history) {
            if (entry.t <= lootTs) {
                bestEntry = entry;
                break; // First match is most recent before loot
            }
        }
        
        if (bestEntry) {
            // Format time diff for source label (how long before loot this price was)
            const diffHours = (lootTs - bestEntry.t) / 3600;
            const diffLabel = diffHours < 1 ? `${Math.round(diffHours * 60)}m` : 
                              diffHours < 24 ? `${diffHours.toFixed(1)}h` : 
                              `${(diffHours / 24).toFixed(1)}d`;
            
            return { price: bestEntry.p, source: `history (-${diffLabel})`, sourceIcon: '📈' };
        }
    }
    
    // 2. Fall back to cost to create (NO market bid fallback)
    // - Level 0: crafting cost with artisan tea (🔨)
    // - Level N: base item (history or craft) + enhancement mats/prots (🪄)
    const craftCost = calculateCostToCreate(itemHrid, level, lootTs, mode);
    if (craftCost > 0) {
        return { 
            price: craftCost, 
            source: level > 0 ? 'enhance cost' : 'craft cost', 
            sourceIcon: level > 0 ? '🪄' : '🔨' 
        };
    }
    
    return { price: 0, source: 'unknown', sourceIcon: '❓' };
}

/**
 * Calculate cost to create an item at a given level.
 * - Level 0: crafting recipe cost (materials with artisan tea)
 * - Level N: base item cost (from history or craft) + enhancement mats/prots (no artisan tea)
 * 
 * @param {string} itemHrid - Item path
 * @param {number} level - Enhancement level
 * @param {number} lootTs - Unix timestamp for historical price lookup
 * @param {string} mode - Price mode
 * @returns {number} Total cost to create
 */
function calculateCostToCreate(itemHrid, level, lootTs, mode = 'pessimistic') {
    if (level === 0) {
        // Crafting cost from recipe (with artisan tea)
        const craftMats = getCraftingMaterials(itemHrid, mode);
        return craftMats?.total || 0;
    }
    
    // Enhanced item: base item + enhancement costs from +0 to +level
    // Get base item cost - checks history first, falls back to craft cost
    const baseEstimate = estimatePrice(itemHrid, 0, lootTs, mode);
    const baseCost = baseEstimate.price;
    
    // Use calculator if available
    if (calculator && typeof calculator.calculateEnhancementCost === 'function') {
        try {
            const calcResult = calculator.calculateEnhancementCost(itemHrid, level, prices, mode);
            if (calcResult && calcResult.totalCost > 0) {
                // calcResult.totalCost includes base item, return as-is
                return calcResult.totalCost;
            }
        } catch (e) {
            console.warn('Failed to calculate enhancement cost:', e);
        }
    }
    
    // Fallback: rough estimate (base item only)
    return baseCost;
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
