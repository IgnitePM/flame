/** Default HubSpot-style deal stages for the Sales Funnel MVP. */
export const DEFAULT_SALES_STAGES = [
  { id: 'new_lead', label: 'New Lead', order: 0, isWon: false, isLost: false },
  {
    id: 'contact_made',
    label: 'Contact Made',
    order: 1,
    isWon: false,
    isLost: false,
  },
  {
    id: 'discovery_scheduled',
    label: 'Discovery Scheduled',
    order: 2,
    isWon: false,
    isLost: false,
  },
  {
    id: 'discovery_complete',
    label: 'Discovery Complete',
    order: 3,
    isWon: false,
    isLost: false,
  },
  {
    id: 'proposal_sent',
    label: 'Proposal Sent',
    order: 4,
    isWon: false,
    isLost: false,
  },
  { id: 'closed_won', label: 'Closed Won', order: 5, isWon: true, isLost: false },
  {
    id: 'closed_lost',
    label: 'Closed Lost',
    order: 6,
    isWon: false,
    isLost: true,
  },
];

export function staffHasSalesFunnel(adminDoc) {
  return !!(adminDoc && adminDoc.features && adminDoc.features.salesFunnel);
}

export function resolvePipelineStages(settingsDoc) {
  const stages = settingsDoc?.stages;
  if (Array.isArray(stages) && stages.length > 0) {
    return [...stages]
      .map((s, i) => ({
        id: String(s.id || `stage_${i}`),
        label: String(s.label || s.id || `Stage ${i + 1}`),
        order: Number.isFinite(Number(s.order)) ? Number(s.order) : i,
        isWon: !!s.isWon,
        isLost: !!s.isLost,
      }))
      .sort((a, b) => a.order - b.order);
  }
  return DEFAULT_SALES_STAGES;
}

export function stageById(stages, stageId) {
  return (stages || []).find((s) => s.id === stageId) || null;
}

export function isClosedStage(stage) {
  return !!(stage && (stage.isWon || stage.isLost));
}

export function formatDealAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'US$0';
  return `US$${n.toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })}`;
}

export function formatDealDate(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Relative activity label for board cards. */
export function formatRelativeActivity(ts) {
  const ms = Number(ts);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return 'Just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'a few seconds ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
  const year = Math.floor(month / 12);
  return `${year} year${year === 1 ? '' : 's'} ago`;
}

export function newNoteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function makeDealNote(body, authorEmail) {
  return {
    id: newNoteId(),
    body: String(body || '').trim(),
    authorEmail: String(authorEmail || '').trim().toLowerCase(),
    createdAt: Date.now(),
  };
}

export function dealAssociationLabel(deal, leads, clients) {
  if (deal?.leadId) {
    const lead = (leads || []).find((l) => l.id === deal.leadId);
    return lead?.companyName || lead?.name || 'Lead';
  }
  if (deal?.clientId) {
    const client = (clients || []).find((c) => c.id === deal.clientId);
    return client?.name || 'Client';
  }
  return '—';
}

export function staffDisplayFromEmail(email, adminUsers) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return 'Unassigned';
  const match = (adminUsers || []).find(
    (a) => String(a.email || a.id || '').trim().toLowerCase() === key,
  );
  if (match?.displayName) return match.displayName;
  return key.split('@')[0] || key;
}

/** Normalize association so a deal has leadId XOR clientId. */
export function normalizeDealAssociation({ leadId, clientId }) {
  const lead = leadId ? String(leadId) : '';
  const client = clientId ? String(clientId) : '';
  if (lead) return { leadId: lead, clientId: null };
  if (client) return { leadId: null, clientId: client };
  return { leadId: null, clientId: null };
}
