"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type FoodLog = {
  id: string;
  status: "pending" | "ready" | "error";
  kcal?: string;
  protein_g?: string;
  carbs_g?: string;
  fat_g?: string;
  error_msg?: string;
  raw_text?: string;
  foodItem?: {
    name: string;
  };
};

type ServingSize = {
  id: string;
  name: string;
  grams: string;
  is_default: boolean;
};

type ExternalFoodData = {
  externalId: string;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fiber_100g?: number;
  source: string;
};

type Suggestion = {
  id: string;
  name: string;
  kcal: string | number;
  protein_g: string | number;
  carbs_g: string | number;
  fat_g: string | number;
  source?: "local" | "usda";
  externalData?: ExternalFoodData;
  servingSizes?: ServingSize[];
};

type PendingItem = {
  id: string;
  rawText: string;
  status: "pending" | "ready" | "error";
  kcal?: number;
  name?: string;
  errorMsg?: string;
};

type DailyLog = {
  id: string;
  raw_text: string;
  meal: string | null;
  kcal: string | null;
  protein_g: string | null;
  carbs_g: string | null;
  fat_g: string | null;
  foodItem?: { name: string } | null;
};

type WeekDay = { date: string; kcal: number };

const DAILY_GOAL = 1500;

export default function Home() {
  const [text, setText] = useState("");
  const [amount, setAmount] = useState(1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<PendingItem[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [weeklyData, setWeeklyData] = useState<WeekDay[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // -------------------------------------------------------
  // Fetch today's logs + weekly summary
  // -------------------------------------------------------
  const fetchDailyLogs = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/logs/today?tz=${encodeURIComponent(tz)}`);
      const data = await res.json();
      setDailyLogs(data.logs || []);
    } catch {}
  }, []);

  const fetchWeeklyData = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/logs/week?tz=${encodeURIComponent(tz)}`);
      const data = await res.json();
      setWeeklyData(data.days || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchDailyLogs();
    fetchWeeklyData();
  }, [fetchDailyLogs, fetchWeeklyData]);

  // -------------------------------------------------------
  // Suggestions dropdown
  // -------------------------------------------------------
  useEffect(() => {
    const q = text.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, {
          signal: ac.signal,
        });
        const data = await res.json();
        setSuggestions(data.items || []);
      } catch {}
    }, 120);

    return () => clearTimeout(t);
  }, [text]);

  // -------------------------------------------------------
  // Poll background estimation (updates pending queue)
  // -------------------------------------------------------
  const pollLog = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/log/${id}`);
      const data = await res.json();
      const log: FoodLog = data.log;

      if (log.status === "ready") {
        setPendingQueue((q) =>
          q.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "ready" as const,
                  kcal: Math.round(Number(log.kcal)),
                  name: log.foodItem?.name ?? item.rawText,
                }
              : item
          )
        );
        fetchDailyLogs();
        fetchWeeklyData();
        setTimeout(() => {
          setPendingQueue((q) => q.filter((item) => item.id !== id));
        }, 3000);
        return;
      }

      if (log.status === "error") {
        setPendingQueue((q) =>
          q.map((item) =>
            item.id === id
              ? { ...item, status: "error" as const, errorMsg: log.error_msg }
              : item
          )
        );
        setTimeout(() => {
          setPendingQueue((q) => q.filter((item) => item.id !== id));
        }, 5000);
        return;
      }

      setTimeout(() => pollLog(id), 700);
    } catch {
      setTimeout(() => pollLog(id), 1000);
    }
  }, [fetchDailyLogs]);

  // -------------------------------------------------------
  // Submit food (supports comma-separated multi-food)
  // -------------------------------------------------------
  async function submit(customText?: string, servingSize?: ServingSize, externalFood?: ExternalFoodData & { name: string }) {
    const payloadText = (customText ?? text).trim();
    if (!payloadText) return;

    const items: Array<{ text: string; servingSize?: ServingSize; externalFood?: ExternalFoodData & { name: string } }> = [];

    if (!customText && !servingSize && !externalFood && payloadText.includes(",")) {
      const parts = payloadText.split(",").map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        items.push({ text: part });
      }
    } else {
      items.push({ text: payloadText, servingSize, externalFood });
    }

    setBusy(true);
    setMessage(items.length > 1 ? `Logging ${items.length} items…` : "Logging…");

    setText("");
    setSuggestions([]);
    setSelectedSuggestion(null);

    try {
      let readyCount = 0;
      let pendingCount = 0;

      for (const item of items) {
        let finalText = item.text;
        if (item.servingSize) {
          finalText = `${amount} ${item.servingSize.name} ${item.text}`;
        }

        const res = await fetch("/api/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: finalText,
            amount: item.servingSize ? amount : undefined,
            externalFood: item.externalFood,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed");

        if (data.status === "ready") {
          readyCount++;
          if (items.length === 1) {
            const servingInfo =
              data.servingUsed && data.servingUsed !== "serving"
                ? ` (${data.servingUsed})`
                : "";
            setMessage(
              `Logged: ${Math.round(Number(data.log.kcal))} kcal — ${data.log.foodItem?.name ?? ""}${servingInfo}`
            );
          }
          fetchDailyLogs();
          fetchWeeklyData();
        }

        if (data.status === "pending") {
          pendingCount++;
          setPendingQueue((q) => [
            ...q,
            { id: data.log.id, rawText: finalText, status: "pending" },
          ]);
          fetch(`/api/log/${data.log.id}/estimate`, { method: "POST" }).catch(
            () => {}
          );
          pollLog(data.log.id);
        }
      }

      if (items.length > 1) {
        setMessage(`Logged ${readyCount + pendingCount} items${pendingCount > 0 ? ` (${pendingCount} estimating)` : ""}`);
      } else if (pendingCount > 0 && items.length === 1) {
        setMessage("Logged ✓");
      }
    } catch (e: any) {
      setMessage(e.message || "Error");
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  // -------------------------------------------------------
  // Computed daily totals
  // -------------------------------------------------------
  const totals = dailyLogs.reduce(
    (acc, log) => ({
      kcal: acc.kcal + Number(log.kcal || 0),
      protein: acc.protein + Number(log.protein_g || 0),
      carbs: acc.carbs + Number(log.carbs_g || 0),
      fat: acc.fat + Number(log.fat_g || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );

  // -------------------------------------------------------
  // Progress bar derived values
  // -------------------------------------------------------
  const progressPct = Math.min(totals.kcal / DAILY_GOAL, 1) * 100;
  const isOverGoal = totals.kcal > DAILY_GOAL;
  const progressColor = isOverGoal
    ? "#dc2626"
    : totals.kcal / DAILY_GOAL > 0.8
    ? "#d97706"
    : "#16a34a";

  // -------------------------------------------------------
  // 7-day chart helpers
  // -------------------------------------------------------
  const chartViewW = 480;
  const chartViewH = 160;
  const padT = 22; // space for kcal labels above bars
  const padB = 26; // space for day labels below bars
  const plotH = chartViewH - padT - padB;
  const slotW = chartViewW / 7;
  const barW = slotW * 0.52;
  const maxKcal = Math.max(
    DAILY_GOAL * 1.2,
    ...weeklyData.map((d) => d.kcal),
    1
  );
  const yFor = (kcal: number) =>
    padT + plotH - (kcal / maxKcal) * plotH;
  const goalY = yFor(DAILY_GOAL);
  const todayDateStr = weeklyData[weeklyData.length - 1]?.date ?? "";

  function dayLabel(dateStr: string, idx: number) {
    if (idx === 6) return "Today";
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }

  return (
    <main style={{
      maxWidth: 640,
      margin: "0 auto",
      padding: "48px 20px 80px",
      minHeight: "100vh",
    }}>
      <h1 style={{
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: "-0.03em",
        marginBottom: 32,
        color: "var(--text-primary)",
      }}>Food tracker</h1>

      <div style={{
        display: "flex",
        gap: 10,
        position: "relative",
        flexWrap: "wrap" as const,
      }}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="What did you eat? (e.g., 'apple, banana, 200g chicken')"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "12px 16px",
            fontSize: 15,
            lineHeight: "20px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface)",
            color: "var(--text-primary)",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            boxShadow: "var(--shadow-sm)",
          }}
          disabled={busy}
          autoFocus
        />

        <input
          type="number"
          min="0.25"
          step="0.25"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          style={{
            width: 90,
            minWidth: 90,
            padding: "12px 12px",
            fontSize: 15,
            lineHeight: "20px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface)",
            color: "var(--text-primary)",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            boxShadow: "var(--shadow-sm)",
            textAlign: "center" as const,
          }}
        />
      </div>

      {suggestions.length > 0 && (
        <div style={{
          marginTop: 6,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
          animation: "fadeInUp 0.15s ease-out",
        }}>
          {suggestions.map((s) => (
            <div key={s.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
              <button
                onClick={() => {
                  if (s.externalData) {
                    // USDA result: pass nutrition data directly, no AI needed
                    submit(s.name, undefined, { ...s.externalData, name: s.name });
                  } else if (s.servingSizes && s.servingSizes.length > 0) {
                    setSelectedSuggestion(selectedSuggestion?.id === s.id ? null : s);
                  } else {
                    submit(s.name);
                  }
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  border: "none",
                  background: selectedSuggestion?.id === s.id
                    ? "var(--surface-hover)"
                    : "var(--surface)",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  transition: "background-color 0.1s ease",
                  fontSize: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{s.name}</span>
                      {s.source === "usda" && (
                        <span style={{
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          color: "var(--text-tertiary)",
                          background: "var(--surface-secondary)",
                          border: "1px solid var(--border-light)",
                          borderRadius: 3,
                          padding: "1px 4px",
                          flexShrink: 0,
                          textTransform: "uppercase" as const,
                        }}>USDA</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                      {Math.round(Number(s.kcal))} kcal per 100g
                    </div>
                  </div>
                  {!s.externalData && s.servingSizes && s.servingSizes.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, flexShrink: 0 }}>
                      {s.servingSizes.length} serving{s.servingSizes.length !== 1 ? 's' : ''} ▼
                    </div>
                  )}
                </div>
              </button>

              {selectedSuggestion?.id === s.id && s.servingSizes && (
                <div style={{
                  padding: "8px 14px 10px",
                  background: "var(--surface-secondary)",
                  borderTop: "1px solid var(--border-light)",
                }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--text-tertiary)",
                    marginBottom: 8,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.04em",
                  }}>
                    Select a serving size
                  </div>
                  {s.servingSizes.map((serving) => (
                    <button
                      key={serving.id}
                      onClick={() => submit(s.name, serving)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        marginBottom: 4,
                        border: "1px solid var(--border-light)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--surface)",
                        cursor: "pointer",
                        fontSize: 13,
                        color: "var(--text-primary)",
                        transition: "background-color 0.1s ease, border-color 0.1s ease",
                      }}
                    >
                      <div style={{ fontWeight: serving.is_default ? 600 : 400 }}>
                        {serving.name} ({Number(serving.grams)}g)
                        {serving.is_default && " ⭐"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>
                        ~{Math.round(Number(s.kcal) * Number(serving.grams) / 100)} kcal
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{
        marginTop: 16,
        minHeight: 24,
        fontSize: 13,
        color: "var(--text-secondary)",
        fontWeight: 500,
        transition: "opacity 0.2s ease",
        opacity: message ? 1 : 0,
      }}>{message}</div>

      {/* Pending estimation queue */}
      {pendingQueue.length > 0 && (
        <div style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "column" as const,
          gap: 8,
        }}>
          {pendingQueue.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                fontSize: 13,
                color: item.status === "ready"
                  ? "var(--success-text)"
                  : item.status === "error"
                  ? "var(--error-text)"
                  : "var(--text-primary)",
                background: item.status === "ready"
                  ? "var(--success-bg)"
                  : item.status === "error"
                  ? "var(--error-bg)"
                  : "var(--surface)",
                border: `1px solid ${
                  item.status === "ready"
                    ? "var(--success-border)"
                    : item.status === "error"
                    ? "var(--error-border)"
                    : "var(--border)"
                }`,
                boxShadow: "var(--shadow-md)",
                transition: "all 0.3s ease",
                animation: "fadeInUp 0.2s ease-out",
              }}
            >
              {item.status === "pending" && (
                <span
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    border: "2px solid var(--border)",
                    borderTopColor: "var(--text-secondary)",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                    flexShrink: 0,
                  }}
                />
              )}
              {item.status === "ready" && <span>✓</span>}
              {item.status === "error" && <span>✗</span>}
              <span style={{ flex: 1, fontWeight: 500 }}>{item.rawText}</span>
              <span style={{ fontSize: 12, color: "var(--text-tertiary)", flexShrink: 0 }}>
                {item.status === "pending" && "estimating…"}
                {item.status === "ready" &&
                  `${item.kcal} kcal — ${item.name ?? ""}`}
                {item.status === "error" &&
                  (item.errorMsg ?? "estimation failed")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {dailyLogs.length === 0 && pendingQueue.length === 0 && (
        <div style={{
          marginTop: 64,
          textAlign: "center",
          color: "var(--text-tertiary)",
          fontSize: 14,
          lineHeight: "22px",
        }}>
          <div style={{ fontWeight: 500 }}>No food logged today</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            Type what you ate above to get started
          </div>
        </div>
      )}

      {/* Daily macros summary table */}
      {dailyLogs.length > 0 && (
        <div style={{
          marginTop: 40,
          background: "var(--surface)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-md)",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "16px 20px 12px",
            borderBottom: "1px solid var(--border-light)",
          }}>
            <h2 style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}>Today</h2>
          </div>

          {/* ── Daily calorie progress bar ── */}
          <div style={{ padding: "14px 20px 16px", borderBottom: "1px solid var(--border-light)" }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 8,
            }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
                Calories
              </span>
              <span style={{
                fontSize: 13,
                fontWeight: 600,
                color: isOverGoal ? "#dc2626" : "var(--text-primary)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {Math.round(totals.kcal).toLocaleString()}
                <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}> / {DAILY_GOAL.toLocaleString()} kcal</span>
              </span>
            </div>
            <div style={{
              height: 7,
              borderRadius: 99,
              background: "var(--border-light)",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${progressPct}%`,
                borderRadius: 99,
                background: progressColor,
                transition: "width 0.6s cubic-bezier(0.4,0,0.2,1), background-color 0.3s ease",
              }} />
            </div>
            {isOverGoal && (
              <div style={{ fontSize: 11, color: "#dc2626", marginTop: 5, textAlign: "right" as const }}>
                +{Math.round(totals.kcal - DAILY_GOAL)} kcal over goal
              </div>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{
                    padding: "10px 20px",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                    fontSize: 12,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.04em",
                  }}>Food</th>
                  <th style={{
                    padding: "10px 20px",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                    fontSize: 12,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.04em",
                    textAlign: "right",
                  }}>Kcal</th>
                  <th style={{
                    padding: "10px 20px",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                    fontSize: 12,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.04em",
                    textAlign: "right",
                  }}>Protein</th>
                  <th style={{
                    padding: "10px 20px",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                    fontSize: 12,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.04em",
                    textAlign: "right",
                  }}>Carbs</th>
                  <th style={{
                    padding: "10px 20px",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                    fontSize: 12,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.04em",
                    textAlign: "right",
                  }}>Fat</th>
                </tr>
              </thead>
              <tbody>
                {dailyLogs.map((log, index) => (
                  <tr key={log.id} style={{
                    borderBottom: "1px solid var(--table-border)",
                    background: index % 2 === 1 ? "var(--table-row-alt)" : "transparent",
                  }}>
                    <td style={{ padding: "10px 20px", color: "var(--text-primary)" }}>
                      {log.foodItem?.name ?? log.raw_text}
                    </td>
                    <td style={{
                      padding: "10px 20px",
                      textAlign: "right",
                      color: "var(--text-secondary)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {log.kcal ? Math.round(Number(log.kcal)) : "—"}
                    </td>
                    <td style={{
                      padding: "10px 20px",
                      textAlign: "right",
                      color: "var(--text-secondary)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {log.protein_g ? `${Math.round(Number(log.protein_g))}g` : "—"}
                    </td>
                    <td style={{
                      padding: "10px 20px",
                      textAlign: "right",
                      color: "var(--text-secondary)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {log.carbs_g ? `${Math.round(Number(log.carbs_g))}g` : "—"}
                    </td>
                    <td style={{
                      padding: "10px 20px",
                      textAlign: "right",
                      color: "var(--text-secondary)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {log.fat_g ? `${Math.round(Number(log.fat_g))}g` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{
                  borderTop: "1px solid var(--border)",
                  background: "var(--table-footer-bg)",
                }}>
                  <td style={{
                    padding: "12px 20px",
                    color: "var(--text-primary)",
                    fontWeight: 600,
                  }}>Total</td>
                  <td style={{
                    padding: "12px 20px",
                    textAlign: "right",
                    color: "var(--text-primary)",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {Math.round(totals.kcal)}
                  </td>
                  <td style={{
                    padding: "12px 20px",
                    textAlign: "right",
                    color: "var(--text-primary)",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {Math.round(totals.protein)}g
                  </td>
                  <td style={{
                    padding: "12px 20px",
                    textAlign: "right",
                    color: "var(--text-primary)",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {Math.round(totals.carbs)}g
                  </td>
                  <td style={{
                    padding: "12px 20px",
                    textAlign: "right",
                    color: "var(--text-primary)",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {Math.round(totals.fat)}g
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── 7-day calorie bar chart ── */}
      {weeklyData.length > 0 && (
        <div style={{
          marginTop: 20,
          background: "var(--surface)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-md)",
          overflow: "hidden",
        }}>
          <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border-light)" }}>
            <h2 style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}>Last 7 days</h2>
          </div>

          <div style={{ padding: "16px 20px 8px" }}>
            <svg
              viewBox={`0 0 ${chartViewW} ${chartViewH}`}
              width="100%"
              style={{ display: "block", overflow: "visible" }}
              aria-label="7-day calorie chart"
            >
              {/* Goal line */}
              <line
                x1={0}
                y1={goalY}
                x2={chartViewW}
                y2={goalY}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="5 4"
              />
              {/* Goal label */}
              <text
                x={chartViewW - 2}
                y={goalY - 4}
                textAnchor="end"
                fontSize={9}
                fill="#94a3b8"
                fontWeight={600}
                letterSpacing="0.04em"
              >
                {DAILY_GOAL.toLocaleString()} KCAL
              </text>

              {/* Bars */}
              {weeklyData.map((day, i) => {
                const isToday = day.date === todayDateStr;
                const over = day.kcal > DAILY_GOAL;
                const barH = day.kcal > 0 ? (day.kcal / maxKcal) * plotH : 0;
                const x = i * slotW + (slotW - barW) / 2;
                const y = padT + plotH - barH;
                const barColor = over
                  ? (isToday ? "#dc2626" : "#f87171")
                  : (isToday ? "#16a34a" : "#4ade80");
                const labelY = y - 5;

                return (
                  <g key={day.date}>
                    {/* Bar */}
                    {day.kcal > 0 && (
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={barH}
                        rx={3}
                        fill={barColor}
                        opacity={isToday ? 1 : 0.85}
                      />
                    )}
                    {/* Empty day — faint baseline tick */}
                    {day.kcal === 0 && (
                      <rect
                        x={x}
                        y={padT + plotH - 2}
                        width={barW}
                        height={2}
                        rx={1}
                        fill="var(--border)"
                      />
                    )}
                    {/* Kcal label above bar */}
                    {day.kcal > 0 && (
                      <text
                        x={x + barW / 2}
                        y={Math.min(labelY, padT + plotH - barH - 3)}
                        textAnchor="middle"
                        fontSize={9}
                        fill={over ? "#dc2626" : "#15803d"}
                        fontWeight={isToday ? 700 : 500}
                      >
                        {day.kcal >= 1000
                          ? `${(day.kcal / 1000).toFixed(1)}k`
                          : day.kcal}
                      </text>
                    )}
                    {/* Day label */}
                    <text
                      x={i * slotW + slotW / 2}
                      y={padT + plotH + 16}
                      textAnchor="middle"
                      fontSize={10}
                      fill={isToday ? "var(--text-primary)" : "var(--text-tertiary)"}
                      fontWeight={isToday ? 700 : 400}
                    >
                      {dayLabel(day.date, i)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </main>
  );
}
