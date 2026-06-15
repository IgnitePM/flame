import React from 'react';
import { Edit3, Trash2 } from 'lucide-react';
import TaskLogSessionDetail from './TaskLogSessionDetail.jsx';
import { getTaskEmployeeName } from '../utils/taskLogDisplay.js';

/**
 * One logged task row for client timesheet views — employee, notes, todos
 * completed during session, duration, edit/delete actions.
 */
export default function TaskLogTimesheetRow({
  task,
  client,
  timesheets = [],
  getTodoStateForCycle,
  getBillingPeriod,
  todoCategoryKey,
  formatTime,
  getTaskDuration,
  headerLine,
  borderAccent = '',
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}) {
  if (!task) return null;

  const employee = getTaskEmployeeName(task, timesheets);
  const durationMs =
    typeof getTaskDuration === 'function' ? getTaskDuration(task) : 0;

  return (
    <div
      className={`bg-white p-3 rounded-xl border border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 ${borderAccent}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10px] text-slate-400 font-bold">
            {headerLine ||
              `${new Date(task.clockInTime).toLocaleDateString()} • ${task.projectName || '—'}`}
          </span>
          {task.autoStoppedReason === 'idle_timeout' && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-widest">
              Auto clock-out
            </span>
          )}
          {task.isManual && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-widest">
              Manual
            </span>
          )}
        </div>
        <div className="text-[11px] font-bold text-slate-600 mt-0.5">
          Logged by{' '}
          <span className="text-slate-800">{employee}</span>
          <span className="text-slate-400 font-medium">
            {' '}
            ·{' '}
            {new Date(task.clockInTime).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
            {task.clockOutTime
              ? ` – ${new Date(task.clockOutTime).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : ''}
          </span>
        </div>
        <TaskLogSessionDetail
          task={task}
          client={client}
          getTodoStateForCycle={getTodoStateForCycle}
          getBillingPeriod={getBillingPeriod}
          todoCategoryKey={todoCategoryKey}
          compact
        />
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="font-black text-sm text-[#fd7414] font-mono px-1">
          {formatTime?.(durationMs) ?? '—'}
        </span>
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="p-1.5 text-slate-300 hover:text-[#fd7414] transition-colors"
            title="Edit time logged"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        )}
        {canDelete && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(task)}
            className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
            title="Delete record"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
