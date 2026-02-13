// main.js - CowProfit rendering and interactivity
// Data loaded from data.js: window.GAME_DATA

const allData = window.GAME_DATA?.modes || {};
const playerStats = window.GAME_DATA?.playerStats || {};
const lastCheckTs = window.GAME_DATA?.lastCheckTs || 0;
const lastMarketTs = window.GAME_DATA?.lastMarketTs || 0;
const updateHistory = window.GAME_DATA?.updateHistory || [];

let currentMode = 'pessimistic';
let currentLevel = 'all';
let sortCol = 9; // Default to $/day column
let sortAsc = false;
let showFee = true; // Fee toggle on by default
let showSuperPessimistic = false; // Include mat loss toggle
let expandedRows = new Set();
let costFilters = { '100m': true, '500m': true, '1b': true, '2b': true, 'over2b': true };
let gearOpen = false;
let historyOpen = false;
let sortByMatPct = false;

const modeInfo = {
    'pessimistic': 'Buy at Ask, Sell at Bid (safest estimate)',
    'midpoint': 'Buy/Sell at midpoint of Ask and Bid',
    'optimistic': 'Buy at Bid, Sell at Ask (best case)'
};

// Formatting helpers
function formatAge(seconds) {
    if (!seconds || seconds <= 0) return '-';
    if (seconds < 60) return Math.floor(seconds) + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h';
    return (seconds / 86400).toFixed(1) + 'd';
}

function getAgeArrow(direction) {
    if (direction === 'up') return '<span class="price-up">↑</span>';
    if (direction === 'down') return '<span class="price-down">↓</span>';
    return '-';
}

function formatTimeAgo(ts) {
    if (!ts) return '-';
    const seconds = Math.floor(Date.now() / 1000) - ts;
    if (seconds < 60) return Math.floor(seconds) + 's ago';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h ago';
    return (seconds / 86400).toFixed(1) + 'd ago';
}

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

// Time updates
function updateTimes() {
    document.getElementById('time-check').textContent = formatTimeAgo(lastCheckTs);
    document.getElementById('time-market').textContent = formatTimeAgo(lastMarketTs);
}

// History dropdown
function toggleHistory(e) {
    if (e) e.stopPropagation();
    historyOpen = !historyOpen;
    const panel = document.getElementById('history-panel');
    panel.classList.toggle('visible', historyOpen);
    document.getElementById('history-arrow').innerHTML = historyOpen ? '&#9650;' : '&#9660;';
    if (historyOpen) renderHistoryPanel();
}

function renderHistoryPanel() {
    const entries = updateHistory.map(h => `
        <div class="history-entry">
            <span class="time">${new Date(h.ts * 1000).toLocaleString()}</span>
            <span class="ago">${formatTimeAgo(h.ts)}</span>
        </div>
    `).join('');
    document.getElementById('history-panel').innerHTML = `
        <h5>Market Update History</h5>
        ${entries || '<div class="history-entry">No history yet</div>'}
    `;
}

// Inventory data (set via event from userscript)
let inventoryData = null;

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
    
    // Enhancement materials (per attempt * actions)
    if (r.materials) {
        for (const m of r.materials) {
            const needed = m.count * r.actions;
            const owned = Math.min(getInventoryCount(m.hrid), needed);
            const price = m.price || 0;
            totalValue += needed * price;
            ownedValue += owned * price;
        }
    }
    
    // Protection items
    if (r.protect_hrid && r.protect_count > 0) {
        const needed = Math.ceil(r.protect_count);
        const owned = Math.min(getInventoryCount(r.protect_hrid), needed);
        const price = r.protect_price || 0;
        totalValue += needed * price;
        ownedValue += owned * price;
    }
    
    if (totalValue === 0) return 100;
    return (ownedValue / totalValue) * 100;
}

// Listen for inventory data from userscript
window.addEventListener('cowprofit-inventory-loaded', function(e) {
    console.log('[CowProfit] Inventory event received:', e.detail);
    inventoryData = e.detail;
    console.log('[CowProfit] hasInventory():', hasInventory());
    renderTable();
});

// Gear dropdown
function toggleGear() {
    gearOpen = !gearOpen;
    document.getElementById('gear-panel').classList.toggle('visible', gearOpen);
    document.getElementById('gear-arrow').innerHTML = gearOpen ? '&#9650;' : '&#9660;';
    if (gearOpen) renderGearPanel();
}

