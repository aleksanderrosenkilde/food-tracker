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

type Suggestion = {
  id: string;
  name: string;
  kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
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

export default function Home() {
  const [text, setText] = useState("");
  const [amount, setAmount] = useState(1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<PendingItem[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // -------------------------------------------------------
  // Fetch today's logs
  // -------------------------------------------------------
  const fetchDailyLogs = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/logs/today?tz=${encodeURIComponent(tz)}`);
      const data = await res.json();
      setDailyLogs(data.logs || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchDailyLogs();
  }, [fetchDailyLogs]);

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
  async function submit(customText?: string, servingSize?: ServingSize) {
    const payloadText = (customText ?? text).trim();
    if (!payloadText) return;

    const items: Array<{ text: string; servingSize?: ServingSize }> = [];

    if (!customText && !servingSize && payloadText.includes(",")) {
      const parts = payloadText.split(",").map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        items.push({ text: part });
      }
    } else {
      items.push({ text: payloadText, servingSize });
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
                  if (s.servingSizes && s.servingSizes.length > 0) {
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
                  <div>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                      {Math.round(Number(s.kcal))} kcal per 100g
                    </div>
                  </div>
                  {s.servingSizes && s.servingSizes.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
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
    </main>
  );
}
