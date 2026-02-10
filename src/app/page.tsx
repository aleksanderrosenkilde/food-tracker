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
        // Auto-remove after 3 seconds
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
        // Auto-remove after 5 seconds
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

    // Determine items to log
    // Only split by comma for free-form text input (not suggestion clicks)
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

    // Clear input immediately for rapid logging
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
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, marginBottom: 16, color: "#333" }}>Food tracker</h1>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="What did you eat? (e.g., 'apple, banana, 200g chicken')"
          style={{
            flex: 1,
            padding: 14,
            fontSize: 18,
            borderRadius: 12,
            border: "1px solid #ddd",
            color: "#333",
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
            width: 110,
            padding: 14,
            fontSize: 18,
            borderRadius: 12,
            border: "1px solid #ddd",
            color: "#333",
          }}
        />
      </div>

      {suggestions.length > 0 && (
        <div style={{ marginTop: 10, border: "1px solid #eee", borderRadius: 12 }}>
          {suggestions.map((s) => (
            <div key={s.id} style={{ borderBottom: "1px solid #f2f2f2" }}>
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
                  padding: 12,
                  border: "none",
                  background: selectedSuggestion?.id === s.id ? "#f8f8f8" : "white",
                  cursor: "pointer",
                  color: "#333",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div>{s.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {Math.round(Number(s.kcal))} kcal per 100g
                    </div>
                  </div>
                  {s.servingSizes && s.servingSizes.length > 0 && (
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {s.servingSizes.length} serving{s.servingSizes.length !== 1 ? 's' : ''} ▼
                    </div>
                  )}
                </div>
              </button>

              {selectedSuggestion?.id === s.id && s.servingSizes && (
                <div style={{ padding: "8px 12px", background: "#f9f9f9" }}>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                    Select a serving size:
                  </div>
                  {s.servingSizes.map((serving) => (
                    <button
                      key={serving.id}
                      onClick={() => submit(s.name, serving)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 8px",
                        marginBottom: 4,
                        border: "1px solid #ddd",
                        borderRadius: 6,
                        background: "white",
                        cursor: "pointer",
                        fontSize: 13,
                        color: "#333",
                      }}
                    >
                      <div style={{ fontWeight: serving.is_default ? "bold" : "normal" }}>
                        {serving.name} ({Number(serving.grams)}g)
                        {serving.is_default && " ⭐"}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
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

      <div style={{ marginTop: 14, minHeight: 28, color: "#333" }}>{message}</div>

      {/* Pending estimation queue */}
      {pendingQueue.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {pendingQueue.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                marginBottom: 6,
                borderRadius: 8,
                fontSize: 14,
                color: "#333",
                background:
                  item.status === "ready"
                    ? "#f0fdf0"
                    : item.status === "error"
                    ? "#fef2f2"
                    : "#f8f8f8",
                border: `1px solid ${
                  item.status === "ready"
                    ? "#bbf7d0"
                    : item.status === "error"
                    ? "#fecaca"
                    : "#e5e5e5"
                }`,
                transition: "all 0.3s ease",
              }}
            >
              {item.status === "pending" && (
                <span
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    border: "2px solid #ddd",
                    borderTopColor: "#666",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
              )}
              {item.status === "ready" && <span>✓</span>}
              {item.status === "error" && <span>✗</span>}
              <span style={{ flex: 1 }}>{item.rawText}</span>
              <span style={{ opacity: 0.6 }}>
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

      {/* Daily macros summary table */}
      {dailyLogs.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 20, marginBottom: 12, color: "#333" }}>Today</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
                  <th style={{ padding: "8px 4px", color: "#333" }}>Food</th>
                  <th style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>Kcal</th>
                  <th style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>Protein</th>
                  <th style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>Carbs</th>
                  <th style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>Fat</th>
                </tr>
              </thead>
              <tbody>
                {dailyLogs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: "1px solid #f2f2f2" }}>
                    <td style={{ padding: "8px 4px", color: "#333" }}>
                      {log.foodItem?.name ?? log.raw_text}
                    </td>
                    <td style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>
                      {log.kcal ? Math.round(Number(log.kcal)) : "—"}
                    </td>
                    <td style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>
                      {log.protein_g ? `${Math.round(Number(log.protein_g))}g` : "—"}
                    </td>
                    <td style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>
                      {log.carbs_g ? `${Math.round(Number(log.carbs_g))}g` : "—"}
                    </td>
                    <td style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>
                      {log.fat_g ? `${Math.round(Number(log.fat_g))}g` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #ddd", fontWeight: "bold" }}>
                  <td style={{ padding: "8px 4px", color: "#333" }}>Total</td>
                  <td style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>
                    {Math.round(totals.kcal)}
                  </td>
                  <td style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>
                    {Math.round(totals.protein)}g
                  </td>
                  <td style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>
                    {Math.round(totals.carbs)}g
                  </td>
                  <td style={{ padding: "8px 4px", textAlign: "right", color: "#333" }}>
                    {Math.round(totals.fat)}g
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
