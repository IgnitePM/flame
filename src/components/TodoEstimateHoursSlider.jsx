import React, { useEffect, useState } from 'react';

const DEFAULT_MAX = 20;
const STEP = 0.25;

/**
 * Staff control for assigning estimated hours on a retainer task.
 * Helps plan how much of a category / cycle retainer a task may use.
 *
 * Pass `onCommit` for drag-to-adjust UIs (saves on release); otherwise
 * `onChange` fires on every step (fine for modals).
 */
export default function TodoEstimateHoursSlider({
  value,
  onChange,
  onCommit,
  categoryHours = null,
  disabled = false,
  maxHours = DEFAULT_MAX,
  compact = false,
}) {
  const max = Math.max(DEFAULT_MAX, Number(maxHours) || DEFAULT_MAX, Number(value) || 0);
  const [local, setLocal] = useState(() =>
    Math.min(max, Math.max(0, Number(value) || 0)),
  );

  useEffect(() => {
    setLocal(Math.min(max, Math.max(0, Number(value) || 0)));
  }, [value, max]);

  const hours = local;
  const catHrs = Number(categoryHours);
  const hasCat = Number.isFinite(catHrs) && catHrs > 0;
  const pct = hasCat ? Math.min(999, (hours / catHrs) * 100) : null;

  const emitLive = (next) => {
    setLocal(next);
    if (!onCommit) onChange?.(next);
  };

  const commit = () => {
    if (onCommit) onCommit(hours);
    else onChange?.(hours);
  };

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Estimated hours
        </label>
        <span className="text-sm font-black text-slate-800 tabular-nums">
          {hours.toFixed(2)}h
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={STEP}
        value={hours}
        disabled={disabled}
        onChange={(e) => emitLive(Number(e.target.value))}
        onMouseUp={onCommit ? commit : undefined}
        onTouchEnd={onCommit ? commit : undefined}
        onKeyUp={onCommit ? commit : undefined}
        className="w-full accent-[#fd7414] disabled:opacity-40"
        aria-label="Estimated hours"
      />
      <div className="flex justify-between text-[10px] font-bold text-slate-400">
        <span>0h</span>
        <span>{max.toFixed(0)}h</span>
      </div>
      {pct != null ? (
        <p className="text-[10px] font-bold text-slate-500">
          ~{pct < 1 && hours > 0 ? '<1' : pct.toFixed(0)}% of this category’s monthly retainer (
          {catHrs.toFixed(1)}h)
        </p>
      ) : (
        !compact && (
          <p className="text-[10px] font-bold text-slate-500">
            Shown to the client so they can see planned retainer use.
          </p>
        )
      )}
    </div>
  );
}

export function normalizeTodoEstimatedHours(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 4) / 4;
}
