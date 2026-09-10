/**
 * Match Gmail messages to clients and upsert clientEmailMessages.
 *
 * Matching:
 * 1. Exact CRM addresses (primary, contacts, portal emails)
 * 2. Same registrable domain as the client's website (and CRM email domains
 *    that are not free webmail hosts)
 */

import { fetchCollection, fetchDoc, getDigestDb, mergeDoc } from './firebaseDigestClient.mjs';
import { writeClientActivity } from './clientActivity.mjs';
import {
  emailsFromHeader,
  extractPlainBody,
  fetchGmailProfile,
  getValidAccessToken,
  gmailGetMessage,
  gmailHistoryList,
  gmailListMessages,
  headerValue,
  loadConnection,
  saveConnection,
} from './gmailOAuth.mjs';

/** Free / consumer mail hosts — never treat as a client company domain. */
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.ca',
  'hotmail.com',
  'outlook.com',
  'outlook.ca',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'yandex.com',
  'zoho.com',
]);

function addEmailToMap(map, email, clientId, clientName) {
  const em = String(email || '').trim().toLowerCase();
  if (!em || !em.includes('@') || !clientId) return;
  if (!map.has(em)) map.set(em, { clientId, clientName });
}

function addDomainToMap(map, domain, clientId, clientName) {
  const d = String(domain || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!d || !d.includes('.') || !clientId) return;
  if (PUBLIC_MAIL_DOMAINS.has(d)) return;
  if (!map.has(d)) map.set(d, { clientId, clientName });
}

/** Hostname from website URL or bare domain (strips www.). */
export function domainFromWebsite(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\./, '');
    if (!host || !host.includes('.') || PUBLIC_MAIL_DOMAINS.has(host)) return '';
    return host;
  } catch {
    return '';
  }
}

export function domainFromEmail(email) {
  const em = String(email || '').trim().toLowerCase();
  const at = em.lastIndexOf('@');
  if (at < 0) return '';
  const domain = em.slice(at + 1).replace(/^\.+|\.+$/g, '');
  if (!domain.includes('.') || PUBLIC_MAIL_DOMAINS.has(domain)) return '';
  return domain;
}

/**
 * Match address domain to a client domain: exact or subdomain
 * (e.g. mail.acme.com → acme.com).
 */
function matchDomainMap(domainMap, emailDomain) {
  const d = String(emailDomain || '').toLowerCase();
  if (!d) return null;
  const exact = domainMap.get(d);
  if (exact) return exact;
  for (const [clientDomain, hit] of domainMap) {
    if (d.endsWith(`.${clientDomain}`)) return hit;
  }
  return null;
}

/**
 * Build indexes: exact emails + company domains from website / CRM emails.
 * @returns {{ byEmail: Map, byDomain: Map }}
 */
export async function buildClientEmailIndex(db) {
  const clients = await fetchCollection(db, 'clients');
  const byEmail = new Map();
  const byDomain = new Map();
  for (const c of clients) {
    const name = c.name || '';
    const id = c.id;
    const primary = c.primaryContact;
    if (primary?.email) {
      addEmailToMap(byEmail, primary.email, id, name);
      addDomainToMap(byDomain, domainFromEmail(primary.email), id, name);
    }
    // Legacy / alternate single-email fields some imports used
    if (c.email) {
      addEmailToMap(byEmail, c.email, id, name);
      addDomainToMap(byDomain, domainFromEmail(c.email), id, name);
    }
    if (c.contactEmail) {
      addEmailToMap(byEmail, c.contactEmail, id, name);
      addDomainToMap(byDomain, domainFromEmail(c.contactEmail), id, name);
    }
    const contacts = Array.isArray(c.contacts) ? c.contacts : [];
    for (const ct of contacts) {
      if (ct?.email) {
        addEmailToMap(byEmail, ct.email, id, name);
        addDomainToMap(byDomain, domainFromEmail(ct.email), id, name);
      }
    }
    const portal = Array.isArray(c.clientEmails)
      ? c.clientEmails
      : String(c.clientEmails || '')
          .split(/[,\n;]/)
          .map((s) => s.trim())
          .filter(Boolean);
    for (const em of portal) {
      addEmailToMap(byEmail, em, id, name);
      addDomainToMap(byDomain, domainFromEmail(em), id, name);
    }
    const siteDomain = domainFromWebsite(c.website);
    if (siteDomain) addDomainToMap(byDomain, siteDomain, id, name);
  }
  return { byEmail, byDomain };
}

