// Test: how finalLevel=0 vs finalLevel=maxLevel affects prot count
// Using the actual calculateProtectionFromDrops algorithm from main.js

function calculateProtectionFromDrops(levelDrops, protLevel, startLevel, finalLevelOverride) {
    const levels = Object.keys(levelDrops).map(Number).sort((a, b) => b - a);
    if (levels.length === 0) return { protCount: 0 };
    
    const maxLevel = Math.max(...levels);
    const finalLevel = finalLevelOverride !== undefined ? finalLevelOverride : maxLevel;
    
    const successes = {};
    const failures = {};
    const attempts = {};
    
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

// Test cases from earlier sessions (from memory)
const testCases = [
    {
        name: "Soul Hunter Crossbow (success, prot@5)",
        levelDrops: {0: 27, 1: 14, 2: 10, 3: 8, 4: 6, 5: 5, 6: 4, 7: 3, 8: 2, 9: 1, 10: 1},
        protLevel: 5, startLevel: 0, isSuccess: true
    },
    {
        name: "Dairyhands Top (success, prot@8)", 
        levelDrops: {0: 3, 1: 2, 2: 2, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1},
        protLevel: 8, startLevel: 0, isSuccess: true
    },
    {
        name: "Royal Fire Robe Refined (success 0->+9, prot@7)",
        levelDrops: {0: 10, 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1, 9: 1, 11: 1},
        protLevel: 7, startLevel: 0, isSuccess: true
    },
    {
        name: "Red Culinary Hat multi-result (success, prot@5)",
        levelDrops: {0: 35, 1: 20, 2: 15, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1, 11: 1},
        protLevel: 5, startLevel: 0, isSuccess: true
    },
    // Simulated FAILED versions of the same sessions
    {
        name: "Soul Hunter Crossbow (FAILED, prot@5)",
        levelDrops: {0: 27, 1: 14, 2: 10, 3: 8, 4: 6, 5: 5, 6: 4, 7: 3, 8: 2, 9: 1, 10: 1},
        protLevel: 5, startLevel: 0, isSuccess: false
    },
    {
        name: "Dairyhands Top (FAILED, prot@8)",
        levelDrops: {0: 3, 1: 2, 2: 2, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1},
        protLevel: 8, startLevel: 0, isSuccess: false
    },
    {
        name: "Royal Fire Robe Refined (FAILED, prot@7)",
        levelDrops: {0: 10, 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1, 9: 1, 11: 1},
        protLevel: 7, startLevel: 0, isSuccess: false
    },
];

console.log("=== Protection Count: finalLevel=maxLevel vs finalLevel=0 ===\n");

for (const tc of testCases) {
    const finalMax = tc.isSuccess ? undefined : undefined; // current: always maxLevel
    const final0 = tc.isSuccess ? undefined : 0; // proposed: 0 for failures
    
    const resultCurrent = calculateProtectionFromDrops(tc.levelDrops, tc.protLevel, tc.startLevel);
    const resultProposed = calculateProtectionFromDrops(tc.levelDrops, tc.protLevel, tc.startLevel, 
        tc.isSuccess ? undefined : 0);
    
    const diff = resultProposed.protCount - resultCurrent.protCount;
    console.log(`${tc.name}:`);
    console.log(`  Current (final=max): ${resultCurrent.protCount} prots`);
    console.log(`  Proposed (final=${tc.isSuccess ? 'max' : '0'}): ${resultProposed.protCount} prots`);
    console.log(`  Diff: ${diff > 0 ? '+' : ''}${diff}`);
    if (!tc.isSuccess && diff !== 0) {
        console.log(`  Failures by level:`, resultProposed.failures);
    }
    console.log();
}
