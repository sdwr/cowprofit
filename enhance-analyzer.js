/**
 * Enhancement Session Analyzer
 * Reverse-engineers enhancement session data to detect:
 * 1. Starting level of items
 * 2. Protection items consumed
 */

// Success rates by level (approximate from game data)
const SUCCESS_RATES = {
  0: 0.75, 1: 0.50, 2: 0.35, 3: 0.30, 4: 0.25,
  5: 0.20, 6: 0.15, 7: 0.12, 8: 0.10, 9: 0.08,
  10: 0.06, 11: 0.05, 12: 0.04, 13: 0.03
};

const BLESSED_TEA_DOUBLE_CHANCE = 0.01; // 1% chance to go +2
const DEFAULT_PROTECTION_LEVEL = 8; // Protection kicks in at +8

/**
 * Simulate an enhancement session
 * @param {number} startLevel - Starting enhancement level
 * @param {number} targetLevel - Target enhancement level
 * @param {number} numItems - Number of items to enhance to target
 * @param {Object} successRates - Success rates by level
 * @param {boolean} useBlessedTea - Whether blessed tea is active (1% double enhance)
 * @param {number} protectionLevel - Level at which protection kicks in (default 8)
 * @returns {Object} { actionCount, drops, protectionsUsed, itemsCompleted }
 */
function simulateEnhanceSession(startLevel, targetLevel, numItems, successRates = SUCCESS_RATES, useBlessedTea = false, protectionLevel = DEFAULT_PROTECTION_LEVEL) {
  const drops = {}; // level -> count of items that landed at this level
  let actionCount = 0;
  let protectionsUsed = 0;
  let itemsCompleted = 0;
  
  // Initialize drops counter
  for (let i = 0; i <= targetLevel; i++) {
    drops[i] = 0;
  }
  
  // Process each item
  for (let item = 0; item < numItems; item++) {
    let currentLevel = startLevel;
    
    while (currentLevel < targetLevel) {
      actionCount++;
      const rate = successRates[currentLevel] || 0.03;
      const roll = Math.random();
      
      if (roll < rate) {
        // Success!
        let levelGain = 1;
        
        // Blessed tea: 1% chance to double enhance
        if (useBlessedTea && Math.random() < BLESSED_TEA_DOUBLE_CHANCE) {
          levelGain = 2;
        }
        
        currentLevel = Math.min(currentLevel + levelGain, targetLevel);
        
        // Record the drop at the new level
        drops[currentLevel] = (drops[currentLevel] || 0) + 1;
      } else {
        // Failure!
        if (currentLevel >= protectionLevel) {
          // Protected: go down 1 level, consume protection
          protectionsUsed++;
          currentLevel--;
          drops[currentLevel] = (drops[currentLevel] || 0) + 1;
        } else {
          // No protection: reset to 0
          currentLevel = 0;
          drops[0] = (drops[0] || 0) + 1;
        }
      }
    }
    
    itemsCompleted++;
  }
  
  return { actionCount, drops, protectionsUsed, itemsCompleted };
}

/**
 * Detect the starting level from drops data using flow analysis
 * 
 * Theory: At each level, items arrive from:
 *   - Successful enhances from level-1 (or level-2 with blessed tea)
 *   - Failed enhances from level+1 (if level >= protectionLevel-1)
 *   - Failed enhances at any level < protectionLevel (for level 0)
 *   - Starting items (the "phantom input" we're looking for)
 * 
 * @param {Object} drops - { level: count } of items that arrived at each level
 * @param {Object} successRates - Success rates by level
 * @param {number} blessedTeaChance - Probability of double enhance (0 or 0.01)
 * @param {number} protectionLevel - Level at which protection kicks in
 * @param {number} targetLevel - The highest level we're enhancing to
 * @returns {Object} { startLevel, confidence, analysis }
 */
