import { describeAuthError, requireStaffCaller } from './lib/requireAuth.mjs';

/**
 * Admin/billing: enrich a client company profile from its website.
 * Grounded in fetched page HTML (home + about/contact) with deterministic
 * extraction first; Gemini only summarizes/structures that content — no web search.
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
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const bits = [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p === 'string' && p.trim()) bits.push(p.trim());
      else if (typeof p?.text === 'string' && p.text.trim()) bits.push(p.text.trim());
    }
  }
  return bits.join('\n').trim();
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

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function metaContent(html, names) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      'i',
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      'i',
    );
    const m = html.match(re) || html.match(re2);
    if (m?.[1]) return decodeHtmlEntities(m[1]).trim();
  }
  return '';
}

function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function uniq(list) {
  const out = [];
  const seen = new Set();
  for (const v of list) {
    const s = String(v || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function extractJsonLdOrganizations(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const raw = JSON.parse(m[1].trim());
      const nodes = Array.isArray(raw) ? raw : raw?.['@graph'] ? raw['@graph'] : [raw];
      for (const node of nodes) {
        const type = node?.['@type'];
        const types = Array.isArray(type) ? type : [type];
        if (types.some((t) => /Organization|LocalBusiness|Corporation|Store/i.test(String(t || '')))) {
          blocks.push(node);
        }
      }
    } catch {
      /* ignore bad json-ld */
    }
  }
  return blocks;
}

