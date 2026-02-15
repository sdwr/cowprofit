// Investigation: Is the start-level bias bug real?

function calculateProtectionFromDrops(levelDrops, protLevel, startLevel, finalLevel) {
    const levels = Object.keys(levelDrops).map(Number).sort((a, b) => b - a);
    if (levels.length === 0) return { protCount: 0 };
    const maxLevel = Math.max(...levels);
    if (finalLevel === undefined) finalLevel = maxLevel;
    const successes = {}, failures = {}, attempts = {};
    for (let L = 0; L <= maxLevel; L++) {
        attempts[L] = (levelDrops[L] || 0);
        if (L === startLevel) attempts[L] += 1;
        if (L === finalLevel) attempts[L] -= 1;
    }
    successes[maxLevel] = 0;
    failures[maxLevel] = Math.max(0, attempts[maxLevel]);
    for (let L = maxLevel - 1; L >= 0; L--) {
        let failuresLandingAtLPlus1 = 0;
        if (L + 2 <= maxLevel && L + 2 >= protLevel) {
            failuresLandingAtLPlus1 = failures[L + 2] || 0;
        }
        successes[L] = (levelDrops[L + 1] || 0) - failuresLandingAtLPlus1;
        if (successes[L] < 0) successes[L] = 0;
        failures[L] = attempts[L] - successes[L];
        if (failures[L] < 0) failures[L] = 0;
    }
    let protCount = 0;
    for (let L = protLevel; L <= maxLevel; L++) {
        protCount += failures[L];
    }
    return { protCount: Math.round(protCount), successes, failures, attempts };
}

// ============================================================
// KEY QUESTION: What does levelDrops represent?
// In the simulation: recordDrop(level) is called BEFORE each action.
// So drops[L] = number of times an action was attempted at level L.
// The FIRST action at startLevel IS recorded as a drop.
//
// What does attempts[L] += 1 for startLevel do?
// It adds an EXTRA attempt beyond what the drops show.
// If drops already include the starting position, this double-counts.
//
// Similarly, attempts[finalLevel] -= 1 removes one because the
// item ends at finalLevel without attempting (the "current position").
// ============================================================

console.log("=== INVESTIGATION: Start-Level Bias ===\n");

// Test A: Simplest possible case
// Path: start at 3, success to 4, end at 4
// Drops: {3:1, 4:1} (drop at 3 before success, drop at 4 but then session ends... wait)
// Actually if we end at 4, the drop at 4 would only exist if there's another action.
// In the sim: drop is recorded BEFORE each action. If the session ends at 4 with
// no more actions, there's no drop at 4.
// 
// Let me think about this differently. The "drops" in the real game context are
// items obtained during enhancement. Each enhance attempt produces a drop.
// If you end at level 4, your LAST action was the success from 3→4.
// That last action produced a drop at level 3 (where you were when you acted).
// So drops = {3:1}, finalLevel=4.

console.log("--- Test A: Pure success, start=3, prot=3 ---");
console.log("Path: start at 3, success→4, end.");
console.log("Drops should be: {3:1} (one action at level 3)");
let r = calculateProtectionFromDrops({3:1}, 3, 3, 4);
console.log("Result:", r);
console.log("Expected: 0 prots (no failures)");
console.log("attempts[3] = drops[3](1) + start(1) = 2. But only 1 action happened!");
console.log("attempts[4] = drops[4](0) - final(1) = -1 → clamped");
console.log();

// Test B: start=3, fail at 3, end at 2
// Path: start at 3, fail→2 (prot used), end at 2
// Drops: {3:1} (one action at level 3), finalLevel=2
console.log("--- Test B: Single fail, start=3, prot=3 ---");
console.log("Path: start at 3, fail→2 (1 prot), end at 2.");
r = calculateProtectionFromDrops({2:1, 3:1}, 3, 3, 2);
console.log("Result:", r);
console.log("Expected: 1 prot");
console.log();

// Test C: start=0, success to 3, fail to 2 (1 prot), end at 2
// Path: 0→1→2→3→fail(3→2, prot)→end at 2
// Drops: {0:1, 1:1, 2:2, 3:1}, finalLevel=2
// Wait: at level 2, we go to 3 (drop at 2). At 3, we fail to 2 (drop at 3).
// Now at 2, session ends → drop at 2 for next action? Only if there IS a next action.
// If session ends: drops = {0:1, 1:1, 2:1, 3:1}, finalLevel=2
console.log("--- Test C: start=0, same scenario as B but from below ---");
console.log("Path: 0→1→2→3→fail(3→2, prot)→end at 2.");
console.log("Drops: {0:1, 1:1, 2:1, 3:1}");
r = calculateProtectionFromDrops({0:1, 1:1, 2:1, 3:1}, 3, 0, 2);
console.log("Result:", r);
console.log("Expected: 1 prot");
console.log();

