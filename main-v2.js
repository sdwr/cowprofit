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

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.gear-dropdown') && !e.target.closest('.history-dropdown')) {
        gearOpen = false;
        historyOpen = false;
        document.getElementById('gear-panel')?.classList.remove('visible');
        document.getElementById('history-panel')?.classList.remove('visible');
        const gearArrow = document.getElementById('gear-arrow');
        const histArrow = document.getElementById('history-arrow');
        if (gearArrow) gearArrow.innerHTML = '&#9660;';
        if (histArrow) histArrow.innerHTML = '&#9660;';
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
        expandedRows.add(rowId);
    }
    renderTable();
}

// Get material details for an item
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
            // Get buy price based on mode
            const matPrices = prices.market[cost.item]?.['0'] || {};
            let price = 0;
            if (mode === 'pessimistic') {
                price = matPrices.a || matPrices.b || 0;
            } else if (mode === 'optimistic') {
                price = matPrices.b || matPrices.a || 0;
            } else {
                const ask = matPrices.a || 0;
                const bid = matPrices.b || 0;
                price = (ask && bid) ? (ask + bid) / 2 : (ask || bid);
            }
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
    
    // Get direction if there's a previous entry
    let direction = null;
    if (history.length > 1) {
        const prevPrice = history[1].p;
        if (currentEntry.p > prevPrice) direction = 'up';
        else if (currentEntry.p < prevPrice) direction = 'down';
    }
    
    return { age, direction, price: currentEntry.p, since: currentEntry.t };
}

// Get crafting materials for an item
function getCraftingMaterials(itemHrid, mode) {
    const recipe = gameData.recipes[itemHrid];
    if (!recipe || !recipe.inputs) return null;
    
    const materials = [];
    let total = 0;
    
    for (const input of recipe.inputs) {
        const matItem = gameData.items[input.item];
        const matName = matItem?.name || input.item.split('/').pop().replace(/_/g, ' ');
        const matPrices = prices.market[input.item]?.['0'] || {};
        let price = 0;
        if (mode === 'pessimistic') {
            price = matPrices.a || matPrices.b || 0;
        } else if (mode === 'optimistic') {
            price = matPrices.b || matPrices.a || 0;
        } else {
            const ask = matPrices.a || 0;
            const bid = matPrices.b || 0;
            price = (ask && bid) ? (ask + bid) / 2 : (ask || bid);
        }
        const lineTotal = input.count * price;
        total += lineTotal;
        materials.push({
            name: matName,
            count: input.count,
            price: price,
            total: lineTotal
        });
    }
    
    return { materials, total };
}

