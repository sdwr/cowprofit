# Loot Tracker / Profit History Feature

## Goal

Track enhancement profit over time by capturing loot log data from MWI's built-in tracker.

## MWI Loot Log Format

The game sends `loot_log_updated` WebSocket messages containing session data:

```javascript
{
  "type": "loot_log_updated",
  "lootLog": [
    {
      "startTime": "2026-02-13T08:36:26.541065839Z",    // ISO timestamp
      "endTime": "2026-02-13T10:07:51.94762052Z",       // ISO timestamp
      "characterActionId": 180090192,                    // Unique action ID
      "actionHrid": "/actions/enhancing/enhance",        // Action type
      "difficultyTier": 0,
      
      // PRIMARY ITEM - The output item being worked on
      // Format: "charId::/item_locations/inventory::/items/{item_hrid}::{level}"
      "primaryItemHash": "11946::/item_locations/inventory::/items/soul_hunter_crossbow::0",
      
      // SECONDARY ITEM - Protection/catalyst item used
      "secondaryItemHash": "11946::/item_locations/inventory::/items/soul_fragment::0",
      
      "actionCount": 1027,    // Total enhance attempts
      "partyId": 0,
      
      // OUTPUT DISTRIBUTION - Items at each level when session ended
      // Format: "/items/{item_hrid}::{level}": count
      "drops": {
        "/items/enhancing_essence::0": 266,
        "/items/soul_hunter_crossbow::0": 464,
        "/items/soul_hunter_crossbow::1": 273,
        "/items/soul_hunter_crossbow::2": 132,
        "/items/soul_hunter_crossbow::3": 66,
        "/items/soul_hunter_crossbow::4": 36,
        "/items/soul_hunter_crossbow::5": 19,
        "/items/soul_hunter_crossbow::6": 18,
        "/items/soul_hunter_crossbow::7": 13,
        "/items/soul_hunter_crossbow::8": 5,
        "/items/soul_hunter_crossbow::9": 1
      }
    }
  ]
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `actionHrid` | Action type (e.g., `/actions/enhancing/enhance`) |
| `primaryItemHash` | Output item with level. Parse: `...::/items/{hrid}::{level}` |
| `secondaryItemHash` | Protection/catalyst item used |
| `actionCount` | Total actions taken (for enhance: total clicks) |
| `drops` | Final distribution of items at each level |

### Item Level Notation

Items use `::N` suffix for enhancement level:
- `/items/sword::0` = base sword (+0)
- `/items/sword::8` = +8 sword
- `/items/sword::12` = +12 sword

## Enhancement Mechanics

### Materials
- **Consumed every action**: `actionCount × material_cost_per_enhance`
- Materials defined in game-data.js per item

### Base Items
- **Never destroyed** - cycle back to +0 on failure (below protection level)
- Total items in session = sum of item drops (excluding essences/crates)

### Protection
- **Protection level**: Typically +8 (varies by item tier)
- **Below prot level**: Fail → reset to +0, no prot consumed
- **At prot level or above**: Fail → drop one level, consume 1 prot
  - e.g., +8 fails → +7, uses 1 protection item

### Blessed Tea
- 1% chance to gain +2 levels instead of +1 on success
- Can overshoot targets (e.g., +11→+13 instead of +12)

## P&L Calculation

### Target Levels
Only items reaching **+8, +10, +12, +14** count as successes.
Blessed overshoots (+9, +11, +13, +15) also count.

### Detecting Starting Level (Flow Discrepancy Method)

Every item at level X+1 required a successful enhance from level X.
The **starting level** is where `required_inputs > actual_drops`.

```
For each level X (working backwards from top):
  required_at_X = drops[X+1] / success_rate[X]
  if required_at_X > drops[X]:
    start_level = X  // "Phantom input" detected
```

### Calculating Protection Usage

Protection is consumed when items fail at protection level or above:
- Track "arrivals from above" at each protected level
- Each arrival from X+1 to X (where X >= prot_level - 1) = 1 prot used

### Cost Formula

```
material_cost = actionCount × materials_per_enhance × material_prices
protection_cost = prots_used × protection_price
base_item_cost = items_consumed × base_price (usually 0 if cycling)

revenue = Σ(count_at_target × price_at_target) for levels 8, 10, 12, 14

profit = revenue - material_cost - protection_cost - base_item_cost
```

## Implementation Status

- [x] Capture `loot_log_updated` messages in userscript
- [x] Store loot history in GM storage
- [x] Display loot history panel on CowProfit site
- [ ] Detect starting level from drops
- [ ] Calculate protection usage
- [ ] Show P&L per enhance session
- [ ] Aggregate sessions by item type

## Files

- `cowprofit-inventory.user.js` - Captures loot log, stores in GM storage
- `main.js` - Displays loot history, calculates values
- `enhance-calc.js` - Markov chain math for expected values
- `enhance-analyzer.js` - Starting level detection, prot calculation (WIP)
