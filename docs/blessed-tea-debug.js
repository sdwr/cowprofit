// Debug: understand WHY start=prot has high error with blessed tea

function mulberry32(seed) {
    let s = seed | 0;
    return function() {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function simulate(opts) {
    const { actions = 100, startLevel = 0, protLevel = 3, blessedTeaChance = 0.01, seed = 42 } = opts;
    const rand = mulberry32(seed);
    function successRate(level) { return Math.max(10, 50 - level * 5) / 100; }

    let level = startLevel;
    const levelDrops = {};
    let protCount = 0;
    let blessedProcs = 0;
    const log = [];

    function recordDrop(l) { levelDrops[l] = (levelDrops[l] || 0) + 1; }

    for (let i = 0; i < actions; i++) {
        recordDrop(level);
        const prevLevel = level;
        
        if (rand() < successRate(level)) {
            let gain = 1;
            if (blessedTeaChance > 0 && rand() < blessedTeaChance) {
                gain = 2;
                blessedProcs++;
                log.push(`  Action ${i}: level ${prevLevel} → SUCCESS +2 (BT!) → level ${prevLevel + 2}`);
            }
            level += gain;
        } else {
            if (level >= protLevel) {
                level -= 1;
                protCount++;
                log.push(`  Action ${i}: level ${prevLevel} → FAIL (PROT) → level ${level}`);
            } else {
                level = 0;
                if (prevLevel > 0) log.push(`  Action ${i}: level ${prevLevel} → FAIL (no prot) → level 0`);
            }
        }
    }

    return { levelDrops, startLevel, finalLevel: level, protLevel, actualProtCount: protCount, blessedProcs, log };
}

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
        if (L + 2 <= maxLevel && L + 2 >= protLevel) failuresLandingAtLPlus1 = failures[L + 2] || 0;
        successes[L] = (levelDrops[L + 1] || 0) - failuresLandingAtLPlus1;
        if (successes[L] < 0) successes[L] = 0;
        failures[L] = attempts[L] - successes[L];
        if (failures[L] < 0) failures[L] = 0;
    }
    let protCount = 0;
    for (let L = protLevel; L <= maxLevel; L++) protCount += failures[L];
    return { protCount: Math.round(protCount), successes, failures, attempts };
}

// Find a run where blessed tea causes error
for (let seed = 1; seed < 200; seed++) {
    const sim = simulate({ actions: 100, startLevel: 3, protLevel: 3, blessedTeaChance: 0.01, seed: seed * 1000 + 1 });
    const est = calculateProtectionFromDrops(sim.levelDrops, sim.protLevel, sim.startLevel, sim.finalLevel);
    const error = est.protCount - sim.actualProtCount;
    if (sim.blessedProcs > 0 && error !== 0) {
        console.log(`\n=== Seed ${seed * 1000 + 1}, BT procs: ${sim.blessedProcs}, error: ${error} ===`);
        console.log(`Actual prots: ${sim.actualProtCount}, Estimated: ${est.protCount}`);
        console.log(`Final level: ${sim.finalLevel}`);
        console.log(`Level drops: ${JSON.stringify(sim.levelDrops)}`);
        console.log(`Attempts:  ${JSON.stringify(est.attempts)}`);
        console.log(`Successes: ${JSON.stringify(est.successes)}`);
        console.log(`Failures:  ${JSON.stringify(est.failures)}`);
        console.log("Key events:");
        sim.log.forEach(l => console.log(l));
        break;
    }
}

// Also check: how many runs have errors WITHOUT blessed tea procs?
let errWithBT = 0, errWithoutBT = 0, totalWithBT = 0, totalWithoutBT = 0;
for (let seed = 1; seed <= 100; seed++) {
    const sim = simulate({ actions: 100, startLevel: 3, protLevel: 3, blessedTeaChance: 0.01, seed: seed * 1000 + 1 });
    const est = calculateProtectionFromDrops(sim.levelDrops, sim.protLevel, sim.startLevel, sim.finalLevel);
    const error = est.protCount - sim.actualProtCount;
    if (sim.blessedProcs > 0) { totalWithBT++; if (error !== 0) errWithBT++; }
    else { totalWithoutBT++; if (error !== 0) errWithoutBT++; }
}
console.log(`\n--- Error rate breakdown ---`);
console.log(`With BT procs: ${errWithBT}/${totalWithBT} runs had errors`);
console.log(`Without BT procs: ${errWithoutBT}/${totalWithoutBT} runs had errors`);