// Render detail row
function renderDetailRow(r) {
    const modeMap = { pessimistic: PriceMode.PESSIMISTIC, midpoint: PriceMode.MIDPOINT, optimistic: PriceMode.OPTIMISTIC };
    const mode = modeMap[currentMode];
    
    // Get enhancement materials
    const materials = getMaterialDetails(r.item_hrid, r.actions, mode);
    const artisanMult = calculator?.getArtisanTeaMultiplier() || 1;
    
    // Materials HTML
    let matsHtml = '';
    let matsPerAttempt = 0;
    for (const m of materials) {
        const adjusted = m.name === 'Coins' ? m.count : m.count * artisanMult;
        const lineTotal = m.price * adjusted;
        matsPerAttempt += lineTotal;
        matsHtml += `<div class="mat-row">
            <span class="mat-name">${m.name}</span>
            <span class="mat-count">${adjusted.toFixed(m.name === 'Coins' ? 0 : 2)}x @ ${formatCoins(m.price)}</span>
            <span class="mat-price">${formatCoins(lineTotal)}</span>
        </div>`;
    }
    const totalMatCost = matsPerAttempt * r.actions;
    const totalProtCost = r.protectPrice * r.protectCount;
    
    // Protection item name
    const protItem = gameData.items[r.protectHrid];
    const protName = protItem?.name || (r.protectHrid ? r.protectHrid.split('/').pop().replace(/_/g, ' ') : 'Protection');
    
    // Base item section - check for craft alternative
    const marketPrices = prices.market[r.item_hrid]?.['0'] || {};
    const marketPrice = mode === 'pessimistic' ? (marketPrices.a || 0) : mode === 'optimistic' ? (marketPrices.b || 0) : ((marketPrices.a || 0) + (marketPrices.b || 0)) / 2;
    const craftData = getCraftingMaterials(r.item_hrid, mode);
    
    let baseItemHtml = '';
    if (r.baseSource === 'craft' && craftData) {
        // Craft is cheaper
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
    
    // Price history/age
    const priceInfo = getPriceAge(r.item_hrid, r.target_level);
    let priceHtml = `<div class="detail-line">
        <span class="label">Sell price (+${r.target_level})</span>
        <span class="value">${formatCoins(r.sellPrice)}</span>
    </div>`;
    if (priceInfo) {
        const ageStr = formatAge(priceInfo.age);
        const sinceDate = new Date(priceInfo.since * 1000).toLocaleString();
        const dirArrow = priceInfo.direction === 'up' ? '<span class="price-up">↑</span>' : 
                         priceInfo.direction === 'down' ? '<span class="price-down">↓</span>' : '';
        priceHtml += `<div class="detail-line">
            <span class="label">Price age</span>
            <span class="value">${ageStr} ${dirArrow}</span>
        </div>
        <div class="detail-line">
            <span class="label">Since</span>
            <span class="value">${sinceDate}</span>
        </div>`;
    }
    
    const profitClass = r.profit > 0 ? 'positive' : r.profit < 0 ? 'negative' : 'neutral';
    
    return `<div class="detail-content">
        <div class="detail-section">
            <h4>📦 Base Item</h4>
            ${baseItemHtml}
        </div>
        
        <div class="detail-section">
            <h4>🔧 Materials <span class="price-note">(per attempt)</span></h4>
            ${matsHtml || '<div class="detail-line"><span class="label">None</span></div>'}
            <div class="mat-row total-row">
                <span class="mat-name">Total (${formatCoins(matsPerAttempt)}/attempt × ${r.actions.toFixed(0)})</span>
                <span class="mat-count"></span>
                <span class="mat-price">${formatCoins(totalMatCost)}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <h4>💰 Cost Summary</h4>
            <div class="detail-line">
                <span class="label">Base item</span>
                <span class="value">${formatCoins(r.basePrice)}</span>
            </div>
            <div class="detail-line">
                <span class="label">Materials (${r.actions.toFixed(0)} attempts)</span>
                <span class="value">${formatCoins(totalMatCost)}</span>
            </div>
            <div class="detail-line">
                <span class="label">${protName} @ ${r.protectAt} (${formatCoins(r.protectPrice)} × ${r.protectCount.toFixed(1)})</span>
                <span class="value">${formatCoins(totalProtCost)}</span>
            </div>
            <div class="mat-row total-row">
                <span class="mat-name">Total Cost</span>
                <span class="mat-count"></span>
                <span class="mat-price">${formatCoins(r.totalCost)}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <h4>📈 Sell & Profit</h4>
            ${priceHtml}
            <div class="detail-line">
                <span class="label">Profit</span>
                <span class="value ${profitClass}">${formatCoins(r.profit)}</span>
            </div>
            <div class="detail-line">
                <span class="label">After 2% fee</span>
                <span class="value ${profitClass}">${formatCoins(r.profitAfterFee)}</span>
            </div>
            <div class="detail-line">
                <span class="label">Time (${r.actions.toFixed(0)} attempts)</span>
                <span class="value">${r.timeHours.toFixed(1)}h (${r.timeDays.toFixed(2)}d)</span>
            </div>
            <div class="detail-line">
                <span class="label">XP earned</span>
                <span class="value">${formatXP(r.totalXp)}</span>
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
        const ageArrow = priceInfo?.direction === 'up' ? '<span class="price-up">↑</span>' : 
                         priceInfo?.direction === 'down' ? '<span class="price-down">↓</span>' : '';
        
        let barWidth = 0;
        let barClass = 'positive';
        if (profitDay > 0) {
            barWidth = (profitDay / maxProfitDay) * 100;
        } else if (profitDay < 0 && minProfitDay < 0) {
            barWidth = (profitDay / minProfitDay) * 100;
            barClass = 'negative';
        }
        
        html += `<tr class="data-row ${isExpanded ? 'expanded' : ''}" onclick="toggleRow('${rowId}')" data-level="${r.target_level}">
            <td class="item-name"><span class="expand-icon">▶</span>${r.item_name}</td>
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
