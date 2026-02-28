# Task: Price Category UI Controls & Dots

## Prerequisites
This task runs AFTER the calc refactor (TASK-CALC-REFACTOR.md) is complete.
Working in `C:\Users\roryk\clawd\mwi-tracker` on branch `price-categories`.

## Goal
Add per-category price mode toggles to the top controls and colored dots to show active price mode on individual prices.

## 1. Top Controls Redesign

### Current
Three buttons: Pessimistic (large), Midpoint, Optimistic

### New Layout
```
[  PESSIMISTIC  ]  |  Mats: [Pess] [Pess+] [Opt-] [Opt]  |  Prots: [Pess] [Opt]  |  Sell: [Pess] [Pess+] [Mid] [Opt-] [Opt]
```

- **Large Pessimistic button** (left): Master reset — clicking sets ALL categories to Pessimistic
- **Mats column**: 4 toggle buttons (pessimistic, pessimistic+, optimistic-, optimistic)
- **Prots column**: 2 toggle buttons (pessimistic, optimistic)  
- **Sell column**: 5 toggle buttons (pessimistic, pessimistic+, midpoint, optimistic-, optimistic)

Remove the old Midpoint and Optimistic global buttons.

### Button behavior
- Only one active per column (radio-style)
- Default: all Pessimistic
- Changing any button triggers async recalc (same pattern as gear changes)
- Save selection to localStorage
- Master Pessimistic resets all three columns

### Button labels
- "Pess" = Pessimistic (buy at ask / sell at bid)
- "Pess+" = Pessimistic Plus (buy at ask-1tick / sell at bid+1tick)  
- "Mid" = Midpoint ((bid+ask)/2) — sell only
- "Opt-" = Optimistic Minus (buy at bid+1tick / sell at ask-1tick)
- "Opt" = Optimistic (buy at bid / sell at ask)

## 2. Colored Dots

Show a colored dot (small CSS circle, not emoji) after unit prices to indicate price mode.

### Dot colors
- **No dot**: Pessimistic (default)
- 🟠 **Orange**: Pessimistic+ (ask-1tick for buy, bid+1tick for sell)
- 🟡 **Yellow**: Midpoint (sell only)
- **Light green**: Optimistic- (bid+1tick for buy, ask-1tick for sell)  
- **Bright green**: Optimistic (bid for buy, ask for sell)

### Fallback styling
If a mode falls back due to tight spread (≤1 tick between bid/ask), the dot must show the fallback mode's style:
- User selects "Pess+" but spread is 1 tick → shows no dot (fell back to Pessimistic)
- User selects "Opt-" but spread is 1 tick → shows bright green dot (fell back to Optimistic)

Use `actualMode` from priceDetails (set by PriceResolver) to determine which dot to show.

### Where dots appear
1. **Main list** — no dots on the summary row itself
2. **Expanded detail — Shopping List**: dot after each material's unit price
3. **Expanded detail — Enhancement Detail**: dot after unit prices in the cost breakdown
4. **Expanded detail — Sell Price row**: dot after the sell price
5. **Expanded detail — Cost Summary**: dots on mat total and prot total rows if applicable

### Where dots do NOT appear
- Enhance History dropdown (uses fixed pessimistic, no mode selection)
- Base item price (always pessimistic, no dot)
- Coin costs (fixed, no dot)

## 3. Tooltip Updates (SKIP for now)
Price tooltips will be updated in a follow-up task. Don't modify tooltips in this task.

## 4. Implementation Notes

### CSS for dots
```css
.price-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-left: 3px;
    vertical-align: middle;
}
.price-dot-pess-plus { background: #ff8c00; }  /* orange */
.price-dot-midpoint { background: #ffdd00; }    /* yellow */
.price-dot-opt-minus { background: #90ee90; }   /* light green */
.price-dot-optimistic { background: #00cc00; }  /* bright green */
/* No class for pessimistic — no dot shown */
```

### Mode state
```js
let priceConfig = {
    matMode: 'pessimistic',
    protMode: 'pessimistic', 
    sellMode: 'pessimistic',
};
```
Save to localStorage key `cowprofit_price_config`.

### Recalc on mode change
Use the same async chunked pattern as `onGearChangeAsync()`:
1. Read mode from buttons
2. Save to localStorage
3. Create new orchestration with updated modes
4. Apply skeleton loading state
5. Recalculate all items async
6. Re-render

### Helper for dot HTML
```js
function priceDotHtml(actualMode) {
    if (actualMode === 'pessimistic') return '';
    const cls = {
        'pessimistic+': 'price-dot-pess-plus',
        'midpoint': 'price-dot-midpoint', 
        'optimistic-': 'price-dot-opt-minus',
        'optimistic': 'price-dot-optimistic',
    }[actualMode];
    return cls ? `<span class="price-dot ${cls}"></span>` : '';
}
```

## Files to modify
- `main.js` — mode state, UI controls, dot rendering in detail views
- `index.html` — new button HTML in controls section, CSS for dots
- Possibly `style.css` if styles are external

## DO NOT modify
- `enhance-calc.js` — pure simulation, no UI concerns
- `item-resolver.js` — no UI concerns  
- `price-resolver.js` — no UI concerns
- Enhance History code — excluded from this feature
