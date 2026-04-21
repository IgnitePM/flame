import { GripVertical, Pin } from 'lucide-react';
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
}) {
  const meLower = String(user?.email || '').trim().toLowerCase();

  const canToggleSubtask = (sub) => {
    if (!meLower) return false;
    return effectiveSubtaskAssignees(sub, item, user?.email).includes(meLower);
  };

  const subs = getSubtasks(item);

  return (
    <li
      className={`flex flex-col gap-1 rounded-lg ${getUrgencyClass(item)}`}
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
      <div className="flex items-center gap-2 p-2">
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
          disabled={todoSaving}
          className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414] w-4 h-4"
        />
        <span className={`text-sm flex-1 ${item.done ? 'line-through opacity-70' : ''}`}>
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
      </div>
      {subs.length > 0 && (
        <ul className="ml-6 sm:ml-10 border-l border-slate-200 pl-3 space-y-1 pb-2">
          {subs.map((sub) => (
            <li
              key={sub.id}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${getUrgencyClass(sub)}`}
            >
              <input
                type="checkbox"
                checked={!!sub.done}
                disabled={todoSaving || !canToggleSubtask(sub)}
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
              <span className={`flex-1 ${sub.done ? 'line-through opacity-70' : ''}`}>
                {safeDisplayForReact(sub.text) || '(step)'}
                {sub.dueDate && (
                  <span className="ml-2 text-[10px] font-black uppercase tracking-widest">
                    Due {new Date(sub.dueDate).toLocaleDateString()}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
