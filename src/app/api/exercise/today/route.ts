// GET /api/exercise/today
//
// Queries Firestore (myfirstfitnessapp-9b457) for today's workouts and
// sums the `calories` field to return total kcal burned.
//
// Requires env var: FIREBASE_API_KEY

import { NextResponse } from "next/server";

const PROJECT_ID = "myfirstfitnessapp-9b457";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

export async function GET(req: Request) {
  try {
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) {
      console.error("[exercise/today] FIREBASE_API_KEY not set");
      return NextResponse.json({ kcalBurned: 0 });
    }

    // Determine today's UTC boundaries based on the caller's local timezone.
    const { searchParams } = new URL(req.url);
    const tz = searchParams.get("tz") || "UTC";

    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const todayStr = formatter.format(now); // "YYYY-MM-DD"

    // Parse into local midnight, then convert to UTC ISO for Firestore query.
    // new Date("YYYY-MMT00:00:00") is interpreted as LOCAL time.
    const todayLocalMidnight = new Date(`${todayStr}T00:00:00`);
    if (isNaN(todayLocalMidnight.getTime())) {
      console.error("[exercise/today] Could not parse today's date:", todayStr);
      return NextResponse.json({ kcalBurned: 0 });
    }
    const tomorrowLocalMidnight = new Date(todayLocalMidnight);
    tomorrowLocalMidnight.setDate(tomorrowLocalMidnight.getDate() + 1);

    // Build Firestore structured query:
    // SELECT * FROM workouts WHERE startDate >= todayStart AND startDate < tomorrowStart
    const body = {
      structuredQuery: {
        from: [{ collectionId: "workouts" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "startDate" },
                  op: "GREATER_THAN_OR_EQUAL",
                  value: { timestampValue: todayLocalMidnight.toISOString() },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: "startDate" },
                  op: "LESS_THAN",
                  value: { timestampValue: tomorrowLocalMidnight.toISOString() },
                },
              },
            ],
          },
        },
      },
    };

    const res = await fetch(`${FIRESTORE_BASE}:runQuery?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[exercise/today] Firestore query failed:", res.status, errText);
      return NextResponse.json({ kcalBurned: 0 });
    }

    // Firestore runQuery returns an array of { document: { fields: {...} } } objects.
    // Documents with no result (e.g., empty collection) return [{ readTime: "..." }].
    const results: any[] = await res.json();

    let kcalBurned = 0;
    for (const result of results) {
      const fields = result.document?.fields;
      if (!fields) continue;

      const cal = fields.calories;
      if (!cal) continue;

      // Firestore value types: integerValue | doubleValue | stringValue
      if (cal.integerValue !== undefined) kcalBurned += Number(cal.integerValue);
      else if (cal.doubleValue !== undefined) kcalBurned += Number(cal.doubleValue);
      else if (cal.stringValue !== undefined) kcalBurned += Number(cal.stringValue) || 0;
    }

    console.log(`[exercise/today] ${Math.round(kcalBurned)} kcal burned today (${results.filter(r => r.document).length} workouts)`);
    return NextResponse.json({ kcalBurned: Math.round(kcalBurned) });
  } catch (err: any) {
    console.error("[exercise/today] Unexpected error:", err?.message ?? err);
    return NextResponse.json({ kcalBurned: 0 });
  }
}
