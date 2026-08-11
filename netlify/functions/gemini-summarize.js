/* global process, exports */

const extractFirstJsonObject = (text) => {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
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

    const payload = JSON.parse(event.body || '{}');
    const context = payload.context || payload;
    const scope = String(context.scope || 'overall');
    const viewer = context.viewer || {};
    const superAdmin = !!viewer.superAdmin;

    const prompt = `
You are an operations assistant for Ignite PM's time-tracker.

Write a concise ${scope === 'client' ? 'client-specific' : 'workspace-wide'} briefing for staff.

Rules:
- Use only the JSON context. Do not invent clients, hours, or people.
- Bullet the most important 4–8 points.
- Call out: overdue/upcoming tasks, notable task notes or @mentions, retainers ending soon, retainers well over budget.
- Timesheet guidance:
  ${
    superAdmin
      ? '- You may discuss every employee\'s timesheets: forgotten clock-outs, still-open shifts, unusually long days, or one retainer eating most of someone\'s time.'
      : '- Only discuss THIS viewer\'s own timesheets (forgot to clock out, still-open shift, or their own unusually long day). Do not name other employees\' hours.'
  }
- If nothing notable, say so in one sentence.
- Respond with JSON only:
{ "summary": "markdown-ish plain text with short bullets" }

Context JSON:
${JSON.stringify(context).slice(0, 120000)}
`.trim();

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.9,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
      },
    };

    const preferredModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const modelCandidates = Array.from(
      new Set([
        preferredModel,
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash',
      ]),
    );

    let data = null;
    let resp = null;
    let lastError = null;

    for (const model of modelCandidates) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model,
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      data = await resp.json().catch(() => ({}));
      if (resp.ok) break;
      lastError = data?.error?.message || data?.message || 'Gemini request failed';
      const msg = String(lastError || '').toLowerCase();
      const shouldTryNext =
        msg.includes('not found') ||
        msg.includes('not supported') ||
        msg.includes('unsupported') ||
        msg.includes('no longer available') ||
        msg.includes('deprecated');
      if (!shouldTryNext) {
        return {
          statusCode: resp.status || 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: lastError }),
        };
      }
    }

    if (!resp?.ok) {
      return {
        statusCode: resp?.status || 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: lastError || 'No compatible Gemini model was available.',
        }),
      };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.content?.parts?.[0] ||
      '';
    const parsed = typeof text === 'object' ? text : extractFirstJsonObject(text);
    const summary = String(parsed?.summary || parsed?.text || '').trim();
    if (!summary) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Gemini returned an empty summary.' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary,
        scope,
        generatedAt: Date.now(),
      }),
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
