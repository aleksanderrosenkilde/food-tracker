import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tz = searchParams.get("tz") || "UTC";

    // Date formatter for grouping logs by local date
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const now = new Date();
    const todayStr = formatter.format(now);
    const startOfToday = new Date(`${todayStr}T00:00:00`);
    if (isNaN(startOfToday.getTime())) {
      throw new Error(`Invalid date from timezone: ${tz}`);
    }

    // Start of 7-day window (6 days ago + today)
    const windowStart = new Date(startOfToday);
    windowStart.setDate(windowStart.getDate() - 6);

    const logs = await prisma.foodLog.findMany({
      where: {
        logged_at: { gte: windowStart },
        status: "ready",
      },
      select: { logged_at: true, kcal: true },
    });

    // Group by local date
    const byDate: Record<string, number> = {};
    for (const log of logs) {
      const dateStr = formatter.format(log.logged_at);
      byDate[dateStr] = (byDate[dateStr] ?? 0) + Number(log.kcal ?? 0);
    }

    // Build 7-entry array oldest→newest, filling gaps with 0
    const days: { date: string; kcal: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfToday);
      d.setDate(d.getDate() - i);
      const dateStr = formatter.format(d);
      days.push({ date: dateStr, kcal: Math.round(byDate[dateStr] ?? 0) });
    }

    return NextResponse.json({ days });
  } catch (err: any) {
    console.error("GET /api/logs/week failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch weekly logs" },
      { status: 500 }
    );
  }
}