function detectStartLevel(drops, successRates = SUCCESS_RATES, blessedTeaChance = 0, protectionLevel = DEFAULT_PROTECTION_LEVEL, targetLevel = null) {
  // Find the highest level in drops
  const levels = Object.keys(drops).map(Number).filter(l => drops[l] > 0);
  if (levels.length === 0) return { startLevel: 0, confidence: 0, analysis: {} };
  
  const maxLevel = Math.max(...levels);
  targetLevel = targetLevel || maxLevel;
  
  const analysis = {};
  
  // Work backwards from target level
  // At each level, calculate expected arrivals vs actual drops
  
  // Track "items passing through" each level (successful enhances from that level)
  // items_through[L] = number of successful enhances that happened at level L
  
  // Key insight: drops[L] counts arrivals at L
  // For L < protectionLevel-1: arrivals come from success at L-1 (and L-2 with tea) or reset from failures
  // For L >= protectionLevel-1: arrivals also come from failures at L+1
  
  // The starting level is where we have "extra" arrivals that aren't explained by the flow
  
  let candidateStarts = {};
  
  // Simple heuristic: find the lowest non-zero level with a "gap" in the flow
  // If there are drops at level L but far fewer at L-1, L might be the start
  
  // More rigorous: use expected value calculations
  // Expected drops at level 0 from failures = sum of (attempts at L) * (1 - rate[L]) for L < protLevel
  
  // For now, use the discrepancy method:
  // At the start level, drops should exceed what can be explained by incoming flow
  
  // Calculate expected flow ratios
  for (let level = 0; level <= maxLevel; level++) {
    const dropsAtLevel = drops[level] || 0;
    
    // Expected sources of arrivals at this level:
    let expectedFromBelow = 0;
    let expectedFromAbove = 0;
    
    if (level > 0 && drops[level - 1]) {
      // Items that successfully enhanced from level-1
      // But we don't know attempts, only arrivals...
      // This is tricky because drops[L] = arrivals, not attempts
    }
    
    analysis[level] = {
      drops: dropsAtLevel,
      expectedFromBelow,
      expectedFromAbove
    };
  }
  
  // Simplified detection: The start level is likely where:
  // 1. There are drops at that level
  // 2. There are NO (or very few) drops at level-1 that could explain the arrivals
  // 3. Level > 0 (or level 0 with drops that exceed expected resets)
  
  // For levels >= protectionLevel, failures at L+1 create drops at L
  // So we need to account for that
  
  // Let's use a ratio-based approach:
  // At each level L (where L > 0 and L < protLevel), items arrive from level L-1
  // The ratio drops[L] / drops[L-1] should approximate successRate[L-1]
  // If drops[L] >> drops[L-1] * successRate[L-1], level L might be a start
  
  for (let level = 1; level <= maxLevel; level++) {
    const dropsHere = drops[level] || 0;
    const dropsBelow = drops[level - 1] || 0;
    
    if (dropsHere === 0) continue;
    
    // Estimate how many arrivals at level came from below
    let explainedByBelow = 0;
    
    if (level < protectionLevel) {
      // No failures from above feed into this level
      // Arrivals = successful enhances from level-1
      // But items at level-1 may have been enhanced multiple times...
      // This is complex because of cycling
    }
    
    // Simple heuristic: if dropsBelow is 0 and dropsHere > 0, this is likely the start
    if (dropsBelow === 0 && dropsHere > 0 && level > 0) {
      candidateStarts[level] = (candidateStarts[level] || 0) + dropsHere;
    }
  }
  
  // If level 0 has very few drops relative to what we'd expect from resets, 
  // the start might be > 0
  
  // Find the most likely start level
  const candidates = Object.entries(candidateStarts);
  if (candidates.length > 0) {
    // Sort by count (higher = more confident)
    candidates.sort((a, b) => b[1] - a[1]);
    return {
      startLevel: parseInt(candidates[0][0]),
      confidence: candidates[0][1],
      analysis,
      candidates: candidateStarts
    };
  }
  
  // Default: if we have drops at 0, start was probably 0
  if (drops[0] > 0) {
    return { startLevel: 0, confidence: drops[0], analysis, candidates: { 0: drops[0] } };
  }
  
  // Fallback: lowest level with drops
  const minLevel = Math.min(...levels);
  return { startLevel: minLevel, confidence: drops[minLevel], analysis, candidates: { [minLevel]: drops[minLevel] } };
}

/**
 * More sophisticated start level detection using Markov chain analysis
 * 
 * @param {Object} drops - { level: count }
 * @param {Object} successRates - Success rates by level
 * @param {number} blessedTeaChance - Double enhance chance
 * @param {number} protectionLevel - Protection threshold
 * @param {number} numItems - Known number of items completed (if available)
 * @returns {Object} Detection result
 */
