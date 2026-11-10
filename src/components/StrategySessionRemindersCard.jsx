import React from 'react';
import { Calendar } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';
import {
  DEFAULT_STRATEGY_AGENCY_NAME,
  DEFAULT_STRATEGY_BOOKING_URL,
  DEFAULT_STRATEGY_REMINDER_BODY,
  DEFAULT_STRATEGY_REMINDER_SUBJECT,
  STRATEGY_REMINDER_TOKENS,
  buildStrategyReminderMessageBody,
  buildStrategyReminderSubject,
  resolveStrategyReminderBodyTemplate,
  resolveStrategyReminderSubjectTemplate,
  strategyReminderMonthLabel,
  strategyReminderMonthName,
  torontoParts,
} from '../utils/strategySessionBooking.js';

/**
 * Admin Config card: monthly Strategy & Review booking reminders to active clients.
 */
const StrategySessionRemindersCard = ({
  notifySettings = {},
  updateNotifySettings,
}) => {
  const [urlDraft, setUrlDraft] = React.useState(null);
  const [agencyDraft, setAgencyDraft] = React.useState(null);
  const [subjectDraft, setSubjectDraft] = React.useState(null);
  const [bodyDraft, setBodyDraft] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [runState, setRunState] = React.useState('');
  const bodyRef = React.useRef(null);

  const enabled = notifySettings.strategySessionRemindersEnabled !== false;
  const storedUrl = String(notifySettings.strategySessionBookingUrl || '').trim();
  const urlValue =
    urlDraft !== null ? urlDraft : storedUrl || DEFAULT_STRATEGY_BOOKING_URL;
  const agencyValue =
    agencyDraft !== null
      ? agencyDraft
      : String(notifySettings.strategySessionAgencyName || '').trim() ||
        DEFAULT_STRATEGY_AGENCY_NAME;
  const subjectValue =
    subjectDraft !== null
      ? subjectDraft
      : resolveStrategyReminderSubjectTemplate(notifySettings);
  const bodyValue =
    bodyDraft !== null
      ? bodyDraft
      : resolveStrategyReminderBodyTemplate(notifySettings);

  const dirty =
    urlDraft !== null ||
    agencyDraft !== null ||
    subjectDraft !== null ||
    bodyDraft !== null;

  const now = React.useMemo(() => new Date(), []);
  const previewVars = React.useMemo(() => {
    const sampleClient = 'Twin Peaks Property Inspections';
    return {
      settings: {
        strategySessionReminderSubject: subjectValue,
        strategySessionReminderBody: bodyValue,
      },
      clientName: sampleClient,
      monthLabel: strategyReminderMonthLabel(now),
      monthName: strategyReminderMonthName(now),
      year: String(torontoParts(now).year),
      bookingUrl: urlValue,
      portalUrl: 'https://ignitetimetracker.netlify.app?tab=dashboard',
      agencyName: agencyValue,
    };
  }, [agencyValue, bodyValue, now, subjectValue, urlValue]);

  const previewSubject = buildStrategyReminderSubject(previewVars);
  const previewBody = buildStrategyReminderMessageBody(previewVars);

  const saveTemplate = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const patch = {};
      if (urlDraft !== null) {
        patch.strategySessionBookingUrl =
          String(urlDraft).trim() || DEFAULT_STRATEGY_BOOKING_URL;
      }
      if (agencyDraft !== null) {
        patch.strategySessionAgencyName =
          String(agencyDraft).trim() || DEFAULT_STRATEGY_AGENCY_NAME;
      }
      if (subjectDraft !== null) {
        patch.strategySessionReminderSubject =
          String(subjectDraft).trim() || DEFAULT_STRATEGY_REMINDER_SUBJECT;
      }
      if (bodyDraft !== null) {
        const nextBody = String(bodyDraft);
        patch.strategySessionReminderBody = String(nextBody).trim()
          ? nextBody
          : DEFAULT_STRATEGY_REMINDER_BODY;
      }
      await updateNotifySettings?.(patch);
      setUrlDraft(null);
      setAgencyDraft(null);
      setSubjectDraft(null);
      setBodyDraft(null);
    } catch (err) {
      window.alert(`Could not save template: ${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    setSubjectDraft(DEFAULT_STRATEGY_REMINDER_SUBJECT);
    setBodyDraft(DEFAULT_STRATEGY_REMINDER_BODY);
  };

  const insertToken = (token) => {
    const snippet = `{{${token}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBodyDraft(`${bodyValue}${snippet}`);
      return;
    }
    const start = el.selectionStart ?? bodyValue.length;
    const end = el.selectionEnd ?? start;
    const next = `${bodyValue.slice(0, start)}${snippet}${bodyValue.slice(end)}`;
    setBodyDraft(next);
    window.requestAnimationFrame(() => {
      try {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    });
  };

  const runReminders = async ({ dryRun = false } = {}) => {
    if (dirty) {
      window.alert('Save your template changes before sending.');
      return;
    }
    const label = dryRun ? 'dry' : 'send';
    setRunState(`${label}:sending`);
    try {
      const resp = await authedFetch(
        '/.netlify/functions/send-strategy-session-reminders-manual',
        { force: true, dryRun },
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.error) {
        throw new Error(data?.error || 'Request failed');
      }
      if (data?.skipped) {
        setRunState(`${label}:Skipped — ${data.reason}`);
      } else {
        const msg = dryRun
          ? `Dry run: ${data.eligible || 0} active clients with emails`
          : `Sent messages to ${data.messaged || 0}; emailed ${data.emailRecipients || 0} addresses (${data.emailed || 0} clients)`;
        const errN = Number(data.errorCount || 0);
        setRunState(
          errN > 0 ? `${label}:${msg} · ${errN} error(s)` : `${label}:${msg}`,
        );
      }
    } catch (err) {
      setRunState(`${label}:Failed — ${err.message}`);
    }
    window.setTimeout(() => setRunState(''), 14000);
  };

  const busy = runState.endsWith(':sending');
  const sendLabel = runState.startsWith('send:')
    ? runState.slice('send:'.length)
    : '';
  const dryLabel = runState.startsWith('dry:')
    ? runState.slice('dry:'.length)
    : '';

  return (
    <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm text-left">
      <h3 className="font-black text-xl mb-2 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-[#fd7414]" />
        Strategy &amp; Review reminders
      </h3>
      <p className="text-slate-400 text-sm font-medium mb-6">
        On the <strong className="text-slate-600">1st of each month</strong>{' '}
        (America/Toronto), active clients with portal emails get a portal message
        and email. Edit the template below anytime — tokens like{' '}
        <code className="text-[11px]">{'{{businessName}}'}</code> and{' '}
        <code className="text-[11px]">{'{{month}}'}</code> personalize each send.
        Paused and archived clients are skipped.
      </p>

      <div className="space-y-4">
        <label className="flex items-center gap-3 font-bold text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              updateNotifySettings?.({
                strategySessionRemindersEnabled: e.target.checked,
              })
            }
          />
          Monthly reminders enabled
        </label>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Booking URL
            </label>
            <input
              type="url"
              value={urlValue}
              onChange={(e) => setUrlDraft(e.target.value)}
              className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Agency name
            </label>
            <input
              type="text"
              value={agencyValue}
              onChange={(e) => setAgencyDraft(e.target.value)}
              className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
            Email subject
          </label>
          <input
            type="text"
            value={subjectValue}
            onChange={(e) => setSubjectDraft(e.target.value)}
            className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Message body
            </label>
            <button
              type="button"
              onClick={resetToDefault}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#fd7414]"
            >
              Reset to default
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {STRATEGY_REMINDER_TOKENS.map((t) => (
              <button
                key={t.token}
                type="button"
                title={t.label}
                onClick={() => insertToken(t.token)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-orange-50 hover:text-[#fd7414] text-[10px] font-black tracking-wide text-slate-600"
              >
                {`{{${t.token}}}`}
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            rows={12}
            value={bodyValue}
            onChange={(e) => setBodyDraft(e.target.value)}
            className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] font-mono leading-relaxed"
          />
        </div>

        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Preview (sample client)
          </div>
          <div className="text-sm font-black text-slate-900">{previewSubject}</div>
          <pre className="whitespace-pre-wrap text-sm text-slate-600 font-medium leading-relaxed">
            {previewBody}
          </pre>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveTemplate}
            disabled={saving || !dirty}
            className="px-5 py-2.5 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30 hover:bg-slate-800 transition-all"
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            disabled={busy || !enabled || dirty}
            onClick={() => runReminders({ dryRun: true })}
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-slate-200 transition-all"
          >
            {dryLabel === 'sending' ? 'Counting…' : dryLabel || 'Preview count'}
          </button>
          <button
            type="button"
            disabled={busy || !enabled || dirty}
            onClick={() => {
              if (
                !window.confirm(
                  'Send Strategy & Review reminders to all active clients with portal emails now?',
                )
              ) {
                return;
              }
              runReminders({ dryRun: false });
            }}
            className="px-4 py-2 rounded-xl bg-[#fd7414] text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-[#e8680f] transition-all"
          >
            {sendLabel === 'sending' ? 'Sending…' : sendLabel || 'Send now'}
          </button>
          {dirty ? (
            <span className="text-[11px] font-medium text-amber-600">
              Save template before sending.
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default StrategySessionRemindersCard;
