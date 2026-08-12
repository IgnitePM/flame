import React, { useMemo, useState } from 'react';
import { Mail, Sparkles } from 'lucide-react';
import {
  buildSalesFollowUpHints,
  listSalesDealsForCoach,
} from '../../utils/salesAiPayload.js';

function urgencyClass(urgency) {
  if (urgency === 'high') return 'border-red-200 bg-red-50 text-red-700';
  if (urgency === 'medium') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export default function SalesAiCoach({
  deals = [],
  leads = [],
  clients = [],
  stages = [],
  adminUsers = [],
  user,
  mineOnly = false,
  generateSalesCoach,
  onOpenDeal,
}) {
  const me = String(user?.email || '').trim().toLowerCase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [coach, setCoach] = useState(null);

  const rows = useMemo(
    () =>
      listSalesDealsForCoach({
        deals,
        leads,
        clients,
        stages,
        adminUsers,
        mineOnly,
        viewerEmail: me,
      }),
    [deals, leads, clients, stages, adminUsers, mineOnly, me],
  );

  const hints = useMemo(() => buildSalesFollowUpHints(rows), [rows]);

  const runCoach = async () => {
    if (!generateSalesCoach) return;
    setLoading(true);
    setError('');
    try {
      const data = await generateSalesCoach({ mineOnly });
      setCoach({
        summary: data.summary || '',
        followUps: Array.isArray(data.followUps) ? data.followUps : [],
        communications: Array.isArray(data.communications) ? data.communications : [],
        recommendations: Array.isArray(data.recommendations)
          ? data.recommendations
          : [],
        generatedAt: data.generatedAt || Date.now(),
      });
    } catch (err) {
      setError(err?.message || 'Could not generate sales coach.');
    } finally {
      setLoading(false);
    }
  };

  const followUps =
    coach?.followUps?.length > 0
      ? coach.followUps.map((f) => ({
          dealId: f.dealId,
          dealName: f.dealName || rows.find((r) => r.id === f.dealId)?.name,
          urgency: f.urgency || 'medium',
          reason: f.reason,
          suggestedAction: f.suggestedAction,
        }))
      : hints;

  return (
    <div className="bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#fd7414]">
            <Sparkles className="w-4 h-4" />
            Sales coach
          </div>
          <p className="text-sm text-slate-400 font-medium mt-1">
            Stale deals, suggested follow-ups, and talking points
            {mineOnly ? ' for your pipeline' : ''}.
          </p>
        </div>
        {typeof generateSalesCoach === 'function' && (
          <button
            type="button"
            disabled={loading}
            onClick={runCoach}
            className="inline-flex items-center gap-2 bg-[#fd7414] text-white px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider disabled:opacity-40 hover:brightness-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {loading ? 'Thinking…' : coach ? 'Refresh AI' : 'Get AI recommendations'}
          </button>
        )}
      </div>

      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}

      {coach?.summary ? (
        <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
          {coach.summary}
        </p>
      ) : (
        <p className="text-xs text-slate-400">
          Rule-based follow-ups show automatically. Generate AI recommendations for
          suggested emails and next steps (uses your Gemini key on Netlify).
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-1 space-y-2">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Follow up
          </h4>
          {followUps.length === 0 ? (
            <p className="text-xs italic text-slate-400">
              Nothing looks stale right now.
            </p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {followUps.slice(0, 8).map((item, idx) => (
                <li key={`${item.dealId || item.dealName}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => item.dealId && onOpenDeal?.(item.dealId)}
                    className={`w-full text-left rounded-2xl border px-3 py-2 ${urgencyClass(item.urgency)}`}
                  >
                    <div className="text-xs font-black">{item.dealName}</div>
                    <div className="text-[11px] font-medium opacity-90 mt-0.5">
                      {item.reason}
                    </div>
                    {item.suggestedAction ? (
                      <div className="text-[11px] mt-1 opacity-80">
                        {item.suggestedAction}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Suggested outreach
          </h4>
          {!coach?.communications?.length ? (
            <p className="text-xs italic text-slate-400">
              Generate AI recommendations for draft talking points.
            </p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {coach.communications.slice(0, 6).map((c, idx) => {
                const row = rows.find((r) => r.id === c.dealId);
                const email = row?.contactEmail;
                const subject = encodeURIComponent(
                  c.subject || `Following up — ${c.dealName || row?.name || ''}`,
                );
                const body = encodeURIComponent(c.message || '');
                return (
                  <li
                    key={`${c.dealId || c.dealName}-${idx}`}
                    className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <div className="text-xs font-black text-slate-800">
                      {c.dealName || row?.name}
                    </div>
                    {c.message ? (
                      <p className="text-[11px] text-slate-600 mt-1 whitespace-pre-wrap">
                        {c.message}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {c.dealId ? (
                        <button
                          type="button"
                          onClick={() => onOpenDeal?.(c.dealId)}
                          className="text-[10px] font-black uppercase tracking-wider text-[#fd7414]"
                        >
                          Open deal
                        </button>
                      ) : null}
                      {email ? (
                        <a
                          href={`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`}
                          className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-600"
                        >
                          <Mail className="w-3 h-3" /> Email
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Recommendations
          </h4>
          {!coach?.recommendations?.length ? (
            <p className="text-xs italic text-slate-400">
              AI will suggest pipeline moves and focus areas here.
            </p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {coach.recommendations.slice(0, 6).map((r, idx) => (
                <li
                  key={idx}
                  className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <div className="text-xs font-black text-slate-800">
                    {r.title || 'Tip'}
                  </div>
                  {r.detail ? (
                    <p className="text-[11px] text-slate-600 mt-1">{r.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
