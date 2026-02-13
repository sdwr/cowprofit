"""
Protection Calculator - Reverse-engineer protection usage from enhancement data

Protection mechanic:
- At level L >= prot: failure drops to L-1 (uses protection)
- At level L < prot: failure drops to 0 (no protection)

Example with prot=8:
- Fail at +9 -> +8 (protected)
- Fail at +8 -> +7 (protected)  
- Fail at +7 -> 0 (NOT protected, resets to 0)

Algorithm (without blessed tea):

For each level L >= prot:
  - successes[L] = drops[L+1] - failures[L+2]  (arrivals at L+1 from below)
  - failures[L] = drops[L] - successes[L]       (every visit ends in S or F)
  - On failure: go to L-1

For level L = prot-1 (one below protection):
  - Can arrive here from: failures[prot] OR successes[prot-2]
  - failures[prot-1] -> 0 (resets to zero)

For level 0 < L < prot-1:
  - Can only arrive from successes[L-1] (climbing back up after reset)
  - failures[L] -> 0

For level 0:
  - Sink for all unprotected failures
  - failures[0] -> 0 (can't go lower)

Protection count = sum of failures[L] for L >= prot
"""

def calculate_protection_v2(drops, prot_level, blessed_chance=0.0, iterations=5):
    """
    Calculate protection usage from drops data.
    
    With blessed tea: iterate to handle circular dependency between
    blessed[L-1] and successes[L].
    """
    if not drops:
        return None
    
    target = max(drops.keys())
    b = blessed_chance
    
    # Initialize
    successes = {}
    failures = {}
    blessed = {}
    
    # Multiple iterations to handle blessed dependency
    for iteration in range(iterations if b > 0 else 1):
        old_blessed = dict(blessed)
        
        # Work from target down through protected zone
        for L in range(target - 1, prot_level - 1, -1):
            failures_from_above = failures.get(L + 2, 0)
            blessed_from_below = old_blessed.get(L - 1, 0)
            
            regular_successes = drops.get(L + 1, 0) - blessed_from_below - failures_from_above
            
            if b > 0 and b < 1:
                successes[L] = max(0, regular_successes / (1 - b))
                blessed[L] = successes[L] * b
            else:
                successes[L] = max(0, regular_successes)
                blessed[L] = 0
            
            failures[L] = drops.get(L, 0) - successes[L]
        
        # Work through unprotected zone
        for L in range(prot_level - 1, -1, -1):
            if L == prot_level - 1:
                # prot-1: arrivals = failures[prot] + regular[prot-2] + blessed[prot-3]
                failures_from_above = failures.get(prot_level + 1, 0)
                blessed_from_below = old_blessed.get(L - 1, 0) if L > 0 else 0
                regular_successes = drops.get(prot_level, 0) - blessed_from_below - failures_from_above
            elif L == prot_level - 2:
                # prot-2: arrivals = failures[prot] (to prot-1) contributes via chain
                blessed_from_below = old_blessed.get(L - 1, 0) if L > 0 else 0
                regular_successes = drops.get(L + 1, 0) - failures.get(prot_level, 0) - blessed_from_below
            else:
                blessed_from_below = old_blessed.get(L - 1, 0) if L > 0 else 0
                regular_successes = drops.get(L + 1, 0) - blessed_from_below
            
            if b > 0 and b < 1:
                successes[L] = max(0, regular_successes / (1 - b))
                blessed[L] = successes[L] * b
            else:
                successes[L] = max(0, regular_successes)
                blessed[L] = 0
            
            failures[L] = drops.get(L, 0) - successes[L]
    
    # Protection count
    protect_count = sum(max(0, failures.get(L, 0)) for L in range(prot_level, target))
    protect_count = int(round(protect_count))
    
    return {
        'successes': {k: round(v, 1) for k, v in successes.items()},
        'failures': {k: round(v, 1) for k, v in failures.items()},
        'blessed': {k: round(v, 1) for k, v in blessed.items()},
        'protect_count': protect_count,
        'prot_level': prot_level,
        'target': target,
    }


def simulate_enhancement_v2(start_level, target_level, prot_level, success_rate=0.35):
    """
    Simulate enhancement with correct protection mechanic.
    
    - At L >= prot: fail -> L-1 (uses protection)
    - At L < prot: fail -> 0 (no protection)
    """
    import random
    
    drops = {}
    level = start_level
    protections_used = 0
    
    while level < target_level:
        drops[level] = drops.get(level, 0) + 1
        
        if random.random() < success_rate:
            level += 1
        else:
            # Failure
            if level >= prot_level:
                level -= 1
                protections_used += 1
            else:
                level = 0  # Reset to 0, no protection
    
    drops[target_level] = 1
    
    return drops, protections_used