function matchClient(index, addresses, selfEmail) {
  const self = String(selfEmail || '').toLowerCase();
  const byEmail = index?.byEmail || index;
  const byDomain = index?.byDomain;

  // Prefer exact CRM address matches.
  for (const em of addresses) {
    if (em === self) continue;
    const hit = byEmail instanceof Map ? byEmail.get(em) : null;
    if (hit) return { ...hit, matchedEmail: em, matchType: 'email' };
  }

  // Then company / website domain (skips free webmail).
  if (byDomain instanceof Map) {
    for (const em of addresses) {
      if (em === self) continue;
      const at = String(em).lastIndexOf('@');
      const rawDomain = at >= 0 ? String(em).slice(at + 1).toLowerCase() : '';
      if (!rawDomain || PUBLIC_MAIL_DOMAINS.has(rawDomain)) continue;
      const hit = matchDomainMap(byDomain, rawDomain);
      if (hit) return { ...hit, matchedEmail: em, matchType: 'domain' };
    }
  }
  return null;
}

async function upsertGmailMessage({
  message,
  emailIndex,
  selfEmail,
  staffEmail,
}) {
  const headers = message?.payload?.headers || [];
  const fromHeader = headerValue(headers, 'From');
  const toHeader = headerValue(headers, 'To');
  const ccHeader = headerValue(headers, 'Cc');
  const subject = headerValue(headers, 'Subject') || '(no subject)';
  const messageIdHeader = headerValue(headers, 'Message-ID') || headerValue(headers, 'Message-Id');
  const fromEmails = emailsFromHeader(fromHeader);
  const toEmails = [...emailsFromHeader(toHeader), ...emailsFromHeader(ccHeader)];
  const all = [...fromEmails, ...toEmails];
  const match = matchClient(emailIndex, all, selfEmail);
  if (!match) return { skipped: true };

  const self = String(selfEmail || '').toLowerCase();
  const fromIsSelf = fromEmails.some((e) => e === self);
  const direction = fromIsSelf ? 'outbound' : 'inbound';
  const gmailMessageId = String(message.id || '');
  if (!gmailMessageId) return { skipped: true };

  const docId = `gmail_${gmailMessageId}`;
  const db = await getDigestDb();
  const existing = await fetchDoc(db, `clientEmailMessages/${docId}`);
  if (existing) return { skipped: true, duplicate: true };

  const body = extractPlainBody(message);
  const sentAt = Number(message.internalDate || Date.now());
  const to = direction === 'outbound' ? toEmails : fromEmails.length ? fromEmails : toEmails;

  const doc = {
    clientId: match.clientId,
    clientName: match.clientName || '',
    direction,
    to,
    from: fromEmails[0] || fromHeader || '',
    subject,
    body,
    actorEmail: direction === 'outbound' ? String(staffEmail || self).toLowerCase() : fromEmails[0] || '',
    gmailMessageId,
    gmailThreadId: message.threadId || null,
    gmailRfc822MessageId: messageIdHeader || null,
    inReplyToId: null,
    sentAt,
    createdAt: Date.now(),
    source: 'gmail_sync',
    matchedEmail: match.matchedEmail,
    matchType: match.matchType || 'email',
  };
  await mergeDoc(db, `clientEmailMessages/${docId}`, doc);

  if (direction === 'inbound') {
    try {
      await writeClientActivity({
        clientId: match.clientId,
        clientName: match.clientName || '',
        type: 'email_received',
        title: subject,
        body: body.slice(0, 800),
        actorEmail: fromEmails[0] || '',
        source: 'system',
        meta: {
          gmailMessageId,
          gmailThreadId: message.threadId || null,
          emailMessageId: docId,
          direction: 'inbound',
        },
        at: sentAt,
      });
    } catch (err) {
      console.warn('[gmailSync] activity skipped:', err?.message || err);
    }
  }

  return { upserted: true, direction, clientId: match.clientId, docId };
}

async function processMessageIds(accessToken, ids, ctx) {
  let upserted = 0;
  let skipped = 0;
  let scanned = 0;
  for (const id of ids) {
    scanned += 1;
    try {
      // Metadata first (cheap) — only pull full body when it matches a client.
      const meta = await gmailGetMessage(accessToken, id, 'metadata');
      const headers = meta?.payload?.headers || [];
      const fromEmails = emailsFromHeader(headerValue(headers, 'From'));
      const toEmails = [
        ...emailsFromHeader(headerValue(headers, 'To')),
        ...emailsFromHeader(headerValue(headers, 'Cc')),
      ];
      const match = matchClient(ctx.emailIndex, [...fromEmails, ...toEmails], ctx.selfEmail);
      if (!match) {
        skipped += 1;
        continue;
      }
      const message = await gmailGetMessage(accessToken, id, 'full');
      const result = await upsertGmailMessage({ message, ...ctx });
      if (result.upserted) upserted += 1;
      else skipped += 1;
    } catch (err) {
      console.warn('[gmailSync] message', id, err?.message || err);
      skipped += 1;
    }
  }
  return { upserted, skipped, scanned };
}

