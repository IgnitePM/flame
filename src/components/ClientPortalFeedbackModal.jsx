import React, { useState } from 'react';
import { MessageSquareWarning } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';
import MobileSafeModal from './mobile/MobileSafeModal.jsx';

/**
 * Portal modal: send product feedback or report a bug to Ignite.
 */
export default function ClientPortalFeedbackModal({
  client,
  userEmail = '',
  userName = '',
  portalSection = '',
  onClose,
}) {
  const [type, setType] = useState('feedback');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!client?.id || busy) return;
    const text = String(body || '').trim();
    if (text.length < 10) {
      setError('Please add a bit more detail (at least a sentence).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/client-feedback-submit', {
        clientId: client.id,
        type,
        subject,
        body: text,
        portalSection,
        pageUrl: typeof window !== 'undefined' ? window.location.href : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        createdByName: userName || userEmail,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not send feedback.');
      setDone(true);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MobileSafeModal
      open
      onClose={onClose}
      maxWidthClass="max-w-md"
      title={
        <span className="inline-flex items-center gap-2">
          <MessageSquareWarning className="w-5 h-5 text-[#fd7414]" />
          Feedback &amp; bugs
        </span>
      }
      subtitle="Tell Ignite what you like, what's confusing, or what's broken."
      footer={
        done ? (
          <button
            type="button"
            onClick={onClose}
            className="w-full touch-target px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-[#fd7414] hover:brightness-95"
          >
            Close
          </button>
        ) : (
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="touch-target px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || String(body || '').trim().length < 10}
              onClick={submit}
              className="touch-target px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-[#fd7414] hover:brightness-95 disabled:opacity-40"
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        )
      }
    >
      {done ? (
        <p className="text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-3">
          Thanks — your note was sent to the Ignite team.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('feedback')}
              className={`touch-target px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                type === 'feedback'
                  ? 'bg-[#fd7414] text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              Feedback
            </button>
            <button
              type="button"
              onClick={() => setType('bug')}
              className={`touch-target px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                type === 'bug'
                  ? 'bg-[#fd7414] text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              Report a bug
            </button>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
              Subject (optional)
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              placeholder={
                type === 'bug' ? 'Short summary of the issue…' : 'What is this about?'
              }
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
              Details
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder={
                type === 'bug'
                  ? 'What happened? What did you expect? Which page were you on?'
                  : 'Ideas, confusion, or anything that would make the portal more useful…'
              }
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
            />
          </div>

          {error ? (
            <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </MobileSafeModal>
  );
}
