import { prisma } from "@/lib/prisma";

export async function findBestFoodItem(normalized: string) {
  try {
    // 1) exact - try with servingSizes first, fallback without
    let exact;
    try {
      exact = await prisma.foodItem.findUnique({
        where: { normalized },
        include: { servingSizes: true }
      });
    } catch (error) {
      // Fallback for older schema without servingSizes
      exact = await prisma.foodItem.findUnique({
        where: { normalized }
      });
      if (exact) {
        (exact as any).servingSizes = [];
      }
    }
    if (exact) return { item: exact, matchedBy: "exact" as const, score: 1 };

    // 2) fuzzy (pg_trgm). Uses raw SQL because Prisma doesn't expose similarity nicely.
    // Lower threshold => more matches, but risk of wrong matches.
    const threshold = 0.62;

    const rows = await prisma.$queryRaw<
      Array<{ id: string; score: number }>
    >`
      SELECT id, similarity("normalized", ${normalized}) AS score
      FROM "FoodItem"
      WHERE similarity("normalized", ${normalized}) > ${threshold}
      ORDER BY score DESC
      LIMIT 1;
    `;

    if (rows.length === 0) return { item: null, matchedBy: "none" as const, score: 0 };

    // Try with servingSizes first, fallback without
    let best;
    try {
      best = await prisma.foodItem.findUnique({
        where: { id: rows[0].id },
        include: { servingSizes: true }
      });
    } catch (error) {
      // Fallback for older schema without servingSizes
      best = await prisma.foodItem.findUnique({
        where: { id: rows[0].id }
      });
      if (best) {
        (best as any).servingSizes = [];
      }
    }
    return { item: best, matchedBy: "fuzzy" as const, score: rows[0].score };
  } catch (error) {
    console.error("Error in findBestFoodItem:", error);
    return { item: null, matchedBy: "none" as const, score: 0 };
  }
}