/**
 * Build Gmail search queries targeting CRM emails + website domains.
 * Chunked to stay under Gmail query length limits.
 * @param {{ byEmail: Map, byDomain: Map }} emailIndex
 * @param {{ maxLen?: number, afterEpochSec?: number|null }} [opts]
 */
export function buildGmailQueryChunks(emailIndex, opts = {}) {
  const maxLen = Number(opts.maxLen) || 450;
  const afterEpochSec = opts.afterEpochSec != null ? Number(opts.afterEpochSec) : null;
  const afterClause =
    Number.isFinite(afterEpochSec) && afterEpochSec > 0 ? ` after:${Math.floor(afterEpochSec)}` : '';

  const terms = [];
  const byEmail = emailIndex?.byEmail;
  const byDomain = emailIndex?.byDomain;
  if (byEmail instanceof Map) {
    for (const email of byEmail.keys()) {
      terms.push(`from:${email}`, `to:${email}`, `cc:${email}`);
    }
  }
  if (byDomain instanceof Map) {
    for (const domain of byDomain.keys()) {
      terms.push(`from:${domain}`, `to:${domain}`, `cc:${domain}`);
    }
  }
  const seen = new Set();
  const unique = [];
  for (const t of terms) {
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  if (!unique.length) return [];

  // Reserve room for after: clause inside each chunk
  const budget = Math.max(80, maxLen - afterClause.length);
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const t of unique) {
    const add = (buf.length ? 4 : 0) + t.length; // " OR "
    if (buf.length && len + add > budget) {
      chunks.push(`(${buf.join(' OR ')})${afterClause}`.trim());
      buf = [t];
      len = t.length;
    } else {
      buf.push(t);
      len += add;
    }
  }
  if (buf.length) chunks.push(`(${buf.join(' OR ')})${afterClause}`.trim());
  return chunks;
}

const FULL_SYNC_PAGE_SIZE = 40;
const RECENT_SYNC_MAX_IDS = 120;

/**
 * Run CRM-targeted list queries (optional after:) and process message ids.
 */
