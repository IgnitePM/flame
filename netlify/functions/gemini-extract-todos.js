const extractFirstJsonObject = (text) => {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod && event.httpMethod.toUpperCase() !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error:
            'Server misconfigured: missing GEMINI_API_KEY in Netlify environment variables.',
        }),
      };
    }

    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    const payload = JSON.parse(event.body || '{}');
    const transcript = String(payload.transcript || '').trim();
    const clientName = String(payload.clientName || '').trim();
    const retainerCategories = Array.isArray(payload.retainerCategories)
      ? payload.retainerCategories.map((c) => String(c)).filter(Boolean)
      : [];
    const generalCategoryLabel = String(
      payload.generalCategoryLabel || 'General / Unclassified',
    ).trim();

    if (!transcript) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing transcript' }),
      };
    }

    // Basic input protection so the model doesn't get unbounded text.
    const trimmedTranscript =
      transcript.length > 30000 ? transcript.slice(0, 30000) : transcript;

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

Allowed categories:
${allowedCategories.map((c) => `- ${c}`).join('\n')}

Client context (may help wording):
${clientName || '(unknown)'}

Meeting transcript (may contain irrelevant chatter):
"""
${trimmedTranscript}
"""
`.trim();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
      },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return {
        statusCode: resp.status || 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error:
            data?.error?.message ||
            data?.message ||
            'Gemini request failed',
        }),
      };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.content?.parts?.[0] ||
      '';

    let parsed = null;
    if (typeof text === 'object') {
      parsed = text;
    } else {
      parsed = extractFirstJsonObject(text);
    }

    if (!parsed || !Array.isArray(parsed.todos)) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Gemini returned an unexpected response format.',
          raw: typeof text === 'string' ? text.slice(0, 1000) : text,
        }),
      };
    }

    const todos = parsed.todos
      .map((t) => ({
        text: String(t.text || '').trim(),
        category: String(t.category || '').trim(),
      }))
      .filter((t) => t.text && allowedCategories.includes(t.category))
      .slice(0, 15);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todos }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || String(err) }),
    };
  }
};

