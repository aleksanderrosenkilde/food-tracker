export type ParsedFood = {
  cleanedText: string;   // food name, stripped of quantity/unit noise
  normalized: string;    // normalized cleanedText (used for DB lookup)
  amount: number;        // quantity of the specified unit
  unit: "serving" | "g" | "ml" | "cup" | "tsp" | "tbsp" | "oz" | "lb"
      | "piece" | "slice" | "medium" | "large" | "small"
      | "glass" | "bowl" | "mug" | "handful";
  grams?: number;        // exact grams, when weight is known (g / oz / lb)
  mlVolume?: number;     // ml equivalent for volume units (ml/cup/glass/bowl/…)
  servingText?: string;  // original serving phrase for DB serving-size matching
};

// ── Unit patterns ────────────────────────────────────────────────────────────

const UNIT_PATTERNS: Array<{
  re: RegExp;
  unit: ParsedFood["unit"];
  /** multiply raw number to get grams (weight units only) */
  gramFactor?: number;
  /** multiply raw number to get ml (volume units only) */
  mlFactor?: number;
  /** size-descriptor: no leading number, defaultAmount=1 */
  defaultAmount?: number;
}> = [
  // ── weight ──────────────────────────────────────────────────────────────
  { re: /(\d+(?:[.,]\d+)?)\s*(kg|kilogram|kilograms)\b/i,        unit: "g",       gramFactor: 1000 },
  { re: /(\d+(?:[.,]\d+)?)\s*(g|gram|grams)\b/i,                 unit: "g",       gramFactor: 1    },
  { re: /(\d+(?:[.,]\d+)?)\s*(oz|ounce|ounces)\b/i,              unit: "oz",      gramFactor: 28.35 },
  { re: /(\d+(?:[.,]\d+)?)\s*(lb|lbs|pound|pounds)\b/i,          unit: "lb",      gramFactor: 453.592 },

  // ── volume ───────────────────────────────────────────────────────────────
  { re: /(\d+(?:[.,]\d+)?)\s*(ml|milliliter|milliliters|millilitre|millilitres)\b/i, unit: "ml",   mlFactor: 1   },
  { re: /(\d+(?:[.,]\d+)?)\s*(dl|deciliter|deciliters|decilitre|decilitres)\b/i,     unit: "ml",   mlFactor: 100 },
  { re: /(\d+(?:[.,]\d+)?)\s*(l|liter|liters|litre|litres)\b/i,                      unit: "ml",   mlFactor: 1000 },
  { re: /(\d+(?:[.,]\d+)?)\s*(cup|cups)\b/i,                     unit: "cup",     mlFactor: 240  },
  { re: /(\d+(?:[.,]\d+)?)\s*(tsp|teaspoon|teaspoons)\b/i,       unit: "tsp",     mlFactor: 5    },
  { re: /(\d+(?:[.,]\d+)?)\s*(tbsp|tablespoon|tablespoons)\b/i,  unit: "tbsp",    mlFactor: 15   },

  // ── vessels (common containers) ──────────────────────────────────────────
  { re: /(\d+(?:[.,]\d+)?)\s*(glass|glasses)\b/i,                unit: "glass",   mlFactor: 250  },
  { re: /(\d+(?:[.,]\d+)?)\s*(mug|mugs)\b/i,                     unit: "mug",     mlFactor: 240  },
  { re: /(\d+(?:[.,]\d+)?)\s*(bowl|bowls)\b/i,                   unit: "bowl",    mlFactor: 300  },

  // ── informal measures ────────────────────────────────────────────────────
  { re: /(\d+(?:[.,]\d+)?)\s*(handful|handfuls)\b/i,             unit: "handful", gramFactor: 30  },

  // ── count / piece ────────────────────────────────────────────────────────
  { re: /(\d+(?:[.,]\d+)?)\s*(piece|pieces|item|items)\b/i,      unit: "piece"  },
  { re: /(\d+(?:[.,]\d+)?)\s*(slice|slices)\b/i,                 unit: "slice"  },
  { re: /(\d+(?:[.,]\d+)?)\s*(x|serving|servings|portion|portions)\b/i, unit: "serving" },

  // ── size descriptors ─────────────────────────────────────────────────────
  { re: /(small)\b/i,   unit: "small",  defaultAmount: 1 },
  { re: /(medium)\b/i,  unit: "medium", defaultAmount: 1 },
  { re: /(large)\b/i,   unit: "large",  defaultAmount: 1 },
];

// ── Normalizer ───────────────────────────────────────────────────────────────

export function normalizeFoodText(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[()+]/g, " ")
    .replace(/[.,;:!?]/g, " ")
    .replace(/\s+/g, " ");
}

// ── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a free-text food entry into structured fields.
 *
 * Handles:
 *  - Weight: "200g chicken", "2 oz salmon", "0.5 lb steak"
 *  - Volume: "200ml milk", "2 cups rice", "1 glass of juice", "3 bowls of soup"
 *  - Count:  "5 chicken breast", "2 eggs", "3 slices of pizza"
 *  - Size:   "medium apple", "large coffee"
 *  - Strips preposition "of": "1 cup of milk" → cleanedText = "milk"
 */
export function parseFoodInput(raw: string): ParsedFood {
  let text = raw.trim();

  let grams: number | undefined;
  let mlVolume: number | undefined;
  let unit: ParsedFood["unit"] = "serving";
  let amount = 1;
  let servingText: string | undefined;
  let matched = false;

  for (const p of UNIT_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;

    // Size descriptors (small/medium/large): no leading number
    if (p.defaultAmount !== undefined) {
      unit = p.unit;
      servingText = m[1].toLowerCase();
      amount = p.defaultAmount;
      text = text.replace(p.re, " ").replace(/\s+/g, " ").trim();
      matched = true;
      break;
    }

    const n = Number(String(m[1]).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;

    unit = p.unit;
    amount = n;
    servingText = `${n} ${m[2].toLowerCase()}`;

    if (p.gramFactor !== undefined) {
      grams = n * p.gramFactor;
    }
    if (p.mlFactor !== undefined) {
      // Normalise all volume units to ml; store the total ml
      mlVolume = n * p.mlFactor;
      // ml unit is already in ml — keep unit as "ml" for display
      if (unit !== "ml") {
        // For cup/glass/bowl/etc. keep their original unit label
      }
    }

    text = text.replace(p.re, " ").replace(/\s+/g, " ").trim();
    matched = true;
    break;
  }

  // Strip leading "of" preposition left behind after unit removal
  // e.g. "1 cup of milk" → after removing "1 cup" → "of milk" → "milk"
  text = text.replace(/^of\s+/i, "").trim();

  // ── Count-only detection ─────────────────────────────────────────────────
  // "5 chicken breast", "2 eggs" — a bare number with no recognised unit.
  // Treat the number as a piece count.
  if (!matched) {
    const countMatch = text.match(/^(\d+(?:[.,]\d+)?)\s+(.+)/);
    if (countMatch) {
      const n = Number(countMatch[1].replace(",", "."));
      // Sanity-check: reasonable count (not e.g. a year "2024 calories")
      if (Number.isFinite(n) && n > 0 && n <= 99) {
        amount = n;
        unit = "piece";
        servingText = `${n} piece`;
        text = countMatch[2].trim();
      }
    }
  }

  const cleanedText = text;
  const normalized = normalizeFoodText(cleanedText);

  return { cleanedText, normalized, amount, unit, grams, mlVolume, servingText };
}
