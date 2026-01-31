import { ParsedFood } from "./foodParse";

export type ServingSize = {
  id: string;
  name: string;
  grams: number;
  is_default: boolean;
};

export type FoodItemWithServingSizes = {
  id: string;
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  servingSizes: ServingSize[];
};

/**
 * Find the best matching serving size for a parsed food input
 */
export function findMatchingServingSize(
  parsed: ParsedFood,
  servingSizes: ServingSize[]
): { servingSize: ServingSize; multiplier: number } | null {

  if (!servingSizes.length) {
    return null;
  }

  // If user specified grams directly, find closest serving size
  if (parsed.grams && parsed.unit === "g") {
    const closest = servingSizes.reduce((best, current) => {
      const currentDiff = Math.abs(Number(current.grams) - parsed.grams!);
      const bestDiff = Math.abs(Number(best.grams) - parsed.grams!);
      return currentDiff < bestDiff ? current : best;
    });

    return {
      servingSize: closest,
      multiplier: parsed.grams / Number(closest.grams)
    };
  }

  // Try to match serving description
  if (parsed.servingText) {
    const normalized = parsed.servingText.toLowerCase();

    // Look for exact or partial matches
    for (const serving of servingSizes) {
      const servingName = serving.name.toLowerCase();

      if (
        servingName.includes(normalized) ||
        normalized.includes(servingName) ||
        // Match common patterns like "1 cup" with "cup"
        (normalized.includes("cup") && servingName.includes("cup")) ||
        (normalized.includes("slice") && servingName.includes("slice")) ||
        (normalized.includes("piece") && servingName.includes("piece"))
      ) {
        return {
          servingSize: serving,
          multiplier: parsed.amount
        };
      }
    }
  }

  // Fall back to default serving size
  const defaultServing = servingSizes.find(s => s.is_default) || servingSizes[0];

  return {
    servingSize: defaultServing,
    multiplier: parsed.amount
  };
}

/**
 * Calculate nutrition values based on serving size and amount
 */
export function calculateNutrition(
  foodItem: FoodItemWithServingSizes,
  servingSize: ServingSize,
  multiplier: number
) {
  // Food item nutrition is stored per 100g
  const gramsConsumed = Number(servingSize.grams) * multiplier;
  const factor = gramsConsumed / 100; // Convert from per-100g to actual amount

  return {
    kcal: Number(foodItem.kcal) * factor,
    protein_g: Number(foodItem.protein_g) * factor,
    carbs_g: Number(foodItem.carbs_g) * factor,
    fat_g: Number(foodItem.fat_g) * factor,
    fiber_g: foodItem.fiber_g ? Number(foodItem.fiber_g) * factor : undefined,
    serving_grams: gramsConsumed,
  };
}

/**
 * Common serving sizes that can be suggested when creating new food items
 */
export const COMMON_SERVING_SIZES = {
  // Fruits
  fruits: [
    { name: "small", grams: 100 },
    { name: "medium", grams: 150 },
    { name: "large", grams: 200 },
    { name: "1 cup chopped", grams: 140 },
  ],

  // Vegetables
  vegetables: [
    { name: "1 cup raw", grams: 100 },
    { name: "1 cup cooked", grams: 150 },
    { name: "medium", grams: 120 },
  ],

  // Grains/Rice/Pasta
  grains: [
    { name: "1 cup cooked", grams: 200 },
    { name: "1/2 cup dry", grams: 100 },
    { name: "1 slice", grams: 30 },
  ],

  // Proteins
  proteins: [
    { name: "100g", grams: 100 },
    { name: "1 piece", grams: 150 },
    { name: "1 cup", grams: 200 },
  ],

  // Dairy
  dairy: [
    { name: "1 cup", grams: 240 },
    { name: "1 slice", grams: 20 },
    { name: "1 tbsp", grams: 15 },
  ],

  // Generic
  generic: [
    { name: "100g", grams: 100 },
    { name: "1 serving", grams: 100 },
  ]
};