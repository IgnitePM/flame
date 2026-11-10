import React from 'react';
import { Calendar } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';
import { DEFAULT_STRATEGY_BOOKING_URL } from '../utils/strategySessionBooking.js';

/**
 * Admin Config card: monthly Strategy & Review booking reminders to active clients.
 */
const StrategySessionRemindersCard = ({
  notifySettings = {},
  updateNotifySettings,
}) => {
  const [urlDraft, setUrlDraft] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [runState, setRunState] = React.useState('');

  const enabled = notifySettings.strategySessionRemindersEnabled !== false;
  const storedUrl = String(notifySettings.strategySessionBookingUrl || '').trim();
  const urlValue =
    urlDraft !== null ? urlDraft : storedUrl || DEFAULT_STRATEGY_BOOKING_URL;

  const saveUrl = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = String(urlDraft ?? '').trim();
      await updateNotifySettings?.({
        strategySessionBookingUrl: next || DEFAULT_STRATEGY_BOOKING_URL,
      });
      setUrlDraft(null);
    } catch (err) {
      window.alert(`Could not save booking URL: ${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const runReminders = async ({ dryRun = false } = {}) => {
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
        and email reminding them to book their Strategy &amp; Review session.
        The email CTA opens their portal Home booking card; the message also
        includes the direct Google booking link. Paused and archived clients are
        skipped.
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
          <button
            type="button"
            onClick={saveUrl}
            disabled={saving || urlDraft === null}
            className="px-5 py-2.5 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30 hover:bg-slate-800 transition-all"
          >
            {saving ? 'Saving…' : 'Save booking URL'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            disabled={busy || !enabled}
            onClick={() => runReminders({ dryRun: true })}
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-slate-200 transition-all"
          >
            {dryLabel === 'sending' ? 'Counting…' : dryLabel || 'Preview count'}
          </button>
          <button
            type="button"
            disabled={busy || !enabled}
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
        </div>
      </div>
    </div>
  );
};

export default StrategySessionRemindersCard;
