import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/serving-sizes - Create a new serving size for a food item
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { food_item_id, name, grams, is_default } = body;

    if (!food_item_id || !name || !grams) {
      return NextResponse.json(
        { error: "Missing required fields: food_item_id, name, grams" },
        { status: 400 }
      );
    }

    // If this is set as default, unset any existing default for this food item
    if (is_default) {
      await prisma.servingSize.updateMany({
        where: { food_item_id },
        data: { is_default: false }
      });
    }

    const servingSize = await prisma.servingSize.create({
      data: {
        food_item_id,
        name,
        grams,
        is_default: !!is_default
      }
    });

    return NextResponse.json({ servingSize });
  } catch (error: any) {
    console.error("POST /api/serving-sizes failed:", error);
    return NextResponse.json(
      { error: "Failed to create serving size" },
      { status: 500 }
    );
  }
}

// GET /api/serving-sizes?food_item_id=xxx - Get serving sizes for a food item
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const food_item_id = searchParams.get("food_item_id");

    if (!food_item_id) {
      return NextResponse.json(
        { error: "Missing food_item_id parameter" },
        { status: 400 }
      );
    }

    const servingSizes = await prisma.servingSize.findMany({
      where: { food_item_id },
      orderBy: [
        { is_default: "desc" },
        { created_at: "asc" }
      ]
    });

    return NextResponse.json({ servingSizes });
  } catch (error: any) {
    console.error("GET /api/serving-sizes failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch serving sizes" },
      { status: 500 }
    );
  }
}