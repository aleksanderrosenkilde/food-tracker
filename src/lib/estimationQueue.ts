// Background AI estimation processor.
// Called via POST /api/log/:id/estimate (its own serverless invocation).

import { prisma } from "@/lib/prisma";
import { estimateMacrosFromText } from "@/lib/aiEstimate";
import { parseFoodInput } from "@/lib/foodParse";
import { findBestFoodItem } from "@/lib/foodFind";
import { resolveGrams } from "@/lib/portionToGrams";

/** Process a single pending estimation. Safe to call fire-and-forget. */
export async function processEstimation(logId: string) {
  const log = await prisma.foodLog.findUnique({ where: { id: logId } });
  if (!log) return;
  if ((log as any).status === "ready") return;

  try {
    const parsed = parseFoodInput(log.raw_text);
    const logAmount = Number(log.amount);

    // ── Try cache first ────────────────────────────────────────────────────────
    const match = await findBestFoodItem(parsed.normalized);
    let item = match.item;

    // ── AI path: food not in DB ────────────────────────────────────────────────
    if (!item) {
      const { estimate: est, ai_model, ai_prompt } = await estimateMacrosFromText(log.raw_text);

      // Total grams consumed — determines how to normalise to per-100g.
      //
      //  Priority 1 — explicit weight ("200g chicken") — exact, from parser
      //  Priority 2 — volume + known density ("1 glass of milk") — from portionToGrams
      //  Priority 3 — AI's own weight estimate ("5 chicken breasts" → ~850g)
      //  Priority 4 — none: AI macros are used as-is (edge-case, low confidence)
      const totalGrams: number | null =
        parsed.grams ??
        resolveGrams(parsed, parsed.cleanedText) ??
        est.estimated_grams ??
        null;

      // Normalise AI totals → per 100g for FoodItem storage
      let per100g = { ...est };
      if (totalGrams && totalGrams > 0) {
        const factor = 100 / totalGrams;
        per100g = {
          ...est,
          kcal:      est.kcal      * factor,
          protein_g: est.protein_g * factor,
          carbs_g:   est.carbs_g   * factor,
          fat_g:     est.fat_g     * factor,
          fiber_g:   est.fiber_g != null ? est.fiber_g * factor : null,
        };
      }

      item = await prisma.foodItem.upsert({
        where:  { normalized: parsed.normalized },
        update: {
          name:       per100g.name || parsed.cleanedText || log.raw_text,
          kcal:       per100g.kcal,
          protein_g:  per100g.protein_g,
          carbs_g:    per100g.carbs_g,
          fat_g:      per100g.fat_g,
          fiber_g:    per100g.fiber_g ?? null,
          source:     "ai",
          confidence: per100g.confidence ?? null,
          ai_model,
          ai_prompt,
        },
        create: {
          name:       per100g.name || parsed.cleanedText || log.raw_text,
          normalized: parsed.normalized,
          kcal:       per100g.kcal,
          protein_g:  per100g.protein_g,
          carbs_g:    per100g.carbs_g,
          fat_g:      per100g.fat_g,
          fiber_g:    per100g.fiber_g ?? null,
          source:     "ai",
          confidence: per100g.confidence ?? null,
          ai_model,
          ai_prompt,
        },
      });

      // Log entry uses the AI's total macros directly (no further scaling needed)
      const servingGrams = totalGrams ?? undefined;
      const servingUnit  = servingGrams ? `${Math.round(servingGrams)}g` : "serving";

      await prisma.foodLog.update({
        where: { id: logId },
        data: {
          status:        "ready",
          error_msg:     null,
          food_item_id:  item.id,
          serving_unit:  servingUnit,
          serving_grams: servingGrams,
          kcal:          est.kcal,
          protein_g:     est.protein_g,
          carbs_g:       est.carbs_g,
          fat_g:         est.fat_g,
          fiber_g:       est.fiber_g ?? null,
        } as any,
      });

      console.log(
        `[estimation] ✓ ${logId} → ${item.name}` +
        (servingGrams ? ` (${Math.round(servingGrams)}g)` : "") +
        ` ${Math.round(est.kcal)} kcal`
      );
      return;
    }

    // ── Food found in DB: scale from per-100g ─────────────────────────────────
    const totalGrams: number | null =
      parsed.grams ?? resolveGrams(parsed, item.name);

    let multiplier: number;
    let servingGrams: number | undefined;
    let servingUnit: string;

    if (totalGrams != null) {
      multiplier   = totalGrams / 100;
      servingGrams = totalGrams;
      servingUnit  = `${Math.round(totalGrams)}g`;
    } else {
      // Count-based (e.g. "5 chicken breasts") with no per-piece weight.
      // Use amount as a rough multiplier of 100g servings.
      multiplier  = logAmount;
      servingUnit = "serving";
    }

    const kcal      = Number(item.kcal)      * multiplier;
    const protein_g = Number(item.protein_g) * multiplier;
    const carbs_g   = Number(item.carbs_g)   * multiplier;
    const fat_g     = Number(item.fat_g)     * multiplier;
    const fiber_g   = item.fiber_g ? Number(item.fiber_g) * multiplier : null;

    await prisma.foodLog.update({
      where: { id: logId },
      data: {
        status:        "ready",
        error_msg:     null,
        food_item_id:  item.id,
        serving_unit:  servingUnit,
        serving_grams: servingGrams,
        kcal,
        protein_g,
        carbs_g,
        fat_g,
        fiber_g,
      } as any,
    });

    console.log(`[estimation] ✓ ${logId} → ${item.name} (${Math.round(kcal)} kcal)`);
  } catch (e: any) {
    await prisma.foodLog.update({
      where: { id: logId },
      data: {
        status:    "error",
        error_msg: e?.message ?? "Estimation failed",
      } as any,
    });
    console.error(`[estimation] ✗ ${logId}:`, e?.message);
  }
}
