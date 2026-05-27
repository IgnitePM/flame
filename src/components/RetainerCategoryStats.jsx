import React from 'react';
import { isRetainerCategoryDollar } from '../utils/retainerCategories.js';
import {
  buildRetainerCategoryBreakdownParts,
  buildRetainerCategorySummary,
  computeRetainerDaysLeft,
  formatRetainerAmount,
} from '../utils/retainerCategoryStats.js';

function StatRow({ label, value, highlight, className = '' }) {
  if (value == null || value === '') return null;
  return (
    <div
      className={`flex items-baseline justify-between gap-2 text-[10px] ${className}`}
    >
      <span className="font-bold text-slate-400">{label}</span>
      <span className={`font-black text-right ${highlight || 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  );
}

export default function RetainerCategoryStats({
  client,
  categoryName,
  catStats,
  baseFallback = 0,
  cycleStart,
  cycleEnd,
  variant = 'detailed',
  showProgressBar = true,
  showCycleDates = true,
  showDaysLeft = true,
  className = '',
  tone = 'light',
}) {
  const summary = buildRetainerCategorySummary(catStats, { baseFallback });
  const isDollar =
    summary.isDollar || isRetainerCategoryDollar(client, categoryName);
  const fmt = (n) => formatRetainerAmount(n, isDollar);
  const daysLeft =
    showDaysLeft && cycleEnd ? computeRetainerDaysLeft(cycleEnd) : null;
  const breakdownParts = buildRetainerCategoryBreakdownParts(summary, isDollar);

  const textMuted = tone === 'dark' ? 'text-zinc-400' : 'text-slate-400';
  const textBody = tone === 'dark' ? 'text-zinc-100' : 'text-slate-700';
  const trackBg = tone === 'dark' ? 'bg-zinc-700' : 'bg-slate-200';

  if (variant === 'mini') {
    return (
      <div className={`text-[10px] font-bold ${textMuted} ${className}`}>
        {fmt(summary.used)} / {fmt(summary.adjustedAllotted)}
        {summary.carryover !== 0 && (
          <span className="ml-2">
            (carryover {summary.carryover > 0 ? '+' : ''}
            {fmt(summary.carryover)})
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className={`text-xs font-black ${textBody} mb-1`}>
        {fmt(summary.used)} used / {fmt(summary.adjustedAllotted)} available
        {summary.isOver ? (
          <span className="ml-2 text-red-500 text-[10px] uppercase tracking-widest">
            Over by {fmt(Math.abs(summary.remaining))}
          </span>
        ) : (
          summary.remaining > 0 &&
          variant === 'detailed' && (
            <span className="ml-2 text-emerald-600 text-[10px]">
              {fmt(summary.remaining)} remaining
            </span>
          )
        )}
      </div>

      {showProgressBar && (
        <div className={`w-full ${trackBg} rounded-full h-2 overflow-hidden mb-2`}>
          <div
            className={`h-2 rounded-full ${
              summary.isOver ? 'bg-red-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${summary.percent}%` }}
          />
        </div>
      )}

      {variant === 'compact' && breakdownParts.length > 0 && (
        <p className={`text-[10px] font-bold ${textMuted} leading-relaxed`}>
          {breakdownParts.join(' · ')}
        </p>
      )}

      {variant === 'detailed' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
          <StatRow label="Allotted per cycle" value={fmt(summary.baseActive)} />
          <StatRow
            label="Carryover from prior period"
            value={
              summary.carryover === 0
                ? fmt(0)
                : `${summary.carryover > 0 ? '+' : ''}${fmt(summary.carryover)}`
            }
            highlight={
              summary.carryover > 0
                ? 'text-emerald-700'
                : summary.carryover < 0
                  ? 'text-red-600'
                  : undefined
            }
          />
          {summary.addonPrior > 0 && (
            <StatRow
              label="Add-ons (prior cycle)"
              value={`+${fmt(summary.addonPrior)}`}
            />
          )}
          {summary.addonThis > 0 && (
            <StatRow label="Add-ons (this cycle)" value={`+${fmt(summary.addonThis)}`} />
          )}
          {!isDollar && summary.hourMoveNet !== 0 && (
            <StatRow
              label="Hour moves (net)"
              value={`${summary.hourMoveNet > 0 ? '+' : ''}${fmt(summary.hourMoveNet)}`}
            />
          )}
          <StatRow
            label={isDollar ? 'Spend this cycle' : 'Hours logged this cycle'}
            value={fmt(summary.used)}
          />
          <StatRow label="Total available" value={fmt(summary.adjustedAllotted)} />
          {!summary.isOver && summary.remaining > 0 && (
            <StatRow
              label="Remaining"
              value={fmt(summary.remaining)}
              highlight="text-emerald-700"
            />
          )}
        </div>
      )}

      {((showDaysLeft && daysLeft != null) ||
        (showCycleDates && cycleStart && cycleEnd)) && (
        <div
          className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-widest ${textMuted}`}
        >
          {showCycleDates && cycleStart && cycleEnd && (
            <span>
              Cycle: {new Date(cycleStart).toLocaleDateString()} –{' '}
              {new Date(cycleEnd).toLocaleDateString()}
            </span>
          )}
          {showDaysLeft && daysLeft != null && (
            <span>
              {daysLeft} day{daysLeft === 1 ? '' : 's'} left
            </span>
          )}
        </div>
      )}
    </div>
  );
}
