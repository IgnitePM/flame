import React, { useMemo, useState } from 'react';
import {
  collectClientTaskApprovalRows,
  isTodoPendingApproval,
  todoApprovalBadgeLabel,
  TODO_APPROVAL,
  getTodoApprovalStatus,
} from '../utils/todoApproval.js';
import { nextBillingCycleStart } from '../utils/billingEngine.js';
import { formatReviewDeadlineLabel } from '../utils/todoUrgency.js';
import { TextWithLinks } from '../utils/textWithLinks.jsx';
import {
  TodoApprovalBadge,
  canCurrentUserDecideStaffApproval,
} from './TaskApprovalModal.jsx';

function formatCycleLabel(cycleStart, billingDay) {
  const start = Number(cycleStart || 0);
  if (!start) return 'Unknown cycle';
  const end = nextBillingCycleStart(billingDay || 1, start) - 1;
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  try {
    return `${new Date(start).toLocaleDateString(undefined, opts)} – ${new Date(
      end,
    ).toLocaleDateString(undefined, opts)}`;
  } catch {
    return new Date(start).toLocaleDateString();
  }
}

function formatWhen(ms) {
  const n = Number(ms || 0);
  if (!n) return '';
  try {
    return new Date(n).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function historyStatusLabel(item) {
  if (isTodoPendingApproval(item)) return todoApprovalBadgeLabel(item);
  const s = getTodoApprovalStatus(item);
  if (s === TODO_APPROVAL.REVISION_REQUESTED) return 'Revisions requested';
  if (Number(item?.approvalDecisionAt || 0) > 0) {
    if (item?.done) return 'Approved';
    return 'Decision recorded';
  }
  return 'Approval';
}

/**
 * Agency client Approvals: retainer task approvals across all billing cycles.
 */
export default function ClientTaskApprovalsPanel({
  client,
  getBillingPeriod,
  getTodoStateForCycle,
  todoCategoryKey,
  projects = [],
  currentCycleStart = null,
  onOpenApproval,
  onResendApproval,
  resendBusyKey = '',
  currentUserEmail = '',
}) {
  const [filter, setFilter] = useState('all'); // pending | history | all

  const rows = useMemo(
    () =>
      collectClientTaskApprovalRows(client, {
        getBillingPeriod,
        getTodoStateForCycle,
        todoCategoryKey,
        projects,
      }),
    [client, getBillingPeriod, getTodoStateForCycle, todoCategoryKey, projects],
  );

  const visible = useMemo(() => {
    if (filter === 'pending') return rows.filter((r) => r.pending);
    if (filter === 'history') return rows.filter((r) => !r.pending);
    return rows;
  }, [rows, filter]);

  const pendingCount = rows.filter((r) => r.pending).length;
  const historyCount = rows.length - pendingCount;
  const billingDay = client?.billingDay || 1;
  const liveCycle = Number(
    currentCycleStart ||
      (getBillingPeriod ? getBillingPeriod(billingDay, 0).start : 0),
  );

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Retainer task approvals
          </h5>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Pending and past decisions across every billing cycle — not just the
            cycle selected above.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'all', label: `All (${rows.length})` },
            { id: 'pending', label: `Pending (${pendingCount})` },
            { id: 'history', label: `History (${historyCount})` },
          ].map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                filter === chip.id
                  ? 'bg-[#fd7414] text-white border-[#fd7414]'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs italic text-slate-400 bg-white border border-slate-200 rounded-2xl p-6 text-center">
          {filter === 'pending'
            ? 'No tasks awaiting approval across cycles.'
            : filter === 'history'
              ? 'No past approval decisions yet.'
              : 'No retainer task approvals yet. Send a task for approval from Tasks.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => {
            const item = row.item;
            const key = `${row.cycleStart}__${row.categoryKey}__${item.id}`;
            const isCurrentCycle = Number(row.cycleStart) === liveCycle;
            const detail = String(item.approvalNote || '').trim();
            const decision = String(item.approvalDecisionNote || '').trim();
            const busyResend =
              resendBusyKey === `${client?.id}__${row.categoryKey}__${item.id}`;
            return (
              <li
                key={key}
                className={`bg-white border rounded-2xl p-4 space-y-3 ${
                  row.pending
                    ? 'border-violet-200'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {row.categoryLabel}
                      </span>
                      <TodoApprovalBadge item={item} />
                      {!row.pending ? (
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-slate-200 text-slate-500 bg-slate-50">
                          {historyStatusLabel(item)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm font-black text-slate-900">
                      {item.text || '(No description)'}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400">
                      Cycle:{' '}
                      <span className="text-slate-600">
                        {formatCycleLabel(row.cycleStart, billingDay)}
                      </span>
                      {isCurrentCycle ? (
                        <span className="ml-1 text-[#fd7414]">· Current</span>
                      ) : (
                        <span className="ml-1 text-slate-400">· Past</span>
                      )}
                    </p>
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 text-right shrink-0">
                    {row.pending
                      ? item.approvalRequestedAt
                        ? `Requested ${formatWhen(item.approvalRequestedAt)}`
                        : ''
                      : item.approvalDecisionAt
                        ? `Decided ${formatWhen(item.approvalDecisionAt)}`
                        : item.approvalRequestedAt
                          ? `Requested ${formatWhen(item.approvalRequestedAt)}`
                          : ''}
                  </div>
                </div>

                {detail ? (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 space-y-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Review note
                    </div>
                    <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap break-words">
                      <TextWithLinks text={detail} />
                    </p>
                  </div>
                ) : null}

                {decision ? (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 space-y-1">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Decision note
                    </div>
                    <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap break-words">
                      <TextWithLinks text={decision} />
                    </p>
                  </div>
                ) : null}

                {row.pending && item.reviewDeadline ? (
                  <p className="text-[11px] font-bold text-violet-800">
                    {item.approvalAutoApprove
                      ? `Auto-approves on ${formatReviewDeadlineLabel(item.reviewDeadline)}`
                      : `Review by ${formatReviewDeadlineLabel(item.reviewDeadline)}`}
                  </p>
                ) : null}

                {row.pending ? (
                  <div className="flex flex-wrap gap-2">
                    {typeof onOpenApproval === 'function' &&
                    canCurrentUserDecideStaffApproval(item, currentUserEmail) ? (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenApproval(
                            client,
                            row.cycleStart,
                            row.categoryKey,
                            item,
                            'decide',
                          )
                        }
                        className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-violet-800 bg-violet-50 hover:bg-violet-100 border border-violet-100"
                      >
                        Review
                      </button>
                    ) : null}
                    {typeof onResendApproval === 'function' ? (
                      <button
                        type="button"
                        disabled={busyResend}
                        onClick={() =>
                          onResendApproval(
                            client,
                            row.cycleStart,
                            row.categoryKey,
                            item,
                            )
                        }
                        className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-[#fd7414] bg-orange-50 hover:bg-orange-100 border border-orange-100 disabled:opacity-50"
                      >
                        {busyResend ? 'Resending…' : 'Resend email'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