function detectStartLevelAdvanced(drops, successRates = SUCCESS_RATES, blessedTeaChance = 0, protectionLevel = DEFAULT_PROTECTION_LEVEL, numItems = null) {
  const levels = Object.keys(drops).map(Number).sort((a, b) => a - b);
  if (levels.length === 0) return { startLevel: 0, confidence: 0 };
  
  const maxLevel = Math.max(...levels);
  const minNonZeroLevel = levels.find(l => drops[l] > 0);
  
  // Key insight: If we know the target level and items completed,
  // we know exactly how many "successful passes" there were through each level
  
  // Without blessed tea, each item at level L+1 means exactly one success at L
  // With blessed tea, some items skip levels
  
  // For detection without knowing numItems:
  // The starting level is the lowest level where the "incoming flow" 
  // can't fully explain the drops
  
  // Calculate expected drops ratio
  // At level L (for L >= protLevel-1), drops come from:
  //   - Successes from L-1: rate[L-1] * attempts[L-1]
  //   - Failures from L+1: (1 - rate[L+1]) * attempts[L+1]
  
  // At level 0, drops come from failures at any level < protLevel
  
  // Score each potential start level
  const scores = {};
  
  for (let candidateStart = 0; candidateStart <= maxLevel; candidateStart++) {
    let score = 0;
    
    // Check if drops pattern is consistent with this start level
    
    // If start > 0, we shouldn't have many drops below start
    // (except level 0 from resets, if start < protLevel)
    for (let l = 1; l < candidateStart; l++) {
      if (drops[l] > 0) {
        score -= drops[l] * 10; // Penalty for unexpected drops
      }
    }
    
    // If start >= protLevel, we shouldn't have any drops at 0
    if (candidateStart >= protectionLevel && drops[0] > 0) {
      score -= drops[0] * 100; // Big penalty
    }
    
    // Bonus for having drops at the candidate start level
    if (drops[candidateStart] > 0) {
      score += drops[candidateStart];
    }
    
    // Check flow consistency
    // If candidateStart < protLevel, expect drops[0] from resets
    if (candidateStart < protectionLevel) {
      // Calculate expected resets
      // This requires knowing attempt counts, which we don't have directly
      // But we can estimate: more drops at higher levels = more attempts = more resets
      const hasResets = drops[0] > 0;
      if (!hasResets && candidateStart === 0) {
        // Starting at 0 but no level-0 drops is suspicious (unless very lucky)
        score -= 5;
      }
    }
    
    scores[candidateStart] = score;
  }
  
  // Find best candidate
  let bestLevel = 0;
  let bestScore = -Infinity;
  
  for (const [level, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLevel = parseInt(level);
    }
  }
  
  return {
    startLevel: bestLevel,
    confidence: bestScore,
    scores
  };
}

/**
 * Calculate protection items used from drops data
 * 
 * Protection is consumed when failing at level >= protectionLevel
 * Each such failure creates a drop at level-1
 * 
 * @param {Object} drops - { level: count }
 * @param {number} protectionLevel - Level at which protection kicks in
 * @param {Object} successRates - Success rates by level
 * @param {number} startLevel - Detected or known start level
 * @returns {Object} { estimated, range, analysis }
 */
