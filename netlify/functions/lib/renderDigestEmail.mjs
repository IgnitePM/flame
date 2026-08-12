function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderDigestHtml({ period, summary, generatedAt }) {
  const periodLabel = period === 'weekly' ? 'Weekly' : 'Daily';
  const when = generatedAt.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const body = escapeHtml(summary).replace(/\n/g, '<br />');
  return `<html>
  <body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; background:#f8fafc; margin:0; padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;border:1px solid #f1f5f9;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fd7414;">Ignite PM &middot; ${periodLabel} workspace update</div>
      <h1 style="font-size:20px;margin:8px 0 4px;color:#0f172a;">${periodLabel} Briefing</h1>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:20px;">Generated ${when}</div>
      <div style="font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap;">${body}</div>
    </div>
  </body>
</html>`;
}
