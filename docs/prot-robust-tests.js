// Robust test cases for calculateProtectionFromDrops
// Tests all combinations of start/final relative to protLevel

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

// ============================================================
// TEST CASES
// ============================================================

const tests = [
    // ---- Test 1: start=0, final=0 (failed session, both below prot) ----
    // Scenario: 0→1(s)→fail(1→0, no prot)→end at 0
    // No activity above protLevel, so 0 prots.
    {
        name: "start=0, final=0 — simple fail, both below prot",
        input: { levelDrops: {0:1, 1:1, 2:1}, protLevel: 3, startLevel: 0, finalLevel: 0 },
        expected: 0,
        reasoning: `Item starts at 0, enhances to 1, then 2, fails at 2→0 (below prot=3, no prot).
Ends at 0. All activity below protLevel=3. Expected: 0 prots.`
    },

    // ---- Test 2: start=0, final=maxLevel (success, start below prot) ----
    // Scenario: 0→1→2→fail(2→0)→0→1→2→3→fail(3→2, PROT)→2→3→4→5 end
    // 1 failure at level 3 (prot used)
    {
        name: "start=0, final=maxLevel — success with one prot failure",
        input: { levelDrops: {0:1, 1:2, 2:3, 3:2, 4:1, 5:1}, protLevel: 3, startLevel: 0, finalLevel: 5 },
        expected: 1,
        reasoning: `Item starts at 0. Path: 0→1→2→fail(2→0, no prot)→0→1→2→3→fail(3→2, PROT)→2→3→4→5.
1 failure at level 3 (>=prot), 1 failure at level 2 (<prot). Expected: 1 prot.`
    },

    // ---- Test 3: start above prot, final=0 (failed from above prot) ----
    // Scenario: start at 4→5(s)→fail(5→4, prot)→fail(4→3, prot)→fail(3→2, prot)→fail(2→0, no prot)→end at 0
    // 3 failures at levels >=3
    {
        name: "start above prot, final=0 — cascading fail from above prot",
        input: { levelDrops: {0:1, 2:1, 3:1, 4:1, 5:1}, protLevel: 3, startLevel: 4, finalLevel: 0 },
        expected: 3,
        reasoning: `Item starts at 4. Path: 4→5(s)→5 fails(5→4, PROT)→4 fails(4→3, PROT)→3 fails(3→2, PROT)→2 fails(2→0, no prot)→end at 0.
Failures at 5,4,3 are all >=prot=3. Expected: 3 prots.
drops: see 5 once(success from 4), 4 once(fail from 5), 3 once(fail from 4), 2 once(fail from 3), 0 once(fail from 2).`
    },

    // ---- Test 3b: start above prot, final=0, MISSING lower-level drops ----
    // Same scenario but drops at 2 and 0 are missing (data gap).
    // This creates negative attempts[0] = -1.
    {
        name: "start above prot, final=0 — missing lower drops (negative attempts[0])",
        input: { levelDrops: {3:1, 4:1, 5:1}, protLevel: 3, startLevel: 4, finalLevel: 0 },
        expected: 3,
        reasoning: `Same scenario as test 3 but drops at levels 0 and 2 are missing.
attempts[0] = 0 - 1(final) = -1 (NEGATIVE). Algorithm clamps failures to 0, so this doesn't crash.
The algorithm should still detect 3 prot failures at levels 5,4,3 from the cascade.
However, missing data may cause incorrect results. Let's see what it gives.`
    },

    // ---- Test 4: start above prot, final=maxLevel (success from above) ----
    // Scenario: start at 4→5(s)→6(s)→fail(6→5, prot)→5→6(s)→7(s)→8(s)→end at 8
    {
        name: "start above prot, final=maxLevel — success from above prot",
        input: { levelDrops: {5:2, 6:2, 7:1, 8:1}, protLevel: 3, startLevel: 4, finalLevel: 8 },
        expected: 1,
        reasoning: `Item starts at 4. Path: 4→5(s)→6(s)→fail(6→5, PROT)→5→6(s)→7(s)→8(s).
1 failure at level 6 (>=prot=3). Expected: 1 prot.`
    },

    // ---- Test 5: start AT prot, final=0 ----
    // Scenario: start at 3→4(s)→fail(4→3, prot)→fail(3→2, prot)→fail(2→0, no prot)→end at 0
    {
        name: "start AT prot, final=0 — fail from prot boundary",
        input: { levelDrops: {0:1, 2:1, 3:1, 4:1}, protLevel: 3, startLevel: 3, finalLevel: 0 },
        expected: 2,
        reasoning: `Item starts at 3 (=protLevel). Path: 3→4(s)→fail(4→3, PROT)→fail(3→2, PROT)→fail(2→0, no prot)→end at 0.
Failures at 4 and 3 are >=prot=3. Failure at 2 is <prot. Expected: 2 prots.`
    },

    // ---- Test 6: start AT prot, final=maxLevel ----
    // Scenario: start at 3→4(s)→fail(4→3, prot)→3→4(s)→5(s)→end at 5
    {
        name: "start AT prot, final=maxLevel — success from prot boundary",
        input: { levelDrops: {3:1, 4:2, 5:1}, protLevel: 3, startLevel: 3, finalLevel: 5 },
        expected: 1,
        reasoning: `Item starts at 3 (=protLevel). Path: 3→4(s)→fail(4→3, PROT)→3→4(s)→5(s)→end at 5.
1 failure at level 4 (>=prot=3). Expected: 1 prot.`
    },

    // ---- Test 7: start=0, final AT prot ----
    // Scenario: 0→1(s)→fail(1→0, no prot)→0→1(s)→2(s)→3(s)→end at 3
    {
        name: "start=0, final AT prot — end exactly at prot boundary",
        input: { levelDrops: {0:1, 1:2, 2:1, 3:1}, protLevel: 3, startLevel: 0, finalLevel: 3 },
        expected: 0,
        reasoning: `Item starts at 0. Path: 0→1(s)→fail(1→0, no prot)→0→1(s)→2(s)→3(s)→end at 3.
1 failure at level 1 (<prot=3). No failures at or above prot. Expected: 0 prots.`
    },

    // ---- Test 8: start below prot, final above prot but below max ----
    // Scenario: start at 1→2(s)→3(s)→4(s)→5(s)→fail(5→4, PROT)→end at 4
    {
        name: "start below prot, final above prot (mid-level end)",
        input: { levelDrops: {2:1, 3:1, 4:2, 5:1}, protLevel: 3, startLevel: 1, finalLevel: 4 },
        expected: 1,
        reasoning: `Item starts at 1. Path: 1→2(s)→3(s)→4(s)→5(s)→fail(5→4, PROT)→end at 4.
1 failure at level 5 (>=prot=3). Expected: 1 prot.`
    },

    // ---- Test 9: start above prot, final above prot (both above) ----
    // Scenario: start at 4→5(s)→fail(5→4, prot)→4→5(s)→6(s)→end at 6
    {
        name: "both start and final above prot",
        input: { levelDrops: {4:1, 5:2, 6:1}, protLevel: 3, startLevel: 4, finalLevel: 6 },
        expected: 1,
        reasoning: `Item starts at 4. Path: 4→5(s)→fail(5→4, PROT)→4→5(s)→6(s)→end at 6.
1 failure at level 5 (>=prot=3). Expected: 1 prot.`
    },

    // ---- Test 10: start=final (session with no net progress) ----
    // Scenario: start at 2→3(s)→fail(3→2, prot)→end at 2. No net progress.
    {
        name: "start=final — no net progress (round-trip)",
        input: { levelDrops: {2:1, 3:1}, protLevel: 3, startLevel: 2, finalLevel: 2 },
        expected: 1,
        reasoning: `Item starts at 2, ends at 2. Path: 2→3(s)→fail(3→2, PROT)→end at 2.
1 failure at level 3 (>=prot=3). Expected: 1 prot.`
    },

    // ---- Test 11: Single-level cycling ----
    // Scenario: start at 4, repeatedly fail at 5: 4→5→fail→4→5→fail→4→5→fail→end at 4
    {
        name: "single-level cycling — repeated fail at same level",
        input: { levelDrops: {4:3, 5:3}, protLevel: 3, startLevel: 4, finalLevel: 4 },
        expected: 3,
        reasoning: `Item starts at 4. Path: 4→5(s)→fail(5→4,P)→4→5(s)→fail(5→4,P)→4→5(s)→fail(5→4,P)→end at 4.
3 failures at level 5 (>=prot=3). Expected: 3 prots.`
    },

    // ---- Test 12: protLevel=0 (protect from the start) ----
    // Scenario: 0→1(s)→fail(1→0, PROT since 1>=0)→0→1(s)→2(s)→3(s)→end at 3
    // With protLevel=0, ALL failures use protection
    {
        name: "protLevel=0 — all failures protected",
        input: { levelDrops: {0:1, 1:2, 2:1, 3:1}, protLevel: 0, startLevel: 0, finalLevel: 3 },
        expected: 1,
        reasoning: `protLevel=0 means every failure uses a protection.
Path: 0→1(s)→fail(1→0, PROT since 1>=0)→0→1(s)→2(s)→3(s)→end at 3.
1 failure at level 1. Since protLevel=0, it counts. Expected: 1 prot.`
    },

    // ---- Test 13: protLevel > maxLevel (no prots should be used) ----
    // Scenario: same path as test 2 but prot=10 (way above max)
    {
        name: "protLevel > maxLevel — no protections possible",
        input: { levelDrops: {0:1, 1:2, 2:1, 3:1, 4:1, 5:1}, protLevel: 10, startLevel: 0, finalLevel: 5 },
        expected: 0,
        reasoning: `protLevel=10, maxLevel=5. No level reaches protLevel, so no prot failures counted.
Path: 0→1→fail(1→0)→0→1→2→3→4→5. 1 failure at level 1, but 1<10.
Expected: 0 prots. (Note: algorithm cascade doesn't count unprotected failures landing at L-1.)`
    },

    // ---- Test 14a-c: Realistic multi-session chain [fail, fail, success] ----
    // Session 1: start=0, reach +5, fail cascade down to 0
    // Path: 0→1→2→3→4→5→fail(5→4,P)→fail(4→3,P)→fail(3→2,P)→fail(2→0)→end at 0
    {
        name: "Chain session 1/3 — fail from +5 back to 0",
        input: { levelDrops: {0:1, 1:1, 2:2, 3:2, 4:2, 5:1}, protLevel: 3, startLevel: 0, finalLevel: 0 },
        expected: 3,
        reasoning: `Session 1 of 3. Item starts at 0, reaches +5, cascading fail back to 0.
Path: 0→1→2→3→4→5→fail(5→4,P)→fail(4→3,P)→fail(3→2,P)→fail(2→0)→end at 0.
Failures at 5,4,3 (all >=prot=3). Expected: 3 prots.`
    },

    // Session 2: start=0 (previous session ended at 0), reach +4, fail cascade to 0
    // Path: 0→1→2→3→4→fail(4→3,P)→fail(3→2,P)→fail(2→0)→end at 0
    {
        name: "Chain session 2/3 — fail from +4 back to 0",
        input: { levelDrops: {0:1, 1:1, 2:2, 3:2, 4:1}, protLevel: 3, startLevel: 0, finalLevel: 0 },
        expected: 2,
        reasoning: `Session 2 of 3. Item starts at 0, reaches +4, cascading fail back to 0.
Path: 0→1→2→3→4→fail(4→3,P)→fail(3→2,P)→fail(2→0)→end at 0.
Failures at 4,3 (both >=prot=3). Expected: 2 prots.`
    },

    // Session 3: start=0, reach +8, success
    // Path: 0→1→2→3→4→fail(4→3,P)→3→4→5→6→7→8→end at 8
    {
        name: "Chain session 3/3 — success to +8 with one prot fail",
        input: { levelDrops: {1:1, 2:1, 3:2, 4:2, 5:1, 6:1, 7:1, 8:1}, protLevel: 3, startLevel: 0, finalLevel: 8 },
        expected: 1,
        reasoning: `Session 3 of 3. Item starts at 0, reaches +8.
Path: 0→1→2→3→4→fail(4→3,P)→3→4→5→6→7→8→end at 8.
1 failure at level 4 (>=prot=3). Expected: 1 prot.`
    },

    // ---- Test 15: BUG FINDER — startLevel > max(levelDrops keys) ----
    // Scenario: start at 6, all attempts fail, cascade to 3.
    // Path: 6→fail(6→5,P)→fail(5→4,P)→fail(4→3,P)→end at 3
    // Drops only at 3,4,5 — startLevel=6 exceeds maxLevel from drops (5)
    {
        name: "BUG FINDER: startLevel > maxLevel from drops",
        input: { levelDrops: {3:1, 4:1, 5:1}, protLevel: 3, startLevel: 6, finalLevel: 3 },
        expected: 3,
        reasoning: `Item starts at 6 (above all drop levels). Cascading fail: 6→5(P)→4(P)→3(P)→end at 3.
3 failures at levels 6,5,4 (all >=prot=3). Expected: 3 prots.
BUG: Algorithm uses maxLevel=max(levelDrops keys)=5. Since startLevel=6>5,
the loop (0..5) never reaches L=6 for the startLevel adjustment.
The attempt at level 6 is LOST. Algorithm will undercount.`
    },

    // ---- Test 16: Empty drops (edge case) ----
    {
        name: "Empty drops — no enhancement activity",
        input: { levelDrops: {}, protLevel: 3, startLevel: 0, finalLevel: 0 },
        expected: 0,
        reasoning: `No drops at all. Algorithm returns {protCount:0} immediately. Expected: 0.`
    },

    // ---- Test 17: Multiple failures at same level above prot ----
    // Scenario: start at 0, item bounces at levels 3-4 multiple times
    // Path: 0→1→2→3→4→fail(4→3,P)→4→fail(4→3,P)→4→5→end at 5
    {
        name: "Multiple failures at same protected level",
        input: { levelDrops: {1:1, 2:1, 3:3, 4:3, 5:1}, protLevel: 3, startLevel: 0, finalLevel: 5 },
        expected: 2,
        reasoning: `Path: 0→1→2→3→4→fail(4→3,P)→3→4→fail(4→3,P)→3→4→5→end at 5.
2 failures at level 4 (>=prot=3). Expected: 2 prots.
drops[3]=3 because: initial pass-through + 2 landings from failing at 4.
drops[4]=3 because: 3 successes from level 3.`
    },

    // ---- Test 18: Failure just below prot boundary ----
    // All failures happen at level 2 (just below prot=3)
    // Path: 0→1→2→fail(2→0)→0→1→2→fail(2→0)→0→1→2→3→end at 3
    {
        name: "All failures just below prot boundary",
        input: { levelDrops: {0:2, 1:3, 2:3, 3:1}, protLevel: 3, startLevel: 0, finalLevel: 3 },
        expected: 0,
        reasoning: `Path: 0→1→2→fail(2→0)→0→1→2→fail(2→0)→0→1→2→3→end at 3.
2 failures at level 2 (<prot=3, no prot used). 0 failures at >=3. Expected: 0 prots.`
    },
];

