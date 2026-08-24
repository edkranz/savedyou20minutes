/**
 * OpenAI Chat Completions with a strict json_schema response format.
 *
 * Strict mode requires every property to be listed in `required` and
 * `additionalProperties: false` on each object — which the shared schema
 * already satisfies, except that it uses `minItems`/`maxItems`/`minimum`/
 * `maximum`, which strict mode rejects. `relaxForStrict` strips those.
 */
export const MODELS = [
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini — fast, cheap' },
  { id: 'gpt-4.1', label: 'gpt-4.1 — sharper' },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
];

export const DEFAULT_MODEL = 'gpt-4.1-mini';

/** Strict json_schema rejects numeric/array bounds. Drop them, keep the shape. */
function relaxForStrict(node) {
  if (Array.isArray(node)) return node.map(relaxForStrict);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (['minItems', 'maxItems', 'minimum', 'maximum'].includes(k)) continue;
    out[k] = relaxForStrict(v);
  }
  return out;
}

export async function summarise({ apiKey, model, system, user, schema, signal }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_completion_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'report', strict: true, schema: relaxForStrict(schema) },
      },
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch { /* non-JSON */ }
    if (res.status === 401) throw new Error('OpenAI rejected the API key (401). Check it in settings.');
    if (res.status === 429) throw new Error('OpenAI rate limit or quota hit (429).');
    throw new Error(`OpenAI error ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned an empty result. Try again.');
  return JSON.parse(text);
}