def analyze_drops_v2(drops, actual_prots=None, verbose=True):
    """Analyze drops to find protection level and count.
    
    If actual_prots is provided (from simulation), highlights the matching prot level.
    """
    if not drops:
        return None
    
    target = max(drops.keys())
    min_level = min(drops.keys())
    
    if verbose:
        print(f"Drops: {dict(sorted(drops.items()))}")
        print(f"Target: +{target}, Min level: +{min_level}")
        print()
    
    results = []
    best_match = None
    best_diff = float('inf')
    
    # Try protection levels from min_level+1 to target
    for prot in range(min_level + 1, target + 1):
        result = calculate_protection_v2(drops, prot)
        if result:
            results.append(result)
            
            # Track best match to actual
            if actual_prots is not None:
                diff = abs(result['protect_count'] - actual_prots)
                if diff < best_diff:
                    best_diff = diff
                    best_match = result
            
            if verbose:
                marker = ""
                if actual_prots is not None and result['protect_count'] == actual_prots:
                    marker = " <<< MATCH"
                print(f"=== Protection at +{prot}: {result['protect_count']} protections{marker} ===")
    
    if verbose:
        print()
        if best_match:
            print(f"BEST FIT: Protection at +{best_match['prot_level']}")
            print(f"  Protections: {best_match['protect_count']}" + 
                  (f" (actual: {actual_prots})" if actual_prots else ""))
    
    return results, best_match


def simulate_with_blessed(start_level, target_level, prot_level, success_rate=0.35, blessed_chance=0.01):
    """
    Simulate enhancement WITH blessed tea.
    
    Blessed tea: on success, 1% chance to gain +2 instead of +1.
    """
    import random
    
    drops = {}
    level = start_level
    protections_used = 0
    blessed_procs = 0
    
    while level < target_level:
        drops[level] = drops.get(level, 0) + 1
        
        if random.random() < success_rate:
            # Success - check for blessed proc
            if random.random() < blessed_chance and level + 2 <= target_level:
                level += 2
                blessed_procs += 1
            else:
                level += 1
        else:
            # Failure
            if level >= prot_level:
                level -= 1
                protections_used += 1
            else:
                level = 0
    
    drops[target_level] = 1
    
    return drops, protections_used, blessed_procs


def main():
    import random
    random.seed(42)
    
    print("=" * 60)
    print("PROTECTION CALCULATOR v2")
    print("At L >= prot: fail -> L-1 (protected)")
    print("At L < prot: fail -> 0 (unprotected)")
    print("=" * 60)
    
    # Test with known prot level - just verify protection count
    def test_case(name, start, target, prot, use_blessed=False, blessed_chance=0.01):
        print(f"\n{'='*60}")
        print(f"{name}: Start +{start}, Target +{target}, Prot +{prot}")
        print("=" * 60)
        
        if use_blessed:
            drops, prots, blessed = simulate_with_blessed(start, target, prot, blessed_chance=blessed_chance)
            print(f"Simulation: {prots} protections, {blessed} blessed procs")
            # Calculate WITH blessed_chance
            result = calculate_protection_v2(drops, prot, blessed_chance=blessed_chance)
        else:
            drops, prots = simulate_enhancement_v2(start, target, prot)
            print(f"Simulation: {prots} protections")
            result = calculate_protection_v2(drops, prot, blessed_chance=0)
        
        calc_prots = result['protect_count']
        
        match = "MATCH" if calc_prots == prots else f"OFF BY {abs(calc_prots - prots)}"
        print(f"Calculated: {calc_prots} protections -> {match}")
        print(f"Drops: {dict(sorted(drops.items()))}")
        
        return drops, prots, result
    
    # Test variable start levels (no blessed tea)
    print("\n" + "=" * 60)
    print("VARIABLE START LEVELS (no blessed tea)")
    print("=" * 60)
    
    test_case("Start at prot", 10, 14, 10)
    test_case("Start above prot", 10, 14, 8)
    test_case("Start way above prot", 12, 14, 8)
    test_case("Low prot, high start", 10, 14, 5)
    
    # Test with blessed tea
    print("\n" + "=" * 60)
    print("WITH BLESSED TEA (1% double success)")
    print("=" * 60)
    
    test_case("Blessed: Start at prot", 10, 14, 10, use_blessed=True)
    test_case("Blessed: Start above prot", 10, 14, 8, use_blessed=True)


if __name__ == '__main__':
    main()
