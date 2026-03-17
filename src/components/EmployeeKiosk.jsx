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
  handleClockIn,
  handleEndBreak,
  handleStartTask,
  handleStopTask,
  handleResumeTask,
  handleTakeBreak,
  handleClockOut,
  formatTime,
}) => {
  const [clientSearch, setClientSearch] = React.useState('');
  const [targetSearch, setTargetSearch] = React.useState('');

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
                              setTargetSearch('');
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
                          <input
                            value={targetSearch}
                            onChange={(e) => setTargetSearch(e.target.value)}
                            className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414] mb-2"
                            placeholder="Search targets..."
                          />
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
                                .filter((opt) =>
                                  targetSearch
                                    ? opt.name
                                        .toLowerCase()
                                        .includes(targetSearch.toLowerCase())
                                    : true,
                                )
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
                                  .filter((p) =>
                                    targetSearch
                                      ? p.title
                                          .toLowerCase()
                                          .includes(targetSearch.toLowerCase())
                                      : true,
                                  )
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
      </div>
    </div>
  );
};

export default EmployeeKiosk;

