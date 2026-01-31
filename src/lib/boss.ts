import { PgBoss } from "pg-boss";

let boss: PgBoss | null = null;

export async function getBoss() {
  if (boss) return boss;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is missing");

  boss = new PgBoss(databaseUrl);

  // Helpful: avoid noisy unhandled rejections during dev
  boss.on("error", (err) => {
    console.error("[pg-boss error]", err);
  });

  await boss.start();

  // ✅ Ensure queues exist (do this for every job name you use)
  // "createQueue" is idempotent and safe to call multiple times
  await boss.createQueue("estimate-macros");

  return boss;
}
