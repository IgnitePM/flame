import React, { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  aggregateTimeSpent,
  formatHoursDecimal,
  formatHoursHm,
  getTimeSpentRange,
} from '../utils/timeSpentAnalytics.js';
import { staffDisplayFromEmail } from '../utils/salesPipeline.js';

const PRESETS = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'custom', label: 'Custom' },
];

const KIND_COLORS = {
  retainer: 'bg-[#fd7414]',
  project: 'bg-sky-500',
  general: 'bg-slate-400',
};

function BreakdownBars({ title, rows, totalHours, emptyLabel, colorClass = 'bg-[#fd7414]' }) {
  const max = Math.max(...rows.map((r) => r.hours), 0.0001);
  if (!rows.length || totalHours <= 0) {
    return (
      <div className="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
          {title}
        </h4>
        <p className="text-sm italic text-slate-400 text-center py-6">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm space-y-3">
      <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        {title}
      </h4>
      <ul className="space-y-3">
        {rows.map((row) => {
          const pctOfTotal = totalHours > 0 ? (row.hours / totalHours) * 100 : 0;
          const barPct = (row.hours / max) * 100;
          const color =
            typeof colorClass === 'function' ? colorClass(row) : colorClass;
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800 truncate">
                    {row.label}
                  </div>
                  {row.clientLabel ? (
                    <div className="text-[10px] font-bold text-slate-400 truncate">
                      {row.clientLabel}
                    </div>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-slate-800 tabular-nums">
                    {formatHoursHm(row.hours)}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 tabular-nums">
                    {formatHoursDecimal(row.hours)}h · {pctOfTotal.toFixed(0)}%
                  </div>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${color} transition-all`}
                  style={{ width: `${Math.max(barPct, row.hours > 0 ? 2 : 0)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Admin view: where time went in a date range (clients, retainers, projects, staff).
 */
export default function TimeSpentAnalytics({
  taskLogs = [],
  timesheets = [],
  projects = [],
  clients = [],
  adminUsers = [],
  isRestrictedStaff = false,
  user = null,
}) {
  const [preset, setPreset] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [clientId, setClientId] = useState('');
  const [staffKey, setStaffKey] = useState('');
  const [rangeOffset, setRangeOffset] = useState(0);

  const baseRange = useMemo(
    () => getTimeSpentRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );

  // Shift week/month windows with chevrons (not for custom/90d/day beyond today).
  const range = useMemo(() => {
    if (preset === 'custom' || preset === '90d' || rangeOffset === 0) {
      return baseRange;
    }
    const len = baseRange.end - baseRange.start + 1;
    return {
      start: baseRange.start + rangeOffset * len,
      end: baseRange.end + rangeOffset * len,
    };
  }, [baseRange, preset, rangeOffset]);

  const staffOptions = useMemo(() => {
    const map = new Map();
    for (const s of timesheets || []) {
      const id = String(s.userId || '').trim();
      const name = String(s.employeeName || '').trim();
      const key = (id || name || '').toLowerCase();
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: name || staffDisplayFromEmail(id, adminUsers) || key,
        });
      }
    }
    for (const a of adminUsers || []) {
      const email = String(a.email || a.id || '')
        .trim()
        .toLowerCase();
      if (!email || map.has(email)) continue;
      map.set(email, {
        key: email,
        label: staffDisplayFromEmail(email, adminUsers),
      });
    }
    return [...map.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [timesheets, adminUsers]);

  const effectiveStaffKey = isRestrictedStaff
    ? String(user?.uid || user?.email || '')
        .trim()
        .toLowerCase()
    : staffKey;

  const stats = useMemo(
    () =>
      aggregateTimeSpent({
        taskLogs,
        projects,
        clients,
        timesheets,
        rangeStart: range.start,
        rangeEnd: range.end,
        clientId,
        staffKey: effectiveStaffKey,
      }),
    [
      taskLogs,
      projects,
      clients,
      timesheets,
      range.start,
      range.end,
      clientId,
      effectiveStaffKey,
    ],
  );

  const rangeLabel = `${new Date(range.start).toLocaleDateString()} – ${new Date(
    range.end,
  ).toLocaleDateString()}`;

  const sortedClients = useMemo(
    () =>
      [...(clients || [])]
        .filter((c) => !c.archived)
        .sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || '')),
        ),
    [clients],
  );

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="font-black text-xl text-slate-800 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#fd7414]" />
              Time spent
            </h3>
            <p className="text-sm text-slate-400 font-medium mt-1">
              Where hours went — by work type, client, retainer category, and project.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {preset !== 'custom' && preset !== '90d' ? (
              <>
                <button
                  type="button"
                  onClick={() => setRangeOffset((o) => o - 1)}
                  className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50"
                  title="Previous period"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setRangeOffset((o) => Math.min(0, o + 1))}
                  disabled={rangeOffset >= 0}
                  className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-30"
                  title="Next period"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            ) : null}
            <span className="text-xs font-bold text-slate-500 px-2">{rangeLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPreset(p.id);
                setRangeOffset(0);
              }}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${
                preset === p.id
                  ? 'bg-[#fd7414] text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 space-y-1">
              From
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 space-y-1">
              To
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              />
            </label>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 space-y-1">
            Client
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
            >
              <option value="">All clients</option>
              {sortedClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {!isRestrictedStaff ? (
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 space-y-1">
              Staff
              <select
                value={staffKey}
                onChange={(e) => setStaffKey(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"
              >
                <option value="">Everyone</option>
                {staffOptions.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Total time
          </div>
          <div className="text-3xl font-black text-slate-900 mt-1 tabular-nums">
            {formatHoursHm(stats.totalHours)}
          </div>
          <div className="text-xs font-bold text-slate-400 mt-1">
            {formatHoursDecimal(stats.totalHours)} hours
          </div>
        </div>
        {stats.byKind.map((k) => (
          <div
            key={k.key}
            className="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm"
          >
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {k.label}
            </div>
            <div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
              {formatHoursHm(k.hours)}
            </div>
            <div className="text-xs font-bold text-slate-400 mt-1">
              {stats.totalHours > 0
                ? `${((k.hours / stats.totalHours) * 100).toFixed(0)}% of total`
                : '—'}
            </div>
          </div>
        ))}
      </div>

      <BreakdownBars
        title="Work type"
        rows={stats.byKind.filter((r) => r.hours > 0)}
        totalHours={stats.totalHours}
        emptyLabel="No time logged in this range."
        colorClass={(row) => KIND_COLORS[row.key] || 'bg-slate-400'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BreakdownBars
          title="By client"
          rows={stats.byClient.slice(0, 25)}
          totalHours={stats.totalHours}
          emptyLabel="No client time in this range."
        />
        <BreakdownBars
          title="By retainer category"
          rows={stats.byCategory.slice(0, 25)}
          totalHours={stats.totalHours}
          emptyLabel="No retainer-category time in this range."
          colorClass="bg-emerald-500"
        />
        <BreakdownBars
          title="By custom project"
          rows={stats.byProject.slice(0, 25)}
          totalHours={stats.totalHours}
          emptyLabel="No custom-project time in this range."
          colorClass="bg-sky-500"
        />
        <BreakdownBars
          title="By staff"
          rows={stats.byStaff.slice(0, 25)}
          totalHours={stats.totalHours}
          emptyLabel="No staff time in this range."
          colorClass="bg-violet-500"
        />
      </div>
    </div>
  );
}
