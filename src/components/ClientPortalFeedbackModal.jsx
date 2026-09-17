import React, { useState } from 'react';
import { MessageSquareWarning, X } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';

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
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="w-5 h-5 text-[#fd7414]" />
            <div>
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                Feedback &amp; bugs
              </h4>
              <p className="text-xs font-medium text-slate-500 mt-0.5">
                Tell Ignite what you like, what&apos;s confusing, or what&apos;s broken.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4 py-2">
            <p className="text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-3">
              Thanks — your note was sent to the Ignite team.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-[#fd7414] hover:brightness-95"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('feedback')}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${
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
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${
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
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
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
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
              />
            </div>

            {error ? (
              <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || String(body || '').trim().length < 10}
                onClick={submit}
                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-white bg-[#fd7414] hover:brightness-95 disabled:opacity-40"
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
