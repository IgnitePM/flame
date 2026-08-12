import React from 'react';
import { Mail } from 'lucide-react';

/**
 * Admin Config card for daily/weekly email digests. Saves to
 * settings/notifications (same doc as Slack), which the Netlify scheduled
 * functions (send-daily-digest / send-weekly-digest) read before sending.
 * Sends via Gmail SMTP — see netlify/functions/lib/mailer.mjs.
 */
const parseRecipients = (text) =>
  String(text || '')
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const EmailDigestCard = ({ notifySettings = {}, updateNotifySettings }) => {
  const [recipientsDraft, setRecipientsDraft] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [testState, setTestState] = React.useState({ daily: '', weekly: '' });

  const recipientsValue =
    recipientsDraft !== null
      ? recipientsDraft
      : (notifySettings.emailDigestRecipients || []).join(', ');

  const digestEnabled = notifySettings.emailDigestEnabled !== false;
  const dailyEnabled = notifySettings.emailDailyEnabled !== false;
  const weeklyEnabled = notifySettings.emailWeeklyEnabled !== false;
  const hasRecipients = (notifySettings.emailDigestRecipients || []).length > 0;

  const saveRecipients = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateNotifySettings?.({
        emailDigestRecipients: parseRecipients(recipientsDraft ?? ''),
      });
      setRecipientsDraft(null);
    } catch (err) {
      window.alert(`Could not save recipients: ${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (period) => {
    setTestState((s) => ({ ...s, [period]: 'sending' }));
    try {
      const resp = await fetch('/.netlify/functions/send-test-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.error) {
        throw new Error(data?.error || 'Request failed');
      }
      setTestState((s) => ({
        ...s,
        [period]: data?.skipped ? `Skipped — ${data.reason}` : 'Sent!',
      }));
    } catch (err) {
      setTestState((s) => ({ ...s, [period]: `Failed — ${err.message}` }));
    }
    setTimeout(() => setTestState((s) => ({ ...s, [period]: '' })), 6000);
  };

  return (
    <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm text-left">
      <h3 className="font-black text-xl mb-2 flex items-center gap-2">
        <Mail className="w-5 h-5 text-[#fd7414]" />
        Email Digests
      </h3>
      <p className="text-slate-400 text-sm font-medium mb-6">
        Sends an AI-written workspace briefing by email via Gmail SMTP, on a
        schedule (daily on weekdays, weekly on Mondays). Requires{' '}
        <code className="text-[11px]">GMAIL_USER</code>,{' '}
        <code className="text-[11px]">GMAIL_APP_PASSWORD</code>,{' '}
        <code className="text-[11px]">DIGEST_BOT_EMAIL</code>, and{' '}
        <code className="text-[11px]">DIGEST_BOT_PASSWORD</code> to be
        configured in Netlify environment variables. See{' '}
        <code className="text-[11px]">.env.example</code> for setup steps.
      </p>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2">
            Recipients
            {hasRecipients && (
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase tracking-widest">
                Configured
              </span>
            )}
          </label>
          <textarea
            rows={2}
            value={recipientsValue}
            onChange={(e) => setRecipientsDraft(e.target.value)}
            placeholder="chris@ignitepm.com, julius@ignitepm.com"
            className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
          />
          <button
            type="button"
            onClick={saveRecipients}
            disabled={saving || recipientsDraft === null}
            className="px-5 py-2.5 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30 hover:bg-slate-800 transition-all"
          >
            {saving ? 'Saving…' : 'Save recipients'}
          </button>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-100">
          <label className="flex items-center gap-3 font-bold text-slate-700">
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) => updateNotifySettings?.({ emailDigestEnabled: e.target.checked })}
            />
            Email digests enabled
          </label>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="flex items-center gap-3 font-bold text-slate-700">
              <input
                type="checkbox"
                checked={dailyEnabled}
                onChange={(e) => updateNotifySettings?.({ emailDailyEnabled: e.target.checked })}
              />
              Daily digest (weekdays)
            </label>
            <button
              type="button"
              onClick={() => sendTest('daily')}
              disabled={testState.daily === 'sending'}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-slate-200 transition-all"
            >
              {testState.daily === 'sending'
                ? 'Sending…'
                : testState.daily || 'Send test'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="flex items-center gap-3 font-bold text-slate-700">
              <input
                type="checkbox"
                checked={weeklyEnabled}
                onChange={(e) => updateNotifySettings?.({ emailWeeklyEnabled: e.target.checked })}
              />
              Weekly digest (Mondays)
            </label>
            <button
              type="button"
              onClick={() => sendTest('weekly')}
              disabled={testState.weekly === 'sending'}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-slate-200 transition-all"
            >
              {testState.weekly === 'sending'
                ? 'Sending…'
                : testState.weekly || 'Send test'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailDigestCard;