// ============================================================
// RUN TESTS
// ============================================================

console.log("=" .repeat(70));
console.log("PROTECTION ESTIMATION — ROBUST TEST SUITE");
console.log("=".repeat(70));
console.log();

let passed = 0;
let failed = 0;
const results = [];

tests.forEach((test, i) => {
    const { levelDrops, protLevel, startLevel, finalLevel } = test.input;
    const result = calculateProtectionFromDrops(levelDrops, protLevel, startLevel, finalLevel);
    const pass = result.protCount === test.expected;
    if (pass) passed++; else failed++;
    
    results.push({ ...test, result, pass });
    
    const status = pass ? "PASS ✓" : "FAIL ✗";
    console.log(`${status}  Test ${i + 1}: ${test.name}`);
    console.log(`  Input: drops=${JSON.stringify(levelDrops)}, prot=${protLevel}, start=${startLevel}, final=${finalLevel}`);
    console.log(`  Expected: ${test.expected}, Got: ${result.protCount}`);
    
    if (!pass) {
        console.log(`  *** DISCREPANCY ***`);
    }
    
    // Always show internal state for debugging
    console.log(`  Attempts:  ${JSON.stringify(result.attempts)}`);
    console.log(`  Successes: ${JSON.stringify(result.successes)}`);
    console.log(`  Failures:  ${JSON.stringify(result.failures)}`);
    console.log();
});

