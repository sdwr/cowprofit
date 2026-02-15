// Test: mid-level finalLevel + chained start levels in groups

function calculateProtectionFromDrops(levelDrops, protLevel, startLevel, finalLevel) {
    const levels = Object.keys(levelDrops).map(Number).sort((a, b) => b - a);
    if (levels.length === 0) return { protCount: 0 };
    
    const maxLevel = Math.max(...levels);
    if (finalLevel === undefined) finalLevel = maxLevel;
    
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

// Test 1: Does mid-level finalLevel work?
// Scenario: item starts at 0, reaches +8, fails and ends at +3
// Drops: {0:5, 1:3, 2:2, 3:2, 4:1, 5:1, 6:1, 7:1, 8:1}
console.log("=== Test 1: Mid-level finalLevel ===");
const drops1 = {0:5, 1:3, 2:2, 3:2, 4:1, 5:1, 6:1, 7:1, 8:1};
const r1a = calculateProtectionFromDrops(drops1, 5, 0, 8);  // current: final=max
const r1b = calculateProtectionFromDrops(drops1, 5, 0, 0);  // proposed fail: final=0
const r1c = calculateProtectionFromDrops(drops1, 5, 0, 3);  // mid: final=3
console.log(`  final=8 (max):  ${r1a.protCount} prots, attempts:`, r1a.attempts);
console.log(`  final=0:        ${r1b.protCount} prots, attempts:`, r1b.attempts);
console.log(`  final=3 (mid):  ${r1c.protCount} prots, attempts:`, r1c.attempts);
console.log();

// Test 2: Chained group scenario
// Group: [fail1, fail2, success]
// All same item, prot@5
// fail1: drops={0:5, 1:3, 2:2, 3:1, 4:1, 5:1, 6:1}, starts at 0, fails -> ends at 0
// fail2: drops={0:4, 1:2, 2:2, 3:1, 4:1, 5:1}, starts at 0, fails -> ends at 0
// success: drops={0:3, 1:2, 2:1, 3:1, 4:1, 5:1, 6:1, 7:1, 8:1}, starts at 0, succeeds -> ends at 8

console.log("=== Test 2: Chained group (all start at 0 since fails end at 0) ===");
const g1 = calculateProtectionFromDrops({0:5, 1:3, 2:2, 3:1, 4:1, 5:1, 6:1}, 5, 0, 0);
const g2 = calculateProtectionFromDrops({0:4, 1:2, 2:2, 3:1, 4:1, 5:1}, 5, 0, 0);
const g3 = calculateProtectionFromDrops({0:3, 1:2, 2:1, 3:1, 4:1, 5:1, 6:1, 7:1, 8:1}, 5, 0, 8);
console.log(`  fail1 (start=0, final=0): ${g1.protCount} prots`);
console.log(`  fail2 (start=0, final=0): ${g2.protCount} prots`);
console.log(`  success (start=0, final=8): ${g3.protCount} prots`);
console.log(`  Total: ${g1.protCount + g2.protCount + g3.protCount} prots`);
console.log();

// Test 3: What if fail doesn't end at 0 but at startLevel?
// If item has prot@5 and fails at level 7, it drops: 7->6->5->4 (below prot, falls to 0)
// Actually with protection, fail at L drops to L-1. Without prot (below protLevel), drops to 0.
// So a fail at level 7 with prot@5: 7->6->5->4(no prot)->0
// A fail at level 4 (below prot): 4->0
// So failed sessions DO end at 0 if the final failure is below protLevel
// But the SESSION ends wherever the timer runs out - could be mid-enhance at level 3

console.log("=== Test 3: Session starting at non-zero (item already at +3) ===");
// Item starts at +3, reaches +8, fails, ends at 0
const drops3 = {3:2, 4:1, 5:1, 6:1, 7:1, 8:1}; // no drops at 0,1,2 since started at 3
const r3a = calculateProtectionFromDrops(drops3, 5, 3, 8);  // current
const r3b = calculateProtectionFromDrops(drops3, 5, 3, 0);  // proposed
console.log(`  start=3, final=8 (current): ${r3a.protCount} prots, attempts:`, r3a.attempts);
console.log(`  start=3, final=0 (proposed): ${r3b.protCount} prots, attempts:`, r3b.attempts);
console.log();

// Test 4: Chained group where session 1 succeeds at +5, session 2 starts at +5
console.log("=== Test 4: Continue from previous success ===");
// Session 1: 0->+5 success
const s1 = calculateProtectionFromDrops({0:3, 1:2, 2:1, 3:1, 4:1, 5:1}, 5, 0, 5);
// Session 2: +5->+10 (starts at 5, different drop profile)
const s2 = calculateProtectionFromDrops({5:3, 6:2, 7:2, 8:1, 9:1, 10:1}, 5, 5, 10);
console.log(`  session1 (0->+5 success): ${s1.protCount} prots`);
console.log(`  session2 (+5->+10 success): ${s2.protCount} prots`);
console.log(`  Total: ${s1.protCount + s2.protCount} prots`);
console.log();

// Test 5: Edge case - finalLevel below startLevel (shouldn't happen but test)
console.log("=== Test 5: Edge case - final=0 when start=3 ===");
const r5 = calculateProtectionFromDrops({3:2, 4:1, 5:1}, 5, 3, 0);
console.log(`  start=3, final=0: ${r5.protCount} prots, attempts:`, r5.attempts);
// attempts[0] should be -1 (subtracting final), attempts[3] should be 2+1=3
console.log(`  Note: attempts[0]=${r5.attempts[0]} (negative from final adjustment)`);
