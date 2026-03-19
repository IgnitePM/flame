import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckSquare,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  DollarSign,
  Edit3,
  FileDown,
  FileText,
  FolderGit2,
  History,
  List,
  Lock,
  Pencil,
  Search,
  Settings,
  ShoppingCart,
  Trash2,
  Users,
  X,
} from 'lucide-react';

const AdminDashboard = ({
  adminTab,
  setAdminTab,
  clientId,
  navigateToClient,
  navigateToClientsList,
  currentUserRole,
  user,
  clients,
  taskLogs,
  timesheets,
  expenses,
  projects,
  addons,
  taskTypes,
  adminUsers,
  policy,
  updatePolicy,
  newClientName,
  setNewClientName,
  newTaskType,
  setNewTaskType,
  newAdminEmail,
  setNewAdminEmail,
  searchQuery,
  setSearchQuery,
  clientFilter,
  setClientFilter,
  dateFilterType,
  setDateFilterType,
  customDateRange,
  setCustomDateRange,
  expandedShifts,
  toggleShiftAccordion,
  expandedClients,
  toggleClientAccordion,
  manualTaskValues,
  setManualTaskValues,
  setManualTaskModal,
  setExpenseModal,
  setAddonModal,
  setProjectModal,
  setEditingClient,
  setDeleteConfirm,
  startEditing,
  activeTaskTypes,
  getBillingPeriod,
  getShiftDuration,
  getTaskDuration,
  formatTime,
  getGlobalRetainerStats,
  exportCSV,
  exportPDF,
  addDoc,
  setDoc,
  collection,
  updateDoc,
  doc,
  logAudit,
  getTodoStateForCycle,
  updateClientTodo,
  updateClientTodosBatch,
  todoCategoryKey,
}) => {
  const canBilling = currentUserRole === 'admin' || currentUserRole === 'billing';
  const isAdmin = currentUserRole === 'admin';

  // Keep retainer categories stable in the UI even if Firestore map key ordering changes.
  const retainerCategoryOrder = Array.from(
    new Set([...(activeTaskTypes || []), 'Social Ad Budget']),
  );
  const getRetainerCategorySortIndex = (cat) => {
    const idx = retainerCategoryOrder.indexOf(cat);
    return idx === -1 ? 9999 : idx;
  };

  const adminEmailKey = (e) => String(e || '').trim().toLowerCase();
  const adminGroups = (adminUsers || []).reduce((acc, a) => {
    const key = adminEmailKey(a?.email);
    if (!key) return acc;
    if (!acc[key]) acc[key] = { email: a.email, ids: [], role: a.role || 'billing', hasCanonical: false };
    acc[key].ids.push(a.id);
    if (a.id === key) acc[key].hasCanonical = true;
    // Prefer canonical record's role if present
    if (a.id === key && a.role) acc[key].role = a.role;
    return acc;
  }, {});
  const dedupedAdminUsers = Object.entries(adminGroups)
    .filter(([email]) => email !== 'chris@ignitepm.com')
    .map(([email, g]) => ({
      email,
      ids: g.ids,
      role: g.role || 'billing',
      hasCanonical: g.hasCanonical,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
  const [clientCycleOffsets, setClientCycleOffsets] = useState({});
  const [clientStatusFilter, setClientStatusFilter] = useState('all');
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [addClientModalOpen, setAddClientModalOpen] = useState(false);
  const [addClientValues, setAddClientValues] = useState({
    name: '',
    status: 'active',
    hourlyRate: '100',
    billingDay: '1',
    clientStartDate: '',
    clientEmails: '',
  });
  const [clientNotesOpen, setClientNotesOpen] = useState({});
  const [clientNotesDraft, setClientNotesDraft] = useState({});
  const [clientNotesSaving, setClientNotesSaving] = useState({});
  const [cycleNotesDraft, setCycleNotesDraft] = useState({});
  const [cycleNotesSaving, setCycleNotesSaving] = useState({});
  const [aiTodoModalOpen, setAiTodoModalOpen] = useState(false);
  const [aiTodoTranscript, setAiTodoTranscript] = useState('');
  const [aiTodoCandidates, setAiTodoCandidates] = useState([]);
  const [aiTodoSelected, setAiTodoSelected] = useState({});
  const [aiTodoLoading, setAiTodoLoading] = useState(false);
  const [retainerCategoryOpen, setRetainerCategoryOpen] = useState({});
  const [expandedProjectsExpenses, setExpandedProjectsExpenses] = useState({});
  const [todoEditId, setTodoEditId] = useState(null);
  const [todoEditText, setTodoEditText] = useState('');
  const [todoSaving, setTodoSaving] = useState(false);
  const [todoAddTextDraft, setTodoAddTextDraft] = useState({});
  const [estimateModal, setEstimateModal] = useState(null);
  const [estimateValues, setEstimateValues] = useState({
    hours: '',
    cost: '',
    notes: '',
  });
  const [estimateError, setEstimateError] = useState('');
  const [projectEditModal, setProjectEditModal] = useState(null);
  const [projectEditValues, setProjectEditValues] = useState({
    estimatedBudget: '',
    estimatedHours: '',
  });
  const [projectEditError, setProjectEditError] = useState('');

  const exportClientCyclePDF = ({
    client,
    mStart,
    mEnd,
    stats,
    periodTasks,
    periodExps,
    clientProjects,
    taskLogs,
    expenses,
  }) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const fmtDate = (ms) => new Date(ms).toLocaleDateString();
    const fmtMoney = (n) =>
      Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const projectRows = (clientProjects || []).map((p) => {
      const pTasks = (taskLogs || []).filter(
        (t) =>
          t.projectId === p.id && t.clockInTime >= mStart && t.clockInTime <= mEnd,
      );
      const pExps = (expenses || []).filter(
        (e) => e.projectId === p.id && e.date >= mStart && e.date <= mEnd,
      );
      const hours =
        pTasks.reduce((acc, t) => acc + getTaskDuration(t), 0) / 3600000;
      const cost = pExps.reduce((acc, e) => acc + (e.finalCost || 0), 0);
      return {
        title: p.title,
        status: p.status,
        hours,
        cost,
      };
    });

    const html = `
      <html>
        <head>
          <title>Ignite PM - ${client?.name || 'Client'} Cycle Report</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 32px; color: #111827; }
            h1 { color: #fd7414; margin: 0 0 6px 0; }
            .meta { color: #475569; margin-bottom: 22px; font-size: 13px; }
            h2 { margin: 22px 0 10px 0; font-size: 16px; color: #0f172a; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
            th, td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; vertical-align: top; }
            th { background-color: #f8fafc; color: #334155; }
            .muted { color: #64748b; }
            .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #334155; font-size: 11px; font-weight: 700; }
          </style>
        </head>
        <body>
          <h1>${client?.name || 'Client'} - Billing Cycle Report</h1>
          <div class="meta">
            Cycle: ${fmtDate(mStart)} - ${fmtDate(mEnd)}<br/>
            Generated on: ${new Date().toLocaleString()}<br/>
            Billing day: ${(client?.billingDay || 1)}
          </div>

          <h2>Retainer Summary</h2>
          <table>
            <thead>
              <tr>
                <th>Base</th>
                <th>Carryover</th>
                <th>Add-ons</th>
                <th>Allotted</th>
                <th>Used</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${stats ? stats.base?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? stats.carryover?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? stats.currentAddons?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? stats.adjustedAllotted?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? stats.currentUsed?.toFixed?.(2) ?? '' : ''}</td>
                <td>${stats ? (stats.adjustedAllotted - stats.currentUsed).toFixed?.(2) ?? '' : ''}</td>
              </tr>
            </tbody>
          </table>

          <h2>Retainer Tasks (this cycle)</h2>
          ${
            (periodTasks || []).length === 0
              ? `<div class="muted">No retainer tasks logged.</div>`
              : `<table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Task</th>
                      <th>Duration</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(periodTasks || [])
                      .map(
                        (t) => `
                          <tr>
                            <td>${fmtDate(t.clockInTime)}</td>
                            <td>${t.projectName || ''}</td>
                            <td>${formatTime(getTaskDuration(t))}</td>
                            <td>${t.notes ? t.notes : ''}</td>
                          </tr>
                        `,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }

          <h2>Expenses (this cycle)</h2>
          ${
            (periodExps || []).length === 0
              ? `<div class="muted">No expenses logged.</div>`
              : `<table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(periodExps || [])
                      .map(
                        (e) => `
                          <tr>
                            <td>${fmtDate(e.date)}</td>
                            <td>${e.description || ''}</td>
                            <td>$${fmtMoney(e.finalCost || e.amount || 0)}</td>
                          </tr>
                        `,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }

          <h2>Custom Projects (this cycle)</h2>
          ${
            projectRows.length === 0
              ? `<div class="muted">No custom projects.</div>`
              : `<table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Hours</th>
                      <th>Expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${projectRows
                      .map(
                        (p) => `
                          <tr>
                            <td>${p.title}</td>
                            <td><span class="pill">${p.status || ''}</span></td>
                            <td>${p.hours.toFixed(2)}h</td>
                            <td>$${fmtMoney(p.cost)}</td>
                          </tr>
                        `,
                      )
                      .join('')}
                  </tbody>
                </table>`
          }
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const exportClientCycleCSV = ({
    client,
    mStart,
    mEnd,
    stats,
    periodTasks,
    periodExps,
    clientProjects,
    taskLogs,
    expenses,
    addons,
  }) => {
    const rows = [];
    rows.push([
      'Type',
      'Client',
      'CycleStart',
      'CycleEnd',
      'Item',
      'Hours',
      'Cost',
      'Notes',
      'Date',
    ]);

    const cycleStartStr = new Date(mStart).toLocaleDateString();
    const cycleEndStr = new Date(mEnd).toLocaleDateString();

    // Summary row
    if (stats) {
      rows.push([
        'RetainerSummary',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        'Total Pool',
        (stats.adjustedAllotted ?? 0).toFixed?.(2) ?? '',
        '',
        `Used ${stats.currentUsed?.toFixed?.(2) ?? ''}h`,
        '',
      ]);
    }

    (periodTasks || []).forEach((t) => {
      rows.push([
        'RetainerTask',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        t.projectName || '',
        (getTaskDuration(t) / 3600000).toFixed(2),
        '',
        t.notes ? t.notes.replace(/\\n/g, ' ') : '',
        new Date(t.clockInTime).toLocaleDateString(),
      ]);
    });

    (periodExps || []).forEach((e) => {
      rows.push([
        'Expense',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        e.description || '',
        (e.equivalentHours || 0).toFixed(2),
        (e.finalCost || e.amount || 0).toFixed(2),
        '',
        new Date(e.date).toLocaleDateString(),
      ]);
    });

    // Add-ons that bill into this cycle
    (addons || [])
      .filter((a) => a.clientId === client?.id && a.billingCycleStart === mStart)
      .forEach((a) => {
        rows.push([
          'AddOn',
          client?.name || '',
          cycleStartStr,
          cycleEndStr,
          a.category || 'Additional Hours',
          Number(a.hours || 0).toFixed(2),
          (a.priceBreakdown?.total || 0).toFixed(2),
          a.notes || '',
          new Date(a.date).toLocaleDateString(),
        ]);
      });

    // Projects (rollup within cycle)
    (clientProjects || []).forEach((p) => {
      const pTasks = (taskLogs || []).filter(
        (t) =>
          t.projectId === p.id && t.clockInTime >= mStart && t.clockInTime <= mEnd,
      );
      const pExps = (expenses || []).filter(
        (e) => e.projectId === p.id && e.date >= mStart && e.date <= mEnd,
      );
      const hours = pTasks.reduce((acc, t) => acc + getTaskDuration(t), 0) / 3600000;
      const cost = pExps.reduce((acc, e) => acc + (e.finalCost || 0), 0);
      rows.push([
        'Project',
        client?.name || '',
        cycleStartStr,
        cycleEndStr,
        p.title || '',
        hours.toFixed(2),
        cost.toFixed(2),
        p.description || p.requestDescription || '',
        p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '',
      ]);
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      rows
        .map((r) =>
          r
            .map((cell) =>
              `"${String(cell ?? '')
                .replace(/\"/g, '\"\"')
                .trim()}"`,
            )
            .join(','),
        )
        .join('\\n');

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute(
      'download',
      `Ignite_InvoicePack_${client?.name || 'Client'}_${cycleStartStr}_${cycleEndStr}.csv`.replace(
        /\\s+/g,
        '_',
      ),
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const getDateRange = () => {
    const now = new Date();
    let start;
    let end;
    if (dateFilterType === 'day') {
      start = new Date(now.setHours(0, 0, 0, 0)).getTime();
      end = new Date(now.setHours(23, 59, 59, 999)).getTime();
    } else if (dateFilterType === 'week') {
      const day = now.getDay();
      const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now.setDate(diffToMonday));
      start = new Date(monday.setHours(0, 0, 0, 0)).getTime();
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      end = new Date(
        sunday.setHours(23, 59, 59, 999),
      ).getTime();
    } else if (dateFilterType === 'month') {
      start = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      ).getTime();
      end = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      ).getTime();
    } else if (
      dateFilterType === 'custom' &&
      customDateRange.start &&
      customDateRange.end
    ) {
      start = new Date(customDateRange.start).getTime();
      end = new Date(customDateRange.end).setHours(
        23,
        59,
        59,
        999,
      );
    } else {
      return { start: null, end: null };
    }
    return { start, end };
  };

  const currentRange = getDateRange();
  const addonNeedsInvoiceCount = addons.filter(
    (a) => a.notificationState?.adminNeedsInvoice && a.status === 'pending',
  ).length;
  const projectNeedsReviewCount = projects.filter(
    (p) => p.notificationState?.adminNeedsReview && p.status === 'requested',
  ).length;
  const projectApprovedCount = projects.filter(
    (p) => p.notificationState?.adminApproved && p.status === 'approved',
  ).length;
  const filteredTimesheets = timesheets.filter((shift) => {
    const matchesSearch =
      searchQuery === '' ||
      shift.employeeName
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      taskLogs.some(
        (t) =>
          t.shiftId === shift.id &&
          t.clientName
            .toLowerCase()
            .includes(searchQuery.toLowerCase()),
      );
    const matchesClient =
      clientFilter === '' ||
      taskLogs.some(
        (t) => t.shiftId === shift.id && t.clientName === clientFilter,
      );
    let matchesDate = true;
    if (currentRange.start && currentRange.end) {
      matchesDate =
        shift.clockInTime >= currentRange.start &&
        shift.clockInTime <= currentRange.end;
    }
    return matchesSearch && matchesClient && matchesDate;
  });

  const getOrdinalSuffix = (i) => {
    let j = i % 10;
    let k = i % 100;
    if (j === 1 && k !== 11) return `${i}st`;
    if (j === 2 && k !== 12) return `${i}nd`;
    if (j === 3 && k !== 13) return `${i}rd`;
    return `${i}th`;
  };

  const getCycleNoteKey = (clientId, cycleStart, category) =>
    `${clientId}__${cycleStart}__${category}`;

  // Firestore field paths cannot contain characters like `/`.
  // Retainer categories are user-defined and sometimes include `/` (e.g. "SEO/Web Development"),
  // so we store notes under a sanitized key but display the original label.
  const safeCategoryKey = (category) =>
    String(category)
      .replace(/[~*[\]/]/g, '_')
      .replace(/\./g, '_');

  const isCycleLocked = (client, cycleStart) =>
    !!client?.cycleLocks?.[String(cycleStart)]?.locked;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 flex flex-col lg:flex-row justify-between items-center gap-6">
        <div className="flex bg-slate-100 p-1 rounded-2xl w-full lg:w-auto overflow-x-auto no-scrollbar">
          {[
            { id: 'timesheets', label: 'Timesheets', icon: List },
            { id: 'clients', label: 'Clients', icon: History },
            ...(canBilling
              ? [
                  {
                    id: 'billing',
                    label: 'Requests & Billing',
                    icon: ShoppingCart,
                  },
                ]
              : []),
            { id: 'tasks', label: 'Config', icon: Settings },
            ...(isAdmin ? [{ id: 'users', label: 'Users', icon: Users }] : []),
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setAdminTab(tab.id)}
              className={`flex-1 lg:flex-none px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
                adminTab === tab.id
                  ? 'bg-white shadow-md text-[#fd7414]'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button
            onClick={() => {
              setManualTaskValues({
                clientName: '',
                billingTarget: '',
                date: '',
                hours: '',
                minutes: '',
                notes: '',
                employeeName:
                  user?.displayName || user?.email || '',
                parsedExpense: 0,
              });
              setManualTaskModal(true);
            }}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-slate-800 hover:bg-black text-white px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95"
          >
            <History className="w-4 h-4" /> Log Task
          </button>
        </div>
      </div>

      {/* Timesheets Tab */}
      {adminTab === 'timesheets' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="relative">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">
                Search
              </label>
              <Search className="absolute left-4 bottom-4 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Employee Name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 p-3.5 pl-10 rounded-2xl outline-none focus:ring-2 focus:ring-[#fd7414]/50 transition-all font-bold text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">
                Filter by Client
              </label>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none focus:ring-2 focus:ring-[#fd7414]/50 transition-all font-bold text-sm"
              >
                <option value="">All Clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">
                Date Range
              </label>
              <select
                value={dateFilterType}
                onChange={(e) => setDateFilterType(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none focus:ring-2 focus:ring-[#fd7414]/50 transition-all font-bold text-sm"
              >
                <option value="day">Today</option>
                <option value="week">Current Week</option>
                <option value="month">Current Month</option>
                <option value="custom">Custom Range...</option>
                <option value="all">All Time</option>
              </select>
            </div>
            {dateFilterType === 'custom' && (
              <div className="md:col-span-3 flex gap-4 bg-orange-50 p-4 rounded-2xl border border-orange-100 mt-2">
                <div className="flex-1">
                  <label className="text-[10px] font-black text-orange-600 uppercase tracking-widest ml-2 mb-1 block">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={customDateRange.start}
                    onChange={(e) =>
                      setCustomDateRange((prev) => ({
                        ...prev,
                        start: e.target.value,
                      }))
                    }
                    className="w-full bg-white border border-orange-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-[#fd7414]"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-black text-orange-600 uppercase tracking-widest ml-2 mb-1 block">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={customDateRange.end}
                    onChange={(e) =>
                      setCustomDateRange((prev) => ({
                        ...prev,
                        end: e.target.value,
                      }))
                    }
                    className="w-full bg-white border border-orange-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-[#fd7414]"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 px-2">
            <button
              onClick={exportCSV}
              className="text-xs font-black uppercase text-[#fd7414] hover:underline flex items-center gap-1"
            >
              <FileDown className="w-4 h-4" /> Export CSV
            </button>
            <button
              onClick={exportPDF}
              className="text-xs font-black uppercase text-slate-600 hover:underline flex items-center gap-1 ml-4"
            >
              <FileText className="w-4 h-4" /> Export PDF
            </button>
          </div>

          <div className="space-y-4">
            {filteredTimesheets.map((shift) => {
              const shiftTasks = taskLogs.filter(
                (t) => t.shiftId === shift.id,
              );
              const isExpanded = expandedShifts[shift.id];
              const visibleTasks = clientFilter
                ? shiftTasks.filter(
                    (t) => t.clientName === clientFilter,
                  )
                : shiftTasks;

              return (
                <div
                  key={shift.id}
                  className={`bg-white rounded-[32px] border ${
                    isExpanded
                      ? 'border-slate-300 shadow-md'
                      : 'border-slate-100 shadow-sm'
                  } overflow-hidden transition-all duration-300`}
                >
                  <div
                    className="p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-center gap-4 bg-white cursor-pointer select-none"
                    onClick={() => toggleShiftAccordion(shift.id)}
                  >
                    <div className="flex items-center gap-4 w-full sm:w-auto">
                      <div className="p-2 text-slate-400 hover:text-[#fd7414] hover:bg-orange-50 rounded-full transition-colors hidden sm:block">
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5" />
                        ) : (
                          <ChevronDown className="w-5 h-5" />
                        )}
                      </div>
                      <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center font-black text-slate-400 shrink-0">
                        {shift.employeeName[0]}
                      </div>
                      <div>
                        <h4 className="font-black text-lg">
                          {shift.employeeName}
                        </h4>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 flex gap-2">
                          <span>
                            {new Date(
                              shift.clockInTime,
                            ).toLocaleDateString()}
                          </span>
                          <span className="text-[#fd7414]">
                            • {formatTime(getShiftDuration(shift))} Total
                          </span>
                          {shift.isManual && (
                            <span className="bg-blue-100 text-blue-600 px-1.5 rounded text-[8px] flex items-center">
                              Manual
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      className="flex gap-2 w-full sm:w-auto justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => toggleShiftAccordion(shift.id)}
                        className="p-3 bg-slate-50 text-slate-500 rounded-xl hover:text-black transition-colors sm:hidden flex gap-2 items-center text-xs font-bold uppercase tracking-widest"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-4 h-4" /> Close
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-4 h-4" /> Expand
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => startEditing('shift', shift)}
                        className="p-3 bg-slate-50 text-slate-500 rounded-xl hover:text-[#fd7414] transition-colors"
                        title="Edit shift times"
                      >
                        <Pencil className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() =>
                          setDeleteConfirm({
                            collection: 'timesheets',
                            id: shift.id,
                            title:
                              'this entire shift and its tasks',
                          })
                        }
                        className="p-3 bg-slate-50 text-slate-300 rounded-xl hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-slate-50/50 p-6 pt-4 border-t border-slate-100 animate-in slide-in-from-top-4 duration-300">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <List className="w-3 h-3" /> Recorded Tasks{' '}
                        {clientFilter && '(Filtered)'}
                      </div>
                      {visibleTasks.length === 0 ? (
                        <p className="text-xs italic text-slate-400 pb-2">
                          No relevant tasks found.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {visibleTasks.map((task) => (
                            <div
                              key={task.id}
                              className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 group"
                            >
                              <div className="flex-1 text-left">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="font-black text-sm text-slate-800">
                                    {task.clientName}
                                  </span>
                                  <span className="bg-slate-100 px-2 py-0.5 rounded-md text-[8px] font-black text-slate-500 uppercase tracking-tighter">
                                    {task.projectId
                                      ? `Proj: ${task.projectName}`
                                      : task.projectName}
                                  </span>
                                </div>
                                {task.notes && (
                                  <p className="text-xs text-slate-500 leading-relaxed font-medium mb-3 italic">
                                    &quot;{task.notes}&quot;
                                  </p>
                                )}
                                <div className="text-[10px] text-slate-400 font-bold flex items-center gap-2">
                                  {new Date(
                                    task.clockInTime,
                                  ).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                  <ArrowRight className="w-3 h-3" />
                                  {task.clockOutTime
                                    ? new Date(
                                        task.clockOutTime,
                                      ).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : 'Active Now'}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
                                <div className="font-black text-lg text-[#fd7414] font-mono">
                                  {formatTime(getTaskDuration(task))}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => startEditing('task', task)}
                                    className="p-2 text-slate-400 hover:text-[#fd7414]"
                                    title="Edit task"
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() =>
                                      setDeleteConfirm({
                                        collection: 'taskLogs',
                                        id: task.id,
                                        title: 'this task record',
                                      })
                                    }
                                    className="p-2 text-slate-200 hover:text-red-500"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredTimesheets.length === 0 && (
              <div className="p-20 text-center text-slate-400 font-bold italic">
                No timesheets match your active filters.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clients Tab */}
      {adminTab === 'clients' && (
        <div className="space-y-6">
          {clientId && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigateToClientsList?.()}
                className="px-4 py-2 rounded-2xl font-black text-slate-600 bg-white border border-slate-100 shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2"
                title="Back to Clients"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Clients
              </button>
              <div className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Client details
              </div>
            </div>
          )}

          {!clientId && (
            <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex items-center justify-between gap-6">
              <div>
                <h3 className="font-black text-xl mb-1">Add Client Account</h3>
                <p className="text-[12px] font-bold text-slate-400">
                  Enter details in a popup before submitting.
                </p>
              </div>
              <button
                onClick={() => {
                  setAddClientValues({
                    name: '',
                    status: 'active',
                    hourlyRate: '100',
                    billingDay: '1',
                    clientStartDate: '',
                    clientEmails: '',
                  });
                  setAddClientModalOpen(true);
                }}
                className="bg-[#fd7414] text-white px-10 py-4 rounded-3xl font-black shadow-lg active:scale-95 transition-all"
              >
                Add a Client
              </button>
            </div>
          )}

          {addClientModalOpen && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[120] animate-in fade-in">
              <div className="bg-white rounded-[32px] w-full max-w-xl shadow-2xl overflow-hidden">
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div>
                    <h3 className="font-black text-2xl text-slate-900">
                      Add a Client
                    </h3>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                      Create the client profile
                    </p>
                  </div>
                  <button
                    onClick={() => setAddClientModalOpen(false)}
                    className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"
                    title="Close"
                  >
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>

                <div className="p-8 space-y-5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                      Client Name
                    </label>
                    <input
                      type="text"
                      value={addClientValues.name}
                      onChange={(e) =>
                        setAddClientValues((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder="e.g. Ignite Media"
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                        Status
                      </label>
                      <select
                        value={addClientValues.status}
                        onChange={(e) =>
                          setAddClientValues((prev) => ({
                            ...prev,
                            status: e.target.value,
                          }))
                        }
                        className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                      >
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                        Billing Day
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={addClientValues.billingDay}
                        onChange={(e) =>
                          setAddClientValues((prev) => ({
                            ...prev,
                            billingDay: e.target.value,
                          }))
                        }
                        className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                        Hourly Rate
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={addClientValues.hourlyRate}
                        onChange={(e) =>
                          setAddClientValues((prev) => ({
                            ...prev,
                            hourlyRate: e.target.value,
                          }))
                        }
                        className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                        Client Start Date (optional)
                      </label>
                      <input
                        type="date"
                        value={addClientValues.clientStartDate}
                        onChange={(e) =>
                          setAddClientValues((prev) => ({
                            ...prev,
                            clientStartDate: e.target.value,
                          }))
                        }
                        className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                      Client Emails (optional, comma-separated)
                    </label>
                    <textarea
                      value={addClientValues.clientEmails}
                      onChange={(e) =>
                        setAddClientValues((prev) => ({
                          ...prev,
                          clientEmails: e.target.value,
                        }))
                      }
                      placeholder="name@company.com, billing@company.com"
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[90px]"
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setAddClientModalOpen(false)}
                      className="px-5 py-3 rounded-2xl font-black text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        const name = (addClientValues.name || '').trim();
                        if (!name) return;

                        const billingDay = Number(addClientValues.billingDay) || 1;
                        const hourlyRate = Number(addClientValues.hourlyRate) || 0;
                        const status = addClientValues.status || 'active';

                        const startDateStr = (addClientValues.clientStartDate || '').trim();
                        const clientStartDate = startDateStr
                          ? (() => {
                              const [y, m, d] = startDateStr
                                .split('-')
                                .map(Number);
                              // Store as ms at local noon so it doesn't drift.
                              return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
                            })()
                          : null;

                        const clientEmails = (addClientValues.clientEmails || '')
                          .split(/[,\n;]/g)
                          .map((s) => s.trim())
                          .filter(Boolean);

                        try {
                          await addDoc(collection('clients'), {
                            name,
                            status,
                            hourlyRate,
                            billingDay,
                            retainers: {},
                            retainerUnits: {},
                            clientEmails,
                            clientStartDate,
                          });
                          setAddClientModalOpen(false);
                        } catch (err) {
                          console.error('Create client failed:', err);
                          window.alert(
                            'Could not create client. You may need admin or billing access.\n\n' +
                              (err?.message || String(err)),
                          );
                        }
                      }}
                      className="bg-black text-white px-10 py-3 rounded-2xl font-black shadow-lg active:scale-95 transition-all"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white p-4 rounded-[32px] border border-slate-100 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex bg-slate-100 p-1 rounded-2xl w-full sm:w-auto">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'active', label: 'Active' },
                  { id: 'inactive', label: 'Inactive' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setClientStatusFilter(opt.id)}
                    className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                      clientStatusFilter === opt.id
                        ? 'bg-white shadow-md text-[#fd7414]'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={clientSearchQuery}
                onChange={(e) => setClientSearchQuery(e.target.value)}
                className="flex-1 bg-slate-50 border-slate-200 border px-4 py-3 rounded-2xl font-bold outline-none placeholder:text-slate-300"
                placeholder="Search clients (name or email)…"
              />

              {clientSearchQuery.trim() !== '' && (
                <button
                  onClick={() => setClientSearchQuery('')}
                  className="px-4 py-3 rounded-2xl font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
                  title="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {clients
              .filter((c) => (!clientId ? true : c.id === clientId))
              .filter((c) => {
                if (clientStatusFilter === 'active') return c.status !== 'paused';
                if (clientStatusFilter === 'inactive') return c.status === 'paused';
                return true;
              })
              .filter((c) => {
                if (clientId) return true;
                const q = clientSearchQuery.trim().toLowerCase();
                if (!q) return true;
                const name = String(c?.name || '').toLowerCase();
                const emails = Array.isArray(c?.clientEmails) ? c.clientEmails : [];
                const emailMatch = emails.some((e) =>
                  String(e || '').toLowerCase().includes(q),
                );
                return name.includes(q) || emailMatch;
              })
              .filter((c) => !c.archived)
              .map((c) => {
              const isClientPage = !!clientId;
              const offset = clientCycleOffsets[c.id] ?? 0;
              const minCycleOffset = (() => {
                if (!c.clientStartDate) return -1e9;
                let o = 0;
                for (let i = 0; i < 1200; i++) {
                  const p = getBillingPeriod(c.billingDay || 1, o - 1);
                  if (p.end < c.clientStartDate) return o;
                  o--;
                }
                return o;
              })();
              const effectiveOffset = Math.max(offset, minCycleOffset);
              const period = getBillingPeriod(c.billingDay || 1, effectiveOffset);
              const mStart = period.start;
              const mEnd = period.end;
              const isExpanded = isClientPage ? true : expandedClients[c.id];

              const periodTasks = taskLogs.filter(
                (t) =>
                  t.clientName === c.name &&
                  t.clockInTime >= mStart &&
                  t.clockInTime <= mEnd &&
                  !t.projectId,
              );
              const periodExps = expenses.filter(
                (e) =>
                  e.clientName === c.name &&
                  e.date >= mStart &&
                  e.date <= mEnd &&
                  !e.projectId,
              );
              const stats = getGlobalRetainerStats(
                c,
                mStart,
                mEnd,
                {
                  taskLogs,
                  expenses,
                  addons,
                  getTaskDuration,
                },
              );
              const clientProjects = projects.filter(
                (p) => p.clientId === c.id,
              );

              return (
                <div
                  key={c.id}
                  className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col"
                >
                  <div
                    className="p-6 border-b border-slate-50 flex justify-between items-start bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer"
                    role="button"
                    tabIndex={0}
                    title="Open client page"
                    onClick={() => navigateToClient?.(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigateToClient?.(c.id);
                      }
                    }}
                  >
                    <div>
                      <div className="flex items-center gap-3">
                        <h4
                          className={`font-black text-xl ${
                            c.status === 'paused'
                              ? 'text-slate-400'
                              : 'text-slate-800'
                          }`}
                        >
                          {c.name}
                        </h4>
                        {c.status === 'paused' && (
                          <span className="bg-slate-200 text-slate-500 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest">
                            Paused
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                        Rate: ${c.hourlyRate || 0}/hr{' '}
                        <span className="mx-1">•</span> Renews on the{' '}
                        {getOrdinalSuffix(c.billingDay || 1)}
                      </div>
                    </div>
                    <div
                      className="flex gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isClientPage && (
                        <button
                          onClick={() => navigateToClient?.(c.id)}
                          className="px-3 py-2 text-white bg-[#fd7414] rounded-2xl hover:bg-[#e66a12] transition-colors font-black flex items-center gap-2 shadow-sm"
                          title="Open client page"
                        >
                          Open
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setManualTaskValues({
                            clientName: c.name,
                            billingTarget: '',
                            date: '',
                            hours: '',
                            minutes: '',
                            notes: '',
                            employeeName:
                              user?.displayName || user?.email || '',
                            parsedExpense: 0,
                          });
                          setManualTaskModal(true);
                        }}
                        className="p-2 text-white bg-slate-800 rounded-xl hover:bg-black transition-colors shadow-sm flex items-center justify-center"
                        title="Log a task for this client"
                      >
                        <History className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => {
                          setProjectModal({ ...c, lockClient: true });
                          setProjectValues({
                            clientId: c.id,
                            clientName: c.name,
                            title: '',
                            description: '',
                            estimatedBudget: '',
                            estimatedHours: '',
                          });
                        }}
                        disabled={isCycleLocked(c, mStart)}
                        className="p-2 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                        title="Add Custom Project"
                      >
                        <CheckSquare className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => {
                          if (isCycleLocked(c, mStart)) {
                            window.alert(
                              'This billing cycle is locked. Unlock to add expenses.',
                            );
                            return;
                          }
                          setExpenseModal(c);
                        }}
                        className="p-2 text-blue-500 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
                        title="Add Expense"
                      >
                        <DollarSign className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() =>
                          setEditingClient({
                            ...c,
                            retainers: c.retainers || {},
                            clientEmails: c.clientEmails || [],
                            billingDay: c.billingDay || 1,
                            status: c.status || 'active',
                          })
                        }
                        className="p-2 text-slate-400 bg-slate-100 rounded-xl hover:text-[#fd7414] transition-colors"
                      >
                        <Settings className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() =>
                          updateDoc(doc('clients', c.id), {
                            archived: !c.archived,
                          })
                        }
                        className="p-2 text-slate-400 bg-slate-100 rounded-xl hover:text-black transition-colors"
                        title={c.archived ? 'Unarchive client' : 'Archive client'}
                      >
                        <FolderGit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() =>
                          setDeleteConfirm({
                            collection: 'clients',
                            id: c.id,
                            title: `the client "${c.name}"`,
                          })
                        }
                        className="p-2 text-slate-300 bg-slate-100 rounded-xl hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="p-6 flex-1 bg-white space-y-6">
                    {isClientPage && (
                      <div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setClientNotesOpen((prev) => ({
                              ...prev,
                              [c.id]: !prev[c.id],
                            }));
                            setClientNotesDraft((prev) => ({
                              ...prev,
                              [c.id]:
                                prev[c.id] !== undefined
                                  ? prev[c.id]
                                  : c.generalNotes || '',
                            }));
                          }}
                          className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 inline-flex items-center gap-2"
                        >
                          <FileText className="w-3 h-3" />
                          {clientNotesOpen[c.id] ? 'Hide' : 'Show'} Client Notes
                        </button>

                        {clientNotesOpen[c.id] && (
                          <div className="mt-3 bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                            <textarea
                              value={clientNotesDraft[c.id] ?? ''}
                              onChange={(e) =>
                                setClientNotesDraft((prev) => ({
                                  ...prev,
                                  [c.id]: e.target.value,
                                }))
                              }
                              className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[110px]"
                              placeholder="Brand voice, important links, access details, preferences, etc."
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={async () => {
                                  setClientNotesSaving((prev) => ({
                                    ...prev,
                                    [c.id]: true,
                                  }));
                                  try {
                                    await updateDoc(doc('clients', c.id), {
                                      generalNotes:
                                        clientNotesDraft[c.id] ?? '',
                                    });
                                    logAudit?.({
                                      type: 'client_notes_saved',
                                      entityType: 'client',
                                      entityId: c.id,
                                      clientId: c.id,
                                    });
                                  } catch (err) {
                                    window.alert(
                                      `Could not save client notes: ${
                                        err?.message || String(err)
                                      }`,
                                    );
                                  } finally {
                                    setClientNotesSaving((prev) => ({
                                      ...prev,
                                      [c.id]: false,
                                    }));
                                  }
                                }}
                                disabled={!!clientNotesSaving[c.id]}
                                className="bg-black hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-30"
                              >
                                Save Notes
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between">
                        <span>Global Retainer Progress</span>
                        <div className="flex items-center gap-2">
                          <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded-md">
                            {new Date(mStart).toLocaleDateString()} -{' '}
                            {new Date(mEnd).toLocaleDateString()}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setClientCycleOffsets((prev) => {
                                const newOffset = (prev[c.id] ?? 0) - 1;
                                if (c.clientStartDate) {
                                  const p = getBillingPeriod(c.billingDay || 1, newOffset);
                                  if (p.end < c.clientStartDate) return prev;
                                }
                                return { ...prev, [c.id]: newOffset };
                              });
                            }}
                            disabled={effectiveOffset <= minCycleOffset}
                            className={`p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors ${effectiveOffset <= minCycleOffset ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-50'}`}
                            title="Previous billing cycle"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setClientCycleOffsets((prev) => {
                                const curr = prev[c.id] ?? 0;
                                return { ...prev, [c.id]: Math.min(0, curr + 1) };
                              });
                            }}
                            disabled={offset >= 0}
                            className={`p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors ${
                              offset >= 0 ? 'opacity-30' : 'hover:bg-slate-50'
                            }`}
                            title="Next billing cycle"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          {isCycleLocked(c, mStart) && (
                            <span className="hidden sm:inline-flex items-center px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-red-50 text-red-600 border border-red-100">
                              Cycle Locked
                            </span>
                          )}
                          {isClientPage && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportClientCyclePDF({
                                    client: c,
                                    mStart,
                                    mEnd,
                                    stats,
                                    periodTasks,
                                    periodExps,
                                    clientProjects,
                                    taskLogs,
                                    expenses,
                                  });
                                }}
                                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                                title="Export this billing cycle to PDF"
                              >
                                <FileText className="w-3 h-3" />
                                Export PDF
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportClientCycleCSV({
                                    client: c,
                                    mStart,
                                    mEnd,
                                    stats,
                                    periodTasks,
                                    periodExps,
                                    clientProjects,
                                    taskLogs,
                                    expenses,
                                    addons,
                                  });
                                }}
                                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                                title="Export this billing cycle to CSV"
                              >
                                <FileDown className="w-3 h-3" />
                                Export CSV
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportClientCyclePDF({
                                    client: c,
                                    mStart,
                                    mEnd,
                                    stats,
                                    periodTasks,
                                    periodExps,
                                    clientProjects,
                                    taskLogs,
                                    expenses,
                                  });
                                  exportClientCycleCSV({
                                    client: c,
                                    mStart,
                                    mEnd,
                                    stats,
                                    periodTasks,
                                    periodExps,
                                    clientProjects,
                                    taskLogs,
                                    expenses,
                                    addons,
                                  });
                                }}
                                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-black text-white hover:bg-slate-800 transition-colors"
                                title="Export PDF + CSV for this cycle"
                              >
                                <FileText className="w-3 h-3" />
                                Invoice Pack
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const locked = isCycleLocked(c, mStart);
                                  if (locked && !isAdmin) return;
                                  await updateDoc(doc('clients', c.id), {
                                    [`cycleLocks.${mStart}`]: locked
                                      ? null
                                      : {
                                          locked: true,
                                          lockedAt: Date.now(),
                                          lockedByEmail: user?.email || '',
                                        },
                                  });
                                  logAudit?.({
                                    type: locked ? 'cycle_unlocked' : 'cycle_locked',
                                    entityType: 'client',
                                    entityId: c.id,
                                    clientId: c.id,
                                    cycleStart: mStart,
                                  });
                                }}
                                className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors border ${
                                  isCycleLocked(c, mStart)
                                    ? isAdmin
                                      ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                      : 'bg-red-50 text-red-300 border-red-100 opacity-60 cursor-not-allowed'
                                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                }`}
                                title={
                                  isCycleLocked(c, mStart)
                                    ? isAdmin
                                      ? 'Unlock this billing cycle'
                                      : 'Only Admin can unlock'
                                    : 'Lock this billing cycle'
                                }
                                disabled={isCycleLocked(c, mStart) && !isAdmin}
                              >
                                <Lock className="w-3 h-3" />
                                {isCycleLocked(c, mStart) ? 'Unlock' : 'Lock'}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isCycleLocked(c, mStart)) {
                                    window.alert(
                                      'This billing cycle is locked. Unlock to add hours.',
                                    );
                                    return;
                                  }
                                  setAddonModal(c);
                                }}
                                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                              >
                                <CheckSquare className="w-3 h-3" />
                                Add Hours
                              </button>
                            </>
                          )}
                        </div>
                      </h5>

                      {!stats || stats.base === 0 ? (
                        <p className="text-xs italic text-slate-400">
                          No active retainers configured for this period.
                        </p>
                      ) : (
                        <div>
                          <div className="flex justify-between items-end mb-1">
                            <span className="font-bold text-sm text-slate-600">
                              Combined Pool
                            </span>
                            <span
                              className={`text-xs font-black ${
                                stats.isOver
                                  ? 'text-red-500'
                                  : 'text-slate-500'
                              }`}
                            >
                              {stats.currentUsed.toFixed(2)}h /{' '}
                              {stats.adjustedAllotted.toFixed(2)}h
                            </span>
                          </div>
                          <div className="text-[10px] font-bold text-slate-400 mb-2">
                            Base: {stats.base.toFixed(2)}h | Carryover:{' '}
                            {stats.carryover > 0 ? '+' : ''}
                            {stats.carryover.toFixed(2)}h{' '}
                            {stats.currentAddons > 0 &&
                              `| Addons: +${stats.currentAddons.toFixed(2)}h`}
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden mb-1">
                            <div
                              className={`${
                                stats.isOver
                                  ? 'bg-red-500'
                                  : stats.percent > 85
                                  ? 'bg-orange-500'
                                  : 'bg-emerald-500'
                              } h-3 rounded-full transition-all duration-1000`}
                              style={{ width: `${stats.percent}%` }}
                            ></div>
                          </div>
                          {stats.isOver && (
                            <div className="text-[9px] font-black text-red-500 uppercase tracking-widest text-right mt-1">
                              Over Limit by{' '}
                              {(
                                stats.currentUsed -
                                stats.adjustedAllotted
                              ).toFixed(2)}
                              h
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* General / Unclassified to-do bucket */}
                    {isClientPage && getTodoStateForCycle && updateClientTodo && (
                      (() => {
                        const cycleStart = mStart;
                        const generalLabel = 'General / Unclassified';
                        const catKey = todoCategoryKey(generalLabel);
                        const todoState = getTodoStateForCycle(c, cycleStart);
                        const catTodo = todoState[catKey] || {
                          closed: false,
                          items: [],
                        };
                        const items = catTodo.items || [];
                        const allDone =
                          items.length > 0 && items.every((i) => i.done);

                        return (
                          <div className="pt-2 border-t border-slate-100">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                To-do — {generalLabel}
                              </h5>
                              {catTodo.closed && (
                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase">
                                  Closed
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setAiTodoTranscript('');
                                setAiTodoCandidates([]);
                                setAiTodoSelected({});
                                setAiTodoModalOpen(true);
                              }}
                              className="w-full px-4 py-2 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest hover:bg-black transition-colors"
                              title="Extract action items from a meeting transcript and add them to this cycle"
                            >
                              AI Extract to-dos from transcript
                            </button>

                            {catTodo.closed ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (isCycleLocked(c, cycleStart))
                                    return;
                                  setTodoSaving(true);
                                  try {
                                    await updateClientTodo(c, cycleStart, catKey, {
                                      ...catTodo,
                                      closed: false,
                                    });
                                  } finally {
                                    setTodoSaving(false);
                                  }
                                }}
                                disabled={todoSaving}
                                className="text-xs font-bold text-slate-600 hover:text-slate-900"
                              >
                                Re-open category
                              </button>
                            ) : (
                              <>
                                {items.length === 0 ? (
                                  <p className="text-xs italic text-slate-400 mb-2">
                                    No to-do items yet.
                                  </p>
                                ) : (
                                  <ul className="space-y-2 mb-3">
                                    {items.map((item) => (
                                      <li
                                        key={item.id}
                                        className="flex items-center gap-2 bg-white border border-slate-100 rounded-lg p-2"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={!!item.done}
                                          onChange={async () => {
                                            if (isCycleLocked(c, cycleStart))
                                              return;
                                            setTodoSaving(true);
                                            try {
                                              const next = items.map((i) =>
                                                i.id === item.id
                                                  ? {
                                                      ...i,
                                                      done: !i.done,
                                                      doneAt: !i.done
                                                        ? Date.now()
                                                        : null,
                                                    }
                                                  : i,
                                              );
                                              await updateClientTodo(
                                                c,
                                                cycleStart,
                                                catKey,
                                                { ...catTodo, items: next },
                                              );
                                            } finally {
                                              setTodoSaving(false);
                                            }
                                          }}
                                          disabled={todoSaving}
                                          className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414] w-4 h-4"
                                        />
                                        <span className={`flex items-center gap-2 flex-1 ${item.done ? 'line-through text-slate-400 opacity-70' : 'text-slate-800'}`}>
                                          <span>{item.text || '(no text)'}</span>
                                          {item.recurring && (
                                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-widest">
                                              Recurring
                                            </span>
                                          )}
                                        </span>
                                        <button
                                          type="button"
                                          disabled={todoSaving}
                                          onClick={async () => {
                                            if (isCycleLocked(c, cycleStart))
                                              return;
                                            setTodoSaving(true);
                                            try {
                                              const next = items.map((i) => {
                                                if (i.id !== item.id)
                                                  return i;
                                                const nextRecurring =
                                                  !i.recurring;
                                                return {
                                                  ...i,
                                                  recurring: nextRecurring,
                                                  recurringId: nextRecurring
                                                    ? i.recurringId || i.id
                                                    : null,
                                                };
                                              });
                                              await updateClientTodo(
                                                c,
                                                cycleStart,
                                                catKey,
                                                { ...catTodo, items: next },
                                              );
                                            } finally {
                                              setTodoSaving(false);
                                            }
                                          }}
                                          className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                                            item.recurring
                                              ? 'bg-[#fd7414] text-white border-[#fd7414]'
                                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                          }`}
                                          title="Toggle recurring each cycle"
                                        >
                                          Recurring
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}

                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={todoAddTextDraft[catKey] || ''}
                                    onChange={(e) =>
                                      setTodoAddTextDraft((prev) => ({
                                        ...prev,
                                        [catKey]: e.target.value,
                                      }))
                                    }
                                    placeholder="New to-do..."
                                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                                    onKeyDown={(e) => {
                                      if (e.key !== 'Enter') return;
                                      e.preventDefault();
                                      if (isCycleLocked(c, cycleStart))
                                        return;
                                      const text = (
                                        todoAddTextDraft[catKey] || ''
                                      ).trim();
                                      if (!text) return;
                                      setTodoSaving(true);
                                      (async () => {
                                        try {
                                          const newItem = {
                                            id: `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                                            text,
                                            done: false,
                                            doneAt: null,
                                            recurring: false,
                                            recurringId: null,
                                          };
                                          await updateClientTodo(c, cycleStart, catKey, {
                                            ...catTodo,
                                            closed: false,
                                            items: [...items, newItem],
                                          });
                                          setTodoAddTextDraft((prev) => ({
                                            ...prev,
                                            [catKey]: '',
                                          }));
                                        } finally {
                                          setTodoSaving(false);
                                        }
                                      })();
                                    }}
                                  />
                                  <button
                                    type="button"
                                    disabled={
                                      todoSaving ||
                                      !String(todoAddTextDraft[catKey] || '').trim()
                                    }
                                    onClick={async () => {
                                      if (isCycleLocked(c, cycleStart))
                                        return;
                                      const text = (
                                        todoAddTextDraft[catKey] || ''
                                      ).trim();
                                      if (!text) return;
                                      setTodoSaving(true);
                                      try {
                                        const newItem = {
                                          id: `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                                          text,
                                          done: false,
                                          doneAt: null,
                                          recurring: false,
                                          recurringId: null,
                                        };
                                        await updateClientTodo(c, cycleStart, catKey, {
                                          ...catTodo,
                                          closed: false,
                                          items: [...items, newItem],
                                        });
                                        setTodoAddTextDraft((prev) => ({
                                          ...prev,
                                          [catKey]: '',
                                        }));
                                      } finally {
                                        setTodoSaving(false);
                                      }
                                    }}
                                    className="px-4 py-2 rounded-xl bg-[#fd7414] text-white font-bold text-sm disabled:opacity-40"
                                  >
                                    Add
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (todoSaving) return;
                                    if (isCycleLocked(c, cycleStart))
                                      return;
                                    if (!allDone) return;
                                    setTodoSaving(true);
                                    try {
                                      await updateClientTodo(c, cycleStart, catKey, {
                                        ...catTodo,
                                        closed: true,
                                      });
                                    } finally {
                                      setTodoSaving(false);
                                    }
                                  }}
                                  disabled={todoSaving || !allDone}
                                  className={`text-xs font-bold hover:underline ${
                                    allDone
                                      ? 'text-emerald-600'
                                      : 'text-slate-400 cursor-not-allowed'
                                  }`}
                                  title={
                                    allDone
                                      ? 'Close category when all items are done'
                                      : 'Check off all sub items to close this category'
                                  }
                                >
                                  Close category for this cycle
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })()
                    )}

                    {isClientPage && aiTodoModalOpen && (
                      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[200] animate-in fade-in">
                        <div className="bg-white rounded-[32px] w-full max-w-3xl shadow-2xl overflow-hidden">
                          <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                              <h3 className="font-black text-2xl text-slate-900">
                                AI Extract to-dos
                              </h3>
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                                Upload/paste meeting transcript, then review
                              </p>
                            </div>
                            <button
                              onClick={() => setAiTodoModalOpen(false)}
                              className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"
                              title="Close"
                            >
                              <X className="w-5 h-5 text-slate-500" />
                            </button>
                          </div>

                          <div className="p-8 space-y-5">
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                                Meeting transcript (plain text)
                              </label>
                              <textarea
                                value={aiTodoTranscript}
                                onChange={(e) => setAiTodoTranscript(e.target.value)}
                                className="w-full bg-white border border-slate-200 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[220px] font-medium text-sm"
                                placeholder="Paste the transcript or notes here. Gemini will extract action items and map them to retainer categories."
                              />
                              <p className="text-[11px] text-slate-400 font-bold">
                                Note: very large transcripts may be trimmed by the
                                server cap before AI extraction.
                              </p>
                            </div>

                            <div className="flex justify-between items-center gap-3">
                              <button
                                type="button"
                                disabled={aiTodoLoading}
                                onClick={async () => {
                                  const transcript = (aiTodoTranscript || '').trim();
                                  if (!transcript) {
                                    window.alert('Paste meeting transcript first.');
                                    return;
                                  }

                                  setAiTodoLoading(true);
                                  try {
                                    const retainerCategories = Object.keys(
                                      c.retainers || {},
                                    );
                                    const res = await fetch(
                                      '/.netlify/functions/gemini-extract-todos',
                                      {
                                        method: 'POST',
                                        headers: {
                                          'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({
                                          transcript,
                                          clientName: c.name,
                                          retainerCategories,
                                          generalCategoryLabel:
                                            'General / Unclassified',
                                        }),
                                      },
                                    );
                                    const data = await res.json().catch(() => null);
                                    if (!res.ok) {
                                      throw new Error(data?.error || 'AI extract failed.');
                                    }
                                    const todos = Array.isArray(data?.todos)
                                      ? data.todos
                                      : [];
                                    const normalized = todos.map((t, idx) => ({
                                      id: String(t.id || `ai_${Date.now()}_${idx}`),
                                      text: String(t.text || '').trim(),
                                      category: String(
                                        t.category || 'General / Unclassified',
                                      ),
                                    })).filter((t) => t.text);

                                    setAiTodoCandidates(normalized);
                                    const selected = {};
                                    normalized.forEach((t) => {
                                      selected[t.id] = true;
                                    });
                                    setAiTodoSelected(selected);
                                  } catch (err) {
                                    console.error(err);
                                    window.alert(
                                      'Could not extract to-dos from transcript.\n\n' +
                                        (err?.message || String(err)),
                                    );
                                  } finally {
                                    setAiTodoLoading(false);
                                  }
                                }}
                                className="bg-black text-white px-8 py-3 rounded-2xl font-black shadow-lg active:scale-95 transition-all disabled:opacity-50"
                              >
                                {aiTodoLoading ? 'Extracting…' : 'Extract to-dos'}
                              </button>

                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Review + select what to add
                              </div>
                            </div>

                            {aiTodoCandidates.length > 0 && (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <h4 className="text-[12px] font-black text-slate-900">
                                    Proposed items ({aiTodoCandidates.length})
                                  </h4>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const allChecked = aiTodoCandidates.every(
                                        (t) => aiTodoSelected[t.id],
                                      );
                                      const next = {};
                                      aiTodoCandidates.forEach((t) => {
                                        next[t.id] = !allChecked;
                                      });
                                      setAiTodoSelected(next);
                                    }}
                                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-widest"
                                  >
                                    Toggle select all
                                  </button>
                                </div>

                                <div className="max-h-[280px] overflow-y-auto space-y-2 pr-2">
                                  {aiTodoCandidates.map((t) => (
                                    <label
                                      key={t.id}
                                      className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-3 hover:bg-slate-100 transition-colors cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={!!aiTodoSelected[t.id]}
                                        onChange={() =>
                                          setAiTodoSelected((prev) => ({
                                            ...prev,
                                            [t.id]: !prev[t.id],
                                          }))
                                        }
                                        className="mt-1"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-black text-slate-900 line-clamp-3">
                                          {t.text}
                                        </div>
                                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">
                                          Category: {t.category}
                                        </div>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="flex justify-end gap-3 pt-2">
                              <button
                                type="button"
                                onClick={() => setAiTodoModalOpen(false)}
                                className="px-5 py-3 rounded-2xl font-black text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={
                                  aiTodoLoading ||
                                  aiTodoCandidates.filter((t) => aiTodoSelected[t.id])
                                    .length === 0
                                }
                                onClick={async () => {
                                  const selected = aiTodoCandidates.filter(
                                    (t) => aiTodoSelected[t.id],
                                  );
                                  if (!selected.length) return;

                                  const cycleStart = mStart;
                                  const todoState = getTodoStateForCycle(
                                    c,
                                    cycleStart,
                                  );

                                  // Build next todoCycles updates in-memory,
                                  // then write everything in one Firestore update.
                                  const categoryKeyToNext = {};
                                  const byCategory = {};
                                  selected.forEach((t) => {
                                    const key = todoCategoryKey(t.category);
                                    if (!byCategory[key]) {
                                      byCategory[key] = [];
                                    }
                                    byCategory[key].push(t);
                                  });

                                  Object.entries(byCategory).forEach(
                                    ([catKey, proposals]) => {
                                      const existing = todoState[catKey]
                                        ? todoState[catKey].items || []
                                        : [];
                                      const existingTextSet = new Set(
                                        existing.map((i) =>
                                          String(i.text || '')
                                            .trim()
                                            .toLowerCase(),
                                        ),
                                      );
                                      const newItems = proposals
                                        .map((p) => {
                                          const text = String(p.text || '').trim();
                                          if (!text) return null;
                                          const norm = text.toLowerCase();
                                          if (existingTextSet.has(norm))
                                            return null;
                                          return {
                                            id: `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                                            text,
                                            done: false,
                                            doneAt: null,
                                            recurring: false,
                                            recurringId: null,
                                          };
                                        })
                                        .filter(Boolean);

                                      const baseCatTodo = todoState[catKey] || {
                                        closed: false,
                                        items: [],
                                      };
                                      categoryKeyToNext[catKey] = {
                                        ...baseCatTodo,
                                        closed: false,
                                        items: [...existing, ...newItems],
                                      };
                                    },
                                  );

                                  setAiTodoLoading(true);
                                  try {
                                    await updateClientTodosBatch(
                                      c,
                                      cycleStart,
                                      categoryKeyToNext,
                                    );
                                    setAiTodoModalOpen(false);
                                    setAiTodoTranscript('');
                                    setAiTodoCandidates([]);
                                    setAiTodoSelected({});
                                  } finally {
                                    setAiTodoLoading(false);
                                  }
                                }}
                                className="bg-[#fd7414] text-white px-8 py-3 rounded-2xl font-black shadow-lg active:scale-95 transition-all disabled:opacity-50"
                              >
                                Add to Categories
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {c.retainers &&
                      Object.keys(c.retainers).length > 0 &&
                      stats &&
                      stats.categoryBreakdown && (
                        <div className="pt-2 border-t border-slate-100">
                          <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                            Retainer Categories
                          </h5>
                          <div className="space-y-2">
                            {Object.entries(c.retainers)
                              .sort((a, b) => {
                                const ai = getRetainerCategorySortIndex(a[0]);
                                const bi = getRetainerCategorySortIndex(b[0]);
                                if (ai !== bi) return ai - bi;
                                return String(a[0]).localeCompare(String(b[0]));
                              })
                              .map(([cat, base]) => {
                              const cycleStart = mStart;
                              const catKey = safeCategoryKey(cat);
                              const noteKey = getCycleNoteKey(c.id, cycleStart, catKey);
                              const existingNote =
                                c.cycleNotes?.[String(cycleStart)]?.[catKey] || '';
                              const used =
                                stats.categoryBreakdown[cat] || 0;
                              const baseNum = Number(base) || 0;
                              const isDollarCategory =
                                cat === 'Social Ad Budget' || c?.retainerUnits?.[cat] === 'dollar';
                              const usedDisplay = Number(used || 0).toFixed(2);
                              const baseDisplay = Number(baseNum || 0).toFixed(2);
                              const pct =
                                baseNum > 0
                                  ? Math.min(
                                      100,
                                      (Number(used || 0) / baseNum) * 100,
                                    )
                                  : 0;
                              const over =
                                baseNum > 0 && used > baseNum;
                              const categoryTasks = periodTasks.filter(
                                (t) => t.projectName === cat,
                              );
                              const categoryExps = periodExps.filter(
                                (e) => e.category === cat,
                              );
                              const hasLogged =
                                categoryTasks.length > 0 ||
                                categoryExps.length > 0;

                              return (
                                <div key={cat}>
                                  <div className="flex items-start justify-between gap-3 mb-1">
                                    <div className="min-w-0">
                                      <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest truncate">
                                        {cat}
                                      </div>
                                      <div className="text-[10px] font-bold text-slate-400">
                                        {isDollarCategory
                                          ? `$${usedDisplay} / $${baseDisplay}`
                                          : `${usedDisplay}h / ${baseDisplay}h`}
                                      </div>
                                    </div>

                                    {hasLogged ? (
                                      <button
                                        type="button"
                                        aria-label="Toggle logged tasks and expenses"
                                        onClick={() =>
                                          setRetainerCategoryOpen((prev) => ({
                                            ...prev,
                                            [`${c.id}__${cycleStart}__${catKey}`]:
                                              !prev[
                                                `${c.id}__${cycleStart}__${catKey}`
                                              ],
                                          }))
                                        }
                                        className="shrink-0 px-3 py-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-colors"
                                        title="Toggle logged tasks and expenses"
                                      >
                                        {retainerCategoryOpen[
                                          `${c.id}__${cycleStart}__${catKey}`
                                        ] ? (
                                          <ChevronUp className="w-4 h-4" />
                                        ) : (
                                          <ChevronDown className="w-4 h-4" />
                                        )}
                                      </button>
                                    ) : (
                                      <div className="shrink-0 px-3 py-2 rounded-2xl bg-slate-50 text-slate-300 font-black text-[10px] uppercase tracking-widest border border-slate-100">
                                        No logged tasks/expenses
                                      </div>
                                    )}
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

                                  <div className="mt-2 flex flex-col space-y-4">
                                      {(() => {
                                        const catIsDollar = cat === 'Social Ad Budget' || c?.retainerUnits?.[cat] === 'dollar';
                                        return (
                                          <>
                                            {retainerCategoryOpen[`${c.id}__${cycleStart}__${catKey}`] && (<div style={{ order: 30 }}>
                                              <h6 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                                Logged tasks ({categoryTasks.length})
                                              </h6>
                                              {categoryTasks.length === 0 ? (
                                                <p className="text-xs italic text-slate-400">No tasks this period.</p>
                                              ) : (
                                                <div className="space-y-2">
                                                  {categoryTasks.map((task) => (
                                                    <div
                                                      key={task.id}
                                                      className="bg-white p-3 rounded-xl border border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"
                                                    >
                                                      <div className="flex-1 min-w-0">
                                                        <span className="text-[10px] text-slate-400 font-bold">
                                                          {new Date(task.clockInTime).toLocaleDateString()}
                                                        </span>
                                                        {task.notes && (
                                                          <p className="text-xs text-slate-600 italic line-clamp-1 mt-0.5">
                                                            &quot;{task.notes}&quot;
                                                          </p>
                                                        )}
                                                      </div>
                                                      <div className="flex items-center gap-2 shrink-0">
                                                        <span className="font-black text-sm text-[#fd7414] font-mono">
                                                          {formatTime(getTaskDuration(task))}
                                                        </span>
                                                        <button
                                                          onClick={() =>
                                                            setDeleteConfirm({
                                                              collection: 'taskLogs',
                                                              id: task.id,
                                                              title: 'this task record',
                                                            })
                                                          }
                                                          className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                                                        >
                                                          <Trash2 className="w-4 h-4" />
                                                        </button>
                                                      </div>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>)}
                                            {retainerCategoryOpen[`${c.id}__${cycleStart}__${catKey}`] && (<div style={{ order: 40 }}>
                                              <h6 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                                Logged expenses ({categoryExps.length})
                                              </h6>
                                              {categoryExps.length === 0 ? (
                                                <p className="text-xs italic text-slate-400">No expenses this period.</p>
                                              ) : (
                                                <div className="space-y-2">
                                                  {categoryExps.map((exp) => (
                                                    <div
                                                      key={exp.id}
                                                      className="bg-white p-3 rounded-xl border border-slate-100 border-l-4 border-l-blue-400 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"
                                                    >
                                                      <div className="flex-1 min-w-0">
                                                        <span className="text-[10px] text-slate-400 font-bold">
                                                          {new Date(exp.date).toLocaleDateString()}
                                                        </span>
                                                        {exp.description && (
                                                          <p className="text-xs text-slate-600 italic line-clamp-1 mt-0.5">
                                                            &quot;{exp.description}&quot;
                                                          </p>
                                                        )}
                                                      </div>
                                                      <div className="flex items-center gap-2 shrink-0">
                                                        <span className="font-black text-sm text-blue-500">
                                                          ${exp.finalCost.toFixed(2)}
                                                        </span>
                                                        {!catIsDollar && (
                                                          <span className="text-[10px] text-slate-400">
                                                            {(exp.equivalentHours || 0).toFixed(2)}h
                                                          </span>
                                                        )}
                                                        <button
                                                          onClick={() =>
                                                            setDeleteConfirm({
                                                              collection: 'expenses',
                                                              id: exp.id,
                                                              title: 'this expense',
                                                            })
                                                          }
                                                          className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                                                        >
                                                          <Trash2 className="w-4 h-4" />
                                                        </button>
                                                      </div>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>)}
                                            {isClientPage && getTodoStateForCycle && updateClientTodo && (() => {
                                              const todoState = getTodoStateForCycle(c, cycleStart);
                                              const catTodo = todoState[catKey] || { closed: false, items: [] };
                                              const items = catTodo.items || [];
                                              const allDone = items.length > 0 && items.every((i) => i.done);
                                              return (
                                                <div style={{ order: 10 }}>
                                                  <h6 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2 flex-wrap">
                                                    To-do
                                                    {catTodo.closed && (
                                                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase">
                                                        Closed for cycle
                                                      </span>
                                                    )}
                                                  </h6>
                                                  {catTodo.closed ? (
                                                    <button
                                                      type="button"
                                                      onClick={async () => {
                                                        if (isCycleLocked(c, cycleStart)) return;
                                                        setTodoSaving(true);
                                                        try {
                                                          await updateClientTodo(c, cycleStart, catKey, { ...catTodo, closed: false });
                                                        } finally {
                                                          setTodoSaving(false);
                                                        }
                                                      }}
                                                      disabled={todoSaving}
                                                      className="text-xs font-bold text-slate-600 hover:text-slate-900"
                                                    >
                                                      Re-open category
                                                    </button>
                                                  ) : (
                                                    <>
                                                      {items.length === 0 ? (
                                                        <p className="text-xs italic text-slate-400 mb-2">No to-do items yet.</p>
                                                      ) : (
                                                        <ul className="space-y-2 mb-2">
                                                          {items.map((item) => (
                                                            <li
                                                              key={item.id}
                                                              className="flex items-center gap-2 bg-white border border-slate-100 rounded-lg p-2"
                                                            >
                                                              <input
                                                                type="checkbox"
                                                                checked={!!item.done}
                                                                onChange={async () => {
                                                                  if (isCycleLocked(c, cycleStart)) return;
                                                                  setTodoSaving(true);
                                                                  try {
                                                                    const next = items.map((i) =>
                                                                      i.id === item.id
                                                                        ? { ...i, done: !i.done, doneAt: !i.done ? Date.now() : null }
                                                                        : i
                                                                    );
                                                                    await updateClientTodo(c, cycleStart, catKey, { ...catTodo, items: next });
                                                                  } finally {
                                                                    setTodoSaving(false);
                                                                  }
                                                                }}
                                                                disabled={todoSaving}
                                                                className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414]"
                                                              />
                                                              {todoEditId === item.id ? (
                                                                <input
                                                                  value={todoEditText}
                                                                  onChange={(e) => setTodoEditText(e.target.value)}
                                                                  onBlur={async () => {
                                                                    if (todoEditText.trim() === '' || todoEditText === item.text) {
                                                                      setTodoEditId(null);
                                                                      return;
                                                                    }
                                                                    setTodoSaving(true);
                                                                    try {
                                                                      const next = items.map((i) =>
                                                                        i.id === item.id ? { ...i, text: todoEditText.trim() } : i
                                                                      );
                                                                      await updateClientTodo(c, cycleStart, catKey, { ...catTodo, items: next });
                                                                    } finally {
                                                                      setTodoSaving(false);
                                                                      setTodoEditId(null);
                                                                    }
                                                                  }}
                                                                  onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') e.target.blur();
                                                                    if (e.key === 'Escape') setTodoEditId(null);
                                                                  }}
                                                                  autoFocus
                                                                  className="flex-1 text-sm border border-slate-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-[#fd7414]"
                                                                />
                                                              ) : (
                                                                <span
                                                                  className={`flex-1 text-sm ${
                                                                    item.done
                                                                      ? 'line-through text-slate-400 opacity-70'
                                                                      : 'text-slate-800'
                                                                  }`}
                                                                  onDoubleClick={() => {
                                                                    if (isCycleLocked(c, cycleStart)) return;
                                                                    setTodoEditId(item.id);
                                                                    setTodoEditText(item.text || '');
                                                                  }}
                                                                >
                                                                  <span className="flex items-center gap-2">
                                                                    <span>
                                                                      {item.text || '(no text)'}
                                                                    </span>
                                                                    {item.recurring && (
                                                                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-widest">
                                                                        Recurring
                                                                      </span>
                                                                    )}
                                                                  </span>
                                                                </span>
                                                              )}
                                                              <button
                                                                type="button"
                                                                onClick={async () => {
                                                                  if (isCycleLocked(c, cycleStart)) return;
                                                                  setTodoSaving(true);
                                                                  try {
                                                                    const next = items.map((i) => {
                                                                      if (i.id !== item.id) return i;
                                                                      const nextRecurring = !i.recurring;
                                                                      return {
                                                                        ...i,
                                                                        recurring: nextRecurring,
                                                                        recurringId: nextRecurring ? (i.recurringId || i.id) : null,
                                                                      };
                                                                    });
                                                                    await updateClientTodo(c, cycleStart, catKey, { ...catTodo, items: next });
                                                                  } finally {
                                                                    setTodoSaving(false);
                                                                  }
                                                                }}
                                                                disabled={todoSaving}
                                                                className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-colors ${
                                                                  item.recurring
                                                                    ? 'bg-[#fd7414] text-white border-[#fd7414]'
                                                                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                                                }`}
                                                                title="Toggle recurring each cycle"
                                                              >
                                                                Recurring
                                                              </button>
                                                              <button
                                                                type="button"
                                                                onClick={async () => {
                                                                  if (isCycleLocked(c, cycleStart)) return;
                                                                  setTodoSaving(true);
                                                                  try {
                                                                    const next = items.filter((i) => i.id !== item.id);
                                                                    await updateClientTodo(c, cycleStart, catKey, { ...catTodo, items: next });
                                                                  } finally {
                                                                    setTodoSaving(false);
                                                                  }
                                                                }}
                                                                disabled={todoSaving}
                                                                className="p-1 text-slate-300 hover:text-red-500"
                                                              >
                                                                <Trash2 className="w-4 h-4" />
                                                              </button>
                                                            </li>
                                                          ))}
                                                        </ul>
                                                      )}
                                                      <div className="space-y-2">
                                                        <div className="flex gap-2">
                                                          <input
                                                            type="text"
                                                            value={todoAddTextDraft[catKey] || ''}
                                                            onChange={(e) =>
                                                              setTodoAddTextDraft((prev) => ({
                                                                ...prev,
                                                                [catKey]: e.target.value,
                                                              }))
                                                            }
                                                            placeholder="New to-do..."
                                                            className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                                                            onKeyDown={(e) => {
                                                              if (e.key !== 'Enter') return;
                                                              e.preventDefault();
                                                              (async () => {
                                                                if (isCycleLocked(c, cycleStart)) return;
                                                                const text = (todoAddTextDraft[catKey] || '').trim();
                                                                if (!text) return;
                                                                setTodoSaving(true);
                                                                try {
                                                                  const newItem = {
                                                                    id: `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                                                                    text,
                                                                    done: false,
                                                                    doneAt: null,
                                                                  };
                                                                  await updateClientTodo(c, cycleStart, catKey, {
                                                                    ...catTodo,
                                                                    closed: false,
                                                                    items: [...items, newItem],
                                                                  });
                                                                  setTodoAddTextDraft((prev) => ({
                                                                    ...prev,
                                                                    [catKey]: '',
                                                                  }));
                                                                } finally {
                                                                  setTodoSaving(false);
                                                                }
                                                              })();
                                                            }}
                                                          />
                                                          <button
                                                            type="button"
                                                            disabled={
                                                              todoSaving ||
                                                              !String(todoAddTextDraft[catKey] || '').trim()
                                                            }
                                                            onClick={async () => {
                                                              if (isCycleLocked(c, cycleStart)) return;
                                                              const text = (todoAddTextDraft[catKey] || '').trim();
                                                              if (!text) return;
                                                              setTodoSaving(true);
                                                              try {
                                                                const newItem = {
                                                                  id: `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                                                                  text,
                                                                  done: false,
                                                                  doneAt: null,
                                                                };
                                                                await updateClientTodo(c, cycleStart, catKey, {
                                                                  ...catTodo,
                                                                  closed: false,
                                                                  items: [...items, newItem],
                                                                });
                                                                setTodoAddTextDraft((prev) => ({
                                                                  ...prev,
                                                                  [catKey]: '',
                                                                }));
                                                              } finally {
                                                                setTodoSaving(false);
                                                              }
                                                            }}
                                                            className="px-4 py-2 rounded-xl bg-[#fd7414] text-white font-bold text-sm disabled:opacity-40"
                                                          >
                                                            Add
                                                          </button>
                                                        </div>

                                                        <button
                                                          type="button"
                                                          onClick={async () => {
                                                            if (isCycleLocked(c, cycleStart)) return;
                                                            if (!allDone) return;
                                                            setTodoSaving(true);
                                                            try {
                                                              await updateClientTodo(
                                                                c,
                                                                cycleStart,
                                                                catKey,
                                                                { ...catTodo, closed: true },
                                                              );
                                                            } finally {
                                                              setTodoSaving(false);
                                                            }
                                                          }}
                                                          disabled={todoSaving || !allDone}
                                                          className={`text-xs font-bold hover:underline ${
                                                            allDone
                                                              ? 'text-emerald-600'
                                                              : 'text-slate-400 cursor-not-allowed'
                                                          }`}
                                                          title={
                                                            allDone
                                                              ? 'Close category when all items are done'
                                                              : 'Check off all sub items to close this category'
                                                          }
                                                        >
                                                          Close category for this cycle
                                                        </button>
                                                      </div>
                                                    </>
                                                  )}
                                                </div>
                                              );
                                            })()}
                                            <div style={{ order: 20 }}>
                                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                                                Cycle note
                                              </label>
                                              <textarea
                                                value={
                                                  cycleNotesDraft[noteKey] ??
                                                  (existingNote || '')
                                                }
                                                onChange={(e) =>
                                                  setCycleNotesDraft((prev) => ({
                                                    ...prev,
                                                    [noteKey]: e.target.value,
                                                  }))
                                                }
                                                className="w-full bg-white border border-slate-200 p-3 rounded-xl font-medium text-xs outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[70px]"
                                                placeholder="Cycle note for this category (manual entry)..."
                                              />
                                              <div className="flex justify-end mt-2">
                                                <button
                                                  onClick={async () => {
                                                    const value =
                                                      cycleNotesDraft[noteKey] ??
                                                      existingNote ??
                                                      '';
                                                    if (isCycleLocked(c, cycleStart)) {
                                                      window.alert(
                                                        'This billing cycle is locked. Unlock to edit cycle notes.',
                                                      );
                                                      return;
                                                    }
                                                    setCycleNotesSaving((prev) => ({
                                                      ...prev,
                                                      [noteKey]: true,
                                                    }));
                                                    try {
                                                      await updateDoc(
                                                        doc('clients', c.id),
                                                        {
                                                          [`cycleNotes.${cycleStart}.${catKey}`]:
                                                            value,
                                                        },
                                                      );
                                                      logAudit?.({
                                                        type: 'retainer_cycle_note_saved',
                                                        entityType: 'client',
                                                        entityId: c.id,
                                                        clientId: c.id,
                                                        cycleStart,
                                                        meta: { category: cat },
                                                      });
                                                    } catch (err) {
                                                      window.alert(
                                                        `Could not save cycle note (${cat}): ${
                                                          err?.message || String(err)
                                                        }`,
                                                        );
                                                      } finally {
                                                        setCycleNotesSaving((prev) => ({
                                                          ...prev,
                                                          [noteKey]: false,
                                                        }));
                                                      }
                                                    }}
                                                    disabled={!!cycleNotesSaving[noteKey]}
                                                    className="px-3 py-1 rounded-xl bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-30"
                                                  >
                                                    Save Note
                                                  </button>
                                                </div>
                                              <div style={{ order: 25, marginTop: 10 }}>
                                                {hasLogged ? (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setRetainerCategoryOpen((prev) => ({
                                                        ...prev,
                                                        [`${c.id}__${cycleStart}__${catKey}`]:
                                                          !prev[
                                                            `${c.id}__${cycleStart}__${catKey}`
                                                          ],
                                                      }))
                                                    }
                                                    className="w-full sm:w-auto px-3 py-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-widest flex items-center justify-between gap-3 transition-colors text-left"
                                                    title="Toggle logged tasks and expenses"
                                                  >
                                                    <span>Logged tasks &amp; expenses</span>
                                                    {retainerCategoryOpen[
                                                      `${c.id}__${cycleStart}__${catKey}`
                                                    ] ? (
                                                      <ChevronUp className="w-4 h-4 shrink-0" />
                                                    ) : (
                                                      <ChevronDown className="w-4 h-4 shrink-0" />
                                                    )}
                                                  </button>
                                                ) : (
                                                  <div className="w-full sm:w-auto px-3 py-2 rounded-2xl bg-slate-50 text-slate-300 font-black text-[10px] uppercase tracking-widest border border-slate-100">
                                                    No logged tasks/expenses
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                  </div>

                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedProjectsExpenses((prev) => ({
                          ...prev,
                          [c.id]: !prev[c.id],
                        }))
                      }
                      className="w-full flex items-center justify-between gap-2 p-4 border-t border-slate-200 bg-slate-50/80 hover:bg-slate-100/80 transition-colors text-left"
                    >
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        Custom Projects and Expenses
                      </span>
                      <span className="text-slate-400" aria-hidden>
                        {expandedProjectsExpenses[c.id] ? (
                          <ChevronUp className="w-5 h-5" />
                        ) : (
                          <ChevronDown className="w-5 h-5" />
                        )}
                      </span>
                    </button>
                    {expandedProjectsExpenses[c.id] && (
                    <div className="bg-slate-50/50 p-6 border-t border-slate-100 animate-in slide-in-from-top-4 duration-300 space-y-6">
                      <div>
                        <div className="flex justify-between items-center mb-3">
                          <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            Custom Projects
                          </h5>
                          <button
                            onClick={() => {
                              setProjectModal({ ...c, lockClient: true });
                              setProjectValues({
                                clientId: c.id,
                                clientName: c.name,
                                title: '',
                                description: '',
                                estimatedBudget: '',
                                estimatedHours: '',
                              });
                            }}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
                          >
                            + New Project
                          </button>
                        </div>
                        {clientProjects.length === 0 ? (
                          <p className="text-xs italic text-slate-400">
                            No custom projects yet.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {clientProjects
                              .filter((p) => !(p.status === 'closed' && p.invoiced))
                              .map((p) => {
                                const pTasks = taskLogs.filter(
                                  (t) => t.projectId === p.id,
                                );
                                const totalHours =
                                  pTasks.reduce(
                                    (a, b) => a + getTaskDuration(b),
                                    0,
                                  ) / 3600000;
                                const estHours = Number(
                                  p.estimatedHours || 0,
                                );
                                const projectPercent =
                                  estHours > 0
                                    ? Math.min(
                                        100,
                                        (totalHours / estHours) * 100,
                                      )
                                    : totalHours > 0
                                    ? 100
                                    : 0;
                                return (
                                  <div
                                    key={p.id}
                                    className="p-4 rounded-2xl border border-slate-100 bg-white flex flex-col sm:flex-row justify-between gap-4"
                                  >
                                    <div>
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="font-black text-sm text-slate-800">
                                          {p.title}
                                        </span>
                                        <span
                                          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                                            p.status === 'requested'
                                              ? 'bg-orange-100 text-orange-600'
                                              : p.status === 'active'
                                              ? 'bg-emerald-100 text-emerald-600'
                                              : 'bg-slate-200 text-slate-500'
                                          }`}
                                        >
                                          {p.status}
                                        </span>
                                        {p.invoiced && (
                                          <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest">
                                            Invoiced
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-slate-500 mb-1">
                                        Est. Budget: $
                                        {Number(
                                          p.estimatedBudget || 0,
                                        ).toFixed(2)}{' '}
                                        • Est. Hours:{' '}
                                        {Number(
                                          p.estimatedHours || 0,
                                        ).toFixed(1)}
                                        h • Tracked:{' '}
                                        {totalHours.toFixed(2)}h
                                      </div>
                                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden mb-1">
                                        <div
                                          className={`h-2 rounded-full ${
                                            projectPercent > 100
                                              ? 'bg-red-500'
                                              : projectPercent > 85
                                              ? 'bg-orange-500'
                                              : 'bg-emerald-500'
                                          }`}
                                          style={{
                                            width: `${Math.min(
                                              projectPercent,
                                              100,
                                            )}%`,
                                          }}
                                        ></div>
                                      </div>
                                      {p.description && (
                                        <p className="text-xs text-slate-600 italic">
                                          &quot;{p.description}&quot;
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex flex-col gap-2 items-end">
                                      {(p.status === 'requested' ||
                                        p.status === 'approved') && (
                                        <button
                                          onClick={async () => {
                                            if (isCycleLocked(c, mStart)) {
                                              window.alert(
                                                'This billing cycle is locked. Unlock to start projects.',
                                              );
                                              return;
                                            }
                                            try {
                                              await updateDoc(doc('projects', p.id), {
                                                status: 'active',
                                                startedAt: Date.now(),
                                                notificationState: {
                                                  ...(p.notificationState || {}),
                                                  adminApproved: false,
                                                },
                                              });
                                              await logAudit?.({
                                                type: 'project_started',
                                                entityType: 'project',
                                                entityId: p.id,
                                                clientId: c.id,
                                              });
                                            } catch (err) {
                                              window.alert(
                                                `Could not start project: ${
                                                  err?.message || String(err)
                                                }`,
                                              );
                                            }
                                          }}
                                          className="px-3 py-1 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-900"
                                        >
                                          Start Project
                                        </button>
                                      )}
                                      <button
                                        onClick={() => {
                                          setProjectEditError('');
                                          setProjectEditModal({ project: p, client: c });
                                          setProjectEditValues({
                                            estimatedBudget: String(p.estimatedBudget ?? ''),
                                            estimatedHours: String(p.estimatedHours ?? ''),
                                          });
                                        }}
                                        className="px-3 py-1 rounded-xl bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-100"
                                      >
                                        Edit Estimates
                                      </button>
                                      {p.status !== 'closed' && (
                                        <button
                                          onClick={async () => {
                                            if (isCycleLocked(c, mStart)) {
                                              window.alert(
                                                'This billing cycle is locked. Unlock to close projects.',
                                              );
                                              return;
                                            }
                                            try {
                                              await updateDoc(doc('projects', p.id), {
                                                status: 'closed',
                                                closedAt: Date.now(),
                                              });
                                              await logAudit?.({
                                                type: 'project_closed',
                                                entityType: 'project',
                                                entityId: p.id,
                                                clientId: c.id,
                                              });
                                            } catch (err) {
                                              window.alert(
                                                `Could not close project: ${
                                                  err?.message || String(err)
                                                }`,
                                              );
                                            }
                                          }}
                                          className="px-3 py-1 rounded-xl bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black"
                                        >
                                          Mark Complete
                                        </button>
                                      )}
                                      {p.status === 'closed' && !p.invoiced && (
                                        <button
                                          onClick={() =>
                                            isCycleLocked(c, mStart)
                                              ? window.alert(
                                                  'This billing cycle is locked. Unlock to mark invoiced.',
                                                )
                                              : updateDoc(doc('projects', p.id), {
                                              invoiced: true,
                                                })
                                              .then(() =>
                                                logAudit?.({
                                                  type: 'project_marked_invoiced',
                                                  entityType: 'project',
                                                  entityId: p.id,
                                                  clientId: c.id,
                                                }),
                                              )
                                          }
                                          className="px-3 py-1 rounded-xl bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-600"
                                        >
                                          Mark Invoiced
                                        </button>
                                      )}
                                      <button
                                        onClick={() =>
                                          setDeleteConfirm({
                                            collection: 'projects',
                                            id: p.id,
                                            title: `custom project "${p.title}" for ${c.name}`,
                                          })
                                        }
                                        className="px-3 py-1 rounded-xl bg-white border border-red-100 text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-50"
                                      >
                                        Delete Project
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    </div>
                    )}
                  </>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Billing Tab */}
      {adminTab === 'billing' && (
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm space-y-6">
            <div className="border-b border-slate-50 pb-6 flex justify-between items-center">
              <h3 className="font-black text-xl text-slate-900 tracking-tight flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-[#fd7414]" /> Additional
                Retainer Hours
              </h3>
              {addonNeedsInvoiceCount > 0 && (
                <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                  {addonNeedsInvoiceCount} need invoicing
                </span>
              )}
                            {/* Global manual add moved to per-client controls */}
            </div>

            <div className="space-y-3">
              {addons.length === 0 ? (
                <p className="text-sm italic text-slate-400">
                  No add-on requests.
                </p>
              ) : (
                addons.map((a) => (
                  <div
                    key={a.id}
                    className={`p-5 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border ${
                      a.status === 'pending'
                        ? 'bg-orange-50 border-orange-100'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-slate-800">
                          {a.clientName}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold">
                          {new Date(a.date).toLocaleDateString()}
                        </span>
                        {a.status === 'pending' && (
                          <span className="bg-orange-200 text-orange-700 px-2 py-0.5 rounded text-[8px] font-black uppercase">
                            Pending Billing
                          </span>
                        )}
                        {a.notificationState?.adminNeedsInvoice && (
                          <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded text-[8px] font-black uppercase">
                            Invoice Next Cycle
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 font-black">
                        +{a.hours} hours requested
                      </p>
                      {a.notes && (
                        <p className="text-xs text-slate-500 italic mt-1">
                          &quot;{a.notes}&quot;
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {a.status === 'pending' && (
                        <button
                          onClick={() =>
                            updateDoc(doc('addons', a.id), {
                              status: 'invoiced',
                              notificationState: {
                                ...(a.notificationState || {}),
                                adminNeedsInvoice: false,
                              },
                            })
                              .then(() =>
                                logAudit?.({
                                  type: 'addon_marked_invoiced',
                                  entityType: 'addon',
                                  entityId: a.id,
                                  clientId: a.clientId,
                                  cycleStart: a.billingCycleStart || null,
                                }),
                              )
                          }
                          className="bg-black hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
                        >
                          <CheckSquare className="w-3 h-3" /> Mark Invoiced
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setDeleteConfirm({
                            collection: 'addons',
                            id: a.id,
                            title: 'this add-on request',
                          })
                        }
                        className="p-2 text-slate-300 hover:text-red-500 bg-white rounded-xl transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm space-y-6">
            <div className="border-b border-slate-50 pb-6 flex justify-between items-center">
              <h3 className="font-black text-xl text-slate-900 tracking-tight flex items-center gap-2">
                <FolderGit2 className="w-5 h-5 text-[#fd7414]" /> Custom
                Projects
              </h3>
              <div className="flex items-center gap-2">
                {projectNeedsReviewCount > 0 && (
                  <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                    {projectNeedsReviewCount} to review
                  </span>
                )}
                {projectApprovedCount > 0 && (
                  <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                    {projectApprovedCount} approved
                  </span>
                )}
              </div>
              <button
                onClick={() => clients[0] && setProjectModal(clients[0])}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2"
              >
                <CheckSquare className="w-3 h-3" /> Manually Add
              </button>
            </div>

            <div className="space-y-4">
              {projects.length === 0 ? (
                <p className="text-sm italic text-slate-400">
                  No custom projects.
                </p>
              ) : (
                projects.map((p) => {
                  const pTasks = taskLogs.filter(
                    (t) => t.projectId === p.id,
                  );
                  const pExps = expenses.filter(
                    (e) => e.projectId === p.id,
                  );
                  const totalHours =
                    pTasks.reduce(
                      (a, b) => a + getTaskDuration(b),
                      0,
                    ) / 3600000;
                  const totalCost = pExps.reduce(
                    (a, b) => a + b.finalCost,
                    0,
                  );

                  return (
                    <div
                      key={p.id}
                      className="p-6 rounded-3xl border border-slate-100 bg-slate-50"
                    >
                      <div className="flex flex-col sm:flex-row justify-between items-start mb-4 gap-4">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-black text-lg text-slate-800">
                              {p.title}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                                p.status === 'requested'
                                  ? 'bg-orange-100 text-orange-600'
                                  : p.status === 'active'
                                  ? 'bg-emerald-100 text-emerald-600'
                                  : 'bg-slate-200 text-slate-500'
                              }`}
                            >
                              {p.status}
                            </span>
                            {p.notificationState?.adminNeedsReview && (
                              <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest">
                                Needs Review
                              </span>
                            )}
                            {p.notificationState?.adminApproved && (
                              <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest">
                                Approved
                              </span>
                            )}
                            {p.invoiced && (
                              <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest">
                                Invoiced
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-bold text-slate-500">
                            {p.clientName} • Requested{' '}
                            {new Date(
                              p.createdAt,
                            ).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {p.status === 'requested' &&
                            p.requestDescription &&
                            !p.estimate && (
                              <button
                                onClick={() => {
                                  setEstimateModal(p);
                                  setEstimateValues({
                                    hours: String(p.estimatedHours ?? ''),
                                    cost: String(p.estimatedBudget ?? ''),
                                    notes: String(p.estimate?.notes ?? ''),
                                  });
                                }}
                                className="bg-black hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                              >
                                Send Estimate
                              </button>
                            )}
                          {(p.status === 'approved' ||
                            (p.status === 'requested' && !p.requestDescription)) && (
                            <button
                              onClick={() =>
                                updateDoc(doc('projects', p.id), {
                                  status: 'active',
                                  notificationState: {
                                    ...(p.notificationState || {}),
                                    adminApproved: false,
                                  },
                                })
                              }
                              className="bg-black hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                            >
                              Start Project
                            </button>
                          )}
                          {p.status === 'active' && (
                            <button
                              onClick={() =>
                                updateDoc(doc('projects', p.id), {
                                  status: 'closed',
                                })
                              }
                              className="bg-slate-800 hover:bg-black text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                            >
                              Close Project
                            </button>
                          )}
                          {p.status === 'closed' && !p.invoiced && (
                            <button
                              onClick={() =>
                                updateDoc(doc('projects', p.id), {
                                  invoiced: true,
                                })
                              }
                              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1"
                            >
                              <CheckSquare className="w-3 h-3" /> Mark
                              Invoiced
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setDeleteConfirm({
                                collection: 'projects',
                                id: p.id,
                                title: 'this project',
                              })
                            }
                            className="p-2 text-slate-300 hover:text-red-500 bg-white rounded-xl transition-colors border border-slate-200"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() =>
                              updateDoc(doc('projects', p.id), {
                                archived: !p.archived,
                              })
                            }
                            className="p-2 text-slate-400 hover:text-black bg-white rounded-xl transition-colors border border-slate-200"
                            title={p.archived ? 'Unarchive project' : 'Archive project'}
                          >
                            <FolderGit2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="text-sm text-slate-600 mb-4 bg-white p-4 rounded-2xl italic border border-slate-100">
                        &quot;{p.description}&quot;
                      </p>

                      {p.estimate && (
                        <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                            Estimate
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="text-sm font-black text-slate-800">
                              {Number(p.estimate.hours || 0).toFixed(1)} hours
                            </div>
                            <div className="text-sm font-black text-[#fd7414]">
                              ${Number(p.estimate.cost || 0).toFixed(2)}
                            </div>
                          </div>
                          {p.estimate.notes && (
                            <div className="text-xs text-slate-500 font-medium italic mt-2">
                              &quot;{p.estimate.notes}&quot;
                            </div>
                          )}
                        </div>
                      )}

                      <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Timeline
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                          <div>
                            Requested:{' '}
                            <span className="text-slate-500">
                              {p.createdAt
                                ? new Date(p.createdAt).toLocaleString()
                                : '—'}
                            </span>
                          </div>
                          <div>
                            Estimate Sent:{' '}
                            <span className="text-slate-500">
                              {p.estimate?.sentAt
                                ? new Date(p.estimate.sentAt).toLocaleString()
                                : '—'}
                            </span>
                          </div>
                          <div>
                            Client Decision:{' '}
                            <span className="text-slate-500">
                              {p.clientDecision?.decidedAt
                                ? new Date(
                                    p.clientDecision.decidedAt,
                                  ).toLocaleString()
                                : '—'}
                            </span>
                          </div>
                          <div>
                            Started:{' '}
                            <span className="text-slate-500">
                              {p.startedAt
                                ? new Date(p.startedAt).toLocaleString()
                                : '—'}
                            </span>
                          </div>
                          <div>
                            Closed:{' '}
                            <span className="text-slate-500">
                              {p.closedAt
                                ? new Date(p.closedAt).toLocaleString()
                                : '—'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                          Budget Burn
                        </div>
                        <div className="space-y-3">
                          {Number(p.estimatedHours || 0) > 0 && (
                            <div>
                              <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                                <span>Hours</span>
                                <span>
                                  {totalHours.toFixed(2)}h /{' '}
                                  {Number(p.estimatedHours || 0).toFixed(2)}h
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                                <div
                                  className="h-2 rounded-full bg-[#fd7414]"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      (totalHours /
                                        Number(p.estimatedHours || 1)) *
                                        100,
                                    )}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}
                          {Number(p.estimatedBudget || 0) > 0 && (
                            <div>
                              <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                                <span>Cost</span>
                                <span>
                                  ${totalCost.toFixed(2)} / $
                                  {Number(p.estimatedBudget || 0).toFixed(2)}
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                                <div
                                  className="h-2 rounded-full bg-blue-500"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      (totalCost /
                                        Number(p.estimatedBudget || 1)) *
                                        100,
                                    )}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}
                          {Number(p.estimatedHours || 0) === 0 &&
                            Number(p.estimatedBudget || 0) === 0 && (
                              <div className="text-xs italic text-slate-400">
                                No estimates set yet.
                              </div>
                            )}
                        </div>
                      </div>

                      <div className="flex gap-6 pt-4 border-t border-slate-200">
                        <div>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                            Time Tracked
                          </span>
                          <span className="font-black text-[#fd7414] text-lg">
                            {totalHours.toFixed(2)}h
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                            Expenses
                          </span>
                          <span className="font-black text-blue-500 text-lg">
                            ${totalCost.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tasks Tab */}
      {adminTab === 'tasks' && (
        <div className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-sm space-y-10 animate-in fade-in duration-500">
          <div className="bg-slate-50 border border-slate-100 rounded-[32px] p-8 text-left">
            <h3 className="font-black text-xl mb-2">Kiosk Policies</h3>
            <p className="text-slate-400 text-sm font-medium mb-6">
              These settings are stored locally in your browser for now.
            </p>
            <div className="space-y-4">
              <label className="flex items-center gap-3 font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={!!policy?.requireClockOutNote}
                  onChange={(e) =>
                    updatePolicy?.({ requireClockOutNote: e.target.checked })
                  }
                />
                Require a note before clock-out
              </label>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Idle reminder (minutes, 0 = off)
                </label>
                <input
                  type="number"
                  min="0"
                  value={policy?.idleReminderMinutes || 0}
                  onChange={(e) =>
                    updatePolicy?.({
                      idleReminderMinutes: Number(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              value={newTaskType}
              onChange={(e) => setNewTaskType(e.target.value)}
              className="flex-1 bg-slate-50 border-slate-200 border p-5 rounded-3xl font-bold outline-none placeholder:text-slate-300"
              placeholder="New Category"
            />
            <button
              onClick={async () => {
                if (newTaskType) {
                  await addDoc(collection('taskTypes'), {
                    name: newTaskType,
                  });
                  setNewTaskType('');
                }
              }}
              className="bg-black text-white px-10 py-5 rounded-3xl font-black shadow-2xl active:scale-95 transition-all"
            >
              Add Category
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4 text-left">
            {activeTaskTypes.map((t, i) => {
              const typeRecord = taskTypes?.find((type) => type.name === t);
              return (
                <div
                  key={i}
                  className="flex justify-between items-center p-6 bg-slate-50 rounded-3xl group border-2 border-transparent hover:border-slate-200 transition-all"
                >
                  <span className="font-black text-slate-700">
                    {t}
                  </span>
                  {typeRecord && (
                    <button
                      onClick={() =>
                        setDeleteConfirm({
                          collection: 'taskTypes',
                          id: typeRecord.id,
                          title: `the category "${t}"`,
                        })
                      }
                      className="text-slate-300 hover:text-red-500 transition-all p-2"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Users Tab */}
      {adminTab === 'users' && (
        <div className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-sm space-y-10 animate-in fade-in duration-500">
          <div>
            <h3 className="font-black text-xl mb-2">Manage Administrators</h3>
            <p className="text-slate-400 text-sm font-medium mb-6">
              Authorize Google accounts to access this Admin Panel.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="email"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                className="flex-1 bg-slate-50 border-slate-200 border p-5 rounded-3xl font-bold outline-none placeholder:text-slate-300"
                placeholder="user@ignitepm.com"
              />
              <button
                onClick={async () => {
                  if (!newAdminEmail) return;
                  const emailKey = newAdminEmail.trim().toLowerCase();
                  try {
                    await setDoc(
                      doc('admins', emailKey),
                      { email: newAdminEmail.trim(), role: 'billing' },
                      { merge: true }
                    );
                    setNewAdminEmail('');
                  } catch (err) {
                    window.alert(
                      `Could not grant access for "${newAdminEmail}".\n\n${
                        err?.message || String(err)
                      }\n\nMost common fix: ensure your super admin doc exists as admins/chris@ignitepm.com with role "admin", then sign out/in.`
                    );
                  }
                }}
                className="bg-black text-white px-10 py-5 rounded-3xl font-black shadow-2xl active:scale-95 transition-all"
              >
                Grant Access
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
            <div className="flex justify-between items-center p-6 bg-blue-50 border border-blue-100 rounded-3xl">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-blue-500" />
                <span className="font-black text-blue-900">
                  chris@ignitepm.com
                </span>
              </div>
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                Super Admin
              </span>
            </div>
            {dedupedAdminUsers.map((a) => (
              <div
                key={a.email}
                className="flex justify-between items-center p-6 bg-slate-50 rounded-3xl group border-2 border-transparent hover:border-slate-200 transition-all"
              >
                <div className="flex flex-col gap-2 flex-1 pr-4">
                  <span className="font-black text-slate-700">
                    {a.email}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      Role
                    </span>
                    <select
                      value={a.role || 'billing'}
                      onChange={async (e) => {
                        const nextRole = e.target.value;
                        await Promise.all(
                          (a.ids || []).map((id) =>
                            updateDoc(doc('admins', id), { role: nextRole }).catch(() => {})
                          )
                        );
                        // Ensure canonical email-keyed doc exists/updated for security rules
                        await setDoc(
                          doc('admins', String(a.email).toLowerCase()),
                          { email: a.email, role: nextRole },
                          { merge: true }
                        ).catch(() => {});
                      }}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-[#fd7414]"
                    >
                      <option value="admin">Admin</option>
                      <option value="billing">Billing</option>
                      <option value="kiosk">Kiosk-only</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={() =>
                    setDeleteConfirm({
                      collection: 'admins',
                      ids: a.ids,
                      id: a.ids?.[0],
                      title: `admin access for "${a.email}"`,
                    })
                  }
                  className="text-slate-300 hover:text-red-500 transition-all p-2"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {estimateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[120] animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 text-left">
              <div>
                <h3 className="font-black text-2xl text-slate-900">
                  Send Estimate
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                  {estimateModal.clientName}
                </p>
              </div>
              <button
                onClick={() => setEstimateModal(null)}
                className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"
              >
                <ChevronDown className="w-5 h-5 rotate-180" />
              </button>
            </div>
            <div className="p-8 space-y-5 text-left">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                  Estimated Hours
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={estimateValues.hours}
                  onChange={(e) =>
                    setEstimateValues({ ...estimateValues, hours: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                  placeholder="e.g. 12"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                  Estimated Cost ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimateValues.cost}
                  onChange={(e) =>
                    setEstimateValues({ ...estimateValues, cost: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                  placeholder="e.g. 1500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={estimateValues.notes}
                  onChange={(e) =>
                    setEstimateValues({ ...estimateValues, notes: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[100px]"
                  placeholder="Anything the client should know..."
                />
              </div>
              <button
                onClick={async () => {
                  try {
                    setEstimateError('');
                    const hours = Number(estimateValues.hours) || 0;
                    const cost = Number(estimateValues.cost) || 0;
                    await updateDoc(doc('projects', estimateModal.id), {
                      status: 'estimate_sent',
                      estimate: {
                        hours,
                        cost,
                        notes: estimateValues.notes || '',
                        sentAt: Date.now(),
                      },
                      notificationState: {
                        ...(estimateModal.notificationState || {}),
                        adminNeedsReview: false,
                        clientNeedsDecision: true,
                      },
                    });
                    logAudit?.({
                      type: 'estimate_sent',
                      entityType: 'project',
                      entityId: estimateModal.id,
                      clientId: estimateModal.clientId,
                      cycleStart: null,
                    });
                    setEstimateModal(null);
                    setEstimateValues({ hours: '', cost: '', notes: '' });
                  } catch (err) {
                    setEstimateError(err?.message || String(err));
                  }
                }}
                disabled={!estimateValues.hours || !estimateValues.cost}
                className="w-full bg-black text-white p-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all disabled:opacity-30 mt-2"
              >
                Send to Client
              </button>
              {estimateError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-bold p-4 rounded-2xl">
                  {estimateError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {projectEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[120] animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 text-left">
              <div>
                <h3 className="font-black text-2xl text-slate-900">
                  Edit Project
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                  {projectEditModal?.client?.name}
                </p>
              </div>
              <button
                onClick={() => setProjectEditModal(null)}
                className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"
              >
                <ChevronDown className="w-5 h-5 rotate-180" />
              </button>
            </div>
            <div className="p-8 space-y-5 text-left">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                  Estimated Budget ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={projectEditValues.estimatedBudget}
                  onChange={(e) =>
                    setProjectEditValues({
                      ...projectEditValues,
                      estimatedBudget: e.target.value,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                  Estimated Hours
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={projectEditValues.estimatedHours}
                  onChange={(e) =>
                    setProjectEditValues({
                      ...projectEditValues,
                      estimatedHours: e.target.value,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                />
              </div>
              <button
                onClick={async () => {
                  try {
                    setProjectEditError('');
                    await updateDoc(
                      doc('projects', projectEditModal.project.id),
                      {
                        estimatedBudget:
                          Number(projectEditValues.estimatedBudget) || 0,
                        estimatedHours:
                          Number(projectEditValues.estimatedHours) || 0,
                      },
                    );
                    setProjectEditModal(null);
                  } catch (err) {
                    setProjectEditError(err?.message || String(err));
                  }
                }}
                className="w-full bg-black text-white p-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all mt-2"
              >
                Save Changes
              </button>
              {projectEditError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-bold p-4 rounded-2xl">
                  {projectEditError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;

