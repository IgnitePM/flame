import React from 'react';
import { ChevronLeft, ChevronRight, FileDown } from 'lucide-react';

/**
 * Staff-hours view for payroll entry (Wagepoint). Groups completed shifts into
 * configurable pay periods and shows hours as decimals for direct entry.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const parseDateInput = (value) => {
  if (!value) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Returns { start, end } ms for the pay period at `offset` (0 = current,
 * -1 = previous, ...). `anchor` is any known period start date.
 */
export function getPayPeriod(frequency, anchorDate, offset = 0, now = Date.now()) {
  if (frequency === 'monthly') {
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime() - 1;
    return { start: start.getTime(), end };
  }

  if (frequency === 'semimonthly') {
    const d = new Date(now);
    // Half-period index: months * 2 (+1 if on/after the 16th).
    let idx = d.getFullYear() * 24 + d.getMonth() * 2 + (d.getDate() >= 16 ? 1 : 0);
    idx += offset;
    const year = Math.floor(idx / 24);
    const rem = idx - year * 24;
    const month = Math.floor(rem / 2);
    const secondHalf = rem % 2 === 1;
    const start = new Date(year, month, secondHalf ? 16 : 1);
    const end = secondHalf
      ? new Date(year, month + 1, 1).getTime() - 1
      : new Date(year, month, 16).getTime() - 1;
    return { start: start.getTime(), end };
  }

  // weekly / biweekly: anchored repeating window
  const len = frequency === 'weekly' ? 7 * DAY_MS : 14 * DAY_MS;
  const anchorParsed = parseDateInput(anchorDate);
  const anchor = anchorParsed ? anchorParsed.getTime() : startOfDay(now);
  const todayStart = startOfDay(now);
  const periodsSinceAnchor = Math.floor((todayStart - anchor) / len);
  const start = anchor + (periodsSinceAnchor + offset) * len;
  return { start, end: start + len - 1 };
}

const shiftDurationMs = (shift, now = Date.now()) => {
  const saved = Number(shift.duration ?? shift.totalSavedDuration ?? 0);
  if (shift.status === 'active') {
    return (
      Number(shift.totalSavedDuration || 0) +
      Math.max(0, now - (shift.lastResumeTime || shift.clockInTime || now))
    );
  }
  return saved;
};

const fmtDate = (ms) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const fmtDecimalHours = (ms) => (ms / 3600000).toFixed(2);

const fmtHM = (ms) => {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
};

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly (every 2 weeks)' },
  { value: 'semimonthly', label: 'Semi-monthly (1st–15th, 16th–end)' },
  { value: 'monthly', label: 'Monthly' },
];

