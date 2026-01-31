import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: "Missing log id" },
      { status: 400 }
    );
  }

  const log = await prisma.foodLog.findUnique({
    where: { id },
    include: { foodItem: true },
  });

  if (!log) {
    return NextResponse.json(
      { error: "Log not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ log });
}
