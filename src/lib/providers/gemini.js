/**
 * Google Gemini generateContent with a responseSchema.
 *
 * Gemini's schema dialect is OpenAPI-ish, not JSON Schema: it wants `type` in
 * upper case, has no `additionalProperties`, and — critically — object key
 * order in the response follows `propertyOrdering`, not the `properties` map.
 */
export const MODELS = [
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash — fast, cheap' },
  { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro — sharper' },
];

export const DEFAULT_MODEL = 'gemini-2.5-flash';

function toGeminiSchema(node) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  if (node.type) out.type = String(node.type).toUpperCase();
  if (node.type === 'integer') out.type = 'INTEGER';
  if (node.description) out.description = node.description;
  if (node.enum) out.enum = node.enum;
  if (node.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(node.properties)) out.properties[k] = toGeminiSchema(v);
    out.propertyOrdering = Object.keys(node.properties);
  }
  if (node.items) out.items = toGeminiSchema(node.items);
  if (node.required) out.required = node.required;
  return out;
}

export async function summarise({ apiKey, model, system, user, schema, signal }) {
  const id = model || DEFAULT_MODEL;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
          maxOutputTokens: 4000,
        },
      }),
    }
  );

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch { /* non-JSON */ }
    if (res.status === 400 && /API key/i.test(detail)) {
      throw new Error('Google rejected the API key. Check it in settings.');
    }
    if (res.status === 429) throw new Error('Gemini rate limit or quota hit (429).');
    throw new Error(`Gemini error ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text.trim()) throw new Error('Gemini returned an empty result. Try again.');
  return JSON.parse(text);
}
