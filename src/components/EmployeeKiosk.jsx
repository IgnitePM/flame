import React from 'react';
import {
  Activity,
  ChevronDown,
  Coffee,
  History,
  LogOut,
  Pause,
  Play,
} from 'lucide-react';
import { orderTodosForDisplay } from '../utils/todoListOrder.js';
import { collectEffectiveAssigneesForTodoTree } from '../utils/todoSubtasks.js';
import KioskClientTodoItem from './KioskClientTodoItem.jsx';
import { buildGlobalTodoRows } from '../utils/todoGlobalRows.js';
import {
  buildKioskBillingTargetFromTodoRow,
  todoRowMatchesFilters,
  sortTodoRowsByDueThenClient,
  sortTodoRowsByClientThenDue,
} from '../utils/todoFilters.js';
import { safeDisplayForReact } from '../utils/safeReactText.js';

const EmployeeKiosk = ({
  user,
  activeShift,
  activeTask,
  liveDuration,
  liveTaskDuration,
  clients,
  selectableRetainers,
  GENERAL_LABEL,
  clientActiveProjects,
  policy,
  selectedClient,
  setSelectedClient,
  selectedBillingTarget,
  setSelectedBillingTarget,
  activeTaskNotes,
  setActiveTaskNotes,
  taskLogs,
  clientsFull,
  getBillingPeriod,
  handleClockIn,
  handleEndBreak,
  handleStartTask,
  handleStopTask,
  handleResumeTask,
  handleTakeBreak,
  handleClockOut,
  getGlobalRetainerStats,
  formatTime,
  onLogSocialAdSpend,
  onLogClientExpense,
  getTodoStateForCycle,
  updateClientTodo,
  todoCategoryKey,
  projects = [],
  queueKioskTaskStart = () => {},
  userTodos = [],
  updateUserTodos,
  adminUsers = [],
  handleIdleAutoClockOut,
}) => {
  const [clientSearch, setClientSearch] = React.useState('');
  const [socialAdAmount, setSocialAdAmount] = React.useState('');
  const [socialAdDescription, setSocialAdDescription] = React.useState('');
  const [socialAdSubmitting, setSocialAdSubmitting] = React.useState(false);
  const [todoNewText, setTodoNewText] = React.useState('');
  const [todoSaving, setTodoSaving] = React.useState(false);
  const [todoDueDate, setTodoDueDate] = React.useState('');
  const [todoMineOnly, setTodoMineOnly] = React.useState(true);
  const [categoryTodoMineOnly, setCategoryTodoMineOnly] = React.useState(true);
  const [kioskTaskStatusFilter, setKioskTaskStatusFilter] = React.useState('open');
  const [kioskTaskDueFilter, setKioskTaskDueFilter] = React.useState('next7');
  const [kioskTaskSortMode, setKioskTaskSortMode] = React.useState('due');
  const [todoRecurrenceMode, setTodoRecurrenceMode] = React.useState('none');
  const [todoOptionsOpen, setTodoOptionsOpen] = React.useState(false);
  const [kioskExpenseAmount, setKioskExpenseAmount] = React.useState('');
  const [kioskExpenseDescription, setKioskExpenseDescription] = React.useState('');
  const [kioskExpenseCurrency, setKioskExpenseCurrency] = React.useState('CAD');
  const [kioskExpenseApplyMarkup, setKioskExpenseApplyMarkup] = React.useState(true);
  const [kioskExpenseSubmitting, setKioskExpenseSubmitting] = React.useState(false);
  const [personalListDraft, setPersonalListDraft] = React.useState('');
  const [personalListSaving, setPersonalListSaving] = React.useState(false);
  const [personalAssigneeOpenId, setPersonalAssigneeOpenId] = React.useState(null);
  const [personalLinkItem, setPersonalLinkItem] = React.useState(null);
  const [linkPickClientId, setLinkPickClientId] = React.useState('');
  const [linkPickKind, setLinkPickKind] = React.useState('retainer');
  const [linkPickRetainerName, setLinkPickRetainerName] = React.useState('');
  const [linkPickProjectId, setLinkPickProjectId] = React.useState('');
  const [personalOptionsItemId, setPersonalOptionsItemId] = React.useState(null);
  const [personalOptionsDue, setPersonalOptionsDue] = React.useState('');
  const [personalOptionsRecurrence, setPersonalOptionsRecurrence] =
    React.useState('none');

  const safeCategoryKey = (category) =>
    String(category)
      .replace(/[~*[\]/]/g, '_')
      .replace(/\./g, '_');

  const parseDateInputToMs = (value) => {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
  };

  const normalizeAssignees = (item) => {
    const raw = Array.isArray(item?.assigneeEmails) ? item.assigneeEmails : [];
    const cleaned = raw.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean);
    if (cleaned.length > 0) return cleaned;
    return user?.email ? [String(user.email).trim().toLowerCase()] : [];
  };

  const getUrgencyClass = (item) => {
    const due = Number(item?.dueDate || 0);
    if (!due) return 'bg-white border border-slate-100 text-slate-800';
    const now = Date.now();
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    if (due < now) return 'bg-red-700 border border-red-900 text-white';
    if (due - now <= fiveDays)
      return 'bg-emerald-700 border border-emerald-900 text-white';
    return 'bg-white border border-slate-100 text-slate-800';
  };

  const getUrgencyTone = (item) => {
    const due = Number(item?.dueDate || 0);
    if (!due) return 'normal';
    const now = Date.now();
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    if (due < now) return 'overdue';
    if (due - now <= fiveDays) return 'soon';
    return 'normal';
  };

  const getDraftRecurrence = (dueDateMs) => {
    const m = String(todoRecurrenceMode || 'none');
    if (m === 'none') return null;
    const hasMs = dueDateMs != null && !Number.isNaN(Number(dueDateMs));
    const src = hasMs ? new Date(dueDateMs) : new Date();
    if (Number.isNaN(src.getTime())) return null;
    src.setHours(12, 0, 0, 0);
    if (m === 'weekly') {
      return { type: 'weekly_weekday', weekday: src.getDay() };
    }
    if (m === 'biweekly') {
      return {
        type: 'biweekly_weekday',
        weekday: src.getDay(),
        anchorMs: src.getTime(),
      };
    }
    if (m === 'daily') {
      return { type: 'daily_fixed' };
    }
    if (m === 'monthly') {
      return { type: 'monthly_fixed_day', dayOfMonth: src.getDate() };
    }
    if (m === 'annual') {
      return { type: 'annual_fixed', month: src.getMonth(), day: src.getDate() };
    }
    return null;
  };

  const buildNewTodoItem = (text) => {
    const dueDate = parseDateInputToMs(todoDueDate);
    const recurrence = getDraftRecurrence(dueDate);
    const id = `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return {
      id,
      text: String(text || '').trim(),
      done: false,
      doneAt: null,
      pinned: false,
      recurring: !!recurrence,
      recurringId: recurrence ? id : null,
      dueDate,
      assigneeEmails: [String(user?.email || '').toLowerCase()].filter(Boolean),
      recurrence,
    };
  };

  const resetTodoDraftOptions = () => {
    setTodoDueDate('');
    setTodoRecurrenceMode('none');
    setTodoOptionsOpen(false);
  };

  // When a task is actively running, use the active task's client/category
  // so the retainer progress bar doesn't lag behind when switching tasks.
  const effectiveClientName = activeTask?.clientName || selectedClient;
  const selectedClientObj = clientsFull?.find((c) => c.name === effectiveClientName);
  const cycleStart = selectedClientObj
    ? getBillingPeriod(selectedClientObj.billingDay || 1, 0).start
    : null;

  const selectedRetainerCategory = (() => {
    // If we're actively working a retainer category (projectId is null), show progress/to-dos.
    // If we're actively working a custom project (projectId is truthy), hide retainer UI.
    if (activeTask) {
      if (activeTask.projectId) return null;
      return activeTask.projectName || null;
    }
    return selectedBillingTarget?.startsWith('retainer_')
      ? selectedBillingTarget.replace('retainer_', '')
      : null;
  })();

  const selectedRetainerNote =
    selectedClientObj && cycleStart && selectedRetainerCategory
      ? selectedClientObj.cycleNotes?.[String(cycleStart)]?.[
          safeCategoryKey(selectedRetainerCategory)
        ] || ''
      : '';

  const selectedClientGeneralNote = selectedClientObj?.generalNotes || '';

  const SOCIAL_AD_CATEGORY = 'Social Ad Budget';
  const categoryIsDollar = (client, categoryName) =>
    !categoryName
      ? false
      : categoryName === SOCIAL_AD_CATEGORY || client?.retainerUnits?.[categoryName] === 'dollar';
  const isDollarCategory = categoryIsDollar(selectedClientObj, selectedRetainerCategory);
  const isSocialAdCategory = selectedRetainerCategory === SOCIAL_AD_CATEGORY;

  const cycleStartMs = cycleStart;
  const cycleEndMs = cycleStartMs
    ? getBillingPeriod(selectedClientObj.billingDay || 1, 0).end
    : null;

  const retainerStats = selectedClientObj && cycleStartMs && cycleEndMs
    ? getGlobalRetainerStats(selectedClientObj, cycleStartMs, cycleEndMs)
    : null;

  const categoryUsed = retainerStats?.categoryBreakdown
    ? retainerStats.categoryBreakdown[selectedRetainerCategory] || 0
    : 0;

  // Include running task time so the progress bar updates in real time.
  const activeDeltaHours =
    activeTask && liveTaskDuration ? liveTaskDuration / 3600000 : 0;

  const selectedCategoryMatchesActiveTask =
    activeTask &&
    activeTask.projectName &&
    selectedRetainerCategory &&
    activeTask.projectName === selectedRetainerCategory;

  const categoryUsedWithActive = categoryUsed + (selectedCategoryMatchesActiveTask ? activeDeltaHours : 0);
  const categoryUsedWithActiveNormalized = isDollarCategory
    ? Number(categoryUsed || 0)
    : categoryUsedWithActive;

  const categoryAllotted =
    retainerStats?.perCategory?.[selectedRetainerCategory]?.adjustedAllotted ??
    ((selectedClientObj?.retainers &&
      selectedClientObj.retainers[selectedRetainerCategory]) ||
      0);
  // Retainer expenses must always hit the selected retainer line (no projectId), otherwise
  // getGlobalRetainerStats ignores them and progress bars do not move.
  const kioskRetainerExpenseIsDollar = categoryIsDollar(
    selectedClientObj,
    selectedRetainerCategory,
  );

  React.useEffect(() => {
    if (!policy?.idleReminderMinutes || !activeTask) return;
    const minutes = Number(policy.idleReminderMinutes) || 0;
    if (minutes <= 0) return;
    const timer = setInterval(() => {
      const runningForMs = Date.now() - (activeTask.lastResumeTime || activeTask.clockInTime);
      if (runningForMs > minutes * 60 * 1000 && (!activeTaskNotes || activeTaskNotes.trim() === '')) {
        window.alert('Reminder: please add a quick progress note for this task.');
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [policy?.idleReminderMinutes, activeTask, activeTaskNotes]);

  const lastActivityRef = React.useRef(Date.now());
  const [idleFailsafeOpen, setIdleFailsafeOpen] = React.useState(null);

  React.useEffect(() => {
    if (activeShift) {
      lastActivityRef.current = Date.now();
    } else {
      setIdleFailsafeOpen(null);
    }
  }, [activeShift?.id]);

  React.useEffect(() => {
    if (!activeShift || typeof handleIdleAutoClockOut !== 'function') return;
    const failsafeMin = Number(policy?.idleFailsafeMinutes || 0);
    if (failsafeMin <= 0) return;

    const bump = () => {
      if (!idleFailsafeOpen) {
        lastActivityRef.current = Date.now();
      }
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    window.addEventListener('scroll', bump, true);
    const onVis = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('scroll', bump, true);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [activeShift, handleIdleAutoClockOut, idleFailsafeOpen, policy?.idleFailsafeMinutes]);

  React.useEffect(() => {
    if (!activeShift || typeof handleIdleAutoClockOut !== 'function') return;
    const failsafeMin = Number(policy?.idleFailsafeMinutes || 0);
    if (failsafeMin <= 0) return;
    const iv = window.setInterval(() => {
      if (idleFailsafeOpen) return;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= failsafeMin * 60 * 1000) {
        const sec = Math.max(
          10,
          Number(policy?.idleFailsafeConfirmSeconds) || 120,
        );
        setIdleFailsafeOpen({ seconds: sec });
      }
    }, 4000);
    return () => window.clearInterval(iv);
  }, [
    activeShift,
    handleIdleAutoClockOut,
    idleFailsafeOpen,
    policy?.idleFailsafeMinutes,
    policy?.idleFailsafeConfirmSeconds,
  ]);

  React.useEffect(() => {
    if (!idleFailsafeOpen || typeof handleIdleAutoClockOut !== 'function') return;
    const { seconds } = idleFailsafeOpen;
    if (seconds <= 0) {
      handleIdleAutoClockOut();
      setIdleFailsafeOpen(null);
      return;
    }
    const t = window.setTimeout(() => {
      setIdleFailsafeOpen((prev) =>
        prev ? { seconds: Math.max(0, prev.seconds - 1) } : null,
      );
    }, 1000);
    return () => window.clearTimeout(t);
  }, [idleFailsafeOpen, handleIdleAutoClockOut]);

  const meLower = String(user?.email || '').trim().toLowerCase();

  const assignableEmails = React.useMemo(
    () =>
      Array.from(
        new Set([
          ...(adminUsers || [])
            .map((a) => String(a?.email || '').trim().toLowerCase())
            .filter(Boolean),
          meLower,
        ]),
      ).filter(Boolean),
    [adminUsers, meLower],
  );

  const asDateInputMs = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const buildPersonalRecurrenceFromMode = (mode, dueDateMs) => {
    const m = String(mode || 'none');
    if (m === 'none') return null;
    const hasMs = dueDateMs != null && !Number.isNaN(Number(dueDateMs));
    const src = hasMs ? new Date(dueDateMs) : new Date();
    if (Number.isNaN(src.getTime())) return null;
    src.setHours(12, 0, 0, 0);
    if (m === 'weekly') {
      return { type: 'weekly_weekday', weekday: src.getDay() };
    }
    if (m === 'biweekly') {
      return {
        type: 'biweekly_weekday',
        weekday: src.getDay(),
        anchorMs: src.getTime(),
      };
    }
    if (m === 'daily') {
      return { type: 'daily_fixed' };
    }
    if (m === 'monthly') {
      return { type: 'monthly_fixed_day', dayOfMonth: src.getDate() };
    }
    if (m === 'annual') {
      return {
        type: 'annual_fixed',
        month: src.getMonth(),
        day: src.getDate(),
      };
    }
    return null;
  };

  const personalOptionsTargetItem = React.useMemo(() => {
    if (!personalOptionsItemId) return null;
    return (userTodos || []).find((t) => t.id === personalOptionsItemId) || null;
  }, [personalOptionsItemId, userTodos]);

  const globalTodoRows = React.useMemo(
    () =>
      buildGlobalTodoRows(
        clientsFull || [],
        projects,
        getBillingPeriod,
        getTodoStateForCycle,
        todoCategoryKey,
      ),
    [clientsFull, projects, getBillingPeriod, getTodoStateForCycle, todoCategoryKey],
  );

  const kioskFilteredRows = React.useMemo(() => {
    let rows = globalTodoRows.filter((row) =>
      todoRowMatchesFilters(row, kioskTaskStatusFilter, kioskTaskDueFilter),
    );
    if (todoMineOnly) {
      rows = rows.filter((row) =>
        collectEffectiveAssigneesForTodoTree(row.item, user?.email).includes(meLower),
      );
    }
    return kioskTaskSortMode === 'client'
      ? sortTodoRowsByClientThenDue(rows)
      : sortTodoRowsByDueThenClient(rows);
  }, [
    globalTodoRows,
    kioskTaskStatusFilter,
    kioskTaskDueFilter,
    kioskTaskSortMode,
    todoMineOnly,
    meLower,
    user,
  ]);

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(400px,min(38vw,520px))] lg:items-start lg:gap-10">
        <div className="space-y-6 min-w-0 order-1">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden lg:min-h-0">
        <div className="p-8 text-center border-b border-slate-50 bg-slate-50/30">
          <div className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mb-3">
            Currently Active
          </div>
          <h2 className="text-2xl font-black">
            {user.displayName || user.email}
          </h2>
        </div>

        {activeShift && (
          <div className="px-6 py-3 border-b border-slate-100 bg-white">
            <div className="flex items-center justify-center gap-3">
              <a
                href="https://app-na3.hubspot.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center justify-center"
                title="HubSpot"
              >
                <img
                  src="/techstack/hubspot.png"
                  alt="HubSpot"
                  className="w-7 h-7"
                />
              </a>
              <a
                href="https://us22.admin.mailchimp.com/partners/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center justify-center"
                title="Mailchimp"
              >
                <img
                  src="/techstack/mailchimp.png"
                  alt="Mailchimp"
                  className="w-7 h-7"
                />
              </a>
              <a
                href="https://app.planable.io/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center justify-center"
                title="Planable"
              >
                <img
                  src="/techstack/planable.png"
                  alt="Planable"
                  className="w-7 h-7"
                />
              </a>
              <a
                href="https://online.seranking.com/admin.dashboard.html"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center justify-center"
                title="SE Ranking"
              >
                <img
                  src="/techstack/se-ranking.png"
                  alt="SE Ranking"
                  className="w-7 h-7"
                />
              </a>
            </div>
          </div>
        )}

        <div className="p-8 bg-slate-50/50">
          {!activeShift ? (
            <div className="space-y-4">
              <p className="text-slate-500 font-medium text-center mb-6">
                You are currently clocked out.
              </p>
              <button
                onClick={handleClockIn}
                className="w-full bg-[#fd7414] hover:bg-[#e66a12] text-white p-6 rounded-[24px] font-black text-xl shadow-xl shadow-[#fd7414]/20 transition-all flex items-center justify-center gap-3"
              >
                <Play className="fill-current w-6 h-6" /> Start Your Day
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex flex-col items-center">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  Total Shift Time
                </div>
                <div className="text-5xl font-black text-slate-900 font-mono tracking-tighter">
                  {formatTime(liveDuration)}
                </div>
              </div>

              {activeShift.status === 'break' ? (
                <div className="bg-blue-50 p-10 rounded-[32px] border border-blue-200 text-center animate-in zoom-in-95 duration-500">
                  <Coffee className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                  <h3 className="font-black text-2xl text-slate-900 mb-2">
                    You're on a break.
                  </h3>
                  <p className="text-slate-500 mb-8 font-medium">
                    Your shift timer is paused. Take your time!
                  </p>
                  <button
                    onClick={handleEndBreak}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white p-6 rounded-[32px] font-black text-xl shadow-xl shadow-blue-600/20 flex items-center justify-center gap-3 transition-all active:scale-95"
                  >
                    <Play className="w-5 h-5 fill-current" /> Resume Shift
                  </button>
                </div>
              ) : (
                <>
                  {!activeTask ? (
                    <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm space-y-4 animate-in slide-in-from-bottom-4">
                      <div className="flex items-center gap-2 mb-2 text-[#fd7414]">
                        <Activity className="w-5 h-5" />
                        <h3 className="font-black text-sm uppercase tracking-wider">
                          Start a Task
                        </h3>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                            Client / Account
                          </label>
                          <input
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                            className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414] mb-2"
                            placeholder="Search clients..."
                          />
                          <select
                            value={selectedClient}
                            onChange={(e) => {
                              setSelectedClient(e.target.value);
                              setSelectedBillingTarget('');
                            }}
                            className="w-full bg-slate-50 border-slate-200 border p-4 rounded-xl font-bold focus:ring-2 focus:ring-[#fd7414] outline-none"
                          >
                            <option value="">Select Client...</option>
                            {clients
                              .filter((c) =>
                                clientSearch
                                  ? c.name
                                      .toLowerCase()
                                      .includes(clientSearch.toLowerCase())
                                  : true,
                              )
                              .map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            <option value="General Admin">General Admin</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                            Billing Target
                          </label>
                          <select
                            value={selectedBillingTarget}
                            onChange={(e) => setSelectedBillingTarget(e.target.value)}
                            className="w-full bg-slate-50 border-slate-200 border p-4 rounded-xl font-bold focus:ring-2 focus:ring-[#fd7414] outline-none"
                          >
                            <option value="">Select Target...</option>
                            <optgroup label="Monthly Retainers">
                              <option value="retainer_GENERAL_UNCLASSIFIED">
                                {GENERAL_LABEL}
                              </option>
                              {selectableRetainers
                                .map((opt) => (
                                <option
                                  key={opt.name}
                                  value={`retainer_${opt.name}`}
                                  disabled={!opt.enabled}
                                >
                                  {opt.name}
                                  {!opt.enabled ? ' (No Hours Configured)' : ''}
                                </option>
                              ))}
                            </optgroup>
                            {clientActiveProjects.length > 0 && (
                              <optgroup label="Custom Projects">
                                {clientActiveProjects
                                  .map((p) => (
                                  <option key={p.id} value={`project_${p.id}`}>
                                    {p.title}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      </div>
                      <button
                        onClick={handleStartTask}
                        disabled={!selectedClient || !selectedBillingTarget}
                        className="w-full bg-black text-white p-5 rounded-2xl font-black text-lg disabled:opacity-30 hover:bg-slate-800 transition-all shadow-lg mt-2"
                      >
                        Begin Work Block
                      </button>

                      {selectedClientObj && selectedRetainerCategory && (
                        <div className="mt-4 bg-white border border-slate-200 rounded-[24px] p-4">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                            Notes for {selectedClientObj.name} • {selectedRetainerCategory}
                          </div>
                          <div className="space-y-3">
                            <div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                                Client Notes
                              </div>
                              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                                {selectedClientGeneralNote || 'No client notes yet.'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                                {selectedRetainerCategory} Note
                              </div>
                              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                                {selectedRetainerNote || 'No category note yet.'}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* To-do list for this category (current cycle) */}
                      {getTodoStateForCycle && updateClientTodo && selectedClientObj && selectedRetainerCategory && cycleStart && (
                        (() => {
                          const catKey = todoCategoryKey ? todoCategoryKey(selectedRetainerCategory) : safeCategoryKey(selectedRetainerCategory);
                          const todoState = getTodoStateForCycle(selectedClientObj, cycleStart);
                          const catTodo = todoState[catKey] || { closed: false, items: [] };
                          const allItems = catTodo.items || [];
                          const meLower = String(user?.email || '').trim().toLowerCase();
                          const displayItems = orderTodosForDisplay(allItems).filter((item) => {
                            if (!categoryTodoMineOnly) return true;
                            return collectEffectiveAssigneesForTodoTree(item, user?.email).includes(meLower);
                          });
                          const canDragReorder = !categoryTodoMineOnly;
                          return (
                            <div className="mt-4 bg-white border border-slate-200 rounded-[24px] p-4">
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                To-do — {selectedRetainerCategory}
                                {catTodo.closed && (
                                  <span className="ml-2 px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase">
                                    Closed
                                  </span>
                                )}
                              </div>
                              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 mb-2">
                                <input
                                  type="checkbox"
                                  checked={categoryTodoMineOnly}
                                  onChange={(e) => setCategoryTodoMineOnly(e.target.checked)}
                                />
                                Show only tasks assigned to me
                              </label>
                              {!catTodo.closed && canDragReorder && allItems.length > 0 && (
                                <p className="text-[10px] text-slate-400 mb-2">
                                  Drag the grip to reorder. Pin keeps tasks at the top of the list.
                                </p>
                              )}
                              {!catTodo.closed && categoryTodoMineOnly && allItems.length > 0 && (
                                <p className="text-[10px] text-amber-800/90 mb-2">
                                  Uncheck &quot;only my tasks&quot; to drag-reorder the full list.
                                </p>
                              )}
                              {!catTodo.closed && (
                                <>
                                  {displayItems.length === 0 ? (
                                    <p className="text-xs italic text-slate-400 mb-2">No items yet.</p>
                                  ) : (
                                    <ul className="space-y-2 mb-3">
                                      {displayItems.map((item) => (
                                        <KioskClientTodoItem
                                          key={item.id}
                                          item={item}
                                          allItems={allItems}
                                          catTodo={catTodo}
                                          catKey={catKey}
                                          cycleStart={cycleStart}
                                          client={selectedClientObj}
                                          todoSaving={todoSaving}
                                          setTodoSaving={setTodoSaving}
                                          updateClientTodo={updateClientTodo}
                                          canDragReorder={canDragReorder}
                                          getUrgencyClass={getUrgencyClass}
                                          user={user}
                                        />
                                      ))}
                                    </ul>
                                  )}
                                  <div className="flex gap-2 items-center">
                                    <input
                                      type="text"
                                      value={todoNewText}
                                      onChange={(e) => setTodoNewText(e.target.value)}
                                      placeholder="New to-do..."
                                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          if (todoNewText.trim()) {
                                            const newItem = buildNewTodoItem(todoNewText);
                                            setTodoSaving(true);
                                            updateClientTodo(selectedClientObj, cycleStart, catKey, {
                                              ...catTodo,
                                              closed: false,
                                              items: [...allItems, newItem],
                                            }).finally(() => {
                                              setTodoSaving(false);
                                              setTodoNewText('');
                                              resetTodoDraftOptions();
                                            });
                                          }
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setTodoOptionsOpen(true)}
                                      className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-black text-slate-600 uppercase tracking-widest hover:bg-slate-100 transition-all"
                                    >
                                      Options
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!todoNewText.trim() || todoSaving}
                                      onClick={async () => {
                                        if (!todoNewText.trim()) return;
                                        const newItem = buildNewTodoItem(todoNewText);
                                        setTodoSaving(true);
                                        try {
                                          await updateClientTodo(selectedClientObj, cycleStart, catKey, {
                                            ...catTodo,
                                            closed: false,
                                            items: [...allItems, newItem],
                                          });
                                          setTodoNewText('');
                                          resetTodoDraftOptions();
                                        } finally {
                                          setTodoSaving(false);
                                        }
                                      }}
                                      className="px-4 py-2 rounded-xl bg-[#fd7414] text-white font-bold text-sm disabled:opacity-40"
                                    >
                                      Add
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })()
                      )}

                      {/* Retainer progress (this category only) for current cycle */}
                      {retainerStats && selectedRetainerCategory && (
                        <div className="mt-4 bg-white border border-slate-200 rounded-[24px] p-4">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                            Retainer Progress
                          </div>

                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                            Category: {selectedRetainerCategory}
                          </div>
                          <div className="text-xs font-black text-slate-700 mb-2">
                            {isDollarCategory
                              ? `$${Number(categoryUsedWithActiveNormalized || 0).toFixed(2)} used / $${Number(categoryAllotted || 0).toFixed(2)} available`
                              : `${Number(categoryUsedWithActiveNormalized || 0).toFixed(2)}h used / ${Number(categoryAllotted || 0).toFixed(2)}h available`}
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden mb-3">
                            <div
                              className={`h-3 rounded-full transition-all duration-500 ${
                                  (categoryUsedWithActiveNormalized >
                                  Number(categoryAllotted || 0))
                                    ? 'bg-red-500'
                                    : 'bg-emerald-500'
                                }`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  ((categoryUsedWithActiveNormalized || 0) /
                                    ((Number(categoryAllotted || 0) || 1))) *
                                    100,
                                )}%`,
                              }}
                            />
                          </div>

                          {/* Days left */}
                          {cycleEndMs && (
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-3">
                              Days left:{' '}
                              {Math.max(
                                0,
                                Math.ceil(
                                  (cycleEndMs - Date.now()) / 86400000,
                                ),
                              )}{' '}
                              days
                            </div>
                          )}
                        </div>
                      )}

                      {/* Log Social Ad Spend (kiosk-only when Social Ad Budget selected) */}
                      {isSocialAdCategory && selectedClientObj && onLogSocialAdSpend && (
                        <div className="mt-4 bg-white border border-slate-200 rounded-[24px] p-4">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                            Log Social Ad Spend
                          </div>
                          <p className="text-xs text-slate-500 mb-3">
                            Enter the dollar amount and description (e.g. platform + ad details). This will be applied to this cycle&apos;s Social Ad Budget.
                          </p>
                          <div className="space-y-3">
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                                Amount ($)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={socialAdAmount}
                                onChange={(e) => setSocialAdAmount(e.target.value)}
                                placeholder="0.00"
                                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">
                                Description (platform + ad details)
                              </label>
                              <textarea
                                value={socialAdDescription}
                                onChange={(e) => setSocialAdDescription(e.target.value)}
                                placeholder="e.g. Meta - Brand awareness campaign"
                                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[72px]"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                const amt = Number(socialAdAmount);
                                if (!selectedClientObj?.id || !selectedClientObj?.name || !Number.isFinite(amt) || amt <= 0) {
                                  window.alert('Enter a valid dollar amount.');
                                  return;
                                }
                                setSocialAdSubmitting(true);
                                try {
                                  await onLogSocialAdSpend({
                                    clientId: selectedClientObj.id,
                                    clientName: selectedClientObj.name,
                                    amount: amt,
                                    description: socialAdDescription.trim() || undefined,
                                  });
                                  setSocialAdAmount('');
                                  setSocialAdDescription('');
                                } catch (err) {
                                  window.alert(err?.message || 'Failed to log spend.');
                                } finally {
                                  setSocialAdSubmitting(false);
                                }
                              }}
                              disabled={socialAdSubmitting || !socialAdAmount || Number(socialAdAmount) <= 0}
                              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white p-3 rounded-xl font-black text-sm uppercase tracking-widest transition-all"
                            >
                              {socialAdSubmitting ? 'Submitting…' : 'Submit Spend'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-orange-50 p-8 rounded-[32px] border border-orange-200 text-left animate-in zoom-in-95 duration-300">
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <div className="font-black text-2xl text-slate-900">
                            {activeTask.clientName}
                          </div>
                          <div className="text-[#fd7414] font-bold uppercase text-[10px] tracking-widest mt-1">
                            {activeTask.projectId
                              ? `Project: ${activeTask.projectName}`
                              : activeTask.projectName}
                          </div>
                        </div>
                        <div className="bg-white px-3 py-1.5 rounded-full border border-orange-200 text-[10px] font-black text-orange-600 shadow-sm">
                          IN PROGRESS
                        </div>
                      </div>
                      <div className="text-6xl font-black text-slate-900 text-center mb-8 font-mono tracking-tighter">
                        {formatTime(liveTaskDuration)}
                      </div>
                      {/* Retainer progress (show first while actively working) */}
                      {retainerStats && selectedRetainerCategory && (
                        <div className="mt-5 bg-white border border-slate-200 rounded-[24px] p-4">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                            Retainer Progress
                          </div>

                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                            Category: {selectedRetainerCategory}
                          </div>
                          <div className="text-xs font-black text-slate-700 mb-2">
                            {isDollarCategory
                              ? `$${Number(categoryUsedWithActiveNormalized || 0).toFixed(2)} used / $${Number(categoryAllotted || 0).toFixed(2)} available`
                              : `${Number(categoryUsedWithActiveNormalized || 0).toFixed(2)}h used / ${Number(categoryAllotted || 0).toFixed(2)}h available`}
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden mb-3">
                            <div
                              className={`h-3 rounded-full transition-all duration-500 ${
                                categoryUsedWithActive > Number(categoryAllotted || 0)
                                  ? 'bg-red-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  ((categoryUsedWithActive || 0) /
                                    ((Number(categoryAllotted || 0) || 1))) *
                                    100,
                                )}%`,
                              }}
                            />
                          </div>

                          {cycleEndMs && (
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-3">
                              Days left:{' '}
                              {Math.max(
                                0,
                                Math.ceil(
                                  (cycleEndMs - Date.now()) / 86400000,
                                ),
                              )}{' '}
                              days
                            </div>
                          )}
                        </div>
                      )}

                      {/* To-do list for this category (current cycle) */}
                      {getTodoStateForCycle && updateClientTodo && selectedClientObj && selectedRetainerCategory && cycleStart && (
                        (() => {
                          const catKey = todoCategoryKey ? todoCategoryKey(selectedRetainerCategory) : safeCategoryKey(selectedRetainerCategory);
                          const todoState = getTodoStateForCycle(selectedClientObj, cycleStart);
                          const catTodo = todoState[catKey] || { closed: false, items: [] };
                          const allItems = catTodo.items || [];
                          const meLower = String(user?.email || '').trim().toLowerCase();
                          const displayItems = orderTodosForDisplay(allItems).filter((item) => {
                            if (!categoryTodoMineOnly) return true;
                            return collectEffectiveAssigneesForTodoTree(item, user?.email).includes(meLower);
                          });
                          const canDragReorder = !categoryTodoMineOnly;
                          return (
                            <div className="mt-4 bg-white border border-slate-200 rounded-[24px] p-4">
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                To-do — {selectedRetainerCategory}
                                {catTodo.closed && (
                                  <span className="ml-2 px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase">
                                    Closed
                                  </span>
                                )}
                              </div>
                              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 mb-2">
                                <input
                                  type="checkbox"
                                  checked={categoryTodoMineOnly}
                                  onChange={(e) => setCategoryTodoMineOnly(e.target.checked)}
                                />
                                Show only tasks assigned to me
                              </label>
                              {!catTodo.closed && canDragReorder && allItems.length > 0 && (
                                <p className="text-[10px] text-slate-400 mb-2">
                                  Drag the grip to reorder. Pin keeps tasks at the top of the list.
                                </p>
                              )}
                              {!catTodo.closed && categoryTodoMineOnly && allItems.length > 0 && (
                                <p className="text-[10px] text-amber-800/90 mb-2">
                                  Uncheck &quot;only my tasks&quot; to drag-reorder the full list.
                                </p>
                              )}
                              {!catTodo.closed && (
                                <>
                                  {displayItems.length === 0 ? (
                                    <p className="text-xs italic text-slate-400 mb-2">No items yet.</p>
                                  ) : (
                                    <ul className="space-y-2 mb-3">
                                      {displayItems.map((item) => (
                                        <KioskClientTodoItem
                                          key={item.id}
                                          item={item}
                                          allItems={allItems}
                                          catTodo={catTodo}
                                          catKey={catKey}
                                          cycleStart={cycleStart}
                                          client={selectedClientObj}
                                          todoSaving={todoSaving}
                                          setTodoSaving={setTodoSaving}
                                          updateClientTodo={updateClientTodo}
                                          canDragReorder={canDragReorder}
                                          getUrgencyClass={getUrgencyClass}
                                          user={user}
                                        />
                                      ))}
                                    </ul>
                                  )}
                                  <div className="flex gap-2 items-center">
                                    <input
                                      type="text"
                                      value={todoNewText}
                                      onChange={(e) => setTodoNewText(e.target.value)}
                                      placeholder="New to-do..."
                                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          if (todoNewText.trim()) {
                                            const newItem = buildNewTodoItem(todoNewText);
                                            setTodoSaving(true);
                                            updateClientTodo(selectedClientObj, cycleStart, catKey, {
                                              ...catTodo,
                                              closed: false,
                                              items: [...allItems, newItem],
                                            }).finally(() => {
                                              setTodoSaving(false);
                                              setTodoNewText('');
                                              resetTodoDraftOptions();
                                            });
                                          }
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setTodoOptionsOpen(true)}
                                      className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-black text-slate-600 uppercase tracking-widest hover:bg-slate-100 transition-all"
                                    >
                                      Options
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!todoNewText.trim() || todoSaving}
                                      onClick={async () => {
                                        if (!todoNewText.trim()) return;
                                        const newItem = buildNewTodoItem(todoNewText);
                                        setTodoSaving(true);
                                        try {
                                          await updateClientTodo(selectedClientObj, cycleStart, catKey, {
                                            ...catTodo,
                                            closed: false,
                                            items: [...allItems, newItem],
                                          });
                                          setTodoNewText('');
                                          resetTodoDraftOptions();
                                        } finally {
                                          setTodoSaving(false);
                                        }
                                      }}
                                      className="px-4 py-2 rounded-xl bg-[#fd7414] text-white font-bold text-sm disabled:opacity-40"
                                    >
                                      Add
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })()
                      )}

                      {selectedClientObj && selectedRetainerCategory && (
                        <div className="mt-5 bg-white border border-slate-200 rounded-[24px] p-4">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                            Notes for {selectedClientObj.name} • {selectedRetainerCategory}
                          </div>
                          <div className="space-y-3">
                            <div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                                Client Notes
                              </div>
                              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                                {selectedClientGeneralNote || 'No client notes yet.'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                                {selectedRetainerCategory} Note
                              </div>
                              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                                {selectedRetainerNote || 'No category note yet.'}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedClientObj && selectedRetainerCategory && onLogClientExpense && (
                        <div className="mt-5 bg-white border border-slate-200 rounded-[24px] p-4">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                            Log Client Expense
                          </div>
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={kioskExpenseAmount}
                                onChange={(e) => setKioskExpenseAmount(e.target.value)}
                                placeholder="Amount"
                                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                              />
                              <select
                                value={kioskExpenseCurrency}
                                onChange={(e) => setKioskExpenseCurrency(e.target.value)}
                                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                              >
                                <option value="CAD">CAD</option>
                                <option value="USD">USD</option>
                                <option value="EUR">EUR</option>
                                <option value="GBP">GBP</option>
                              </select>
                            </div>
                            <textarea
                              value={kioskExpenseDescription}
                              onChange={(e) => setKioskExpenseDescription(e.target.value)}
                              placeholder="Expense description"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[72px]"
                            />
                            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                              <input
                                type="checkbox"
                                checked={kioskExpenseApplyMarkup}
                                onChange={(e) => setKioskExpenseApplyMarkup(e.target.checked)}
                                disabled={kioskRetainerExpenseIsDollar}
                              />
                              Add 30% markup (HST)
                              {kioskRetainerExpenseIsDollar && (
                                <span className="text-slate-400">(disabled for dollar category)</span>
                              )}
                            </label>
                            <button
                              type="button"
                              onClick={async () => {
                                const amt = Number(kioskExpenseAmount);
                                if (!Number.isFinite(amt) || amt <= 0) {
                                  window.alert('Enter a valid expense amount.');
                                  return;
                                }
                                setKioskExpenseSubmitting(true);
                                try {
                                  await onLogClientExpense({
                                    clientId: selectedClientObj.id,
                                    clientName: selectedClientObj.name,
                                    category: selectedRetainerCategory,
                                    projectId: null,
                                    amount: amt,
                                    description: kioskExpenseDescription.trim(),
                                    currency: kioskExpenseCurrency,
                                    applyMarkup: kioskExpenseApplyMarkup,
                                  });
                                  setKioskExpenseAmount('');
                                  setKioskExpenseDescription('');
                                } catch (err) {
                                  window.alert(err?.message || 'Failed to log expense.');
                                } finally {
                                  setKioskExpenseSubmitting(false);
                                }
                              }}
                              disabled={
                                kioskExpenseSubmitting ||
                                !kioskExpenseAmount ||
                                Number(kioskExpenseAmount) <= 0
                              }
                              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white p-3 rounded-xl font-black text-sm uppercase tracking-widest transition-all"
                            >
                              {kioskExpenseSubmitting ? 'Saving…' : 'Save Expense'}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="mt-5 space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                          Progress Notes
                        </label>
                        <textarea
                          value={activeTaskNotes}
                          onChange={(e) => setActiveTaskNotes(e.target.value)}
                          placeholder="Briefly describe what you've accomplished..."
                          className="w-full p-5 border-orange-200 border rounded-2xl bg-white/70 focus:ring-2 focus:ring-[#fd7414] outline-none text-sm min-h-[120px] font-medium"
                        />
                      </div>

                      <button
                        onClick={handleStopTask}
                        className="w-full bg-black hover:bg-slate-900 text-white p-5 rounded-2xl font-black text-lg mt-6 shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95"
                      >
                        <Pause className="w-5 h-5 fill-current" /> Pause Task
                      </button>
                    </div>
                  )}

                  {taskLogs.filter((t) => t.shiftId === activeShift.id && t.status === 'completed').length >
                    0 && (
                    <div className="bg-transparent space-y-3 pt-4">
                      <div className="flex items-center gap-2 mb-4 px-2">
                        <History className="w-4 h-4 text-slate-400" />
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          Ongoing Tasks
                        </span>
                      </div>
                      {taskLogs
                        .filter(
                          (t) =>
                            t.shiftId === activeShift.id &&
                            t.status === 'completed',
                        )
                        .map((task) => (
                          <div
                            key={task.id}
                            className="bg-white rounded-2xl p-4 flex justify-between items-center border border-slate-200 shadow-sm group"
                          >
                            <div>
                              <div className="font-bold text-slate-800 text-sm mb-0.5">
                                {task.clientName}
                              </div>
                              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                {task.projectId
                                  ? `Proj: ${task.projectName}`
                                  : task.projectName}
                              </div>
                            </div>
                            <button
                              onClick={() => handleResumeTask(task)}
                              className="p-3 bg-slate-50 rounded-xl text-[#fd7414] hover:bg-[#fd7414] hover:text-white transition-all shadow-sm group-hover:scale-105 active:scale-95"
                            >
                              <Play className="w-4 h-4 fill-current" />
                            </button>
                          </div>
                        ))}
                    </div>
                  )}

                  <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row justify-center gap-4">
                    <button
                      onClick={handleTakeBreak}
                      className="text-slate-500 hover:text-[#fd7414] font-bold p-3 transition-all text-sm uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 bg-slate-100 hover:bg-orange-50 rounded-xl"
                    >
                      <Coffee className="w-4 h-4" /> Take a Break
                    </button>
                    <button
                      onClick={handleClockOut}
                      className="text-slate-400 hover:text-white hover:bg-red-500 font-bold p-3 transition-all text-sm uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 border border-slate-200 rounded-xl hover:border-red-500"
                    >
                      <LogOut className="w-4 h-4" /> End Shift for Today
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {todoOptionsOpen && (
          <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                  To-do Options
                </h4>
                <button
                  type="button"
                  onClick={() => setTodoOptionsOpen(false)}
                  className="px-2 py-1 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  Due date
                </label>
                <input
                  type="date"
                  value={todoDueDate}
                  onChange={(e) => setTodoDueDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                  Recurrence
                </label>
                <select
                  value={todoRecurrenceMode}
                  onChange={(e) => setTodoRecurrenceMode(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                >
                  <option value="none">No repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly (same weekday)</option>
                  <option value="biweekly">Bi-weekly (same weekday)</option>
                  <option value="monthly">Monthly (same day of month)</option>
                  <option value="annual">Annually (same calendar date)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setTodoDueDate('');
                    setTodoRecurrenceMode('none');
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-black text-slate-500 bg-slate-100 hover:bg-slate-200 uppercase tracking-widest"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setTodoOptionsOpen(false)}
                  className="px-3 py-2 rounded-xl text-xs font-black text-white bg-[#fd7414] hover:brightness-95 uppercase tracking-widest"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
        </div>
        <aside className="order-2 rounded-2xl border border-slate-100 bg-white p-5 shadow-lg lg:sticky lg:top-4 lg:self-start min-w-0 w-full flex flex-col gap-3 max-h-[calc(100dvh-5.5rem)] min-h-0">
          <div className="shrink-0 space-y-3">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Client to-dos
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={kioskTaskStatusFilter}
              onChange={(e) => setKioskTaskStatusFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]/40"
            >
              <option value="open">Open</option>
              <option value="completed">Completed</option>
            </select>
            <select
              value={kioskTaskDueFilter}
              onChange={(e) => setKioskTaskDueFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]/40"
            >
              <option value="next7">Next 7d</option>
              <option value="next14">Next 14d</option>
              <option value="next30">Next 30d</option>
              <option value="all_future">All future</option>
            </select>
            <select
              value={kioskTaskSortMode}
              onChange={(e) => setKioskTaskSortMode(e.target.value)}
              className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]/40"
            >
              <option value="due">Sort: Due date</option>
              <option value="client">Sort: Client</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
            <input
              type="checkbox"
              checked={todoMineOnly}
              onChange={(e) => setTodoMineOnly(e.target.checked)}
            />
            Only my tasks
          </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-2 pr-1 max-h-[min(320px,44vh)] lg:max-h-[min(440px,calc(100dvh-16rem))] [scrollbar-gutter:stable]">
            {kioskFilteredRows.length === 0 ? (
              <p className="text-xs text-slate-400">No tasks match these filters.</p>
            ) : (
              kioskFilteredRows
                .filter((row) => row?.item?.id != null && row.item.id !== '')
                .map((row) => {
                const client = (clientsFull || []).find((cl) => cl.id === row.clientId);
                const tone = getUrgencyTone(row.item);
                const titleClass =
                  tone === 'normal' ? 'text-slate-700' : 'text-white';
                const metaClass =
                  tone === 'normal' ? 'text-slate-500' : 'text-white/90';
                const dueClass =
                  tone === 'normal' ? 'text-slate-500' : 'text-white';
                return (
                  <div
                    key={`${row.clientId}__${row.categoryKey}__${row.item.id}`}
                    className={`rounded-xl p-2 border border-slate-100 ${getUrgencyClass(row.item)}`}
                  >
                    <div className={`text-[10px] font-black truncate ${titleClass}`}>{row.clientName}</div>
                    <div className={`text-[9px] truncate ${metaClass}`}>{row.categoryLabel}</div>
                    <div className={`text-xs font-bold leading-snug line-clamp-2 ${titleClass}`}>{safeDisplayForReact(row.item.text) || '(no text)'}</div>
                    {row.item.dueDate ? (
                      <div className={`text-[9px] font-bold mt-0.5 ${dueClass}`}>
                        Due {new Date(row.item.dueDate).toLocaleDateString()}
                      </div>
                    ) : (
                      <div className={`text-[9px] font-bold mt-0.5 ${metaClass}`}>No due date</div>
                    )}
                    {!row.item.done && client && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = buildKioskBillingTargetFromTodoRow(
                            row,
                            client,
                            projects,
                            todoCategoryKey,
                            GENERAL_LABEL,
                          );
                          queueKioskTaskStart(row.clientName, target);
                        }}
                        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800"
                      >
                        <Play className="w-3.5 h-3.5" aria-hidden />
                        Start task
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 border-t border-slate-100 pt-4 mt-1 space-y-3 min-h-0">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Your To-Do List
            </div>
            <p className="text-[10px] font-bold text-slate-400 leading-snug">
              Personal items stay here until you link one to a client and category or project — then it moves to Client to-dos.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={personalListDraft}
                onChange={(e) => setPersonalListDraft(e.target.value)}
                placeholder="Add a to-do…"
                className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#fd7414]/40"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  (async () => {
                    const text = String(personalListDraft || '').trim();
                    if (!text || !updateUserTodos) return;
                    setPersonalListSaving(true);
                    try {
                      const nid = `user_todo_${Date.now()}_${Math.random()
                        .toString(36)
                        .slice(2)}`;
                      await updateUserTodos([
                        ...(userTodos || []),
                        {
                          id: nid,
                          text,
                          done: false,
                          doneAt: null,
                          createdAt: Date.now(),
                          assigneeEmails: meLower ? [meLower] : [],
                        },
                      ]);
                      setPersonalListDraft('');
                    } finally {
                      setPersonalListSaving(false);
                    }
                  })();
                }}
              />
              <button
                type="button"
                disabled={
                  personalListSaving ||
                  !updateUserTodos ||
                  !String(personalListDraft || '').trim()
                }
                onClick={async () => {
                  const text = String(personalListDraft || '').trim();
                  if (!text || !updateUserTodos) return;
                  setPersonalListSaving(true);
                  try {
                    const nid = `user_todo_${Date.now()}_${Math.random()
                      .toString(36)
                      .slice(2)}`;
                    await updateUserTodos([
                      ...(userTodos || []),
                      {
                        id: nid,
                        text,
                        done: false,
                        doneAt: null,
                        createdAt: Date.now(),
                        assigneeEmails: meLower ? [meLower] : [],
                      },
                    ]);
                    setPersonalListDraft('');
                  } finally {
                    setPersonalListSaving(false);
                  }
                }}
                className="shrink-0 px-4 py-2 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <div className="max-h-[min(260px,36vh)] lg:max-h-[min(300px,calc(100dvh-22rem))] overflow-y-auto overscroll-contain space-y-2 pr-1 [scrollbar-gutter:stable]">
              {(userTodos || []).length === 0 ? (
                <p className="text-xs text-slate-400">No personal to-dos yet.</p>
              ) : (
                [...(userTodos || [])]
                  .sort((a, b) => {
                    if (!!a.done === !!b.done) return 0;
                    return a.done ? 1 : -1;
                  })
                  .map((t) => {
                    const rawAssign = Array.isArray(t.assigneeEmails)
                      ? t.assigneeEmails
                          .map((e) => String(e || '').trim().toLowerCase())
                          .filter(Boolean)
                      : [];
                    const assignOpen = personalAssigneeOpenId === t.id;
                    return (
                      <div
                        key={t.id}
                        className="rounded-xl p-2 border border-slate-100 bg-slate-50/50 space-y-1"
                      >
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!t.done}
                            disabled={personalListSaving || !updateUserTodos}
                            onChange={async () => {
                              if (!updateUserTodos) return;
                              setPersonalListSaving(true);
                              try {
                                await updateUserTodos(
                                  (userTodos || []).map((x) =>
                                    x.id === t.id
                                      ? {
                                          ...x,
                                          done: !x.done,
                                          doneAt: !x.done ? Date.now() : null,
                                        }
                                      : x,
                                  ),
                                );
                              } finally {
                                setPersonalListSaving(false);
                              }
                            }}
                            className="mt-0.5"
                          />
                          <span
                            className={`text-xs font-bold flex-1 min-w-0 ${
                              t.done ? 'line-through text-slate-400' : 'text-slate-800'
                            }`}
                          >
                            {safeDisplayForReact(t.text) || '(no text)'}
                          </span>
                        </label>
                        <div className="text-[9px] font-bold text-slate-400 pl-6">
                          {t.dueDate
                            ? `Due ${new Date(t.dueDate).toLocaleDateString()}`
                            : 'No due date'}
                          {' · '}
                          {rawAssign.length
                            ? `Assigned: ${rawAssign.join(', ')}`
                            : 'Unassigned'}
                        </div>
                        <div className="flex flex-wrap gap-1.5 pl-6">
                          <div className="relative">
                            <button
                              type="button"
                              disabled={personalListSaving}
                              onClick={() =>
                                setPersonalAssigneeOpenId((prev) =>
                                  prev === t.id ? null : t.id,
                                )
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-600"
                            >
                              Assign
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            {assignOpen && (
                              <div className="absolute left-0 z-[130] mt-1 w-[260px] max-w-[85vw] bg-white border border-slate-200 rounded-xl shadow-xl p-2">
                                <div className="max-h-[180px] overflow-y-auto space-y-1">
                                  {assignableEmails.map((email) => {
                                    const checked = rawAssign.includes(email);
                                    return (
                                      <label
                                        key={email}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs font-bold"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={async () => {
                                            if (!updateUserTodos) return;
                                            const next = checked
                                              ? rawAssign.filter((e) => e !== email)
                                              : [...rawAssign, email].sort();
                                            setPersonalListSaving(true);
                                            try {
                                              await updateUserTodos(
                                                (userTodos || []).map((x) =>
                                                  x.id === t.id
                                                    ? { ...x, assigneeEmails: next }
                                                    : x,
                                                ),
                                              );
                                            } finally {
                                              setPersonalListSaving(false);
                                            }
                                          }}
                                        />
                                        <span className="truncate">{email}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                                <button
                                  type="button"
                                  className="mt-2 w-full text-[9px] font-black uppercase text-slate-500"
                                  onClick={() => setPersonalAssigneeOpenId(null)}
                                >
                                  Done
                                </button>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={personalListSaving}
                            onClick={() => {
                              setPersonalOptionsItemId(t.id);
                              setPersonalOptionsDue(asDateInputMs(t.dueDate));
                              const tp = t?.recurrence?.type;
                              let mode = 'none';
                              if (tp === 'weekly_weekday') mode = 'weekly';
                              else if (tp === 'biweekly_weekday') mode = 'biweekly';
                              else if (tp === 'daily_fixed') mode = 'daily';
                              else if (tp === 'annual_fixed') mode = 'annual';
                              else if (tp === 'monthly_fixed_day' || t?.recurring) mode = 'monthly';
                              setPersonalOptionsRecurrence(mode);
                            }}
                            className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-600"
                          >
                            Options
                          </button>
                          <button
                            type="button"
                            disabled={personalListSaving || !updateClientTodo}
                            onClick={() => {
                              setPersonalLinkItem(t);
                              const first = (clients || [])[0];
                              setLinkPickClientId(first?.id || '');
                              setLinkPickKind('retainer');
                              setLinkPickRetainerName('');
                              setLinkPickProjectId('');
                            }}
                            className="px-2 py-1 rounded-lg bg-[#fd7414]/10 border border-[#fd7414]/30 text-[9px] font-black uppercase tracking-widest text-[#fd7414]"
                          >
                            Link to client
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </aside>
      </div>

      {personalLinkItem && (
        <div className="fixed inset-0 z-[140] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start gap-2">
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                Link to client list
              </h4>
              <button
                type="button"
                className="text-xs font-bold text-slate-400 hover:text-slate-600"
                onClick={() => setPersonalLinkItem(null)}
              >
                Close
              </button>
            </div>
            <p className="text-xs font-bold text-slate-500">
              Choose where this to-do should live. It will be removed from your personal list after linking.
            </p>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
                Client
              </label>
              <select
                value={linkPickClientId}
                onChange={(e) => {
                  setLinkPickClientId(e.target.value);
                  setLinkPickRetainerName('');
                  setLinkPickProjectId('');
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold"
              >
                <option value="">Select client…</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
                Target type
              </label>
              <select
                value={linkPickKind}
                onChange={(e) => {
                  setLinkPickKind(e.target.value);
                  setLinkPickRetainerName('');
                  setLinkPickProjectId('');
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold"
              >
                <option value="retainer">Retainer category</option>
                <option value="project">Custom project</option>
              </select>
            </div>
            {linkPickKind === 'retainer' ? (
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
                  Category
                </label>
                <select
                  value={linkPickRetainerName}
                  onChange={(e) => setLinkPickRetainerName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold"
                >
                  <option value="">Select category…</option>
                  {Object.keys(
                    (clients || []).find((c) => c.id === linkPickClientId)?.retainers ||
                      {},
                  ).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
                  Project
                </label>
                <select
                  value={linkPickProjectId}
                  onChange={(e) => setLinkPickProjectId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold"
                >
                  <option value="">Select project…</option>
                  {(projects || [])
                    .filter(
                      (p) =>
                        p &&
                        String(p.clientId || '') === String(linkPickClientId) &&
                        !p.archived,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title || p.id}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                className="px-4 py-2 rounded-xl text-xs font-black bg-slate-100 text-slate-600"
                onClick={() => setPersonalLinkItem(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  personalListSaving ||
                  !linkPickClientId ||
                  (linkPickKind === 'retainer' && !linkPickRetainerName) ||
                  (linkPickKind === 'project' && !linkPickProjectId) ||
                  !updateUserTodos ||
                  !updateClientTodo ||
                  !getTodoStateForCycle
                }
                onClick={async () => {
                  const client = (clients || []).find((c) => c.id === linkPickClientId);
                  if (!client || !personalLinkItem) return;
                  const cycleStart = getBillingPeriod(client.billingDay || 1, 0).start;
                  if (client?.cycleLocks?.[String(cycleStart)]?.locked) {
                    window.alert('This billing cycle is locked. Unlock it on the client page first.');
                    return;
                  }
                  const categoryKey =
                    linkPickKind === 'project'
                      ? todoCategoryKey(`project_${linkPickProjectId}`)
                      : todoCategoryKey(linkPickRetainerName);
                  const todoState = getTodoStateForCycle(client, cycleStart);
                  const catTodo = todoState[categoryKey] || {
                    closed: false,
                    items: [],
                  };
                  const items = catTodo.items || [];
                  const newId = `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                  const newItem = {
                    id: newId,
                    text: safeDisplayForReact(personalLinkItem.text) || '(no text)',
                    done: !!personalLinkItem.done,
                    doneAt: personalLinkItem.doneAt || null,
                    assigneeEmails: Array.isArray(personalLinkItem.assigneeEmails)
                      ? personalLinkItem.assigneeEmails.filter(Boolean)
                      : [],
                    dueDate: personalLinkItem.dueDate ?? null,
                    recurrence: personalLinkItem.recurrence || null,
                    recurring: !!personalLinkItem.recurring,
                    recurringId: personalLinkItem.recurringId || null,
                    pinned: !!personalLinkItem.pinned,
                  };
                  setPersonalListSaving(true);
                  try {
                    await updateClientTodo(client, cycleStart, categoryKey, {
                      ...catTodo,
                      items: [...items, newItem],
                    });
                    await updateUserTodos(
                      (userTodos || []).filter((x) => x.id !== personalLinkItem.id),
                    );
                    setPersonalLinkItem(null);
                  } catch (err) {
                    window.alert(err?.message || String(err));
                  } finally {
                    setPersonalListSaving(false);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-black bg-black text-white disabled:opacity-40"
              >
                {personalListSaving ? 'Linking…' : 'Link & move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {personalOptionsItemId && personalOptionsTargetItem && (
        <div className="fixed inset-0 z-[140] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-5 space-y-4">
            <div className="flex justify-between items-start">
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                To-do options
              </h4>
              <button
                type="button"
                className="text-xs font-bold text-slate-400"
                onClick={() => setPersonalOptionsItemId(null)}
              >
                Close
              </button>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
                Due date
              </label>
              <input
                type="date"
                value={personalOptionsDue}
                onChange={(e) => setPersonalOptionsDue(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
                Recurrence
              </label>
              <select
                value={personalOptionsRecurrence}
                onChange={(e) => setPersonalOptionsRecurrence(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              >
                <option value="none">No repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (same weekday)</option>
                <option value="biweekly">Bi-weekly (same weekday)</option>
                <option value="monthly">Monthly (same day of month)</option>
                <option value="annual">Annually (same calendar date)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-xl text-xs font-black bg-slate-100"
                onClick={() => {
                  setPersonalOptionsDue('');
                  setPersonalOptionsRecurrence('none');
                }}
              >
                Clear
              </button>
              <button
                type="button"
                disabled={personalListSaving || !updateUserTodos}
                onClick={async () => {
                  if (!updateUserTodos) return;
                  const dueDate = parseDateInputToMs(personalOptionsDue);
                  const recurrence = buildPersonalRecurrenceFromMode(
                    personalOptionsRecurrence,
                    dueDate,
                  );
                  const tid = personalOptionsTargetItem.id;
                  setPersonalListSaving(true);
                  try {
                    await updateUserTodos(
                      (userTodos || []).map((x) =>
                        x.id === tid
                          ? {
                              ...x,
                              dueDate,
                              recurrence,
                              recurring: !!recurrence,
                              recurringId: recurrence ? x.recurringId || x.id : null,
                            }
                          : x,
                      ),
                    );
                    setPersonalOptionsItemId(null);
                  } finally {
                    setPersonalListSaving(false);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-black bg-[#fd7414] text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {idleFailsafeOpen && activeShift && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 text-center">
            <h3 className="text-lg font-black text-slate-900">Still working?</h3>
            <p className="text-sm font-bold text-slate-600">
              We haven&apos;t seen any activity for a while. Confirm you&apos;re still at
              the kiosk, or your shift will end automatically.
            </p>
            <div className="text-3xl font-black text-[#fd7414] font-mono">
              {idleFailsafeOpen.seconds}s
            </div>
            <button
              type="button"
              onClick={() => {
                lastActivityRef.current = Date.now();
                setIdleFailsafeOpen(null);
              }}
              className="w-full py-4 rounded-2xl bg-black text-white font-black text-sm uppercase tracking-widest hover:bg-slate-800"
            >
              I&apos;m here
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeKiosk;

