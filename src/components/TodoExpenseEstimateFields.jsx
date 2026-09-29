import React from 'react';

export const DEFAULT_EXPENSE_MARKUP_PERCENT = 30;

/** Dollar amount, or null when blank / not positive. */
export function normalizeTodoExpenseAmount(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Markup percent. Blank uses the 30% default. */
export function normalizeTodoMarkupPercent(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return DEFAULT_EXPENSE_MARKUP_PERCENT;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_EXPENSE_MARKUP_PERCENT;
  return Math.round(n * 100) / 100;
}

export function todoExpenseBilledAmount(amount, markupPercent) {
  const base = Number(amount);
  if (!Number.isFinite(base) || base <= 0) return null;
  const markup = normalizeTodoMarkupPercent(markupPercent);
  return Math.round(base * (1 + markup / 100) * 100) / 100;
}

export function formatTodoExpenseEstimate(item) {
  const billed = todoExpenseBilledAmount(
    item?.estimatedExpense,
    item?.expenseMarkupPercent,
  );
  if (billed == null) return '';
  const base = Number(item.estimatedExpense);
  const markup = normalizeTodoMarkupPercent(item?.expenseMarkupPercent);
  return `Est. expense $${base.toFixed(2)} + ${markup}% = $${billed.toFixed(2)}`;
}

/**
 * Estimated expense (raw dollars) plus a markup percent. Default markup is 30%.
 */
export default function TodoExpenseEstimateFields({
  amount = '',
  markup = String(DEFAULT_EXPENSE_MARKUP_PERCENT),
  onAmountChange,
  onMarkupChange,
  disabled = false,
}) {
  const billed = todoExpenseBilledAmount(
    amount,
    markup === '' ? DEFAULT_EXPENSE_MARKUP_PERCENT : markup,
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Estimated expense ($)
          </span>
          <input
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            disabled={disabled}
            value={amount}
            onChange={(e) => onAmountChange?.(e.target.value)}
            placeholder="0.00"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414] disabled:opacity-40"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Markup %
          </span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="decimal"
            disabled={disabled}
            value={markup}
            onChange={(e) => onMarkupChange?.(e.target.value)}
            placeholder="30"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414] disabled:opacity-40"
          />
        </label>
      </div>
      <p className="text-[10px] font-bold text-slate-500">
        {billed != null
          ? `Client total $${billed.toFixed(2)} (cost + markup).`
          : 'Optional. Markup defaults to 30% when an amount is entered.'}
      </p>
    </div>
  );
}
