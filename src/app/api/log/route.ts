// src/app/api/log/route.ts
//
// POST /api/log
// - If food is already known (exact/fuzzy match): create a READY log immediately.
// - If unknown: create a PENDING log immediately and enqueue a background job (pg-boss)
//   to estimate macros and update the log later.

import { NextResponse, after } from "next/server";

import { prisma } from "@/lib/prisma";
import { parseFoodInput } from "@/lib/foodParse";
import { findBestFoodItem } from "@/lib/foodFind";
import { processEstimation } from "@/lib/estimationQueue";
import { findMatchingServingSize, calculateNutrition } from "@/lib/servingSizes";

function inferMeal(date: Date) {
  const h = date.getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const rawText = String(body.text || "").trim();
    if (!rawText) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    // Parse units like "200g" etc. (amount defaults to 1)
    const parsed = parseFoodInput(rawText);

    // Allow UI amount override
    const uiAmountRaw = body.amount;
    const uiAmount =
      uiAmountRaw !== undefined && uiAmountRaw !== null
        ? Number(uiAmountRaw)
        : NaN;

    const amount =
      Number.isFinite(uiAmount) && uiAmount > 0 ? uiAmount : parsed.amount ?? 1;

    const meal = inferMeal(new Date());

    // 1) Try to match an existing cached FoodItem (exact/fuzzy)
    const match = await findBestFoodItem(parsed.normalized);

    // ✅ CASE A: Found → log instantly (READY)
    if (match.item) {
      const item = match.item;

      let nutrition;
      let servingUnit = "serving";
      let servingGrams;

      // Try to match with a specific serving size
      if ((item as any).servingSizes && (item as any).servingSizes.length > 0) {
        const servingMatch = findMatchingServingSize(parsed, (item as any).servingSizes);

        if (servingMatch) {
          nutrition = calculateNutrition(
            item as any,
            servingMatch.servingSize,
            servingMatch.multiplier
          );
          servingUnit = servingMatch.servingSize.name;
          servingGrams = nutrition.serving_grams;
        } else {
          // Fall back to weight-based calculation when serving size exists but doesn't match
          let multiplier = amount; // default multiplier

          // If user specified grams, calculate based on per-100g nutrition
          if (parsed.grams) {
            multiplier = parsed.grams / 100; // nutrition is stored per 100g
            servingGrams = parsed.grams;
            servingUnit = `${parsed.grams}g`;
          }

          nutrition = {
            kcal: Number(item.kcal) * multiplier,
            protein_g: Number(item.protein_g) * multiplier,
            carbs_g: Number(item.carbs_g) * multiplier,
            fat_g: Number(item.fat_g) * multiplier,
            fiber_g: item.fiber_g ? Number(item.fiber_g) * multiplier : undefined,
            serving_grams: servingGrams,
          };
        }
      } else {
        // Fall back to weight-based calculation if no serving sizes
        let multiplier = amount; // default multiplier

        // If user specified grams, calculate based on per-100g nutrition
        if (parsed.grams) {
          multiplier = parsed.grams / 100; // nutrition is stored per 100g
          servingGrams = parsed.grams;
          servingUnit = `${parsed.grams}g`;
        }

        nutrition = {
          kcal: Number(item.kcal) * multiplier,
          protein_g: Number(item.protein_g) * multiplier,
          carbs_g: Number(item.carbs_g) * multiplier,
          fat_g: Number(item.fat_g) * multiplier,
          fiber_g: item.fiber_g ? Number(item.fiber_g) * multiplier : undefined,
          serving_grams: servingGrams,
        };
      }

      const log = await prisma.foodLog.create({
        data: {
          raw_text: rawText,
          amount,
          serving_unit: servingUnit,
          serving_grams: servingGrams,
          meal,
          status: "ready",
          error_msg: null,
          food_item_id: item.id,
          kcal: nutrition.kcal,
          protein_g: nutrition.protein_g,
          carbs_g: nutrition.carbs_g,
          fat_g: nutrition.fat_g,
          fiber_g: nutrition.fiber_g,
        } as any,
        include: { foodItem: true },
      });

      return NextResponse.json({
        status: "ready",
        log,
        matchedBy: match.matchedBy,
        similarity: match.score,
        parsed,
        servingUsed: servingUnit,
      });
    }

    // ⏳ CASE B: Not found → create pending log, return instantly, estimate in background
    const log = await prisma.foodLog.create({
      data: {
        raw_text: rawText,
        amount,
        meal,
        status: "pending",
      } as any,
      include: { foodItem: true },
    });

    // Run AI estimation AFTER the response is sent.
    // On Vercel, after() keeps the serverless function alive until the promise resolves.
    after(processEstimation(log.id));

    return NextResponse.json({
      status: "pending",
      log,
      parsed,
    });
  } catch (err: any) {
    console.error("POST /api/log failed:", err);
    return NextResponse.json(
      {
        error: "Failed to log food",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
