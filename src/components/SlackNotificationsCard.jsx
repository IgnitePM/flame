import React from 'react';

/**
 * Admin Config card for Slack notifications. Saves to settings/notifications,
 * which the Cloud Functions read before posting to the webhook.
 */
const SlackNotificationsCard = ({ notifySettings = {}, updateNotifySettings }) => {
  const [webhookDraft, setWebhookDraft] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [testState, setTestState] = React.useState('');

  const webhookValue =
    webhookDraft !== null ? webhookDraft : notifySettings.slackWebhookUrl || '';
  const configured = !!(notifySettings.slackWebhookUrl || '').trim();

  const toggles = [
    {
      key: 'notifyIdleClockOut',
      label: 'Auto clock-out (idle failsafe fired)',
      defaultOn: true,
    },
    {
      key: 'notifyLongShift',
      label: 'Long-running shift (possible forgotten clock-out)',
      defaultOn: true,
    },
    {
      key: 'notifyProjectRequests',
      label: 'New project request from a client',
      defaultOn: true,
    },
    {
      key: 'notifyEstimateDecisions',
      label: 'Client approved/rejected an estimate',
      defaultOn: true,
    },
  ];

  const saveWebhook = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateNotifySettings?.({ slackWebhookUrl: (webhookDraft ?? '').trim() });
      setWebhookDraft(null);
    } catch (err) {
      window.alert(`Could not save webhook: ${err?.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const url = (notifySettings.slackWebhookUrl || '').trim();
    if (!url) return;
    setTestState('sending');
    try {
      // text/plain avoids a CORS preflight, which Slack webhooks don't answer.
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          text: ':wave: Test from Time Tracker — Slack notifications are wired up.',
        }),
      });
      setTestState('sent');
    } catch {
      setTestState('failed');
    }
    setTimeout(() => setTestState(''), 4000);
  };

  return (
    <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm text-left">
      <h3 className="font-black text-xl mb-2">Slack Notifications</h3>
      <p className="text-slate-400 text-sm font-medium mb-6">
        Posts alerts to a Slack channel via an incoming webhook. Toggles save
        automatically; alerts are sent by the server even when no one has the
        app open.
      </p>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2">
            Slack incoming webhook URL
            {configured && (
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase tracking-widest">
                Configured
              </span>
            )}
          </label>
          <input
            type="text"
            value={webhookValue}
            onChange={(e) => setWebhookDraft(e.target.value)}
            placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
            className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveWebhook}
              disabled={saving || webhookDraft === null}
              className="px-5 py-2.5 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-30 hover:bg-slate-800 transition-all"
            >
              {saving ? 'Saving…' : 'Save webhook'}
            </button>
            <button
              type="button"
              onClick={sendTest}
              disabled={!configured || testState === 'sending'}
              className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest disabled:opacity-30 hover:bg-slate-200 transition-all"
            >
              {testState === 'sending'
                ? 'Sending…'
                : testState === 'sent'
                  ? 'Sent — check Slack'
                  : testState === 'failed'
                    ? 'Failed to send'
                    : 'Send test message'}
            </button>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-100">
          {toggles.map((t) => (
            <label
              key={t.key}
              className="flex items-center gap-3 font-bold text-slate-700"
            >
              <input
                type="checkbox"
                checked={notifySettings[t.key] ?? t.defaultOn}
                onChange={(e) =>
                  updateNotifySettings?.({ [t.key]: e.target.checked })
                }
              />
              {t.label}
            </label>
          ))}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Long shift threshold (hours)
            </label>
            <input
              type="number"
              min="1"
              value={notifySettings.longShiftHours ?? 12}
              onChange={(e) =>
                updateNotifySettings?.({
                  longShiftHours: Math.max(1, Number(e.target.value) || 12),
                })
              }
              className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SlackNotificationsCard;
