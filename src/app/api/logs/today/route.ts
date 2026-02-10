import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    // Support optional timezone via query param, default to UTC
    const { searchParams } = new URL(req.url);
    const tz = searchParams.get("tz") || "UTC";

    // Calculate start of today in the given timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateStr = formatter.format(now); // "YYYY-MM-DD"
    const startOfDay = new Date(`${dateStr}T00:00:00`);

    // Fallback: if timezone parsing failed, use UTC midnight
    const start = isNaN(startOfDay.getTime())
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : startOfDay;

    const logs = await prisma.foodLog.findMany({
      where: {
        logged_at: { gte: start },
        status: "ready",
      },
      include: { foodItem: true },
      orderBy: { logged_at: "asc" },
    });

    return NextResponse.json({ logs });
  } catch (err: any) {
    console.error("GET /api/logs/today failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch today's logs" },
      { status: 500 }
    );
  }
}
