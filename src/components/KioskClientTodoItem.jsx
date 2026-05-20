import { ChevronDown, GripVertical, Pin } from 'lucide-react';
import {
  orderTodosForDisplay,
  toggleTodoPinnedById,
  reorderTodosDisplay,
} from '../utils/todoListOrder.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';
import {
  canMarkParentTodoDone,
  effectiveSubtaskAssignees,
  getSubtasks,
  setSubtaskDoneInItems,
} from '../utils/todoSubtasks.js';

export default function KioskClientTodoItem({
  item,
  allItems,
  catTodo,
  catKey,
  cycleStart,
  client,
  todoSaving,
  setTodoSaving,
  updateClientTodo,
  canDragReorder,
  getUrgencyClass,
  user,
  canManageTodos = false,
  isCycleLocked = false,
  assigneeOpenKey,
  onAssigneeOpenChange,
  assignableEmails = [],
  onAssigneesChange,
  onOpenOptions,
}) {
  const meLower = String(user?.email || '').trim().toLowerCase();

  const canToggleSubtask = (sub) => {
    if (!meLower) return false;
    if (canManageTodos) return true;
    return effectiveSubtaskAssignees(sub, item, user?.email).includes(meLower);
  };

  const subs = getSubtasks(item);
  const assignees = Array.isArray(item.assigneeEmails)
    ? item.assigneeEmails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const assignSummary =
    assignees.length === 0
      ? 'Assign'
      : assignees.length === 1
        ? assignees[0].split('@')[0]
        : `${assignees.length} people`;
  const assignOpen = assigneeOpenKey === item.id;

  const renderAssigneePicker = (compact = false) => (
    <div className="relative">
      <button
        type="button"
        disabled={todoSaving || isCycleLocked}
        onClick={() =>
          onAssigneeOpenChange?.(assignOpen ? null : item.id)
        }
        className={`kiosk-light-control inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white font-black uppercase tracking-widest text-black disabled:opacity-40 ${
          compact ? 'px-2 py-1 text-[9px]' : 'px-2.5 py-1.5 text-[10px]'
        }`}
      >
        {assignSummary}
        <ChevronDown className="w-3 h-3" />
      </button>
      {assignOpen && (
        <div className="absolute left-0 z-[130] mt-1 w-[260px] max-w-[85vw] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
            Assign to
          </div>
          <div className="max-h-[180px] space-y-1 overflow-y-auto">
            {assignableEmails.map((email) => {
              const checked = assignees.includes(email);
              return (
                <label
                  key={email}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-bold hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked
                        ? assignees.filter((e) => e !== email)
                        : [...assignees, email].sort();
                      onAssigneesChange?.(next);
                    }}
                  />
                  <span className="truncate">{email}</span>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-600"
              onClick={() => onAssigneesChange?.([])}
            >
              Clear
            </button>
            <button
              type="button"
              className="rounded-lg bg-[#fd7414] px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white"
              onClick={() => onAssigneeOpenChange?.(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <li
      className={`flex flex-col gap-1 rounded-lg min-w-0 max-w-full ${getUrgencyClass(item)}`}
      onDragOver={
        canDragReorder
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          : undefined
      }
      onDrop={
        canDragReorder
          ? (e) => {
              e.preventDefault();
              const draggedId = e.dataTransfer.getData('text/plain');
              if (!draggedId || draggedId === item.id) return;
              const disp = orderTodosForDisplay(allItems);
              const fromIdx = disp.findIndex((i) => i.id === draggedId);
              const toIdx = disp.findIndex((i) => i.id === item.id);
              if (fromIdx < 0 || toIdx < 0) return;
              const next = reorderTodosDisplay(allItems, fromIdx, toIdx);
              setTodoSaving(true);
              updateClientTodo(client, cycleStart, catKey, {
                ...catTodo,
                items: next,
              }).finally(() => setTodoSaving(false));
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2 p-2 min-w-0 max-w-full w-full">
        {canDragReorder && (
          <span
            draggable={!todoSaving}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', item.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 shrink-0 select-none touch-none"
            title="Drag to reorder"
          >
            <GripVertical className="w-4 h-4" aria-hidden />
          </span>
        )}
        <button
          type="button"
          disabled={todoSaving}
          title={item.pinned ? 'Unpin from top' : 'Pin to top'}
          onClick={() => {
            setTodoSaving(true);
            const next = toggleTodoPinnedById(allItems, item.id);
            updateClientTodo(client, cycleStart, catKey, {
              ...catTodo,
              items: next,
            }).finally(() => setTodoSaving(false));
          }}
          className={`shrink-0 p-1.5 rounded-lg border transition-colors ${
            item.pinned
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-transparent text-slate-300 hover:text-amber-600 hover:bg-amber-50/80'
          }`}
        >
          <Pin className="w-4 h-4" />
        </button>
        <input
          type="checkbox"
          checked={!!item.done}
          onChange={async () => {
            if (!item.done && !canMarkParentTodoDone(item)) {
              window.alert(
                'Complete every sub-task before marking this primary task complete.',
              );
              return;
            }
            setTodoSaving(true);
            try {
              const next = allItems.map((i) =>
                i.id === item.id
                  ? { ...i, done: !i.done, doneAt: !i.done ? Date.now() : null }
                  : i,
              );
              await updateClientTodo(client, cycleStart, catKey, {
                ...catTodo,
                items: next,
              });
            } finally {
              setTodoSaving(false);
            }
          }}
          disabled={todoSaving || isCycleLocked}
          className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414] w-4 h-4"
        />
        <span className={`text-sm flex-1 min-w-0 break-words ${item.done ? 'line-through opacity-70' : ''}`}>
          {safeDisplayForReact(item.text) || '(no text)'}
          {item.recurring && (
            <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-[#fd7414]">
              Recurring
            </span>
          )}
          {item.dueDate && (
            <span className="ml-2 text-[10px] font-black uppercase tracking-widest">
              Due {new Date(item.dueDate).toLocaleDateString()}
            </span>
          )}
          {subs.length > 0 && !item.done && (
            <span className="ml-2 text-[9px] font-bold text-slate-500">
              ({subs.filter((s) => !s.done).length} step{subs.filter((s) => !s.done).length === 1 ? '' : 's'}{' '}
              left)
            </span>
          )}
        </span>
        {canManageTodos && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {renderAssigneePicker(true)}
            <button
              type="button"
              disabled={todoSaving || isCycleLocked}
              onClick={() => onOpenOptions?.(item)}
              className="kiosk-light-control px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-black"
            >
              Options
            </button>
          </div>
        )}
      </div>
      {subs.length > 0 && (
        <ul className="ml-4 sm:ml-6 border-l border-slate-200 pl-3 space-y-1 pb-2 w-full min-w-0 max-w-full overflow-x-hidden">
          {subs.map((sub) => (
            <li
              key={sub.id}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm min-w-0 max-w-full w-full overflow-hidden ${getUrgencyClass(sub)}`}
            >
              <input
                type="checkbox"
                checked={!!sub.done}
                disabled={todoSaving || !canToggleSubtask(sub) || isCycleLocked}
                title={
                  canToggleSubtask(sub)
                    ? 'Sub-task'
                    : 'Assigned to another teammate'
                }
                onChange={async () => {
                  if (!canToggleSubtask(sub)) return;
                  setTodoSaving(true);
                  try {
                    const next = setSubtaskDoneInItems(
                      allItems,
                      item.id,
                      sub.id,
                      !sub.done,
                    );
                    await updateClientTodo(client, cycleStart, catKey, {
                      ...catTodo,
                      items: next,
                    });
                  } finally {
                    setTodoSaving(false);
                  }
                }}
                className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414] w-4 h-4 shrink-0"
              />
              <span className={`flex-1 min-w-0 break-words ${sub.done ? 'line-through opacity-70' : ''}`}>
                {safeDisplayForReact(sub.text) || '(step)'}
                {sub.dueDate && (
                  <span className="ml-2 text-[10px] font-black uppercase tracking-widest">
                    Due {new Date(sub.dueDate).toLocaleDateString()}
                  </span>
                )}
              </span>
              {canManageTodos && (
                <button
                  type="button"
                  disabled={todoSaving || isCycleLocked}
                  onClick={() => onOpenOptions?.(item, sub)}
                  className="kiosk-light-control shrink-0 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-black"
                >
                  Options
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
