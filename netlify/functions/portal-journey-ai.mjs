import {
  describeAuthError,
  requireClientOrStaffCaller,
} from './lib/requireAuth.mjs';
import {
  collectGeminiText,
  geminiJsonGenerationConfig,
  geminiModelCandidates,
  shouldTryNextGeminiModel,
} from './lib/geminiModels.mjs';

/**
 * Portal Customer Journey Builder AI.
 * POST {
 *   clientId,
 *   action: 'step' | 'final' | 'audit' | 'portrait',
 *   ...action-specific fields
 * }
 */

const stripCodeFences = (text) =>
  String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

function extractFirstJsonObject(text) {
  if (typeof text !== 'string') return null;
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
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

async function callGeminiJson({ apiKey, prompt, system, temperature = 0.65 }) {
  const configs = [
    geminiJsonGenerationConfig({
      temperature,
      topP: 0.95,
      maxOutputTokens: 8192,
    }),
    {
      temperature,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
    {
      temperature,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  ];

  let lastError = '';
  for (const model of geminiModelCandidates()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    for (const generationConfig of configs) {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      };
      if (system) {
        body.systemInstruction = { parts: [{ text: system }] };
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        lastError = data?.error?.message || data?.message || `HTTP ${resp.status}`;
        if (
          /thinking|unknown name|invalid.*argument|json|mime|schema/i.test(
            String(lastError),
          )
        ) {
          continue;
        }
        if (shouldTryNextGeminiModel(lastError)) break;
        continue;
      }

      const text = collectGeminiText(data);
      const parsed = extractFirstJsonObject(text);
      if (parsed) return parsed;
      lastError = 'Model returned unparseable JSON.';
    }
    if (lastError && shouldTryNextGeminiModel(lastError)) continue;
  }
  throw new Error(lastError || 'Gemini generation failed.');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrapePage(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  if (!parsed.hostname.includes('.')) throw new Error('Enter a valid website URL.');

  const resp = await fetch(parsed.toString(), {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; IgniteJourneyAudit/1.0; +https://ignitepm.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!resp.ok) throw new Error(`Could not fetch page (HTTP ${resp.status}).`);
  const html = await resp.text();
  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => `H${m[1]}: ${stripHtml(m[2])}`)
    .filter((h) => h.length > 5)
    .slice(0, 24)
    .join('\n');
  const text = stripHtml(html);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { url: parsed.toString(), headings, text, wordCount };
}

async function generatePortrait(apiKey, { businessType, idealCustomer, urgentDesire }) {
  const prompt = `A professional, high-quality, modern editorial portrait representing this ${businessType} target audience: ${idealCustomer}. They urgently desire: ${urgentDesire}. Clean professional background, studio lighting, commercial photography, authentic expression.`;
  const models = [
    String(process.env.IMAGEN_MODEL || '').trim(),
    'imagen-4.0-generate-001',
    'imagen-3.0-generate-002',
  ].filter(Boolean);

  let lastError = '';
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:predict?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1 },
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      lastError = data?.error?.message || `HTTP ${resp.status}`;
      continue;
    }
    const b64 =
      data.predictions?.[0]?.bytesBase64Encoded ||
      data.predictions?.[0]?.bytesBase64 ||
      null;
    if (b64) return `data:image/png;base64,${b64}`;
    lastError = 'No image bytes returned.';
  }
  throw new Error(lastError || 'Portrait generation unavailable.');
}

function buildStepPrompt({ stepTitle, businessType, inputs }) {
  const lines = Object.entries(inputs || {})
    .filter(([k]) => k !== 'businessType')
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  return `You are an expert Brand Strategist and world-class copywriter specializing in customer journey marketing.
Write the "${stepTitle}" section of a high-converting customer journey for a ${businessType} brand based on these raw inputs:

${lines}

Transform these inputs into compelling, emotionally resonant marketing copy. Do NOT just repeat them back.

Respond with JSON only:
{
  "mainCopy": "cohesive narrative paragraph for this section",
  "soundBites": ["2-3 short memorable sound bites"],
  "summary": "one-sentence summary"
}`;
}

function buildFinalPrompt(sections) {
  return `You are a Master Brand Strategist and Conversion Copywriter.
Review the following sections of a completed strategic customer journey framework:

${sections}

Synthesize this entire framework into three final deliverables.

Respond with JSON only:
{
  "tagline": "1-sentence catchy memorable tagline",
  "elevatorPitch": "3-sentence Problem -> Solution -> Success pitch",
  "cohesiveStory": "3-5 paragraph journey narrative from problem through plan to success"
}`;
}

function buildAuditPrompt({ framework, url, headings, text, wordCount }) {
  return `Act as an elite Conversion Rate Optimization (CRO) and SEO Strategist.
Analyze the live webpage against this Customer Journey Framework.

FRAMEWORK:
Tagline: ${framework.tagline}
Elevator Pitch: ${framework.elevatorPitch}
Journey Narrative: ${framework.cohesiveStory}

WEBPAGE URL: ${url}
Word Count: ${wordCount} (benchmark 800-1000 for topical authority)

HEADINGS:
${headings || 'No clear headings detected'}

PAGE TEXT SNIPPET:
${String(text || '').slice(0, 4500)}

Assess:
1. Customer Journey Flow (Problem -> Guide/Roadmap -> Transformation)
2. Heading Hierarchy and keyword clarity
3. Conversion depth / topical authority vs 800-1000 words

Respond with JSON only:
{
  "score": 0-100 integer,
  "summary": "2-sentence executive summary",
  "journeyFeedback": "narrative alignment feedback",
  "seoFeedback": "heading/keyword/length feedback",
  "actionItems": ["3-5 high-impact recommendations"]
}`;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const clientId = String(body.clientId || '').trim();
  const action = String(body.action || '').trim();
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'Missing client.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireClientOrStaffCaller(req.headers, clientId);
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

  try {
    if (action === 'step') {
      const stepTitle = String(body.stepTitle || 'Journey Step').trim();
      const businessType = String(body.businessType || 'B2B').trim() || 'B2B';
      const inputs = body.inputs && typeof body.inputs === 'object' ? body.inputs : {};
      const result = await callGeminiJson({
        apiKey,
        temperature: 0.7,
        system: 'Respond ONLY with valid JSON matching the requested shape.',
        prompt: buildStepPrompt({ stepTitle, businessType, inputs }),
      });
      if (!result?.mainCopy) throw new Error('Incomplete step output.');
      return new Response(
        JSON.stringify({
          mainCopy: String(result.mainCopy || ''),
          soundBites: Array.isArray(result.soundBites)
            ? result.soundBites.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 5)
            : [],
          summary: String(result.summary || ''),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'final') {
      const sections = String(body.sections || '').trim();
      if (!sections) throw new Error('Complete earlier journey steps first.');
      const result = await callGeminiJson({
        apiKey,
        temperature: 0.65,
        system: 'Respond ONLY with valid JSON matching the requested shape.',
        prompt: buildFinalPrompt(sections),
      });
      if (!result?.tagline || !result?.elevatorPitch || !result?.cohesiveStory) {
        throw new Error('Incomplete final deliverables.');
      }
      return new Response(
        JSON.stringify({
          tagline: String(result.tagline || ''),
          elevatorPitch: String(result.elevatorPitch || ''),
          cohesiveStory: String(result.cohesiveStory || ''),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'audit') {
      const framework = body.framework || {};
      if (!framework.tagline || !framework.cohesiveStory) {
        throw new Error('Generate final deliverables before auditing a page.');
      }
      const scraped = await scrapePage(body.url);
      const result = await callGeminiJson({
        apiKey,
        temperature: 0.4,
        system: 'Respond ONLY with valid JSON matching the requested shape.',
        prompt: buildAuditPrompt({
          framework,
          url: scraped.url,
          headings: scraped.headings,
          text: scraped.text,
          wordCount: scraped.wordCount,
        }),
      });
      const score = Math.max(0, Math.min(100, Number(result.score) || 0));
      return new Response(
        JSON.stringify({
          score,
          summary: String(result.summary || ''),
          journeyFeedback: String(result.journeyFeedback || ''),
          seoFeedback: String(result.seoFeedback || ''),
          actionItems: Array.isArray(result.actionItems)
            ? result.actionItems.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8)
            : [],
          wordCount: scraped.wordCount,
          url: scraped.url,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'portrait') {
      try {
        const imageUrl = await generatePortrait(apiKey, {
          businessType: String(body.businessType || 'B2B'),
          idealCustomer: String(body.idealCustomer || ''),
          urgentDesire: String(body.urgentDesire || ''),
        });
        return new Response(JSON.stringify({ imageUrl }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        // Soft-fail: portrait is optional polish, not required for the tool.
        return new Response(
          JSON.stringify({
            imageUrl: null,
            warning: err?.message || 'Portrait generation unavailable.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    return new Response(JSON.stringify({ error: 'Unknown action.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[portal-journey-ai]', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Journey AI failed.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
