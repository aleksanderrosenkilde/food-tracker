"use client";

import { useEffect, useRef, useState } from "react";

type FoodLog = {
  id: string;
  status: "pending" | "ready" | "error";
  kcal?: string;
  protein_g?: string;
  carbs_g?: string;
  fat_g?: string;
  error_msg?: string;
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

export default function Home() {
  const [text, setText] = useState("");
  const [amount, setAmount] = useState(1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

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
  // Poll background estimation
  // -------------------------------------------------------
  async function pollLog(id: string) {
    try {
      const res = await fetch(`/api/log/${id}`);
      const data = await res.json();
      const log: FoodLog = data.log;

      if (log.status === "ready") {
        setMessage(
          `Updated: ${Math.round(Number(log.kcal))} kcal — ${log.foodItem?.name ?? ""}`
        );
        setBusy(false);
        return;
      }

      if (log.status === "error") {
        setMessage(`Estimation failed: ${log.error_msg}`);
        setBusy(false);
        return;
      }

      setTimeout(() => pollLog(id), 700);
    } catch {
      setTimeout(() => pollLog(id), 1000);
    }
  }

  // -------------------------------------------------------
  // Submit food
  // -------------------------------------------------------
  async function submit(customText?: string, servingSize?: ServingSize) {
    const payloadText = (customText ?? text).trim();
    if (!payloadText) return;

    setBusy(true);
    setMessage("Logging…");

    // Build the final text with serving size if specified
    let finalText = payloadText;
    if (servingSize) {
      finalText = `${amount} ${servingSize.name} ${payloadText}`;
    }

    try {
      const res = await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: finalText,
          amount,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "Failed");

      // Known food → instant
      if (data.status === "ready") {
        const servingInfo = data.servingUsed && data.servingUsed !== "serving"
          ? ` (${data.servingUsed})`
          : "";
        setMessage(
          `Logged: ${Math.round(Number(data.log.kcal))} kcal — ${data.log.foodItem?.name ?? ""}${servingInfo}`
        );
        setBusy(false);
      }

      // Unknown food → background
      if (data.status === "pending") {
        setMessage("Logged ✓ Estimating macros…");
        pollLog(data.log.id);
      }

      setText("");
      setSuggestions([]);
      setSelectedSuggestion(null);
    } catch (e: any) {
      setMessage(e.message || "Error");
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, marginBottom: 16 }}>Food tracker</h1>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="What did you eat? (e.g., '1 medium apple', '200g chicken', '2 cups rice')"
          style={{
            flex: 1,
            padding: 14,
            fontSize: 18,
            borderRadius: 12,
            border: "1px solid #ddd",
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

      <div style={{ marginTop: 14, minHeight: 28 }}>{message}</div>
    </main>
  );
}
