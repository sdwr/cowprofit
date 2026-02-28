/**
 * main-v2.js - CowProfit with client-side calculations
 * Uses prices.js + game-data.js + enhance-calc.js
 */



// Data from loaded scripts
const prices = window.PRICES || {};
const gameData = window.GAME_DATA_STATIC || {};

// State
let calculator = null;
let currentLevel = 'all';
let sortCol = 9;
let sortAsc = false;
let showFee = true;
let expandedRows = new Set();
let costFilters = { '100m': true, '500m': true, '1b': true, '2b': true, 'over2b': true };
let allResults = [];

// Price category config
const PRICE_CONFIG_KEY = 'cowprofit_price_config';
let priceConfig = {
    matMode: 'pessimistic',
    protMode: 'pessimistic',
    sellMode: 'pessimistic',
};

function loadPriceConfig() {
    try {
        const saved = JSON.parse(localStorage.getItem(PRICE_CONFIG_KEY));
        if (saved) {
            priceConfig.matMode = saved.matMode || 'pessimistic';
            priceConfig.protMode = saved.protMode || 'pessimistic';
            priceConfig.sellMode = saved.sellMode || 'pessimistic';
        }
    } catch (e) {}
}

function savePriceConfig() {
    localStorage.setItem(PRICE_CONFIG_KEY, JSON.stringify(priceConfig));
}

// Legacy compat — currentMode returns sellMode for code that still reads it
let currentMode = 'pessimistic';
let gearOpen = false;
let historyOpen = false;
let lootHistoryOpen = false;

// Progressive recalc state
let recalcController = {
    runId: 0,
    inProgress: false,
    debounceTimer: null,
};

// Inventory data (set via event from userscript)
let inventoryData = null;

// Loot history (set via event from userscript)
let lootHistoryData = [];

// Mock data flag — cleared when real data arrives
let usingMockData = false;

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
    
    // Get materials for this item (use resolved prices if available)
    const materials = r._resolvedPrices ? getMaterialDetailsFromResolved(r) : getMaterialDetails(r.item_hrid, 1, 'pessimistic');
    
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
    // Real data replaces mock data immediately
    usingMockData = false;
    // Always use fresh data from userscript - it's the source of truth
    lootHistoryData = e.detail || [];
    // Sort by startTime descending (most recent first)
    lootHistoryData.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    console.log('[CowProfit v2] Loot sessions loaded:', lootHistoryData.map(s => 
        `${s.actionHrid?.split('/').pop()} @ ${s.startTime} (${s.actionCount} actions)`
    ).slice(0, 5));
    // Run migration if needed, then auto-group new sessions
    const validSessions = lootHistoryData.filter(s => {
        if (!s.actionHrid?.includes('enhance')) return false;
        const ep = calculateEnhanceSessionProfit(s);
        if (!ep) return false;
        const hours = (new Date(s.endTime) - new Date(s.startTime)) / 3600000;
        const overrides = getSessionOverrides();
        const override = overrides[s.startTime] || {};
        if (hours < 0.02 && !ep.isSuccessful && override.forceSuccess !== true) return false;
        return true;
    });
    migrateGroupState(validSessions.map(s => s.startTime));
    recomputeGroups(validSessions);

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
const SESSION_PRICES_KEY = 'cowprofit_session_prices';

function getSessionPricesCache() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_PRICES_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function saveSessionPricesCache(cache) {
    try {
        localStorage.setItem(SESSION_PRICES_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('[CowProfit] Failed to save session prices cache:', e);
    }
}

function cacheSessionPrices(sessionKey, priceData) {
    const cache = getSessionPricesCache();
    cache[sessionKey] = priceData;
    saveSessionPricesCache(cache);
}

function getCachedSessionPrices(sessionKey) {
    const cache = getSessionPricesCache();
    return cache[sessionKey] || null;
}

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
// MWI PRICE INCREMENT LOGIC (PRICE_TIERS defined in price-resolver.js)
// ============================================

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

// Legacy modeInfo kept for reference
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
    
    const savedGearConfig = loadGearConfig();
    calculator = new EnhanceCalculator(gameData, savedGearConfig);
    console.log(`[CowProfit v2] Calculator ready. ${Object.keys(gameData.items).length} items loaded.`);
    
    // Display version
    document.getElementById('version-tag').textContent = gameData.version + ' (v2)';
    
    // Load saved price config and sync buttons
    loadPriceConfig();
    syncPriceConfigButtons();
    
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
    
    const itemResolver = new ItemResolver(gameData);
    const priceResolver = new PriceResolver(gameData, typeof PRICE_TIERS !== 'undefined' ? PRICE_TIERS : []);
    const artisanMult = calculator.getArtisanTeaMultiplier();
    const modeConfig = { matMode: priceConfig.matMode, protMode: priceConfig.protMode, sellMode: priceConfig.sellMode };
    
    const results = [];
    let dbgSkips = { noShop: 0, noProt: 0, noSim: 0, noSell: 0 };
    
    for (const [hrid, item] of Object.entries(gameData.items)) {
        if (!item.enhancementCosts) continue;
        const name = item.name?.toLowerCase() || '';
        if (['cheese_', 'verdant_', 'wooden_', 'rough_'].some(s => name.includes(s))) continue;
        
        for (const target of TARGET_LEVELS) {
            const shopping = itemResolver.resolve(hrid, target);
            if (!shopping) { dbgSkips.noShop++; continue; }
            
            const resolved = priceResolver.resolve(shopping, prices.market, modeConfig, artisanMult);
            if (resolved.protectPrice <= 0 && resolved.protectHrid === null) { dbgSkips.noProt++; continue; }
            
            const sim = calculator.simulate(resolved, target, shopping.itemLevel);
            if (!sim) { dbgSkips.noSim++; continue; }
            
            // Build sell price and profit like legacy calculateProfit
            const sellPrice = resolved.sellPrice;
            if (sellPrice <= 0) { dbgSkips.noSell++; continue; }
            
            const marketFee = sellPrice * 0.02;
            const profit = sellPrice - sim.totalCost;
            const profitAfterFee = profit - marketFee;
            const matCost = sim.matCost;
            const roi = matCost > 0 ? (profit / matCost) * 100 : 0;
            const roiAfterFee = matCost > 0 ? (profitAfterFee / matCost) * 100 : 0;
            const totalTimeHours = sim.actions * sim.attemptTime / 3600;
            const totalTimeDays = totalTimeHours / 24;
            const profitPerDay = totalTimeDays > 0 ? profit / totalTimeDays : 0;
            const profitPerDayAfterFee = totalTimeDays > 0 ? profitAfterFee / totalTimeDays : 0;
            const xpPerDay = totalTimeDays > 0 ? sim.totalXp / totalTimeDays : 0;
            
            if (roi >= MAX_ROI) continue;
            
            results.push({
                item_name: item.name,
                item_hrid: hrid,
                target_level: target,
                itemHrid: hrid,
                targetLevel: target,
                basePrice: sim.basePrice,
                baseSource: sim.baseSource,
                matCost,
                totalCost: sim.totalCost,
                sellPrice,
                marketFee,
                profit,
                profitAfterFee,
                roi,
                roiAfterFee,
                profitPerDay,
                profitPerDayAfterFee,
                xpPerDay,
                totalXp: sim.totalXp,
                actions: sim.actions,
                timeHours: totalTimeHours,
                timeDays: totalTimeDays,
                protectCount: sim.protectCount,
                protectAt: sim.protectAt,
                protectHrid: sim.protectHrid,
                protectPrice: sim.protectPrice,
                // Store resolved price details for dot rendering
                _resolvedPrices: resolved,
            });
        }
    }
    
    results.sort((a, b) => b.profit - a.profit);
    allResults = results;
    
    const elapsed = performance.now() - startTime;
    console.log(`[CowProfit v2] Calculated ${results.length} items in ${elapsed.toFixed(0)}ms`, dbgSkips);
}

// Build the list of enhanceable items (cached for chunked recalc)
let _enhanceableItems = null;
function getEnhanceableItems() {
    if (_enhanceableItems) return _enhanceableItems;
    _enhanceableItems = [];
    for (const [hrid, item] of Object.entries(gameData.items)) {
        if (!item.enhancementCosts) continue;
        const name = item.name?.toLowerCase() || '';
        if (['cheese_', 'verdant_', 'wooden_', 'rough_'].some(s => name.includes(s))) continue;
        _enhanceableItems.push({ hrid, item });
    }
    return _enhanceableItems;
}

// Async chunked version for gear/mode changes
async function calculateAllProfitsAsync(runId, onChunkDone) {
    const CHUNK_SIZE = 30;
    const items = getEnhanceableItems();
    const itemResolver = new ItemResolver(gameData);
    const priceResolver = new PriceResolver(gameData, typeof PRICE_TIERS !== 'undefined' ? PRICE_TIERS : []);
    const artisanMult = calculator.getArtisanTeaMultiplier();
    const modeConfig = { matMode: priceConfig.matMode, protMode: priceConfig.protMode, sellMode: priceConfig.sellMode };
    const tempResults = [];
    
    for (let ci = 0; ci < items.length; ci += CHUNK_SIZE) {
        if (recalcController.runId !== runId) {
            console.log(`[CowProfit] Recalc ${runId} aborted`);
            return null;
        }
        
        const chunk = items.slice(ci, ci + CHUNK_SIZE);
        
        for (const { hrid, item } of chunk) {
            for (const target of TARGET_LEVELS) {
                const shopping = itemResolver.resolve(hrid, target);
                if (!shopping) continue;
                
                const resolved = priceResolver.resolve(shopping, prices.market, modeConfig, artisanMult);
                if (resolved.protectPrice <= 0 && resolved.protectHrid === null) continue;
                
                const sim = calculator.simulate(resolved, target, shopping.itemLevel);
                if (!sim) continue;
                
                const sellPrice = resolved.sellPrice;
                if (sellPrice <= 0) continue;
                
                const marketFee = sellPrice * 0.02;
                const profit = sellPrice - sim.totalCost;
                const profitAfterFee = profit - marketFee;
                const matCost = sim.matCost;
                const roi = matCost > 0 ? (profit / matCost) * 100 : 0;
                const roiAfterFee = matCost > 0 ? (profitAfterFee / matCost) * 100 : 0;
                const totalTimeHours = sim.actions * sim.attemptTime / 3600;
                const totalTimeDays = totalTimeHours / 24;
                const profitPerDay = totalTimeDays > 0 ? profit / totalTimeDays : 0;
                const profitPerDayAfterFee = totalTimeDays > 0 ? profitAfterFee / totalTimeDays : 0;
                const xpPerDay = totalTimeDays > 0 ? sim.totalXp / totalTimeDays : 0;
                
                if (roi >= MAX_ROI) continue;
                
                tempResults.push({
                    item_name: item.name,
                    item_hrid: hrid,
                    target_level: target,
                    itemHrid: hrid,
                    targetLevel: target,
                    basePrice: sim.basePrice,
                    baseSource: sim.baseSource,
                    matCost,
                    totalCost: sim.totalCost,
                    sellPrice,
                    marketFee,
                    profit,
                    profitAfterFee,
                    roi,
                    roiAfterFee,
                    profitPerDay,
                    profitPerDayAfterFee,
                    xpPerDay,
                    totalXp: sim.totalXp,
                    actions: sim.actions,
                    timeHours: totalTimeHours,
                    timeDays: totalTimeDays,
                    protectCount: sim.protectCount,
                    protectAt: sim.protectAt,
                    protectHrid: sim.protectHrid,
                    protectPrice: sim.protectPrice,
                    _resolvedPrices: resolved,
                });
            }
        }
        
        if (onChunkDone) onChunkDone(ci + chunk.length, items.length);
        await new Promise(r => setTimeout(r, 0));
    }
    
    if (recalcController.runId !== runId) return null;
    
    tempResults.sort((a, b) => b.profit - a.profit);
    return tempResults;
}

// Apply skeleton loading state to dependent cells
function applySkeletonState() {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;
    // Columns that depend on gear: enhance cost(4), total cost(5), sell price stays, profit(7), roi(8), $/day(9), time(10), xp/day(11)
    // Actually base price doesn't change, sell price doesn't change. Dependent: matCost, totalCost, profit, roi, $/day, time, xp/day
    const skeletonCols = [4, 5, 7, 8, 9, 10, 11]; // 0-indexed td positions
    const rows = tbody.querySelectorAll('tr.data-row');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        skeletonCols.forEach(ci => {
            if (cells[ci]) cells[ci].classList.add('cell-loading');
        });
    });
}

// Remove skeleton state from all cells
function removeSkeletonState() {
    document.querySelectorAll('.cell-loading').forEach(el => el.classList.remove('cell-loading'));
}

// FLIP sort animation
function flipSortAnimation(tbody) {
    const rows = Array.from(tbody.querySelectorAll('tr.data-row'));
    if (rows.length === 0) return;
    
    // FIRST: record current positions
    const firstRects = new Map();
    rows.forEach(row => {
        firstRects.set(row, row.getBoundingClientRect());
    });
    
    // LAST: re-render table (caller does this), then read new positions
    // This function is called AFTER innerHTML is set, so we read new positions
    const newRows = Array.from(tbody.querySelectorAll('tr.data-row'));
    
    newRows.forEach(row => {
        const rowId = row.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (!rowId) return;
        
        // Find matching old row by rowId
        const oldRow = rows.find(r => {
            const oid = r.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
            return oid === rowId;
        });
        if (!oldRow || !firstRects.has(oldRow)) return;
        
        const first = firstRects.get(oldRow);
        const last = row.getBoundingClientRect();
        const deltaY = first.top - last.top;
        
        if (Math.abs(deltaY) < 1) return;
        
        // INVERT
        row.style.transform = `translateY(${deltaY}px)`;
        row.style.transition = 'none';
        
        // PLAY
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                row.classList.add('flip-animate');
                row.style.transform = '';
                row.addEventListener('transitionend', () => {
                    row.classList.remove('flip-animate');
                    row.style.transition = '';
                }, { once: true });
            });
        });
    });
}

