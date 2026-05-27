import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, GripVertical, Pin } from 'lucide-react';
import { toggleTodoPinnedById } from '../utils/todoListOrder.js';
import {
  applyTodoListDragDrop,
  endTodoDragSession,
  hasTodoDragPayload,
  peekTodoDragPayload,
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

function setTodoDragGhost(e, sourceEl) {
  if (!sourceEl || !e.dataTransfer) return;
  const rect = sourceEl.getBoundingClientRect();
  const ghost = sourceEl.cloneNode(true);
  ghost.classList.add('kiosk-todo-drag-ghost');
  ghost.style.width = `${Math.min(rect.width, 560)}px`;
  ghost.style.position = 'fixed';
  ghost.style.top = '-9999px';
  ghost.style.left = '0';
  ghost.style.opacity = '0.95';
  ghost.style.transform = 'rotate(-1deg)';
  ghost.style.boxShadow = '0 22px 44px rgb(15 23 42 / 0.28)';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '99999';
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 28, 18);
  window.setTimeout(() => {
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }, 0);
}

function TodoDragHandle({ disabled, title, onDragStart, onDragEnd }) {
  return (
    <span
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`kiosk-todo-drag-handle shrink-0 select-none touch-none mt-0.5 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
      }`}
      title={title}
      aria-label={title}
    >
      <GripVertical className="w-4 h-4" aria-hidden />
    </span>
  );
}

