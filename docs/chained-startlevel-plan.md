# Chained Start Levels — Implementation Plan

## Summary

When sessions are grouped, session N+1 should inherit its `startLevel` from session N's outcome. Failed sessions end at level 0; successful sessions end at `maxLevel`. Currently each session calculates protection independently using its own `currentLevel` from `primaryItemHash`, which is wrong for chained groups — after a failure, the next session starts from 0, not from whatever `primaryItemHash` says.

---

## 1. Recommended Approach: Compute Chained Levels in the Render Loop

### Why not add a parameter to `computeSessionDisplay()`?

`computeSessionDisplay()` is a pure function of a single session — it computes display data from raw session data + overrides. Adding a `startLevelOverride` parameter would work, but it means callers need to know about chaining. Since chaining is purely a group concept, **the render loop is the right place** to compute chained start levels, then pass them down.

### The Plan

**Step 1: Add `startLevelOverride` parameter to `computeSessionDisplay()`**

```js
// BEFORE
function computeSessionDisplay(session) {

// AFTER
function computeSessionDisplay(session, startLevelOverride) {
```

When `startLevelOverride` is provided (not `undefined`), it replaces `enhanceProfit.currentLevel` for all downstream calculations in that function.

**Step 2: Thread override through `computeSessionDisplay()`**

Inside `computeSessionDisplay()`, three things use `startLevel` / `currentLevel`:

1. **`calculateProtectionFromDrops()` call for failures** (~line 660) — already passes `enhanceProfit.currentLevel || 0`. Change to use override:
   ```js
   const effectiveStartLevel = startLevelOverride !== undefined
       ? startLevelOverride
       : (enhanceProfit.currentLevel || 0);
   ```
   Then pass `effectiveStartLevel` to `calculateProtectionFromDrops()`.

2. **The `levelInfo` display** in `renderCardBody()` — shows `+${startLevel}→+${highLevel}`. This reads from `ep.currentLevel`. We need to make the effective start level visible in the display data.

3. **`calculateEnhanceSessionProfit()` also calls `calculateProtectionFromDrops()`** with `currentLevel` for the initial (non-failure-adjusted) prot count. This is the "success path" prot count. For chaining, this also needs the override.

**Problem:** `calculateEnhanceSessionProfit()` is called *inside* `computeSessionDisplay()`, and it's where `currentLevel` originates. We don't want to add the override parameter all the way down into `calculateEnhanceSessionProfit()` because that function is also used in `autoGroupSessions()` (for item name detection).

**Solution:** Don't modify `calculateEnhanceSessionProfit()`. Instead, in `computeSessionDisplay()`, *after* getting `enhanceProfit`, recalculate prot counts with the overridden start level:

```js
function computeSessionDisplay(session, startLevelOverride) {
    const enhanceProfit = calculateEnhanceSessionProfit(session);
    if (!enhanceProfit) return null;

    // Determine effective start level (chaining override or data)
    const effectiveStartLevel = startLevelOverride !== undefined
        ? startLevelOverride
        : (enhanceProfit.currentLevel || 0);

    // ... existing code ...

    // For failures: recalc prot with effectiveStartLevel and finalLevel=0
    if (!isSuccess && enhanceProfit.levelDrops) {
        const protResult = calculateProtectionFromDrops(
            enhanceProfit.levelDrops,
            enhanceProfit.protLevel || 8,
            effectiveStartLevel,  // <-- was enhanceProfit.currentLevel || 0
            0
        );
        adjustedProtsUsed = protResult.protCount;
        adjustedProtCost = adjustedProtsUsed * (enhanceProfit.protPrice || 0);
    }

    // For successes: also recalc prot with effectiveStartLevel (finalLevel=maxLevel)
    // Currently success uses enhanceProfit.totalProtCost (from calculateEnhanceSessionProfit)
    // which used the original currentLevel. Recalculate:
    let successProtCost = enhanceProfit.totalProtCost;
    let successProtsUsed = enhanceProfit.protsUsed;
    if (isSuccess && startLevelOverride !== undefined && enhanceProfit.levelDrops) {
        const protResult = calculateProtectionFromDrops(
            enhanceProfit.levelDrops,
            enhanceProfit.protLevel || 8,
            effectiveStartLevel
            // no finalLevelOverride — defaults to maxLevel (correct for success)
        );
        successProtsUsed = protResult.protCount;
        successProtCost = successProtsUsed * (enhanceProfit.protPrice || 0);
    }

    // Use successProtCost in the success profit calculation
    const successCost = enhanceProfit.totalMatCost + successProtCost + baseItemCost + totalTeaCost;

    // Expose effectiveStartLevel in the return object
    return {
        ...existingFields,
        effectiveStartLevel,  // NEW — used by renderCardBody for levelInfo display
    };
}
```

**Step 3: Compute chained levels in the render loop**

In `renderLootHistoryPanel()`, after computing groups but before building displayData:

