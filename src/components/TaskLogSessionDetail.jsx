import React from 'react';
import { CheckSquare } from 'lucide-react';
import { safeDisplayForReact } from '../utils/safeReactText.js';
import {
  collectCompletedTodosDuringTaskSession,
  findClientByName,
} from '../utils/taskSessionActivity.js';

export default function TaskLogSessionDetail({
  task,
  client,
  clients,
  getTodoStateForCycle,
  getBillingPeriod,
  todoCategoryKey,
  compact = false,
}) {
  const resolvedClient =
    client || findClientByName(clients, task?.clientName) || null;

  const completedDuringSession = React.useMemo(() => {
    if (!resolvedClient || !task) return [];
    return collectCompletedTodosDuringTaskSession({
      client: resolvedClient,
      task,
      getTodoStateForCycle,
      getBillingPeriod,
      todoCategoryKey,
    });
  }, [
    resolvedClient,
    task,
    getTodoStateForCycle,
    getBillingPeriod,
    todoCategoryKey,
  ]);

  const notes = String(task?.notes || '').trim();
  const labelClass = compact
    ? 'text-[9px] font-black uppercase tracking-widest text-slate-400'
    : 'text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5';

  return (
    <div className={`${compact ? 'mt-1.5' : 'mt-2'} space-y-2`}>
      <div>
        <div className={labelClass}>Progress notes</div>
        {notes ? (
          <p
            className={`${
              compact ? 'text-[11px]' : 'text-xs'
            } text-slate-600 italic whitespace-pre-wrap break-words mt-0.5`}
          >
            &quot;{notes}&quot;
          </p>
        ) : (
          <p
            className={`${
              compact ? 'text-[11px]' : 'text-xs'
            } text-slate-400 italic mt-0.5`}
          >
            No notes recorded.
          </p>
        )}
      </div>

      {completedDuringSession.length > 0 && (
        <div>
          <div className={`${labelClass} flex items-center gap-1`}>
            <CheckSquare className="w-3 h-3 shrink-0" aria-hidden />
            Completed during this session ({completedDuringSession.length})
          </div>
          <ul className="mt-1 space-y-1">
            {completedDuringSession.map((row, idx) => (
              <li
                key={`${row.kind}-${row.doneAt}-${idx}`}
                className={`${
                  compact ? 'text-[11px]' : 'text-xs'
                } text-slate-700 break-words rounded-lg bg-slate-50/80 border border-slate-100 px-2 py-1.5`}
              >
                {row.kind === 'subtask' ? (
                  <>
                    <span className="font-bold">
                      {safeDisplayForReact(row.text)}
                    </span>
                    {row.parentText ? (
                      <span className="text-slate-500 font-medium">
                        {' '}
                        · step of {safeDisplayForReact(row.parentText)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="font-bold">
                    {safeDisplayForReact(row.text)}
                  </span>
                )}
                <span className="block text-[10px] font-bold text-slate-400 mt-0.5">
                  {new Date(row.doneAt).toLocaleString(undefined, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