function calculateProtectionUsed(drops, protectionLevel = DEFAULT_PROTECTION_LEVEL, successRates = SUCCESS_RATES, startLevel = 0) {
  // Protection is used when failing at L >= protLevel, creating drop at L-1
  // So drops at levels [protLevel-1, protLevel, protLevel+1, ...] can include protected failures
  
  // The tricky part: drops at these levels also include successful enhances
  
  // Key insight: 
  // drops[L] for L >= protLevel-1 includes:
  //   - Successes from L-1 (or L-2 with tea)
  //   - Protected failures from L+1
  
  // We can estimate protection use by looking at the "excess" drops at protected levels
  
  const analysis = {};
  let totalProtectionEstimate = 0;
  
  // For each level in the protection zone
  for (let level = protectionLevel - 1; level < Math.max(...Object.keys(drops).map(Number)); level++) {
    const dropsAtLevel = drops[level] || 0;
    const dropsAbove = drops[level + 1] || 0;
    
    // If we have drops at level+1, some attempts at level+1 failed
    // Failed attempts at level+1 = dropsAbove / successRate[level+1] * (1 - successRate[level+1])
    // But dropsAbove only counts successes...
    
    // Actually: attempts at level = (all items that reached level)
    // This includes both items passing through AND items that failed from above
    
    analysis[level] = {
      drops: dropsAtLevel,
      dropsAbove
    };
    
    // If level >= protLevel - 1, some drops might be from protected failures
    if (level >= protectionLevel - 1 && level + 1 >= protectionLevel) {
      // Drops at this level from failures at level+1
      // We need to estimate attempts at level+1 to calculate failures
      
      // Rough estimate: if there are drops at level+1 (successes),
      // attempts at level+1 ≈ drops[level+1] / successRate[level+1]
      // failures ≈ attempts * (1 - successRate)
      
      if (dropsAbove > 0) {
        const rate = successRates[level + 1] || 0.03;
        const estimatedAttempts = dropsAbove / rate;
        const estimatedFailures = estimatedAttempts * (1 - rate);
        
        analysis[level].estimatedProtections = Math.round(estimatedFailures);
        totalProtectionEstimate += estimatedFailures;
      }
    }
  }
  
  // Alternative method: count drops in protection zone that are "extra"
  // Extra = drops that can't be explained by successful progression alone
  
  let protectionFromExcessDrops = 0;
  for (let level = protectionLevel - 1; level <= Math.max(...Object.keys(drops).map(Number)); level++) {
    const dropsHere = drops[level] || 0;
    
    // In a perfect run (no failures), each item passes through each level exactly once
    // Extra drops at protected levels = failed attempts that consumed protection
    
    // But items can cycle multiple times at protected levels...
    // This method underestimates protection use
  }
  
  return {
    estimated: Math.round(totalProtectionEstimate),
    analysis
  };
}

/**
 * Run comprehensive tests
 */