// ============================================================
// NOW: What do the SIMULATION's drops look like?
// The sim records a drop BEFORE every action (including the last one).
// So if there are N actions, there are N drops total.
// The sim tracks finalLevel = level AFTER all actions.
// 
// Example: 3 actions, start=3
// Action 1: drop(3), success→4
// Action 2: drop(4), fail→3 (prot)
// Action 3: drop(3), success→4
// finalLevel=4, drops={3:2, 4:1}, actualProtCount=1
// ============================================================

console.log("--- Test D: Sim-style drops (3 actions, start=3, prot=3) ---");
console.log("Path: drop(3)→4(s), drop(4)→3(fail,P), drop(3)→4(s). Final=4");
console.log("Drops: {3:2, 4:1}, actualProt=1");
r = calculateProtectionFromDrops({3:2, 4:1}, 3, 3, 4);
console.log("Result:", r);
console.log("Expected: 1 prot");
console.log("attempts[3] = 2 + 1(start) = 3. Real attempts at 3 = 2.");
console.log("attempts[4] = 1 - 1(final) = 0. Real attempts at 4 = 1.");
console.log("DOUBLE COUNTING at startLevel!");
console.log();

// Test E: Same path but start=0
console.log("--- Test E: Same path but start=0 (no bias) ---");
console.log("Path: 0→...→3→4(s)→3(fail,P)→4(s). Final=4");
console.log("Drops: {0:1, 1:1, 2:1, 3:2, 4:1}");
r = calculateProtectionFromDrops({0:1, 1:1, 2:1, 3:2, 4:1}, 3, 0, 4);
console.log("Result:", r);
console.log("Expected: 1 prot");
console.log();

// ============================================================
// THE DISCREPANCY: Why did robust tests pass?
// Let me check robust test 6 carefully
// ============================================================

console.log("--- Robust Test 6 replay ---");
console.log("Claimed path: 3→4(s)→fail(4→3,P)→3→4(s)→5(s)→end at 5");
console.log("Drops given: {3:1, 4:2, 5:1}. But path visits 3 twice! Should be {3:2, 4:2, 5:1}");
console.log();
console.log("With CORRECT drops {3:2, 4:2, 5:1} (5 actions):");
r = calculateProtectionFromDrops({3:2, 4:2, 5:1}, 3, 3, 5);
console.log("Result:", r);
console.log("Expected: 1 prot. Got:", r.protCount);
console.log();
console.log("With GIVEN drops {3:1, 4:2, 5:1} (4 actions, inconsistent with path):");
r = calculateProtectionFromDrops({3:1, 4:2, 5:1}, 3, 3, 5);
console.log("Result:", r);
console.log("Expected: 1 prot. Got:", r.protCount);
console.log();

// ============================================================
// Test: Run the ACTUAL simulation to see the bias
// ============================================================

