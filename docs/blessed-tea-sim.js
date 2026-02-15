// Blessed Tea Enhancement Simulation
// Tests how blessed tea (+2 procs) affect prot count estimation

// ============================================================
// PRNG (deterministic seeded random)
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

// ============================================================
// Original algorithm
// ============================================================
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
    
    return { protCount: Math.round(protCount) };
}

// ============================================================
// Improved algorithm with blessed tea awareness
// ============================================================
function calculateProtectionFromDropsV2(levelDrops, protLevel, startLevel, finalLevel, opts = {}) {
    const { blessedTea = false } = opts;
    
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
    
    // First pass: standard algorithm (top-down)
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
    
    // Blessed tea correction:
    // When blessed tea is active, ~1% of successes jump +2 instead of +1.
    // This means some arrivals at L+2 came from blessed tea procs at L, not from 
    // successes at L+1. The standard algorithm over-attributes these to successes
    // from L+1, which can cause errors.
    //
    // Correction: For each level L, estimate how many blessed tea procs occurred.
    // A blessed tea proc at L means: one fewer arrival at L+1 (than expected),
    // one extra arrival at L+2. We estimate procs as ~1% of successes at L.
    // Then reduce failures at L by that amount (since the algorithm may have
    // over-counted failures due to missing L+1 arrivals).
    if (blessedTea) {
        const blessedRate = 0.01;
        
        // Estimate blessed tea procs per level and correct
        for (let L = 0; L <= maxLevel - 2; L++) {
            const estimatedProcs = Math.round(successes[L] * blessedRate);
            if (estimatedProcs > 0) {
                // These procs mean `estimatedProcs` arrivals at L+2 came from L (not L+1)
                // and `estimatedProcs` fewer arrivals at L+1 than expected.
                // The standard algorithm already computed successes[L] based on arrivals at L+1,
                // so it underestimated successes[L] by ~estimatedProcs.
                // Correct by adding procs back to successes[L] and removing from failures[L].
                successes[L] += estimatedProcs;
                failures[L] = Math.max(0, failures[L] - estimatedProcs);
            }
        }
    }
    
    let protCount = 0;
    for (let L = protLevel; L <= maxLevel; L++) {
        protCount += failures[L];
    }
    
    return { protCount: Math.round(protCount) };
}

// ============================================================
// Enhancement Simulation
// ============================================================
function simulate(opts) {
    const {
        actions = 100,
        startLevel = 0,
        protLevel = 3,
        blessedTeaChance = 0.01,
        seed = 42,
    } = opts;

    const rand = mulberry32(seed);
    
    function successRate(level) {
        return Math.max(10, 50 - level * 5) / 100;
    }

    let level = startLevel;
    const levelDrops = {};
    let protCount = 0;
    let blessedProcs = 0;

    function recordDrop(l) {
        levelDrops[l] = (levelDrops[l] || 0) + 1;
    }

    for (let i = 0; i < actions; i++) {
        recordDrop(level);
        
        if (rand() < successRate(level)) {
            let gain = 1;
            if (blessedTeaChance > 0 && rand() < blessedTeaChance) {
                gain = 2;
                blessedProcs++;
            }
            level += gain;
        } else {
            if (level >= protLevel) {
                level -= 1;
                protCount++;
            } else {
                level = 0;
            }
        }
    }

    return { levelDrops, startLevel, finalLevel: level, protLevel, actualProtCount: protCount, blessedProcs, actions };
}

