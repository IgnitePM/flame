import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock, RotateCw } from 'lucide-react';

/**
 * Public set-password page for portal invites.
 * Opening the link does nothing to the token; only submitting sets the password.
 */
export default function PortalSetPasswordPage() {
  const token = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('token') || '';
    } catch {
      return '';
    }
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loginUrl, setLoginUrl] = useState('/');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setBusy(false);
        setError('Missing invite link. Ask Ignite to resend your portal invite.');
        return;
      }
      try {
        const resp = await fetch('/.netlify/functions/portal-set-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'validate', token }),
        });
        const data = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok || !data.ok) {
          setError(data.error || 'This link is invalid or expired.');
        } else {
          setEmail(data.email || '');
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not verify link.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const resp = await fetch('/.netlify/functions/portal-set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', token, password }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Could not set password.');
      }
      setLoginUrl(data.loginUrl || '/');
      setDone(true);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0f0f11] p-6">
      <div className="bg-white p-10 rounded-[40px] shadow-2xl border border-slate-100 flex flex-col items-center max-w-sm w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#fd7414]/10 flex items-center justify-center mb-4">
          <Lock className="w-7 h-7 text-[#fd7414]" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">
          Set your password
        </h1>
        <p className="text-slate-400 font-bold mb-6 uppercase tracking-widest text-[10px]">
          Ignite PM · Client portal
        </p>

        {busy && !done ? (
          <div className="flex items-center gap-2 text-sm font-bold text-slate-400 py-8">
            <RotateCw className="w-4 h-4 animate-spin" />
            Checking link…
          </div>
        ) : null}

        {error ? (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 font-bold w-full text-left">
            {error}
          </div>
        ) : null}

        {done ? (
          <div className="w-full space-y-4 text-left">
            <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-black text-emerald-800">Password saved</div>
                <p className="text-xs font-medium text-emerald-700 mt-1">
                  You can sign in with {email || 'your email'} now.
                </p>
              </div>
            </div>
            <a
              href={loginUrl}
              className="block w-full text-center bg-[#fd7414] text-white py-4 rounded-2xl font-black transition-all shadow-lg hover:bg-[#e66a12] active:scale-95 text-lg"
            >
              Go to sign in
            </a>
          </div>
        ) : null}

        {!busy && !done && !error && email ? (
          <form onSubmit={submit} className="w-full space-y-3 text-left">
            <div className="text-xs font-bold text-slate-500 mb-1">
              Account: <span className="text-slate-800">{email}</span>
            </div>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
              required
              minLength={8}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
              required
              minLength={8}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-[#fd7414] text-white py-4 rounded-2xl font-black transition-all shadow-lg hover:bg-[#e66a12] active:scale-95 text-lg disabled:opacity-40"
            >
              Save password
            </button>
            <p className="text-[11px] font-medium text-slate-400 text-center pt-1">
              Opening this page does not use up your invite link.
            </p>
          </form>
        ) : null}

        {!busy && error ? (
          <a
            href="/"
            className="mt-4 text-xs font-bold text-slate-500 hover:text-[#fd7414]"
          >
            Back to sign in
          </a>
        ) : null}
      </div>
    </div>
  );
}
