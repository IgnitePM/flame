import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, ExternalLink, X } from 'lucide-react';
import {
  db,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  setDoc,
  where,
} from '../firebase.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';

function dismissalDocId(announcementId, email) {
  const a = String(announcementId || '').trim();
  const e = String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, '_')
    .slice(0, 120);
  return `${a}__${e || 'unknown'}`;
}

function isVisibleForClient(row, clientId) {
  if (!row || row.active === false) return false;
  const ids = Array.isArray(row.clientIds) ? row.clientIds.filter(Boolean) : [];
  if (ids.length === 0) return true;
  return ids.includes(clientId);
}

/**
 * Active portal announcements for Home (dismissible per contact).
 */
export default function ClientPortalAnnouncements({
  clientId,
  portalEmail,
}) {
  const [rows, setRows] = useState([]);
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (!clientId || clientId === 'demo') {
      setRows([]);
      return undefined;
    }
    const q = query(
      collection(db, 'portalAnnouncements'),
      orderBy('createdAt', 'desc'),
      limit(40),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn('[ClientPortalAnnouncements]', err);
        setRows([]);
      },
    );
    return () => unsub();
  }, [clientId]);

  useEffect(() => {
    if (!portalEmail || !clientId || clientId === 'demo') {
      setDismissedIds(new Set());
      return undefined;
    }
    const q = query(
      collection(db, 'portalAnnouncementDismissals'),
      where('email', '==', portalEmail),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = new Set();
        snap.docs.forEach((d) => {
          const id = String(d.data()?.announcementId || '').trim();
          if (id) next.add(id);
        });
        setDismissedIds(next);
      },
      (err) => {
        console.warn('[ClientPortalAnnouncements] dismissals', err);
        setDismissedIds(new Set());
      },
    );
    return () => unsub();
  }, [portalEmail, clientId]);

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          isVisibleForClient(row, clientId) && !dismissedIds.has(row.id),
      ),
    [rows, clientId, dismissedIds],
  );

  const dismiss = async (announcementId) => {
    if (!announcementId || !portalEmail || busyId) return;
    setBusyId(announcementId);
    // Optimistic hide
    setDismissedIds((prev) => new Set([...prev, announcementId]));
    try {
      await setDoc(
        doc(
          db,
          'portalAnnouncementDismissals',
          dismissalDocId(announcementId, portalEmail),
        ),
        {
          announcementId,
          email: portalEmail,
          dismissedAt: Date.now(),
        },
        { merge: true },
      );
    } catch (err) {
      console.warn('[ClientPortalAnnouncements] dismiss failed', err);
      setDismissedIds((prev) => {
        const next = new Set(prev);
        next.delete(announcementId);
        return next;
      });
    } finally {
      setBusyId('');
    }
  };

  if (!visible.length) return null;

  return (
    <div className="space-y-3">
      {visible.map((row) => {
        const hasCta = Boolean(row.ctaUrl && String(row.ctaUrl).trim());
        const label = String(row.ctaLabel || '').trim() || 'Learn more';
        return (
          <div
            key={row.id}
            className="relative bg-gradient-to-br from-[#1a2332] to-slate-800 text-white p-6 sm:p-8 rounded-[32px] shadow-sm"
          >
            <button
              type="button"
              onClick={() => dismiss(row.id)}
              disabled={busyId === row.id}
              aria-label="Dismiss announcement"
              className="absolute top-4 right-4 touch-target p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 pr-8 sm:pr-10">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#fd7414] mb-2">
                  <Megaphone className="w-3.5 h-3.5" />
                  Announcement
                </div>
                <h3 className="font-black text-xl sm:text-2xl tracking-tight">
                  {safeDisplayForReact(row.title)}
                </h3>
                <p className="text-slate-300 text-sm font-medium mt-2 max-w-xl whitespace-pre-wrap">
                  {safeDisplayForReact(row.body)}
                </p>
              </div>
              {hasCta ? (
                <a
                  href={String(row.ctaUrl).trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center justify-center gap-2 bg-[#fd7414] hover:bg-[#e8680f] text-white px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-colors"
                >
                  {safeDisplayForReact(label)}
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