function extractSocials(html) {
  const hrefs = [...String(html || '').matchAll(/href=["']([^"']+)["']/gi)].map((x) => x[1]);
  const pick = (re) => {
    const hit = hrefs.find((h) => re.test(h));
    return hit ? hit.split(/[?#]/)[0] : '';
  };
  return {
    linkedinUrl: pick(/linkedin\.com\/(company|in|school)\//i),
    facebookUrl: pick(/facebook\.com\//i),
    instagramUrl: pick(/instagram\.com\//i),
    twitterUrl: pick(/(?:twitter\.com|x\.com)\//i),
    googleBusinessProfileUrl:
      pick(/google\.[^/]+\/maps/i) ||
      pick(/maps\.app\.goo\.gl\//i) ||
      pick(/g\.page\//i) ||
      pick(/business\.google\.com\//i),
  };
}

function extractPhones(text) {
  const matches = String(text || '').match(
    /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g,
  );
  return uniq(matches || []).slice(0, 5);
}

function extractEmails(html, siteHost) {
  const raw = [
    ...String(html || '').matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi),
  ].map((m) => m[1].toLowerCase());
  const fromText = [
    ...String(html || '').matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g),
  ].map((m) => m[0].toLowerCase());
  const all = uniq([...raw, ...fromText]).filter((e) => {
    if (/example\.com|sentry\.|wixpress|cloudflare|schema\.org/i.test(e)) return false;
    // Prefer same-domain emails when we know the host
    if (siteHost) {
      const d = e.split('@')[1] || '';
      if (d === siteHost || d.endsWith(`.${siteHost}`)) return true;
      // still allow other emails found via mailto on the site
      return raw.includes(e);
    }
    return true;
  });
  return all.slice(0, 8);
}

function registrableHint(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return h;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; IgnitePM-CRM-Enrichment/1.1; +https://ignitetimetracker.netlify.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) return { ok: false, status: resp.status, html: '', finalUrl: url };
    const ctype = String(resp.headers.get('content-type') || '');
    if (ctype && !/html|text|xml/i.test(ctype)) {
      return { ok: false, status: resp.status, html: '', finalUrl: resp.url || url };
    }
    const html = await resp.text();
    return { ok: true, status: resp.status, html, finalUrl: resp.url || url };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), html: '', finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

async function gatherSiteCorpus(website) {
  const home = await fetchHtml(website);
  if (!home.ok || !home.html) {
    return {
      ok: false,
      error: home.error || `Could not fetch website (HTTP ${home.status || '?'}).`,
      pages: [],
      extracted: null,
    };
  }

  let host = '';
  try {
    host = new URL(home.finalUrl || website).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  const origin = (() => {
    try {
      return new URL(home.finalUrl || website).origin;
    } catch {
      return '';
    }
  })();

  const extraPaths = ['/about', '/about-us', '/aboutus', '/contact', '/contact-us', '/company'];
  const pages = [{ path: '/', html: home.html, finalUrl: home.finalUrl }];
  await Promise.all(
    extraPaths.map(async (path) => {
      if (!origin) return;
      const r = await fetchHtml(`${origin}${path}`);
      if (r.ok && r.html && r.html.length > 400) {
        pages.push({ path, html: r.html, finalUrl: r.finalUrl });
      }
    }),
  );

  const combinedHtml = pages.map((p) => p.html).join('\n');
  const textParts = pages.map((p) => htmlToText(p.html).slice(0, 6000));
  const title = extractTitle(home.html);
  const description =
    metaContent(home.html, ['description', 'og:description', 'twitter:description']) || '';
  const ogSiteName = metaContent(home.html, ['og:site_name', 'application-name']) || '';
  const socials = extractSocials(combinedHtml);
  const phones = extractPhones(htmlToText(combinedHtml));
  const emails = extractEmails(combinedHtml, host);
  const orgs = extractJsonLdOrganizations(combinedHtml);
  const org = orgs[0] || null;

  const addressFromLd = (() => {
    const a = org?.address;
    if (!a) return {};
    if (typeof a === 'string') return { address: a };
    return {
      address: String(a.streetAddress || '').trim(),
      city: String(a.addressLocality || '').trim(),
      region: String(a.addressRegion || '').trim(),
      postalCode: String(a.postalCode || '').trim(),
      country: String(a.addressCountry || '').trim(),
    };
  })();

  const extracted = {
    website: home.finalUrl || website,
    siteHost: host,
    siteDomain: registrableHint(host),
    name: String(org?.name || ogSiteName || '').trim(),
    title,
    description,
    phone: String(org?.telephone || phones[0] || '').trim(),
    phones,
    emails,
    email: emails[0] || '',
    ...addressFromLd,
    ...socials,
    companyDescription: '',
    industry: String(org?.description || '').trim() ? '' : '',
    pageTexts: textParts,
    pagesFetched: pages.map((p) => p.path),
  };

  // Prefer JSON-LD description as about seed
  if (org?.description) extracted.companyDescription = String(org.description).trim();
  else if (description) extracted.companyDescription = description;

  return { ok: true, pages, extracted, finalUrl: home.finalUrl || website };
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

/** Prefer deterministic page extractions over model guesses. */
function mergeExtractedOverModel(extracted, modelSuggestion, website) {
  const out = { ...modelSuggestion };
  const take = (key, value) => {
    const v = String(value || '').trim();
    if (v) out[key] = v;
  };
  take('website', extracted.website || website);
  take('name', extracted.name);
  take('phone', extracted.phone);
  take('address', extracted.address);
  take('city', extracted.city);
  take('region', extracted.region);
  take('postalCode', extracted.postalCode);
  take('country', extracted.country);
  take('linkedinUrl', extracted.linkedinUrl);
  take('facebookUrl', extracted.facebookUrl);
  take('instagramUrl', extracted.instagramUrl);
  take('twitterUrl', extracted.twitterUrl);
  take('googleBusinessProfileUrl', extracted.googleBusinessProfileUrl);
  if (extracted.companyDescription && !out.companyDescription) {
    out.companyDescription = extracted.companyDescription;
  }
  if (extracted.email) {
    out.primaryContact = {
      ...(out.primaryContact || {}),
      email: out.primaryContact?.email || extracted.email,
      phone: out.primaryContact?.phone || extracted.phone || '',
    };
  }
  // Drop model social/GBP URLs that were not on the page (common hallucination)
  for (const key of [
    'linkedinUrl',
    'facebookUrl',
    'instagramUrl',
    'twitterUrl',
    'googleBusinessProfileUrl',
  ]) {
    if (!extracted[key] && out[key]) {
      // keep only if clearly present in page text corpus
      const corpus = (extracted.pageTexts || []).join(' ').toLowerCase();
      if (!corpus.includes(String(out[key]).toLowerCase().slice(0, 40))) {
        out[key] = '';
      }
    }
  }
  return out;
}

async function callGeminiJson({ apiKey, model, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
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

  const gathered = await gatherSiteCorpus(website);
  if (!gathered.ok) {
    return new Response(
      JSON.stringify({
        error:
          gathered.error ||
          'Could not load that website. Check the URL is public and try again.',
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const extracted = gathered.extracted;
  const pageCorpus = (extracted.pageTexts || []).join('\n\n---\n\n').slice(0, 18000);

  const prompt = `
You extract a CRM company profile ONLY from the website content below.
This is for domain ${extracted.siteDomain || extracted.siteHost}.
${companyName ? `CRM record name (may be informal): "${companyName}"` : ''}

HARD RULES:
- Use ONLY facts present in the EXTRACTED FIELDS or PAGE TEXT.
- Do NOT use outside knowledge or guess another company with a similar name.
- If a field is not clearly supported by the page content, return an empty string.
- Never invent phone numbers, emails, addresses, or social profile URLs.
- companyDescription: 1–3 sentences based on the page about THIS business only.
- industry: short label only if obvious from the page.
- primaryContact: only if a real person is clearly listed on the pages; otherwise empty strings. Prefer emails on ${extracted.siteDomain || 'this domain'}.
- website must stay on this domain (${extracted.siteDomain || extracted.siteHost}).
- Respond with one JSON object only:
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
  "confidenceNotes": "what came from the pages vs left blank"
}

EXTRACTED FIELDS (deterministic from HTML — trust these):
${JSON.stringify(
  {
    website: extracted.website,
    siteHost: extracted.siteHost,
    name: extracted.name,
    title: extracted.title,
    description: extracted.description,
    phone: extracted.phone,
    phones: extracted.phones,
    emails: extracted.emails,
    address: extracted.address,
    city: extracted.city,
    region: extracted.region,
    postalCode: extracted.postalCode,
    country: extracted.country,
    linkedinUrl: extracted.linkedinUrl,
    facebookUrl: extracted.facebookUrl,
    instagramUrl: extracted.instagramUrl,
    twitterUrl: extracted.twitterUrl,
    googleBusinessProfileUrl: extracted.googleBusinessProfileUrl,
    pagesFetched: extracted.pagesFetched,
  },
  null,
  2,
)}

PAGE TEXT:
${pageCorpus || '(empty)'}
`.trim();

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

  let parsed = null;
  let lastError = null;
  for (const model of modelCandidates) {
    const { resp, data } = await callGeminiJson({ apiKey, model, prompt });
    if (!resp.ok) {
      lastError = data?.error?.message || data?.message || 'Gemini request failed';
      const msg = String(lastError || '').toLowerCase();
      const shouldTryNext =
        msg.includes('not found') ||
        msg.includes('not supported') ||
        msg.includes('unsupported') ||
        msg.includes('no longer available') ||
        msg.includes('deprecated');
      if (shouldTryNext) continue;
      return new Response(JSON.stringify({ error: lastError }), {
        status: resp.status || 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const text = collectCandidateText(data);
    parsed = text ? extractFirstJsonObject(text) : null;
    if (parsed) break;
    lastError = 'Model returned non-JSON enrichment output.';
  }

  // Even if the model fails, return deterministic extraction so Enrich is still useful.
  const base = parsed
    ? cleanSuggestion(parsed)
    : cleanSuggestion({
        name: extracted.name || companyName,
        website: extracted.website,
        phone: extracted.phone,
        companyDescription: extracted.companyDescription || extracted.description,
        address: extracted.address,
        city: extracted.city,
        region: extracted.region,
        postalCode: extracted.postalCode,
        country: extracted.country,
        linkedinUrl: extracted.linkedinUrl,
        facebookUrl: extracted.facebookUrl,
        instagramUrl: extracted.instagramUrl,
        twitterUrl: extracted.twitterUrl,
        googleBusinessProfileUrl: extracted.googleBusinessProfileUrl,
        primaryContact: { email: extracted.email, phone: extracted.phone },
        confidenceNotes: lastError
          ? `AI summary unavailable (${lastError}); showing fields parsed from the website HTML.`
          : 'Parsed from website HTML.',
      });

  const suggestion = mergeExtractedOverModel(extracted, base, website);
  if (!suggestion.website) suggestion.website = website;
  if (!suggestion.name && companyName) suggestion.name = companyName;
  if (!suggestion.confidenceNotes) {
    suggestion.confidenceNotes = `Grounded in ${extracted.pagesFetched?.join(', ') || 'homepage'} for ${extracted.siteDomain}.`;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      suggestion,
      meta: {
        websiteFetched: true,
        usedGoogleSearch: false,
        pagesFetched: extracted.pagesFetched || [],
        siteHost: extracted.siteHost,
        confidenceNotes: suggestion.confidenceNotes,
        deterministicOnly: !parsed,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
