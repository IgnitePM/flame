/* global process, exports */

const stripCodeFences = (text) =>
  String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const extractFirstJsonObject = (text) => {
  if (typeof text !== 'string') return null;
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  // Walk braces so nested objects / truncated tails are less likely to break.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
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
};

const collectCandidateText = (data) => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.length) {
    return parts
      .map((p) => {
        if (typeof p === 'string') return p;
        if (typeof p?.text === 'string') return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  const single =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.[0] ||
    '';
  return typeof single === 'string' ? single.trim() : '';
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const synthesizeSalesSummary = (parsed) => {
  const followUps = asArray(parsed?.followUps);
  const communications = asArray(parsed?.communications);
  const recommendations = asArray(parsed?.recommendations);
  const bits = [];
  if (followUps.length) {
    bits.push(
      `${followUps.length} deal${followUps.length === 1 ? '' : 's'} need follow-up.`,
    );
  }
  if (communications.length) {
    bits.push(
      `${communications.length} outreach draft${communications.length === 1 ? '' : 's'} ready.`,
    );
  }
  if (recommendations.length) {
    bits.push(
      `${recommendations.length} pipeline recommendation${recommendations.length === 1 ? '' : 's'}.`,
    );
  }
  return bits.join(' ') || 'Here is a sales coaching pass based on your open pipeline.';
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
    const kind = String(context.kind || 'ops');
    const scope = String(context.scope || 'overall');
    const viewer = context.viewer || {};
    const superAdmin = !!viewer.superAdmin;
    const period = String(context.period || '').trim(); // 'daily' | 'weekly' | '' (on-demand kiosk brief)
    const periodLabel =
      period === 'weekly' ? 'weekly' : period === 'daily' ? 'daily' : '';

    // Keep sales prompts smaller so responses are less likely to truncate mid-JSON.
    const salesContext = {
      kind: context.kind,
      scope: context.scope,
      viewer: context.viewer,
      stats: context.stats,
      stages: context.stages,
      followUpHints: Array.isArray(context.followUpHints)
        ? context.followUpHints.slice(0, 12)
        : [],
      deals: Array.isArray(context.deals)
        ? context.deals.slice(0, 40).map((d) => ({
            id: d.id,
            name: d.name,
            amount: d.amount,
            stage: d.stage,
            closed: d.closed,
            owner: d.owner,
            closeDate: d.closeDate,
            daysIdle: d.daysIdle,
            daysPastClose: d.daysPastClose,
            linked: d.linked,
            linkedType: d.linkedType,
            contactEmail: d.contactEmail || null,
            contactName: d.contactName || null,
            noteCount: d.noteCount,
            recentNotes: Array.isArray(d.recentNotes)
              ? d.recentNotes.slice(-1)
              : [],
          }))
        : [],
    };

    const salesPrompt = `
You are a sales coach for Ignite PM.

Using only the JSON pipeline context, help the salesperson decide what to do next.

Rules:
- Do not invent companies, emails, amounts, or conversations that are not in the context.
- Prefer open deals that are idle, past close date, sitting in Proposal Sent, or missing notes.
- followUps: 4–8 concrete items. Use the deal id from context when present.
- communications: 3–6 short outreach drafts (2–5 sentences). If contactEmail is missing, say they should add a contact first instead of faking an address.
- recommendations: 3–5 pipeline-level tips (stage hygiene, which deals to push or close out).
- urgency must be "high", "medium", or "low".
- Keep every string concise so the JSON stays complete.
- If the pipeline is empty or healthy, say so and return empty arrays.
- Respond with a single JSON object only (no markdown):
{
  "summary": "2–4 sentence briefing",
  "followUps": [{ "dealId": "", "dealName": "", "urgency": "high", "reason": "", "suggestedAction": "" }],
  "communications": [{ "dealId": "", "dealName": "", "subject": "", "message": "" }],
  "recommendations": [{ "title": "", "detail": "" }]
}

Context JSON:
${JSON.stringify(salesContext).slice(0, 80000)}
`.trim();

    const opsPrompt = `
You are an operations assistant for Ignite PM's time-tracker.

Write a concise ${periodLabel ? `${periodLabel} ` : ''}${scope === 'client' ? 'client-specific' : 'workspace-wide'} briefing for staff${periodLabel ? ` email digest` : ''}.

Rules:
- Use only the JSON context. Do not invent clients, hours, or people.
- Bullet the most important 4–8 points.
- Call out: overdue/upcoming tasks, notable task notes or @mentions, retainers ending soon, retainers well over budget.
${
  periodLabel === 'daily'
    ? '- This is a DAILY digest: emphasize what changed or needs attention today/tomorrow (due-soon items, anything urgent). Keep it tight.'
    : periodLabel === 'weekly'
      ? '- This is a WEEKLY digest: give a broader overview of the week — retainer burn across clients, patterns in timesheets, and what to plan for next week.'
      : ''
}
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

    const prompt = kind === 'sales' ? salesPrompt : opsPrompt;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: kind === 'sales' ? 0.35 : 0.3,
        topP: 0.9,
        maxOutputTokens: kind === 'sales' ? 4096 : 900,
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

    const finishReason = String(data?.candidates?.[0]?.finishReason || '');
    const blockReason = String(
      data?.promptFeedback?.blockReason ||
        data?.candidates?.[0]?.finishMessage ||
        '',
    );
    const text = collectCandidateText(data);
    const parsed = text ? extractFirstJsonObject(text) : null;

    if (kind === 'sales') {
      const followUps = asArray(parsed?.followUps);
      const communications = asArray(parsed?.communications);
      const recommendations = asArray(parsed?.recommendations);
      let summary = String(parsed?.summary || parsed?.text || '').trim();
      if (!summary && (followUps.length || communications.length || recommendations.length)) {
        summary = synthesizeSalesSummary(parsed);
      }
      if (!summary && text) {
        // Last resort: model returned prose instead of structured JSON.
        summary = stripCodeFences(text).slice(0, 1200);
      }
      if (!summary) {
        const detail = [
          finishReason && finishReason !== 'STOP' ? `finishReason=${finishReason}` : '',
          blockReason ? `blockReason=${blockReason}` : '',
          !data?.candidates?.length ? 'no candidates' : '',
        ]
          .filter(Boolean)
          .join('; ');
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: detail
              ? `Gemini returned an empty sales coach response (${detail}).`
              : 'Gemini returned an empty sales coach response.',
          }),
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary,
          scope,
          kind: 'sales',
          followUps,
          communications,
          recommendations,
          generatedAt: Date.now(),
        }),
      };
    }

    const summary = String(parsed?.summary || parsed?.text || '').trim();
    if (!summary) {
      const detail = [
        finishReason && finishReason !== 'STOP' ? `finishReason=${finishReason}` : '',
        blockReason ? `blockReason=${blockReason}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: detail
            ? `Gemini returned an empty summary (${detail}).`
            : 'Gemini returned an empty summary.',
        }),
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
