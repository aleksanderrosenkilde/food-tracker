import { getBoss } from "@/lib/boss";
import { prisma } from "@/lib/prisma";
import { estimateMacrosFromText } from "@/lib/aiEstimate";
import { parseFoodInput } from "@/lib/foodParse";
import { findBestFoodItem } from "@/lib/foodFind";

export async function ensureWorkerStarted() {
  const boss = await getBoss();

  // Only register once
  // pg-boss will ignore duplicate work handlers if you guard with a module-level flag.
  if ((globalThis as any).__workerStarted) return;
  (globalThis as any).__workerStarted = true;

  await boss.work("estimate-macros", async (job: any) => {
    const { logId } = job.data as { logId: string };

    const log = await prisma.foodLog.findUnique({ where: { id: logId } });
    if (!log) return;

    try {
      const parsed = parseFoodInput(log.raw_text);

      // If another request already resolved it, skip
      if ((log as any).status === "ready") return;

      // Try cache again (maybe another log created the item)
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
        multiplier = parsed.grams / 100; // FoodItem stores per-100g
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
    } catch (e: any) {
      await prisma.foodLog.update({
        where: { id: logId },
        data: {
          status: "error",
          error_msg: e?.message ?? "Estimation failed",
        } as any,
      });
      throw e;
    }
  });
}
