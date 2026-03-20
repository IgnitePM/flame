import React from 'react';
import {
  Activity,
  Coffee,
  History,
  LogOut,
  Pause,
  Play,
} from 'lucide-react';

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
  getTodoStateForCycle,
  updateClientTodo,
  todoCategoryKey,
}) => {
  const [clientSearch, setClientSearch] = React.useState('');
  const [socialAdAmount, setSocialAdAmount] = React.useState('');
  const [socialAdDescription, setSocialAdDescription] = React.useState('');
  const [socialAdSubmitting, setSocialAdSubmitting] = React.useState(false);
  const [todoNewText, setTodoNewText] = React.useState('');
  const [todoSaving, setTodoSaving] = React.useState(false);
  const [todoDueDate, setTodoDueDate] = React.useState('');
  const [todoMineOnly, setTodoMineOnly] = React.useState(true);
  const [todoRecurrenceMode, setTodoRecurrenceMode] = React.useState('none');
  const [todoOptionsOpen, setTodoOptionsOpen] = React.useState(false);

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

  const asDateInput = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    if (due < now) return 'bg-red-600 border border-red-700 text-white';
    if (due - now <= fiveDays)
      return 'bg-emerald-600 border border-emerald-700 text-white';
    return 'bg-white border border-slate-100 text-slate-800';
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
  const isDollarCategory = selectedRetainerCategory === SOCIAL_AD_CATEGORY || selectedClientObj?.retainerUnits?.[selectedRetainerCategory] === 'dollar';
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

  const combinedUsedWithActive = (retainerStats?.currentUsed || 0) + activeDeltaHours;

  const categoryAllotted =
    (selectedClientObj?.retainers &&
      selectedClientObj.retainers[selectedRetainerCategory]) || 0;

  // Used/Allotted units: hours or dollars per client retainerUnits
  const categoryUnitLabel = isDollarCategory ? '$' : '';


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

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="bg-white rounded-[32px] shadow-xl border border-slate-100 overflow-hidden">
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
                          const items = (catTodo.items || []).filter((item) => {
                            if (!todoMineOnly) return true;
                            const me = String(user?.email || '').trim().toLowerCase();
                            return normalizeAssignees(item).includes(me);
                          });
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
                                  checked={todoMineOnly}
                                  onChange={(e) => setTodoMineOnly(e.target.checked)}
                                />
                                Show only tasks assigned to me
                              </label>
                              {!catTodo.closed && (
                                <>
                                  {items.length === 0 ? (
                                    <p className="text-xs italic text-slate-400 mb-2">No items yet.</p>
                                  ) : (
                                    <ul className="space-y-2 mb-3">
                                      {items.map((item) => (
                                        <li
                                          key={item.id}
                                          className={`flex items-center gap-2 rounded-lg p-2 ${getUrgencyClass(item)}`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={!!item.done}
                                            onChange={async () => {
                                              setTodoSaving(true);
                                              try {
                                                const next = items.map((i) =>
                                                  i.id === item.id
                                                    ? { ...i, done: !i.done, doneAt: !i.done ? Date.now() : null }
                                                    : i
                                                );
                                                await updateClientTodo(selectedClientObj, cycleStart, catKey, { ...catTodo, items: next });
                                              } finally {
                                                setTodoSaving(false);
                                              }
                                            }}
                                            disabled={todoSaving}
                                            className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414] w-4 h-4"
                                          />
                                          <span className={`text-sm flex-1 ${item.done ? 'line-through opacity-70' : ''}`}>
                                            {item.text || '(no text)'}
                                            {item.dueDate && (
                                              <span className="ml-2 text-[10px] font-black uppercase tracking-widest">
                                                Due {new Date(item.dueDate).toLocaleDateString()}
                                              </span>
                                            )}
                                          </span>
                                          <input
                                            type="date"
                                            value={asDateInput(item.dueDate)}
                                            onChange={async (e) => {
                                              setTodoSaving(true);
                                              try {
                                                const dueDate = parseDateInputToMs(e.target.value);
                                                const next = catTodo.items.map((i) =>
                                                  i.id === item.id ? { ...i, dueDate } : i,
                                                );
                                                await updateClientTodo(selectedClientObj, cycleStart, catKey, {
                                                  ...catTodo,
                                                  items: next,
                                                });
                                              } finally {
                                                setTodoSaving(false);
                                              }
                                            }}
                                            disabled={todoSaving}
                                            className="bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                                          />
                                          <button
                                            type="button"
                                            disabled={todoSaving}
                                            onClick={async () => {
                                              setTodoSaving(true);
                                              try {
                                                const next = items.map((i) => {
                                                  if (i.id !== item.id) return i;
                                                  const nextRecurring = !i.recurring;
                                                  return {
                                                    ...i,
                                                    recurring: nextRecurring,
                                                    recurringId: nextRecurring
                                                      ? (i.recurringId || i.id)
                                                      : null,
                                                    recurrence: nextRecurring
                                                      ? {
                                                          type: 'monthly_fixed_day',
                                                          dayOfMonth: new Date(
                                                            i.dueDate || Date.now(),
                                                          ).getDate(),
                                                        }
                                                      : null,
                                                  };
                                                });
                                                await updateClientTodo(selectedClientObj, cycleStart, catKey, { ...catTodo, items: next });
                                              } finally {
                                                setTodoSaving(false);
                                              }
                                            }}
                                            className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                                              item.recurring
                                                ? 'bg-[#fd7414] text-white border-[#fd7414]'
                                                : 'bg-white text-slate-500 border-slate-200'
                                            }`}
                                            title="Recurring each cycle"
                                          >
                                            Recurring
                                          </button>
                                        </li>
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
                                              items: [...(catTodo.items || []), newItem],
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
                                            items: [...(catTodo.items || []), newItem],
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

                      {/* Retainer progress (category + combined) for current cycle */}
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

                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                            Combined Pool
                          </div>
                          <div className="text-xs font-black text-slate-700 mb-2">
                            {combinedUsedWithActive.toFixed(2)}h used /{' '}
                            {retainerStats.adjustedAllotted.toFixed(2)}h available
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden mb-2">
                            <div
                              className={`h-3 rounded-full transition-all duration-500 ${
                                retainerStats.isOver ? 'bg-red-500' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.min(100, retainerStats.percent || 0)}%` }}
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
                      <div className="space-y-2">
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

                      {/* To-do list for this category (current cycle) */}
                      {getTodoStateForCycle && updateClientTodo && selectedClientObj && selectedRetainerCategory && cycleStart && (
                        (() => {
                          const catKey = todoCategoryKey ? todoCategoryKey(selectedRetainerCategory) : safeCategoryKey(selectedRetainerCategory);
                          const todoState = getTodoStateForCycle(selectedClientObj, cycleStart);
                          const catTodo = todoState[catKey] || { closed: false, items: [] };
                          const items = (catTodo.items || []).filter((item) => {
                            if (!todoMineOnly) return true;
                            const me = String(user?.email || '').trim().toLowerCase();
                            return normalizeAssignees(item).includes(me);
                          });
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
                                  checked={todoMineOnly}
                                  onChange={(e) => setTodoMineOnly(e.target.checked)}
                                />
                                Show only tasks assigned to me
                              </label>
                              {!catTodo.closed && (
                                <>
                                  {items.length === 0 ? (
                                    <p className="text-xs italic text-slate-400 mb-2">No items yet.</p>
                                  ) : (
                                    <ul className="space-y-2 mb-3">
                                      {items.map((item) => (
                                        <li
                                          key={item.id}
                                          className={`flex items-center gap-2 rounded-lg p-2 ${getUrgencyClass(item)}`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={!!item.done}
                                            onChange={async () => {
                                              setTodoSaving(true);
                                              try {
                                                const next = items.map((i) =>
                                                  i.id === item.id
                                                    ? { ...i, done: !i.done, doneAt: !i.done ? Date.now() : null }
                                                    : i
                                                );
                                                await updateClientTodo(selectedClientObj, cycleStart, catKey, { ...catTodo, items: next });
                                              } finally {
                                                setTodoSaving(false);
                                              }
                                            }}
                                            disabled={todoSaving}
                                            className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414] w-4 h-4"
                                          />
                                          <span className={`text-sm flex-1 ${item.done ? 'line-through opacity-70' : ''}`}>
                                            {item.text || '(no text)'}
                                            {item.dueDate && (
                                              <span className="ml-2 text-[10px] font-black uppercase tracking-widest">
                                                Due {new Date(item.dueDate).toLocaleDateString()}
                                              </span>
                                            )}
                                          </span>
                                          <input
                                            type="date"
                                            value={asDateInput(item.dueDate)}
                                            onChange={async (e) => {
                                              setTodoSaving(true);
                                              try {
                                                const dueDate = parseDateInputToMs(e.target.value);
                                                const next = catTodo.items.map((i) =>
                                                  i.id === item.id ? { ...i, dueDate } : i,
                                                );
                                                await updateClientTodo(selectedClientObj, cycleStart, catKey, {
                                                  ...catTodo,
                                                  items: next,
                                                });
                                              } finally {
                                                setTodoSaving(false);
                                              }
                                            }}
                                            disabled={todoSaving}
                                            className="bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                                          />
                                          <button
                                            type="button"
                                            disabled={todoSaving}
                                            onClick={async () => {
                                              setTodoSaving(true);
                                              try {
                                                const next = items.map((i) => {
                                                  if (i.id !== item.id) return i;
                                                  const nextRecurring = !i.recurring;
                                                  return {
                                                    ...i,
                                                    recurring: nextRecurring,
                                                    recurringId: nextRecurring
                                                      ? (i.recurringId || i.id)
                                                      : null,
                                                    recurrence: nextRecurring
                                                      ? {
                                                          type: 'monthly_fixed_day',
                                                          dayOfMonth: new Date(
                                                            i.dueDate || Date.now(),
                                                          ).getDate(),
                                                        }
                                                      : null,
                                                  };
                                                });
                                                await updateClientTodo(selectedClientObj, cycleStart, catKey, { ...catTodo, items: next });
                                              } finally {
                                                setTodoSaving(false);
                                              }
                                            }}
                                            className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                                              item.recurring
                                                ? 'bg-[#fd7414] text-white border-[#fd7414]'
                                                : 'bg-white text-slate-500 border-slate-200'
                                            }`}
                                            title="Recurring each cycle"
                                          >
                                            Recurring
                                          </button>
                                        </li>
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
                                              items: [...(catTodo.items || []), newItem],
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
                                            items: [...(catTodo.items || []), newItem],
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

                      {/* Retainer progress (category + combined) for current cycle (show while actively working) */}
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

                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                            Combined Pool
                          </div>
                          <div className="text-xs font-black text-slate-700 mb-2">
                            {combinedUsedWithActive.toFixed(2)}h used /{' '}
                            {retainerStats.adjustedAllotted.toFixed(2)}h available
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden mb-2">
                            <div
                              className={`h-3 rounded-full transition-all duration-500 ${
                                combinedUsedWithActive > retainerStats.adjustedAllotted
                                  ? 'bg-red-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  retainerStats.adjustedAllotted > 0
                                    ? (combinedUsedWithActive / retainerStats.adjustedAllotted) * 100
                                    : 0,
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
                  <option value="weekly">Weekly (same weekday)</option>
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
  );
};

export default EmployeeKiosk;

