# Loot Tracker / Profit History Feature

## Goal

Track enhancement profit over time by capturing:
1. Items sold on market
2. Items enhanced (start/end)
3. Materials consumed
4. Net profit per item/session

## Research: MWI WebSocket Messages

Based on existing userscript code and MWI tools analysis:

### Known Message Types
- `init_character_data` - Full character state on login (inventory, coins, skills)
- `items_updated` - Item count changes (loot, crafting, trading)
- `action_type_changed` - When player starts/stops an action
- `action_completed` - Individual action completion (needs verification)

### Potential Combat/Loot Messages
Need to capture and analyze:
- Combat encounter start/end
- Loot drops
- Market transactions (buy/sell)
- Enhancement success/failure

## Data Flow

```
MWI Game (WebSocket)
    │
    ├── items_updated (item gained/lost)
    ├── coins_updated (market transactions?)
    └── action_completed (enhancement done?)
    │
    ▼
Userscript (cowprofit-inventory.user.js)
    │
    ├── Capture relevant messages
    ├── Track session stats (items in/out, coins in/out)
    └── Store via GM_setValue
    │
    ▼
CowProfit Site
    │
    ├── Load loot data from userscript storage
    ├── Display profit history
    └── Calculate realized vs expected profit
```

## Implementation Plan

### Phase 1: Message Discovery
1. Add debug logging to userscript for ALL message types
2. Play game with console open, capture message samples
3. Document message format for: market trades, enhancements, loot

### Phase 2: Session Tracking
1. Track coins before/after market transactions
2. Track items consumed (materials) vs gained (enhanced items)
3. Calculate net profit per enhancement

### Phase 3: UI Integration
1. Add "Profit History" panel to CowProfit
2. Show realized profit vs expected profit per item
3. Session summary: total spent, total earned, net profit

## Questions to Answer

1. **How does MWI report market transactions?**
   - Is there a specific message when you sell an item?
   - Or just `items_updated` with item removed + `coins_updated`?

2. **How does MWI report enhancement results?**
   - Is there a success/fail message?
   - Or just `items_updated` with new item level?

3. **How to differentiate loot sources?**
   - Combat drops vs crafting output vs market buys
   - May need to track action context

## Userscript Changes Needed

```javascript
// Add to handleMessage()
function handleMessage(message) {
    let data;
    try {
        data = JSON.parse(message);
    } catch {
        return;
    }
    
    // Debug: log all message types
    if (DEBUG) {
        log('Message type:', data.type, data);
    }
    
    // Existing handlers
    if (data.type === 'init_character_data') { ... }
    if (data.type === 'items_updated') { ... }
    
    // NEW: Track market transactions
    if (data.type === 'marketplace_item_sold') { ... }  // hypothetical
    
    // NEW: Track enhancements
    if (data.type === 'enhancement_completed') { ... }  // hypothetical
}
```

## Next Steps

1. [ ] Enable debug mode in userscript
2. [ ] Play MWI with console open
3. [ ] Sell an item on market → capture message
4. [ ] Enhance an item → capture messages
5. [ ] Document actual message formats
6. [ ] Update userscript to track loot/profit
7. [ ] Add profit history UI to CowProfit
