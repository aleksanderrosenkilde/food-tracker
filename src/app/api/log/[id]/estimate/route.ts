// POST /api/log/:id/estimate
// Triggered by the frontend after creating a pending log.
// Runs the AI estimation in its own serverless invocation (full 60s timeout).

import { NextResponse } from "next/server";
import { processEstimation } from "@/lib/estimationQueue";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: "Missing log id" }, { status: 400 });
  }

  try {
    await processEstimation(id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(`POST /api/log/${id}/estimate failed:`, err);
    return NextResponse.json(
      { error: err?.message ?? "Estimation failed" },
      { status: 500 }
    );
  }
}