function mulberry32(seed) {
    let s = seed | 0;
    return function() {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

console.log("=== SIMULATION: NO BT, start=3, prot=3, 100 runs ===\n");

let totalError = 0;
let errorCount = 0;
const errors = [];

for (let seed = 1; seed <= 100; seed++) {
    const rand = mulberry32(seed * 1000 + 1);
    let level = 3;
    const drops = {};
    let prots = 0;
    
    function successRate(l) { return Math.max(10, 50 - l * 5) / 100; }
    
    for (let i = 0; i < 100; i++) {
        drops[level] = (drops[level] || 0) + 1;
        if (rand() < successRate(level)) {
            level += 1;
        } else {
            if (level >= 3) { level -= 1; prots++; }
            else { level = 0; }
        }
    }
    
    const est = calculateProtectionFromDrops(drops, 3, 3, level);
    const err = est.protCount - prots;
    totalError += err;
    errors.push(err);
    
    if (seed <= 5) {
        console.log(`Seed ${seed}: actual=${prots}, estimated=${est.protCount}, error=${err}`);
        console.log(`  drops=${JSON.stringify(drops)}, final=${level}`);
    }
}

console.log(`\nMean error: ${(totalError / 100).toFixed(2)}`);
console.log(`Error distribution: min=${Math.min(...errors)}, max=${Math.max(...errors)}`);

// ============================================================
// Now test WITHOUT the startLevel adjustment
// ============================================================

function calculateProtectionFromDrops_FIXED(levelDrops, protLevel, startLevel, finalLevel) {
    const levels = Object.keys(levelDrops).map(Number).sort((a, b) => b - a);
    if (levels.length === 0) return { protCount: 0 };
    const maxLevel = Math.max(...levels);
    if (finalLevel === undefined) finalLevel = maxLevel;
    const successes = {}, failures = {}, attempts = {};
    for (let L = 0; L <= maxLevel; L++) {
        attempts[L] = (levelDrops[L] || 0);
        // DON'T add +1 for startLevel — drops already include it
        if (L === finalLevel) attempts[L] -= 1;
    }
    successes[maxLevel] = 0;
    failures[maxLevel] = Math.max(0, attempts[maxLevel]);
    for (let L = maxLevel - 1; L >= 0; L--) {
        let failuresLandingAtLPlus1 = 0;
        if (L + 2 <= maxLevel && L + 2 >= protLevel) {
            failuresLandingAtLPlus1 = failures[L + 2] || 0;
        }
        successes[L] = (levelDrops[L + 1] || 0) - failuresLandingAtLPlus1;
        if (successes[L] < 0) successes[L] = 0;
        failures[L] = attempts[L] - successes[L];
        if (failures[L] < 0) failures[L] = 0;
    }
    let protCount = 0;
    for (let L = protLevel; L <= maxLevel; L++) {
        protCount += failures[L];
    }
    return { protCount: Math.round(protCount) };
}

console.log("\n=== FIXED (no startLevel +1): NO BT, start=3, prot=3, 100 runs ===\n");

totalError = 0;
const fixedErrors = [];

for (let seed = 1; seed <= 100; seed++) {
    const rand = mulberry32(seed * 1000 + 1);
    let level = 3;
    const drops = {};
    let prots = 0;
    
    function successRate(l) { return Math.max(10, 50 - l * 5) / 100; }
    
    for (let i = 0; i < 100; i++) {
        drops[level] = (drops[level] || 0) + 1;
        if (rand() < successRate(level)) {
            level += 1;
        } else {
            if (level >= 3) { level -= 1; prots++; }
            else { level = 0; }
        }
    }
    
    const est = calculateProtectionFromDrops_FIXED(drops, 3, 3, level);
    const err = est.protCount - prots;
    totalError += err;
    fixedErrors.push(err);
}

console.log(`Mean error: ${(totalError / 100).toFixed(2)}`);
console.log(`Error distribution: min=${Math.min(...fixedErrors)}, max=${Math.max(...fixedErrors)}`);

// Also test start=0 with both versions to make sure we don't break it
console.log("\n=== Start=0 comparison (shouldn't change much) ===\n");

let origErr0 = 0, fixedErr0 = 0;
for (let seed = 1; seed <= 100; seed++) {
    const rand = mulberry32(seed * 1000 + 1);
    let level = 0;
    const drops = {};
    let prots = 0;
    
    function successRate(l) { return Math.max(10, 50 - l * 5) / 100; }
    
    for (let i = 0; i < 100; i++) {
        drops[level] = (drops[level] || 0) + 1;
        if (rand() < successRate(level)) {
            level += 1;
        } else {
            if (level >= 3) { level -= 1; prots++; }
            else { level = 0; }
        }
    }
    
    const e1 = calculateProtectionFromDrops(drops, 3, 0, level);
    const e2 = calculateProtectionFromDrops_FIXED(drops, 3, 0, level);
    origErr0 += e1.protCount - prots;
    fixedErr0 += e2.protCount - prots;
}

console.log(`Original (start=0): mean error = ${(origErr0/100).toFixed(2)}`);
console.log(`Fixed (start=0):    mean error = ${(fixedErr0/100).toFixed(2)}`);

// ============================================================
// But wait — what about the REAL game where drops might NOT include
// the starting position? Need to understand the data source.
// ============================================================

console.log("\n=== KEY QUESTION ===");
console.log("Does the real game data include a drop for the starting position?");
console.log("If YES: the +1 is a double-count (bug confirmed).");
console.log("If NO: the +1 is correct and the sim is wrong.");
console.log("The sim records drop(startLevel) as the first action, so in the sim, YES.");
console.log("The real game also records drops for every action including the first.");
console.log("Therefore: THE BUG IS REAL.");
