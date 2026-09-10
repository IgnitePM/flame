import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';
import {
  collectGeminiText,
  geminiJsonGenerationConfig,
  geminiModelCandidates,
  shouldTryNextGeminiModel,
} from './lib/geminiModels.mjs';

/**
 * Staff: extract grouped to-dos from a meeting transcript via Gemini.
 * POST { transcript, clientName?, retainerCategories?, generalCategoryLabel? }
 */

function extractFirstJsonObject(text) {
  if (typeof text !== 'string') return null;
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }
  const start = cleaned.indexOf('{');
  if (start === -1) {
    // Some models return a bare array
    const arrStart = cleaned.indexOf('[');
    if (arrStart === -1) return null;
    try {
      const arr = JSON.parse(cleaned.slice(arrStart));
      if (Array.isArray(arr)) return { todos: arr };
    } catch {
      return null;
    }
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeTodosShape(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return { todos: parsed };
  if (Array.isArray(parsed.todos)) return parsed;
  if (Array.isArray(parsed.items)) return { todos: parsed.items };
  if (Array.isArray(parsed.actionItems)) return { todos: parsed.actionItems };
  return null;
}

async function callGemini({ apiKey, model, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const configs = [
    geminiJsonGenerationConfig({
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 8192,
    }),
    {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
    {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 8192,
    },
  ];

  let last = null;
  for (const generationConfig of configs) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    last = { resp, data };
    if (!resp.ok) {
      const errMsg = data?.error?.message || data?.message || '';
      // Config rejected — try next generationConfig shape on same model.
      if (/thinking|unknown name|invalid.*argument|json|mime|schema/i.test(String(errMsg))) {
        continue;
      }
      return last;
    }
    const text = collectGeminiText(data);
    if (text) return last;
  }
  return last;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireStaffCaller(req.headers);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          'Server misconfigured: missing GEMINI_API_KEY in Netlify environment variables.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const transcript = String(payload.transcript || '').trim();
  const clientName = String(payload.clientName || '').trim().slice(0, 200);
  const retainerCategories = Array.isArray(payload.retainerCategories)
    ? payload.retainerCategories
        .slice(0, 40)
        .map((c) => String(c).slice(0, 120))
        .filter(Boolean)
    : [];
  const generalCategoryLabel = String(
    payload.generalCategoryLabel || 'General / Unclassified',
  )
    .trim()
    .slice(0, 120);

  if (!transcript) {
    return new Response(JSON.stringify({ error: 'Missing transcript' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cap keeps cost bounded; default ~3h of pasted notes.
  const maxTranscriptChars = Number(process.env.GEMINI_MAX_TRANSCRIPT_CHARS) || 350000;
  const trimmedTranscript =
    transcript.length > maxTranscriptChars
      ? transcript.slice(0, maxTranscriptChars)
      : transcript;

  const allowedCategories = Array.from(
    new Set([...retainerCategories, generalCategoryLabel]),
  );

  const prompt = `
You are an assistant that extracts structured action items from meeting transcripts.

Task:
1) Read the meeting transcript.
2) Extract action items mentioned as things that must be done (tasks, follow-ups, next steps).
3) Group similar action items together to reduce the number of to-do entries.
   - Each group should be a single actionable to-do text that combines the shared intent.
4) Assign each grouped to-do to exactly ONE category from the allowed categories.
   - Pick the closest match by semantics.
   - If unsure, assign to: "${generalCategoryLabel}".

Output requirements:
- Respond with JSON only, no markdown.
- JSON shape:
{
  "todos": [
    { "text": "string", "category": "one of allowed categories" }
  ]
}
- "text" should be a concise imperative to-do sentence.
- Return at most 15 to-do groups.
- If there are no action items, return {"todos":[]}.

Allowed categories:
${allowedCategories.map((c) => `- ${c}`).join('\n')}

Client context (may help wording):
${clientName || '(unknown)'}

Meeting transcript (may contain irrelevant chatter):
"""
${trimmedTranscript}
"""
`.trim();

  let data = null;
  let lastError = null;
  let usedModel = null;

  for (const model of geminiModelCandidates()) {
    try {
      const { resp, data: nextData } = await callGemini({ apiKey, model, prompt });
      data = nextData;
      if (resp.ok) {
        usedModel = model;
        break;
      }
      lastError = nextData?.error?.message || nextData?.message || 'Gemini request failed';
      if (shouldTryNextGeminiModel(lastError)) continue;
      return new Response(JSON.stringify({ error: lastError }), {
        status: resp.status || 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      lastError = err?.message || String(err);
      console.warn('[gemini-extract-todos] model failed:', model, lastError);
      continue;
    }
  }

  if (!usedModel) {
    return new Response(
      JSON.stringify({
        error:
          lastError ||
          'No compatible Gemini model was available for generateContent.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const text = collectGeminiText(data);
  const parsed = normalizeTodosShape(extractFirstJsonObject(text));

  if (!parsed || !Array.isArray(parsed.todos)) {
    console.error(
      '[gemini-extract-todos] unparseable model output:',
      typeof text === 'string' ? text.slice(0, 2000) : text,
      'finishReason=',
      data?.candidates?.[0]?.finishReason,
      'model=',
      usedModel,
    );
    return new Response(
      JSON.stringify({
        error: 'The AI returned an unexpected response. Try again.',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const normalizeCategory = (raw) => {
    const cat = String(raw || '').trim();
    if (!cat) return generalCategoryLabel;
    if (allowedCategories.includes(cat)) return cat;
    const lower = cat.toLowerCase();
    const hit = allowedCategories.find((c) => c.toLowerCase() === lower);
    if (hit) return hit;
    // Fuzzy: category contains or is contained by an allowed label
    const soft = allowedCategories.find(
      (c) => lower.includes(c.toLowerCase()) || c.toLowerCase().includes(lower),
    );
    return soft || generalCategoryLabel;
  };

  const todos = parsed.todos
    .map((t) => ({
      text: String(t?.text || t?.todo || t?.task || '').trim(),
      category: normalizeCategory(t?.category || t?.retainerCategory),
    }))
    .filter((t) => t.text)
    .slice(0, 15);

  return new Response(JSON.stringify({ todos, model: usedModel }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