function renderGearPanel() {
    const s = playerStats;
    if (!s || !s.enhancing_level) {
        document.getElementById('gear-panel').innerHTML = '<div style="padding:10px;color:#888;">No player stats available</div>';
        return;
    }
    document.getElementById('gear-panel').innerHTML = `
        <div class="gear-section">
            <h5>&#x1F3AF; Enhancing</h5>
            <div class="gear-row"><span class="label">Base Level</span><span class="value">${s.enhancing_level}</span></div>
            <div class="gear-row"><span class="label">Effective Level</span><span class="value highlight">${s.effective_level.toFixed(1)}</span></div>
            <div class="gear-row"><span class="label">Observatory</span><span class="value">+${s.observatory}</span></div>
        </div>
        <div class="gear-section">
            <h5>&#x1F527; Tool & Success</h5>
            <div class="gear-row"><span class="label">${s.enhancer} +${s.enhancer_level}</span><span class="value">+${s.enhancer_success.toFixed(2)}%</span></div>
            <div class="gear-row"><span class="label">Achievement Bonus</span><span class="value">+${s.achievement_success.toFixed(2)}%</span></div>
            <div class="gear-row"><span class="label">Total Success Bonus</span><span class="value highlight">+${s.total_success_bonus.toFixed(2)}%</span></div>
        </div>
        <div class="gear-section">
            <h5>&#x26A1; Speed Bonuses</h5>
            <div class="gear-row"><span class="label">Gloves +${s.gloves_level}</span><span class="value">+${s.gloves_speed.toFixed(2)}%</span></div>
            <div class="gear-row"><span class="label">Top +${s.top_level}</span><span class="value">+${s.top_speed.toFixed(2)}%</span></div>
            <div class="gear-row"><span class="label">Bot +${s.bot_level}</span><span class="value">+${s.bot_speed.toFixed(2)}%</span></div>
            <div class="gear-row"><span class="label">Neck +${s.neck_level} (5x)</span><span class="value">+${s.neck_speed.toFixed(2)}%</span></div>
            <div class="gear-row"><span class="label">Buff Lvl ${s.buff_level}</span><span class="value">+${s.buff_speed.toFixed(2)}%</span></div>
            <div class="gear-row"><span class="label">${s.tea_name || 'No'} Tea</span><span class="value">+${s.tea_speed.toFixed(2)}%</span></div>
        </div>
        <div class="gear-section">
            <h5>&#x1F375; Active Teas</h5>
            <div class="gear-row"><span class="label">Blessed Tea</span><span class="value">${s.tea_blessed ? '✓' : '✗'}</span></div>
            <div class="gear-row"><span class="label">Wisdom Tea</span><span class="value">${s.tea_wisdom ? '✓' : '✗'}</span></div>
            <div class="gear-row"><span class="label">Artisan Tea</span><span class="value">${s.artisan_tea ? s.artisan_reduction.toFixed(2) + '% craft red.' : '✗'}</span></div>
            <div class="gear-row"><span class="label">Guzzling Bonus</span><span class="value highlight">${s.guzzling_bonus.toFixed(4)}x</span></div>
        </div>
        <div class="gear-section">
            <h5>&#x1F48E; Charm</h5>
            <div class="gear-row"><span class="label">${s.charm_tier.charAt(0).toUpperCase() + s.charm_tier.slice(1)} +${s.charm_level}</span><span class="value">XP bonus</span></div>
        </div>
    `;
}

// Toggle controls
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

function getCostBucket(totalCost) {
    if (totalCost < 100e6) return '100m';
    if (totalCost < 500e6) return '500m';
    if (totalCost < 1e9) return '1b';
    if (totalCost < 2e9) return '2b';
    return 'over2b';
}

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

