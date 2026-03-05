/**
 * Convert volume measurements to grams using food-specific densities.
 *
 * FoodItem always stores nutrition per 100g, so any volume-based input
 * (ml, cups, glasses, bowls, …) must be converted to grams before we can
 * calculate the log totals.
 */

import { ParsedFood } from "./foodParse";

// ── Density table ─────────────────────────────────────────────────────────────
// g/ml for common foods.  Ordered most-specific first so milk matches before
// the generic "default liquid" fallback.

const DENSITIES: Array<{ pattern: RegExp; gPerMl: number }> = [
  // ── dairy ──────────────────────────────────────────────────────────────────
  { pattern: /\b(whole\s+)?milk\b/i,                              gPerMl: 1.03  },
  { pattern: /\b(heavy\s+)?cream\b/i,                             gPerMl: 1.01  },
  { pattern: /\b(sour\s+cream|creme\s+fraiche)\b/i,              gPerMl: 1.0   },
  { pattern: /\byogurt\b/i,                                       gPerMl: 1.05  },
  { pattern: /\bkefir\b/i,                                        gPerMl: 1.03  },
  { pattern: /\bbuttermilk\b/i,                                   gPerMl: 1.03  },

  // ── juices / soft drinks ───────────────────────────────────────────────────
  { pattern: /\b(orange|apple|grape|grapefruit|pineapple)\s+juice\b/i, gPerMl: 1.05 },
  { pattern: /\bjuice\b/i,                                        gPerMl: 1.05  },
  { pattern: /\b(coca.cola|coke|pepsi|soda|lemonade|sprite)\b/i, gPerMl: 1.04  },
  { pattern: /\b(energy\s+drink|red\s+bull)\b/i,                 gPerMl: 1.03  },
  { pattern: /\bsmoothie\b/i,                                     gPerMl: 1.05  },

  // ── water / tea / coffee ──────────────────────────────────────────────────
  { pattern: /\b(water|sparkling\s+water|mineral\s+water)\b/i,   gPerMl: 1.0   },
  { pattern: /\b(tea|herbal\s+tea|green\s+tea|black\s+tea)\b/i,  gPerMl: 1.0   },
  { pattern: /\b(coffee|espresso|americano|latte|cappuccino)\b/i, gPerMl: 1.0   },

  // ── alcohol ───────────────────────────────────────────────────────────────
  { pattern: /\b(spirits?|vodka|whisky|whiskey|rum|gin|tequila)\b/i, gPerMl: 0.94 },
  { pattern: /\b(wine|ros[ée]|champagne|prosecco)\b/i,           gPerMl: 0.99  },
  { pattern: /\b(beer|lager|ale|stout)\b/i,                      gPerMl: 1.01  },
  { pattern: /\b(cider)\b/i,                                      gPerMl: 1.01  },

  // ── oils / fats ───────────────────────────────────────────────────────────
  { pattern: /\b(olive\s+oil|vegetable\s+oil|sunflower\s+oil|canola\s+oil|coconut\s+oil)\b/i, gPerMl: 0.92 },
  { pattern: /\boil\b/i,                                          gPerMl: 0.92  },
  { pattern: /\bmelted\s+butter\b/i,                              gPerMl: 0.91  },

  // ── syrups / sweet ────────────────────────────────────────────────────────
  { pattern: /\bhoney\b/i,                                        gPerMl: 1.42  },
  { pattern: /\b(maple\s+syrup|syrup)\b/i,                       gPerMl: 1.32  },
  { pattern: /\bglucose\b/i,                                      gPerMl: 1.35  },

  // ── soups / sauces / broths ───────────────────────────────────────────────
  { pattern: /\b(soup|broth|stock|consommé)\b/i,                 gPerMl: 1.02  },
  { pattern: /\b(sauce|gravy|dressing|vinaigrette)\b/i,          gPerMl: 1.05  },
  { pattern: /\btomato\s+(sauce|paste|puree)\b/i,                gPerMl: 1.06  },
];

/** Density for a food in g/ml.  Returns null for solids (no good estimate). */
export function getFoodDensity(foodName: string): number | null {
  for (const { pattern, gPerMl } of DENSITIES) {
    if (pattern.test(foodName)) return gPerMl;
  }
  return null; // solid / unknown — caller must use AI estimated_grams
}

/** Convert ml + food name → grams.  Returns null if density is unknown. */
export function mlToGrams(ml: number, foodName: string): number | null {
  const density = getFoodDensity(foodName);
  if (density === null) return null;
  return Math.round(ml * density * 10) / 10;
}

/**
 * Resolve the total grams consumed from a ParsedFood + the food name.
 *
 * Returns:
 *  - A number (grams) when the conversion is deterministic.
 *  - null when we can't determine grams without AI help (count-based pieces,
 *    or volume of a solid food where density is unknown).
 */
export function resolveGrams(
  parsed: ParsedFood,
  foodName: string
): number | null {
  // Direct weight — always known exactly
  if (parsed.grams != null) return parsed.grams;

  // Volume — convert via density if the food is a liquid
  if (parsed.mlVolume != null) {
    return mlToGrams(parsed.mlVolume, foodName);
  }

  // Everything else (piece, slice, serving, medium, glass without mlVolume, …)
  // → unknown without a per-piece weight from the DB or AI
  return null;
}
