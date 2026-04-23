import React from 'react';
import { orderTodosForDisplay } from '../utils/todoListOrder.js';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ListChecks,
  Plus,
  FolderGit2,
  LogOut,
} from 'lucide-react';

const ClientPortal = ({
  clientProfile,
  portalOffset,
  setPortalOffset,
  taskLogs,
  expenses,
  projects,
  addons,
  getBillingPeriod,
  getGlobalRetainerStats,
  formatTime,
  getTaskDuration,
  getTodoStateForCycle,
  todoCategoryKey,
  setAddonModal,
  setProjectModal,
  updateProject,
  logAudit,
  setUser,
  signOut,
  auth,
}) => {
  const minPortalOffset = (() => {
    if (!clientProfile.clientStartDate) return -1e9;
    let o = 0;
    for (let i = 0; i < 1200; i++) {
      const p = getBillingPeriod(clientProfile.billingDay || 1, o - 1);
      if (p.end < clientProfile.clientStartDate) return o;
      o--;
    }
    return o;
  })();
  const effectivePortalOffset = Math.max(portalOffset, minPortalOffset);
  const period = getBillingPeriod(clientProfile.billingDay || 1, effectivePortalOffset);
  const mStart = period.start;
  const mEnd = period.end;

  const cTasks = taskLogs.filter(
    (t) =>
      t.clientName === clientProfile.name &&
      t.clockInTime >= mStart &&
      t.clockInTime <= mEnd,
  );
  const cExps = expenses.filter(
    (e) =>
      e.clientName === clientProfile.name &&
      e.date >= mStart &&
      e.date <= mEnd,
  );
  const retainerTasksThisCycle = cTasks.filter((t) => !t.projectId);
  const projectTasksThisCycle = cTasks.filter((t) => t.projectId);
  const retainerExpsThisCycle = cExps.filter((e) => !e.projectId);
  const projectExpsThisCycle = cExps.filter((e) => e.projectId);
  const cProjects = projects.filter((p) => p.clientId === clientProfile.id);

  const todoState =
    getTodoStateForCycle && todoCategoryKey
      ? getTodoStateForCycle(clientProfile, mStart) || {}
      : {};
  const labelForTodoCategoryKey = (key) => {
    const hit = Object.keys(clientProfile.retainers || {}).find(
      (cat) => todoCategoryKey(cat) === key,
    );
    if (hit) return hit;
    if (key === todoCategoryKey('General / Unclassified')) {
      return 'General / Unclassified';
    }
    return key;
  };
  const hasTodosForCycle = Object.values(todoState).some(
    (cat) => (cat?.items || []).length > 0,
  );

  const pendingRequests = cProjects.filter((p) =>
    ['requested', 'estimate_sent', 'approved', 'active'].includes(p.status),
  );

  const stats = getGlobalRetainerStats(clientProfile, mStart, mEnd, {
    taskLogs,
    expenses,
    addons,
    getTaskDuration,
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <nav className="bg-white border-b border-slate-100 p-4 sticky top-0 z-40 shadow-sm flex justify-between items-center px-8">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Ignite Marketing"
            className="w-10 h-10 object-contain"
          />
          <span className="font-black text-xl tracking-tight hidden sm:inline">
            Ignite Marketing Client Portal
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-bold text-sm text-slate-500 hidden sm:inline">
            {clientProfile.name}
          </span>
          <button
            onClick={() => {
              setUser(null);
              signOut(auth);
            }}
            className="p-2 text-slate-400 hover:text-red-500 transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-6 pb-24 space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-3xl font-black text-slate-900">Dashboard</h2>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-1">
              Retainer & Activity Tracking
            </p>
          </div>

          <div className="flex items-center gap-4 bg-white border border-slate-200 p-2 rounded-2xl shadow-sm">
            <button
              onClick={() => {
                setPortalOffset((prev) => {
                  const next = prev - 1;
                  if (clientProfile.clientStartDate) {
                    const p = getBillingPeriod(clientProfile.billingDay || 1, next);
                    if (p.end < clientProfile.clientStartDate) return prev;
                  }
                  return next;
                });
              }}
              disabled={effectivePortalOffset <= minPortalOffset}
              className={`p-2 rounded-xl transition-colors ${
                effectivePortalOffset <= minPortalOffset
                  ? 'opacity-30 cursor-not-allowed'
                  : 'hover:bg-slate-100'
              }`}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-sm font-bold text-slate-700 min-w-[160px] text-center">
              {new Date(mStart).toLocaleDateString()} -{' '}
              {new Date(mEnd).toLocaleDateString()}
            </div>
            <button
              onClick={() => setPortalOffset((prev) => prev + 1)}
              disabled={portalOffset >= 0}
              className={`p-2 rounded-xl transition-colors ${
                portalOffset >= 0
                  ? 'opacity-30'
                  : 'hover:bg-slate-100'
              }`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-white p-8 sm:p-10 rounded-[40px] shadow-sm border border-slate-100 space-y-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h3 className="font-black text-xl text-slate-900">
              Retainer usage (hour lines)
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setAddonModal(clientProfile)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2"
              >
                <Plus className="w-3 h-3" /> Add Hours
              </button>
              <button
                onClick={() => setProjectModal(clientProfile)}
                className="bg-black hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2"
              >
                <FolderGit2 className="w-3 h-3" /> Request Project
              </button>
            </div>
          </div>

          {!stats ? (
            <p className="text-slate-400 italic">
              No retainers configured for your account.
            </p>
          ) : (
            <>
              <div className="bg-slate-50 p-6 sm:p-8 rounded-3xl border border-slate-100">
                <div className="flex justify-between items-end mb-2">
                  <span className="font-black text-slate-700 text-lg">
                    All hour lines (rollup)
                  </span>
                  <span className="text-sm font-black text-slate-500">
                    {stats.currentUsed.toFixed(2)}h /{' '}
                    {stats.adjustedAllotted.toFixed(2)}h
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-bold mb-4">
                  Base: {stats.base.toFixed(2)}h
                  {stats.carryover !== 0 &&
                    ` | Carryover: ${
                      stats.carryover > 0 ? '+' : ''
                    }${stats.carryover.toFixed(2)}h`}
                  {stats.currentAddons > 0 &&
                    ` | Add-ons: +${stats.currentAddons.toFixed(2)}h`}
                </div>
                <div className="w-full bg-slate-200 rounded-full h-4 mb-2 overflow-hidden shadow-inner">
                  <div
                    className={`${
                      stats.isOver
                        ? 'bg-red-500'
                        : stats.percent > 85
                        ? 'bg-orange-500'
                        : 'bg-[#fd7414]'
                    } h-4 rounded-full transition-all duration-1000`}
                    style={{ width: `${stats.percent}%` }}
                  ></div>
                </div>
                {stats.isOver && (
                  <p className="text-xs font-black text-red-500 uppercase tracking-widest text-right mt-3">
                    Over Retainer Limit by{' '}
                    {(
                      stats.currentUsed - stats.adjustedAllotted
                    ).toFixed(2)}
                    h
                  </p>
                )}
              </div>

              {clientProfile.retainers &&
                Object.keys(clientProfile.retainers).length > 0 && (
                  <div className="pt-4 border-t border-slate-100">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">
                      Retainer Categories
                    </h4>
                    <div className="space-y-3">
                      {Object.entries(clientProfile.retainers).map(
                        ([cat, base]) => {
                          const used = stats.categoryBreakdown[cat] || 0;
                          const pct =
                            Number(base) > 0
                              ? Math.min(100, (used / Number(base)) * 100)
                              : 0;
                          const over =
                            Number(base) > 0 && used > Number(base);
                          return (
                            <div key={cat}>
                              <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                                <span>{cat}</span>
                                <span>
                                  {used.toFixed(2)}h /{' '}
                                  {Number(base).toFixed(2)}h
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                                <div
                                  className={`h-2 rounded-full ${
                                    over
                                      ? 'bg-red-500'
                                      : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                )}
            </>
          )}
        </div>

        {pendingRequests.length > 0 && (
          <div className="bg-white p-8 sm:p-10 rounded-[40px] shadow-sm border border-slate-100 space-y-6">
            <h3 className="font-black text-xl text-slate-900 mb-2">
              Project Requests
            </h3>
            <div className="space-y-4">
              {pendingRequests.map((p) => (
                <div
                  key={p.id}
                  className="p-6 rounded-3xl border border-slate-100 bg-slate-50"
                >
                  <div className="flex flex-col sm:flex-row justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-800 text-lg">
                        {p.category || p.title || 'Project'}
                      </div>
                      {(p.requestDescription || p.description) && (
                        <div className="text-sm text-slate-500 font-medium italic mt-1">
                          &quot;{p.requestDescription || p.description}&quot;
                        </div>
                      )}
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3">
                        Status: {p.status}
                      </div>
                      <div className="text-[10px] text-slate-400 font-bold mt-2 space-y-1">
                        <div>
                          Requested:{' '}
                          {p.createdAt
                            ? new Date(p.createdAt).toLocaleDateString()
                            : '—'}
                        </div>
                        <div>
                          Estimate:{' '}
                          {p.estimate?.sentAt
                            ? new Date(p.estimate.sentAt).toLocaleDateString()
                            : '—'}
                        </div>
                        <div>
                          Started:{' '}
                          {p.startedAt
                            ? new Date(p.startedAt).toLocaleDateString()
                            : '—'}
                        </div>
                      </div>
                    </div>

                    {p.status === 'estimate_sent' && p.estimate && (
                      <div className="bg-white border border-slate-200 rounded-2xl p-4 min-w-[220px]">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Estimate
                        </div>
                        <div className="text-sm font-black text-slate-800">
                          {Number(p.estimate.hours || 0).toFixed(1)} hours
                        </div>
                        <div className="text-sm font-black text-[#fd7414]">
                          ${Number(p.estimate.cost || 0).toFixed(2)}
                        </div>
                        {p.estimate.notes && (
                          <div className="text-xs text-slate-500 font-medium mt-2 italic">
                            &quot;{p.estimate.notes}&quot;
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {p.status === 'estimate_sent' && (
                    <div className="flex gap-3 mt-5">
                      <button
                        onClick={() =>
                          updateProject(p.id, {
                            status: 'approved',
                            clientDecision: {
                              approved: true,
                              decidedAt: Date.now(),
                            },
                            notificationState: {
                              ...(p.notificationState || {}),
                              clientNeedsDecision: false,
                              adminNeedsReview: false,
                              adminApproved: true,
                            },
                          }).then(() =>
                            logAudit?.({
                              type: 'estimate_approved',
                              entityType: 'project',
                              entityId: p.id,
                              clientId: clientProfile.id,
                              cycleStart: mStart,
                            }),
                          )
                        }
                        className="flex-1 bg-black hover:bg-slate-800 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
                      >
                        Approve Estimate
                      </button>
                      <button
                        onClick={() =>
                          updateProject(p.id, {
                            status: 'rejected',
                            clientDecision: {
                              approved: false,
                              decidedAt: Date.now(),
                            },
                            notificationState: {
                              ...(p.notificationState || {}),
                              clientNeedsDecision: false,
                            },
                          }).then(() =>
                            logAudit?.({
                              type: 'estimate_rejected',
                              entityType: 'project',
                              entityId: p.id,
                              clientId: clientProfile.id,
                              cycleStart: mStart,
                            }),
                          )
                        }
                        className="flex-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {cProjects.length > 0 && (
          <div className="bg-white p-8 sm:p-10 rounded-[40px] shadow-sm border border-slate-100 space-y-6">
            <h3 className="font-black text-xl text-slate-900 mb-2">
              Custom Projects
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cProjects.map((p) => {
                const pTasks = taskLogs.filter((t) => t.projectId === p.id);
                const pHours =
                  pTasks.reduce(
                    (a, b) => a + getTaskDuration(b),
                    0,
                  ) / 3600000;
                return (
                  <div
                    key={p.id}
                    className="bg-slate-50 p-6 rounded-3xl border border-slate-100"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-black text-slate-800 text-lg">
                        {p.title}
                      </h4>
                      <span
                        className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${
                          p.status === 'active'
                            ? 'bg-emerald-100 text-emerald-600'
                            : p.status === 'closed'
                            ? 'bg-slate-200 text-slate-500'
                            : 'bg-orange-100 text-orange-600'
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-medium mb-4 italic line-clamp-2">
                      &quot;{p.description}&quot;
                    </p>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                      <Clock className="w-3 h-3" />{' '}
                      {pHours.toFixed(2)}h tracked
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {getTodoStateForCycle && todoCategoryKey && (
          <div className="bg-white p-8 sm:p-10 rounded-[40px] shadow-sm border border-slate-100 space-y-6">
            <div className="flex items-center gap-3">
              <ListChecks className="w-6 h-6 text-[#fd7414]" />
              <div>
                <h3 className="font-black text-xl text-slate-900">
                  Tasks this billing cycle
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                  Shared by your team — view only
                </p>
              </div>
            </div>
            {!hasTodosForCycle ? (
              <p className="text-slate-400 italic text-sm">
                No tasks listed for this cycle yet.
              </p>
            ) : (
              <div className="space-y-6">
                {Object.entries(todoState).map(([catKey, catTodo]) => {
                  const items = orderTodosForDisplay(catTodo?.items || []);
                  if (!items.length) return null;
                  const closed = !!catTodo?.closed;
                  return (
                    <div
                      key={catKey}
                      className="rounded-2xl border border-slate-100 bg-slate-50/80 p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest">
                          {labelForTodoCategoryKey(catKey)}
                        </h4>
                        {closed && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            Closed for cycle
                          </span>
                        )}
                      </div>
                      <ul className="space-y-2">
                        {items.map((item) => (
                          <li
                            key={item.id}
                            className={`flex flex-wrap items-baseline gap-2 text-sm ${
                              item.done
                                ? 'text-slate-400 line-through'
                                : 'text-slate-800 font-medium'
                            }`}
                          >
                            <span>{item.text || '(No description)'}</span>
                            {item.pinned && (
                              <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                Pinned
                              </span>
                            )}
                            {item.recurring && (
                              <span className="text-[9px] font-black uppercase tracking-widest text-[#fd7414] bg-orange-50 px-1.5 py-0.5 rounded">
                                Recurring
                              </span>
                            )}
                            {item.dueDate && (
                              <span className="text-[10px] font-bold text-slate-400">
                                Due{' '}
                                {new Date(item.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="bg-white p-8 sm:p-10 rounded-[40px] shadow-sm border border-slate-100 space-y-6">
          <h3 className="font-black text-xl text-slate-900 mb-2">
            Activity — retainer (this cycle)
          </h3>
          {retainerTasksThisCycle.length === 0 &&
          retainerExpsThisCycle.length === 0 ? (
            <p className="text-slate-400 italic text-sm">
              No retainer time or expenses in this period.
            </p>
          ) : (
            <div className="space-y-4">
              {retainerTasksThisCycle.map((t) => (
                <div
                  key={t.id}
                  className="p-5 bg-slate-50 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-l-4 border-[#fd7414]/40"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-black text-slate-800">
                        {t.projectName || 'Retainer'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold">
                        {new Date(t.clockInTime).toLocaleDateString()}
                      </span>
                    </div>
                    {t.notes && (
                      <p className="text-sm text-slate-500 font-medium">
                        &quot;{t.notes}&quot;
                      </p>
                    )}
                  </div>
                  <div className="font-black text-[#fd7414] shrink-0 font-mono">
                    {formatTime(getTaskDuration(t))}
                  </div>
                </div>
              ))}
              {retainerExpsThisCycle.map((e) => (
                <div
                  key={e.id}
                  className="p-5 bg-slate-50 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-l-4 border-blue-400"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-black text-slate-800">
                        {e.category || 'Expense'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold">
                        {new Date(e.date).toLocaleDateString()}
                      </span>
                    </div>
                    {e.description && (
                      <p className="text-sm text-slate-500 font-medium">
                        &quot;{e.description}&quot;
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-black text-blue-500">
                      ${Number(e.finalCost || 0).toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                      {(e.equivalentHours ?? 0).toFixed(2)} hrs deducted
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-8 sm:p-10 rounded-[40px] shadow-sm border border-slate-100 space-y-6">
          <h3 className="font-black text-xl text-slate-900 mb-2">
            Activity — custom projects (this cycle)
          </h3>
          {projectTasksThisCycle.length === 0 &&
          projectExpsThisCycle.length === 0 ? (
            <p className="text-slate-400 italic text-sm">
              No project time or expenses logged in this period.
            </p>
          ) : (
            <div className="space-y-4">
              {projectTasksThisCycle.map((t) => {
                const pTitle =
                  cProjects.find((p) => p.id === t.projectId)?.title ||
                  'Project';
                return (
                  <div
                    key={t.id}
                    className="p-5 bg-slate-50 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-l-4 border-violet-400"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-slate-800">
                          {pTitle}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold">
                          {new Date(t.clockInTime).toLocaleDateString()}
                        </span>
                      </div>
                      {t.notes && (
                        <p className="text-sm text-slate-500 font-medium">
                          &quot;{t.notes}&quot;
                        </p>
                      )}
                    </div>
                    <div className="font-black text-[#fd7414] shrink-0 font-mono">
                      {formatTime(getTaskDuration(t))}
                    </div>
                  </div>
                );
              })}
              {projectExpsThisCycle.map((e) => {
                const pTitle =
                  cProjects.find((p) => p.id === e.projectId)?.title ||
                  'Project';
                return (
                  <div
                    key={e.id}
                    className="p-5 bg-slate-50 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-l-4 border-violet-500"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-slate-800">
                          {pTitle}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold">
                          {new Date(e.date).toLocaleDateString()}
                        </span>
                      </div>
                      {e.description && (
                        <p className="text-sm text-slate-500 font-medium">
                          &quot;{e.description}&quot;
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-black text-blue-500">
                        ${Number(e.finalCost || 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                        {(e.equivalentHours ?? 0).toFixed(2)} hrs deducted
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ClientPortal;

