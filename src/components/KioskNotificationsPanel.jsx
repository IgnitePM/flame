import React from 'react';
import { Bell, Check, Sparkles, X } from 'lucide-react';
import { notificationTypeLabel } from '../utils/notifications.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';

export default function KioskNotificationsPanel({
  notifications = [],
  onDismiss,
  onDismissAll,
  onOpenRelated,
  aiSummary = null,
  aiLoading = false,
  aiError = '',
  onGenerateOverall,
  onGenerateClient,
  selectedClientName = '',
  canGenerateAi = true,
}) {
  const unread = (notifications || []).filter((n) => !n.dismissed);
  const [showDismissed, setShowDismissed] = React.useState(false);
  const visible = showDismissed ? notifications : unread;

  return (
    <section className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[#fd7414]" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Notifications
          </h3>
          {unread.length > 0 && (
            <span className="rounded-full bg-[#fd7414] px-1.5 py-0.5 text-[9px] font-black text-white">
              {unread.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unread.length > 1 && (
            <button
              type="button"
              onClick={onDismissAll}
              className="rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:bg-white"
            >
              Dismiss all
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDismissed((v) => !v)}
            className="rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:bg-white"
          >
            {showDismissed ? 'Hide read' : 'Show read'}
          </button>
        </div>
      </div>

      {canGenerateAi && (
        <div className="rounded-xl border border-indigo-100 bg-white p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-600">
            <Sparkles className="h-3.5 w-3.5" />
            AI brief
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={aiLoading}
              onClick={onGenerateOverall}
              className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-40"
            >
              {aiLoading ? 'Thinking…' : 'Overall summary'}
            </button>
            {selectedClientName && (
              <button
                type="button"
                disabled={aiLoading}
                onClick={onGenerateClient}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-indigo-700 disabled:opacity-40"
              >
                {selectedClientName}
              </button>
            )}
          </div>
          {aiError ? (
            <p className="text-[11px] font-bold text-red-600">{aiError}</p>
          ) : null}
          {aiSummary?.text ? (
            <div className="max-h-48 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
              {aiSummary.text}
              <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                {aiSummary.scope === 'client' ? 'Client brief' : 'Workspace brief'}
                {aiSummary.generatedAt
                  ? ` · ${new Date(aiSummary.generatedAt).toLocaleString()}`
                  : ''}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              Summarizes open tasks, notes, retainers coming due or over, and timesheet
              issues. Super admins see all timesheets; others only their own clock-out
              alerts.
            </p>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-xs italic text-slate-400">
          {showDismissed ? 'No notifications yet.' : 'You are all caught up.'}
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
          {visible.map((n) => (
            <li
              key={n.id}
              className={`rounded-xl border px-2.5 py-2 ${
                n.dismissed
                  ? 'border-slate-100 bg-white/60 opacity-70'
                  : 'border-orange-100 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpenRelated?.(n)}
                >
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#fd7414]">
                    {notificationTypeLabel(n.type)}
                  </div>
                  <div className="text-xs font-black text-slate-800 break-words">
                    {safeDisplayForReact(n.title)}
                  </div>
                  {n.body ? (
                    <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-3">
                      {safeDisplayForReact(n.body)}
                    </p>
                  ) : null}
                  <div className="mt-1 text-[9px] font-bold text-slate-400">
                    {n.createdAt
                      ? new Date(n.createdAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : ''}
                    {n.clientName ? ` · ${n.clientName}` : ''}
                  </div>
                </button>
                {!n.dismissed && (
                  <button
                    type="button"
                    title="Dismiss"
                    onClick={() => onDismiss?.(n)}
                    className="shrink-0 rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {n.dismissed && (
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
