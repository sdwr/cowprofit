// ==UserScript==
// @name         CowProfit Inventory Bridge
// @namespace    https://github.com/sdwr/cowprofit
// @version      1.0.4
// @description  Captures MWI inventory and coins, bridges to CowProfit via Tampermonkey storage
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

        if (data.type === 'init_character_data') {
            log('Received init_character_data');
            processCharacterData(data);
        } else if (data.type === 'items_updated') {
            // Incremental update - merge with stored data
            log('Received items_updated');
            processItemsUpdate(data);
        }
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
                background: rgba(0, 0, 0, 0.7);
                color: #eeb357;
                padding: 4px 10px;
                border-radius: 4px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 11px;
                border: 1px solid rgba(238, 179, 87, 0.5);
                display: flex;
                align-items: center;
                gap: 8px;
                white-space: nowrap;
                margin-right: 10px;
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
            #cowprofit-status .stats {
                color: #ccc;
            }
            #cowprofit-status .btn {
                background: #eeb357;
                color: black;
                border: none;
                padding: 3px 6px;
                border-radius: 3px;
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
            <div class="stats">Waiting...</div>
            <div class="time"></div>
            <button class="btn" id="cowprofit-open">Open</button>
        `;
        
        // Try to insert next to task tracker, retry if not found yet
        function insertUI() {
            const taskTracker = document.querySelector('[class*="Header_questInfo"]');
            if (taskTracker && taskTracker.parentElement) {
                taskTracker.parentElement.insertBefore(div, taskTracker);
                log('UI inserted next to task tracker');
                return true;
            }
            return false;
        }
        
        if (!insertUI()) {
            // Retry a few times as page loads
            let attempts = 0;
            const interval = setInterval(() => {
                if (insertUI() || ++attempts > 20) {
                    clearInterval(interval);
                    if (attempts > 20) {
                        // Fallback: append to body with fixed position
                        div.style.cssText = 'position:fixed;top:10px;right:300px;z-index:99999;';
                        document.body.appendChild(div);
                        log('UI inserted with fallback positioning');
                    }
                }
            }, 500);
        }

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
        const statsEl = document.querySelector('#cowprofit-status .stats');
        const timeEl = document.querySelector('#cowprofit-status .time');
        if (statsEl) {
            statsEl.textContent = `${payload.itemCount} items • ${formatCoins(payload.gameCoins)}`;
        }
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
