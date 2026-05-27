import React from 'react';
import { ChevronDown, GripVertical, Pin } from 'lucide-react';
import { toggleTodoPinnedById } from '../utils/todoListOrder.js';
import {
  applyTodoListDragDrop,
  readTodoDragPayload,
  writeTodoDragPayload,
} from '../utils/todoDragDrop.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';
import {
  addSubtaskToItems,
  canMarkParentTodoDone,
  clampSubtaskDueToParent,
  effectiveSubtaskAssignees,
  getSubtasks,
  newSubtaskTemplate,
  parentDueCapMs,
  setSubtaskDoneInItems,
} from '../utils/todoSubtasks.js';
import TodoItemAttachments from './TodoItemAttachments.jsx';

function parseDateInputToMs(value) {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function asDateInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeAssignees(raw) {
  return Array.isArray(raw)
    ? raw.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

function assigneeSummaryLabel(assignees, { inheritLabel = 'Assign' } = {}) {
  if (assignees.length === 0) return inheritLabel;
  if (assignees.length === 1) return assignees[0].split('@')[0];
  return `${assignees.length} people`;
}

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
  staffEmail = '',
  canManageTodos = false,
  canAddSubtasks = false,
  defaultAssigneeEmail = '',
  isCycleLocked = false,
  assigneeOpenKey = null,
  itemAssigneeOpenKey = '',
  onAssigneeOpenChange,
  assignableEmails = [],
  onAssigneesChange,
  onSubtaskAssigneesChange,
  onOpenOptions,
  uploadClientDocument,
  removeClientDocument,
  canAttachFiles = false,
}) {
  const meLower = String(staffEmail || user?.email || '').trim().toLowerCase();
  const [subtaskComposerOpen, setSubtaskComposerOpen] = React.useState(false);
  const [subtaskText, setSubtaskText] = React.useState('');
  const [subtaskDue, setSubtaskDue] = React.useState('');

  const resetSubtaskComposer = () => {
    setSubtaskComposerOpen(false);
    setSubtaskText('');
    setSubtaskDue('');
  };

  const canToggleSubtask = (sub) => {
    if (!meLower) return false;
    if (canManageTodos) return true;
    return effectiveSubtaskAssignees(sub, item, user?.email).includes(meLower);
  };

  const persistItems = (nextItems, { errorMessage } = {}) => {
    if (!updateClientTodo) return;
    setTodoSaving(true);
    updateClientTodo(client, cycleStart, catKey, {
      ...catTodo,
      items: nextItems,
    })
      .catch(() => {
        if (errorMessage) window.alert(errorMessage);
      })
      .finally(() => setTodoSaving(false));
  };

  const applyDrop = (dropTarget, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canDragReorder || todoSaving || isCycleLocked) return;
    const drag = readTodoDragPayload(e.dataTransfer);
    if (!drag) return;
    const result = applyTodoListDragDrop(allItems, drag, dropTarget);
    if (result.error) {
      window.alert(result.error);
      return;
    }
    if (!result.ok) return;
    persistItems(result.items);
  };

  const saveSubtask = async () => {
    const text = subtaskText.trim();
    if (!text || !updateClientTodo) return;
    const rawDue = parseDateInputToMs(subtaskDue);
    if (parentDueCapMs(item) && rawDue && rawDue > parentDueCapMs(item)) {
      window.alert('Sub-task due cannot be after the primary task due date.');
      return;
    }
    const dueDate = clampSubtaskDueToParent(item, rawDue);
    const assignee = String(defaultAssigneeEmail || meLower || '').trim().toLowerCase();
    const sub = newSubtaskTemplate({
      text,
      dueDate,
      assigneeEmails: assignee ? [assignee] : [],
    });
    setTodoSaving(true);
    try {
      const next = addSubtaskToItems(allItems, item.id, sub);
      await updateClientTodo(client, cycleStart, catKey, {
        ...catTodo,
        items: next,
      });
      resetSubtaskComposer();
    } finally {
      setTodoSaving(false);
    }
  };

  const subs = getSubtasks(item);
  const primaryAssignees = normalizeAssignees(item.assigneeEmails);

  const renderAssigneePicker = ({
    openKey,
    assignees,
    onChange,
    inheritLabel = 'Assign',
    align = 'left',
  }) => {
    const assignOpen = assigneeOpenKey === openKey;
    return (
      <div className="relative z-20">
        <button
          type="button"
          disabled={todoSaving || isCycleLocked}
          onClick={() =>
            onAssigneeOpenChange?.(assignOpen ? null : openKey)
          }
          className="kiosk-light-control inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-widest text-black disabled:opacity-40"
        >
          {assigneeSummaryLabel(assignees, { inheritLabel })}
          <ChevronDown className="w-3 h-3" />
        </button>
        {assignOpen && (
          <div
            className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-[130] mt-1 w-[260px] max-w-[85vw] rounded-xl border border-slate-200 bg-white p-2 shadow-xl`}
          >
            <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
              Assign to
            </div>
            {inheritLabel !== 'Assign' && assignees.length === 0 && (
              <p className="mb-2 text-[10px] font-bold text-slate-500">
                Currently inherits primary task assignees.
              </p>
            )}
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
                        onChange?.(next);
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
                onClick={() => onChange?.([])}
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
  };

  const dragOverProps = canDragReorder
    ? {
        onDragOver: (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        },
      }
    : {};

  return (
    <li
      className={`relative flex flex-col gap-1 rounded-lg min-w-0 max-w-full ${getUrgencyClass(item)}`}
    >
      <div
        className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 p-2 min-w-0 w-full"
        {...dragOverProps}
        onDrop={(e) =>
          applyDrop({ type: 'before-primary', primaryId: item.id }, e)
        }
      >
        {canDragReorder ? (
          <span
            draggable={!todoSaving}
            onDragStart={(e) => {
              writeTodoDragPayload(e.dataTransfer, {
                kind: 'primary',
                id: item.id,
              });
            }}
            className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 shrink-0 select-none touch-none mt-0.5"
            title="Drag to reorder or nest under another task"
          >
            <GripVertical className="w-4 h-4" aria-hidden />
          </span>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
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
          className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414] w-4 h-4 shrink-0 mt-0.5"
        />
        <div className="min-w-0">
          <div className={`text-sm break-words ${item.done ? 'line-through opacity-70' : ''}`}>
            {safeDisplayForReact(item.text) || '(no text)'}
            {item.recurring && (
              <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-[#fd7414]">
                Recurring
              </span>
            )}
          </div>
          {(item.dueDate || (subs.length > 0 && !item.done)) && (
            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-black uppercase tracking-widest">
              {item.dueDate && (
                <span>Due {new Date(item.dueDate).toLocaleDateString()}</span>
              )}
              {subs.length > 0 && !item.done && (
                <span className="font-bold text-slate-500 normal-case tracking-normal">
                  ({subs.filter((s) => !s.done).length} step
                  {subs.filter((s) => !s.done).length === 1 ? '' : 's'} left)
                </span>
              )}
            </div>
          )}
        </div>
        {canManageTodos && (
          <div className="relative z-20 col-start-5 flex shrink-0 items-center justify-end gap-1 self-start">
            {renderAssigneePicker({
              openKey: itemAssigneeOpenKey,
              assignees: primaryAssignees,
              onChange: onAssigneesChange,
            })}
            <button
              type="button"
              disabled={todoSaving || isCycleLocked}
              onClick={() => onOpenOptions?.(item)}
              className="kiosk-light-control shrink-0 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-black"
            >
              Options
            </button>
          </div>
        )}
      </div>
      {subs.length > 0 && (
        <ul className="relative z-0 ml-4 sm:ml-6 border-l border-slate-200 pl-3 space-y-1 pb-1 w-full min-w-0 max-w-full">
          {subs.map((sub) => {
            const subAssignees = normalizeAssignees(sub.assigneeEmails);
            const subAssigneeOpenKey = `${itemAssigneeOpenKey}__sub__${sub.id}`;
            const subAssigneeOpen = assigneeOpenKey === subAssigneeOpenKey;
            return (
              <li
                key={sub.id}
                className={`relative rounded-md ${subAssigneeOpen ? 'z-30' : 'z-10'} ${getUrgencyClass(sub)}`}
                {...dragOverProps}
                onDrop={(e) =>
                  applyDrop(
                    {
                      type: 'before-subtask',
                      parentId: item.id,
                      subtaskId: sub.id,
                    },
                    e,
                  )
                }
              >
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 px-2 py-1.5 min-w-0 w-full">
                  <div className="flex items-start gap-1.5 pt-0.5 shrink-0">
                    {canDragReorder && (
                      <span
                        draggable={!todoSaving}
                        onDragStart={(e) => {
                          writeTodoDragPayload(e.dataTransfer, {
                            kind: 'subtask',
                            id: sub.id,
                            parentId: item.id,
                          });
                        }}
                        className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 shrink-0 select-none touch-none"
                        title="Drag to reorder, promote, or move between tasks"
                      >
                        <GripVertical className="w-3.5 h-3.5" aria-hidden />
                      </span>
                    )}
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
                  </div>
                  <div className="min-w-0 py-0.5">
                    <div className={`text-sm break-words ${sub.done ? 'line-through opacity-70' : ''}`}>
                      {safeDisplayForReact(sub.text) || '(step)'}
                    </div>
                    {sub.dueDate && (
                      <div className="mt-0.5 text-[10px] font-black uppercase tracking-widest">
                        Due {new Date(sub.dueDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  {canManageTodos && (
                    <div className="relative z-20 flex shrink-0 items-center justify-end gap-1 self-start">
                      {renderAssigneePicker({
                        openKey: subAssigneeOpenKey,
                        assignees: subAssignees,
                        onChange: (next) => onSubtaskAssigneesChange?.(sub.id, next),
                        inheritLabel: 'Inherit',
                        align: 'right',
                      })}
                      <button
                        type="button"
                        disabled={todoSaving || isCycleLocked}
                        onClick={() => onOpenOptions?.(item, sub)}
                        className="kiosk-light-control shrink-0 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-black"
                      >
                        Options
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canAddSubtasks && !item.done && (
        <div className="ml-4 sm:ml-6 pl-3 pb-2 w-full min-w-0">
          {!subtaskComposerOpen ? (
            <button
              type="button"
              disabled={todoSaving || isCycleLocked}
              onClick={() => setSubtaskComposerOpen(true)}
              className="text-[10px] font-black uppercase tracking-widest text-[#fd7414] hover:underline disabled:opacity-40"
            >
              + Add step
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/90 p-3 sm:flex-row sm:flex-wrap sm:items-end">
              <input
                type="text"
                value={subtaskText}
                onChange={(e) => setSubtaskText(e.target.value)}
                placeholder="Step description"
                className="min-w-[140px] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]/40"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (subtaskText.trim()) saveSubtask();
                }}
                autoFocus
              />
              <input
                type="date"
                value={subtaskDue}
                max={item.dueDate ? asDateInput(item.dueDate) : undefined}
                onChange={(e) => setSubtaskDue(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                title="Optional due date"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={todoSaving}
                  onClick={resetSubtaskComposer}
                  className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={todoSaving || !subtaskText.trim()}
                  onClick={saveSubtask}
                  className="rounded-lg bg-[#fd7414] px-3 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-40"
                >
                  Save step
                </button>
              </div>
              {meLower && (
                <p className="w-full text-[9px] font-bold text-slate-500 sm:basis-full">
                  Assigned to you
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {canAttachFiles && uploadClientDocument && !item.done && (
        <TodoItemAttachments
          item={item}
          client={client}
          cycleStart={cycleStart}
          categoryKey={catKey}
          disabled={todoSaving || isCycleLocked}
          onAttach={uploadClientDocument}
          onRemove={removeClientDocument}
        />
      )}
    </li>
  );
}
