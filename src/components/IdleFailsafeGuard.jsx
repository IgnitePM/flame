import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * App-wide idle failsafe: runs on every staff route while a shift is open
 * (not only on /kiosk). Uses absolute deadlines so background/sleep still
 * clocks out. Writes lastActivityAt heartbeats for the server-side safety net.
 */
export default function IdleFailsafeGuard({
  activeShift,
  policy,
  handleIdleAutoClockOut,
  onActivityHeartbeat,
  idleClockOutNotice,
  onDismissIdleClockOutNotice,
}) {
  const lastActivityRef = useRef(Date.now());
  const idleFailsafeOpenRef = useRef(null);
  const [idleFailsafeOpen, setIdleFailsafeOpen] = useState(null);
  const [idleFailsafeNowMs, setIdleFailsafeNowMs] = useState(Date.now());
  const lastHeartbeatWriteRef = useRef(0);

  const idleFailsafeMin = Number(policy?.idleFailsafeMinutes || 0);
  const idleFailsafeConfirmSec = Math.max(
    10,
    Number(policy?.idleFailsafeConfirmSeconds) || 120,
  );

  const closeIdleFailsafe = useCallback(() => {
    idleFailsafeOpenRef.current = null;
    setIdleFailsafeOpen(null);
  }, []);

  useEffect(() => {
    if (activeShift?.id) {
      lastActivityRef.current = Date.now();
      lastHeartbeatWriteRef.current = 0;
      onActivityHeartbeat?.(Date.now(), { force: true });
    } else {
      closeIdleFailsafe();
    }
  }, [activeShift?.id, closeIdleFailsafe, onActivityHeartbeat]);

  const playIdleAlertSound = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const beep = (startAt) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.55);
      };
      const t0 = ctx.currentTime;
      beep(t0);
      beep(t0 + 0.7);
      beep(t0 + 1.4);
      window.setTimeout(() => {
        ctx.close().catch(() => {});
      }, 2600);
    } catch {
      /* audio optional */
    }
  }, []);

  const showIdleNotification = useCallback((secondsLeft) => {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      const n = new Notification('Are you still working?', {
        body: `No activity detected. Confirm within ${secondsLeft} seconds or your shift will be clocked out automatically.`,
        tag: 'ignite-idle-failsafe',
        requireInteraction: true,
      });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        n.close();
      };
    } catch {
      /* notifications optional */
    }
  }, []);

  const bumpHeartbeat = useCallback(
    (at, { force = false } = {}) => {
      const now = Number(at) || Date.now();
      if (
        !force &&
        now - lastHeartbeatWriteRef.current < 60 * 1000
      ) {
        return;
      }
      lastHeartbeatWriteRef.current = now;
      onActivityHeartbeat?.(now, { force });
    },
    [onActivityHeartbeat],
  );

  const runIdleFailsafeCheck = useCallback(() => {
    if (!activeShift || typeof handleIdleAutoClockOut !== 'function') return;
    if (idleFailsafeMin <= 0) return;
    const now = Date.now();

    const open = idleFailsafeOpenRef.current;
    if (open) {
      if (now >= open.deadlineAt) {
        lastActivityRef.current = now;
        closeIdleFailsafe();
        handleIdleAutoClockOut({
          endTime: open.deadlineAt,
          source: 'confirm_expired',
        });
      }
      return;
    }

    const idleMs = now - lastActivityRef.current;
    const failsafeMs = idleFailsafeMin * 60 * 1000;
    if (idleMs < failsafeMs) return;

    const deadlineAt =
      lastActivityRef.current + failsafeMs + idleFailsafeConfirmSec * 1000;
    if (now >= deadlineAt) {
      // Deep idle (sleep / frozen tab past the confirm window): still clock out
      // to protect billing, but the caller shows an explicit notice afterward.
      lastActivityRef.current = now;
      handleIdleAutoClockOut({
        endTime: deadlineAt,
        source: 'deep_idle',
      });
      return;
    }

    idleFailsafeOpenRef.current = { deadlineAt };
    setIdleFailsafeOpen({ deadlineAt });
    setIdleFailsafeNowMs(now);
    playIdleAlertSound();
    showIdleNotification(Math.max(1, Math.round((deadlineAt - now) / 1000)));
  }, [
    activeShift,
    handleIdleAutoClockOut,
    idleFailsafeMin,
    idleFailsafeConfirmSec,
    closeIdleFailsafe,
    playIdleAlertSound,
    showIdleNotification,
  ]);

  useEffect(() => {
    if (!activeShift || typeof handleIdleAutoClockOut !== 'function') return;
    if (idleFailsafeMin <= 0) return;

    const bump = () => {
      if (idleFailsafeOpenRef.current) return;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= idleFailsafeMin * 60 * 1000) {
        runIdleFailsafeCheck();
        return;
      }
      const now = Date.now();
      lastActivityRef.current = now;
      bumpHeartbeat(now);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    window.addEventListener('scroll', bump, true);
    const onVis = () => {
      if (document.visibilityState === 'visible') runIdleFailsafeCheck();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('scroll', bump, true);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [
    activeShift,
    handleIdleAutoClockOut,
    idleFailsafeMin,
    runIdleFailsafeCheck,
    bumpHeartbeat,
  ]);

  useEffect(() => {
    if (!activeShift || idleFailsafeMin <= 0) return;
    const iv = window.setInterval(runIdleFailsafeCheck, 5000);
    return () => window.clearInterval(iv);
  }, [activeShift, idleFailsafeMin, runIdleFailsafeCheck]);

  // Soft heartbeat while the tab is open so the server can stop abandoned shifts
  // even if the employee never touches the mouse again.
  useEffect(() => {
    if (!activeShift) return;
    const iv = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (idleFailsafeOpenRef.current) return;
      bumpHeartbeat(Date.now());
    }, 2 * 60 * 1000);
    return () => window.clearInterval(iv);
  }, [activeShift, bumpHeartbeat]);

  useEffect(() => {
    if (!idleFailsafeOpen) return;
    const iv = window.setInterval(() => {
      setIdleFailsafeNowMs(Date.now());
      runIdleFailsafeCheck();
    }, 1000);
    return () => window.clearInterval(iv);
  }, [idleFailsafeOpen, runIdleFailsafeCheck]);

  const fmtWhen = (ms) => {
    try {
      return new Date(Number(ms) || 0).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const fmtDur = (ms) => {
    const totalMin = Math.max(0, Math.round(Number(ms || 0) / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  };

  return (
    <>
      {idleFailsafeOpen && activeShift ? (
        <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 text-center">
            <h3 className="text-lg font-black text-slate-900">Still working?</h3>
            <p className="text-sm font-bold text-slate-600">
              We haven&apos;t seen any activity for a while. Confirm you&apos;re still
              here, or your shift and any running task will end automatically so
              idle time is not billed.
            </p>
            <div className="text-3xl font-black text-[#fd7414] font-mono">
              {Math.max(
                0,
                Math.ceil((idleFailsafeOpen.deadlineAt - idleFailsafeNowMs) / 1000),
              )}
              s
            </div>
            <button
              type="button"
              onClick={() => {
                const now = Date.now();
                lastActivityRef.current = now;
                bumpHeartbeat(now, { force: true });
                closeIdleFailsafe();
              }}
              className="w-full py-4 rounded-2xl bg-black text-white font-black text-sm uppercase tracking-widest hover:bg-slate-800"
            >
              I&apos;m here
            </button>
          </div>
        </div>
      ) : null}

      {idleClockOutNotice ? (
        <div className="fixed inset-0 z-[310] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-lg font-black text-slate-900">
              You were auto clocked out
            </h3>
            <p className="text-sm font-medium text-slate-600">
              Your shift ended automatically after no activity, so idle time was
              not recorded as work. Review the times below — ask an admin if the
              hours need correcting.
            </p>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-sm font-bold text-slate-700">
              <div>
                Clocked out at:{' '}
                <span className="text-slate-900">
                  {fmtWhen(idleClockOutNotice.endTime)}
                </span>
              </div>
              {idleClockOutNotice.shiftDurationMs != null ? (
                <div>
                  Shift length counted:{' '}
                  <span className="text-slate-900">
                    {fmtDur(idleClockOutNotice.shiftDurationMs)}
                  </span>
                </div>
              ) : null}
              {idleClockOutNotice.taskLabel ? (
                <div>
                  Task stopped:{' '}
                  <span className="text-slate-900">
                    {idleClockOutNotice.taskLabel}
                  </span>
                  {idleClockOutNotice.taskDurationMs != null
                    ? ` (${fmtDur(idleClockOutNotice.taskDurationMs)})`
                    : ''}
                </div>
              ) : null}
              {idleClockOutNotice.source === 'server' ? (
                <div className="text-amber-800 text-xs uppercase tracking-widest">
                  Stopped by server (browser was closed or left idle)
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismissIdleClockOutNotice?.()}
              className="w-full py-3.5 rounded-2xl bg-black text-white font-black text-sm uppercase tracking-widest hover:bg-slate-800"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
