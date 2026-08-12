function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sectionHtml(title, items, renderItem) {
  if (!items?.length) return '';
  const lis = items.map((item) => `<li style="margin:0 0 8px;">${renderItem(item)}</li>`).join('');
  return `
    <div style="margin:20px 0 0;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;margin-bottom:8px;">${escapeHtml(title)}</div>
      <ul style="margin:0;padding-left:18px;color:#334155;font-size:14px;line-height:1.5;">${lis}</ul>
    </div>`;
}

export function renderPersonalDigestHtml({ digest, generatedAt }) {
  const periodLabel = digest.period === 'weekly' ? 'Weekly' : 'Daily';
  const when = generatedAt.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const name = escapeHtml(digest.displayName || digest.email);
  const s = digest.sections || {};

  const body = [
    sectionHtml('New assignments', s.newAssignments, (n) => {
      const client = n.clientName ? ` <span style="color:#94a3b8;">· ${escapeHtml(n.clientName)}</span>` : '';
      const bodyLine = n.body
        ? `<div style="color:#64748b;font-size:12px;margin-top:2px;">${escapeHtml(n.body)}</div>`
        : '';
      return `<strong>${escapeHtml(n.title)}</strong>${client}${bodyLine}`;
    }),
    sectionHtml('Overdue', s.overdue, (t) => {
      const step = t.isStep ? ' (step)' : '';
      return `<strong>${escapeHtml(t.text)}</strong>${step}<div style="color:#b91c1c;font-size:12px;">Due ${escapeHtml(t.dueYmd)} · ${escapeHtml(t.clientName)}</div>`;
    }),
    sectionHtml('Due soon', s.dueSoon, (t) => {
      const step = t.isStep ? ' (step)' : '';
      return `<strong>${escapeHtml(t.text)}</strong>${step}<div style="color:#64748b;font-size:12px;">Due ${escapeHtml(t.dueYmd)} · ${escapeHtml(t.clientName)}</div>`;
    }),
    sectionHtml('Mentions & notes', s.mentions, (m) => {
      const where = m.clientName
        ? `${escapeHtml(m.clientName)}${m.itemText ? ` · ${escapeHtml(m.itemText)}` : ''}`
        : escapeHtml(m.itemText || 'Task');
      return `<strong>${escapeHtml(m.authorName)}</strong> on ${where}<div style="color:#64748b;font-size:12px;margin-top:2px;">${escapeHtml(m.text)}</div>`;
    }),
    sectionHtml('Sales follow-ups', s.salesFollowUps, (f) => {
      return `<strong>${escapeHtml(f.dealName)}</strong><div style="color:#64748b;font-size:12px;">${escapeHtml(f.reason)}</div><div style="color:#334155;font-size:12px;margin-top:2px;">${escapeHtml(f.suggestedAction || '')}</div>`;
    }),
  ]
    .filter(Boolean)
    .join('');

  const emptyNote = body
    ? ''
    : `<p style="color:#64748b;font-size:14px;">Nothing urgent on your plate right now. Have a great day.</p>`;

  return `<html>
  <body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; background:#f8fafc; margin:0; padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;border:1px solid #f1f5f9;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM &middot; ${periodLabel} personal update</div>
      <h1 style="font-size:20px;margin:8px 0 4px;color:#0f172a;">Hi ${name}</h1>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">Your ${periodLabel.toLowerCase()} briefing · ${when}</div>
      ${emptyNote}
      ${body}
      <div style="margin-top:28px;font-size:11px;color:#94a3b8;">Open Time Tracker for full task and sales details.</div>
    </div>
  </body>
</html>`;
}

export function renderPersonalDigestText(digest) {
  const s = digest.sections || {};
  const lines = [`Hi ${digest.displayName || digest.email},`, ''];
  const pushSection = (title, items, lineFn) => {
    if (!items?.length) return;
    lines.push(title);
    for (const item of items) lines.push(`- ${lineFn(item)}`);
    lines.push('');
  };
  pushSection('New assignments', s.newAssignments, (n) =>
    `${n.title}${n.clientName ? ` (${n.clientName})` : ''}${n.body ? ` — ${n.body}` : ''}`,
  );
  pushSection('Overdue', s.overdue, (t) => `${t.text} — due ${t.dueYmd} — ${t.clientName}`);
  pushSection('Due soon', s.dueSoon, (t) => `${t.text} — due ${t.dueYmd} — ${t.clientName}`);
  pushSection(
    'Mentions & notes',
    s.mentions,
    (m) => `${m.authorName}: ${m.text}${m.clientName ? ` (${m.clientName})` : ''}`,
  );
  pushSection(
    'Sales follow-ups',
    s.salesFollowUps,
    (f) => `${f.dealName}: ${f.reason}${f.suggestedAction ? ` — ${f.suggestedAction}` : ''}`,
  );
  if (lines.length <= 2) lines.push('Nothing urgent on your plate right now.');
  return lines.join('\n');
}

export function renderAssignmentAlertHtml({ alert, generatedAt }) {
  const when = generatedAt.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const lis = (alert.items || [])
    .map((n) => {
      const client = n.clientName
        ? `<div style="color:#64748b;font-size:12px;">${escapeHtml(n.clientName)}</div>`
        : '';
      const body = n.body
        ? `<div style="color:#64748b;font-size:12px;">${escapeHtml(n.body)}</div>`
        : '';
      return `<li style="margin:0 0 10px;"><strong>${escapeHtml(n.title)}</strong>${client}${body}</li>`;
    })
    .join('');
  return `<html>
  <body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; background:#f8fafc; margin:0; padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;border:1px solid #f1f5f9;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM &middot; New task assignment</div>
      <h1 style="font-size:20px;margin:8px 0 4px;color:#0f172a;">New task${alert.items.length === 1 ? '' : 's'} assigned to you</h1>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:16px;">${when}</div>
      <ul style="margin:0;padding-left:18px;color:#334155;font-size:14px;line-height:1.5;">${lis}</ul>
    </div>
  </body>
</html>`;
}

export function renderAssignmentAlertText(alert) {
  const lines = ['New task(s) assigned to you:', ''];
  for (const n of alert.items || []) {
    lines.push(`- ${n.title}${n.clientName ? ` (${n.clientName})` : ''}`);
    if (n.body) lines.push(`  ${n.body}`);
  }
  return lines.join('\n');
}