// Debounced async gear change handler
async function onGearChangeAsync() {
    const c = readGearFromInputs();
    saveGearConfig(c);
    calculator = new EnhanceCalculator(gameData, c);
    updateGearComputedStats();
    
    // Abort any in-flight recalc
    const runId = ++recalcController.runId;
    recalcController.inProgress = true;
    
    // Apply skeleton state to current rows
    applySkeletonState();
    
    const result = await calculateAllProfitsAsync(runId, (done, total) => {
        // Could update a progress indicator here
    });
    
    if (!result) return; // Aborted
    
    // Capture pre-sort positions
    const tbody = document.getElementById('table-body');
    const oldRows = Array.from(tbody.querySelectorAll('tr.data-row'));
    const firstRects = new Map();
    oldRows.forEach(row => {
        const rowId = row.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (rowId) firstRects.set(rowId, row.getBoundingClientRect());
    });
    
    // Apply results and re-render
    allResults = result;
    renderTable();
    
    // FLIP animation
    const newRows = Array.from(tbody.querySelectorAll('tr.data-row'));
    newRows.forEach(row => {
        const rowId = row.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (!rowId || !firstRects.has(rowId)) return;
        
        const first = firstRects.get(rowId);
        const last = row.getBoundingClientRect();
        const deltaY = first.top - last.top;
        
        if (Math.abs(deltaY) < 1) return;
        
        row.style.transform = `translateY(${deltaY}px)`;
        row.style.transition = 'none';
        
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                row.classList.add('flip-animate');
                row.style.transform = '';
                row.addEventListener('transitionend', () => {
                    row.classList.remove('flip-animate');
                    row.style.transition = '';
                }, { once: true });
            });
        });
    });
    
    recalcController.inProgress = false;
    if (lootHistoryOpen) renderLootHistoryPanel();
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
    const checkEl = document.getElementById('time-check');
    const marketEl = document.getElementById('time-market');
    checkEl.textContent = formatTimeAgo(prices.generated);
    marketEl.textContent = formatTimeAgo(prices.ts);
    
    // Stale data warning — yellow highlight on "Last check" if > 1 hour ago
    const now = Math.floor(Date.now() / 1000);
    const age = now - (prices.generated || 0);
    if (age > 3600) {
        checkEl.style.cssText = 'color:#ffcc00;background:#553300;padding:1px 6px;border-radius:4px;';
        checkEl.title = 'Ctrl+F5 to refresh price data';
        // Add inline hint if not already there
        if (!checkEl.dataset.stale) {
            checkEl.dataset.stale = '1';
            const hint = document.createElement('span');
            hint.className = 'stale-hint';
            hint.style.cssText = 'color:#ffcc00;font-size:0.65rem;margin-left:4px;';
            hint.textContent = '(Ctrl+F5)';
            checkEl.parentNode.insertBefore(hint, checkEl.nextSibling);
        }
    } else {
        checkEl.style.cssText = '';
        checkEl.title = '';
        if (checkEl.dataset.stale) {
            delete checkEl.dataset.stale;
            const hint = checkEl.parentNode.querySelector('.stale-hint');
            if (hint) hint.remove();
        }
    }
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
    
    for (const entryData of Object.values(historyData)) {
        // Handle both old format (flat array) and new format ({b: [...], a: [...]})
        const lists = Array.isArray(entryData) 
            ? [entryData] 
            : [entryData.b || [], entryData.a || []];
        for (const list of lists) {
            for (const e of list) {
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

// ============================================
// GEAR CONFIG MANAGEMENT
// ============================================

const GEAR_CONFIG_KEY = 'cowprofit_gear_config';

function loadGearConfig() {
    try {
        const saved = JSON.parse(localStorage.getItem(GEAR_CONFIG_KEY));
        if (saved) return { ...DEFAULT_CONFIG, ...saved };
    } catch (e) {}
    return { ...DEFAULT_CONFIG };
}

function saveGearConfig(config) {
    try {
        localStorage.setItem(GEAR_CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
        console.warn('[CowProfit] Failed to save gear config:', e);
    }
}

function onGearChange() {
    // Debounce: 150ms
    clearTimeout(recalcController.debounceTimer);
    recalcController.debounceTimer = setTimeout(() => {
        onGearChangeAsync();
    }, 150);
}

function readGearFromInputs() {
    const val = (id, fallback) => {
        const el = document.getElementById(id);
        return el ? (parseInt(el.value) || fallback) : fallback;
    };
    const checked = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    };
    const selVal = (id, fallback) => {
        const el = document.getElementById(id);
        return el ? el.value : fallback;
    };

    // Enhancing tea radio
    const teaRadio = document.querySelector('input[name="gear-enh-tea"]:checked');
    const teaVal = teaRadio ? teaRadio.value : 'none';

    return {
        enhancingLevel: val('gear-enhancing-level', 125),
        observatoryLevel: val('gear-observatory', 8),
        enhancer: selVal('gear-enhancer', 'celestial_enhancer'),
        enhancerLevel: val('gear-enhancer-level', 14),
        achievementSuccessBonus: checked('gear-achievement') ? 0.2 : 0,
        enchantedGlovesLevel: val('gear-gloves', 10),
        enchantedGlovesEquipped: checked('gear-gloves-on'),
        enhancerTopLevel: val('gear-top', 8),
        enhancerTopEquipped: checked('gear-top-on'),
        enhancerBotLevel: val('gear-bot', 8),
        enhancerBotEquipped: checked('gear-bot-on'),
        philoNeckLevel: val('gear-neck', 7),
        philoNeckEquipped: checked('gear-neck-on'),
        guzzlingPouchLevel: val('gear-guzzling', 8),
        guzzlingPouchEquipped: checked('gear-guzzling-on'),
        teaEnhancing: teaVal === 'enhancing',
        teaSuperEnhancing: teaVal === 'super',
        teaUltraEnhancing: teaVal === 'ultra',
        teaBlessed: checked('gear-tea-blessed'),
        teaWisdom: checked('gear-tea-wisdom'),
        artisanTea: checked('gear-tea-artisan'),
        charmTier: selVal('gear-charm-tier', 'advanced'),
        charmLevel: val('gear-charm-level', 6),
        // Global buffs (0 = disabled)
        enhancingBuffLevel: checked('gear-enhancing-buff-on') ? val('gear-enhancing-buff-level', 20) : 0,
        experienceBuffLevel: checked('gear-experience-buff-on') ? val('gear-experience-buff-level', 20) : 0,
    };
}

let gearPanelRendered = false;

function renderGearPanel() {
    if (!calculator) {
        document.getElementById('gear-panel').innerHTML = '<div style="padding:10px;color:#888;">Calculator not loaded</div>';
        return;
    }
    
    if (gearPanelRendered) {
        updateGearComputedStats();
        return;
    }
    gearPanelRendered = true;

    const c = calculator.config;
    const enhancerTypes = [
        ['cheese_enhancer', 'Cheese'],
        ['verdant_enhancer', 'Verdant'],
        ['azure_enhancer', 'Azure'],
        ['burble_enhancer', 'Burble'],
        ['crimson_enhancer', 'Crimson'],
        ['rainbow_enhancer', 'Rainbow'],
        ['holy_enhancer', 'Holy'],
        ['celestial_enhancer', 'Celestial'],
    ];
    const charmTiers = ['none', 'trainee', 'basic', 'advanced', 'expert', 'master', 'grandmaster'];
    const enhTeaVal = c.teaUltraEnhancing ? 'ultra' : c.teaSuperEnhancing ? 'super' : c.teaEnhancing ? 'enhancing' : 'none';

    const numInput = (id, value, min, max) =>
        `<input type="number" class="gear-input" id="${id}" value="${value}" min="${min}" max="${max}">`;
    
    const selectOpts = (id, options, selected) =>
        `<select class="gear-select" id="${id}">${options.map(([v, l]) =>
            `<option value="${v}"${v === selected ? ' selected' : ''}>${l}</option>`
        ).join('')}</select>`;

    const checkbox = (id, label, checked) =>
        `<label style="font-size:0.72rem;color:#aaa;cursor:pointer;display:flex;align-items:center;gap:3px;">
            <input type="checkbox" class="gear-check" id="${id}"${checked ? ' checked' : ''}>${label}</label>`;

    const radio = (name, value, label, checked) =>
        `<label><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}><span>${label}</span></label>`;

    document.getElementById('gear-panel').innerHTML = `
        <div class="gear-section">
            <h5>🎯 Enhancing</h5>
            <div class="gear-row"><span class="label">Level</span>${numInput('gear-enhancing-level', c.enhancingLevel, 1, 200)}</div>
            <div class="gear-row"><span class="label">Observatory</span>${numInput('gear-observatory', c.observatoryLevel, 0, 8)}</div>
        </div>
        <div class="gear-section">
            <h5>🔧 Tool & Success</h5>
            <div class="gear-row"><span class="label">Enhancer</span>${selectOpts('gear-enhancer', enhancerTypes, c.enhancer)}</div>
            <div class="gear-row"><span class="label">Tool Level</span>${numInput('gear-enhancer-level', c.enhancerLevel, 0, 20)}</div>
            <div class="gear-row">${checkbox('gear-achievement', 'Achievement (0.2%)', c.achievementSuccessBonus > 0)}</div>
        </div>
        <div class="gear-section">
            <h5>⚡ Gear</h5>
            <div class="gear-row"><input type="checkbox" class="gear-check" id="gear-gloves-on"${c.enchantedGlovesEquipped !== false ? ' checked' : ''}><span class="label">Gloves</span>${numInput('gear-gloves', c.enchantedGlovesLevel, 0, 20)}</div>
            <div class="gear-row"><input type="checkbox" class="gear-check" id="gear-top-on"${c.enhancerTopEquipped !== false ? ' checked' : ''}><span class="label">Top</span>${numInput('gear-top', c.enhancerTopLevel, 0, 20)}</div>
            <div class="gear-row"><input type="checkbox" class="gear-check" id="gear-bot-on"${c.enhancerBotEquipped !== false ? ' checked' : ''}><span class="label">Bottoms</span>${numInput('gear-bot', c.enhancerBotLevel, 0, 20)}</div>
            <div class="gear-row"><input type="checkbox" class="gear-check" id="gear-neck-on"${c.philoNeckEquipped !== false ? ' checked' : ''}><span class="label">Neck</span>${numInput('gear-neck', c.philoNeckLevel, 0, 20)}</div>
            <div class="gear-row"><input type="checkbox" class="gear-check" id="gear-guzzling-on"${c.guzzlingPouchEquipped !== false ? ' checked' : ''}><span class="label">Guzzling</span>${numInput('gear-guzzling', c.guzzlingPouchLevel, 0, 20)}</div>
        </div>
        <div class="gear-section">
            <h5>🍵 Teas</h5>
            <div class="gear-row"><span class="label">Enhancing</span>
                <div class="gear-radio-group">
                    ${radio('gear-enh-tea', 'none', 'None', enhTeaVal === 'none')}
                    ${radio('gear-enh-tea', 'enhancing', 'Enh', enhTeaVal === 'enhancing')}
                    ${radio('gear-enh-tea', 'super', 'Super', enhTeaVal === 'super')}
                    ${radio('gear-enh-tea', 'ultra', 'Ultra', enhTeaVal === 'ultra')}
                </div>
            </div>
            <div class="gear-row">${checkbox('gear-tea-blessed', 'Blessed Tea', c.teaBlessed)}</div>
            <div class="gear-row">${checkbox('gear-tea-wisdom', 'Wisdom Tea', c.teaWisdom)}</div>
            <div class="gear-row">${checkbox('gear-tea-artisan', 'Artisan Tea', c.artisanTea)}</div>
        </div>
        <div class="gear-section">
            <h5>💎 Charm</h5>
            <div class="gear-row"><span class="label">Tier</span>${selectOpts('gear-charm-tier', charmTiers.map(t => [t, t.charAt(0).toUpperCase() + t.slice(1)]), c.charmTier)}</div>
            <div class="gear-row"><span class="label">Level</span>${numInput('gear-charm-level', c.charmLevel, 0, 20)}</div>
        </div>
        <div class="gear-section">
            <h5>📈 Global Buffs</h5>
            <div class="gear-row"><input type="checkbox" class="gear-check" id="gear-enhancing-buff-on"${c.enhancingBuffLevel ? ' checked' : ''}><span class="label">Enhancing</span>${numInput('gear-enhancing-buff-level', c.enhancingBuffLevel || 20, 1, 20)}</div>
            <div class="gear-row"><input type="checkbox" class="gear-check" id="gear-experience-buff-on"${c.experienceBuffLevel ? ' checked' : ''}><span class="label">Experience</span>${numInput('gear-experience-buff-level', c.experienceBuffLevel || 20, 1, 20)}</div>
        </div>
    `;

    // Attach change listeners
    document.getElementById('gear-panel').addEventListener('input', onGearChange);
    document.getElementById('gear-panel').addEventListener('change', onGearChange);
    
    // Disable level inputs when gear unchecked
    const gearToggles = [
        ['gear-gloves-on', 'gear-gloves'],
        ['gear-top-on', 'gear-top'],
        ['gear-bot-on', 'gear-bot'],
        ['gear-neck-on', 'gear-neck'],
        ['gear-guzzling-on', 'gear-guzzling'],
        ['gear-enhancing-buff-on', 'gear-enhancing-buff-level'],
        ['gear-experience-buff-on', 'gear-experience-buff-level'],
    ];
    for (const [cbId, inputId] of gearToggles) {
        const cb = document.getElementById(cbId);
        const inp = document.getElementById(inputId);
        if (cb && inp) {
            inp.disabled = !cb.checked;
            cb.addEventListener('change', () => { inp.disabled = !cb.checked; });
        }
    }

    updateGearComputedStats();
}

function updateGearComputedStats() {
    if (!calculator) return;
    const effLevel = calculator.getEffectiveLevel();
    const enhBonus = calculator.getEnhancerBonus();
    const guzzling = calculator.getGuzzlingBonus();
    const artisanMult = calculator.getArtisanTeaMultiplier();

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
        const state = JSON.parse(localStorage.getItem('cowprofit_session_groups') || '{}');
        if (!state.groups) state.groups = {};
        if (!state.seen) state.seen = {};
        return state;
    } catch { return { groups: {}, seen: {}, version: 2 }; }
}

function saveGroupState(state) {
    localStorage.setItem('cowprofit_session_groups', JSON.stringify(state));
}

// Migration: convert old manualUngroups format to new seen model
function migrateGroupState(allSessionKeys) {
    const state = getGroupState();
    if (state.version === 2) return false; // already migrated

    // Old schema had manualUngroups — convert to seen model
    console.log('[CowProfit] Migrating group state to v2...');
    state.seen = {};
    // Mark ALL existing sessions as seen
    for (const key of allSessionKeys) {
        state.seen[key] = true;
    }
    // Also mark all grouped session keys as seen
    for (const memberKeys of Object.values(state.groups || {})) {
        if (Array.isArray(memberKeys)) {
            for (const k of memberKeys) state.seen[k] = true;
        }
    }
    delete state.manualUngroups;
    state.version = 2;
    saveGroupState(state);
    console.log('[CowProfit] Migration complete. Marked', Object.keys(state.seen).length, 'sessions as seen.');
    return true;
}

// Find group containing a session key. Returns { groupId, members } or null
function findGroupContaining(sessionKey, groups) {
    for (const [groupId, members] of Object.entries(groups)) {
        if (members.includes(sessionKey)) return { groupId, members };
    }
    return null;
}

// Check if a session is successful (considering overrides)
function isSessionSuccess(sessionKey) {
    const overrides = getSessionOverrides();
    const override = overrides[sessionKey] || {};
    if (override.forceSuccess !== undefined) return override.forceSuccess;
    const session = lootHistoryData.find(s => s.startTime === sessionKey);
    if (!session) return false;
    const ep = calculateEnhanceSessionProfit(session);
    return ep?.isSuccessful || false;
}

// Get item name for a session key
function getSessionItemName(sessionKey) {
    const session = lootHistoryData.find(s => s.startTime === sessionKey);
    if (!session) return null;
    const ep = calculateEnhanceSessionProfit(session);
    return ep?.itemName || null;
}

// Auto-group only NEW (unseen) sessions. Called on import only.
function recomputeGroups(sessions) {
    const state = getGroupState();

    // 1. Clean stale groups (remove missing session keys, dissolve <2)
    const validSessionKeys = new Set(sessions.map(s => s.startTime));
    for (const [groupId, members] of Object.entries(state.groups)) {
        const valid = members.filter(k => validSessionKeys.has(k));
        if (valid.length < 2) {
            delete state.groups[groupId];
        } else if (valid.length !== members.length) {
            // Re-key if last member changed
            delete state.groups[groupId];
            const newKey = valid[valid.length - 1];
            state.groups[newKey] = valid;
        }
    }

    // 2. Collect all currently grouped keys
    const groupedKeys = new Set();
    for (const members of Object.values(state.groups)) {
        for (const k of members) groupedKeys.add(k);
    }

    // 3. Identify new (unseen) sessions that produce valid enhance data
    const newSessions = sessions.filter(s => !state.seen[s.startTime]);
    if (newSessions.length === 0) {
        // Clean seen set
        for (const key of Object.keys(state.seen)) {
            if (!validSessionKeys.has(key)) delete state.seen[key];
        }
        saveGroupState(state);
        return state.groups;
    }

    console.log('[CowProfit] Auto-grouping', newSessions.length, 'new sessions');

    // Sort new sessions chronologically (oldest first)
    newSessions.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    // Build item→sessions map for new sessions
    const newByItem = {};
    for (const s of newSessions) {
        const ep = calculateEnhanceSessionProfit(s);
        if (!ep) continue;
        const itemName = ep.itemName || 'Unknown';
        if (!newByItem[itemName]) newByItem[itemName] = [];
        newByItem[itemName].push(s);
    }

    // 4. Try inserting new sessions into existing group edges
    const insertedKeys = new Set();
    for (const [itemName, itemNewSessions] of Object.entries(newByItem)) {
        for (const s of itemNewSessions) {
            const key = s.startTime;
            const sIsSuccess = isSessionSuccess(key);

            // Find existing groups for this item
            for (const [groupId, members] of Object.entries(state.groups)) {
                const groupItemName = getSessionItemName(members[0]);
                if (groupItemName !== itemName) continue;

                const lastMember = members[members.length - 1];
                const firstMember = members[0];
                const lastIsSuccess = isSessionSuccess(lastMember);
                const groupHasSuccess = members.some(k => isSessionSuccess(k));

                // Can append after last member?
                if (new Date(key) > new Date(lastMember) && !lastIsSuccess) {
                    // Can't add if both are success, or if group already has success and this is success
                    if (sIsSuccess && groupHasSuccess) continue;
                    members.push(key);
                    // Re-key group
                    delete state.groups[groupId];
                    state.groups[key] = members;
                    insertedKeys.add(key);
                    break;
                }

                // Can prepend before first member?
                if (new Date(key) < new Date(firstMember) && !sIsSuccess) {
                    members.unshift(key);
                    // Group ID stays the same (last member unchanged)
                    insertedKeys.add(key);
                    break;
                }
            }
        }
    }

    // 5. Group remaining new sessions per item, chronologically
    for (const [itemName, itemNewSessions] of Object.entries(newByItem)) {
        const remaining = itemNewSessions.filter(s => !insertedKeys.has(s.startTime));
        if (remaining.length === 0) continue;

        let currentRun = [];
        for (const s of remaining) {
            const key = s.startTime;
            const sIsSuccess = isSessionSuccess(key);

            currentRun.push(key);

            if (sIsSuccess) {
                if (currentRun.length > 1) {
                    const gid = currentRun[currentRun.length - 1];
                    state.groups[gid] = [...currentRun];
                }
                currentRun = [];
            }
        }
        // Remaining failures form an in-progress group
        if (currentRun.length > 1) {
            const gid = currentRun[currentRun.length - 1];
            state.groups[gid] = [...currentRun];
        }
    }

    // 6. Mark ALL new sessions as seen
    for (const s of newSessions) {
        state.seen[s.startTime] = true;
    }

    // 7. Clean seen set (remove deleted session keys)
    for (const key of Object.keys(state.seen)) {
        if (!validSessionKeys.has(key)) delete state.seen[key];
    }

    saveGroupState(state);
    return state.groups;
}

// Edge-only ungroup
function ungroupSession(sessionKey, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const state = getGroupState();
    const found = findGroupContaining(sessionKey, state.groups);
    if (!found) return;

    const { groupId, members } = found;
    const idx = members.indexOf(sessionKey);

    // Must be first or last
    if (idx !== 0 && idx !== members.length - 1) return;

    if (members.length === 2) {
        // Dissolve: both become standalone (both already in seen)
        delete state.groups[groupId];
    } else if (idx === 0) {
        // Remove bottom (oldest)
        members.splice(0, 1);
        // groupId unchanged (still keyed by last member)
    } else {
        // Remove top (newest) — need to re-key
        members.splice(idx, 1);
        delete state.groups[groupId];
        const newKey = members[members.length - 1];
        state.groups[newKey] = members;
    }

    // Session stays in seen — manual only going forward
    saveGroupState(state);
    renderLootHistoryPanel();
}

// Manual group via handles
function manualGroupSession(sessionKey, targetKey, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const state = getGroupState();

    const sourceGroup = findGroupContaining(sessionKey, state.groups);
    const targetGroup = findGroupContaining(targetKey, state.groups);

    if (sourceGroup && targetGroup && sourceGroup.groupId === targetGroup.groupId) return; // same group

    let newMembers;
    if (sourceGroup && targetGroup) {
        // Merge two groups
        newMembers = [...sourceGroup.members, ...targetGroup.members];
        delete state.groups[sourceGroup.groupId];
        delete state.groups[targetGroup.groupId];
    } else if (targetGroup) {
        // Attach session to target group edge
        newMembers = [...targetGroup.members, sessionKey];
        delete state.groups[targetGroup.groupId];
    } else if (sourceGroup) {
        // Attach target to source group edge
        newMembers = [...sourceGroup.members, targetKey];
        delete state.groups[sourceGroup.groupId];
    } else {
        // Both standalone → new 2-member group
        newMembers = [sessionKey, targetKey];
    }

    // Sort chronologically, re-key by last member
    newMembers.sort((a, b) => new Date(a) - new Date(b));
    // Deduplicate
    newMembers = [...new Set(newMembers)];
    const newKey = newMembers[newMembers.length - 1];
    state.groups[newKey] = newMembers;

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

function computeSessionDisplay(session, finalLevelOverride) {
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
    // estimatedSale is now pre-calculated for ALL sessions (success and failure)
    let salePrice = 0;
    let estimatedSale = enhanceProfit.estimatedSale || 0;
    let estimatedSource = enhanceProfit.estimatedSaleSource || null;
    let estimatedSourceIcon = enhanceProfit.estimatedSaleSourceIcon || null;

    if (isSuccess) {
        if (override.customSale !== undefined && override.customSale !== null) {
            salePrice = override.customSale;
        } else {
            salePrice = getValidPrice(estimatedSale);
        }
    }

    // Tea cost calculation — use cached/historical tea prices from enhanceProfit
    const guzzlingBonus = calculator?.getGuzzlingBonus() || 1.1216;
    const teaDurationSec = 300 / guzzlingBonus;
    const sessionDurationSec = hours * 3600;
    const teaUses = sessionDurationSec / teaDurationSec;

    const sessionTeaPrices = enhanceProfit.teaPrices || {};
    const ultraEnhancingPrice = sessionTeaPrices.ultraEnhancing || 0;
    const blessedPrice = sessionTeaPrices.blessed || 0;
    const wisdomPrice = sessionTeaPrices.wisdom || 0;
    const teaCostPerUse = ultraEnhancingPrice + blessedPrice + wisdomPrice;
    const totalTeaCost = teaUses * teaCostPerUse;

    // Recalculate prot cost for failures with correct final level
    // When chained (finalLevelOverride provided), use it instead of guessing 0
    // Success sessions keep original prot cost (finalLevel=maxLevel is correct)
    let adjustedProtCost = enhanceProfit.totalProtCost;
    let adjustedProtsUsed = enhanceProfit.protsUsed;
    if (!isSuccess && enhanceProfit.levelDrops) {
        const effectiveFinalLevel = finalLevelOverride !== undefined ? finalLevelOverride : 0;
        const protResult = calculateProtectionFromDrops(
            enhanceProfit.levelDrops, enhanceProfit.protLevel || 8,
            enhanceProfit.currentLevel || 0, effectiveFinalLevel
        );
        adjustedProtsUsed = protResult.protCount;
        adjustedProtCost = adjustedProtsUsed * (enhanceProfit.protPrice || 0);
    }

    // Calculate fee (2%) and profit
    const fee = Math.floor(salePrice * 0.02);
    const netSale = salePrice - fee;
    const failureCost = enhanceProfit.totalMatCost + adjustedProtCost + totalTeaCost;

    // baseItemCost is now pre-calculated for ALL sessions
    let baseItemCost = enhanceProfit.baseItemCost || 0;
    const successCost = enhanceProfit.totalMatCost + enhanceProfit.totalProtCost + baseItemCost + totalTeaCost; // success uses original prot (finalLevel=max)
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
        hashMismatch,
        adjustedProtsUsed,
        adjustedProtCost
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

    const displayProts = d.adjustedProtsUsed !== undefined ? d.adjustedProtsUsed : ep.protsUsed;
    const displayProtCost = d.adjustedProtCost !== undefined ? d.adjustedProtCost : ep.totalProtCost;

    const detailsHtml = `<div class="loot-details">
        <span class="loot-duration">${d.duration}</span>
        <span class="loot-actions">${ep.actionCount} actions</span>
        <span class="loot-prots">${displayProts} prots @${protAtLevel}</span>
    </div>`;

    // Build tooltips from PriceBundle
    const pb = ep.priceBundle;
    const matItems = pb ? Object.entries(pb.mats).map(([h, d]) => ({...d, name: h.split('/').pop().replace(/_/g,' ')})) : [];
    const matTip = _multiPriceTip(matItems);
    const protHrid = pb?.prot?.hrid;
    const protName = protHrid ? (gameData.items[protHrid]?.name || protHrid.split('/').pop().replace(/_/g,' ')) : 'prot';
    const protTip = pb && pb.prot.source ? _priceTip({...pb.prot, name: protName}) : (protName ? protName : '');
    const baseName = ep.itemName || 'base';
    const baseTip = pb ? (pb.baseItem._craftTip 
        ? `${_shortName(baseName, 12)} ${formatCoins(pb.baseItem.price)} craft${pb.baseItem.fallback ? ' ⚠️' : ''}&#10;${pb.baseItem._craftTip}`
        : _priceTip({...pb.baseItem, name: baseName})) : '';
    
    let matCostStr = ep.matPriceMissing ? '⚠️ no price' : (ep.totalMatCost > 0 ? formatCoins(ep.totalMatCost) : '-');
    let protStr = '-';
    if (displayProts > 0) {
        protStr = ep.protPriceMissing
            ? `⚠️ (${displayProts}×)`
            : `${formatCoins(displayProtCost)} (${displayProts} × ${formatCoins(ep.protPrice)})`;
    }
    const teaStr = d.totalTeaCost > 0 ? formatCoins(d.totalTeaCost) : '-';

    let costsHtml = `<div class="loot-costs">
        <span class="price-tip" data-tip="${matTip}">Mats: ${matCostStr}</span>
        <span class="price-tip" data-tip="${protTip}">Prot: ${protStr}</span>
        <span class="price-tip" data-tip="${pb ? _multiPriceTip([{...pb.teas.ultra, name:'ultra'}, {...pb.teas.blessed, name:'blessed'}, {...pb.teas.wisdom, name:'wisdom'}]) : ''}">Teas: ${teaStr}</span>
        ${d.isSuccess && !isSubCard ? `<span class="price-tip" data-tip="${baseTip}">Base: ${ep.baseItemSourceIcon || ''} ${formatCoins(d.baseItemCost)}</span>` : ''}
    </div>`;

    let saleHtml = '';
    if (d.isSuccess && !isSubCard) {
        const estIcon = d.estimatedSourceIcon || '';
        const estSaleStr = (d.estimatedSale > 0 && d.estimatedSource)
            ? `${estIcon} ${formatCoins(d.estimatedSale)}` : '⚠️ no price';
        const saleFormatted = d.salePrice > 0 ? formatCoins(d.salePrice) : '0';
        const feeStr = d.fee > 0 ? `-${formatCoins(d.fee)}` : '-';
        const estTip = pb ? _priceTip(pb.estimatedSale, {showPrice: true}) : '';
        const revTip = pb ? _priceTip(pb.sellRevenue, {showPrice: true}) : '';

        saleHtml = `<div class="loot-sale">
            <span class="price-tip" data-tip="${estTip}">Est: ${estSaleStr}</span>
            <span class="price-tip" data-tip="${revTip}">Sale:</span> <span class="sale-input-group">
                <button class="sale-btn sale-down" data-session="${d.sessionKey}" data-dir="down">◀</button>
                <input type="text" class="sale-input" data-session="${d.sessionKey}" value="${saleFormatted}" data-raw="${d.salePrice}">
                <button class="sale-btn sale-up" data-session="${d.sessionKey}" data-dir="up">▶</button>
            </span>
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

    const moneyIcon = !d.isSuccess ? '' : (d.isSold ? '💰' : '📦');
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

// ============================================
// MOCK DATA GENERATION (demo mode)
// ============================================

function generateMockData() {
    if (usingMockData) return; // already generated

    // Pick 4 items that have enhancementCosts AND market prices at +0 and +10
    const candidates = [];
    for (const [hrid, item] of Object.entries(gameData.items || {})) {
        if (!item.enhancementCosts) continue;
        const mp = prices.market?.[hrid];
        if (!mp) continue;
        if (!mp['0']?.b || !mp['10']?.b) continue;
        // Prefer items with +12 price too, and mid-range cost (not cheese tier)
        const basePrice = mp['0'].b;
        if (basePrice < 500000 || basePrice > 500000000) continue;
        candidates.push({ hrid, item, basePrice, p10: mp['10'].b, p12: mp['12']?.b || 0 });
    }

    if (candidates.length < 4) {
        console.warn('[CowProfit] Not enough items for mock data');
        return;
    }

    // Sort by base price descending, pick diverse set
    candidates.sort((a, b) => b.basePrice - a.basePrice);
    // Pick items at different price tiers
    const picks = [];
    const tiers = [0, Math.floor(candidates.length * 0.2), Math.floor(candidates.length * 0.5), Math.floor(candidates.length * 0.8)];
    for (const idx of tiers) {
        if (candidates[idx] && !picks.find(p => p.hrid === candidates[idx].hrid)) {
            picks.push(candidates[idx]);
        }
    }
    // Ensure we have at least 4
    while (picks.length < 4 && candidates.length > picks.length) {
        const c = candidates.find(x => !picks.includes(x));
        if (c) picks.push(c); else break;
    }

    console.log('[CowProfit] Generating mock data with items:', picks.map(p => p.item.name));

    const now = new Date();
    const sessions = [];

    // Helper: generate realistic drop distribution for an enhance session
    // successRates: ~50% at +0, decreasing ~5% per level
    function generateDrops(itemHrid, startLevel, actionCount, targetReached) {
        const drops = {};
        let remaining = actionCount;
        let currentLvl = startLevel;
        const levelCounts = {};

        // Simulate enhancement attempts
        for (let i = 0; i < actionCount && remaining > 0; i++) {
            const successRate = Math.max(0.05, 0.50 - currentLvl * 0.05);
            const success = Math.random() < successRate;

            if (success) {
                currentLvl++;
                levelCounts[currentLvl] = (levelCounts[currentLvl] || 0) + 1;
                if (currentLvl >= targetReached) {
                    // Add the final item
                    drops[`${itemHrid}::${currentLvl}`] = 1;
                    // Distribute remaining attempts among lower levels
                    break;
                }
            } else {
                // Failure: drop to 0 if below prot, or -1 if above prot
                if (currentLvl >= 8) {
                    levelCounts[currentLvl - 1] = (levelCounts[currentLvl - 1] || 0) + 1;
                    currentLvl--;
                } else {
                    levelCounts[0] = (levelCounts[0] || 0) + 1;
                    currentLvl = 0;
                }
            }
        }

        // Convert to drop format
        for (const [lvl, count] of Object.entries(levelCounts)) {
            const key = `${itemHrid}::${lvl}`;
            drops[key] = (drops[key] || 0) + count;
        }

        return drops;
    }

    // Helper: create a session object
    function makeSession(itemHrid, startLevel, actionCount, hoursAgo, durationHours, drops) {
        const endTime = new Date(now.getTime() - hoursAgo * 3600000);
        const startTime = new Date(endTime.getTime() - durationHours * 3600000);
        return {
            actionHrid: '/actions/enhancing/enhance',
            actionCount,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            primaryItemHash: `char::/item_locations/inventory::${itemHrid}::${startLevel}`,
            drops
        };
    }

    const item0 = picks[0]; // expensive item - will be the grouped set
    const item1 = picks[1]; // success +10
    const item2 = picks[2]; // success +12
    const item3 = picks[3]; // in-progress

    // === Session 1-3: Grouped set for item0 (2 failures + 1 success) ===
    // Failure 1: 48h ago, went to +7 fell back
    const fail1Drops = {};
    fail1Drops[`${item0.hrid}::0`] = 45;
    fail1Drops[`${item0.hrid}::1`] = 38;
    fail1Drops[`${item0.hrid}::2`] = 30;
    fail1Drops[`${item0.hrid}::3`] = 25;
    fail1Drops[`${item0.hrid}::4`] = 20;
    fail1Drops[`${item0.hrid}::5`] = 15;
    fail1Drops[`${item0.hrid}::6`] = 10;
    fail1Drops[`${item0.hrid}::7`] = 5;
    sessions.push(makeSession(item0.hrid, 0, 188, 48, 3.5, fail1Drops));

    // Failure 2: 36h ago, went to +5 fell back
    const fail2Drops = {};
    fail2Drops[`${item0.hrid}::0`] = 55;
    fail2Drops[`${item0.hrid}::1`] = 42;
    fail2Drops[`${item0.hrid}::2`] = 32;
    fail2Drops[`${item0.hrid}::3`] = 22;
    fail2Drops[`${item0.hrid}::4`] = 14;
    fail2Drops[`${item0.hrid}::5`] = 6;
    sessions.push(makeSession(item0.hrid, 0, 171, 36, 3.0, fail2Drops));

    // Success: 24h ago, reached +10
    const succ0Drops = {};
    succ0Drops[`${item0.hrid}::0`] = 40;
    succ0Drops[`${item0.hrid}::1`] = 35;
    succ0Drops[`${item0.hrid}::2`] = 30;
    succ0Drops[`${item0.hrid}::3`] = 24;
    succ0Drops[`${item0.hrid}::4`] = 18;
    succ0Drops[`${item0.hrid}::5`] = 14;
    succ0Drops[`${item0.hrid}::6`] = 10;
    succ0Drops[`${item0.hrid}::7`] = 8;
    succ0Drops[`${item0.hrid}::8`] = 6;
    succ0Drops[`${item0.hrid}::9`] = 4;
    succ0Drops[`${item0.hrid}::10`] = 1;
    sessions.push(makeSession(item0.hrid, 0, 190, 24, 3.5, succ0Drops));

    // === Session 4: Success +10 for item1, 18h ago ===
    const succ1Drops = {};
    succ1Drops[`${item1.hrid}::0`] = 50;
    succ1Drops[`${item1.hrid}::1`] = 42;
    succ1Drops[`${item1.hrid}::2`] = 35;
    succ1Drops[`${item1.hrid}::3`] = 28;
    succ1Drops[`${item1.hrid}::4`] = 22;
    succ1Drops[`${item1.hrid}::5`] = 16;
    succ1Drops[`${item1.hrid}::6`] = 12;
    succ1Drops[`${item1.hrid}::7`] = 9;
    succ1Drops[`${item1.hrid}::8`] = 7;
    succ1Drops[`${item1.hrid}::9`] = 4;
    succ1Drops[`${item1.hrid}::10`] = 1;
    sessions.push(makeSession(item1.hrid, 0, 226, 18, 4.0, succ1Drops));

    // === Session 5: Success +12 for item2, 12h ago ===
    const succ2Drops = {};
    succ2Drops[`${item2.hrid}::0`] = 65;
    succ2Drops[`${item2.hrid}::1`] = 55;
    succ2Drops[`${item2.hrid}::2`] = 45;
    succ2Drops[`${item2.hrid}::3`] = 38;
    succ2Drops[`${item2.hrid}::4`] = 30;
    succ2Drops[`${item2.hrid}::5`] = 24;
    succ2Drops[`${item2.hrid}::6`] = 18;
    succ2Drops[`${item2.hrid}::7`] = 14;
    succ2Drops[`${item2.hrid}::8`] = 10;
    succ2Drops[`${item2.hrid}::9`] = 7;
    succ2Drops[`${item2.hrid}::10`] = 5;
    succ2Drops[`${item2.hrid}::11`] = 3;
    succ2Drops[`${item2.hrid}::12`] = 1;
    sessions.push(makeSession(item2.hrid, 0, 315, 12, 5.5, succ2Drops));

    // === Sessions 6-8: Standalone failures ===
    // Failure for item1, 60h ago - went to +8, fell back
    const fail3Drops = {};
    fail3Drops[`${item1.hrid}::0`] = 48;
    fail3Drops[`${item1.hrid}::1`] = 40;
    fail3Drops[`${item1.hrid}::2`] = 32;
    fail3Drops[`${item1.hrid}::3`] = 26;
    fail3Drops[`${item1.hrid}::4`] = 20;
    fail3Drops[`${item1.hrid}::5`] = 14;
    fail3Drops[`${item1.hrid}::6`] = 10;
    fail3Drops[`${item1.hrid}::7`] = 6;
    fail3Drops[`${item1.hrid}::8`] = 4;
    sessions.push(makeSession(item1.hrid, 0, 200, 60, 3.5, fail3Drops));

    // Failure for item2, 72h ago - went to +6, fell back
    const fail4Drops = {};
    fail4Drops[`${item2.hrid}::0`] = 52;
    fail4Drops[`${item2.hrid}::1`] = 44;
    fail4Drops[`${item2.hrid}::2`] = 35;
    fail4Drops[`${item2.hrid}::3`] = 28;
    fail4Drops[`${item2.hrid}::4`] = 18;
    fail4Drops[`${item2.hrid}::5`] = 12;
    fail4Drops[`${item2.hrid}::6`] = 6;
    sessions.push(makeSession(item2.hrid, 0, 195, 72, 3.5, fail4Drops));

    // Failure for item3, 84h ago - went to +5, fell back
    const fail5Drops = {};
    fail5Drops[`${item3.hrid}::0`] = 58;
    fail5Drops[`${item3.hrid}::1`] = 45;
    fail5Drops[`${item3.hrid}::2`] = 35;
    fail5Drops[`${item3.hrid}::3`] = 22;
    fail5Drops[`${item3.hrid}::4`] = 14;
    fail5Drops[`${item3.hrid}::5`] = 6;
    sessions.push(makeSession(item3.hrid, 0, 180, 84, 3.0, fail5Drops));

    // === Session 9: In-progress for item3, 2h ago, currently at +6 ===
    const inProgDrops = {};
    inProgDrops[`${item3.hrid}::0`] = 30;
    inProgDrops[`${item3.hrid}::1`] = 25;
    inProgDrops[`${item3.hrid}::2`] = 20;
    inProgDrops[`${item3.hrid}::3`] = 16;
    inProgDrops[`${item3.hrid}::4`] = 12;
    inProgDrops[`${item3.hrid}::5`] = 8;
    inProgDrops[`${item3.hrid}::6`] = 4;
    sessions.push(makeSession(item3.hrid, 0, 115, 2, 2.0, inProgDrops));

    // === Session 10: Another success for item3 from a while ago ===
    const succ3Drops = {};
    succ3Drops[`${item3.hrid}::0`] = 42;
    succ3Drops[`${item3.hrid}::1`] = 36;
    succ3Drops[`${item3.hrid}::2`] = 30;
    succ3Drops[`${item3.hrid}::3`] = 24;
    succ3Drops[`${item3.hrid}::4`] = 18;
    succ3Drops[`${item3.hrid}::5`] = 14;
    succ3Drops[`${item3.hrid}::6`] = 10;
    succ3Drops[`${item3.hrid}::7`] = 8;
    succ3Drops[`${item3.hrid}::8`] = 5;
    succ3Drops[`${item3.hrid}::9`] = 3;
    succ3Drops[`${item3.hrid}::10`] = 1;
    sessions.push(makeSession(item3.hrid, 0, 191, 96, 3.5, succ3Drops));

    // Sort by startTime descending
    sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    lootHistoryData = sessions;
    usingMockData = true;

    // Reset group state for mock data so auto-grouping works fresh
    saveGroupState({ groups: {}, seen: {}, version: 2 });

    // Run grouping on mock data
    const validSessions = lootHistoryData.filter(s => {
        if (!s.actionHrid?.includes('enhance')) return false;
        const ep = calculateEnhanceSessionProfit(s);
        if (!ep) return false;
        const hours = (new Date(s.endTime) - new Date(s.startTime)) / 3600000;
        if (hours < 0.02 && !ep.isSuccessful) return false;
        return true;
    });
    recomputeGroups(validSessions);

    console.log('[CowProfit] Mock data generated:', sessions.length, 'sessions');
}

function renderLootHistoryPanel() {
    const panel = document.getElementById('loot-history-panel');

    // Generate mock data if no real data and panel is being shown
    if (!lootHistoryData.length && !usingMockData) {
        generateMockData();
    }

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
        .slice(0, 200);

    if (!enhanceSessions.length) {
        panel.innerHTML = `
            <h5>📜 Enhance History</h5>
            <div class="loot-empty">
                No enhance sessions found. Start enhancing with the userscript active!
            </div>
        `;
        return;
    }

    // Read stored groups (no recompute — that only happens on import)
    const groupState = getGroupState();
    const groups = groupState.groups || {};

    // Build session lookup by key
    const sessionByKey = {};
    for (const s of enhanceSessions) sessionByKey[s.startTime] = s;

    // Compute display data — chain final levels within groups
    // Walk each group backwards: session N+1's startLevel = session N's final level
    const displayData = {};
    const chainedFinalLevels = {}; // sessionKey → finalLevelOverride

    for (const [groupId, memberKeys] of Object.entries(groups)) {
        // memberKeys is chronological (oldest first)
        // Walk from newest to oldest: next session's currentLevel is prev session's final
        for (let i = memberKeys.length - 1; i >= 1; i--) {
            const nextSession = sessionByKey[memberKeys[i]];
            if (!nextSession) continue;
            const nextEp = calculateEnhanceSessionProfit(nextSession);
            if (!nextEp) continue;
            // This session's start level is the previous session's final level
            chainedFinalLevels[memberKeys[i - 1]] = nextEp.currentLevel || 0;
        }
    }

    for (const s of enhanceSessions) {
        const d = computeSessionDisplay(s, chainedFinalLevels[s.startTime]);
        if (d) displayData[s.startTime] = d;
    }
    // Build render items
    const groupedKeys = new Set();
    const renderItems = [];

    for (const [groupId, memberKeys] of Object.entries(groups)) {
        const validKeys = memberKeys.filter(k => displayData[k]);
        if (validKeys.length < 2) continue;

        for (const k of validKeys) groupedKeys.add(k);
        const topKey = validKeys[validKeys.length - 1]; // most recent
        const subKeys = validKeys.slice(0, -1).reverse(); // older, newest first

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


    // Helper: check if a filteredItems entry contains a given session key
    function filteredItemContainsKey(fi, key) {
        if (fi.type === 'group') return fi.memberKeys.includes(key);
        return fi.sessionKey === key;
    }

    // Helper: determine handle placement based on adjacency in filteredItems
    function getHandlePlacement(ri, neighborRi) {
        return Math.abs(ri - neighborRi) === 1 ? 'floating' : 'on-card';
    }

    // Handle visibility helper: find nearest same-item neighbor
    function findNeighbors(key, itemName, direction) {
        const arr = itemSessionMap[itemName];
        if (!arr) return null;
        const idx = arr.findIndex(e => e.key === key);
        if (idx === -1) return null;
        if (direction === 'up' && idx < arr.length - 1) return arr[idx + 1]; // more recent
        if (direction === 'down' && idx > 0) return arr[idx - 1]; // older
        return null;
    }

    // Check if connecting two sessions/groups would violate constraints
    function canConnect(sourceKey, targetKey) {
        const sourceGroup = findGroupContaining(sourceKey, groups);
        const targetGroup = findGroupContaining(targetKey, groups);

        // Collect all members of potential merged group
        let allMembers = [];
        if (sourceGroup) allMembers.push(...sourceGroup.members);
        else allMembers.push(sourceKey);
        if (targetGroup && (!sourceGroup || targetGroup.groupId !== sourceGroup.groupId)) {
            allMembers.push(...targetGroup.members);
        } else if (!targetGroup) {
            allMembers.push(targetKey);
        }
        allMembers = [...new Set(allMembers)].sort((a, b) => new Date(a) - new Date(b));

        // Check: no failure after success chronologically
        let seenSuccess = false;
        for (const k of allMembers) {
            const isS = isSessionSuccess(k);
            if (seenSuccess && !isS) return false; // failure after success
            if (isS) seenSuccess = true;
        }
        // Check: no two successes
        const successCount = allMembers.filter(k => isSessionSuccess(k)).length;
        if (successCount > 1) return false;

        return true;
    }

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

    // Build item→sessions map for handle visibility (from filteredItems, not renderItems)
    const itemSessionMap = {}; // itemName → [{key, ri, isSuccess, groupId}]
    for (let ri = 0; ri < filteredItems.length; ri++) {
        const item = filteredItems[ri];
        let keys;
        if (item.type === 'group') {
            keys = [item.memberKeys[0], item.memberKeys[item.memberKeys.length - 1]]; // bottom edge, top edge
        } else {
            keys = [item.sessionKey];
        }
        for (const key of keys) {
            const d = displayData[key];
            if (!d) continue;
            const itemName = d.enhanceProfit?.itemName || 'Unknown';
            if (!itemSessionMap[itemName]) itemSessionMap[itemName] = [];
            itemSessionMap[itemName].push({
                key,
                ri,
                isSuccess: d.isSuccess,
                groupId: item.type === 'group' ? item.groupId : null
            });
        }
    }
    // Sort each item's array by time
    for (const arr of Object.values(itemSessionMap)) {
        arr.sort((a, b) => new Date(a.key) - new Date(b.key));
    }

    // Helper to render a group/manual handle
    function renderHandle(sourceKey, targetKey, placement, direction) {
        const escapedSource = sourceKey.replace(/'/g, "\\'");
        const escapedTarget = targetKey.replace(/'/g, "\\'");
        const dirClass = direction === 'up' ? 'handle-up' : 'handle-down';
        if (placement === 'floating') {
            return `<div class="group-handle-floating ${dirClass}" onclick="manualGroupSession('${escapedSource}', '${escapedTarget}', event)" title="Group sessions">⇕</div>`;
        } else {
            return `<div class="group-handle-attached ${dirClass}" onclick="manualGroupSession('${escapedSource}', '${escapedTarget}', event)" title="Group sessions">⇕ group</div>`;
        }
    }

    // Helper: get the connectable edge key and item name for a filteredItem's top/bottom
    function getEdgeInfo(fi, edge) {
        if (fi.type === 'group') {
            const key = edge === 'top' ? fi.memberKeys[fi.memberKeys.length - 1] : fi.memberKeys[0];
            const d = displayData[key];
            return { key, itemName: d?.enhanceProfit?.itemName || 'Unknown' };
        } else {
            const d = displayData[fi.sessionKey];
            return { key: fi.sessionKey, itemName: d?.enhanceProfit?.itemName || 'Unknown' };
        }
    }

    // Render items
    let entriesHtml = '';
    for (let ri = 0; ri < filteredItems.length; ri++) {
        const item = filteredItems[ri];

        // Compute floating handle between this item and previous item (any type combo)
        let floatingHandle = '';
        if (allFiltersOn && ri > 0) {
            const prevItem = filteredItems[ri - 1];
            const curTop = getEdgeInfo(item, 'top');
            const prevBottom = getEdgeInfo(prevItem, 'bottom');
            if (curTop.itemName === prevBottom.itemName && canConnect(curTop.key, prevBottom.key)) {
                floatingHandle = renderHandle(curTop.key, prevBottom.key, 'floating', 'up');
            }
        }

        if (item.type === 'group') {
            const topData = displayData[item.topKey];
            const subDatas = item.subKeys.map(k => displayData[k]);

            // Group total profit
            let groupProfit = topData.profit;
            for (const sd of subDatas) groupProfit += sd.profit;
            const groupProfitClass = groupProfit > 0 ? 'positive' : (groupProfit < 0 ? 'negative' : 'neutral');

            // Floating handle goes before the group div
            entriesHtml += floatingHandle;

            let groupHtml = '<div class="session-group">';

            // Top edge: outward group handle (only non-adjacent / on-card)
            if (allFiltersOn) {
                const topItemName = topData.enhanceProfit?.itemName;
                const neighbor = topItemName ? findNeighbors(item.topKey, topItemName, 'up') : null;
                if (neighbor && canConnect(item.topKey, neighbor.key)) {
                    const placement = getHandlePlacement(ri, neighbor.ri);
                    if (placement === 'on-card') {
                        groupHtml += renderHandle(item.topKey, neighbor.key, 'on-card', 'up');
                    }
                    // floating case handled above
                }
            }

            // Top card with ungroup handle
            groupHtml += `<div class="group-card-wrapper">`;
            groupHtml += renderSessionCard(topData, { isSubCard: false, isGrouped: true });
            if (allFiltersOn) {
                groupHtml += `<div class="ungroup-handle" onclick="ungroupSession('${item.topKey}', event)" title="Detach top">⇕</div>`;
            }
            groupHtml += `</div>`;

            // Sub-cards (failures)
            for (let i = 0; i < subDatas.length; i++) {
                groupHtml += `<div class="group-card-wrapper">`;
                groupHtml += renderSessionCard(subDatas[i], { isSubCard: true, isGrouped: true });
                if (allFiltersOn && i === subDatas.length - 1) {
                    groupHtml += `<div class="ungroup-handle" onclick="ungroupSession('${subDatas[i].sessionKey}', event)" title="Detach bottom">⇕</div>`;
                }
                groupHtml += `</div>`;
            }

            // Bottom edge: outward group handle (only non-adjacent / on-card)
            if (allFiltersOn) {
                const bottomKey = item.memberKeys[0];
                const bottomData = displayData[bottomKey];
                const bottomItemName = bottomData?.enhanceProfit?.itemName;
                const neighbor = bottomItemName ? findNeighbors(bottomKey, bottomItemName, 'down') : null;
                if (neighbor && canConnect(bottomKey, neighbor.key)) {
                    const placement = getHandlePlacement(ri, neighbor.ri);
                    if (placement === 'on-card') {
                        groupHtml += renderHandle(bottomKey, neighbor.key, 'on-card', 'down');
                    }
                    // floating case handled by next item's iteration
                }
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
            const myItem = d.enhanceProfit?.itemName || 'Unknown';

            // Check for on-card handles in both directions (only when all filters on)
            let handleAbove = '';
            let handleBelow = '';
            if (allFiltersOn) {
                const upNeighbor = findNeighbors(d.sessionKey, myItem, 'up');
                if (upNeighbor && canConnect(d.sessionKey, upNeighbor.key)) {
                    const placement = getHandlePlacement(ri, upNeighbor.ri);
                    if (placement === 'on-card') {
                        handleAbove = renderHandle(d.sessionKey, upNeighbor.key, 'on-card', 'up');
                    }
                    // floating case handled above
                }
                const downNeighbor = findNeighbors(d.sessionKey, myItem, 'down');
                if (downNeighbor && canConnect(d.sessionKey, downNeighbor.key)) {
                    const placement = getHandlePlacement(ri, downNeighbor.ri);
                    if (placement === 'on-card') {
                        handleBelow = renderHandle(d.sessionKey, downNeighbor.key, 'on-card', 'down');
                    }
                    // floating case handled by next item's iteration
                }
            }

            entriesHtml += floatingHandle + handleAbove;
            entriesHtml += renderSessionCard(d, { isSubCard: false, isGrouped: false });
            entriesHtml += handleBelow;
        }
    }

    const avgPerDay = totalHours > 0 ? (totalProfit / totalHours) * 24 : 0;
    const soldClass = soldProfit >= 0 ? 'positive' : 'negative';
    const unsoldClass = unsoldProfit >= 0 ? 'positive' : 'negative';
    const failedClass = failedProfit >= 0 ? 'positive' : 'negative';
    const avgClass = avgPerDay >= 0 ? 'positive' : 'negative';

    const totalClass = totalProfit >= 0 ? 'positive' : 'negative';

    const mockBanner = usingMockData ? `<div class="mock-data-banner">📋 Demo data — <a href="https://github.com/sdwr/cowprofit/blob/main/cowprofit-inventory.user.js" target="_blank">install userscript</a> to sync real sessions</div>` : '';

    panel.innerHTML = `
        ${mockBanner}
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
    
    // Get loot timestamp for historical price lookup (moved up for use in mat/prot pricing)
    const lootTs = session.startTime ? Math.floor(new Date(session.startTime).getTime() / 1000) : Math.floor(Date.now() / 1000);
    
    // Get optimal protection level from calculator (instead of hardcoding 8)
    // The calculator finds the most cost-effective prot level for this item
    let protLevel = 8; // fallback
    if (calculator) {
        try {
            const targetForProt = Math.max(...Object.keys(levelDrops).map(Number), 10);
            const matHrids = (itemData?.enhancementCosts || []).map(c => c.item || c.itemHrid || c.hrid).filter(h => h !== '/items/coin');
            const protItemHridsForCalc = itemData?.protectionItems || [];
            const allHridsForCalc = [itemHrid, '/items/mirror_of_protection', ...matHrids, ...protItemHridsForCalc];
            const itemResolver = new ItemResolver(gameData);
            const priceResolver = new PriceResolver(gameData, PRICE_TIERS);
            const shopping = itemResolver.resolve(itemHrid, targetForProt);
            if (shopping) {
                const histMarket = buildPricesAtTime(lootTs, allHridsForCalc).market;
                const resolved = priceResolver.resolve(shopping, histMarket, {matMode:'pessimistic', protMode:'pessimistic', sellMode:'pessimistic'}, calculator.getArtisanTeaMultiplier());
                const sim = calculator.simulate(resolved, targetForProt, shopping.itemLevel);
                if (sim && sim.protectAt) protLevel = sim.protectAt;
            }
        } catch (e) {
            console.warn('[Loot] Failed to get optimal prot level, using 8:', e);
        }
    }
    
    // Calculate protection used via cascade method (pass startLevel for accurate counting)
    const protResult = calculateProtectionFromDrops(levelDrops, protLevel, currentLevel);
    const protsUsed = protResult.protCount;
    
    // --- Determine success/result for PriceBundle resolution ---
    // Find highest level from any drops
    let highestLevel = 0;
    let resultLevel = 0;
    let highestTargetLevel = 0;
    for (const [lvl, count] of Object.entries(levelDrops)) {
        const level = parseInt(lvl) || 0;
        if (level > highestLevel) highestLevel = level;
        if (level >= 10 && level > resultLevel) resultLevel = level;
        if ([8, 10, 12, 14].includes(level) && level > highestTargetLevel) highestTargetLevel = level;
    }
    const isSuccessful = resultLevel >= 10 && (levelDrops[resultLevel] || 0) === 1;
    const saleLevelForEstimate = isSuccessful ? resultLevel : (highestTargetLevel || 10);
    
    // Resolve all prices via PriceBundle (single source of truth for prices)
    const pb = resolveSessionPrices(session, itemHrid, itemData, lootTs, 'pessimistic', {
        saleLevelForEstimate,
        resultLevel: isSuccessful ? resultLevel : 0,
        isSuccessful
    });
    
    // Extract prices from bundle
    const matPrices = {};
    for (const [hrid, detail] of Object.entries(pb.mats)) {
        matPrices[hrid] = detail.price;
    }
    const matPriceMissing = pb.matPriceMissing;
    const protPrice = pb.prot.price;
    const protHrid = pb.prot.hrid;
    const protPriceMissing = pb.protPriceMissing && protsUsed > 0;
    
    // Compute matCostPerAction from bundle prices
    let matCostPerAction = 0;
    const enhanceCostsForCalc = itemData?.enhancementCosts || [];
    for (const cost of enhanceCostsForCalc) {
        const costHrid = cost.item || cost.itemHrid || cost.hrid;
        const costCount = cost.count || 1;
        const price = matPrices[costHrid] || 0;
        matCostPerAction += costCount * price;
    }
    
    const totalMatCost = actionCount * matCostPerAction;
    const totalProtCost = protsUsed * protPrice;
    
    // Revenue and base item cost from PriceBundle
    let revenue = 0;
    let revenueBreakdown = {};
    const revenuePriceMissing = pb.revenuePriceMissing;
    
    if (isSuccessful) {
        revenue = pb.sellRevenue.price;
        revenueBreakdown[resultLevel] = { count: 1, sellPrice: revenue, value: revenue };
    }
    
    const baseItemCost = pb.baseItem.price;
    const baseItemSource = pb.baseItem.source;
    const baseItemSourceIcon = pb.baseItem.sourceIcon;
    
    const totalCost = totalMatCost + totalProtCost + (isSuccessful ? baseItemCost : 0);
    
    // Estimated sale from PriceBundle
    const estimatedSale = pb.estimatedSale.price;
    const estimatedSaleSource = pb.estimatedSale.source;
    const estimatedSaleSourceIcon = pb.estimatedSale.sourceIcon;
    const estimatedSaleLevel = pb.estimatedSale.level;
    
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
    
    // Tea prices from PriceBundle
    const sessionTeaPrices = {
        ultraEnhancing: pb.teas.ultra.price,
        blessed: pb.teas.blessed.price,
        wisdom: pb.teas.wisdom.price
    };
    
    return {
        itemHrid,
        itemName,
        actionCount,
        totalItems,
        levelDrops,
        currentLevel,
        highestLevel,
        highestTargetLevel,
        resultLevel,
        isSuccessful,
        protsUsed,
        protLevel,
        matPrices,
        matCostPerAction,
        totalMatCost,
        protPrice,
        protHrid,
        totalProtCost,
        baseItemCost,
        baseItemSource,
        baseItemSourceIcon,
        totalCost,
        revenue,
        revenueBreakdown,
        estimatedSale,
        estimatedSaleLevel,
        priceBundle: pb,
        estimatedSaleSource,
        estimatedSaleSourceIcon,
        teaPrices: sessionTeaPrices,
        fee,
        netSale,
        profit,
        profitPerHour,
        hours,
        lootTs,
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
function calculateProtectionFromDrops(levelDrops, protLevel, startLevel = 0, finalLevelOverride) {
    const levels = Object.keys(levelDrops).map(Number).sort((a, b) => b - a);
    if (levels.length === 0) return { protCount: 0 };
    
    const maxLevel = Math.max(...levels, startLevel || 0);
    const finalLevel = finalLevelOverride !== undefined ? finalLevelOverride : maxLevel;
    
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
// Price dot helper
function priceDotHtml(actualMode) {
    if (!actualMode || actualMode === 'pessimistic') return '';
    const cls = {
        'pessimistic+': 'price-dot-pess-plus',
        'midpoint': 'price-dot-midpoint',
        'optimistic-': 'price-dot-opt-minus',
        'optimistic': 'price-dot-optimistic',
    }[actualMode];
    return cls ? `<span class="price-dot ${cls}"></span>` : '';
}

// Build tooltip extra info showing the tick increment for sell modes
function _sellModeTipExtra(mode, details) {
    const bid = details?.sellBid || 0;
    const ask = details?.sellAsk || 0;
    if (mode === 'pessimistic+' && bid > 0) {
        const step = getNextPrice(bid) - bid;
        return ` (bid ${formatCoins(bid)} + ${formatCoins(step)})`;
    }
    if (mode === 'optimistic-' && ask > 0) {
        const step = ask - getPrevPrice(ask);
        return ` (ask ${formatCoins(ask)} - ${formatCoins(step)})`;
    }
    if (mode === 'midpoint' && bid > 0 && ask > 0) {
        return ` (bid ${formatCoins(bid)} + ask ${formatCoins(ask)}) / 2`;
    }
    return '';
}

// Apply sell mode offset to a raw bid price (for showing historical price changes with mode applied)
function _applySellModeToPrice(bid, ask, mode) {
    if (!bid || bid <= 0) return 0;
    switch (mode) {
        case 'pessimistic': return bid;
        case 'pessimistic+':
            if (ask > 0 && ask <= getNextPrice(bid)) return bid; // tight spread fallback
            return getNextPrice(bid);
        case 'midpoint':
            if (ask > 0 && bid > 0) return (bid + ask) / 2;
            return bid; // fall back to pessimistic
        case 'optimistic-':
            if (!ask || ask <= 0) return bid;
            if (ask <= getNextPrice(bid)) return ask; // tight spread fallback
            return getPrevPrice(ask);
        case 'optimistic':
            return ask > 0 ? ask : bid;
        default: return bid;
    }
}

// Sync button active states with priceConfig
function syncPriceConfigButtons() {
    // Clear all cat-btn active states
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    // Set active for each category
    const mapping = { mat: priceConfig.matMode, prot: priceConfig.protMode, sell: priceConfig.sellMode };
    for (const [cat, mode] of Object.entries(mapping)) {
        const btn = document.querySelector(`.cat-btn[data-cat="${cat}"][data-mode="${mode}"]`);
        if (btn) btn.classList.add('active');
    }
    // Master pess highlight: active when sell is pessimistic
    const masterBtn = document.getElementById('btn-master-pess');
    if (masterBtn) {
        masterBtn.classList.toggle('active', priceConfig.sellMode === 'pessimistic');
    }
    // Update mode info
    const el = document.getElementById('mode-info');
    if (el) {
        const sellLabels = {
            'pessimistic': 'Sell at Bid (safest estimate)',
            'pessimistic+': 'Sell at Bid + 1 tick',
            'midpoint': 'Sell at Midpoint (Bid+Ask)/2',
            'optimistic-': 'Sell at Ask - 1 tick',
            'optimistic': 'Sell at Ask (most optimistic)',
        };
        el.textContent = sellLabels[priceConfig.sellMode] || '';
    }
}

function setCatMode(cat, mode) {
    if (cat === 'mat') priceConfig.matMode = mode;
    else if (cat === 'prot') priceConfig.protMode = mode;
    else if (cat === 'sell') priceConfig.sellMode = mode;
    savePriceConfig();
    syncPriceConfigButtons();
    expandedRows.clear();
    onPriceModeChangeAsync();
}

function masterPessimistic() {
    priceConfig.matMode = 'pessimistic';
    priceConfig.protMode = 'pessimistic';
    priceConfig.sellMode = 'pessimistic';
    savePriceConfig();
    syncPriceConfigButtons();
    expandedRows.clear();
    onPriceModeChangeAsync();
}

async function onPriceModeChangeAsync() {
    const runId = ++recalcController.runId;
    recalcController.inProgress = true;
    applySkeletonState();
    
    const result = await calculateAllProfitsAsync(runId);
    if (!result) return;
    
    const tbody = document.getElementById('table-body');
    const oldRows = Array.from(tbody.querySelectorAll('tr.data-row'));
    const firstRects = new Map();
    oldRows.forEach(row => {
        const rowId = row.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (rowId) firstRects.set(rowId, row.getBoundingClientRect());
    });
    
    allResults = result;
    renderTable();
    
    // FLIP animation
    const newRows = Array.from(tbody.querySelectorAll('tr.data-row'));
    newRows.forEach(row => {
        const rowId = row.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (!rowId || !firstRects.has(rowId)) return;
        const first = firstRects.get(rowId);
        const last = row.getBoundingClientRect();
        const deltaY = first.top - last.top;
        if (Math.abs(deltaY) < 1) return;
        row.style.transform = `translateY(${deltaY}px)`;
        row.style.transition = 'none';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                row.classList.add('flip-animate');
                row.style.transform = '';
                row.addEventListener('transitionend', () => {
                    row.classList.remove('flip-animate');
                    row.style.transition = '';
                }, { once: true });
            });
        });
    });
    
    recalcController.inProgress = false;
    if (lootHistoryOpen) renderLootHistoryPanel();
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

// Get buy price at a specific timestamp using history, falling back to current market
// Returns { price, source, sourceIcon, ts } with full provenance tracking
// No craft fallback (avoids circular recursion with estimatePrice)
// Format a timestamp for tooltips (short date+time)
// Compact timestamp: "2/14 10:05PM"
function _fmtTs(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const mo = d.getMonth() + 1;
    const day = d.getDate();
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const min = d.getMinutes().toString().padStart(2, '0');
    return `${mo}/${day} ${h}:${min}${ampm}`;
}

// Truncate name to maxLen chars
function _shortName(name, maxLen) {
    if (!name || name.length <= maxLen) return name;
    return name.slice(0, maxLen - 1) + '…';
}

/**
 * Format a single price source for tooltip.
 * Examples:
 *   ask @ 2/14 10:05PM           — market ask price
 *   bid 📈 @ 2/14 10:05PM        — history bid
 *   ask 📈 @ 2/14 10:05PM ⚠️     — history with fallback to wrong side
 *   craft                         — crafted cost
 * 
 * @param {Object} detail - {source, side, fallback, ts, price, name}
 * @param {Object} opts - {showName: bool, showPrice: bool, nameLen: number}
 */
function _priceTip(detail, opts) {
    if (!detail || !detail.source) return '';
    opts = opts || {};
    if (opts.showName === undefined) opts.showName = true;
    if (opts.showPrice === undefined) opts.showPrice = true;
    const nameLen = opts.nameLen || 12;
    
    const src = detail.source;
    if (src === 'fixed') return '';
    
    let parts = [];
    
    // Name + price prefix
    if (opts.showName && detail.name) {
        parts.push(_shortName(detail.name, nameLen));
    }
    if (opts.showPrice && detail.price) {
        parts.push(formatCoins(detail.price));
    }
    
    // Source label
    if (src === 'market') {
        const side = detail.side || 'ask';
        parts.push(side);
    } else if (src === 'history' || src.startsWith('history ')) {
        const side = detail.side || 'bid';
        // Include the qualifier if present: "history (-2.3h)" → "bid (-2.3h)"
        const qualifier = src.match(/\(([^)]+)\)/);
        const qStr = qualifier && qualifier[1] !== 'newest' ? ` (${qualifier[1]})` : '';
        parts.push(`${side}${qStr}`);
    } else if (src === 'craft cost' || src === 'craft') {
        parts.push('craft');
    } else if (src === 'enhance cost') {
        parts.push('enhance');
    } else {
        parts.push(src);
    }
    
    // Timestamp
    const ts = detail.ts || (typeof prices !== 'undefined' ? prices.ts : null);
    if (ts) {
        parts.push('@ ' + _fmtTs(ts));
    }
    
    // Fallback warning
    if (detail.fallback) {
        parts.push('⚠️');
    }
    
    return parts.join(' ');
}

/**
 * Format a multi-item tooltip (one line per item).
 * @param {Array} items - [{name, price, source, side, fallback, ts}, ...]
 * @param {Object} opts - passed to _priceTip per item
 */
function _multiPriceTip(items, opts) {
    opts = { showName: true, showPrice: true, nameLen: 12, ...opts };
    return items
        .filter(d => d.source !== 'fixed')
        .map(d => _priceTip(d, opts))
        .join('&#10;');
}

/**
 * Get the appropriate history list for an item based on price side.
 * Handles both old format (flat array of {p,t}) and new format ({b:[...], a:[...]}).
 * 
 * @param {string} key - History key like "/items/foo:10"
 * @param {'bid'|'ask'} side - Which price list to get
 *   - 'bid' = sell price / what buyers are paying (used for: age, sell revenue, item valuation)
 *   - 'ask' = buy price / what sellers are asking (used for: buying mats pessimistically)
 * @returns {Array} List of {p, t} entries, newest first
 */
function getHistoryList(key, side) {
    const entry = prices.history?.[key];
    if (!entry) return [];
    
    // Old format: flat array of {p, t} — these were bid prices
    if (Array.isArray(entry)) {
        return side === 'bid' ? entry : [];
    }
    
    // New format: {b: [...], a: [...]}
    return (side === 'bid' ? entry.b : entry.a) || [];
}

/**
 * Look up a historical price from a sorted list (newest-first).
 * Returns the entry closest before the given timestamp.
 */
function findHistoricalPrice(histList, lootTs) {
    if (!histList || histList.length === 0) return null;
    
    const newestTs = histList[0].t;
    const oldestTs = histList[histList.length - 1].t;
    
    if (lootTs >= newestTs) {
        return { entry: histList[0], label: 'history (newest)' };
    }
    if (lootTs <= oldestTs) {
        return { entry: histList[histList.length - 1], label: 'history (oldest)' };
    }
    
    for (const e of histList) {
        if (e.t <= lootTs) {
            const diffHours = (lootTs - e.t) / 3600;
            const diffLabel = diffHours < 1 ? `${Math.round(diffHours * 60)}m` : 
                              diffHours < 24 ? `${diffHours.toFixed(1)}h` : 
                              `${(diffHours / 24).toFixed(1)}d`;
            return { entry: e, label: `history (-${diffLabel})` };
        }
    }
    return null;
}

/**
 * Get historical buy price with source tracking.
 * 
 * Price side selection:
 *   - pessimistic mode → ask history (what you'd pay to buy now)
 *   - optimistic mode  → bid history (cheapest possible buy)
 *   - midpoint mode    → average of bid and ask if both available
 * 
 * Fallback: current market price via getBuyPrice().
 */
function getBuyPriceAtTimeDetailed(hrid, level, lootTs, mode) {
    if (!lootTs) {
        const side = (mode === 'optimistic') ? 'bid' : 'ask';
        const p = getBuyPrice(hrid, level, mode);
        return { price: p, source: 'market', side, fallback: false, sourceIcon: '💰', ts: prices.ts || null };
    }
    
    const key = `${hrid}:${level}`;
    
    // Determine which history list to use based on mode
    // Pessimistic = ask (worst case buy price), Optimistic = bid (best case buy price)
    const primarySide = (mode === 'optimistic') ? 'bid' : 'ask';
    const fallbackSide = (mode === 'optimistic') ? 'ask' : 'bid';
    
    // Try primary side first
    const primaryList = getHistoryList(key, primarySide);
    const primaryResult = findHistoricalPrice(primaryList, lootTs);
    
    if (primaryResult) {
        if (mode === 'midpoint') {
            const bidList = getHistoryList(key, 'bid');
            const bidResult = findHistoricalPrice(bidList, lootTs);
            const askList = getHistoryList(key, 'ask');
            const askResult = findHistoricalPrice(askList, lootTs);
            if (bidResult && askResult) {
                const avg = Math.round((bidResult.entry.p + askResult.entry.p) / 2);
                return { price: avg, source: 'history', side: 'mid', fallback: false, sourceIcon: '📈', ts: primaryResult.entry.t };
            }
        }
        return { price: primaryResult.entry.p, source: 'history', side: primarySide, fallback: false, sourceIcon: '📈', ts: primaryResult.entry.t };
    }
    
    // Primary side history empty — prefer current market over wrong-side history
    // (e.g. no ask history yet, use current market ask instead of historical bid)
    const currentMarket = getBuyPrice(hrid, level, mode);
    if (currentMarket > 0) {
        const side = (mode === 'optimistic') ? 'bid' : 'ask';
        return { price: currentMarket, source: 'market', side, fallback: false, sourceIcon: '💰', ts: prices.ts || null };
    }
    
    // No current market — fall back to wrong-side history as last resort
    const fallbackList = getHistoryList(key, fallbackSide);
    const fallbackResult = findHistoricalPrice(fallbackList, lootTs);
    if (fallbackResult) {
        return { price: fallbackResult.entry.p, source: 'history', side: fallbackSide, fallback: true, sourceIcon: '📈', ts: fallbackResult.entry.t };
    }
    
    return { price: 0, source: 'unknown', side: null, fallback: true, sourceIcon: '❓', ts: null };
}

// Backward-compatible wrapper returning just the price number
function getBuyPriceAtTime(hrid, level, lootTs, mode) {
    return getBuyPriceAtTimeDetailed(hrid, level, lootTs, mode).price;
}

// Build a prices-shaped object at a specific timestamp for enhance-calc.js
function buildPricesAtTime(lootTs, itemHrids) {
    const market = {};
    for (const hrid of itemHrids) {
        const price = getBuyPriceAtTime(hrid, 0, lootTs, 'pessimistic');
        if (!market[hrid]) market[hrid] = {};
        market[hrid]['0'] = { a: price, b: price };
    }
    return { market, history: prices.history };
}

// Get enhancement material details for an item (NO artisan tea - these are enhancement mats, not crafting)
// lootTs is optional - when provided, uses historical prices instead of current market
function getMaterialDetails(itemHrid, actions, mode, lootTs) {
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
            const detail = lootTs ? getBuyPriceAtTimeDetailed(cost.item, 0, lootTs, mode) : null;
            const price = detail ? detail.price : getBuyPrice(cost.item, 0, mode);
            materials.push({
                hrid: cost.item,
                name: matName,
                count: cost.count,
                price: price,
                total: cost.count * price * actions,
                source: detail ? detail.source : 'market',
                sourceIcon: detail ? detail.sourceIcon : '💰',
                side: detail ? detail.side : undefined,
                fallback: detail ? detail.fallback : false,
                ts: detail ? detail.ts : (prices.ts || null)
            });
        }
    }
    return materials;
}

// Get price history for an item at a level
function getPriceAge(itemHrid, level) {
    const key = `${itemHrid}:${level}`;
    // Age is based on bid (sell) price — how long the current sell price has lasted
    const bidList = getHistoryList(key, 'bid');
    if (!bidList || bidList.length === 0) return null;
    
    const currentEntry = bidList[0];
    const now = Math.floor(Date.now() / 1000);
    const age = now - currentEntry.t;
    
    let direction = null;
    let lastPrice = null;
    if (bidList.length > 1) {
        lastPrice = bidList[1].p;
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
    // estimatePrice values items = what you can sell for → use bid history
    const bidList = getHistoryList(key, 'bid');
    
    // 1. Check bid history - find most recent entry BEFORE loot timestamp
    const result = findHistoricalPrice(bidList, lootTs);
    if (result) {
        const icon = result.label.includes('oldest') ? '📜' : '📈';
        return { price: result.entry.p, source: result.label, sourceIcon: icon, side: 'bid', ts: result.entry.t };
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
        const craftMats = getCraftingMaterials(itemHrid, mode, lootTs);
        return craftMats?.total || 0;
    }
    
    // Enhanced item: base item + enhancement costs from +0 to +level
    // Get base item cost - checks history first, falls back to craft cost
    const baseEstimate = estimatePrice(itemHrid, 0, lootTs, mode);
    const baseCost = baseEstimate.price;
    
    // Use calculator if available
    if (calculator) {
        try {
            const item = gameData.items[itemHrid];
            const matHrids = (item?.enhancementCosts || []).map(c => c.item).filter(h => h !== '/items/coin');
            const protHrids = item?.protectionItems || [];
            const allHrids = [itemHrid, '/items/mirror_of_protection', ...matHrids, ...protHrids];
            const modeMap = {
                'pessimistic': {matMode:'pessimistic', protMode:'pessimistic', sellMode:'pessimistic'},
                'midpoint': {matMode:'pessimistic', protMode:'pessimistic', sellMode:'midpoint'},
                'optimistic': {matMode:'optimistic', protMode:'optimistic', sellMode:'optimistic'},
            };
            const modes = modeMap[mode] || modeMap['pessimistic'];
            const itemResolver = new ItemResolver(gameData);
            const priceResolver = new PriceResolver(gameData, PRICE_TIERS);
            const shopping = itemResolver.resolve(itemHrid, level);
            if (shopping) {
                const histMarket = buildPricesAtTime(lootTs, allHrids).market;
                const resolved = priceResolver.resolve(shopping, histMarket, modes, calculator.getArtisanTeaMultiplier());
                const sim = calculator.simulate(resolved, level, shopping.itemLevel);
                if (sim && sim.totalCost > 0) {
                    return sim.totalCost;
                }
            }
        } catch (e) {
            console.warn('Failed to calculate enhancement cost:', e);
        }
    }
    
    // Fallback: rough estimate (base item only)
    return baseCost;
}

// ============================================
// PRICE BUNDLE — single source of resolved prices for a session
// ============================================

/**
 * Resolve all prices needed for an enhance session into a PriceBundle.
 * This is the ONLY function that should read from prices.market / prices.history
 * for session calculations. All calc functions receive this bundle.
 * 
 * Checks session price cache first (localStorage). Old-format cache entries
 * (missing `_bundleVersion`) are treated as cache misses.
 * 
 * @param {Object} session - The loot session object
 * @param {string} itemHrid - Item HRID being enhanced
 * @param {Object} itemData - gameData.items entry for the item
 * @param {number} lootTs - Unix timestamp for historical price lookup
 * @param {string} mode - 'pessimistic' (default for sessions)
 * @param {Object} opts - { saleLevelForEstimate, resultLevel, isSuccessful }
 * @returns {Object} PriceBundle
 */
function resolveSessionPrices(session, itemHrid, itemData, lootTs, mode, opts = {}) {
    const sessionKey = session.startTime;
    
    // Check cache — only use if new bundle format
    const cached = getCachedSessionPrices(sessionKey);
    if (cached && cached._bundleVersion === 1 && cached.dataHash === getSessionHash(session)) {
        // Recalc estimatedSale if level changed (toggle success/failure changes level)
        const saleLvl = opts.saleLevelForEstimate || 10;
        if (cached.estimatedSale && cached.estimatedSale.level === saleLvl) {
            return cached;
        }
        // Level changed — recompute sale-related fields only, keep rest from cache
        const bundle = { ...cached };
        _resolveSaleFields(bundle, itemHrid, itemData, lootTs, mode, saleLvl, opts);
        bundle.dataHash = getSessionHash(session);
        cacheSessionPrices(sessionKey, bundle);
        return bundle;
    }
    
    // === Build fresh PriceBundle ===
    const bundle = {
        _bundleVersion: 1,
        resolvedAt: Date.now(),
        lootTs,
        mats: {},
        prot: { price: 0, source: null, sourceIcon: null, ts: null, hrid: null },
        teas: {
            ultra: { price: 0, source: null, sourceIcon: null, ts: null },
            blessed: { price: 0, source: null, sourceIcon: null, ts: null },
            wisdom: { price: 0, source: null, sourceIcon: null, ts: null }
        },
        baseItem: { price: 0, source: null, sourceIcon: null, ts: null },
        estimatedSale: { price: 0, source: null, sourceIcon: null, ts: null, level: 0 },
        sellRevenue: { price: 0, source: null, sourceIcon: null, ts: null, level: 0 },
        matPriceMissing: false,
        protPriceMissing: false,
        revenuePriceMissing: false,
        dataHash: getSessionHash(session)
    };
    
    // --- Materials ---
    const enhanceCosts = itemData?.enhancementCosts || [];
    for (const cost of enhanceCosts) {
        const costHrid = cost.item || cost.itemHrid || cost.hrid;
        if (costHrid === '/items/coin') {
            bundle.mats[costHrid] = { price: 1, source: 'fixed', sourceIcon: '🪙', ts: null };
        } else {
            const detail = getBuyPriceAtTimeDetailed(costHrid, 0, lootTs, mode);
            if (detail.price === 0) bundle.matPriceMissing = true;
            bundle.mats[costHrid] = detail;
        }
    }
    
    // --- Protection (cheapest option) ---
    const mirrorDetail = getBuyPriceAtTimeDetailed('/items/mirror_of_protection', 0, lootTs, mode);
    const baseItemDetailForProt = getBuyPriceAtTimeDetailed(itemHrid, 0, lootTs, mode);
    
    let bestProt = { price: Infinity, source: null, sourceIcon: null, ts: null, hrid: null };
    if (mirrorDetail.price > 0 && mirrorDetail.price < bestProt.price) {
        bestProt = { ...mirrorDetail, hrid: '/items/mirror_of_protection' };
    }
    if (baseItemDetailForProt.price > 0 && baseItemDetailForProt.price < bestProt.price) {
        bestProt = { ...baseItemDetailForProt, hrid: itemHrid };
    }
    const protItemHrids = itemData?.protectionItems || [];
    for (const pH of protItemHrids) {
        const d = getBuyPriceAtTimeDetailed(pH, 0, lootTs, mode);
        if (d.price > 0 && d.price < bestProt.price) {
            bestProt = { ...d, hrid: pH };
        }
    }
    if (bestProt.price === Infinity) {
        bestProt = { price: 0, source: null, sourceIcon: null, ts: null, hrid: null };
        bundle.protPriceMissing = true; // only matters if prots are actually used
    }
    bundle.prot = bestProt;
    
    // --- Teas ---
    const teaUltra = getBuyPriceAtTimeDetailed('/items/ultra_enhancing_tea', 0, lootTs, mode);
    const teaBlessed = getBuyPriceAtTimeDetailed('/items/blessed_tea', 0, lootTs, mode);
    const teaWisdom = getBuyPriceAtTimeDetailed('/items/wisdom_tea', 0, lootTs, mode);
    bundle.teas.ultra = teaUltra;
    bundle.teas.blessed = teaBlessed;
    bundle.teas.wisdom = teaWisdom;
    
    // --- Base Item (cheapest of: market ask, craft cost from bid prices) ---
    // Never use raw bid price — base item is something you BUY or CRAFT
    const baseMarket = getBuyPriceAtTimeDetailed(itemHrid, 0, lootTs, mode);
    const baseCraft = getCraftingMaterials(itemHrid, mode, lootTs);
    const baseCraftPrice = baseCraft?.total || 0;
    
    let baseItem;
    const baseItemName = gameData.items[itemHrid]?.name || itemHrid.split('/').pop().replace(/_/g, ' ');
    // Only trust market price if it's a real ask (not a bid fallback)
    const marketIsRealAsk = baseMarket.price > 0 && !baseMarket.fallback;
    
    if (marketIsRealAsk && (baseCraftPrice <= 0 || baseMarket.price <= baseCraftPrice)) {
        // Real market ask is available and cheaper (or craft unavailable)
        baseItem = { ...baseMarket, name: baseItemName };
    } else if (baseCraftPrice > 0) {
        // Craft is cheaper, or market was bid fallback — use craft
        // Build multi-line tooltip showing craft materials
        const craftTipItems = (baseCraft.materials || []).map(m => ({
            name: m.name, price: m.price, source: m.source || 'market', side: m.side, ts: m.ts, fallback: m.fallback
        }));
        const craftMatTip = _multiPriceTip(craftTipItems);
        baseItem = { price: baseCraftPrice, source: 'craft', sourceIcon: '🔨', ts: lootTs, name: baseItemName, _craftTip: craftMatTip };
    } else if (baseMarket.price > 0) {
        // Only bid fallback available, no craft — craft from bid prices
        const craftFromBid = getCraftingMaterials(itemHrid, 'optimistic', lootTs);
        const craftBidPrice = craftFromBid?.total || 0;
        if (craftBidPrice > 0) {
            const craftBidItems = (craftFromBid.materials || []).map(m => ({
                name: m.name, price: m.price, source: m.source || 'market', side: m.side, ts: m.ts, fallback: true
            }));
            const craftBidTip = _multiPriceTip(craftBidItems);
            baseItem = { price: craftBidPrice, source: 'craft (bid)', sourceIcon: '🔨', ts: lootTs, name: baseItemName, fallback: true, _craftTip: craftBidTip };
        } else {
            // Can't craft either — use bid fallback as last resort (with warning)
            baseItem = { ...baseMarket, name: baseItemName };
        }
    } else {
        baseItem = { price: 0, source: 'unknown', sourceIcon: '❓', ts: null, name: baseItemName };
    }
    bundle.baseItem = baseItem;
    
    // --- Sell Revenue (for successful sessions) ---
    // BUG FIX: was using prices.market directly — now uses getBuyPriceAtTimeDetailed with bid preference
    const resultLevel = opts.resultLevel || 0;
    if (opts.isSuccessful && resultLevel >= 10) {
        // Use bid price from history at loot time
        const sellDetail = getBuyPriceAtTimeDetailed(itemHrid, resultLevel, lootTs, 'optimistic');
        // optimistic mode prefers bid, which is what we want for sell revenue
        bundle.sellRevenue = { price: sellDetail.price, source: sellDetail.source, sourceIcon: sellDetail.sourceIcon, ts: sellDetail.ts, level: resultLevel };
        if (sellDetail.price === 0) bundle.revenuePriceMissing = true;
    }
    
    // --- Estimated Sale Price ---
    const saleLvl = opts.saleLevelForEstimate || 10;
    _resolveSaleFields(bundle, itemHrid, itemData, lootTs, mode, saleLvl, opts);
    
    // Cache
    cacheSessionPrices(sessionKey, bundle);
    return bundle;
}

/** Internal: resolve estimatedSale on an existing bundle */
function _resolveSaleFields(bundle, itemHrid, itemData, lootTs, mode, saleLvl, opts) {
    if (saleLvl >= 8) {
        // 1. Try market bid price (what buyers are paying = realistic sale price)
        const bidDetail = getBuyPriceAtTimeDetailed(itemHrid, saleLvl, lootTs, 'optimistic');
        if (bidDetail.price > 0 && bidDetail.source === 'market') {
            bundle.estimatedSale = { price: bidDetail.price, source: 'market', side: 'bid', sourceIcon: '💰', ts: bidDetail.ts, level: saleLvl };
            return;
        }
        
        // 2. Try cost to create (enhance cost estimate)
        const costToCreate = calculateCostToCreate(itemHrid, saleLvl, lootTs, mode);
        if (costToCreate > 0) {
            bundle.estimatedSale = { price: costToCreate, source: 'enhance cost', sourceIcon: '🪄', ts: lootTs, level: saleLvl };
            return;
        }
        
        // 3. Fall back to bid history estimate
        const saleEstimate = estimatePrice(itemHrid, saleLvl, lootTs, mode);
        bundle.estimatedSale = { price: saleEstimate.price, source: saleEstimate.source, sourceIcon: saleEstimate.sourceIcon, ts: lootTs, level: saleLvl };
    }
}

// Get crafting materials for an item (WITH artisan tea - these are crafting inputs)
// lootTs is optional - when provided, uses historical prices instead of current market
function getCraftingMaterials(itemHrid, mode, lootTs) {
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
        const detail = lootTs ? getBuyPriceAtTimeDetailed(input.item, 0, lootTs, mode) : null;
        const price = detail ? detail.price : getBuyPrice(input.item, 0, mode);
        // Apply artisan tea to crafting inputs
        const adjustedCount = input.count * artisanMult;
        const lineTotal = adjustedCount * price;
        total += lineTotal;
        materials.push({
            hrid: input.item,
            name: matName,
            count: adjustedCount,
            price: price,
            total: lineTotal,
            source: detail ? detail.source : 'market',
            sourceIcon: detail ? detail.sourceIcon : '💰',
            side: detail ? detail.side : undefined,
            fallback: detail ? detail.fallback : false,
            ts: detail ? detail.ts : (prices.ts || null)
        });
    }
    
    // Base item (the "upgrade" source) - NO artisan tea, count 1
    let baseItemHrid = null;
    let baseItemName = null;
    if (recipe.upgrade) {
        baseItemHrid = recipe.upgrade;
        const baseItem = gameData.items[baseItemHrid];
        baseItemName = baseItem?.name || baseItemHrid.split('/').pop().replace(/_/g, ' ');
        const detail = lootTs ? getBuyPriceAtTimeDetailed(baseItemHrid, 0, lootTs, mode) : null;
        const basePrice = detail ? detail.price : getBuyPrice(baseItemHrid, 0, mode);
        total += basePrice;
        materials.push({
            hrid: baseItemHrid,
            name: baseItemName,
            count: 1,
            price: basePrice,
            total: basePrice,
            source: detail ? detail.source : 'market',
            sourceIcon: detail ? detail.sourceIcon : '💰',
            side: detail ? detail.side : undefined,
            fallback: detail ? detail.fallback : false,
            ts: detail ? detail.ts : (prices.ts || null)
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
        
        const mTip = _priceTip(m, {showPrice: true});
        const matDot = priceDotHtml(m.actualMode);
        rows += `<div class="shop-row">
            <span class="shop-name">${m.name}</span>
            <span class="shop-qty">
                <span class="shop-progress" style="width:${pct.toFixed(0)}%"></span>
                <span class="shop-qty-text"><span class="shop-need-num">${formatWithCommas(need)}</span> <span class="shop-total-num">/ ${formatWithCommas(total)}</span></span>
            </span>
            <span class="shop-price${mTip ? ' price-tip' : ''}" ${mTip ? `data-tip="${mTip}"` : ''}>${formatCoins(m.price)}${matDot}</span>
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
        
        const protDot = priceDotHtml(r._resolvedPrices?.protectActualMode);
        rows += `<div class="shop-row prot-row">
            <span class="shop-name">${protName}</span>
            <span class="shop-qty">
                <span class="shop-progress" style="width:${pct.toFixed(0)}%"></span>
                <span class="shop-qty-text"><span class="shop-need-num">${formatWithCommas(need)}</span> <span class="shop-total-num">/ ${formatWithCommas(total)}</span></span>
            </span>
            <span class="shop-price price-tip" data-tip="${protName} ${formatCoins(r.protectPrice)} ask @ ${_fmtTs(prices.ts)}">${formatCoins(r.protectPrice)}${protDot}</span>
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

// Build material details from resolved prices
function getMaterialDetailsFromResolved(r) {
    const resolved = r._resolvedPrices;
    if (!resolved || !resolved.matPrices) return getMaterialDetails(r.item_hrid, 1, 'pessimistic');
    
    const materials = [];
    for (const [count, price, detail] of resolved.matPrices) {
        const hrid = detail?.hrid;
        if (hrid === '/items/coin') {
            materials.push({ hrid, name: 'Coins', count, price: 1, total: count, actualMode: null });
        } else {
            const matItem = gameData.items[hrid];
            const matName = matItem?.name || (hrid || '').split('/').pop().replace(/_/g, ' ');
            materials.push({
                hrid,
                name: matName,
                count,
                price,
                total: count * price,
                source: 'ask',
                ts: prices.ts,
                actualMode: detail?.actualMode || priceConfig.matMode,
            });
        }
    }
    return materials;
}

// Render detail row
function renderDetailRow(r) {
    // Get enhancement materials from resolved prices
    const materials = getMaterialDetailsFromResolved(r);
    
    // Materials HTML (per attempt, no artisan tea adjustments here)
    let matsHtml = '';
    let matsPerAttempt = 0;
    for (const m of materials) {
        const lineTotal = m.count * m.price;
        matsPerAttempt += lineTotal;
        const dot = m.name !== 'Coins' ? priceDotHtml(m.actualMode) : '';
        const tip = m.name !== 'Coins' ? `${m.name} ${formatCoins(m.price)} ask @ ${_fmtTs(prices.ts)}` : '';
        matsHtml += `<div class="mat-row">
            <span class="mat-name">${m.name}</span>
            <span class="mat-count">${m.count.toFixed(0)}x @ ${formatCoins(m.price)}${dot}</span>
            <span class="mat-price${tip ? ' price-tip' : ''}" ${tip ? `data-tip="${tip}"` : ''}>${formatCoins(lineTotal)}</span>
        </div>`;
    }
    const totalEnhanceCost = matsPerAttempt * r.actions;
    const totalProtCost = r.protectPrice * r.protectCount;
    
    // Protection item name (shorter version without level)
    const protItem = gameData.items[r.protectHrid];
    let protName = protItem?.name || (r.protectHrid ? r.protectHrid.split('/').pop().replace(/_/g, ' ') : 'Protection');
    // Strip "Protection" prefix for display
    protName = protName.replace(/^Protection /, '');
    
    // Base item section - check for craft alternative (always pessimistic for base item)
    const marketPrice = getBuyPrice(r.item_hrid, 0, 'pessimistic');
    const craftData = getCraftingMaterials(r.item_hrid, 'pessimistic'); // WITH artisan tea
    
    let baseItemHtml = '';
    if (r.baseSource === 'craft' && craftData) {
        // Craft is cheaper - show breakdown (base item now included in materials)
        const craftMatsHtml = craftData.materials.map(m => {
            const mTip = _priceTip(m, {showPrice: true});
            return `
            <div class="mat-row">
                <span class="mat-name">${m.name}</span>
                <span class="mat-count">${m.count.toFixed(2)}x @ ${formatCoins(m.price)}</span>
                <span class="mat-price${mTip ? ' price-tip' : ''}" ${mTip ? `data-tip="${mTip}"` : ''}>${formatCoins(m.total)}</span>
            </div>`;
        }).join('');
        
        const craftSummaryTip = _multiPriceTip(craftData.materials);
        baseItemHtml = `
            <div class="detail-line">
                <span class="label">Market price</span>
                <span class="value alt price-tip" data-tip="ask @ ${_fmtTs(prices.ts)}">${marketPrice > 0 ? formatCoins(marketPrice) : '--'}</span>
            </div>
            <div class="detail-line">
                <span class="label">Craft price</span>
                <span class="value price-tip" data-tip="${craftSummaryTip}">${formatCoins(r.basePrice)}</span>
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
                <span class="value price-tip" data-tip="ask @ ${_fmtTs(prices.ts)}">${marketPrice > 0 ? formatCoins(marketPrice) : '--'}</span>
            </div>`;
        if (craftData) {
            const craftAltTip = _multiPriceTip(craftData.materials);
            baseItemHtml += `
            <div class="detail-line">
                <span class="label">Craft price</span>
                <span class="value alt price-tip" data-tip="${craftAltTip}">${formatCoins(craftData.total)}</span>
            </div>`;
        }
    }
    
    // Price history - show change if available
    const priceInfo = getPriceAge(r.item_hrid, r.target_level);
    let priceHtml = '';
    
    const sellActualMode = r._resolvedPrices?.sellActualMode || 'pessimistic';
    const sellDot = priceDotHtml(sellActualMode);
    const sellModeLabels = {
        'pessimistic': 'bid',
        'pessimistic+': 'bid + 1 tick',
        'midpoint': 'midpoint',
        'optimistic-': 'ask - 1 tick',
        'optimistic': 'ask',
    };
    const sellModeLabel = sellModeLabels[sellActualMode] || 'bid';
    
    // Resolve display prices with the current sell mode applied
    const sellDetails = r._resolvedPrices || {};
    const resolvedSellPrice = r.sellPrice; // already resolved by PriceResolver
    
    if (priceInfo && priceInfo.lastPrice && priceInfo.lastPrice !== priceInfo.price) {
        // Show price change - resolve both old and new with current mode
        const bidOld = priceInfo.lastPrice;
        const bidNew = priceInfo.price;
        const askData = sellDetails.sellAsk || 0;
        
        // Apply sell mode to both old and new bid prices for display
        const displayNew = resolvedSellPrice;
        const displayOld = _applySellModeToPrice(bidOld, askData, sellActualMode);
        
        const pctChange = ((displayNew - displayOld) / displayOld * 100).toFixed(1);
        const pctClass = pctChange > 0 ? 'positive' : 'negative';
        priceHtml = `<div class="detail-line">
            <span class="label">Sell price (${sellModeLabel})</span>
            <span class="value ${pctClass} price-tip" data-tip="${r.item_name} +${r.target_level} ${sellModeLabel} @ ${_fmtTs(priceInfo.since)}">${formatCoins(displayOld)}${sellDot} → ${formatCoins(displayNew)}${sellDot} (${pctChange > 0 ? '+' : ''}${pctChange}%)</span>
        </div>`;
    } else {
        const sellTipExtra = _sellModeTipExtra(sellActualMode, sellDetails);
        priceHtml = `<div class="detail-line">
            <span class="label">Sell price (${sellModeLabel})</span>
            <span class="value price-tip" data-tip="${r.item_name} +${r.target_level} ${sellModeLabel}${sellTipExtra} @ ${_fmtTs(prices.ts)}">${formatCoins(resolvedSellPrice)}${sellDot}</span>
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
                <span class="protect-price price-tip" data-tip="${protName} ${formatCoins(r.protectPrice)} ask @ ${_fmtTs(prices.ts)}">${formatCoins(r.protectPrice)}${priceDotHtml(r._resolvedPrices?.protectActualMode)}</span>
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
                <span class="value price-tip" data-tip="${r.item_name} ${r.baseSource === 'craft' ? 'craft' : 'ask'} @ ${_fmtTs(prices.ts)}">${formatCoins(r.basePrice)}</span>
            </div>
            <div class="detail-line">
                <span class="label">Materials (${r.actions.toFixed(0)} × ${formatCoins(matsPerAttempt)})</span>
                <span class="value price-tip" data-tip="${_multiPriceTip(materials)}">${formatCoins(totalEnhanceCost)}${priceDotHtml(priceConfig.matMode)}</span>
            </div>
            <div class="detail-line">
                <span class="label">Protection (${r.protectCount.toFixed(1)} × ${formatCoins(r.protectPrice)})</span>
                <span class="value price-tip" data-tip="${protName} ${formatCoins(r.protectPrice)} ask @ ${_fmtTs(prices.ts)}">${formatCoins(totalProtCost)}${priceDotHtml(r._resolvedPrices?.protectActualMode)}</span>
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
    const data = allResults || [];
    
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
