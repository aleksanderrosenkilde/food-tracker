// scripts/worker.ts
import "dotenv/config";

import { getBoss } from "../src/lib/boss";
import { prisma } from "../src/lib/prisma";
import { estimateMacrosFromText } from "../src/lib/aiEstimate";
import { parseFoodInput } from "../src/lib/foodParse";
import { findBestFoodItem } from "../src/lib/foodFind";

type JobData = { logId?: string };

// pg-boss job shape (loose typing because versions vary)
type AnyJob = {
  id?: string | number;
  name?: string;
  data?: JobData;
};

async function processOne(job: AnyJob) {
  const logId = job?.data?.logId;

  if (!logId) {
    console.warn("[worker] job missing data/logId, skipping", {
      jobId: job?.id,
      queue: job?.name,
      data: job?.data,
    });
    return;
  }

  console.log("[worker] job estimate-macros", logId);

  const log = await prisma.foodLog.findUnique({ where: { id: logId } });
  if (!log) {
    console.warn("[worker] log not found, skipping", logId);
    return;
  }

  if (log.status === "ready") {
    console.log("[worker] already ready, skipping", logId);
    return;
  }

  try {
    const parsed = parseFoodInput(log.raw_text);

    // Try cache again (maybe another job created it already)
    const match = await findBestFoodItem(parsed.normalized);
    let item = match.item;

    if (!item) {
      const { estimate: est, ai_model, ai_prompt } = await estimateMacrosFromText(log.raw_text);

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

      item = await prisma.foodItem.upsert({
        where: { normalized: parsed.normalized },
        update: {
          name: normalizedEst.name || parsed.cleanedText || log.raw_text,
          kcal: normalizedEst.kcal,
          protein_g: normalizedEst.protein_g,
          carbs_g: normalizedEst.carbs_g,
          fat_g: normalizedEst.fat_g,
          fiber_g: normalizedEst.fiber_g ?? null,
          source: "ai",
          confidence: normalizedEst.confidence ?? null,
          ai_model,
          ai_prompt,
        },
        create: {
          name: normalizedEst.name || parsed.cleanedText || log.raw_text,
          normalized: parsed.normalized,
          kcal: normalizedEst.kcal,
          protein_g: normalizedEst.protein_g,
          carbs_g: normalizedEst.carbs_g,
          fat_g: normalizedEst.fat_g,
          fiber_g: normalizedEst.fiber_g ?? null,
          source: "ai",
          confidence: normalizedEst.confidence ?? null,
          ai_model,
          ai_prompt,
        },
      });
    }

    // Calculate nutrition based on actual serving size (same logic as API route)
    const amount = Number(log.amount);
    let multiplier = amount; // default multiplier
    let servingUnit = "serving";
    let servingGrams;

    // If user specified grams, calculate based on per-100g nutrition
    if (parsed.grams) {
      multiplier = parsed.grams / 100; // nutrition is stored per 100g
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
      },
    });

    console.log("[worker] done", logId);
  } catch (e: any) {
    const msg = e?.message ?? "Estimation failed";

    await prisma.foodLog.update({
      where: { id: logId },
      data: {
        status: "error",
        error_msg: msg,
      },
    });

    console.error("[worker] error", logId, msg);
    throw e; // let pg-boss mark job failed
  }
}

async function main() {
  console.log("[worker] DATABASE_URL =", process.env.DATABASE_URL);

  const boss = await getBoss();
  console.log("[worker] started");

  await boss.work("estimate-macros", async (jobOrJobs: AnyJob | AnyJob[]) => {
    // ✅ Handle both single job and batch jobs
    const jobs = Array.isArray(jobOrJobs) ? jobOrJobs : [jobOrJobs];

    // Debug once to confirm shape
    if (Array.isArray(jobOrJobs)) {
      console.log("[worker] received batch", jobs.length);
    }

    for (const j of jobs) {
      // If pg-boss ever passes undefined/null in a batch, skip safely
      if (!j) {
        console.warn("[worker] received empty job in batch, skipping");
        continue;
      }
      await processOne(j);
    }
  });
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});