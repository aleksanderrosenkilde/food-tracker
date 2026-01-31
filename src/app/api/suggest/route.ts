import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeFoodText } from "@/lib/foodMatch";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ items: [] });

  const nq = normalizeFoodText(q);

  let items;
  try {
    // Try with servingSizes first
    items = await prisma.foodItem.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { normalized: { contains: nq } },
        ],
      },
      include: {
        servingSizes: {
          orderBy: [
            { is_default: "desc" },
            { created_at: "asc" }
          ]
        }
      },
      orderBy: { updated_at: "desc" },
      take: 8,
    });
  } catch (error) {
    // Fallback without servingSizes for older schema
    items = await prisma.foodItem.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { normalized: { contains: nq } },
        ],
      },
      orderBy: { updated_at: "desc" },
      take: 8,
    });
    // Add empty servingSizes array to each item
    items = items.map(item => ({ ...item, servingSizes: [] }));
  }

  return NextResponse.json({ items });
}
