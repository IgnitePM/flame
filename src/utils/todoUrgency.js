/**
 * Task row urgency for kiosk/admin coloring and filters.
 * Approval status wins over due-date so "awaiting client" never looks overdue-red.
 */

import {
  isTodoAwaitingClientApproval,
  isTodoAwaitingStaffApproval,
  isTodoPendingApproval,
} from './todoApproval.js';

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * @returns {'awaiting_client'|'awaiting_staff'|'overdue'|'soon'|'normal'}
 */
export function getTodoUrgencyTone(item, now = Date.now()) {
  if (isTodoAwaitingClientApproval(item)) return 'awaiting_client';
  if (isTodoAwaitingStaffApproval(item)) return 'awaiting_staff';
  const due = Number(item?.dueDate || 0);
  if (!due) return 'normal';
  if (due < now) return 'overdue';
  if (due - now <= FIVE_DAYS_MS) return 'soon';
  return 'normal';
}

/** CSS classes for kiosk dark-theme urgency cards. */
export function getKioskUrgencyClass(item, now = Date.now()) {
  const tone = getTodoUrgencyTone(item, now);
  switch (tone) {
    case 'awaiting_client':
      return 'kiosk-todo-urgency-awaiting-client border';
    case 'awaiting_staff':
      return 'kiosk-todo-urgency-awaiting-staff border';
    case 'overdue':
      return 'kiosk-todo-urgency-overdue border';
    case 'soon':
      return 'kiosk-todo-urgency-soon border';
    default:
      return 'bg-white border border-slate-100 text-slate-800';
  }
}

/** Light-theme row styles (admin Tasks / client page). */
export function getAdminTodoUrgencyStyles(item, now = Date.now()) {
  const tone = getTodoUrgencyTone(item, now);
  if (tone === 'awaiting_client') {
    return {
      rowClass: 'bg-violet-50 border border-violet-200 md:bg-violet-700 md:border-violet-800',
      textClass: item?.done
        ? 'line-through text-slate-400 opacity-70 md:text-white/80'
        : 'text-violet-950 md:text-white',
      metaClass: 'text-violet-800 md:text-white/85',
    };
  }
  if (tone === 'awaiting_staff') {
    return {
      rowClass: 'bg-indigo-50 border border-indigo-200 md:bg-indigo-700 md:border-indigo-800',
      textClass: item?.done
        ? 'line-through text-slate-400 opacity-70 md:text-white/80'
        : 'text-indigo-950 md:text-white',
      metaClass: 'text-indigo-800 md:text-white/85',
    };
  }
  if (tone === 'overdue') {
    return {
      rowClass: 'kiosk-todo-urgency-overdue border md:bg-red-600 md:border-red-700',
      textClass: item?.done
        ? 'line-through text-white/70'
        : 'text-white',
      metaClass: 'text-white/85',
    };
  }
  if (tone === 'soon') {
    return {
      rowClass: 'kiosk-todo-urgency-soon border md:bg-emerald-600 md:border-emerald-700',
      textClass: item?.done
        ? 'line-through text-white/70'
        : 'text-white',
      metaClass: 'text-white/85',
    };
  }
  return {
    rowClass: 'bg-white border border-slate-100',
    textClass: item?.done
      ? 'line-through text-slate-400 opacity-70'
      : 'text-slate-800',
    metaClass: 'text-slate-500',
  };
}

/**
 * Urgency bucket filter for kiosk Client to-dos.
 * @param {'all'|'overdue'|'due_soon'|'awaiting_approval'|'not_due_yet'} urgencyFilter
 */
export function taskMatchesUrgencyFilter(item, urgencyFilter, now = Date.now()) {
  const f = String(urgencyFilter || 'all');
  if (!f || f === 'all') return true;
  if (item?.done) return false;
  const tone = getTodoUrgencyTone(item, now);
  if (f === 'awaiting_approval') return isTodoPendingApproval(item);
  if (f === 'overdue') return tone === 'overdue';
  if (f === 'due_soon') return tone === 'soon';
  if (f === 'not_due_yet') return tone === 'normal';
  return true;
}

export function defaultClientReviewDeadlineMs(now = Date.now(), days = 5) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  d.setDate(d.getDate() + Math.max(1, Number(days) || 5));
  return d.getTime();
}

export function formatReviewDeadlineLabel(ms) {
  const n = Number(ms || 0);
  if (!n) return '';
  return new Date(n).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