// Chain summary
console.log("-".repeat(70));
console.log("CHAIN SUMMARY (Tests 14a + 14b + 14c):");
const chain14a = results.find(r => r.name.includes("session 1/3"));
const chain14b = results.find(r => r.name.includes("session 2/3"));
const chain14c = results.find(r => r.name.includes("session 3/3"));
if (chain14a && chain14b && chain14c) {
    const totalExpected = chain14a.expected + chain14b.expected + chain14c.expected;
    const totalGot = chain14a.result.protCount + chain14b.result.protCount + chain14c.result.protCount;
    console.log(`  Session 1: expected=${chain14a.expected}, got=${chain14a.result.protCount}`);
    console.log(`  Session 2: expected=${chain14b.expected}, got=${chain14b.result.protCount}`);
    console.log(`  Session 3: expected=${chain14c.expected}, got=${chain14c.result.protCount}`);
    console.log(`  Total:     expected=${totalExpected}, got=${totalGot} ${totalExpected === totalGot ? '✓' : '✗'}`);
}
console.log();

// Final summary
console.log("=".repeat(70));
console.log(`FINAL: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter(r => !r.pass).forEach(r => {
        console.log(`  - ${r.name} (expected ${r.expected}, got ${r.result.protCount})`);
    });
}
console.log("=".repeat(70));
