import React from 'react';
import { formatDecimalHours } from '../utils/taskLogDisplay.js';

/**
 * Visual duration picker: 0–maxHours on a slider (15-minute steps).
 * Keeps clock-in fixed; duration drives the computed end time.
 */
export default function DurationSlider({
  valueHours = 0,
  onChange,
  maxHours = 12,
  stepMinutes = 15,
  startTimeMs,
  /** Added to duration when computing displayed end time (e.g. shift breaks). */
  extraEndMs = 0,
  className = '',
}) {
  const stepHours = stepMinutes / 60;
  const max = maxHours;
  const safeVal = Math.min(max, Math.max(0, Number(valueHours) || 0));

  const formatHm = (hours) => {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  };

  const endLabel =
    startTimeMs && safeVal > 0
      ? new Date(Number(startTimeMs) + safeVal * 3600000 + Number(extraEndMs || 0)).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : startTimeMs
        ? '— (no duration)'
        : null;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-black text-[#fd7414] font-mono tabular-nums">
            {formatHm(safeVal)}
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
            {formatDecimalHours(safeVal)} decimal hours
          </div>
        </div>
        {endLabel && (
          <div className="text-right text-xs font-bold text-slate-500 max-w-[55%]">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
              Ends at
            </span>
            {endLabel}
          </div>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={stepHours}
        value={safeVal}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="w-full h-2.5 rounded-full appearance-none cursor-pointer bg-slate-200 accent-[#fd7414]"
        aria-label="Duration in hours"
      />
      <div className="flex justify-between text-[10px] font-bold text-slate-400">
        <span>0h</span>
        <span>{maxHours}h max</span>
      </div>
    </div>
  );
}