// ============================================================
// Test Runner
// ============================================================
function runScenarios() {
    const scenarios = [
        { name: "100 actions, NO BT, start=0, prot=3", actions: 100, startLevel: 0, protLevel: 3, blessedTeaChance: 0, runs: 100 },
        { name: "100 actions, NO BT, start=0, prot=5", actions: 100, startLevel: 0, protLevel: 5, blessedTeaChance: 0, runs: 100 },
        { name: "100 actions, 1% BT, start=0, prot=3", actions: 100, startLevel: 0, protLevel: 3, blessedTeaChance: 0.01, runs: 100 },
        { name: "100 actions, 1% BT, start=0, prot=5", actions: 100, startLevel: 0, protLevel: 5, blessedTeaChance: 0.01, runs: 100 },
        { name: "100 actions, 1% BT, start=3, prot=3", actions: 100, startLevel: 3, protLevel: 3, blessedTeaChance: 0.01, runs: 100 },
        { name: "100 actions, 1% BT, start=5, prot=5", actions: 100, startLevel: 5, protLevel: 5, blessedTeaChance: 0.01, runs: 100 },
        { name: "100 actions, 1% BT, start=0, prot=8", actions: 100, startLevel: 0, protLevel: 8, blessedTeaChance: 0.01, runs: 100 },
        { name: "500 actions, NO BT, start=0, prot=3", actions: 500, startLevel: 0, protLevel: 3, blessedTeaChance: 0, runs: 100 },
        { name: "500 actions, 1% BT, start=0, prot=3", actions: 500, startLevel: 0, protLevel: 3, blessedTeaChance: 0.01, runs: 100 },
        { name: "500 actions, 1% BT, start=0, prot=5", actions: 500, startLevel: 0, protLevel: 5, blessedTeaChance: 0.01, runs: 100 },
        { name: "500 actions, 1% BT, start=0, prot=8", actions: 500, startLevel: 0, protLevel: 8, blessedTeaChance: 0.01, runs: 100 },
        { name: "500 actions, 1% BT, start=5, prot=8", actions: 500, startLevel: 5, protLevel: 8, blessedTeaChance: 0.01, runs: 100 },
        { name: "500 actions, 5% BT, start=0, prot=5", actions: 500, startLevel: 0, protLevel: 5, blessedTeaChance: 0.05, runs: 100 },
    ];

    const results = [];

    for (const scenario of scenarios) {
        const errorsV1 = [];
        const errorsV2 = [];
        let totalBlessedProcs = 0;
        let totalActualProt = 0;

        for (let run = 0; run < scenario.runs; run++) {
            const sim = simulate({
                actions: scenario.actions,
                startLevel: scenario.startLevel,
                protLevel: scenario.protLevel,
                blessedTeaChance: scenario.blessedTeaChance,
                seed: run * 1000 + 1,
            });

            const estV1 = calculateProtectionFromDrops(
                sim.levelDrops, sim.protLevel, sim.startLevel, sim.finalLevel
            );
            const estV2 = calculateProtectionFromDropsV2(
                sim.levelDrops, sim.protLevel, sim.startLevel, sim.finalLevel,
                { blessedTea: scenario.blessedTeaChance > 0 }
            );

            errorsV1.push(estV1.protCount - sim.actualProtCount);
            errorsV2.push(estV2.protCount - sim.actualProtCount);
            totalBlessedProcs += sim.blessedProcs;
            totalActualProt += sim.actualProtCount;
        }

        const stats = (errors) => ({
            meanError: (errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(2),
            meanAbsError: (errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length).toFixed(2),
            maxAbsError: Math.max(...errors.map(Math.abs)),
        });

        results.push({
            name: scenario.name,
            v1: stats(errorsV1),
            v2: stats(errorsV2),
            meanActualProt: (totalActualProt / scenario.runs).toFixed(1),
            meanBlessedProcs: (totalBlessedProcs / scenario.runs).toFixed(2),
        });
    }

    return results;
}

const results = runScenarios();

console.log("# Blessed Tea Simulation — V1 vs V2 Comparison\n");
console.log("| Scenario | V1 Mean Err | V1 |Err| | V1 Max | V2 Mean Err | V2 |Err| | V2 Max | Prots | BT Procs |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
    console.log(`| ${r.name} | ${r.v1.meanError} | ${r.v1.meanAbsError} | ${r.v1.maxAbsError} | ${r.v2.meanError} | ${r.v2.meanAbsError} | ${r.v2.maxAbsError} | ${r.meanActualProt} | ${r.meanBlessedProcs} |`);
}
