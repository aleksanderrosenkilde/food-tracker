export type MacroEstimate = {
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  /** Total grams consumed for the amount as written (e.g. 850 for "5 chicken breasts").
   *  Used to normalise to per-100g for FoodItem storage.
   *  null when the food text already specifies an exact weight (parser handles it). */
  estimated_grams: number | null;
  confidence: number;       // 0..1
  assumptions?: string | null;
};

export type EstimationResult = {
  estimate: MacroEstimate;
  ai_model: string;
  ai_prompt: string;
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name:             { type: "string" },
    kcal:             { type: "number", minimum: 0 },
    protein_g:        { type: "number", minimum: 0 },
    carbs_g:          { type: "number", minimum: 0 },
    fat_g:            { type: "number", minimum: 0 },
    fiber_g:          { type: ["number", "null"], minimum: 0 },
    estimated_grams:  { type: ["number", "null"], minimum: 0 },
    confidence:       { type: "number", minimum: 0, maximum: 1 },
    assumptions:      { type: ["string", "null"] },
  },
  required: [
    "name", "kcal", "protein_g", "carbs_g", "fat_g",
    "fiber_g", "estimated_grams", "confidence", "assumptions",
  ],
} as const;

const SYSTEM_INSTRUCTIONS = `You estimate nutrition for food log entries.
Return ONLY JSON that matches the provided JSON schema. No extra text.

Rules:
- kcal, protein_g, carbs_g, fat_g: total for the FULL AMOUNT as written.
  (e.g. "5 chicken breasts" → total for all 5, not per breast)
- estimated_grams: your best estimate of the total weight in grams consumed.
  Examples: "5 chicken breasts" → ~850, "1 glass of milk" → ~250,
  "200g chicken" → 200 (exact), "3 cups cooked rice" → ~585.
  Return null ONLY when the input already specifies exact grams (e.g. "200g chicken").
- name: short, clean food name without the quantity (e.g. "chicken breast").
- If details are missing (brand/portion), make a reasonable generic estimate
  and set confidence accordingly.`;

// ── Ollama ────────────────────────────────────────────────────────────────────

async function estimateWithOllama(foodText: string): Promise<EstimationResult> {
  const model = process.env.LOCAL_LLM_MODEL ?? "llama3.2:3b";
  const url = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/api/generate";

  const prompt =
    SYSTEM_INSTRUCTIONS + "\n\n" +
    `JSON schema: ${JSON.stringify(schema)}\n\n` +
    `Food: ${foodText}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: schema,
      options: { temperature: 0.2, num_predict: 260 },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama error ${res.status}: ${t}`);
  }

  const data = await res.json();
  const text = String(data.response ?? "").trim();
  if (!text) throw new Error("Ollama returned empty response");

  try {
    return { estimate: JSON.parse(text), ai_model: model, ai_prompt: prompt };
  } catch {
    throw new Error(`Ollama returned non-JSON: ${text}`);
  }
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function estimateWithOpenAI(foodText: string): Promise<EstimationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const model = "gpt-3.5-turbo";
  const prompt = `${SYSTEM_INSTRUCTIONS}

JSON schema:
${JSON.stringify(schema, null, 2)}

Food: ${foodText}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 350,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${error}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI returned empty response");

  try {
    return { estimate: JSON.parse(content), ai_model: model, ai_prompt: prompt };
  } catch {
    throw new Error(`OpenAI returned non-JSON: ${content}`);
  }
}

// ── OpenRouter ────────────────────────────────────────────────────────────────

async function estimateWithOpenRouter(foodText: string): Promise<EstimationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const model = process.env.OPENROUTER_MODEL ?? "google/gemma-3-27b-it:free";

  const prompt = `${SYSTEM_INSTRUCTIONS}
Do NOT include any thinking tags or reasoning. Return ONLY the JSON object.

JSON schema:
${JSON.stringify(schema, null, 2)}

Food: ${foodText}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 1000,
      provider: { data_collection: "allow" },
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${error}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenRouter returned empty response");

  // Strip <think> tags from reasoning models
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`OpenRouter returned non-JSON: ${cleaned}`);

  try {
    return { estimate: JSON.parse(jsonMatch[0]), ai_model: model, ai_prompt: prompt };
  } catch {
    throw new Error(`OpenRouter returned invalid JSON: ${jsonMatch[0]}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function estimateMacrosFromText(foodText: string): Promise<EstimationResult> {
  const provider = process.env.AI_PROVIDER || "ollama";

  if (provider === "openrouter") return estimateWithOpenRouter(foodText);
  if (provider === "openai")    return estimateWithOpenAI(foodText);
  return estimateWithOllama(foodText);
}
