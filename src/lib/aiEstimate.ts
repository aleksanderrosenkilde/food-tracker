export type MacroEstimate = {
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  confidence: number;       // 0..1
  assumptions?: string | null;
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    kcal: { type: "number", minimum: 0 },
    protein_g: { type: "number", minimum: 0 },
    carbs_g: { type: "number", minimum: 0 },
    fat_g: { type: "number", minimum: 0 },
    fiber_g: { type: ["number", "null"], minimum: 0 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    assumptions: { type: ["string", "null"] },
  },
  required: ["name", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "confidence", "assumptions"],
} as const;

async function estimateWithOllama(foodText: string): Promise<MacroEstimate> {
  const model = process.env.LOCAL_LLM_MODEL ?? "llama3.2:3b";
  const url = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/api/generate";

  const prompt =
    "You estimate nutrition for food logs.\n" +
    "Return ONLY JSON that matches the provided JSON schema.\n" +
    "Assume values are per 1 typical serving unless the text clearly specifies otherwise.\n" +
    "If details are missing (brand/portion), make a reasonable generic estimate and lower confidence.\n\n" +
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
      options: {
        temperature: 0.2,
        num_predict: 220,
      },
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
    return JSON.parse(text);
  } catch {
    throw new Error(`Ollama returned non-JSON: ${text}`);
  }
}

async function estimateWithOpenAI(foodText: string): Promise<MacroEstimate> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const prompt = `Estimate nutrition for this food. Return ONLY JSON matching this schema:
${JSON.stringify(schema)}

Important: If the text specifies a weight (like "200g chicken"), provide nutrition for that exact amount, not per 100g.

Food: ${foodText}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 300,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${error}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`OpenAI returned non-JSON: ${content}`);
  }
}

async function estimateWithOpenRouter(foodText: string): Promise<MacroEstimate> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const model = process.env.OPENROUTER_MODEL ?? "tngtech/deepseek-r1t2-chimera";

  const prompt = `Estimate nutrition for this food. Return ONLY JSON matching this schema:
${JSON.stringify(schema)}

Important: If the text specifies a weight (like "200g chicken"), provide nutrition for that exact amount, not per 100g.
Do NOT include any thinking tags or reasoning. Return ONLY the JSON object.

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
      provider: {
        data_collection: "deny",
      },
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${error}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter returned empty response");
  }

  // R1-based models may wrap output in <think>...</think> tags; strip them
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // Extract JSON from the response (may be wrapped in markdown code fences)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`OpenRouter returned non-JSON: ${cleaned}`);
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`OpenRouter returned invalid JSON: ${jsonMatch[0]}`);
  }
}

export async function estimateMacrosFromText(foodText: string): Promise<MacroEstimate> {
  const provider = process.env.AI_PROVIDER || "ollama";

  if (provider === "openrouter") {
    return estimateWithOpenRouter(foodText);
  } else if (provider === "openai") {
    return estimateWithOpenAI(foodText);
  } else {
    return estimateWithOllama(foodText);
  }
}
