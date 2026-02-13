// ==UserScript==
// @name         CowProfit Inventory Bridge
// @namespace    https://github.com/sdwr/cowprofit
// @version      1.1.0
// @description  Captures MWI inventory, coins, and loot history - bridges to CowProfit via Tampermonkey storage
// @author       sdwr
// @license      MIT
// @match        https://www.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://sdwr.github.io/cowprofit/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/sdwr/cowprofit/main/cowprofit-inventory.user.js
// @updateURL    https://raw.githubusercontent.com/sdwr/cowprofit/main/cowprofit-inventory.user.js
// ==/UserScript==

(function () {
    'use strict';

    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('%c[CowProfit]', 'color: #eeb357; font-weight: bold', ...args);
    const error = (...args) => console.error('%c[CowProfit]', 'color: red; font-weight: bold', ...args);

    const STORAGE_KEY = 'cowprofit_inventory';
    const LOOT_STORAGE_KEY = 'cowprofit_loot_history';

    // Detect which site we're on
    const isGameSite = window.location.hostname.includes('milkywayidle');
    const isCowProfit = window.location.hostname === 'sdwr.github.io' && window.location.pathname.includes('cowprofit');

    if (isGameSite) {
        log('Running on MWI game site - hooking WebSocket');
        hookWebSocket();
        addExportUI();
    } else if (isCowProfit) {
        log('Running on CowProfit - loading inventory data');
        loadInventoryData();
    }

    // ============================================
    // GAME SITE: Capture inventory from WebSocket
    // ============================================

    function hookWebSocket() {
        const dataProperty = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
        const originalGet = dataProperty.get;

        dataProperty.get = function () {
            const socket = this.currentTarget;
            if (!(socket instanceof WebSocket)) {
                return originalGet.call(this);
            }

            // Only hook MWI WebSocket
            const url = socket.url || '';
            if (!url.includes('api.milkywayidle') && !url.includes('api-test.milkywayidle')) {
                return originalGet.call(this);
            }

            const message = originalGet.call(this);
            Object.defineProperty(this, "data", { value: message }); // Prevent infinite loop

            try {
                handleMessage(message);
            } catch (e) {
                error('Error handling WebSocket message:', e);
            }

            return message;
        };

        Object.defineProperty(MessageEvent.prototype, "data", dataProperty);
        log('WebSocket hooked successfully');
    }

    function handleMessage(message) {
        let data;
        try {
            data = JSON.parse(message);
        } catch {
            return; // Not JSON
        }

        // Debug: Log all message types for discovery
        if (DEBUG) {
            // Only log interesting message types (skip frequent ones)
            const skipTypes = ['client_heartbeat', 'server_heartbeat', 'chat_message'];
            if (!skipTypes.includes(data.type)) {
                log('WS Message:', data.type, data);
            }
        }

        if (data.type === 'init_character_data') {
            log('Received init_character_data');
            processCharacterData(data);
        } else if (data.type === 'items_updated') {
            // Incremental update - merge with stored data
            log('Received items_updated');
            processItemsUpdate(data);
        } else if (data.type === 'marketplace_item_order_filled' || 
                   data.type === 'marketplace_item_order_updated') {
            // Market transaction - track for profit history
            log('Market transaction:', data);
            processMarketTransaction(data);
        } else if (data.type === 'loot_log_updated') {
            // Loot log from game (Edible Tools format)
            log('Received loot_log_updated');
            processLootLog(data);
        }
    }

    function processLootLog(data) {
        const lootLog = data.lootLog || [];
        if (!lootLog.length) {
            log('Empty loot log, skipping');
            return;
        }

        // Get stored loot history
        const storedRaw = GM_getValue(LOOT_STORAGE_KEY, '{}');
        let stored;
        try {
            stored = JSON.parse(storedRaw);
        } catch (e) {
            stored = {};
        }

        // Get character ID from most recent character data
        const invRaw = GM_getValue(STORAGE_KEY, '{}');
        let charId = 'unknown';
        try {
            const inv = JSON.parse(invRaw);
            charId = inv.characterId || 'unknown';
        } catch (e) {}

        // Store loot entries, keyed by startTime to avoid duplicates
        if (!stored[charId]) {
            stored[charId] = {};
        }

        let newCount = 0;
        for (const entry of lootLog) {
            // Use startTime as unique key
            const key = entry.startTime || entry.endTime || Date.now().toString();
            if (!stored[charId][key]) {
                stored[charId][key] = {
                    startTime: entry.startTime,
                    endTime: entry.endTime,
                    actionHrid: entry.actionHrid,
                    actionCount: entry.actionCount || 0,
                    drops: entry.drops || {},
                    storedAt: Date.now()
                };
                newCount++;
            }
        }

        // Limit to last 200 entries per character (sorted by startTime)
        const entries = Object.entries(stored[charId]);
        if (entries.length > 200) {
            entries.sort((a, b) => new Date(b[1].startTime) - new Date(a[1].startTime));
            stored[charId] = Object.fromEntries(entries.slice(0, 200));
        }

        GM_setValue(LOOT_STORAGE_KEY, JSON.stringify(stored));
        log(`Stored ${newCount} new loot entries. Total: ${Object.keys(stored[charId]).length}`);
    }

    function processMarketTransaction(data) {
        // TODO: Implement profit tracking
        // For now, just log to discover the format
        const transaction = {
            type: data.type,
            data: data,
            timestamp: Date.now()
        };
        
        // Store recent transactions for analysis
        const stored = GM_getValue('cowprofit_transactions', '[]');
        const transactions = JSON.parse(stored);
        transactions.push(transaction);
        
        // Keep last 100 transactions
        if (transactions.length > 100) {
            transactions.shift();
        }
        
        GM_setValue('cowprofit_transactions', JSON.stringify(transactions));
        log('Stored transaction, total:', transactions.length);
    }

    function processCharacterData(data) {
        const inventory = {};
        let coins = 0;
        const characterItems = data.characterItems || [];

        for (const item of characterItems) {
            // Check for coins item
            if (item.itemHrid === '/items/coin' || item.itemHrid === '/items/coins') {
                coins = item.count;
                log('Found coins in items:', coins);
                continue; // Don't add coins to inventory
            }

            // Only count inventory items, not equipped gear
            if (item.itemLocationHrid === '/item_locations/inventory') {
                const key = item.itemHrid;
                inventory[key] = (inventory[key] || 0) + item.count;
            }
        }

        // Also check other possible locations
        if (coins === 0) {
            coins = data.character?.gameCoins || data.characterInfo?.coins || 0;
        }

        log('Final coins:', formatCoins(coins));

        const payload = {
            characterId: data.character?.id,
            characterName: data.character?.name,
            gameCoins: coins,
            inventory: inventory,
            itemCount: Object.keys(inventory).length,
            totalItems: Object.values(inventory).reduce((a, b) => a + b, 0),
            capturedAt: Date.now(),
            capturedAtISO: new Date().toISOString()
        };

        GM_setValue(STORAGE_KEY, JSON.stringify(payload));
        log('Inventory saved:', payload.itemCount, 'unique items,', payload.totalItems, 'total,', formatCoins(payload.gameCoins), 'coins');
        updateExportUI(payload);
    }

    function processItemsUpdate(data) {
        // Load existing data
        const stored = GM_getValue(STORAGE_KEY, null);
        if (!stored) return;

        const payload = JSON.parse(stored);
        const inventory = payload.inventory || {};

        // Apply updates
        const updates = data.endCharacterItems || [];
        for (const item of updates) {
            if (item.itemLocationHrid === '/item_locations/inventory') {
                inventory[item.itemHrid] = item.count;
            }
        }

        // Remove zero-count items
        for (const [key, count] of Object.entries(inventory)) {
            if (count <= 0) delete inventory[key];
        }

        payload.inventory = inventory;
        payload.itemCount = Object.keys(inventory).length;
        payload.totalItems = Object.values(inventory).reduce((a, b) => a + b, 0);
        payload.capturedAt = Date.now();
        payload.capturedAtISO = new Date().toISOString();

        GM_setValue(STORAGE_KEY, JSON.stringify(payload));
        log('Inventory updated:', payload.itemCount, 'unique items');
        updateExportUI(payload);
    }

    function formatCoins(n) {
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toString();
    }

    // ============================================
    // GAME SITE: Export UI
    // ============================================

    function addExportUI() {
        GM_addStyle(`
            #cowprofit-status {
                position: fixed;
                top: 0px;
                left: 0px;
                background: rgba(0, 0, 0, 0.85);
                color: #eeb357;
                padding: 6px 12px;
                border-radius: 6px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                z-index: 99999;
                border: 1px solid #eeb357;
                display: flex;
                align-items: center;
                gap: 10px;
                white-space: nowrap;
            }
            #cowprofit-status .title {
                font-weight: bold;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            #cowprofit-status .title::before {
                content: '🐄';
            }
            #cowprofit-status .btn {
                background: #eeb357;
                color: black;
                border: none;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 10px;
            }
            #cowprofit-status .btn:hover {
                background: #d9a347;
            }
            #cowprofit-status .time {
                color: #888;
                font-size: 10px;
            }
        `);

        const div = document.createElement('div');
        div.id = 'cowprofit-status';
        div.innerHTML = `
            <div class="title">CowProfit</div>
            <div class="time"></div>
            <button class="btn" id="cowprofit-open">Open</button>
        `;
        document.body.appendChild(div);

        document.getElementById('cowprofit-open').onclick = () => {
            window.open('https://sdwr.github.io/cowprofit/', '_blank');
        };

        // Check for existing data
        const stored = GM_getValue(STORAGE_KEY, null);
        if (stored) {
            try {
                updateExportUI(JSON.parse(stored));
            } catch (e) {
                log('No valid stored data');
            }
        }
    }

    function updateExportUI(payload) {
        const timeEl = document.querySelector('#cowprofit-status .time');
        if (timeEl) {
            const age = Math.floor((Date.now() - payload.capturedAt) / 60000);
            timeEl.textContent = age < 1 ? 'just now' : `${age}m ago`;
        }
    }

    // ============================================
    // COWPROFIT SITE: Load and inject data
    // ============================================

    function loadInventoryData() {
        const stored = GM_getValue(STORAGE_KEY, null);
        if (!stored) {
            log('No inventory data found - play the game first');
            injectNoDataUI();
            return;
        }

        try {
            const payload = JSON.parse(stored);
            log('Loaded inventory:', payload.itemCount, 'items,', formatCoins(payload.gameCoins), 'coins');
            log('Captured at:', payload.capturedAtISO);

            // Expose to page's JavaScript
            window.cowprofitInventory = payload;

            // Dispatch event so page can react
            window.dispatchEvent(new CustomEvent('cowprofit-inventory-loaded', { detail: payload }));

            injectStatusUI(payload);
        } catch (e) {
            error('Failed to parse inventory data:', e);
        }

        // Also load loot history
        loadLootHistory();
    }

    function loadLootHistory() {
        const stored = GM_getValue(LOOT_STORAGE_KEY, null);
        if (!stored) {
            log('No loot history found');
            return;
        }

        try {
            const lootData = JSON.parse(stored);
            
            // Get character ID from inventory
            const invRaw = GM_getValue(STORAGE_KEY, '{}');
            let charId = 'unknown';
            try {
                const inv = JSON.parse(invRaw);
                charId = inv.characterId || 'unknown';
            } catch (e) {}

            const charLoot = lootData[charId] || {};
            const entries = Object.values(charLoot);
            
            log('Loaded loot history:', entries.length, 'entries for', charId);

            // Expose to page
            window.cowprofitLootHistory = entries;

            // Dispatch event
            window.dispatchEvent(new CustomEvent('cowprofit-loot-loaded', { detail: entries }));
        } catch (e) {
            error('Failed to parse loot history:', e);
        }
    }

    function injectNoDataUI() {
        GM_addStyle(`
            #cowprofit-import-status {
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(255, 100, 100, 0.9);
                color: white;
                padding: 10px 15px;
                border-radius: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
                z-index: 99999;
            }
        `);

        const div = document.createElement('div');
        div.id = 'cowprofit-import-status';
        div.innerHTML = `🐄 No inventory data - open MWI game first`;
        document.body.appendChild(div);
    }

    function injectStatusUI(payload) {
        GM_addStyle(`
            #cowprofit-import-status {
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(0, 100, 0, 0.9);
                color: white;
                padding: 10px 15px;
                border-radius: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
                z-index: 99999;
            }
            #cowprofit-import-status .name {
                font-weight: bold;
                color: #eeb357;
            }
        `);

        const age = Math.floor((Date.now() - payload.capturedAt) / 60000);
        const ageText = age < 1 ? 'just now' : age < 60 ? `${age}m ago` : `${Math.floor(age/60)}h ago`;

        const div = document.createElement('div');
        div.id = 'cowprofit-import-status';
        div.innerHTML = `
            🐄 <span class="name">${payload.characterName || 'Unknown'}</span><br>
            ${payload.itemCount} items • ${formatCoins(payload.gameCoins)} coins<br>
            <small>Synced ${ageText}</small>
        `;
        document.body.appendChild(div);
    }

})();
