import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';

/**
 * Admin/billing: enrich a client company profile from a website URL via Gemini.
 * Fetches a homepage text snippet for grounding, then asks Gemini for structured CRM fields
 * (phone, about, address, Google Business Profile, socials, primary contact hints).
 *
 * POST { website, companyName? }
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

function collectCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.length) {
    return parts
      .map((p) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function normalizeWebsite(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes('.')) return '';
    return u.toString();
  } catch {
    return '';
  }
}

function htmlToSnippet(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14000);
}

async function fetchSiteSnippet(website) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(website, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'IgnitePM-CRM-Enrichment/1.0 (+https://ignitetimetracker.netlify.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) return { ok: false, status: resp.status, snippet: '' };
    const ctype = String(resp.headers.get('content-type') || '');
    if (!/html|text|xml/i.test(ctype) && ctype) {
      return { ok: false, status: resp.status, snippet: '' };
    }
    const html = await resp.text();
    return { ok: true, status: resp.status, snippet: htmlToSnippet(html), finalUrl: resp.url || website };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), snippet: '' };
  } finally {
    clearTimeout(timer);
  }
}

function cleanSuggestion(parsed) {
  const str = (v) => String(v ?? '').trim();
  const pc = parsed?.primaryContact && typeof parsed.primaryContact === 'object' ? parsed.primaryContact : {};
  return {
    name: str(parsed?.name),
    website: str(parsed?.website),
    phone: str(parsed?.phone),
    companyDescription: str(parsed?.companyDescription || parsed?.about),
    industry: str(parsed?.industry),
    address: str(parsed?.address),
    city: str(parsed?.city),
    region: str(parsed?.region || parsed?.state || parsed?.province),
    postalCode: str(parsed?.postalCode || parsed?.zip),
    country: str(parsed?.country),
    googleBusinessProfileUrl: str(
      parsed?.googleBusinessProfileUrl || parsed?.gmbUrl || parsed?.googleMapsUrl,
    ),
    linkedinUrl: str(parsed?.linkedinUrl),
    facebookUrl: str(parsed?.facebookUrl),
    instagramUrl: str(parsed?.instagramUrl),
    twitterUrl: str(parsed?.twitterUrl || parsed?.xUrl),
    primaryContact: {
      name: str(pc.name),
      email: str(pc.email),
      phone: str(pc.phone),
      title: str(pc.title),
    },
    confidenceNotes: str(parsed?.confidenceNotes),
  };
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireStaffCaller(req.headers, { roles: ['admin', 'billing'] });
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
        error: 'Server misconfigured: missing GEMINI_API_KEY in Netlify environment variables.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const website = normalizeWebsite(body?.website);
  const companyName = String(body?.companyName || '').trim();
  if (!website) {
    return new Response(JSON.stringify({ error: 'Enter a valid website URL first.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const site = await fetchSiteSnippet(website);

  const prompt = `
You enrich CRM company records for Ignite PM (like HubSpot company enrichment).

Given a company website${companyName ? ` and known name "${companyName}"` : ''}, return the best-known public business profile as JSON.

Rules:
- Prefer facts from the homepage snippet when present.
- You may use widely known public information about this business (Google Business Profile / Maps listing, LinkedIn company page, social profiles, industry, phone, address).
- Do NOT invent phone numbers, emails, or profile URLs. If unsure, use an empty string.
- googleBusinessProfileUrl should be a Google Maps / Google Business Profile share link when you can identify the listing; otherwise "".
- companyDescription: 1–3 neutral sentences about what the company does.
- primaryContact: only if a clear public founder/owner/contact is on the site; otherwise empty strings.
- Respond with a single JSON object only (no markdown):
{
  "name": "",
  "website": "",
  "phone": "",
  "companyDescription": "",
  "industry": "",
  "address": "",
  "city": "",
  "region": "",
  "postalCode": "",
  "country": "",
  "googleBusinessProfileUrl": "",
  "linkedinUrl": "",
  "facebookUrl": "",
  "instagramUrl": "",
  "twitterUrl": "",
  "primaryContact": { "name": "", "email": "", "phone": "", "title": "" },
  "confidenceNotes": "short note on what was found vs guessed"
}

Website: ${website}
${site.finalUrl && site.finalUrl !== website ? `Final URL after redirects: ${site.finalUrl}` : ''}
Homepage text snippet (${site.ok ? 'fetched' : 'fetch failed'}):
${site.snippet || '(unavailable — enrich from public knowledge of this domain only; leave unknowns empty)'}
`.trim();

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  };

  // Prefer models that support Google Search grounding when available.
  const withSearch = {
    ...requestBody,
    tools: [{ google_search: {} }],
  };

  const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const modelCandidates = Array.from(
    new Set([
      preferredModel,
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
    ]),
  );

  let data = null;
  let resp = null;
  let lastError = null;
  let usedSearch = false;

  for (const model of modelCandidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    // Try with Google Search grounding first; fall back without tools.
    for (const bodyVariant of [withSearch, requestBody]) {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyVariant),
      });
      data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        usedSearch = bodyVariant === withSearch;
        lastError = null;
        break;
      }
      lastError = data?.error?.message || data?.message || 'Gemini request failed';
      const msg = String(lastError || '').toLowerCase();
      const toolIssue =
        msg.includes('tool') ||
        msg.includes('google_search') ||
        msg.includes('not supported') ||
        msg.includes('unknown');
      if (bodyVariant === withSearch && toolIssue) continue;
      break;
    }
    if (resp?.ok) break;

    const msg = String(lastError || '').toLowerCase();
    const shouldTryNext =
      msg.includes('not found') ||
      msg.includes('not supported') ||
      msg.includes('unsupported') ||
      msg.includes('no longer available') ||
      msg.includes('deprecated');
    if (!shouldTryNext) {
      return new Response(JSON.stringify({ error: lastError }), {
        status: resp?.status || 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!resp?.ok) {
    return new Response(
      JSON.stringify({ error: lastError || 'No compatible Gemini model was available.' }),
      { status: resp?.status || 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const text = collectCandidateText(data);
  const parsed = text ? extractFirstJsonObject(text) : null;
  if (!parsed) {
    return new Response(
      JSON.stringify({ error: 'Could not parse enrichment result. Try again.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const suggestion = cleanSuggestion(parsed);
  if (!suggestion.website) suggestion.website = website;

  return new Response(
    JSON.stringify({
      ok: true,
      suggestion,
      meta: {
        websiteFetched: Boolean(site.ok && site.snippet),
        usedGoogleSearch: usedSearch,
        confidenceNotes: suggestion.confidenceNotes,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
