// In-memory FIFO queue for background AI estimation.
// Jobs are processed one at a time in order. The queue survives across
// requests within the same server process but is lost on restart —
// that's fine because pending logs are picked up by the recovery sweep.

import { prisma } from "@/lib/prisma";
import { estimateMacrosFromText } from "@/lib/aiEstimate";
import { parseFoodInput } from "@/lib/foodParse";
import { findBestFoodItem } from "@/lib/foodFind";

const queue: string[] = [];
let processing = false;

/** Add a logId to the FIFO queue (non-blocking, returns immediately). */
export function enqueueEstimation(logId: string) {
  queue.push(logId);
  drainQueue();
}

async function drainQueue() {
  if (processing) return; // another loop is already running
  processing = true;

  while (queue.length > 0) {
    const logId = queue.shift()!;
    try {
      await processEstimation(logId);
    } catch (err) {
      console.error(`[estimation-queue] failed for ${logId}:`, err);
    }
  }

  processing = false;
}

async function processEstimation(logId: string) {
  const log = await prisma.foodLog.findUnique({ where: { id: logId } });
  if (!log) return;
  if ((log as any).status === "ready") return; // already resolved

  try {
    const parsed = parseFoodInput(log.raw_text);

    // Try cache again (maybe another request created the FoodItem)
    const match = await findBestFoodItem(parsed.normalized);
    let item = match.item;

    if (!item) {
      const est = await estimateMacrosFromText(log.raw_text);

      // Normalize AI estimate to per-100g basis if user specified weight
      let normalized = est;
      if (parsed.grams && parsed.grams !== 100) {
        const factor = 100 / parsed.grams;
        normalized = {
          ...est,
          kcal: est.kcal * factor,
          protein_g: est.protein_g * factor,
          carbs_g: est.carbs_g * factor,
          fat_g: est.fat_g * factor,
          fiber_g: est.fiber_g ? est.fiber_g * factor : null,
        };
      }

      item = await prisma.foodItem.upsert({
        where: { normalized: parsed.normalized },
        update: {
          name: normalized.name || parsed.cleanedText || log.raw_text,
          kcal: normalized.kcal,
          protein_g: normalized.protein_g,
          carbs_g: normalized.carbs_g,
          fat_g: normalized.fat_g,
          fiber_g: normalized.fiber_g ?? null,
          source: "ai",
          confidence: normalized.confidence ?? null,
        },
        create: {
          name: normalized.name || parsed.cleanedText || log.raw_text,
          normalized: parsed.normalized,
          kcal: normalized.kcal,
          protein_g: normalized.protein_g,
          carbs_g: normalized.carbs_g,
          fat_g: normalized.fat_g,
          fiber_g: normalized.fiber_g ?? null,
          source: "ai",
          confidence: normalized.confidence ?? null,
        },
      });
    }

    // Calculate nutrition for the log based on actual serving
    const amount = Number(log.amount);
    let multiplier = amount;
    let servingUnit = "serving";
    let servingGrams: number | undefined;

    if (parsed.grams) {
      multiplier = parsed.grams / 100;
      servingGrams = parsed.grams;
      servingUnit = `${parsed.grams}g`;
    }

    const kcal = Number(item.kcal) * multiplier;
    const protein_g = Number(item.protein_g) * multiplier;
    const carbs_g = Number(item.carbs_g) * multiplier;
    const fat_g = Number(item.fat_g) * multiplier;
    const fiber_g = item.fiber_g ? Number(item.fiber_g) * multiplier : null;

    await prisma.foodLog.update({
      where: { id: logId },
      data: {
        status: "ready",
        error_msg: null,
        food_item_id: item.id,
        serving_unit: servingUnit,
        serving_grams: servingGrams,
        kcal,
        protein_g,
        carbs_g,
        fat_g,
        fiber_g,
      } as any,
    });

    console.log(`[estimation-queue] ✓ ${logId} → ${item.name} (${Math.round(kcal)} kcal)`);
  } catch (e: any) {
    await prisma.foodLog.update({
      where: { id: logId },
      data: {
        status: "error",
        error_msg: e?.message ?? "Estimation failed",
      } as any,
    });
    console.error(`[estimation-queue] ✗ ${logId}:`, e?.message);
  }
}