function sortTable(col, type) {
    if (col === 0 && hasInventory()) {
        // For item column with inventory: toggle between name sort and mat% sort
        if (sortCol === 0) {
            if (sortByMatPct) {
                if (!sortAsc) {
                    sortAsc = true; // mat% asc
                } else {
                    sortByMatPct = false; // switch to name
                    sortAsc = true;
                }
            } else {
                if (sortAsc) {
                    sortAsc = false; // name desc
                } else {
                    sortByMatPct = true; // switch to mat%
                    sortAsc = false; // mat% desc (highest first)
                }
            }
        } else {
            sortCol = 0;
            sortByMatPct = true;
            sortAsc = false;
        }
    } else {
        sortByMatPct = false;
        if (sortCol === col) {
            sortAsc = !sortAsc;
        } else {
            sortCol = col;
            sortAsc = (col === 0);
        }
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

// Shopping list for detail row - always shows (0 owned if no inventory)
function renderShoppingList(r) {
    let rows = '';
    const invLoaded = hasInventory();
    let totalCost = 0;
    
    // Materials
    if (r.materials) {
        for (const m of r.materials) {
            const needed = m.count * r.actions; // Keep decimals
            const owned = invLoaded ? getInventoryCount(m.hrid) : 0;
            const toBuy = Math.max(0, needed - owned);
            const lineCost = toBuy * (m.price || 0);
            totalCost += lineCost;
            rows += `<div class="shop-row">
                <span class="shop-name">${m.name}</span>
                <span class="shop-owned ${owned >= needed ? 'complete' : ''}">${invLoaded ? owned.toLocaleString() : '-'}</span>
                <span class="shop-need">${needed.toFixed(1)}</span>
                <span class="shop-cost">${formatCoins(lineCost)}</span>
            </div>`;
        }
    }
    
    // Protection item
    if (r.protect_hrid && r.protect_count > 0) {
        const needed = r.protect_count; // Keep decimals
        const owned = invLoaded ? getInventoryCount(r.protect_hrid) : 0;
        const toBuy = Math.max(0, needed - owned);
        const lineCost = toBuy * (r.protect_price || 0);
        totalCost += lineCost;
        rows += `<div class="shop-row prot-row">
            <span class="shop-name">${r.protect_name} - prot @ ${r.protect_at}</span>
            <span class="shop-owned ${owned >= needed ? 'complete' : ''}">${invLoaded ? owned.toLocaleString() : '-'}</span>
            <span class="shop-need">${needed.toFixed(1)}</span>
            <span class="shop-cost">${formatCoins(lineCost)}</span>
        </div>`;
    }
    
    if (!rows) return ''; // No materials or protection
    
    // Total row
    rows += `<div class="shop-row total-row">
        <span class="shop-name">Total</span>
        <span class="shop-owned"></span>
        <span class="shop-need"></span>
        <span class="shop-cost">${formatCoins(totalCost)}</span>
    </div>`;
    
    // Calculate overall material % for progress bar
    const matPct = calculateMatPercent(r);
    const pctDisplay = matPct !== null ? `${matPct.toFixed(0)}%` : '';
    const barWidth = matPct !== null ? matPct.toFixed(1) : 0;
    
    return `<div class="detail-section shopping-list">
        <h4>&#x1F6D2; Shopping List${invLoaded ? '' : ' <span class="price-note">(no inventory)</span>'} ${matPct !== null ? `<span class="shop-pct-bar"><span class="shop-pct-fill" style="width:${barWidth}%"></span><span class="shop-pct-text">${pctDisplay}</span></span>` : ''}</h4>
        <div class="shop-header">
            <span class="shop-col">Material</span>
            <span class="shop-col">Owned</span>
            <span class="shop-col">Need</span>
            <span class="shop-col">Cost</span>
        </div>
        ${rows}
    </div>`;
}

// Detail row rendering
function renderDetailRow(r) {
    const priceLabel = currentMode === 'pessimistic' ? 'ask' : currentMode === 'optimistic' ? 'bid' : 'mid';
    
    // Craft materials under base item if source is craft
    let craftMatsHtml = '';
    if (r.base_source === 'craft' && r.craft_materials && r.craft_materials.length > 0) {
        craftMatsHtml = r.craft_materials.map(m => 
            `<div class="mat-row">
                <span class="mat-name">${m.name}</span>
                <span class="mat-count">${m.count.toFixed(2)}x @ ${formatCoins(m.price)}</span>
                <span class="mat-price">${formatCoins(m.count * m.price)}</span>
            </div>`
        ).join('');
        const craftTotal = r.craft_materials.reduce((sum, m) => sum + m.count * m.price, 0);
        craftMatsHtml = `<div class="craft-breakdown">
            ${craftMatsHtml}
            <div class="mat-row total-row">
                <span class="mat-name">Craft Total</span>
                <span class="mat-count"></span>
                <span class="mat-price">${formatCoins(craftTotal)}</span>
            </div>
        </div>`;
    }
    
    // Enhancement materials per attempt
    let matsPerAttempt = 0;
    let matsHtml = '';
    if (r.materials && r.materials.length > 0) {
        matsHtml = r.materials.map(m => {
            const lineTotal = m.count * m.price;
            matsPerAttempt += lineTotal;
            return `<div class="mat-row">
                <span class="mat-name">${m.name}</span>
                <span class="mat-count">${m.count.toFixed(0)}x @ ${formatCoins(m.price)}</span>
                <span class="mat-price">${formatCoins(lineTotal)}</span>
            </div>`;
        }).join('');
    }
    if (r.coin_cost > 0) {
        matsPerAttempt += r.coin_cost;
        matsHtml += `<div class="mat-row">
            <span class="mat-name">Coins</span>
            <span class="mat-count"></span>
            <span class="mat-price">${formatCoins(r.coin_cost)}</span>
        </div>`;
    }
    const costPerAttempt = matsPerAttempt;
    const totalEnhanceCost = costPerAttempt * r.actions;
    const totalProtCost = r.protect_price * r.protect_count;
    
    // Price display
    let priceHtml = '';
    if (r.last_price && r.tracked_price && r.price_since_ts) {
        const pctChange = ((r.tracked_price - r.last_price) / r.last_price * 100).toFixed(1);
        const pctClass = pctChange > 0 ? 'positive' : 'negative';
        priceHtml = `<div class="detail-line">
            <span class="label">Sell price (bid)</span>
            <span class="value ${pctClass}">${formatCoins(r.last_price)} → ${formatCoins(r.tracked_price)} (${pctChange > 0 ? '+' : ''}${pctChange}%)</span>
        </div>`;
    } else {
        priceHtml = `<div class="detail-line">
            <span class="label">Sell price (+${r.target_level})</span>
            <span class="value">${formatCoins(r.sell_price)}</span>
        </div>`;
    }
    if (r.price_since_ts) {
        const ageStr = formatAge(Math.floor(Date.now()/1000) - r.price_since_ts);
        const sinceDate = new Date(r.price_since_ts * 1000).toLocaleString();
        priceHtml += `<div class="detail-line">
            <span class="label">Since</span>
            <span class="value">${sinceDate} (${ageStr})</span>
        </div>`;
    }
    
    const marketPrice = r.base_source === 'craft' ? r.alt_price : r.base_price;
    const craftPrice = r.base_source === 'craft' ? r.base_price : r.alt_price;
    const marketPriceStr = marketPrice > 0 ? formatCoins(marketPrice) : '--';
    const craftPriceStr = craftPrice > 0 ? formatCoins(craftPrice) : '--';
    
    let baseItemHtml;
    if (r.base_source === 'craft') {
        // Craft is cheaper - show market (small) above craft (main) with breakdown
        baseItemHtml = `
            <div class="detail-line">
                <span class="label">Market price</span>
                <span class="value alt">${marketPriceStr}</span>
            </div>
            <div class="detail-line">
                <span class="label">Craft price</span>
                <span class="value">${craftPriceStr}</span>
            </div>
            ${craftMatsHtml}`;
    } else {
        // Market is cheaper - show market (main) above craft (small)
        baseItemHtml = `
            <div class="detail-line">
                <span class="label">Market price</span>
                <span class="value">${marketPriceStr}</span>
            </div>
            <div class="detail-line">
                <span class="label">Craft price</span>
                <span class="value alt">${craftPriceStr}</span>
            </div>`;
    }
    
    return `<div class="detail-content">
        <div class="detail-section">
            <h4>&#x1F4E6; Base Item</h4>
            ${baseItemHtml}
        </div>
        
        ${renderShoppingList(r)}
        
        <div class="detail-section">
            <h4>&#x1F527; Materials</h4>
            ${matsHtml || '<div class="detail-line"><span class="label">None</span></div>'}
            <div class="mat-row total-row">
                <span class="mat-name">Total (${formatCoins(costPerAttempt)}/attempt × ${r.actions.toFixed(0)})</span>
                <span class="mat-count"></span>
                <span class="mat-price">${formatCoins(totalEnhanceCost)}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <h4>&#x1F4B0; Cost Summary</h4>
            <div class="detail-line">
                <span class="label">Base item</span>
                <span class="value">${formatCoins(r.base_price)}</span>
            </div>
            <div class="detail-line">
                <span class="label">Materials (${r.actions.toFixed(0)} attempts)</span>
                <span class="value">${formatCoins(totalEnhanceCost)}</span>
            </div>
            <div class="detail-line">
                <span class="label">${r.protect_name || 'Protection'} @ ${r.protect_at} (${formatCoins(r.protect_price)} × ${r.protect_count.toFixed(1)})</span>
                <span class="value">${formatCoins(totalProtCost)}</span>
            </div>
            <div class="mat-row total-row">
                <span class="mat-name">Total Cost</span>
                <span class="mat-count"></span>
                <span class="mat-price">${formatCoins(r.total_cost)}</span>
            </div>
        </div>
        
        <div class="detail-section">
            <h4>&#x1F4C8; Sell & Time</h4>
            ${priceHtml}
            <div class="detail-line">
                <span class="label">Time (${r.actions.toFixed(0)} attempts)</span>
                <span class="value">${r.time_hours.toFixed(1)}h (${r.time_days.toFixed(2)}d)</span>
            </div>
            <div class="detail-line">
                <span class="label">XP earned</span>
                <span class="value">${formatXP(r.total_xp)}</span>
            </div>
        </div>
    </div>`;
}

// Main table rendering
function renderTable() {
    const data = allData[currentMode] || [];
    
    // Filter by level
    let filtered = currentLevel === 'all' ? data : 
        data.filter(r => r.target_level == currentLevel);
    
    // Filter by cost buckets
    filtered = filtered.filter(r => costFilters[getCostBucket(r.total_cost)]);
    
    const profitKey = showFee ? 'profit_after_fee' : 'profit';
    const profitDayKey = showFee ? 'profit_per_day_after_fee' : 'profit_per_day';
    const roiKey = showFee ? 'roi_after_fee' : 'roi';
    
    // Add computed fields with super pessimistic adjustment
    filtered = filtered.map((r, i) => {
        let profit = r[profitKey];
        let profitDay = r[profitDayKey];
        const roi = r[roiKey] || r.roi;
        
        // Super pessimistic: subtract loss from selling 33% leftover mats
        if (showSuperPessimistic) {
            const matLoss = r.mat_cost * 0.33 * (1 - 0.882);
            const protLoss = (r.protect_price * r.protect_count) * 0.33 * (1 - 0.882);
            const totalLoss = matLoss + protLoss;
            profit -= totalLoss;
            profitDay = r.time_days > 0 ? profit / r.time_days : 0;
        }
        
        return {
            ...r, 
            _profit: profit, 
            _profit_day: profitDay,
            _roi: roi
        };
    });
    
    // Add computed _age and _mat_pct fields for sorting
    const nowTs = Math.floor(Date.now() / 1000);
    filtered = filtered.map(r => ({
        ...r, 
        _age: r.price_since_ts ? nowTs - r.price_since_ts : 0,
        _mat_pct: calculateMatPercent(r) ?? -1
    }));
    
    // Sorting
    if (sortCol === 0 && hasInventory() && sortByMatPct) {
        filtered.sort((a, b) => {
            if (a._mat_pct !== b._mat_pct) {
                return sortAsc ? a._mat_pct - b._mat_pct : b._mat_pct - a._mat_pct;
            }
            return a.item_name.localeCompare(b.item_name);
        });
    } else {
        const sortKeys = ['item_name', 'target_level', '_age', 'base_price', 'mat_cost', 'total_cost', 'sell_price', '_profit', '_roi', '_profit_day', 'time_days', 'xp_per_day'];
        filtered.sort((a, b) => {
            let va = a[sortKeys[sortCol]];
            let vb = b[sortKeys[sortCol]];
            if (typeof va === 'string') {
                return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            return sortAsc ? va - vb : vb - va;
        });
    }
    
    // Stats
    const profitable = data.filter(r => r[profitKey] > 1000000 && (r[roiKey] || r.roi) < 1000);
    const bestProfit = profitable.length ? Math.max(...profitable.map(r => r[profitKey])) : 0;
    const bestRoi = profitable.length ? Math.max(...profitable.map(r => r[roiKey] || r.roi)) : 0;
    const bestProfitDay = profitable.length ? Math.max(...profitable.map(r => r[profitDayKey])) : 0;
    const bestXpDay = data.length ? Math.max(...data.map(r => r.xp_per_day)) : 0;
    
    document.getElementById('stat-profitable').textContent = profitable.length;
    document.getElementById('stat-roi').textContent = bestRoi.toFixed(0) + '%';
    document.getElementById('stat-profit').textContent = formatCoins(bestProfit);
    document.getElementById('stat-profitday').textContent = formatCoins(bestProfitDay);
    document.getElementById('stat-xpday').textContent = formatXP(bestXpDay);
    
    const tbody = document.getElementById('table-body');
    let html = '';
    
    // Calculate max profit/day for bar scaling
    const displayItems = filtered.slice(0, 400);
    const maxProfitDay = Math.max(...displayItems.map(r => r._profit_day || 0), 1);
    const minProfitDay = Math.min(...displayItems.map(r => r._profit_day || 0), 0);
    
    displayItems.forEach((r, i) => {
        const rowId = r.item_hrid + '_' + r.target_level;
        const isExpanded = expandedRows.has(rowId);
        const profit = r._profit;
        const profitDay = r._profit_day;
        const roi = r._roi;
        const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';
        const sourceClass = r.base_source === 'market' ? 'source-market' : r.base_source === 'craft' ? 'source-craft' : 'source-vendor';
        
        // Calculate bar width as % of max
        let barWidth = 0;
        let barClass = 'positive';
        if (profitDay > 0) {
            barWidth = (profitDay / maxProfitDay) * 100;
        } else if (profitDay < 0 && minProfitDay < 0) {
            barWidth = (profitDay / minProfitDay) * 100;
            barClass = 'negative';
        }
        
        const matPct = calculateMatPercent(r);
        const matBarStyle = matPct !== null ? `width:${matPct.toFixed(1)}%` : 'display:none';
        
        html += `<tr class="data-row ${isExpanded ? 'expanded' : ''}" onclick="toggleRow('${rowId}')" data-level="${r.target_level}" data-matpct="${matPct !== null ? matPct : -1}">
            <td class="item-name"><div class="mat-pct-bar" style="${matBarStyle}"></div><span class="expand-icon">&#9654;</span>${r.item_name}</td>
            <td><span class="level-badge">+${r.target_level}</span></td>
            <td class="number">${formatAge(r._age)} ${getAgeArrow(r.price_direction)}</td>
            <td class="number"><span class="price-source ${sourceClass}"></span>${formatCoins(r.base_price)}</td>
            <td class="number hide-mobile">${formatCoins(r.mat_cost)}</td>
            <td class="number hide-mobile">${formatCoins(r.total_cost)}</td>
            <td class="number cost-${getCostBucket(r.total_cost)}" style="text-align:center">${formatCoins(r.sell_price)}</td>
            <td class="number ${profitClass}">${formatCoins(profit)}</td>
            <td class="number ${profitClass}">${roi.toFixed(1)}%</td>
            <td class="number profit-bar-cell ${profitClass}"><div class="profit-bar ${barClass}" style="width:${barWidth.toFixed(1)}%"></div><span class="profit-bar-value">${formatCoins(profitDay)}</span></td>
            <td class="number hide-mobile">${r.time_days.toFixed(2)}</td>
            <td class="number hide-mobile">${formatXP(r.xp_per_day)}</td>
        </tr>`;
        
        html += `<tr class="detail-row ${isExpanded ? 'visible' : ''}">
            <td colspan="12">${renderDetailRow(r)}</td>
        </tr>`;
    });
    
    tbody.innerHTML = html;
    
    // Update sort indicators
    document.querySelectorAll('th').forEach((th, i) => {
        th.classList.toggle('sorted', i === sortCol);
        const arrow = th.querySelector('.sort-arrow');
        if (arrow) arrow.innerHTML = (i === sortCol && sortAsc) ? '&#9650;' : '&#9660;';
    });
}

// Close panels when clicking outside
document.addEventListener('click', function(e) {
    if (gearOpen && !e.target.closest('.gear-dropdown')) {
        gearOpen = false;
        document.getElementById('gear-panel').classList.remove('visible');
        document.getElementById('gear-arrow').innerHTML = '&#9660;';
    }
    if (historyOpen && !e.target.closest('.history-dropdown')) {
        historyOpen = false;
        document.getElementById('history-panel').classList.remove('visible');
        document.getElementById('history-arrow').innerHTML = '&#9660;';
    }
});

// Initialize
renderTable();
updateTimes();
setInterval(updateTimes, 60000);
