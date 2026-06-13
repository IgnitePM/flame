import React from 'react';
import { Trash2, X } from 'lucide-react';

/**
 * Styled delete confirmation for client to-do items.
 * Recurring primaries get three choices; everything else is a simple confirm.
 */
const TodoDeleteConfirmModal = ({
  open,
  onClose,
  onConfirm,
  isRecurring = false,
  isSubtask = false,
  taskTitle = '',
  saving = false,
}) => {
  if (!open) return null;

  const title = isSubtask
    ? 'Delete sub-task?'
    : isRecurring
      ? 'Delete recurring task?'
      : 'Delete task?';

  const subtitle = isSubtask
    ? 'This sub-task will be removed permanently.'
    : isRecurring
      ? 'Choose whether to remove just this occurrence or end the whole series.'
      : 'This task will be removed permanently.';

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget && !saving) onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={handleBackdrop}
      role="presentation"
    >
      <div
        className="w-full max-w-md bg-white rounded-[28px] shadow-2xl border border-slate-100 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-delete-title"
      >
        <div className="p-6 pb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <h3
                  id="todo-delete-title"
                  className="text-base font-black text-slate-900"
                >
                  {title}
                </h3>
                {taskTitle ? (
                  <p className="text-sm font-bold text-slate-500 truncate mt-0.5">
                    {taskTitle}
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="shrink-0 p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm font-medium text-slate-600 leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div className="px-6 pb-6 flex flex-col gap-2">
          {isRecurring && !isSubtask ? (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => onConfirm?.('occurrence')}
                className="w-full text-left px-4 py-3.5 rounded-2xl border-2 border-slate-200 hover:border-[#fd7414] hover:bg-orange-50/60 transition-all disabled:opacity-40"
              >
                <span className="block text-sm font-black text-slate-900">
                  This occurrence only
                </span>
                <span className="block text-xs font-medium text-slate-500 mt-0.5">
                  Removes this instance. Future occurrences still appear on schedule.
                </span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onConfirm?.('series')}
                className="w-full text-left px-4 py-3.5 rounded-2xl border-2 border-red-200 bg-red-50/50 hover:border-red-400 hover:bg-red-50 transition-all disabled:opacity-40"
              >
                <span className="block text-sm font-black text-red-700">
                  All future occurrences
                </span>
                <span className="block text-xs font-medium text-red-600/80 mt-0.5">
                  Ends the recurring series. Open instances are removed; completed
                  history stays.
                </span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="w-full py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all disabled:opacity-40 mt-1"
              >
                Cancel
              </button>
            </>
          ) : (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onConfirm?.('occurrence')}
                className="flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-white bg-red-600 hover:bg-red-700 transition-all disabled:opacity-40"
              >
                {saving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TodoDeleteConfirmModal;
