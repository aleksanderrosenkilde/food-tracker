// USDA FoodData Central search
// API key: set USDA_API_KEY env var, or falls back to DEMO_KEY (30 req/hr)
// Nutrient IDs: 1008=kcal, 1003=protein, 1004=fat, 1005=carbs, 1079=fiber

export type ExternalFoodResult = {
  externalId: string;
  name: string;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fiber_100g?: number;
  source: "usda";
};

const USDA_API_KEY = process.env.USDA_API_KEY ?? "DEMO_KEY";

function getNutrient(nutrients: any[], id: number): number {
  return nutrients.find((n: any) => n.nutrientId === id)?.value ?? 0;
}

export async function searchUSDA(
  query: string,
  limit = 5
): Promise<ExternalFoodResult[]> {
  if (query.length < 2) return [];

  try {
    // Foundation + SR Legacy always store nutrients per 100g
    const url =
      `https://api.nal.usda.gov/fdc/v1/foods/search` +
      `?query=${encodeURIComponent(query)}` +
      `&api_key=${USDA_API_KEY}` +
      `&dataType=Foundation,SR%20Legacy` +
      `&pageSize=${limit}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 3600 },
    } as RequestInit);

    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();
    const foods: any[] = data.foods ?? [];

    const results: ExternalFoodResult[] = [];
    for (const food of foods) {
      const nutrients: any[] = food.foodNutrients ?? [];
      const kcal = getNutrient(nutrients, 1008);
      const protein = getNutrient(nutrients, 1003);
      const fat = getNutrient(nutrients, 1004);
      const carbs = getNutrient(nutrients, 1005);
      const fiber = getNutrient(nutrients, 1079);

      if (kcal === 0 && protein === 0) continue;

      results.push({
        externalId: `usda_${food.fdcId}`,
        name: food.description as string,
        kcal_100g: kcal,
        protein_100g: protein,
        carbs_100g: carbs,
        fat_100g: fat,
        fiber_100g: fiber > 0 ? fiber : undefined,
        source: "usda",
      });
    }
    return results;
  } catch {
    return [];
  }
}
