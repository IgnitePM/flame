import { staffDisplayName } from './staffDirectory.js';

const STAGE_ALIASES = {
  'new lead': 'new_lead',
  new_lead: 'new_lead',
  'contact made': 'contact_made',
  contact_made: 'contact_made',
  'discovery scheduled': 'discovery_scheduled',
  discovery_scheduled: 'discovery_scheduled',
  'discovery complete': 'discovery_complete',
  discovery_complete: 'discovery_complete',
  'proposal sent': 'proposal_sent',
  proposal_sent: 'proposal_sent',
  'closed won': 'closed_won',
  'closed (won)': 'closed_won',
  closed_won: 'closed_won',
  'closed lost': 'closed_lost',
  'closed (lost)': 'closed_lost',
  closed_lost: 'closed_lost',
};

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c || '').trim() !== ''));
}

function headerIndex(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function mapHubspotStageId(stageLabel, stages = []) {
  const raw = normalizeHeader(stageLabel);
  if (STAGE_ALIASES[raw]) return STAGE_ALIASES[raw];
  const match = (stages || []).find(
    (s) => normalizeHeader(s.label) === raw || s.id === raw.replace(/\s/g, '_'),
  );
  return match?.id || 'new_lead';
}

export function matchOwnerEmail(ownerName, adminUsers = [], fallbackEmail = '') {
  const raw = String(ownerName || '').trim().toLowerCase();
  const fallback = String(fallbackEmail || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw.includes('@')) return raw;
  for (const admin of adminUsers || []) {
    const email = String(admin.email || admin.id || '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    const display = String(
      admin.displayName || staffDisplayName(admin) || '',
    )
      .trim()
      .toLowerCase();
    if (display && display === raw) return email;
    const handle = email.split('@')[0];
    if (handle && (raw === handle || raw.startsWith(`${handle} `))) return email;
  }
  return fallback;
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchClientId(dealName, clients = []) {
  const deal = normalizeName(dealName);
  if (!deal) return null;
  let best = null;
  let bestLen = 0;
  for (const client of clients || []) {
    if (client?.archived) continue;
    const name = normalizeName(client.name);
    if (name.length < 3) continue;
    if (deal === name || deal.includes(name) || name.includes(deal)) {
      if (name.length > bestLen) {
        best = client.id;
        bestLen = name.length;
      }
    }
  }
  return best;
}

export function parseCloseDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return ymd ? ymd[1] : null;
}

export function parseAmount(value) {
  const n = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function hubspotDealDocId(recordId) {
  return `hs_${String(recordId || '').trim()}`;
}

export function hubspotLeadDocId(recordId) {
  return `hs_lead_${String(recordId || '').trim()}`;
}

/**
 * Parse a HubSpot "all deals" CSV into importable rows.
 * Expected headers: Record ID, Deal Name, Deal Stage, Close Date, Deal owner, Amount
 */
export function parseHubspotDealsCsv(text, { stages, adminUsers, clients, fallbackOwnerEmail } = {}) {
  const table = parseCsv(text);
  if (table.length < 2) {
    throw new Error('CSV has no deal rows.');
  }
  const headers = table[0];
  const idIdx = headerIndex(headers, ['record id', 'deal id', 'id']);
  const nameIdx = headerIndex(headers, ['deal name', 'name']);
  const stageIdx = headerIndex(headers, ['deal stage', 'stage']);
  const closeIdx = headerIndex(headers, ['close date']);
  const ownerIdx = headerIndex(headers, ['deal owner', 'owner', 'deal owner name']);
  const amountIdx = headerIndex(headers, ['amount']);
  if (nameIdx < 0) {
    throw new Error(
      'Could not find a Deal Name column. Export deals from HubSpot with Deal Name, Deal Stage, Amount, Close Date, and Deal owner.',
    );
  }

  return table.slice(1).map((cols, i) => {
    const recordId = idIdx >= 0 ? String(cols[idIdx] || '').trim() : `row_${i + 1}`;
    const name = String(cols[nameIdx] || '').trim();
    const stageLabel = stageIdx >= 0 ? String(cols[stageIdx] || '').trim() : '';
    const ownerName = ownerIdx >= 0 ? String(cols[ownerIdx] || '').trim() : '';
    const clientId = matchClientId(name, clients);
    return {
      recordId,
      name: name || 'Untitled deal',
      stageLabel,
      stageId: mapHubspotStageId(stageLabel, stages),
      closeDate: parseCloseDate(closeIdx >= 0 ? cols[closeIdx] : ''),
      ownerName,
      ownerEmail: matchOwnerEmail(ownerName, adminUsers, fallbackOwnerEmail),
      amount: parseAmount(amountIdx >= 0 ? cols[amountIdx] : ''),
      clientId,
      dealDocId: hubspotDealDocId(recordId || `row_${i + 1}`),
      leadDocId: hubspotLeadDocId(recordId || `row_${i + 1}`),
    };
  }).filter((row) => row.name);
}
