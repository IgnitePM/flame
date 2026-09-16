import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, ExternalLink, RefreshCw, Unlink } from 'lucide-react';
import { authedFetch } from '../utils/authedFetch.js';

function formatEventWhen(ev) {
  if (!ev?.start) return '';
  try {
    if (ev.allDay) {
      const d = new Date(`${String(ev.start).slice(0, 10)}T12:00:00`);
      return d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : null;
    const day = start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const t0 = start.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    if (!end || Number.isNaN(end.getTime())) return `${day} · ${t0}`;
    const sameDay = start.toDateString() === end.toDateString();
    const t1 = end.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return sameDay ? `${day} · ${t0}–${t1}` : `${day} ${t0} → ${t1}`;
  } catch {
    return String(ev.start);
  }
}

/**
 * Kiosk panel: connect personal Google Calendar + show upcoming events.
 */
export default function KioskCalendarPanel() {
  const [status, setStatus] = useState({ loading: true, connected: false });
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/calendar-oauth-status', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not load calendar status.');
      const connected = Boolean(data.connected);
      setStatus({
        loading: false,
        connected,
        calendarEmail: data.calendarEmail || '',
        connectedAt: data.connectedAt || null,
      });
      if (!connected) {
        setEvents([]);
        return;
      }
      const evResp = await authedFetch('/.netlify/functions/calendar-events', {
        days: 7,
      });
      const evData = await evResp.json().catch(() => ({}));
      if (!evResp.ok) throw new Error(evData.error || 'Could not load events.');
      setEvents(Array.isArray(evData.events) ? evData.events : []);
    } catch (err) {
      setStatus((s) => ({ ...s, loading: false }));
      setError(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const cal = params.get('calendar');
      if (!cal) return;
      if (cal === 'connected') {
        setBanner('Google Calendar connected.');
        setKioskTabHint();
        refresh();
      } else if (cal === 'error') {
        setBanner(params.get('calendarMsg') || 'Calendar connect failed.');
      }
      params.delete('calendar');
      params.delete('calendarMsg');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', next);
    } catch {
      /* ignore */
    }
  }, [refresh]);

  const setKioskTabHint = () => {
    try {
      window.dispatchEvent(new CustomEvent('kiosk-open-calendar'));
    } catch {
      /* ignore */
    }
  };

  const connect = async () => {
    if (busy) return;
    setBusy('connect');
    setBanner('');
    setError('');
    try {
      const resp = await authedFetch('/.netlify/functions/calendar-oauth-start', {});
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not start Calendar connect.');
      if (!data.authUrl) throw new Error('No auth URL returned.');
      window.location.href = data.authUrl;
    } catch (err) {
      setError(err?.message || String(err));
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (busy) return;
    const ok = window.confirm('Disconnect Google Calendar from the kiosk?');
    if (!ok) return;
    setBusy('disconnect');
    setBanner('');
    setError('');
    try {
      const resp = await authedFetch(
        '/.netlify/functions/calendar-oauth-disconnect',
        {},
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not disconnect.');
      setStatus({ loading: false, connected: false, calendarEmail: '' });
      setEvents([]);
      setBanner('Google Calendar disconnected.');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy('');
    }
  };

  if (status.loading) {
    return (
      <div className="text-xs text-slate-400 font-bold py-6 text-center">
        Loading calendar…
      </div>
    );
  }

  return (
    <div className="space-y-3 min-h-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            <Calendar className="w-3.5 h-3.5" aria-hidden />
            Your calendar
          </div>
          <p className="text-[10px] font-bold text-slate-400 leading-snug mt-1">
            {status.connected
              ? `Next 7 days${status.calendarEmail ? ` · ${status.calendarEmail}` : ''}`
              : 'Connect your Google Calendar to see upcoming events here.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {status.connected && (
            <>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => refresh()}
                className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={disconnect}
                className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                title="Disconnect"
              >
                <Unlink className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {banner ? (
        <p className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          {error}
        </p>
      ) : null}

      {!status.connected ? (
        <button
          type="button"
          disabled={!!busy}
          onClick={connect}
          className="w-full px-4 py-3 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest hover:bg-black disabled:opacity-50"
        >
          {busy === 'connect' ? 'Opening Google…' : 'Connect Google Calendar'}
        </button>
      ) : events.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-4 text-center">
          No upcoming events in the next 7 days.
        </p>
      ) : (
        <ul className="space-y-2 max-h-[min(60vh,420px)] overflow-y-auto pr-1">
          {events.map((ev) => (
            <li
              key={ev.id || `${ev.start}-${ev.title}`}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-900 truncate">
                    {ev.title}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 mt-0.5">
                    {formatEventWhen(ev)}
                    {ev.allDay ? ' · All day' : ''}
                  </div>
                  {ev.location ? (
                    <div className="text-[10px] font-medium text-slate-400 truncate mt-0.5">
                      {ev.location}
                    </div>
                  ) : null}
                </div>
                {ev.htmlLink ? (
                  <a
                    href={ev.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-[#fd7414] hover:bg-white"
                    title="Open in Google Calendar"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
