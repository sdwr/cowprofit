# Enhancing Gear Stats Reference

All data sourced from `init_client_info.json`. Stats verified against in-game values.

## Stat Formula
```
stat_at_level_N = baseStat + bonusMultiplier[N] * enhancementBonus
```

### Enhancement Level Bonus Multiplier Table (level 0-20)
```
[0, 1, 2.1, 3.3, 4.6, 6, 7.5, 9.1, 10.8, 12.6, 14.5, 16.7, 19.2, 22, 25.1, 28.5, 32.2, 36.2, 40.5, 45.1, 50]
```

### Success Rate Table (target level 1-20)
```
[50%, 45%, 45%, 40%, 40%, 40%, 35%, 35%, 35%, 35%, 30%, 30%, 30%, 30%, 30%, 30%, 30%, 30%, 30%, 30%]
```

## Enhancer Tools

| Enhancer | hrid | enhancingSuccess (base/enhBonus) | enhancingRareFind | enhancingExperience |
|----------|------|--------------------------------|-------------------|---------------------|
| Cheese | /items/cheese_enhancer | 0.6% / 0.012% | — | — |
| Verdant | /items/verdant_enhancer | 0.9% / 0.018% | — | — |
| Azure | /items/azure_enhancer | 1.2% / 0.024% | — | — |
| Burble | /items/burble_enhancer | 1.8% / 0.036% | — | — |
| Crimson | /items/crimson_enhancer | 2.4% / 0.048% | — | — |
| Rainbow | /items/rainbow_enhancer | 3.0% / 0.060% | — | — |
| Holy | /items/holy_enhancer | 3.6% / 0.072% | — | — |
| Celestial | /items/celestial_enhancer | 4.2% / 0.084% | 15% / 0.3% | 4% / 0.08% |

Only Celestial has rareFind + experience stats.

## Equipment

| Item | hrid | Stats (base / enhBonus per level) |
|------|------|----------------------------------|
| Enchanted Gloves | /items/enchanted_gloves | enhancingSpeed 10% / 0.2%, alchemyEfficiency 10% / 0.2% |
| Enhancer's Top | /items/enhancers_top | enhancingSpeed 10% / 0.2%, enhancingRareFind 15% / 0.3% |
| Enhancer's Bottoms | /items/enhancers_bottoms | enhancingSpeed 10% / 0.2%, enhancingExperience 4% / 0.08% |
| Philosopher's Necklace | /items/philosophers_necklace | skillingSpeed 4% / 0.4%, skillingEfficiency 2% / 0.2%, skillingExperience 3% / 0.3% |
| Guzzling Pouch | /items/guzzling_pouch | drinkConcentration 10% / 0.2% |

Note: Philosopher's Necklace has 2x enhBonus compared to other gear (jewelry scaling).
Note: skillingSpeed counts as enhancingSpeed for enhancing actions.

## Charms (XP only — no profit impact)

| Charm | hrid | enhancingExperience (base / enhBonus) |
|-------|------|--------------------------------------|
| Trainee | /items/trainee_enhancing_charm | 1% / 0.1% |
| Basic | /items/basic_enhancing_charm | 2% / 0.2% |
| Advanced | /items/advanced_enhancing_charm | 3.5% / 0.35% |
| Expert | /items/expert_enhancing_charm | 5% / 0.5% |
| Master | /items/master_enhancing_charm | 6.5% / 0.65% |
| Grandmaster | /items/grandmaster_enhancing_charm | 8% / 0.8% |

## Teas

| Tea | hrid | Effects |
|-----|------|---------|
| Enhancing Tea | /items/enhancing_tea | enhancingLevel +3, actionSpeed +2% |
| Super Enhancing Tea | /items/super_enhancing_tea | enhancingLevel +6, actionSpeed +4% |
| Ultra Enhancing Tea | /items/ultra_enhancing_tea | enhancingLevel +8, actionSpeed +6% |
| Blessed Tea | /items/blessed_tea | blessed +1% (chance for +2 levels on success) |
| Wisdom Tea | /items/wisdom_tea | wisdom +12% (XP multiplier) |
| Artisan Tea | /items/artisan_tea | artisan +10% (craft mat reduction), actionLevel +5 |

## Guzzling Interactions
All tea effects are multiplied by `1 + drinkConcentration%`:
- Enhancing tea level: `+N * guzzling` (fractional levels affect success formula)
- Blessed tea: `1% * guzzling` (e.g. 1.12% with +8 pouch)
- Artisan tea: `10% * guzzling` (e.g. 11.22% reduction with +8 pouch)

## Achievement Bonus
- Label: "0.2%" (not "20%")
- Value in code: 0.002 (additive to enhancer success bonus)