```js
// Current code:
const displayData = {};
for (const s of enhanceSessions) {
    const d = computeSessionDisplay(s);
    if (d) displayData[s.startTime] = d;
}

// NEW code:
const displayData = {};
const groups = autoGroupSessions(validSessions);  // move this BEFORE displayData computation

// First pass: compute display for ungrouped sessions (no override)
// Second pass: compute display for grouped sessions with chaining

// Build session lookup
const sessionByKey = {};
for (const s of enhanceSessions) {
    sessionByKey[s.startTime] = s;
}

// Compute grouped sessions with chaining
const groupedKeys = new Set();
for (const [groupId, memberKeys] of Object.entries(groups)) {
    let chainedStartLevel = undefined; // first session uses its own
    for (const key of memberKeys) {  // memberKeys is chronological (oldest first)
        groupedKeys.add(key);
        const session = sessionByKey[key];
        if (!session) continue;

        const d = computeSessionDisplay(session, chainedStartLevel);
        if (d) {
            displayData[key] = d;
            // Chain: determine this session's final level for the next session
            if (d.isSuccess) {
                chainedStartLevel = d.effectiveResultLevel || d.enhanceProfit.highestLevel || 0;
            } else {
                chainedStartLevel = 0; // failed = item dropped to 0
            }
        }
    }
}

// Compute ungrouped sessions (no override)
for (const s of enhanceSessions) {
    if (!groupedKeys.has(s.startTime) && !displayData[s.startTime]) {
        const d = computeSessionDisplay(s);
        if (d) displayData[s.startTime] = d;
    }
}
```

**Step 4: Update `renderCardBody()` to use `effectiveStartLevel`**

```js
// BEFORE (in renderCardBody):
const startLevel = ep.currentLevel || 0;

// AFTER:
const startLevel = d.effectiveStartLevel !== undefined ? d.effectiveStartLevel : (ep.currentLevel || 0);
```

---

## 2. Edge Cases and Impossible States

### 2a. Wrong item in group (bad grouping data)

**Risk:** Low — `autoGroupSessions()` groups by item name, so mismatches shouldn't happen unless data is corrupted.

**Handling:** No special validation needed. If it happens, the chained start level will be nonsensical, but the cascade math will still produce *some* number. The existing per-session `primaryItemHash` data provides a sanity check if needed later.

### 2b. `startLevel > max(levelDrops)` — the known bug

**Scenario:** Session starts at level 10 (chained from previous success), but all drops are at level 0 (total wipe). `maxLevel = Math.max(...levels)` = 0, which is less than `startLevel` = 10.

**Current `calculateProtectionFromDrops` behavior when this happens:**
- The loop `for (let L = 0; L <= maxLevel; L++)` only goes to 0
- `attempts[startLevel]` (at level 10) never gets the `+= 1` adjustment
- The entire cascade is wrong — misses all attempts between 0 and 10
- Prot count is wildly incorrect

**Fix:** In `calculateProtectionFromDrops()`, change:
```js
// BEFORE:
const maxLevel = Math.max(...levels);

// AFTER:
const maxLevel = Math.max(...levels, startLevel || 0);
```

This ensures the cascade loop covers all levels from 0 to max(drops, startLevel). The `attempts[startLevel] += 1` adjustment then lands correctly.

**This fix should be done FIRST, as a separate commit**, because:
1. It's a standalone bug that affects even non-grouped sessions (any session where `primaryItemHash` level > highest drop level)
2. It's a one-line change with clear semantics
3. Chaining depends on this being correct — if we implement chaining first, the chained `startLevel=10` after a success would trigger this bug for any subsequent failure session

### 2c. Success session in the middle of a group

**Scenario:** Group = [F1, S2, F3, F4] — success at position 2, then more failures.

**Shouldn't happen** with current `autoGroupSessions()` — it closes the group at success. But could happen with future manual grouping.

**Handling:** The chaining logic handles it naturally:
- F1: startLevel = own (e.g., 0) → finalLevel = 0 (fail)
- S2: startLevel = 0 (chained) → finalLevel = maxLevel (e.g., 12)
- F3: startLevel = 12 (chained) → finalLevel = 0 (fail)
- F4: startLevel = 0 (chained) → finalLevel = 0 (fail)

This is actually correct behavior — it represents "enhanced to +12, then tried again and failed twice." No special handling needed.

### 2d. All-failure groups with very long chains

**Scenario:** 10 consecutive failures, all chaining from 0.

After the first failure, every subsequent session has `startLevel = 0`. This is correct — the item keeps dropping to 0 and they keep starting over. The chaining doesn't change anything for consecutive failures after the first.

**Only the first failure's start level matters** (it uses the override from data or chain). All subsequent failures chain from 0. This is a natural optimization — we don't need to worry about long chains being expensive.

### 2e. Chained startLevel produces negative profit anomalies

**Scenario:** Session has `primaryItemHash` saying level 5, but chained start is 0. The prot count changes — fewer prots used if starting from 0 vs 5.

This is **correct behavior** — the whole point of chaining is to fix the prot count. But users might be confused if they see different numbers after grouping.

