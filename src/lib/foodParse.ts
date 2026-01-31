export type ParsedFood = {
  cleanedText: string;   // text without quantity/unit noise
  normalized: string;    // normalized cleanedText
  amount: number;        // quantity of the specified unit
  unit: "serving" | "g" | "ml" | "cup" | "tsp" | "tbsp" | "oz" | "lb" | "piece" | "slice" | "medium" | "large" | "small";
  grams?: number;        // if specified in grams or convertible to grams
  servingText?: string;  // original serving description for matching
};

const UNIT_PATTERNS = [
  // weight
  { re: /(\d+(?:[.,]\d+)?)\s*(kg|kilogram|kilograms)\b/i, unit: "g" as const, multiplier: 1000 },
  { re: /(\d+(?:[.,]\d+)?)\s*(g|gram|grams)\b/i, unit: "g" as const },
  { re: /(\d+(?:[.,]\d+)?)\s*(oz|ounce|ounces)\b/i, unit: "oz" as const },
  { re: /(\d+(?:[.,]\d+)?)\s*(lb|lbs|pound|pounds)\b/i, unit: "lb" as const },

  // volume
  { re: /(\d+(?:[.,]\d+)?)\s*(ml|milliliter|milliliters)\b/i, unit: "ml" as const },
  { re: /(\d+(?:[.,]\d+)?)\s*(cup|cups)\b/i, unit: "cup" as const },
  { re: /(\d+(?:[.,]\d+)?)\s*(tsp|teaspoon|teaspoons)\b/i, unit: "tsp" as const },
  { re: /(\d+(?:[.,]\d+)?)\s*(tbsp|tablespoon|tablespoons)\b/i, unit: "tbsp" as const },

  // pieces/servings
  { re: /(\d+(?:[.,]\d+)?)\s*(piece|pieces|item|items)\b/i, unit: "piece" as const },
  { re: /(\d+(?:[.,]\d+)?)\s*(slice|slices)\b/i, unit: "slice" as const },
  { re: /(\d+(?:[.,]\d+)?)\s*(x|serving|servings|portion|portions)\b/i, unit: "serving" as const },

  // size descriptors (no quantity, but important for serving matching)
  { re: /(small|medium|large)\b/i, unit: "medium" as const, defaultAmount: 1 },
];

export function normalizeFoodText(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[()+]/g, " ")
    .replace(/[.,;:!?]/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Enhanced food parsing with serving size support:
 * - Recognizes various units (g, oz, cups, pieces, slices, etc.)
 * - Extracts serving descriptions for matching against database serving sizes
 * - Converts units to grams where standard conversions exist
 */
export function parseFoodInput(raw: string): ParsedFood {
  let text = raw.trim();

  let grams: number | undefined;
  let unit: ParsedFood["unit"] = "serving";
  let amount = 1;
  let servingText: string | undefined;

  // First, look for size descriptors that might be part of a serving name
  const sizeMatch = text.match(/(small|medium|large)\s+/i);
  if (sizeMatch) {
    unit = sizeMatch[1].toLowerCase() as ParsedFood["unit"];
    servingText = sizeMatch[1].toLowerCase();
    amount = 1;
  }

  for (const p of UNIT_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;

    // Handle size descriptors differently (they don't have quantities)
    if ('defaultAmount' in p) {
      unit = m[1].toLowerCase() as ParsedFood["unit"];
      servingText = m[1].toLowerCase();
      amount = (p as any).defaultAmount;
      text = text.replace(p.re, " ").replace(/\s+/g, " ").trim();
      break;
    }

    const n = Number(String(m[1]).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;

    unit = p.unit;
    amount = n;
    servingText = `${n} ${m[2].toLowerCase()}`;

    // Convert to grams for standard units
    if (p.unit === "g") {
      const multiplier = 'multiplier' in p ? (p as any).multiplier : 1;
      grams = n * multiplier;
    } else if (p.unit === "oz") {
      grams = n * 28.35;
    } else if (p.unit === "lb") {
      grams = n * 453.592;
    }

    // remove the matched quantity fragment from the text
    text = text.replace(p.re, " ").replace(/\s+/g, " ").trim();
    break;
  }

  const cleanedText = text;
  const normalized = normalizeFoodText(cleanedText);

  return { cleanedText, normalized, amount, unit, grams, servingText };
}
