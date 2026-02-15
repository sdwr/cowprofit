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

    let matCostStr = ep.matPriceMissing ? '⚠️ no price' : (ep.totalMatCost > 0 ? formatCoins(ep.totalMatCost) : '-');
    let protStr = '-';
    if (displayProts > 0) {
        protStr = ep.protPriceMissing
            ? `⚠️ (${displayProts}×)`
            : `${formatCoins(displayProtCost)} (${displayProts} × ${formatCoins(ep.protPrice)})`;
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
        .slice(0, 100);

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

    // Build item→sessions map for handle visibility
    const itemSessionMap = {}; // itemName → [{key, ri, isSuccess, groupId}]
    for (let ri = 0; ri < renderItems.length; ri++) {
        const item = renderItems[ri];
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

            // Top edge: outward group handle (only when all filters on)
            if (allFiltersOn) {
                const topItemName = topData.enhanceProfit?.itemName;
                const neighbor = topItemName ? findNeighbors(item.topKey, topItemName, 'up') : null;
                if (neighbor && canConnect(item.topKey, neighbor.key)) {
                    const placement = Math.abs(ri - neighbor.ri) === 1 ? 'floating' : 'on-card';
                    if (placement === 'on-card') {
                        groupHtml += renderHandle(item.topKey, neighbor.key, 'on-card', 'up');
                    }
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
                // Bottom card ungroup handle (only on last sub-card, which is the bottom edge)
                if (allFiltersOn && i === subDatas.length - 1) {
                    groupHtml += `<div class="ungroup-handle" onclick="ungroupSession('${subDatas[i].sessionKey}', event)" title="Detach bottom">⇕</div>`;
                }
                groupHtml += `</div>`;
            }

            // Bottom edge: outward group handle
            if (allFiltersOn) {
                const bottomKey = item.memberKeys[0]; // oldest
                const bottomData = displayData[bottomKey];
                const bottomItemName = bottomData?.enhanceProfit?.itemName;
                const neighbor = bottomItemName ? findNeighbors(bottomKey, bottomItemName, 'down') : null;
                if (neighbor && canConnect(bottomKey, neighbor.key)) {
                    const placement = Math.abs(ri - neighbor.ri) === 1 ? 'floating' : 'on-card';
                    if (placement === 'on-card') {
                        groupHtml += renderHandle(bottomKey, neighbor.key, 'on-card', 'down');
                    }
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

            // Check for handles in both directions (only when all filters on)
            let handleAbove = '';
            let handleBelow = '';
            if (allFiltersOn) {
                const upNeighbor = findNeighbors(d.sessionKey, myItem, 'up');
                if (upNeighbor && canConnect(d.sessionKey, upNeighbor.key)) {
                    const placement = Math.abs(ri - upNeighbor.ri) === 1 ? 'floating' : 'on-card';
                    if (placement === 'on-card') {
                        handleAbove = renderHandle(d.sessionKey, upNeighbor.key, 'on-card', 'up');
                    }
                    // Floating handles rendered between cards (below previous item)
                }
                const downNeighbor = findNeighbors(d.sessionKey, myItem, 'down');
                if (downNeighbor && canConnect(d.sessionKey, downNeighbor.key)) {
                    const placement = Math.abs(ri - downNeighbor.ri) === 1 ? 'floating' : 'on-card';
                    if (placement === 'on-card') {
                        handleBelow = renderHandle(d.sessionKey, downNeighbor.key, 'on-card', 'down');
                    }
                }
            }

            // Check if we should render a floating handle between this and previous item
            let floatingHandle = '';
            if (allFiltersOn && ri > 0) {
                const prevItem = filteredItems[ri - 1];
                const prevKey = prevItem.type === 'group' ? prevItem.memberKeys[0] : prevItem.sessionKey;
                const prevData = displayData[prevKey];
                const prevItemName = prevData?.enhanceProfit?.itemName;
                if (prevItemName === myItem && canConnect(d.sessionKey, prevKey)) {
                    floatingHandle = renderHandle(d.sessionKey, prevKey, 'floating', 'up');
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
    
    // Get loot timestamp for historical price lookup (moved up for use in mat/prot pricing)
    const lootTs = session.startTime ? Math.floor(new Date(session.startTime).getTime() / 1000) : Math.floor(Date.now() / 1000);
    
    // Get optimal protection level from calculator (instead of hardcoding 8)
    // The calculator finds the most cost-effective prot level for this item
    let protLevel = 8; // fallback
    if (calculator && typeof calculator.calculateEnhancementCost === 'function') {
        try {
            // Use highest level reached as target for prot calculation
            const targetForProt = Math.max(...Object.keys(levelDrops).map(Number), 10);
            // Build historical prices for the calculator
            const matHrids = (itemData?.enhancementCosts || []).map(c => c.item || c.itemHrid || c.hrid).filter(h => h !== '/items/coin');
            const protItemHridsForCalc = itemData?.protectionItems || [];
            const allHridsForCalc = [itemHrid, '/items/mirror_of_protection', ...matHrids, ...protItemHridsForCalc];
            const pricesAtTime = buildPricesAtTime(lootTs, allHridsForCalc);
            const calcResult = calculator.calculateEnhancementCost(itemHrid, targetForProt, pricesAtTime, 'pessimistic');
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
    
    // Check session price cache (preserves prices after history rolls off 7-day window)
    // New format has matPrices key; old format has matCostPerAction — treat old as cache miss (soft migration)
    const cachedPrices = getCachedSessionPrices(session.startTime);
    const useCached = cachedPrices && cachedPrices.matPrices; // prices don't change when session data updates
    
    // Calculate individual material prices and protection price
    let matPrices, matPriceMissing, protPrice, protPriceMissing, protHrid;
    
    if (useCached) {
        // Use cached individual prices (history may have rolled off)
        matPrices = cachedPrices.matPrices;
        matPriceMissing = cachedPrices.matPriceMissing;
        protPrice = cachedPrices.protPrice;
        protHrid = cachedPrices.protHrid;
        protPriceMissing = cachedPrices.protPriceMissing;
    } else {
        // Calculate from historical data — store individual mat prices
        matPrices = {};
        matPriceMissing = false;
        const enhanceCosts = itemData?.enhancementCosts || [];
        
        for (const cost of enhanceCosts) {
            const costHrid = cost.item || cost.itemHrid || cost.hrid;
            
            if (costHrid === '/items/coin') {
                matPrices[costHrid] = 1; // coins are always 1
            } else {
                const matPrice = getBuyPriceAtTime(costHrid, 0, lootTs, 'pessimistic');
                if (matPrice === 0) matPriceMissing = true;
                matPrices[costHrid] = matPrice;
            }
        }
        
        // Protection cost - use cheapest option (historical ask prices)
        const mirrorPrice = getBuyPriceAtTime('/items/mirror_of_protection', 0, lootTs, 'pessimistic');
        const baseItemPrice = getBuyPriceAtTime(itemHrid, 0, lootTs, 'pessimistic');
        
        protPrice = Infinity;
        protHrid = null;
        protPriceMissing = false;
        if (mirrorPrice > 0 && mirrorPrice < protPrice) {
            protPrice = mirrorPrice;
            protHrid = '/items/mirror_of_protection';
        }
        if (baseItemPrice > 0 && baseItemPrice < protPrice) {
            protPrice = baseItemPrice;
            protHrid = itemHrid;
        }
        
        const protItemHrids = itemData?.protectionItems || [];
        for (const pH of protItemHrids) {
            const price = getBuyPriceAtTime(pH, 0, lootTs, 'pessimistic');
            if (price > 0 && price < protPrice) {
                protPrice = price;
                protHrid = pH;
            }
        }
        
        if (protPrice === Infinity) {
            protPrice = 0;
            protHrid = null;
            if (protsUsed > 0) protPriceMissing = true;
        }
    }
    
    // Compute matCostPerAction from individual prices
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
    
    if (resultLevel >= 10 && (levelDrops[resultLevel] || 0) === 1) {
        // Single item at 10+ = completed enhancement, use for revenue
        isSuccessful = true;
        const sellPrice = prices.market?.[itemHrid]?.[String(resultLevel)]?.b || 0;
        if (sellPrice === 0) revenuePriceMissing = true;
        revenue = sellPrice;
        revenueBreakdown[resultLevel] = { count: 1, sellPrice, value: sellPrice };
    }
    
    // Calculate baseItemCost for ALL sessions (not just success — session might become successful later)
    if (useCached) {
        baseItemCost = cachedPrices.baseItemCost;
        baseItemSource = cachedPrices.baseItemSource;
        baseItemSourceIcon = cachedPrices.baseItemSourceIcon;
    } else {
        const baseEstimate = estimatePrice(itemHrid, 0, lootTs, 'pessimistic');
        baseItemCost = baseEstimate.price;
        baseItemSource = baseEstimate.source;
        baseItemSourceIcon = baseEstimate.sourceIcon;
    }
    
    const totalCost = totalMatCost + totalProtCost + (isSuccessful ? baseItemCost : 0);
    
    // Calculate estimated sale price for ALL sessions (at highest target level)
    // This way if session is toggled to success, we already have the estimate
    let estimatedSale = 0;
    let estimatedSaleSource = null;
    let estimatedSaleSourceIcon = null;
    let estimatedSaleLevel = 0;
    
    // Use resultLevel for success, highestTargetLevel for failures
    const saleLevelForEstimate = isSuccessful ? resultLevel : (highestTargetLevel || 10);
    
    if (saleLevelForEstimate >= 8) {
        // Bug fix: always recalculate if cached level doesn't match current level
        const cachedLevelMatches = useCached && (cachedPrices.estimatedSaleLevel === saleLevelForEstimate);
        if (cachedLevelMatches) {
            estimatedSale = cachedPrices.estimatedSale;
            estimatedSaleSource = cachedPrices.estimatedSaleSource;
            estimatedSaleSourceIcon = cachedPrices.estimatedSaleSourceIcon;
            estimatedSaleLevel = cachedPrices.estimatedSaleLevel;
        } else {
            // Prefer enhancement cost (what it costs to create) over market history for sale estimates
            const costToCreate = calculateCostToCreate(itemHrid, saleLevelForEstimate, lootTs, 'pessimistic');
            if (costToCreate > 0) {
                estimatedSale = costToCreate;
                estimatedSaleSource = 'enhance cost';
                estimatedSaleSourceIcon = '🪄';
            } else {
                // Fall back to estimatePrice (history) if cost calc fails
                const saleEstimate = estimatePrice(itemHrid, saleLevelForEstimate, lootTs, 'pessimistic');
                estimatedSale = saleEstimate.price;
                estimatedSaleSource = saleEstimate.source;
                estimatedSaleSourceIcon = saleEstimate.sourceIcon;
            }
            estimatedSaleLevel = saleLevelForEstimate;
        }
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
    
    // Calculate tea prices for caching (so they persist after history rolls off)
    const teaPrices_ultra = getBuyPriceAtTime('/items/ultra_enhancing_tea', 0, lootTs, 'pessimistic');
    const teaPrices_blessed = getBuyPriceAtTime('/items/blessed_tea', 0, lootTs, 'pessimistic');
    const teaPrices_wisdom = getBuyPriceAtTime('/items/wisdom_tea', 0, lootTs, 'pessimistic');
    
    // Cache resolved prices for this session (preserves correct prices after history rolls off)
    // Always write to update dataHash; prices are only computed fresh when !useCached
    const cacheEntry = {
        matPrices,
        itemName,
        protPrice,
        protHrid,
        baseItemCost,
        baseItemSource,
        baseItemSourceIcon,
        estimatedSale,
        estimatedSaleLevel,
        estimatedSaleSource,
        estimatedSaleSourceIcon,
        teaPrices: useCached && cachedPrices.teaPrices
            ? cachedPrices.teaPrices
            : { ultraEnhancing: teaPrices_ultra, blessed: teaPrices_blessed, wisdom: teaPrices_wisdom },
        matPriceMissing,
        protPriceMissing,
        dataHash: getSessionHash(session)
    };
    cacheSessionPrices(session.startTime, cacheEntry);
    
    // Use cached tea prices if available, otherwise freshly computed
    const sessionTeaPrices = useCached && cachedPrices.teaPrices
        ? cachedPrices.teaPrices
        : { ultraEnhancing: teaPrices_ultra, blessed: teaPrices_blessed, wisdom: teaPrices_wisdom };
    
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

// Get buy price at a specific timestamp using history, falling back to current market
// No craft fallback (avoids circular recursion with estimatePrice)
function getBuyPriceAtTime(hrid, level, lootTs, mode) {
    if (!lootTs) return getBuyPrice(hrid, level, mode);
    
    const key = `${hrid}:${level}`;
    const history = prices.history?.[key];
    
    if (history && history.length > 0) {
        const newestTs = history[0].t;
        const oldestTs = history[history.length - 1].t;
        
        if (lootTs >= newestTs) return history[0].p;
        if (lootTs <= oldestTs) return history[history.length - 1].p;
        
        for (const entry of history) {
            if (entry.t <= lootTs) return entry.p;
        }
    }
    
    // Fall back to current market price
    return getBuyPrice(hrid, level, mode);
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
            const price = lootTs ? getBuyPriceAtTime(cost.item, 0, lootTs, mode) : getBuyPrice(cost.item, 0, mode);
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
        const craftMats = getCraftingMaterials(itemHrid, mode, lootTs);
        return craftMats?.total || 0;
    }
    
    // Enhanced item: base item + enhancement costs from +0 to +level
    // Get base item cost - checks history first, falls back to craft cost
    const baseEstimate = estimatePrice(itemHrid, 0, lootTs, mode);
    const baseCost = baseEstimate.price;
    
    // Use calculator if available
    if (calculator && typeof calculator.calculateEnhancementCost === 'function') {
        try {
            // Build historical prices object for enhance-calc.js
            const item = gameData.items[itemHrid];
            const matHrids = (item?.enhancementCosts || []).map(c => c.item).filter(h => h !== '/items/coin');
            const protHrids = item?.protectionItems || [];
            const allHrids = [itemHrid, '/items/mirror_of_protection', ...matHrids, ...protHrids];
            const pricesAtTime = buildPricesAtTime(lootTs, allHrids);
            const calcResult = calculator.calculateEnhancementCost(itemHrid, level, pricesAtTime, mode);
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
        const price = lootTs ? getBuyPriceAtTime(input.item, 0, lootTs, mode) : getBuyPrice(input.item, 0, mode);
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
        const basePrice = lootTs ? getBuyPriceAtTime(baseItemHrid, 0, lootTs, mode) : getBuyPrice(baseItemHrid, 0, mode);
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