**UI consideration:** Show the chained start level in the card (already planned via `effectiveStartLevel` in levelInfo). If it differs from the raw `currentLevel`, maybe show a small indicator.

---

## 3. Performance

### Current Problem

`calculateEnhanceSessionProfit()` is called **3× per session per render**:
1. In `autoGroupSessions()` — to get `itemName` and `isSuccessful`
2. In `computeSessionDisplay()` — the main calculation
3. Implicitly, since `computeSessionDisplay()` calls it, and the render may trigger re-renders

### Impact of Chaining

Chaining adds a `calculateProtectionFromDrops()` recalculation per grouped session (to apply the overridden start level). This is cheap (O(maxLevel) per session, maxLevel ≤ 14). Not a concern.

The real issue is the existing redundancy. Chaining makes it slightly worse because we now need `autoGroupSessions()` to run *before* `computeSessionDisplay()` (to know which sessions are grouped and their order), but `autoGroupSessions()` itself calls `calculateEnhanceSessionProfit()`.

### Recommendation: Don't Cache Yet, But Clean Up Call Order

**Don't add memoization now.** The cost is ~100 sessions × 3 calls × ~1ms each = ~300ms worst case, which is acceptable.

**Do restructure the render loop** to avoid redundant work:

```
1. autoGroupSessions(sessions)     — calls calculateEnhanceSessionProfit internally
2. computeSessionDisplay(session)  — calls calculateEnhanceSessionProfit again (redundant!)
```

A future optimization would be to have `autoGroupSessions()` return a map of `sessionKey → enhanceProfit`, then pass that into `computeSessionDisplay()` to avoid recalculation. **But not in this PR** — keep scope focused on chaining.

### Future Memoization Note

If performance becomes an issue, memoize `calculateEnhanceSessionProfit()` by session key + data hash. The function is pure (same session → same result), so this is safe. Use a simple `Map` cleared on each render cycle.

---

## 4. Implementation Order

### Step 1: Fix `startLevel > maxLevel` bug (separate commit)

**File:** `main.js`, `calculateProtectionFromDrops()`

**Change:**
```js
const maxLevel = Math.max(...levels, startLevel || 0);
```

**Test:** Find a session where `primaryItemHash` level > highest drop level. Verify prot count changes to something reasonable.

### Step 2: Add `startLevelOverride` to `computeSessionDisplay()`

**File:** `main.js`, `computeSessionDisplay()`

**Changes:**
- Add `startLevelOverride` parameter
- Compute `effectiveStartLevel`
- Use it in the failure prot recalculation (existing code)
- Add success prot recalculation when override is provided
- Recalculate `successCost` using recalculated prot
- Add `effectiveStartLevel` to return object

### Step 3: Restructure render loop for chaining

**File:** `main.js`, `renderLootHistoryPanel()`

**Changes:**
- Move `autoGroupSessions()` call before `displayData` computation
- Compute grouped sessions with chaining (iterate group members chronologically, pass chained start level)
- Compute ungrouped sessions without override
- Update `renderCardBody()` to display `effectiveStartLevel`

### Step 4: Update levelInfo display

**File:** `main.js`, `renderCardBody()`

**Change:**
```js
const startLevel = d.effectiveStartLevel !== undefined ? d.effectiveStartLevel : (ep.currentLevel || 0);
```

Optionally, if `effectiveStartLevel !== ep.currentLevel`, show a visual indicator (e.g., a small chain icon or different color) to signal chaining is active.

---

## 5. Risks and Concerns

1. **autoGroupSessions() must run before displayData computation.** Currently in `renderLootHistoryPanel()`, `displayData` is computed first, then `autoGroupSessions()` uses `validSessions` (filtered by displayData existence). The new order reverses this dependency. We'll need to filter valid sessions differently — use `calculateEnhanceSessionProfit()` existence check (which `autoGroupSessions` already does internally) rather than `displayData` existence.

2. **Group member order matters.** `autoGroupSessions()` stores members in chronological order (oldest first). The chaining code iterates in this order. If this invariant breaks, chaining breaks. Add a comment documenting this invariant.

3. **Success override interaction.** When a user toggles a session to success/failure, it changes the chained final level for subsequent sessions. The render loop handles this naturally (re-renders recompute chains), but there's a cascading effect — toggling one session can change prot counts for all subsequent sessions in the group. This is correct but might surprise users. Consider a brief flash/highlight on affected cards.

4. **The render loop restructure is the riskiest part.** Moving `autoGroupSessions()` before `displayData` changes the flow significantly. Test thoroughly with: empty data, single session, ungrouped sessions, multi-session groups, all-failure groups, groups with overrides.

5. **`calculateEnhanceSessionProfit()` in `autoGroupSessions()` doesn't use start level.** It uses `currentLevel` from `primaryItemHash` only for its own prot calculation. The chained prot is computed separately in `computeSessionDisplay()`. This means the `enhanceProfit.protsUsed` value in the return object is always the "unchained" count. This is fine — `computeSessionDisplay()` overrides it — but could be confusing for debugging. Add a comment.
