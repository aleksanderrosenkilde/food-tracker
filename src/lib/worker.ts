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

        item = await prisma.foodItem.upsert({
          where: { normalized: parsed.normalized },
          update: {
            name: est.name || parsed.cleanedText || log.raw_text,
            kcal: est.kcal,
            protein_g: est.protein_g,
            carbs_g: est.carbs_g,
            fat_g: est.fat_g,
            fiber_g: est.fiber_g ?? null,
            source: "ai",
            confidence: est.confidence ?? null,
          },
          create: {
            name: est.name || parsed.cleanedText || log.raw_text,
            normalized: parsed.normalized,
            kcal: est.kcal,
            protein_g: est.protein_g,
            carbs_g: est.carbs_g,
            fat_g: est.fat_g,
            fiber_g: est.fiber_g ?? null,
            source: "ai",
            confidence: est.confidence ?? null,
          },
        });
      }

      const amount = Number(log.amount);

      const kcal = Number(item.kcal) * amount;
      const protein_g = Number(item.protein_g) * amount;
      const carbs_g = Number(item.carbs_g) * amount;
      const fat_g = Number(item.fat_g) * amount;
      const fiber_g = item.fiber_g ? Number(item.fiber_g) * amount : null;

      await prisma.foodLog.update({
        where: { id: logId },
        data: {
          status: "ready",
          error_msg: null,
          food_item_id: item.id,
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
