import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  KeyRound,
  LogOut,
  MessageSquareWarning,
  Settings,
  User,
} from 'lucide-react';
import { auth, sendPasswordResetEmail } from '../firebase.js';

/**
 * Portal account menu: logo + dropdown for company, feedback, password reset, sign out.
 */
export default function PortalAccountMenu({
  client,
  userEmail = '',
  userName = '',
  onOpenFeedback,
  onOpenCompany,
  onOpenProfile,
  onSignOut,
}) {
  const [open, setOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const requestPasswordReset = async () => {
    const email = String(userEmail || '').trim();
    if (!email) {
      setResetMsg('No email on this account.');
      return;
    }
    setResetBusy(true);
    setResetMsg('');
    try {
      await sendPasswordResetEmail(auth, email);
      setResetMsg('Password reset email sent. Check your inbox.');
    } catch (err) {
      setResetMsg(err?.message || 'Could not send reset email.');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="touch-target inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 hover:bg-slate-50 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Account"
      >
        {client?.logoUrl ? (
          <img
            src={client.logoUrl}
            alt=""
            className="h-8 w-8 rounded-lg object-cover border border-slate-200 shrink-0 bg-white"
          />
        ) : (
          <span className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4 text-slate-400" />
          </span>
        )}
        <span className="hidden sm:block text-left min-w-0 max-w-[140px]">
          <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">
            Account
          </span>
          <span className="block text-xs font-bold text-slate-800 truncate mt-0.5">
            {client?.name || 'Client'}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-100 bg-white shadow-xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-50 bg-slate-50/80">
            <p className="text-sm font-black text-slate-900 truncate">
              {userName || client?.name || 'Client'}
            </p>
            {userEmail ? (
              <p className="text-[11px] font-medium text-slate-500 truncate mt-0.5">
                {userEmail}
              </p>
            ) : null}
            {client?.name && userName ? (
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1 truncate">
                {client.name}
              </p>
            ) : null}
          </div>
          <div className="p-2 space-y-0.5">
            <button
              type="button"
              role="menuitem"
              className="w-full touch-target flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                onOpenProfile?.();
              }}
            >
              <User className="w-4 h-4 text-[#fd7414]" />
              My profile
            </button>
            <button
              type="button"
              role="menuitem"
              className="w-full touch-target flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                onOpenCompany?.();
              }}
            >
              <Building2 className="w-4 h-4 text-[#fd7414]" />
              Company information
            </button>
            <button
              type="button"
              role="menuitem"
              className="w-full touch-target flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                onOpenProfile?.();
              }}
            >
              <Settings className="w-4 h-4 text-slate-500" />
              Account settings
            </button>
            <button
              type="button"
              role="menuitem"
              className="w-full touch-target flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                onOpenFeedback?.();
              }}
            >
              <MessageSquareWarning className="w-4 h-4 text-[#fd7414]" />
              Feedback &amp; bugs
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={resetBusy}
              className="w-full touch-target flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={requestPasswordReset}
            >
              <KeyRound className="w-4 h-4 text-slate-500" />
              {resetBusy ? 'Sending reset…' : 'Reset password'}
            </button>
            {resetMsg ? (
              <p className="px-3 py-2 text-[11px] font-bold text-slate-500 leading-snug">
                {resetMsg}
              </p>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="w-full touch-target flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-red-600 hover:bg-red-50"
              onClick={() => {
                setOpen(false);
                onSignOut?.();
              }}
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
