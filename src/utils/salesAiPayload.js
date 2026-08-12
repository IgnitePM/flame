import {
  isClosedStage,
  resolvePipelineStages,
  staffDisplayFromEmail,
} from './salesPipeline.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(ts) {
  const ms = Number(ts || 0);
  if (!ms) return null;
  return Math.floor((Date.now() - ms) / DAY_MS);
}

function ymdToMs(value) {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0).getTime();
}

function compactNotes(notes, limit = 2) {
  return (Array.isArray(notes) ? notes : [])
    .slice(-limit)
    .map((n) => ({
      author: n.authorEmail || '',
      body: String(n.body || '').slice(0, 240),
      at: n.createdAt || null,
    }));
}

export function listSalesDealsForCoach({
  deals = [],
  leads = [],
  clients = [],
  stages = [],
  adminUsers = [],
  mineOnly = false,
  viewerEmail = '',
} = {}) {
  const me = String(viewerEmail || '').trim().toLowerCase();
  const resolved = stages?.length ? stages : resolvePipelineStages(null);
  return (deals || [])
    .filter((d) => {
      if (mineOnly && String(d.ownerEmail || '').toLowerCase() !== me) return false;
      return true;
    })
    .map((d) => {
      const stage = resolved.find((s) => s.id === d.stageId) || null;
      const lead = d.leadId ? (leads || []).find((l) => l.id === d.leadId) : null;
      const client = d.clientId
        ? (clients || []).find((c) => c.id === d.clientId)
        : null;
      const contactEmail =
        lead?.primaryContact?.email ||
        client?.primaryContact?.email ||
        (Array.isArray(client?.clientEmails) ? client.clientEmails[0] : '') ||
        '';
      const lastAt = d.lastActivityAt || d.updatedAt || d.createdAt || 0;
      return {
        id: d.id,
        name: d.name || 'Untitled deal',
        amount: Number(d.amount) || 0,
        stageId: d.stageId || '',
        stage: stage?.label || d.stageId || '',
        closed: isClosedStage(stage),
        isWon: !!stage?.isWon,
        isLost: !!stage?.isLost,
        owner: staffDisplayFromEmail(d.ownerEmail, adminUsers),
        ownerEmail: d.ownerEmail || '',
        closeDate: d.closeDate || null,
        createdAt: d.createdAt || d.createDate || null,
        lastActivityAt: lastAt,
        daysIdle: daysSince(lastAt),
        daysPastClose: (() => {
          const closeMs = ymdToMs(d.closeDate);
          if (!closeMs || isClosedStage(stage)) return null;
          const days = Math.floor((Date.now() - closeMs) / DAY_MS);
          return days > 0 ? days : null;
        })(),
        linked: client?.name || lead?.companyName || lead?.name || '',
        linkedType: client ? 'client' : lead ? 'lead' : '',
        contactEmail,
        contactName: lead?.primaryContact?.name || client?.primaryContact?.name || '',
        noteCount: Array.isArray(d.notes) ? d.notes.length : 0,
        recentNotes: compactNotes(d.notes),
      };
    });
}

/** Rule-based follow-ups so the board is useful even before Gemini runs. */
export function buildSalesFollowUpHints(rows = []) {
  const hints = [];
  for (const d of rows) {
    if (d.closed) continue;
    if (d.daysPastClose) {
      hints.push({
        dealId: d.id,
        dealName: d.name,
        urgency: 'high',
        reason: `Close date was ${d.daysPastClose} day${d.daysPastClose === 1 ? '' : 's'} ago`,
        suggestedAction: 'Confirm status, update the close date, or move to Closed (Won/Lost).',
      });
    }
    if ((d.daysIdle ?? 0) >= 14) {
      hints.push({
        dealId: d.id,
        dealName: d.name,
        urgency: 'high',
        reason: `No activity in ${d.daysIdle} days`,
        suggestedAction: d.contactEmail
          ? 'Send a check-in email and log a note.'
          : 'Add a contact email, then follow up and log a note.',
      });
    } else if ((d.daysIdle ?? 0) >= 7) {
      hints.push({
        dealId: d.id,
        dealName: d.name,
        urgency: 'medium',
        reason: `Quiet for ${d.daysIdle} days in ${d.stage}`,
        suggestedAction: 'Log the latest conversation or schedule the next step.',
      });
    }
    if (d.stageId === 'proposal_sent' && (d.daysIdle ?? 0) >= 4) {
      hints.push({
        dealId: d.id,
        dealName: d.name,
        urgency: 'high',
        reason: 'Proposal is sitting without a recent update',
        suggestedAction: 'Follow up on the proposal and record their response.',
      });
    }
    if (d.stageId === 'new_lead' && (d.daysIdle ?? 0) >= 2 && d.noteCount === 0) {
      hints.push({
        dealId: d.id,
        dealName: d.name,
        urgency: 'medium',
        reason: 'New lead with no notes yet',
        suggestedAction: 'Make first contact and capture what you learned.',
      });
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const h of hints) {
    const key = `${h.dealId}:${h.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(h);
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return uniq.sort((a, b) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9)).slice(0, 12);
}

export function buildSalesAiPayload({
  deals,
  leads,
  clients,
  salesPipeline,
  adminUsers,
  user,
  mineOnly = false,
} = {}) {
  const stages = resolvePipelineStages(salesPipeline);
  const viewerEmail = String(user?.email || '').trim().toLowerCase();
  const rows = listSalesDealsForCoach({
    deals,
    leads,
    clients,
    stages,
    adminUsers,
    mineOnly,
    viewerEmail,
  });
  const open = rows.filter((d) => !d.closed);
  const pipelineTotal = open.reduce((sum, d) => sum + (d.amount || 0), 0);
  return {
    kind: 'sales',
    scope: mineOnly ? 'mine' : 'all',
    viewer: {
      email: viewerEmail,
      name: user?.displayName || '',
    },
    generatedAt: Date.now(),
    stats: {
      dealCount: rows.length,
      openCount: open.length,
      wonCount: rows.filter((d) => d.isWon).length,
      lostCount: rows.filter((d) => d.isLost).length,
      openPipelineAmount: pipelineTotal,
    },
    stages: stages.map((s) => ({ id: s.id, label: s.label, isWon: s.isWon, isLost: s.isLost })),
    followUpHints: buildSalesFollowUpHints(rows),
    deals: rows
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
      .slice(0, 40)
      .map((d) => ({
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
        recentNotes: (d.recentNotes || []).slice(-1),
      })),
  };
}
