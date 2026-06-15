import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  collectCompletedTodosForCycle,
  collectCycleNotesForCycle,
  collectHourMovesForCycle,
} from '../utils/cycleActivity.js';
import { getEnabledRetainerCategoryNames } from '../utils/retainerCategories.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';
import RetainerCategoryStats from './RetainerCategoryStats.jsx';
import TaskLogTimesheetRow from './TaskLogTimesheetRow.jsx';

function Section({ title, children, empty }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <h6 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">
        {title}
      </h6>
      {empty ? (
        <p className="text-xs italic text-slate-400">{empty}</p>
      ) : (
        children
      )}
    </div>
  );
}

export default function ClientCycleActivityPanel({
  client,
  cycleStart,
  cycleEnd,
  stats,
  periodTasks = [],
  periodExps = [],
  periodProjectTasks = [],
  periodProjectExps = [],
  getTodoStateForCycle,
  todoCategoryKey,
  getBillingPeriod,
  projects = [],
  formatTime,
  getTaskDuration,
  timesheets = [],
  startEditing,
  onDeleteTask,
  isRestrictedStaff = false,
  canGoPrev,
  canGoNext,
  onPrevCycle,
  onNextCycle,
  isCycleLocked = false,
}) {
  const completedTodos = React.useMemo(
    () =>
      collectCompletedTodosForCycle(
        client,
        cycleStart,
        getTodoStateForCycle,
        projects,
        todoCategoryKey,
      ),
    [client, cycleStart, getTodoStateForCycle, projects, todoCategoryKey],
  );

  const cycleNotes = React.useMemo(
    () => collectCycleNotesForCycle(client, cycleStart, todoCategoryKey),
    [client, cycleStart, todoCategoryKey],
  );

  const hourMoves = React.useMemo(
    () => collectHourMovesForCycle(client, cycleStart),
    [client, cycleStart],
  );

  const loggedTasks = [...periodTasks, ...periodProjectTasks].sort(
    (a, b) => Number(a.clockInTime || 0) - Number(b.clockInTime || 0),
  );

  const categoryUsage = getEnabledRetainerCategoryNames(client)
    .map((cat) => {
      const catStats = stats?.perCategory?.[cat];
      const used = Number(stats?.categoryBreakdown?.[cat] || 0);
      const allotted = Number(catStats?.adjustedAllotted || client.retainers?.[cat] || 0);
      return { cat, used, allotted, catStats };
    })
    .filter((row) => row.allotted > 0 || row.used > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <h5 className="text-sm font-black text-slate-800 uppercase tracking-widest">
            Cycle activity
          </h5>
          <p className="text-xs text-slate-500 mt-1">
            {new Date(cycleStart).toLocaleDateString()} –{' '}
            {new Date(cycleEnd).toLocaleDateString()}
            {isCycleLocked ? ' · Locked' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onPrevCycle}
            disabled={!canGoPrev}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30"
            title="Previous billing cycle"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNextCycle}
            disabled={!canGoNext}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-30"
            title="Next billing cycle"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section
          title="Retainer usage"
          empty={categoryUsage.length ? null : 'No retainer usage this cycle.'}
        >
          <ul className="space-y-3">
            {categoryUsage.map(({ cat, catStats }) => (
              <li
                key={cat}
                className="rounded-xl bg-white border border-slate-100 px-3 py-3"
              >
                <div className="text-sm font-black text-slate-800 break-words mb-2">
                  {cat}
                </div>
                <RetainerCategoryStats
                  client={client}
                  categoryName={cat}
                  catStats={catStats}
                  baseFallback={Number(client.retainers?.[cat] || 0)}
                  cycleStart={cycleStart}
                  cycleEnd={cycleEnd}
                  variant="compact"
                  showCycleDates={false}
                  showDaysLeft={false}
                />
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Completed checklist items"
          empty={completedTodos.length ? null : 'No completed to-dos recorded this cycle.'}
        >
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {completedTodos.map((row, idx) => (
              <li
                key={`${row.kind}-${row.doneAt}-${idx}`}
                className="rounded-xl bg-white border border-slate-100 px-3 py-2"
              >
                <div className="text-xs font-bold text-slate-800 break-words">
                  {row.kind === 'subtask' ? (
                    <>
                      {safeDisplayForReact(row.text)}
                      {row.parentText ? (
                        <span className="text-slate-500 font-medium">
                          {' '}
                          · {safeDisplayForReact(row.parentText)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    safeDisplayForReact(row.text)
                  )}
                </div>
                <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                  {row.categoryLabel} ·{' '}
                  {new Date(row.doneAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Logged time & notes"
          empty={loggedTasks.length ? null : 'No time entries this cycle.'}
        >
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {loggedTasks.map((task) => (
              <li key={task.id}>
                <TaskLogTimesheetRow
                  task={task}
                  client={client}
                  timesheets={timesheets}
                  getTodoStateForCycle={getTodoStateForCycle}
                  getBillingPeriod={getBillingPeriod}
                  todoCategoryKey={todoCategoryKey}
                  formatTime={formatTime}
                  getTaskDuration={getTaskDuration}
                  headerLine={`${task.projectName || '—'}${task.projectId ? ' · Project' : ''}`}
                  canEdit={!isRestrictedStaff && !!startEditing}
                  canDelete={!isRestrictedStaff && !!onDeleteTask}
                  onEdit={
                    !isRestrictedStaff && startEditing
                      ? (t) => startEditing('task', t)
                      : undefined
                  }
                  onDelete={!isRestrictedStaff ? onDeleteTask : undefined}
                />
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Expenses"
          empty={periodExps.length + periodProjectExps.length ? null : 'No expenses this cycle.'}
        >
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {[...periodExps, ...periodProjectExps]
              .sort((a, b) => Number(a.date || 0) - Number(b.date || 0))
              .map((exp) => (
                <li
                  key={exp.id}
                  className="rounded-xl bg-white border border-slate-100 px-3 py-2 flex flex-col gap-1 sm:flex-row sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 break-words">
                      {exp.category || '—'}
                      {exp.description ? ` · ${String(exp.description)}` : ''}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400">
                      {new Date(exp.date).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="text-sm font-black text-blue-600 shrink-0">
                    ${Number(exp.finalCost || 0).toFixed(2)}
                  </span>
                </li>
              ))}
          </ul>
        </Section>

        <Section
          title="Cycle notes"
          empty={cycleNotes.length ? null : 'No cycle notes saved for this period.'}
        >
          <ul className="space-y-2">
            {cycleNotes.map((note) => (
              <li
                key={note.catKey}
                className="rounded-xl bg-white border border-slate-100 px-3 py-2"
              >
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                  {note.catKey.replace(/_/g, ' ')}
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                  {note.text}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Hour moves"
          empty={hourMoves.length ? null : 'No hour moves between categories this cycle.'}
        >
          <ul className="space-y-2">
            {hourMoves.map((move, idx) => (
              <li
                key={`${move.movedAt}-${idx}`}
                className="rounded-xl bg-white border border-slate-100 px-3 py-2 text-xs text-slate-700"
              >
                <span className="font-black text-slate-900">
                  {move.hours.toFixed(2)}h
                </span>{' '}
                from <span className="font-bold">{move.from}</span> to{' '}
                <span className="font-bold">{move.to}</span>
                {move.movedAt ? (
                  <span className="block text-[10px] font-bold text-slate-400 mt-1">
                    {new Date(move.movedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {move.movedBy ? ` · ${move.movedBy}` : ''}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