function AssigneePicker({
  openKey,
  assigneeOpenKey,
  assignees,
  assignableEmails,
  onChange,
  onOpenChange,
  inheritLabel = 'Assign',
  align = 'left',
  disabled = false,
}) {
  const buttonRef = React.useRef(null);
  const assignOpen = assigneeOpenKey === openKey;
  const [menuStyle, setMenuStyle] = React.useState(null);

  React.useLayoutEffect(() => {
    if (!assignOpen) {
      setMenuStyle(null);
      return;
    }
    const updatePosition = () => {
      const el = buttonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.min(260, window.innerWidth - 16);
      let left = align === 'right' ? rect.right - width : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      setMenuStyle({
        top: rect.bottom + 6,
        left,
        width,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [assignOpen, align]);

  const menu =
    assignOpen && menuStyle
      ? createPortal(
          <>
            <button
              type="button"
              aria-label="Close assignee menu"
              className="fixed inset-0 z-[200] cursor-default bg-transparent"
              onClick={() => onOpenChange?.(null)}
            />
            <div
              className="fixed z-[210] rounded-xl border border-slate-200 bg-white p-2 shadow-2xl"
              style={{
                top: menuStyle.top,
                left: menuStyle.left,
                width: menuStyle.width,
              }}
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
                  onClick={() => onOpenChange?.(null)}
                >
                  Done
                </button>
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => onOpenChange?.(assignOpen ? null : openKey)}
        className="kiosk-light-control inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-widest text-black disabled:opacity-40"
      >
        {assigneeSummaryLabel(assignees, { inheritLabel })}
        <ChevronDown className="w-3 h-3" />
      </button>
      {menu}
    </>
  );
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
  onPersistItems,
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
  const rowRef = React.useRef(null);
  const [subtaskComposerOpen, setSubtaskComposerOpen] = React.useState(false);
  const [subtaskText, setSubtaskText] = React.useState('');
  const [subtaskDue, setSubtaskDue] = React.useState('');
  const [isDragging, setIsDragging] = React.useState(false);
  const [dropHint, setDropHint] = React.useState(null);

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
    if (onPersistItems) {
      onPersistItems(nextItems).catch?.(() => {
        if (errorMessage) window.alert(errorMessage);
      });
      return;
    }
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

  const clearDragVisuals = () => {
    setIsDragging(false);
    setDropHint(null);
    endTodoDragSession();
  };

  const startPrimaryDrag = (e) => {
    e.stopPropagation();
    writeTodoDragPayload(e.dataTransfer, {
      kind: 'primary',
      id: item.id,
    });
    setTodoDragGhost(e, rowRef.current);
    setIsDragging(true);
  };

  const startSubtaskDrag = (e, sub, subRowEl) => {
    e.stopPropagation();
    writeTodoDragPayload(e.dataTransfer, {
      kind: 'subtask',
      id: sub.id,
      parentId: item.id,
    });
    setTodoDragGhost(e, subRowEl);
    setIsDragging(true);
  };

  const computePrimaryDropTarget = (e, drag) => {
    if (!drag) return null;
    if (drag.kind === 'primary' && drag.id === item.id) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const reorderZone = Math.min(40, rect.height * 0.25);
    if (drag.kind === 'primary' && relativeY > reorderZone) {
      return { type: 'nest-under-primary', primaryId: item.id };
    }
    return { type: 'before-primary', primaryId: item.id };
  };

  const handlePrimaryDragOver = (e) => {
    if (!canDragReorder || todoSaving || isCycleLocked) return;
    if (!hasTodoDragPayload(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const drag = peekTodoDragPayload(e.dataTransfer);
    const target = computePrimaryDropTarget(e, drag);
    if (!target) return;
    setDropHint(target.type === 'nest-under-primary' ? 'nest' : 'reorder');
  };

  const handlePrimaryDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canDragReorder || todoSaving || isCycleLocked) return;
    const drag = readTodoDragPayload(e.dataTransfer);
    const dropTarget = computePrimaryDropTarget(e, drag);
    if (!drag || !dropTarget) return;
    const result = applyTodoListDragDrop(allItems, drag, dropTarget);
    clearDragVisuals();
    if (result.error) {
      window.alert(result.error);
      return;
    }
    if (!result.ok) return;
    persistItems(result.items);
  };

  const applyDrop = (dropTarget, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canDragReorder || todoSaving || isCycleLocked) return;
    const drag = readTodoDragPayload(e.dataTransfer);
    if (!drag) return;
    const result = applyTodoListDragDrop(allItems, drag, dropTarget);
    clearDragVisuals();
    if (result.error) {
      window.alert(result.error);
      return;
    }
    if (!result.ok) return;
    persistItems(result.items);
  };

  const handleSubtaskDragOver = (e) => {
    if (!canDragReorder || todoSaving || isCycleLocked) return;
    if (!hasTodoDragPayload(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropHint('subtask');
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
  const primaryAssigneeOpen = assigneeOpenKey === itemAssigneeOpenKey;
  const anySubAssigneeOpen =
    !!assigneeOpenKey &&
    assigneeOpenKey.startsWith(`${itemAssigneeOpenKey}__sub__`);
  const assigneeMenuOpen = primaryAssigneeOpen || anySubAssigneeOpen;
  const pickerDisabled = todoSaving || isCycleLocked;

  const dropHintLabel =
    dropHint === 'reorder'
      ? 'Drop to reorder'
      : dropHint === 'nest'
        ? 'Drop to nest as step'
        : dropHint === 'subtask'
          ? 'Drop on step'
          : null;

  const renderPrimaryControls = () => (
    <div className="flex shrink-0 items-center justify-end gap-1">
      <AssigneePicker
        openKey={itemAssigneeOpenKey}
        assigneeOpenKey={assigneeOpenKey}
        assignees={primaryAssignees}
        assignableEmails={assignableEmails}
        onChange={onAssigneesChange}
        onOpenChange={onAssigneeOpenChange}
        disabled={pickerDisabled}
      />
      <button
        type="button"
        disabled={pickerDisabled}
        onClick={() => onOpenOptions?.(item)}
        className="kiosk-light-control shrink-0 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-black"
      >
        Options
      </button>
    </div>
  );

  return (
    <li
      ref={rowRef}
      className={`relative flex flex-col gap-1 rounded-lg min-w-0 max-w-full transition-all duration-150 ${
        assigneeMenuOpen ? 'z-[120]' : 'z-0'
      } ${isDragging ? 'kiosk-todo-row-dragging' : ''} ${
        dropHint === 'reorder' ? 'kiosk-todo-drop-reorder' : ''
      } ${dropHint === 'nest' ? 'kiosk-todo-drop-nest' : ''} ${getUrgencyClass(item)}`}
      onDragOver={canDragReorder ? handlePrimaryDragOver : undefined}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDropHint(null);
      }}
      onDrop={canDragReorder ? handlePrimaryDrop : undefined}
    >
      {dropHintLabel && !isDragging && (
        <div className="pointer-events-none absolute right-2 top-1 z-20 rounded-md bg-black/85 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">
          {dropHintLabel}
        </div>
      )}
      <div className="flex flex-col gap-2 p-2 min-w-0 w-full">
        <div className="flex items-start gap-2 min-w-0 w-full">
          {canDragReorder ? (
            <TodoDragHandle
              disabled={todoSaving}
              title="Drag to reorder or nest under another task"
              onDragStart={startPrimaryDrag}
              onDragEnd={clearDragVisuals}
            />
          ) : canManageTodos ? (
            <span
              className="kiosk-todo-drag-handle shrink-0 mt-0.5 opacity-35 cursor-not-allowed"
              title="Drag unavailable for prior-cycle or locked tasks"
              aria-hidden
            >
              <GripVertical className="w-4 h-4" />
            </span>
          ) : (
            <span className="w-[1.625rem] shrink-0" aria-hidden />
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
          <div className="min-w-0 flex-1">
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
            <div className="hidden sm:flex shrink-0 self-start">
              {renderPrimaryControls()}
            </div>
          )}
        </div>
        {canManageTodos && (
          <div className="flex sm:hidden justify-end pl-8">
            {renderPrimaryControls()}
          </div>
        )}
      </div>
      {subs.length > 0 && (
        <ul className="ml-4 sm:ml-6 border-l border-slate-200 pl-3 space-y-1.5 pb-1 w-full min-w-0 max-w-full">
          {subs.map((sub) => {
            const subAssignees = normalizeAssignees(sub.assigneeEmails);
            const subAssigneeOpenKey = `${itemAssigneeOpenKey}__sub__${sub.id}`;
            return (
              <li
                key={sub.id}
                className={`relative rounded-md transition-all duration-150 ${
                  dropHint === 'subtask' ? 'kiosk-todo-drop-subtask' : ''
                } ${getUrgencyClass(sub)}`}
                onDragOver={canDragReorder ? handleSubtaskDragOver : undefined}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget)) return;
                  setDropHint(null);
                }}
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
                <div className="flex flex-col gap-1.5 px-2 py-1.5 min-w-0 w-full">
                  <div className="flex items-start gap-2 min-w-0 w-full">
                    {canDragReorder ? (
                      <TodoDragHandle
                        disabled={todoSaving}
                        title="Drag to reorder, promote, or move between tasks"
                        onDragStart={(e) =>
                          startSubtaskDrag(e, sub, e.currentTarget.closest('li'))
                        }
                        onDragEnd={clearDragVisuals}
                      />
                    ) : canManageTodos ? (
                      <span
                        className="kiosk-todo-drag-handle shrink-0 mt-0.5 opacity-35 cursor-not-allowed"
                        aria-hidden
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                    ) : null}
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
                      className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414] w-4 h-4 shrink-0 mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
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
                      <div className="hidden sm:flex shrink-0 self-start items-center gap-1">
                        <AssigneePicker
                          openKey={subAssigneeOpenKey}
                          assigneeOpenKey={assigneeOpenKey}
                          assignees={subAssignees}
                          assignableEmails={assignableEmails}
                          onChange={(next) => onSubtaskAssigneesChange?.(sub.id, next)}
                          onOpenChange={onAssigneeOpenChange}
                          inheritLabel="Inherit"
                          align="right"
                          disabled={pickerDisabled}
                        />
                        <button
                          type="button"
                          disabled={pickerDisabled}
                          onClick={() => onOpenOptions?.(item, sub)}
                          className="kiosk-light-control shrink-0 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-black"
                        >
                          Options
                        </button>
                      </div>
                    )}
                  </div>
                  {canManageTodos && (
                    <div className="flex sm:hidden justify-end gap-1 pl-8">
                      <AssigneePicker
                        openKey={subAssigneeOpenKey}
                        assigneeOpenKey={assigneeOpenKey}
                        assignees={subAssignees}
                        assignableEmails={assignableEmails}
                        onChange={(next) => onSubtaskAssigneesChange?.(sub.id, next)}
                        onOpenChange={onAssigneeOpenChange}
                        inheritLabel="Inherit"
                        align="right"
                        disabled={pickerDisabled}
                      />
                      <button
                        type="button"
                        disabled={pickerDisabled}
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
