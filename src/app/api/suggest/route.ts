import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeFoodText } from "@/lib/foodMatch";
import { searchUSDA } from "@/lib/externalFoodSearch";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ items: [] });

  const nq = normalizeFoodText(q);

  // 1) Local DB results
  let localItems;
  try {
    localItems = await prisma.foodItem.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { normalized: { contains: nq } },
        ],
      },
      include: {
        servingSizes: {
          orderBy: [{ is_default: "desc" }, { created_at: "asc" }],
        },
      },
      orderBy: { updated_at: "desc" },
      take: 8,
    });
  } catch {
    localItems = await prisma.foodItem.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { normalized: { contains: nq } },
        ],
      },
      orderBy: { updated_at: "desc" },
      take: 8,
    });
    localItems = localItems.map((item) => ({ ...item, servingSizes: [] }));
  }

  type FormattedItem = {
    id: string;
    name: string;
    kcal: number | string;
    protein_g: number | string;
    carbs_g: number | string;
    fat_g: number | string;
    source: "local" | "usda";
    servingSizes: any[];
    externalData?: {
      externalId: string;
      kcal_100g: number;
      protein_100g: number;
      carbs_100g: number;
      fat_100g: number;
      fiber_100g?: number;
      source: string;
    };
  };

  const localFormatted: FormattedItem[] = localItems.map((item) => ({
    id: item.id,
    name: item.name,
    kcal: Number(item.kcal),
    protein_g: Number(item.protein_g),
    carbs_g: Number(item.carbs_g),
    fat_g: Number(item.fat_g),
    source: "local" as const,
    servingSizes: (item as any).servingSizes ?? [],
  }));

  // 2) Augment with USDA when local results are sparse
  const USDA_THRESHOLD = 3;
  let externalItems: FormattedItem[] = [];

  if (localFormatted.length < USDA_THRESHOLD) {
    const usdaResults = await searchUSDA(q, 5);

    // Filter out USDA results whose name is already covered locally
    const localNames = new Set(localFormatted.map((i) => i.name.toLowerCase()));
    const filtered = usdaResults.filter(
      (u) => !localNames.has(u.name.toLowerCase())
    );

    externalItems = filtered.map((u) => ({
      id: u.externalId,
      name: u.name,
      kcal: u.kcal_100g,
      protein_g: u.protein_100g,
      carbs_g: u.carbs_100g,
      fat_g: u.fat_100g,
      source: "usda" as const,
      servingSizes: [],
      externalData: {
        externalId: u.externalId,
        kcal_100g: u.kcal_100g,
        protein_100g: u.protein_100g,
        carbs_100g: u.carbs_100g,
        fat_100g: u.fat_100g,
        fiber_100g: u.fiber_100g,
        source: u.source,
      },
    }));
  }

  const items = [...localFormatted, ...externalItems].slice(0, 8);

  return NextResponse.json({ items });
}