function runTests() {
  console.log('='.repeat(70));
  console.log('ENHANCEMENT SESSION ANALYZER - TEST SUITE');
  console.log('='.repeat(70));
  console.log();
  
  const testCases = [
    { startLevel: 0, targetLevel: 8, numItems: 10, useBlessedTea: false },
    { startLevel: 3, targetLevel: 8, numItems: 10, useBlessedTea: false },
    { startLevel: 5, targetLevel: 8, numItems: 10, useBlessedTea: false },
    { startLevel: 7, targetLevel: 10, numItems: 10, useBlessedTea: false },
    { startLevel: 0, targetLevel: 8, numItems: 10, useBlessedTea: true },
    { startLevel: 3, targetLevel: 8, numItems: 10, useBlessedTea: true },
    { startLevel: 5, targetLevel: 10, numItems: 5, useBlessedTea: true },
    { startLevel: 8, targetLevel: 12, numItems: 5, useBlessedTea: false },
  ];
  
  let passCount = 0;
  let totalTests = 0;
  const results = [];
  
  for (const test of testCases) {
    totalTests++;
    
    console.log(`Test: Start +${test.startLevel}, Target +${test.targetLevel}, ` +
                `${test.numItems} items, Blessed Tea: ${test.useBlessedTea ? 'Yes' : 'No'}`);
    console.log('-'.repeat(70));
    
    // Run simulation
    const sim = simulateEnhanceSession(
      test.startLevel,
      test.targetLevel,
      test.numItems,
      SUCCESS_RATES,
      test.useBlessedTea,
      DEFAULT_PROTECTION_LEVEL
    );
    
    // Format drops for display
    const dropsStr = Object.entries(sim.drops)
      .filter(([_, v]) => v > 0)
      .map(([k, v]) => `+${k}: ${v}`)
      .join(', ');
    
    console.log(`  Simulated: ${sim.actionCount} actions`);
    console.log(`  Drops: {${dropsStr}}`);
    console.log(`  Actual protections used: ${sim.protectionsUsed}`);
    
    // Run detection (simple)
    const detected = detectStartLevel(
      sim.drops,
      SUCCESS_RATES,
      test.useBlessedTea ? BLESSED_TEA_DOUBLE_CHANCE : 0,
      DEFAULT_PROTECTION_LEVEL,
      test.targetLevel
    );
    
    // Run advanced detection
    const detectedAdv = detectStartLevelAdvanced(
      sim.drops,
      SUCCESS_RATES,
      test.useBlessedTea ? BLESSED_TEA_DOUBLE_CHANCE : 0,
      DEFAULT_PROTECTION_LEVEL,
      test.numItems
    );
    
    // Calculate protection
    const protCalc = calculateProtectionUsed(
      sim.drops,
      DEFAULT_PROTECTION_LEVEL,
      SUCCESS_RATES,
      test.startLevel
    );
    
    // Evaluate results
    const startCorrect = detected.startLevel === test.startLevel;
    const startAdvCorrect = detectedAdv.startLevel === test.startLevel;
    const protError = sim.protectionsUsed > 0 
      ? Math.abs(protCalc.estimated - sim.protectionsUsed) / sim.protectionsUsed * 100
      : (protCalc.estimated === 0 ? 0 : 100);
    
    console.log();
    console.log(`  Detection (simple):   +${detected.startLevel} ${startCorrect ? '✓' : '✗'}`);
    console.log(`  Detection (advanced): +${detectedAdv.startLevel} ${startAdvCorrect ? '✗' : '✗'}`);
    console.log(`  Protection estimate:  ${protCalc.estimated} (actual: ${sim.protectionsUsed}, ` +
                `error: ${protError.toFixed(1)}%)`);
    console.log();
    
    if (startCorrect || startAdvCorrect) passCount++;
    
    results.push({
      ...test,
      detected: detected.startLevel,
      detectedAdv: detectedAdv.startLevel,
      actualProt: sim.protectionsUsed,
      estimatedProt: protCalc.estimated,
      protError
    });
  }
  
  console.log('='.repeat(70));
  console.log(`SUMMARY: ${passCount}/${totalTests} tests detected start level correctly`);
  console.log('='.repeat(70));
  console.log();
  
  // Run multiple iterations to measure consistency
  console.log('CONSISTENCY TEST (100 iterations each)');
  console.log('-'.repeat(70));
  
  const consistencyTests = [
    { startLevel: 0, targetLevel: 8, numItems: 10, useBlessedTea: false },
    { startLevel: 5, targetLevel: 10, numItems: 10, useBlessedTea: false },
    { startLevel: 5, targetLevel: 10, numItems: 10, useBlessedTea: true },
  ];
  
  for (const test of consistencyTests) {
    let correctCount = 0;
    let protErrors = [];
    
    for (let i = 0; i < 100; i++) {
      const sim = simulateEnhanceSession(
        test.startLevel,
        test.targetLevel,
        test.numItems,
        SUCCESS_RATES,
        test.useBlessedTea,
        DEFAULT_PROTECTION_LEVEL
      );
      
      const detected = detectStartLevel(
        sim.drops,
        SUCCESS_RATES,
        test.useBlessedTea ? BLESSED_TEA_DOUBLE_CHANCE : 0,
        DEFAULT_PROTECTION_LEVEL,
        test.targetLevel
      );
      
      if (detected.startLevel === test.startLevel) correctCount++;
      
      const protCalc = calculateProtectionUsed(
        sim.drops,
        DEFAULT_PROTECTION_LEVEL,
        SUCCESS_RATES,
        test.startLevel
      );
      
      if (sim.protectionsUsed > 0) {
        protErrors.push(Math.abs(protCalc.estimated - sim.protectionsUsed) / sim.protectionsUsed);
      }
    }
    
    const avgProtError = protErrors.length > 0 
      ? (protErrors.reduce((a, b) => a + b, 0) / protErrors.length * 100).toFixed(1)
      : 'N/A';
    
    console.log(`Start +${test.startLevel} → +${test.targetLevel}, Tea: ${test.useBlessedTea ? 'Yes' : 'No'}`);
    console.log(`  Detection accuracy: ${correctCount}%`);
    console.log(`  Avg protection error: ${avgProtError}%`);
    console.log();
  }
  
  console.log('='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
}

// Export for use as module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    simulateEnhanceSession,
    detectStartLevel,
    detectStartLevelAdvanced,
    calculateProtectionUsed,
    runTests,
    SUCCESS_RATES,
    BLESSED_TEA_DOUBLE_CHANCE,
    DEFAULT_PROTECTION_LEVEL
  };
}

// Run tests if executed directly
if (require.main === module) {
  runTests();
}