async function runTargetedQueryPass(accessToken, chunks, ctx, { maxIds = 120 } = {}) {
  const ids = [];
  const seen = new Set();
  for (const q of chunks) {
    let pageToken = '';
    do {
      const list = await gmailListMessages(accessToken, {
        q,
        pageToken,
        maxResults: 50,
      });
      for (const m of list.messages || []) {
        if (!m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        ids.push(m.id);
        if (ids.length >= maxIds) break;
      }
      pageToken = list.nextPageToken || '';
      if (ids.length >= maxIds) break;
    } while (pageToken);
    if (ids.length >= maxIds) break;
  }
  const result = await processMessageIds(accessToken, ids, ctx);
  return { ...result, listed: ids.length, queries: chunks.length };
}

/**
 * One chunked step of an all-time full history sync (resumable).
 * Uses CRM-targeted Gmail queries so we don't scan unrelated mail.
 */
export async function syncGmailFullHistoryStep(uid, { restart = false } = {}) {
  const connection = await loadConnection(uid);
  if (!connection?.refreshToken) {
    return { ok: false, error: 'Gmail is not connected.' };
  }

  const db = await getDigestDb();
  const emailIndex = await buildClientEmailIndex(db);
  const indexStats = {
    clientEmails: emailIndex.byEmail.size,
    clientDomains: emailIndex.byDomain.size,
  };

  if (indexStats.clientEmails === 0 && indexStats.clientDomains === 0) {
    return {
      ok: false,
      error:
        'Add client contact emails and/or websites first — full sync matches those addresses and domains.',
      indexStats,
    };
  }

  const chunks = buildGmailQueryChunks(emailIndex);
  if (!chunks.length) {
    return { ok: false, error: 'Could not build Gmail search queries from CRM data.', indexStats };
  }

  let fullSync = connection.fullSync && typeof connection.fullSync === 'object' ? { ...connection.fullSync } : null;
  const now = Date.now();

  if (restart || !fullSync || fullSync.status !== 'running') {
    fullSync = {
      status: 'running',
      chunkIndex: 0,
      pageToken: '',
      scanned: 0,
      upserted: 0,
      skipped: 0,
      totalChunks: chunks.length,
      startedAt: now,
      updatedAt: now,
    };
  } else {
    fullSync.totalChunks = chunks.length;
    // Clamp if CRM shrunk
    if (Number(fullSync.chunkIndex) >= chunks.length) {
      fullSync.chunkIndex = chunks.length - 1;
      fullSync.pageToken = '';
    }
  }

  const accessToken = await getValidAccessToken(connection);
  const selfEmail = String(connection.gmailEmail || '').toLowerCase();
  const staffEmail = String(connection.staffEmail || '').toLowerCase();
  const ctx = { emailIndex, selfEmail, staffEmail };

  let chunkIndex = Math.max(0, Number(fullSync.chunkIndex) || 0);
  let pageToken = String(fullSync.pageToken || '');
  let stepUpserted = 0;
  let stepSkipped = 0;
  let stepScanned = 0;

  const q = chunks[chunkIndex];
  const list = await gmailListMessages(accessToken, {
    q,
    pageToken,
    maxResults: FULL_SYNC_PAGE_SIZE,
  });
  const ids = (list.messages || []).map((m) => m.id).filter(Boolean);
  const result = await processMessageIds(accessToken, ids, ctx);
  stepUpserted = result.upserted;
  stepSkipped = result.skipped;
  stepScanned = result.scanned;

  fullSync.scanned = Number(fullSync.scanned || 0) + stepScanned;
  fullSync.upserted = Number(fullSync.upserted || 0) + stepUpserted;
  fullSync.skipped = Number(fullSync.skipped || 0) + stepSkipped;
  fullSync.updatedAt = Date.now();

  const nextPage = list.nextPageToken || '';
  let done = false;
  if (nextPage) {
    fullSync.pageToken = nextPage;
    fullSync.chunkIndex = chunkIndex;
    fullSync.status = 'running';
  } else if (chunkIndex + 1 < chunks.length) {
    fullSync.chunkIndex = chunkIndex + 1;
    fullSync.pageToken = '';
    fullSync.status = 'running';
  } else {
    fullSync.status = 'done';
    fullSync.pageToken = '';
    fullSync.completedAt = Date.now();
    done = true;
    try {
      const profile = await fetchGmailProfile(accessToken);
      if (profile?.historyId) {
        await saveConnection(uid, { historyId: String(profile.historyId) });
      }
    } catch (err) {
      console.warn('[gmailSync] full sync historyId:', err?.message || err);
    }
  }

  await saveConnection(uid, {
    fullSync,
    lastSyncAt: Date.now(),
    updatedAt: Date.now(),
  });

  const progress = {
    chunk: chunkIndex + 1,
    totalChunks: chunks.length,
    scanned: fullSync.scanned,
    upserted: fullSync.upserted,
    status: fullSync.status,
  };

  return {
    ok: true,
    mode: 'full_history',
    done,
    continue: !done,
    upserted: stepUpserted,
    skipped: stepSkipped,
    scanned: stepScanned,
    totals: {
      scanned: fullSync.scanned,
      upserted: fullSync.upserted,
      skipped: fullSync.skipped,
    },
    progress,
    indexStats,
    hint: done
      ? `Full history sync complete — ${fullSync.upserted} matched message(s) across ${fullSync.scanned} scanned.`
      : `Full sync in progress — chunk ${progress.chunk}/${progress.totalChunks}, ${fullSync.scanned} scanned, ${fullSync.upserted} matched so far…`,
    lastSyncAt: Date.now(),
    gmailEmail: selfEmail,
  };
}

/**
 * Sync one staff Gmail connection into clientEmailMessages.
 * @param {string} uid
 * @param {{ forceBackfill?: boolean }} [opts]
 */
export async function syncGmailConnection(uid, opts = {}) {
  const forceBackfill = Boolean(opts.forceBackfill);
  const connection = await loadConnection(uid);
  if (!connection?.refreshToken) {
    return { ok: false, error: 'Gmail is not connected.' };
  }

  const db = await getDigestDb();
  const emailIndex = await buildClientEmailIndex(db);
  const indexStats = {
    clientEmails: emailIndex.byEmail.size,
    clientDomains: emailIndex.byDomain.size,
  };
  const accessToken = await getValidAccessToken(connection);
  const selfEmail = String(connection.gmailEmail || '').toLowerCase();
  const staffEmail = String(connection.staffEmail || '').toLowerCase();
  const ctx = { emailIndex, selfEmail, staffEmail };

  let upserted = 0;
  let skipped = 0;
  let scanned = 0;
  let mode = 'incremental';
  let historyId = connection.historyId ? String(connection.historyId) : null;
  const needsBackfill = forceBackfill || !Number(connection.lastSyncAt || 0);

  // Incremental history sync (skip when forcing / first backfill).
  if (historyId && !needsBackfill) {
    try {
      let pageToken = '';
      const ids = new Set();
      do {
        const hist = await gmailHistoryList(accessToken, historyId, pageToken);
        for (const h of hist.history || []) {
          for (const added of h.messagesAdded || []) {
            if (added.message?.id) ids.add(added.message.id);
          }
        }
        if (hist.historyId) historyId = String(hist.historyId);
        pageToken = hist.nextPageToken || '';
      } while (pageToken);

      const result = await processMessageIds(accessToken, [...ids], ctx);
      upserted += result.upserted;
      skipped += result.skipped;
      scanned += result.scanned;
      mode = 'incremental';
    } catch (err) {
      console.warn('[gmailSync] history fallback:', err?.status, err?.message || err);
      historyId = null;
    }
  }

  if (!historyId || needsBackfill) {
    mode = 'targeted_30d';
    // IMPORTANT: do not scan the newest N inbox messages — those are often
    // internal and never reach client threads. Search Gmail for CRM emails/domains.
    if (indexStats.clientEmails === 0 && indexStats.clientDomains === 0) {
      const nowTs = Date.now();
      await saveConnection(uid, {
        historyId: historyId || connection.historyId || null,
        lastSyncAt: nowTs,
        updatedAt: nowTs,
      });
      return {
        ok: true,
        upserted: 0,
        skipped: 0,
        scanned: 0,
        mode,
        indexStats,
        hint:
          'No client emails or website domains in CRM yet — add a website or contact email on clients, then Sync now again.',
        lastSyncAt: nowTs,
        gmailEmail: selfEmail,
      };
    }

    const after = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const chunks = buildGmailQueryChunks(emailIndex, { afterEpochSec: after });
    const pass = await runTargetedQueryPass(accessToken, chunks, ctx, {
      maxIds: RECENT_SYNC_MAX_IDS,
    });
    upserted += pass.upserted;
    skipped += pass.skipped;
    scanned += pass.scanned;

    try {
      const profile = await fetchGmailProfile(accessToken);
      historyId = profile?.historyId ? String(profile.historyId) : historyId;
    } catch (err) {
      console.warn('[gmailSync] profile historyId:', err?.message || err);
    }
  }

  const now = Date.now();
  await saveConnection(uid, {
    historyId: historyId || connection.historyId || null,
    lastSyncAt: now,
    updatedAt: now,
  });

  let hint = '';
  if (upserted === 0) {
    if (indexStats.clientEmails === 0 && indexStats.clientDomains === 0) {
      hint =
        'No client emails or website domains in CRM yet — add a website or contact email, then Sync now again.';
    } else if (scanned === 0) {
      hint = `CRM has ${indexStats.clientEmails} email(s) and ${indexStats.clientDomains} domain(s), but Gmail returned 0 messages for those in the last 30 days. Try Full history sync, or confirm the addresses on the client match the ones in Gmail.`;
    } else {
      hint = `Scanned ${scanned} CRM-targeted message(s) against ${indexStats.clientEmails} email(s) / ${indexStats.clientDomains} domain(s); none new to import (may already be synced).`;
    }
  }

  return {
    ok: true,
    upserted,
    skipped,
    scanned,
    mode,
    indexStats,
    hint,
    lastSyncAt: now,
    gmailEmail: selfEmail,
  };
}

export async function syncAllGmailConnections() {
  const db = await getDigestDb();
  const connections = await fetchCollection(db, 'gmailConnections');
  const results = [];
  for (const conn of connections) {
    if (!conn.refreshToken && !conn.id) continue;
    try {
      const uid = conn.id || conn.uid;
      // Continue an in-progress full history sync one step per schedule tick.
      if (conn.fullSync?.status === 'running') {
        const r = await syncGmailFullHistoryStep(uid, { restart: false });
        results.push({ uid, ...r });
      } else {
        const r = await syncGmailConnection(uid);
        results.push({ uid, ...r });
      }
    } catch (err) {
      console.error('[gmailSync] connection', conn.id, err);
      results.push({ uid: conn.id || conn.uid, ok: false, error: err?.message || String(err) });
    }
  }
  return { ok: true, connections: results.length, results };
}
