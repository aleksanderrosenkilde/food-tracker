// src/app/api/log/route.ts
//
// POST /api/log
// - If food is already known (exact/fuzzy match): create a READY log immediately.
// - If unknown: create a PENDING log immediately and enqueue a background job (pg-boss)
//   to estimate macros and update the log later.

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { parseFoodInput } from "@/lib/foodParse";
import { findBestFoodItem } from "@/lib/foodFind";
import { getBoss } from "@/lib/boss";
import { estimateMacrosFromText } from "@/lib/aiEstimate";
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
      if (item.servingSizes && item.servingSizes.length > 0) {
        const servingMatch = findMatchingServingSize(parsed, item.servingSizes);

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

    // ⏳ CASE B: Not found → estimate nutrition directly
    try {
      // Estimate nutrition using AI
      const est = await estimateMacrosFromText(rawText);

      // Normalize to per-100g basis if user specified weight
      let normalizedEst = est;
      if (parsed.grams && parsed.grams !== 100) {
        const factor = 100 / parsed.grams;
        normalizedEst = {
          ...est,
          kcal: est.kcal * factor,
          protein_g: est.protein_g * factor,
          carbs_g: est.carbs_g * factor,
          fat_g: est.fat_g * factor,
          fiber_g: est.fiber_g ? est.fiber_g * factor : null,
        };
      }

      // Create new FoodItem
      const item = await prisma.foodItem.create({
        data: {
          name: normalizedEst.name || parsed.cleanedText || rawText,
          normalized: parsed.normalized,
          kcal: normalizedEst.kcal,
          protein_g: normalizedEst.protein_g,
          carbs_g: normalizedEst.carbs_g,
          fat_g: normalizedEst.fat_g,
          fiber_g: normalizedEst.fiber_g ?? null,
          source: "ai",
          confidence: normalizedEst.confidence ?? null,
        },
      });

      // Calculate nutrition based on actual serving size
      let multiplier = amount;
      let servingUnit = "serving";
      let servingGrams;

      if (parsed.grams) {
        multiplier = parsed.grams / 100; // nutrition is stored per 100g
        servingGrams = parsed.grams;
        servingUnit = `${parsed.grams}g`;
      }

      const nutrition = {
        kcal: Number(item.kcal) * multiplier,
        protein_g: Number(item.protein_g) * multiplier,
        carbs_g: Number(item.carbs_g) * multiplier,
        fat_g: Number(item.fat_g) * multiplier,
        fiber_g: item.fiber_g ? Number(item.fiber_g) * multiplier : null,
      };

      // Create ready log
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
        parsed,
        servingUsed: servingUnit,
      });

    } catch (error: any) {
      // If AI estimation fails, create error log
      const log = await prisma.foodLog.create({
        data: {
          raw_text: rawText,
          amount,
          meal,
          status: "error",
          error_msg: error.message || "AI estimation failed",
        } as any,
        include: { foodItem: true },
      });

      return NextResponse.json({
        status: "error",
        log,
        parsed,
        error: error.message || "AI estimation failed",
      });
    }
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
