/**
 * Anthropic Messages API, called directly over fetch.
 *
 * Structure comes from forced tool use: a single `report` tool with the result
 * schema as its input_schema, `strict: true` so the input validates exactly,
 * and tool_choice pinned to it so the model cannot answer in prose instead.
 *
 * `anthropic-dangerous-direct-browser-access` is what allows a browser-origin
 * request at all. It is safe here in the way it is not on a web page: the key
 * lives in extension storage and the request is made from the background
 * script, so no page script — YouTube's included — can read either.
 */
export const MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest, cheapest' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced' },
  { id: 'claude-opus-5', label: 'Opus 5 — sharpest, priciest' },
];

export const DEFAULT_MODEL = 'claude-haiku-4-5';

export async function summarise({ apiKey, model, system, user, schema, signal }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [
        {
          name: 'report',
          description: 'Report the verdict on whether this video is worth watching.',
          input_schema: schema,
          strict: true,
        },
      ],
      tool_choice: { type: 'tool', name: 'report' },
    }),
  });

  if (!res.ok) throw new Error(await describeError(res, 'Anthropic'));

  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  if (!block) {
    throw new Error('Anthropic returned no structured result. Try again.');
  }
  return block.input;
}

async function describeError(res, name) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401) return `${name} rejected the API key (401). Check it in settings.`;
  if (res.status === 429) return `${name} rate limit hit (429). Wait a moment and retry.`;
  if (res.status === 400 && /credit|balance/i.test(detail)) {
    return `${name}: ${detail}`;
  }
  return `${name} error ${res.status}${detail ? `: ${detail}` : ''}`;
}