const PayrollView = ({ timesheets = [], policy = {}, updatePolicy, canEditSettings = false }) => {
  const [offset, setOffset] = React.useState(0);
  const [expandedKey, setExpandedKey] = React.useState(null);

  const frequency = policy.payrollFrequency || 'biweekly';
  const anchorDate = policy.payrollAnchorDate || '';

  const needsAnchor = frequency === 'weekly' || frequency === 'biweekly';
  const anchorMissing = needsAnchor && !anchorDate;

  const period = React.useMemo(
    () => getPayPeriod(frequency, anchorDate, offset),
    [frequency, anchorDate, offset],
  );

  const rows = React.useMemo(() => {
    const byEmployee = new Map();
    for (const shift of timesheets) {
      const inTime = Number(shift.clockInTime || 0);
      if (!inTime || inTime < period.start || inTime > period.end) continue;
      const key = shift.userId || shift.employeeName || 'unknown';
      const entry = byEmployee.get(key) || {
        key,
        name: shift.employeeName || 'Unknown',
        shifts: [],
        totalMs: 0,
        hasActive: false,
        hasAutoStopped: false,
      };
      const dur = shiftDurationMs(shift);
      entry.shifts.push({ ...shift, _durMs: dur });
      entry.totalMs += dur;
      if (shift.status === 'active' || shift.status === 'break') entry.hasActive = true;
      if (shift.autoStoppedReason === 'idle_timeout') entry.hasAutoStopped = true;
      byEmployee.set(key, entry);
    }
    const list = [...byEmployee.values()];
    list.forEach((e) =>
      e.shifts.sort((a, b) => (a.clockInTime || 0) - (b.clockInTime || 0)),
    );
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [timesheets, period.start, period.end]);

  const totalAllMs = rows.reduce((acc, r) => acc + r.totalMs, 0);

  const exportCsv = () => {
    const startStr = new Date(period.start).toISOString().slice(0, 10);
    const endStr = new Date(period.end).toISOString().slice(0, 10);
    const header = [
      'Employee',
      'Period Start',
      'Period End',
      'Shifts',
      'Hours (decimal)',
      'Hours (h:mm)',
      'Notes',
    ];
    const lines = rows.map((r) => [
      r.name,
      startStr,
      endStr,
      r.shifts.length,
      fmtDecimalHours(r.totalMs),
      fmtHM(r.totalMs),
      [
        r.hasActive ? 'Has an open shift (hours still accumulating)' : '',
        r.hasAutoStopped ? 'Includes auto clock-out (idle) — verify' : '',
      ]
        .filter(Boolean)
        .join('; '),
    ]);
    const csv = [header, ...lines]
      .map((row) =>
        row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','),
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Payroll_Hours_${startStr}_to_${endStr}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Pay cycle settings */}
      <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">
          Pay Cycle Settings
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">
              Pay frequency
            </label>
            <select
              value={frequency}
              disabled={!canEditSettings}
              onChange={(e) => {
                updatePolicy?.({ payrollFrequency: e.target.value });
                setOffset(0);
              }}
              className="w-full bg-slate-50 border-none p-4 rounded-2xl text-sm font-bold outline-none disabled:opacity-60"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {needsAnchor && (
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">
                A pay period start date
              </label>
              <input
                type="date"
                value={anchorDate}
                disabled={!canEditSettings}
                onChange={(e) => {
                  updatePolicy?.({ payrollAnchorDate: e.target.value });
                  setOffset(0);
                }}
                className="w-full bg-slate-50 border-none p-4 rounded-2xl text-sm font-bold outline-none disabled:opacity-60"
              />
              <p className="text-[10px] text-slate-400 mt-1 ml-2">
                Pick the first day of any past pay period from Wagepoint; cycles repeat from there.
              </p>
            </div>
          )}
          <div className="md:text-right">
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-800 hover:bg-black disabled:opacity-40 text-white font-black text-xs uppercase tracking-widest transition-all"
            >
              <FileDown className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>
        {anchorMissing && (
          <p className="text-xs font-bold text-amber-600 mt-3">
            Set a pay period start date above so periods line up with Wagepoint. Until then,
            periods are counted from today.
          </p>
        )}
      </div>

      {/* Period navigation */}
      <div className="bg-white p-4 rounded-[32px] border border-slate-100 shadow-sm flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOffset((o) => o - 1)}
          className="p-3 rounded-2xl bg-slate-100 hover:bg-slate-200 transition-all"
          aria-label="Previous pay period"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <div className="font-black text-slate-900">
            {fmtDate(period.start)} — {fmtDate(period.end)}
          </div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {offset === 0
              ? 'Current period'
              : offset === -1
                ? 'Previous period'
                : `${Math.abs(offset)} periods ${offset < 0 ? 'ago' : 'ahead'}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {offset !== 0 && (
            <button
              type="button"
              onClick={() => setOffset(0)}
              className="px-4 py-2 rounded-2xl bg-orange-50 text-[#fd7414] font-black text-[10px] uppercase tracking-widest hover:bg-orange-100 transition-all"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            className="p-3 rounded-2xl bg-slate-100 hover:bg-slate-200 transition-all"
            aria-label="Next pay period"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Hours table */}
      <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <th className="px-6 py-4">Employee</th>
              <th className="px-6 py-4 text-right">Shifts</th>
              <th className="px-6 py-4 text-right">Hours (h:mm)</th>
              <th className="px-6 py-4 text-right">Hours (decimal)</th>
              <th className="px-6 py-4" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.key}>
                <tr className="border-t border-slate-100">
                  <td className="px-6 py-4">
                    <div className="font-black text-slate-900">{r.name}</div>
                    {r.hasActive && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase tracking-widest">
                        Open shift — still accumulating
                      </span>
                    )}
                    {r.hasAutoStopped && (
                      <span className="inline-block mt-1 ml-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest">
                        Includes auto clock-out — verify
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-slate-600">
                    {r.shifts.length}
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-slate-600 font-mono">
                    {fmtHM(r.totalMs)}
                  </td>
                  <td className="px-6 py-4 text-right font-black text-slate-900 font-mono text-lg">
                    {fmtDecimalHours(r.totalMs)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedKey(expandedKey === r.key ? null : r.key)
                      }
                      className="text-[10px] font-black uppercase tracking-widest text-[#fd7414] hover:underline"
                    >
                      {expandedKey === r.key ? 'Hide shifts' : 'View shifts'}
                    </button>
                  </td>
                </tr>
                {expandedKey === r.key && (
                  <tr className="border-t border-slate-50 bg-slate-50/60">
                    <td colSpan={5} className="px-6 py-4">
                      <ul className="space-y-1">
                        {r.shifts.map((s) => (
                          <li
                            key={s.id}
                            className="flex flex-wrap justify-between gap-2 text-xs font-medium text-slate-600"
                          >
                            <span>
                              {new Date(s.clockInTime).toLocaleDateString(undefined, {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}{' '}
                              ·{' '}
                              {new Date(s.clockInTime).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                              {' — '}
                              {s.clockOutTime
                                ? new Date(s.clockOutTime).toLocaleTimeString([], {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })
                                : 'open'}
                              {s.autoStoppedReason === 'idle_timeout' && (
                                <span className="ml-2 text-amber-600 font-bold">
                                  auto clock-out
                                </span>
                              )}
                              {s.isManual && (
                                <span className="ml-2 text-slate-400 font-bold">manual</span>
                              )}
                            </span>
                            <span className="font-mono font-bold">
                              {fmtHM(s._durMs)} ({fmtDecimalHours(s._durMs)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {rows.length > 0 && (
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-6 py-4 font-black text-slate-900 uppercase text-xs tracking-widest">
                  Total
                </td>
                <td className="px-6 py-4 text-right font-bold text-slate-600">
                  {rows.reduce((acc, r) => acc + r.shifts.length, 0)}
                </td>
                <td className="px-6 py-4 text-right font-bold text-slate-600 font-mono">
                  {fmtHM(totalAllMs)}
                </td>
                <td className="px-6 py-4 text-right font-black text-slate-900 font-mono text-lg">
                  {fmtDecimalHours(totalAllMs)}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-10 text-center text-sm font-bold text-slate-400">
            No shifts in this pay period.
          </div>
        )}
      </div>
    </div>
  );
};

export default PayrollView;
