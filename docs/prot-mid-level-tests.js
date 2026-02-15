// Additional tests: start/final in the middle, drops ranging above AND below both
// Focus on scenarios where the item oscillates through the start/final/prot levels

function calculateProtectionFromDrops(levelDrops, protLevel, startLevel, finalLevelOverride) {
    const levels = Object.keys(levelDrops).map(Number).sort((a, b) => b - a);
    if (levels.length === 0) return { protCount: 0 };
    const maxLevel = Math.max(...levels);
    const finalLevel = finalLevelOverride !== undefined ? finalLevelOverride : maxLevel;
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

const tests = [
    {
        name: "1. Start=3, Final=3, Prot@5 — drops range 0-8, round-trip back to start",
        // Item starts at 3, goes up to 8, fails back down, ends at 3 again
        // Drops at every level represent oscillation
        levelDrops: {0: 2, 1: 3, 2: 4, 3: 5, 4: 3, 5: 2, 6: 2, 7: 1, 8: 1},
        protLevel: 5, startLevel: 3, finalLevel: 3,
        reasoning: "Start and final both at 3 (below prot). Drops go 0-8 so item oscillated above and below prot. Prots used = failures at levels 5,6,7,8."
    },
    {
        name: "2. Start=5, Final=5, Prot@5 — drops range 0-10, round-trip at prot boundary",
        levelDrops: {0: 3, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 4, 7: 3, 8: 2, 9: 1, 10: 1},
        protLevel: 5, startLevel: 5, finalLevel: 5,
        reasoning: "Start and final AT prot level. Heavy oscillation. Drops below prot mean unprotected crashes. Prots = failures at 5-10."
    },
    {
        name: "3. Start=7, Final=7, Prot@5 — drops range 0-10, round-trip above prot",
        levelDrops: {0: 2, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 8, 8: 4, 9: 2, 10: 1},
        protLevel: 5, startLevel: 7, finalLevel: 7,
        reasoning: "Start and final both above prot. Lots of drops below start. Prots = failures at 5-10."
    },
    {
        name: "4. Start=3, Final=7, Prot@5 — drops range 0-10, end above start and above prot",
        levelDrops: {0: 2, 1: 2, 2: 3, 3: 4, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1, 10: 1},
        protLevel: 5, startLevel: 3, finalLevel: 7,
        reasoning: "Start below prot, final above prot. Drops range well above and below both."
    },
    {
        name: "5. Start=7, Final=3, Prot@5 — drops range 0-10, end below start",
        // Failed: started high, dropped low
        levelDrops: {0: 2, 1: 2, 2: 3, 3: 4, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1, 10: 1},
        protLevel: 5, startLevel: 7, finalLevel: 3,
        reasoning: "Start above prot, final below prot. Same drops as test 4 but reversed start/final."
    },
    {
        name: "6. Start=5, Final=8, Prot@5 — success from prot boundary",
        levelDrops: {0: 1, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 3, 7: 2, 8: 1},
        protLevel: 5, startLevel: 5, finalLevel: 8,
        reasoning: "Start at prot, end above. Drops range below prot (failed down to 0 sometimes)."
    },
    {
        name: "7. Start=8, Final=0, Prot@5 — total failure from high level",
        levelDrops: {0: 3, 1: 2, 2: 2, 3: 3, 4: 4, 5: 5, 6: 4, 7: 3, 8: 3},
        protLevel: 5, startLevel: 8, finalLevel: 0,
        reasoning: "Started very high, ended at 0. Many drops above prot = many prots consumed."
    },
    {
        name: "8. Start=6, Final=4, Prot@5 — fail from above to below prot, drops 0-9",
        levelDrops: {0: 3, 1: 2, 2: 2, 3: 3, 4: 4, 5: 5, 6: 4, 7: 3, 8: 2, 9: 1},
        protLevel: 5, startLevel: 6, finalLevel: 4,
        reasoning: "Start above prot, final just below prot. Crossed prot boundary on the way down."
    },
    {
        name: "9. Start=4, Final=6, Prot@5 — success from below to above prot",
        levelDrops: {0: 3, 1: 2, 2: 2, 3: 3, 4: 4, 5: 5, 6: 4, 7: 3, 8: 2, 9: 1},
        protLevel: 5, startLevel: 4, finalLevel: 6,
        reasoning: "Same drops as test 8, but start/final swapped. Start below prot, end above."
    },
    {
        name: "10. Start=3, Final=0, Prot@8 — high prot level, drops only reach 7",
        levelDrops: {0: 5, 1: 4, 2: 3, 3: 4, 4: 3, 5: 2, 6: 2, 7: 1},
        protLevel: 8, startLevel: 3, finalLevel: 0,
        reasoning: "Prot@8 but drops only reach 7. No drops at or above prot = 0 prots used."
    },
    {
        name: "11. Start=3, Final=0, Prot@3 — prot at start level, drops 0-6",
        levelDrops: {0: 4, 1: 3, 2: 3, 3: 4, 4: 2, 5: 1, 6: 1},
        protLevel: 3, startLevel: 3, finalLevel: 0,
        reasoning: "Prot starts right at start level. Every failure at 3+ uses a prot."
    },
    {
        name: "12. Symmetric test: start=5 final=5 vs start=0 final=0 — same drops, prot@5",
        levelDrops: {0: 3, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 5, 7: 3, 8: 2, 9: 1, 10: 1},
        protLevel: 5, startLevel: 5, finalLevel: 5,
        reasoning: "Compare this with same drops but start=0 final=0."
    },
    {
        name: "12b. Same drops as 12, but start=0 final=0",
        levelDrops: {0: 3, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 5, 7: 3, 8: 2, 9: 1, 10: 1},
        protLevel: 5, startLevel: 0, finalLevel: 0,
        reasoning: "Same drops as test 12. Different start/final should give different prot count."
    },
];

console.log("=== Mid-Level Start/Final Tests ===\n");

for (const tc of tests) {
    const r = calculateProtectionFromDrops(tc.levelDrops, tc.protLevel, tc.startLevel, tc.finalLevel);
    console.log(`${tc.name}`);
    console.log(`  Input: drops=${JSON.stringify(tc.levelDrops)}`);
    console.log(`  start=${tc.startLevel}, final=${tc.finalLevel}, prot@${tc.protLevel}`);
    console.log(`  Result: ${r.protCount} prots`);
    console.log(`  Failures: ${JSON.stringify(r.failures)}`);
    console.log(`  Attempts: ${JSON.stringify(r.attempts)}`);
    console.log(`  Reasoning: ${tc.reasoning}`);
    
    // Sanity check: prots should never be negative
    if (r.protCount < 0) console.log(`  ⚠️ NEGATIVE PROT COUNT`);
    
    // Check for negative attempts (edge case flag)
    const negAttempts = Object.entries(r.attempts).filter(([l, a]) => a < 0);
    if (negAttempts.length > 0) {
        console.log(`  ⚠️ Negative attempts at levels: ${negAttempts.map(([l,a]) => `${l}(${a})`).join(', ')}`);
    }
    console.log();
}

// Compare test 12 vs 12b
console.log("=== Comparison: Test 12 vs 12b ===");
const r12 = calculateProtectionFromDrops(
    {0: 3, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 5, 7: 3, 8: 2, 9: 1, 10: 1}, 5, 5, 5);
const r12b = calculateProtectionFromDrops(
    {0: 3, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 5, 7: 3, 8: 2, 9: 1, 10: 1}, 5, 0, 0);
console.log(`Test 12 (start=5, final=5): ${r12.protCount} prots`);
console.log(`Test 12b (start=0, final=0): ${r12b.protCount} prots`);
console.log(`Difference: ${r12.protCount - r12b.protCount}`);
