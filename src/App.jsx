import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Clock,
  User,
  Download,
  Mail,
  Play,
  Square,
  History,
  Shield,
  CheckCircle2,
  Briefcase,
  Plus,
  Trash2,
  List,
  Lock,
  FileText,
  RotateCw,
  Edit3,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Calendar,
  Filter,
  LogOut,
  Save,
  X,
  Search,
  FileDown,
  ArrowRight,
  Activity,
  Coffee,
  Pause,
  Users,
  Settings,
  DollarSign,
  FolderGit2,
  ShoppingCart,
  CheckSquare,
  MessageSquare,
} from 'lucide-react';
import {
  auth,
  db,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  collection,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  doc,
  deleteDoc,
} from './firebase';
import ClientPortal from './components/ClientPortal.jsx';
import EmployeeKiosk from './components/EmployeeKiosk.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import { buildTeamAccessMergeForTodoAssignees } from './utils/teamClientAccess.js';
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

const DEFAULT_PROJECT_CATEGORIES = [
  'SEO',
  'Email Marketing',
  'Social Media',
  'Content Creation',
  'Web Development',
  'Consulting',
  'Social Ad Budget',
];

// Approximate exchange rates to CAD (update as needed). All expense tracking is stored in CAD.
const FX_TO_CAD = {
  CAD: 1,
  USD: 1.36,
  EUR: 1.47,
  GBP: 1.72,
};

const IgniteLogo = ({ className }) => (
  <img
    src="/logo.png"
    alt="Ignite PM"
    className={className}
  />
);

const KioskRouteView = (props) => <EmployeeKiosk {...props} />;

/** Kiosk users must use /workspace URLs; preserve client deep-link. */
function RedirectKioskAdminClientToWorkspace() {
  const { clientId } = useParams();
  return <Navigate to={`/workspace/clients/${clientId}`} replace />;
}

function RedirectStaffWorkspaceClientToAdmin() {
  const { clientId } = useParams();
  return <Navigate to={`/admin/clients/${clientId}`} replace />;
}

// Use `custom_projects` (not `projects`) for ?tab= to avoid clashes with routers/proxies treating "projects" specially.
const CLIENT_PAGE_TABS = ['summary', 'tasks', 'custom_projects', 'timesheets'];

const AdminDashboardRouteView = ({ adminDashboardProps, navigate }) => {
  const adminBasePath = adminDashboardProps?.adminBasePath || '/admin';
  const params = useParams();
  const clientId = params?.clientId || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const normalizedTab =
    rawTab === 'projects' ? 'custom_projects' : rawTab;
  const clientPageTab =
    clientId && CLIENT_PAGE_TABS.includes(normalizedTab)
      ? normalizedTab
      : 'summary';
  const clientUrlCycle = clientId ? searchParams.get('cycle') : null;

  const mergeClientSearchParams = useCallback(
    (patch) => {
      if (!clientId) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patch.tab !== undefined) {
            if (patch.tab === 'summary') next.delete('tab');
            else next.set('tab', patch.tab);
          }
          if (patch.cycle !== undefined) {
            if (patch.cycle == null || patch.cycle === '') next.delete('cycle');
            else next.set('cycle', String(patch.cycle));
          }
          return next;
        },
        { replace: true },
      );
    },
    [clientId, setSearchParams],
  );

  const setClientPageTab = (tab) => mergeClientSearchParams({ tab });

  return (
    <AdminDashboard
      {...adminDashboardProps}
      clientId={clientId}
      clientPageTab={clientId ? clientPageTab : null}
      setClientPageTab={setClientPageTab}
      clientUrlCycle={clientUrlCycle}
      mergeClientSearchParams={mergeClientSearchParams}
      navigateToClient={(id) => navigate(`${adminBasePath}/clients/${id}`)}
      navigateToClientsList={() => navigate(adminBasePath)}
    />
  );
};

export default function App() {
  const ENABLE_DEMOS = import.meta?.env?.VITE_ENABLE_DEMOS === 'true';
  const [user, setUser] = useState(null);
  const [view, setView] = useState('employee'); 
  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Auth Form States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  const [liveDuration, setLiveDuration] = useState(0);
  const [liveTaskDuration, setLiveTaskDuration] = useState(0);

  const [clients, setClients] = useState([]);
  const [taskLogs, setTaskLogs] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  /** Own admins/{emailLower} doc — collection queries fail for kiosk/billing (Firestore rules). */
  const [myAdminDoc, setMyAdminDoc] = useState(null);
  const [adminDocReady, setAdminDocReady] = useState(false);
  const [adminUsersFromCollection, setAdminUsersFromCollection] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [projects, setProjects] = useState([]);
  const [addons, setAddons] = useState([]);
  const [userTodos, setUserTodos] = useState([]);
  
  const [adminTab, setAdminTab] = useState('timesheets'); 
  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [dateFilterType, setDateFilterType] = useState('week'); 
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });

  const location = useLocation();
  const navigate = useNavigate();

  // Keep legacy `view` state in sync with URL routes.
  useEffect(() => {
    // Don't fight client portal, which is role-driven and not yet routed.
    if (view === 'client_portal') return;
    const path = location.pathname || '/';
    if (path.startsWith('/admin') || path.startsWith('/workspace')) {
      if (view !== 'admin') setView('admin');
      if (
        adminTab !== 'clients' &&
        (path.startsWith('/admin/clients') || path.startsWith('/workspace/clients'))
      ) {
        setAdminTab('clients');
      }
      return;
    }
    if (path.startsWith('/kiosk') || path === '/') {
      if (view !== 'employee') setView('employee');
      return;
    }
  }, [location.pathname]);
  
  const [newClientName, setNewClientName] = useState('');
  const [newTaskType, setNewTaskType] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [expandedShifts, setExpandedShifts] = useState({});
  const [expandedClients, setExpandedClients] = useState({});
  
  // Modals
  const [editingItem, setEditingItem] = useState(null); 
  const [editValues, setEditValues] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editingClient, setEditingClient] = useState(null); 
  const [expenseModal, setExpenseModal] = useState(null);
  const [expenseValues, setExpenseValues] = useState({
    billingTarget: '',
    description: '',
    amount: '',
    date: '',
    currency: 'CAD',
    applyMarkup: true,
    recurrenceMode: 'none',
  });
  const [manualTaskModal, setManualTaskModal] = useState(false);
  const [manualTaskValues, setManualTaskValues] = useState({ clientName: '', billingTarget: '', date: '', hours: '', minutes: '', notes: '', employeeName: '', parsedExpense: 0 });
  const [addonModal, setAddonModal] = useState(null); 
  const [addonValues, setAddonValues] = useState({ hours: '', notes: '', category: '' });
  const [projectModal, setProjectModal] = useState(null); 
  const [projectValues, setProjectValues] = useState({
    clientId: '',
    clientName: '',
    title: '',
    description: '',
    category: '',
    requestDescription: '',
    estimatedBudget: '',
    estimatedHours: '',
  });
  const [projectBudgetOverride, setProjectBudgetOverride] = useState(false);
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectSubmitError, setProjectSubmitError] = useState('');

  // Employee Form states
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedBillingTarget, setSelectedBillingTarget] = useState('');
  const [kioskAutostartPending, setKioskAutostartPending] = useState(false);
  const kioskAutostartSearchProcessedRef = useRef('');
  const kioskAutostartClockInAttemptedRef = useRef(false);
  const recurringExpenseSyncInProgressRef = useRef(false);
  const [activeTaskNotes, setActiveTaskNotes] = useState('');

  // Client Portal State
  const [portalOffset, setPortalOffset] = useState(0);
  const [policy, setPolicy] = useState(() => {
    try {
      const raw = localStorage.getItem('ignite_policy');
      return raw
        ? JSON.parse(raw)
        : { requireClockOutNote: false, idleReminderMinutes: 0 };
    } catch {
      return { requireClockOutNote: false, idleReminderMinutes: 0 };
    }
  });

  const updatePolicy = (updates) => {
    setPolicy((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem('ignite_policy', JSON.stringify(next));
      } catch {
        // Ignore localStorage failures in restricted environments.
      }
      return next;
    });
  };

  const computeNextRecurringExpenseDate = (currentDateMs, recurrence) => {
    const base = new Date(Number(currentDateMs || 0));
    if (Number.isNaN(base.getTime()) || !recurrence?.type) return null;
    const type = String(recurrence.type);
    if (type === 'monthly_fixed_day') {
      const day = Number(recurrence.dayOfMonth || 0);
      if (!day) return null;
      const y = base.getFullYear();
      const m = base.getMonth() + 1;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const clamped = Math.min(Math.max(day, 1), lastDay);
      return new Date(y, m, clamped, 12, 0, 0, 0).getTime();
    }
    if (type === 'annual_fixed') {
      const month = Number(recurrence.month);
      const day = Number(recurrence.day);
      if (!Number.isFinite(month) || month < 0 || month > 11 || !day) return null;
      const y = base.getFullYear() + 1;
      const lastDay = new Date(y, month + 1, 0).getDate();
      const clamped = Math.min(Math.max(day, 1), lastDay);
      return new Date(y, month, clamped, 12, 0, 0, 0).getTime();
    }
    return null;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubTimesheets = onSnapshot(collection(db, 'timesheets'), (snapshot) => setTimesheets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.clockInTime - a.clockInTime)));
    const unsubClients = onSnapshot(collection(db, 'clients'), (snapshot) => setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    const unsubTasks = onSnapshot(collection(db, 'taskLogs'), (snapshot) => setTaskLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.clockInTime - a.clockInTime)));
    const unsubTaskTypes = onSnapshot(collection(db, 'taskTypes'), (snapshot) => setTaskTypes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    const unsubExpenses = onSnapshot(collection(db, 'expenses'), (snapshot) => setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => b.date - a.date)));
    const unsubProjects = onSnapshot(collection(db, 'projects'), (snapshot) => setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => b.createdAt - a.createdAt)));
    const unsubAddons = onSnapshot(collection(db, 'addons'), (snapshot) => setAddons(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => b.date - a.date)));
    const unsubUserTodos = onSnapshot(doc(db, 'userTodos', user.uid), (snapshot) => {
      if (!snapshot.exists()) {
        setUserTodos([]);
        return;
      }
      const data = snapshot.data() || {};
      const items = Array.isArray(data.items) ? data.items : [];
      setUserTodos(items);
    });

    return () => {
      unsubTimesheets();
      unsubClients();
      unsubTasks();
      unsubTaskTypes();
      unsubExpenses();
      unsubProjects();
      unsubAddons();
      unsubUserTodos();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !Array.isArray(expenses) || expenses.length === 0) return;
    if (recurringExpenseSyncInProgressRef.current) return;
    const recurringItems = expenses.filter(
      (e) => !!e?.recurring && !!e?.recurrence && Number(e?.date || 0) > 0,
    );
    if (recurringItems.length === 0) return;

    const run = async () => {
      recurringExpenseSyncInProgressRef.current = true;
      try {
        const now = Date.now();
        const bySeries = recurringItems.reduce((acc, exp) => {
          const seriesId = String(exp.recurringId || exp.id || '');
          if (!seriesId) return acc;
          if (!acc[seriesId]) acc[seriesId] = [];
          acc[seriesId].push(exp);
          return acc;
        }, {});

        const toCreate = [];
        Object.values(bySeries).forEach((series) => {
          const sorted = [...series].sort(
            (a, b) => Number(a.date || 0) - Number(b.date || 0),
          );
          if (sorted.length === 0) return;
          const latest = sorted[sorted.length - 1];
          const recurrence = latest.recurrence;
          const seriesId = String(latest.recurringId || latest.id || '');
          if (!seriesId || !recurrence) return;
          const seenDates = new Set(
            sorted.map((e) => Number(e.date || 0)).filter((n) => Number.isFinite(n)),
          );
          let cursor = Number(latest.date || 0);
          for (let i = 0; i < 24; i++) {
            const nextDate = computeNextRecurringExpenseDate(cursor, recurrence);
            if (!nextDate || nextDate > now) break;
            if (!seenDates.has(nextDate)) {
              toCreate.push({
                ...latest,
                id: undefined,
                date: nextDate,
                recurring: true,
                recurringId: seriesId,
                recurrence,
              });
              seenDates.add(nextDate);
            }
            cursor = nextDate;
          }
        });

        if (toCreate.length > 0) {
          await Promise.all(
            toCreate.map((e) =>
              addDoc(collection(db, 'expenses'), {
                clientId: e.clientId || '',
                clientName: e.clientName || '',
                category: e.category || '',
                projectId: e.projectId || null,
                description: e.description || '',
                rawAmount: Number(e.rawAmount || 0),
                finalCost: Number(e.finalCost || 0),
                equivalentHours: Number(e.equivalentHours || 0),
                date: Number(e.date || Date.now()),
                originalCurrency: e.originalCurrency || 'CAD',
                originalAmount: Number(e.originalAmount || e.rawAmount || 0),
                recurring: true,
                recurringId: e.recurringId,
                recurrence: e.recurrence,
              }),
            ),
          );
        }
      } finally {
        recurringExpenseSyncInProgressRef.current = false;
      }
    };

    run();
  }, [user, expenses]);

  // Firestore: only role === 'admin' may read all admins/*; kiosk/billing must read doc(admins, ownEmail).
  useEffect(() => {
    if (!user?.email) {
      setMyAdminDoc(null);
      setAdminDocReady(true);
      return;
    }
    setAdminDocReady(false);
    const emailKey = user.email.toLowerCase();
    const unsub = onSnapshot(
      doc(db, 'admins', emailKey),
      (snap) => {
        setMyAdminDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setAdminDocReady(true);
      },
      () => {
        setMyAdminDoc(null);
        setAdminDocReady(true);
      },
    );
    return () => unsub();
  }, [user?.email]);

  const canListAllAdmins =
    user?.email === 'chris@ignitepm.com' || myAdminDoc?.role === 'admin';

  useEffect(() => {
    if (!user?.email || !canListAllAdmins) {
      setAdminUsersFromCollection([]);
      return;
    }
    const unsub = onSnapshot(collection(db, 'admins'), (snapshot) => {
      setAdminUsersFromCollection(
        snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
      );
    });
    return () => unsub();
  }, [user?.email, canListAllAdmins]);

  const adminUsers = useMemo(() => {
    if (canListAllAdmins) return adminUsersFromCollection;
    return myAdminDoc ? [myAdminDoc] : [];
  }, [canListAllAdmins, adminUsersFromCollection, myAdminDoc]);

  const updateUserTodos = async (nextItems) => {
    if (!user?.uid) return;
    const items = Array.isArray(nextItems) ? nextItems : [];
    setUserTodos(items);
    await setDoc(doc(db, 'userTodos', user.uid), { items }, { merge: true });
  };

  // Ensure admins are addressable by doc id (email)
  useEffect(() => {
    if (!user?.email) return;
    if (user.email !== 'chris@ignitepm.com') return;

    // Ensure super admin doc exists for security rules
    setDoc(
      doc(db, 'admins', 'chris@ignitepm.com'),
      { email: 'chris@ignitepm.com', role: 'admin' },
      { merge: true },
    ).catch(() => {});

    adminUsersFromCollection.forEach((a) => {
      if (!a.email) return;
      const id = a.email.toLowerCase();
      if (a.id === id) return;
      // Mirror record to email-keyed doc id for security rules
      setDoc(doc(db, 'admins', id), { email: a.email, role: a.role || 'billing' }, { merge: true }).catch(() => {});
    });
  }, [user?.email, adminUsersFromCollection]);

  // Roles & Access Logic (own admins/{email} doc is authoritative for role)
  const adminRecord = user && myAdminDoc ? myAdminDoc : null;
  const isUserAdmin =
    !!user &&
    (user.email === 'chris@ignitepm.com' || !!adminRecord);
  const currentUserRole =
    user?.email === 'chris@ignitepm.com'
      ? 'admin'
      : adminRecord?.role || (isUserAdmin ? 'admin' : null);
  
  // Inject Mock Client Profile for Demo Mode so you don't get Access Denied
  let clientProfile = user ? clients.find(c => c.clientEmails && c.clientEmails.map(e=>e.toLowerCase().trim()).includes(user.email.toLowerCase())) : null;
  if (ENABLE_DEMOS && user && user.uid === 'demo-client-123' && !clientProfile) {
    clientProfile = { id: 'demo', name: "Demo Client", status: 'active', hourlyRate: 100, billingDay: 1, clientEmails: ["client@demo.com"], retainers: { "SEO": 10 } };
  }
  
  const isClientUser = !!clientProfile && !isUserAdmin; 

  useEffect(() => {
    if (isClientUser && view !== 'client_portal') setView('client_portal');
    else if (isUserAdmin && view === 'client_portal')
      setView(currentUserRole === 'kiosk' ? 'employee' : 'admin');
  }, [isClientUser, isUserAdmin, currentUserRole, view]);

  // One-time per session (admin/billing): backfill assignees → teamMemberAccessEmails for
  // data created before deploy. Ongoing: every updateClientTodo / updateClientTodosBatch
  // already merges assignees — no admin login required for new assignments.
  const teamAccessAssigneeBackfillDoneRef = useRef(false);
  useEffect(() => {
    if (teamAccessAssigneeBackfillDoneRef.current) return;
    if (!user?.email || !isUserAdmin || currentUserRole === 'kiosk') return;
    if (!clients?.length) return;

    let cancelled = false;
    (async () => {
      for (const c of clients) {
        if (cancelled) return;
        const patch = buildTeamAccessMergeForTodoAssignees(c, c.todoCycles || {});
        if (!patch.teamMemberAccessEmails) continue;
        try {
          await updateDoc(doc(db, 'clients', c.id), patch);
        } catch {
          // ignore offline / permission edge cases
        }
      }
      if (!cancelled) teamAccessAssigneeBackfillDoneRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [clients, isUserAdmin, currentUserRole, user?.email]);

  const activeTaskTypes = taskTypes.length > 0 ? taskTypes.map(t => t.name) : DEFAULT_PROJECT_CATEGORIES;
  // For the client settings Retainers UI, always ensure Social Ad Budget is present
  const retainerConfigCategories = Array.from(
    new Set([...activeTaskTypes, 'Social Ad Budget']),
  );
  const activeShift = timesheets.find(t => t.userId === user?.uid && (t.status === 'active' || t.status === 'break'));
  const activeTask = activeShift ? taskLogs.find(t => t.shiftId === activeShift.id && t.status === 'active') : null;

  // Active Billing Targets
  const clientActiveProjects = projects.filter(p => !p.archived && p.clientName === selectedClient && (p.status === 'active' || p.status === 'approved'));
  const clientActiveProjectsManual = projects.filter(p => !p.archived && p.clientName === manualTaskValues.clientName && (p.status === 'active' || p.status === 'approved'));
  const clientActiveProjectsExp = expenseModal ? projects.filter(p => !p.archived && p.clientName === expenseModal.name && (p.status === 'active' || p.status === 'approved')) : [];

  const selectedClientObj = clients.find(c => c.name === selectedClient);
  const selectableRetainers = selectedClientObj
    ? Object.entries(selectedClientObj.retainers || {}).map(([name, hours]) => ({
        name,
        enabled: Number(hours) > 0,
      }))
    : [];
  const GENERAL_LABEL = 'General / Unclassified';
  const isDollarCategory = (client, categoryName) =>
    !categoryName ? false : categoryName === 'Social Ad Budget' || client?.retainerUnits?.[categoryName] === 'dollar';

  useEffect(() => {
    let interval;
    if (activeShift || activeTask) {
      interval = setInterval(() => {
        if (activeShift) {
          if (activeShift.status === 'active') setLiveDuration((activeShift.totalSavedDuration || 0) + (Date.now() - (activeShift.lastResumeTime || activeShift.clockInTime)));
          else setLiveDuration(activeShift.totalSavedDuration || 0);
        }
        if (activeTask) setLiveTaskDuration((activeTask.totalSavedDuration || 0) + (Date.now() - (activeTask.lastResumeTime || activeTask.clockInTime)));
      }, 1000);
    }
    return () => { clearInterval(interval); if (!activeShift) setLiveDuration(0); if (!activeTask) setLiveTaskDuration(0); };
  }, [activeShift, activeTask]);

  // Auth Methods
  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); setError(''); } catch { setError("Sign in failed."); }
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    try {
      if (isSignUp) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
      setError('');
    } catch (err) { setError(err.message.replace('Firebase: ', '')); }
  };

  const handleResetPassword = async () => {
    if(!email) return setError("Please enter your email address above first to reset password.");
    try { await sendPasswordResetEmail(auth, email); setError("Password reset email sent! Please check your inbox."); } 
    catch(err) { setError(err.message.replace('Firebase: ', '')); }
  };

  const logAudit = async (entry) => {
    if (!user?.email) return;
    try {
      await addDoc(collection(db, 'auditLogs'), {
        ...entry,
        actorEmail: user.email,
        at: Date.now(),
      });
    } catch {
      // Audit logging should never block primary actions.
    }
  };

  const enterDemoMode = () => {
    if (!ENABLE_DEMOS) return;
    setUser({ displayName: "Chris Rouse (Admin Demo)", uid: "demo-user-123", email: "chris@ignitepm.com" });
  };
  const enterClientDemo = () => {
    if (!ENABLE_DEMOS) return;
    setUser({ displayName: "Client Demo", uid: "demo-client-123", email: "client@demo.com" });
  };

  // Tracking Logic
  const handleClockIn = async () => {
    await addDoc(collection(db, 'timesheets'), {
      employeeName: user.displayName || user.email,
      clockInTime: Date.now(),
      lastResumeTime: Date.now(),
      totalSavedDuration: 0,
      status: 'active',
      userId: user.uid,
    });
  };

  const queueKioskTaskStart = useCallback((clientName, billingTarget) => {
    setSelectedClient(clientName);
    setSelectedBillingTarget(billingTarget);
    kioskAutostartClockInAttemptedRef.current = false;
    setKioskAutostartPending(true);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!location.pathname.startsWith('/kiosk')) return;
    const qs = location.search || '';
    if (!qs.includes('autostart=1')) return;
    if (qs === kioskAutostartSearchProcessedRef.current) return;
    const params = new URLSearchParams(qs);
    if (params.get('autostart') !== '1') return;
    const c = params.get('client');
    const t = params.get('target');
    if (!c || !t) return;
    kioskAutostartSearchProcessedRef.current = qs;
    setSelectedClient(decodeURIComponent(c));
    setSelectedBillingTarget(decodeURIComponent(t));
    kioskAutostartClockInAttemptedRef.current = false;
    setKioskAutostartPending(true);
    navigate('/kiosk', { replace: true });
  }, [user, location.pathname, location.search, navigate]);

  const handleStartTask = async () => {
    if (!selectedClient || !selectedBillingTarget) return;
    
    const isProject = selectedBillingTarget.startsWith('project_');
    const isGeneral = selectedBillingTarget === 'retainer_GENERAL_UNCLASSIFIED';
    const targetId = isProject ? selectedBillingTarget.replace('project_', '') : null;
    let projName;

    if (isProject) projName = 'Custom Project';
    else if (isGeneral) projName = GENERAL_LABEL;
    else projName = selectedBillingTarget.replace('retainer_', '');

    await addDoc(collection(db, 'taskLogs'), { 
      shiftId: activeShift.id, userId: user.uid, clientName: selectedClient, 
      projectName: projName, projectId: targetId,
      clockInTime: Date.now(), lastResumeTime: Date.now(), totalSavedDuration: 0, status: 'active', notes: '' 
    });
    // Keep selected client/target so kiosk notes (client + selected retainer category) remain visible
    setActiveTaskNotes('');
  };

  useEffect(() => {
    if (!user || !kioskAutostartPending) return;
    if (!selectedClient || !selectedBillingTarget) return;
    if (!activeShift) {
      if (!kioskAutostartClockInAttemptedRef.current) {
        kioskAutostartClockInAttemptedRef.current = true;
        handleClockIn();
      }
      return;
    }
    kioskAutostartClockInAttemptedRef.current = false;
    if (activeTask) {
      setKioskAutostartPending(false);
      return;
    }
    setKioskAutostartPending(false);
    handleStartTask();
  }, [
    user,
    kioskAutostartPending,
    selectedClient,
    selectedBillingTarget,
    activeShift,
    activeTask,
  ]);

  const handleStopTask = async () => {
    if (!activeTask) return;
    const endTime = Date.now();
    const segment = endTime - (activeTask.lastResumeTime || activeTask.clockInTime);
    const newTotal = (activeTask.totalSavedDuration || 0) + segment;
    await updateDoc(doc(db, 'taskLogs', activeTask.id), { clockOutTime: endTime, status: 'completed', totalSavedDuration: newTotal, duration: newTotal, notes: activeTaskNotes });
    setActiveTaskNotes('');
  };

  const handleResumeTask = async (task) => {
    if (activeTask) await handleStopTask();
    await updateDoc(doc(db, 'taskLogs', task.id), { status: 'active', lastResumeTime: Date.now() });
    setActiveTaskNotes(task.notes || '');
  };

  const handleTakeBreak = async () => {
    if (activeTask) await handleStopTask();
    const endTime = Date.now();
    const segment = endTime - (activeShift.lastResumeTime || activeShift.clockInTime);
    await updateDoc(doc(db, 'timesheets', activeShift.id), { status: 'break', totalSavedDuration: (activeShift.totalSavedDuration || 0) + segment, lastResumeTime: endTime });
  };

  const handleEndBreak = async () => {
    await updateDoc(doc(db, 'timesheets', activeShift.id), { status: 'active', lastResumeTime: Date.now() });
  };

  const handleClockOut = async () => {
    if (policy.requireClockOutNote && (!activeTaskNotes || activeTaskNotes.trim() === '')) {
      window.alert('Please add a brief note before clocking out.');
      return;
    }
    if (activeTask) await handleStopTask();
    const endTime = Date.now();
    let newTotal = activeShift.totalSavedDuration || 0;
    if (activeShift.status === 'active') newTotal += endTime - (activeShift.lastResumeTime || activeShift.clockInTime);
    await updateDoc(doc(db, 'timesheets', activeShift.id), { clockOutTime: endTime, status: 'completed', totalSavedDuration: newTotal, duration: newTotal });
  };

  // Smart Extract from HubSpot Notes
  const extractFromNotes = () => {
    const text = manualTaskValues.notes;
    if (!text) return;
    
    let extractedHours = 0;
    let extractedCost = 0;
    const timeRegex = /(\d+(?:\.\d+)?)\s*(hr|hrs|hour|hours|min|mins|minute|minutes)/gi;
    const costRegex = /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g;

    let timeMatch;
    while ((timeMatch = timeRegex.exec(text)) !== null) {
        const val = parseFloat(timeMatch[1]);
        const unit = timeMatch[2].toLowerCase();
        if (unit.startsWith('hr') || unit.startsWith('hour')) extractedHours += val;
        else if (unit.startsWith('min')) extractedHours += val / 60;
    }

    let costMatch;
    while ((costMatch = costRegex.exec(text)) !== null) {
        extractedCost += parseFloat(costMatch[1].replace(/,/g, ''));
    }

    const hrs = Math.floor(extractedHours);
    const mins = Math.round((extractedHours - hrs) * 60);

    setManualTaskValues(prev => ({
        ...prev,
        hours: hrs || prev.hours,
        minutes: mins || prev.minutes,
        parsedExpense: extractedCost || prev.parsedExpense
    }));
  };

  const saveManualTask = async () => {
    if (!manualTaskValues.clientName || !manualTaskValues.date || !manualTaskValues.employeeName || !manualTaskValues.billingTarget) return alert("Fill required fields");
    
    const isProject = manualTaskValues.billingTarget.startsWith('project_');
    const targetId = isProject ? manualTaskValues.billingTarget.replace('project_', '') : null;
    const projName = isProject ? 'Custom Project' : manualTaskValues.billingTarget.replace('retainer_', '');

    const startMs = new Date(manualTaskValues.date).getTime();
    const durationMs = ((Number(manualTaskValues.hours) || 0) * 3600000) + ((Number(manualTaskValues.minutes) || 0) * 60000);
    const endMs = startMs + durationMs;

    const shiftDoc = await addDoc(collection(db, 'timesheets'), {
      employeeName: manualTaskValues.employeeName, clockInTime: startMs, clockOutTime: endMs, duration: durationMs, totalSavedDuration: durationMs, status: 'completed', userId: 'manual', isManual: true
    });

    await addDoc(collection(db, 'taskLogs'), {
      shiftId: shiftDoc.id, userId: 'manual', clientName: manualTaskValues.clientName, 
      projectName: projName, projectId: targetId,
      clockInTime: startMs, clockOutTime: endMs, duration: durationMs, totalSavedDuration: durationMs, status: 'completed', notes: manualTaskValues.notes
    });

    if (manualTaskValues.parsedExpense > 0) {
      const clientObj = clients.find(c => c.name === manualTaskValues.clientName);
      const rawAmount = manualTaskValues.parsedExpense;
      const isDollar = isDollarCategory(clientObj, projName);
      const finalCost = isDollar ? rawAmount : rawAmount * 1.30;
      const rate = clientObj?.hourlyRate || 0;
      const equivalentHours = isDollar ? 0 : rate > 0 ? (finalCost / rate) : 0;

      await addDoc(collection(db, 'expenses'), {
        clientId: clientObj?.id || 'manual',
        clientName: manualTaskValues.clientName,
        category: projName,
        projectId: targetId,
        description: 'Auto-extracted from notes',
        rawAmount,
        finalCost,
        equivalentHours,
        date: startMs,
      });
    }

    setManualTaskModal(false);
    setManualTaskValues({ clientName: '', billingTarget: '', date: '', hours: '', minutes: '', notes: '', employeeName: user.displayName || user.email, parsedExpense: 0 });
  };

  const saveExpense = async () => {
    if (!expenseValues.amount || !expenseValues.billingTarget) return;

    const isProject = expenseValues.billingTarget.startsWith('project_');
    const targetId = isProject ? expenseValues.billingTarget.replace('project_', '') : null;
    const catName = isProject ? 'Custom Project' : expenseValues.billingTarget.replace('retainer_', '');

    const currency = expenseValues.currency || 'CAD';
    const rateToCad = FX_TO_CAD[currency] ?? 1;
    const amountInOriginalCurrency = Number(expenseValues.amount);
    const amountCad = amountInOriginalCurrency * rateToCad;

    const isDollar = isDollarCategory(expenseModal, catName);
    const applyMarkup = expenseValues.applyMarkup !== false && !isDollar;
    const rawAmount = amountCad;
    const finalCost = applyMarkup ? amountCad * 1.30 : amountCad;
    const clientRate = expenseModal.hourlyRate || 0;
    const equivalentHours = isDollar ? 0 : clientRate > 0 ? (finalCost / clientRate) : 0;
    const expenseDate = expenseValues.date
      ? (() => {
          const [y, m, d] = expenseValues.date.split('-').map(Number);
          return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
        })()
      : Date.now();
    const expenseDateObj = new Date(expenseDate);
    const recurrenceMode = String(expenseValues.recurrenceMode || 'none');
    const recurrence =
      recurrenceMode === 'monthly'
        ? { type: 'monthly_fixed_day', dayOfMonth: expenseDateObj.getDate() }
        : recurrenceMode === 'annual'
          ? {
              type: 'annual_fixed',
              month: expenseDateObj.getMonth(),
              day: expenseDateObj.getDate(),
            }
          : null;
    const recurring = !!recurrence;
    const recurringId = recurring
      ? `expense_recurring_${Date.now()}_${Math.random().toString(36).slice(2)}`
      : null;

    await addDoc(collection(db, 'expenses'), {
      clientId: expenseModal.id,
      clientName: expenseModal.name,
      category: catName,
      projectId: targetId,
      description: expenseValues.description,
      rawAmount,
      finalCost,
      equivalentHours,
      date: expenseDate,
      originalCurrency: currency,
      originalAmount: amountInOriginalCurrency,
      recurring,
      recurringId,
      recurrence,
    });
    setExpenseModal(null);
    setExpenseValues({
      billingTarget: '',
      description: '',
      amount: '',
      date: '',
      currency: 'CAD',
      applyMarkup: true,
      recurrenceMode: 'none',
    });
  };

  const logSocialAdSpend = async ({ clientId, clientName, amount, description }) => {
    const amt = Number(amount);
    if (!clientId || !clientName || !Number.isFinite(amt) || amt <= 0) return;
    const finalCost = amt;
    const rawAmount = amt;
    await addDoc(collection(db, 'expenses'), {
      clientId,
      clientName,
      category: 'Social Ad Budget',
      projectId: null,
      description: description || 'Social ad spend (logged from kiosk)',
      rawAmount,
      finalCost,
      equivalentHours: 0,
      date: Date.now(),
    });
  };

  const logKioskClientExpense = async ({
    clientId,
    clientName,
    category,
    projectId = null,
    amount,
    description,
    currency = 'CAD',
    applyMarkup = true,
  }) => {
    const amt = Number(amount);
    if (!clientId || !clientName || !category || !Number.isFinite(amt) || amt <= 0) return;
    const fx = FX_TO_CAD[currency] ?? 1;
    const rawAmount = amt * fx;
    const clientObj = clients.find((c) => String(c.id) === String(clientId));
    const isDollar = isDollarCategory(clientObj, category);
    const shouldMarkup = applyMarkup && !isDollar;
    const finalCost = shouldMarkup ? rawAmount * 1.3 : rawAmount;
    const hourlyRate = Number(clientObj?.hourlyRate || 0);
    const equivalentHours = isDollar ? 0 : hourlyRate > 0 ? finalCost / hourlyRate : 0;

    await addDoc(collection(db, 'expenses'), {
      clientId,
      clientName,
      category,
      projectId: projectId || null,
      description: description || 'Logged from kiosk',
      rawAmount,
      finalCost,
      equivalentHours,
      date: Date.now(),
      originalCurrency: currency,
      originalAmount: amt,
    });
  };

  const submitAddonRequest = async () => {
    const hoursNum = Math.max(0, Number(addonValues.hours) || 0);
    if (!hoursNum || !addonModal) return;

    const clientId = addonModal.id;
    const clientName = addonModal.name;
    const hourlyRate = Number(addonModal.hourlyRate) || 0;

    const subtotal = hoursNum * hourlyRate;
    const hstRate = 0.13;
    const hst = subtotal * hstRate;
    const total = subtotal + hst;

    const nextCycleStart = getBillingPeriod(addonModal.billingDay || 1, 1).start;

    await addDoc(collection(db, 'addons'), {
      clientId,
      clientName,
      hours: hoursNum,
      notes: addonValues.notes,
      category: addonValues.category || 'Additional Hours',
      requestedBy: view === 'client_portal' ? 'client' : 'admin',
      billingCycleStart: nextCycleStart,
      priceBreakdown: { hourlyRate, subtotal, hstRate, hst, total },
      notificationState: {
        adminNeedsInvoice: view === 'client_portal',
        clientVisible: true,
      },
      status: 'pending',
      date: Date.now(),
    });
    setAddonModal(null);
    setAddonValues({ hours: '', notes: '', category: '' });
  };

  const submitProjectRequest = async () => {
    const clientId = projectValues.clientId || (projectModal && projectModal.id);
    const clientName = projectValues.clientName || (projectModal && projectModal.name);

    if (projectSubmitting) return;
    setProjectSubmitError('');
    setProjectSubmitting(true);
    try {
      if (view === 'client_portal') {
        if (!projectValues.category || !projectValues.requestDescription || !clientId)
          return;

        await addDoc(collection(db, 'projects'), {
          clientId,
          clientName,
          category: projectValues.category,
          requestDescription: projectValues.requestDescription,
          status: 'requested',
          invoiced: false,
          createdAt: Date.now(),
          estimate: null,
          clientDecision: null,
          notificationState: {
            adminNeedsReview: true,
            clientVisible: true,
          },
        });

        setProjectModal(null);
        setProjectBudgetOverride(false);
        setProjectValues({
          clientId: '',
          clientName: '',
          title: '',
          description: '',
          category: '',
          requestDescription: '',
          estimatedBudget: '',
          estimatedHours: '',
        });
        return;
      }

      if (!projectValues.title || !clientId) return;

      await addDoc(collection(db, 'projects'), {
        clientId,
        clientName,
        title: projectValues.title,
        description: projectValues.description,
        category: projectValues.category || null,
        requestDescription: projectValues.requestDescription || null,
        estimatedBudget: Number(projectValues.estimatedBudget) || 0,
        estimatedHours: Number(projectValues.estimatedHours) || 0,
        status: 'requested',
        invoiced: false,
        createdAt: Date.now(),
      });

      setProjectModal(null);
      setProjectBudgetOverride(false);
      setProjectValues({
        clientId: '',
        clientName: '',
        title: '',
        description: '',
        category: '',
        requestDescription: '',
        estimatedBudget: '',
        estimatedHours: '',
      });
    } catch (err) {
      setProjectSubmitError(err?.message || String(err));
    } finally {
      setProjectSubmitting(false);
    }
  };

  // Helpers
  const getShiftDuration = (shift) => {
    if (shift.status === 'completed') return shift.duration || 0;
    if (shift.status === 'break') return shift.totalSavedDuration || 0;
    return (shift.totalSavedDuration || 0) + (Date.now() - (shift.lastResumeTime || shift.clockInTime));
  };

  const getTaskDuration = (task) => {
    if (task == null || typeof task !== 'object') return 0;
    if (task.status === 'completed') return task.duration || 0;
    return (task.totalSavedDuration || 0) + (Date.now() - (task.lastResumeTime || task.clockInTime));
  };

  const formatTime = (ms) => {
    if (!ms || ms < 0) return "0h 0m";
    const totalMins = Math.floor(ms / 60000);
    return `${Math.floor(totalMins / 60)}h ${totalMins % 60}m`;
  };

  const todoCategoryKey = (cat) =>
    String(cat ?? '').replace(/[~*[\]/]/g, '_').replace(/\./g, '_');

  const computeRecurringDueDate = (recurrence, cycleStart) => {
    if (!recurrence || !recurrence.type) return null;
    const base = new Date(cycleStart);
    base.setHours(12, 0, 0, 0);
    const cycleStartMs = base.getTime();

    if (recurrence.type === 'monthly_fixed_day') {
      const day = Number(recurrence.dayOfMonth || 0);
      if (!day) return null;
      const y = base.getFullYear();
      const m = base.getMonth();
      const lastDay = new Date(y, m + 1, 0).getDate();
      const clamped = Math.min(Math.max(day, 1), lastDay);
      return new Date(y, m, clamped, 12, 0, 0, 0).getTime();
    }

    if (recurrence.type === 'weekly_weekday') {
      const wd = Number(recurrence.weekday);
      if (!Number.isFinite(wd) || wd < 0 || wd > 6) return null;
      const d = new Date(base);
      for (let step = 0; step < 7; step++) {
        if (d.getDay() === wd) return d.getTime();
        d.setDate(d.getDate() + 1);
      }
      return null;
    }

    if (recurrence.type === 'annual_fixed') {
      const month = Number(recurrence.month);
      const day = Number(recurrence.day);
      if (
        !Number.isFinite(month) ||
        month < 0 ||
        month > 11 ||
        !Number.isFinite(day) ||
        day < 1
      ) {
        return null;
      }
      const tryYear = (y) => {
        const last = new Date(y, month + 1, 0).getDate();
        const dd = Math.min(Math.max(day, 1), last);
        return new Date(y, month, dd, 12, 0, 0, 0).getTime();
      };
      let t = tryYear(base.getFullYear());
      if (t < cycleStartMs) t = tryYear(base.getFullYear() + 1);
      return t;
    }

    return null;
  };

  const carryoverCategoryKey = (cat) =>
    String(cat ?? '').replace(/[~*[\]/]/g, '_').replace(/\./g, '_');

  const getTodoStateForCycle = (client, cycleStart) => {
    const cycles = client.todoCycles || {};
    const existing = cycles[String(cycleStart)];
    if (existing) return existing;
    const currentCycleStart = getBillingPeriod(client.billingDay || 1, 0).start;
    if (cycleStart !== currentCycleStart) return {};
    const prevStart = getBillingPeriod(client.billingDay || 1, -1).start;
    const prevData = cycles[String(prevStart)] || {};
    // Carry over *all* previously-existing category keys (including custom project
    // task categories), not just retainer categories + General.
    const categoryKeys = new Set([
      ...Object.keys(client.retainers || {}).map((cat) => todoCategoryKey(cat)),
      todoCategoryKey(GENERAL_LABEL),
      ...Object.keys(prevData),
    ]);
    const result = {};
    Array.from(categoryKeys).forEach((ck) => {
      const prevCat = prevData[ck];
      const prevItems = prevCat?.items || [];
      const carried = prevItems
        // Carry forward all unfinished items, including unfinished recurring
        // iterations, so overdue recurring instances remain visible.
        .filter((i) => !i.done)
        .map((i) => ({
          ...i,
          done: false,
          pinned: false,
          assigneeEmails: Array.isArray(i.assigneeEmails)
            ? i.assigneeEmails.filter(Boolean)
            : [],
        }));
      // Create exactly one new iteration per recurring series (recurringId).
      // If multiple old unfinished recurring items exist, we still add only one
      // new item for the next cycle while preserving all unfinished carryovers.
      const recurringSeeds = Array.from(
        prevItems
          .filter((i) => !!i.recurring)
          .reduce((acc, i) => {
            const rid = String(i.recurringId || i.id || '');
            if (!rid) return acc;
            if (!acc.has(rid)) acc.set(rid, i);
            return acc;
          }, new Map())
          .values(),
      );
      const recurring = recurringSeeds.map((i) => {
          const effectiveRecurrence =
            i.recurrence ||
            (i.dueDate
              ? {
                  type: 'monthly_fixed_day',
                  dayOfMonth: new Date(i.dueDate).getDate(),
                }
              : null);
          return {
            id: `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            text: i.text,
            done: false,
            doneAt: null,
            pinned: false,
            recurring: true,
            recurringId: i.recurringId || i.id,
            assigneeEmails: Array.isArray(i.assigneeEmails)
              ? i.assigneeEmails.filter(Boolean)
              : [],
            recurrence: i.recurrence || effectiveRecurrence,
            dueDate: computeRecurringDueDate(effectiveRecurrence, cycleStart),
          };
        });
      result[ck] = { closed: false, items: [...carried, ...recurring] };
    });
    return result;
  };

  const ensureCurrentCycleTodoData = (client, cycleStart) => {
    const cycles = { ...(client.todoCycles || {}) };
    const currentCycleStart = getBillingPeriod(client.billingDay || 1, 0).start;
    if (cycleStart !== currentCycleStart) return cycles;
    if (cycles[String(cycleStart)]) return cycles;
    const prevStart = getBillingPeriod(client.billingDay || 1, -1).start;
    const prevData = cycles[String(prevStart)] || {};
    // Ensure we create the current-cycle objects for any category keys that
    // existed in the previous cycle (again, includes custom project to-dos).
    const categoryKeys = new Set([
      ...Object.keys(client.retainers || {}).map((cat) => todoCategoryKey(cat)),
      todoCategoryKey(GENERAL_LABEL),
      ...Object.keys(prevData),
    ]);
    cycles[String(cycleStart)] = {};
    Array.from(categoryKeys).forEach((ck) => {
      const prevCat = prevData[ck];
      const prevItems = prevCat?.items || [];
      const carried = prevItems
        // Carry forward all unfinished items, including unfinished recurring
        // iterations, so overdue recurring instances remain visible.
        .filter((i) => !i.done)
        .map((i) => ({
          ...i,
          done: false,
          pinned: false,
          assigneeEmails: Array.isArray(i.assigneeEmails)
            ? i.assigneeEmails.filter(Boolean)
            : [],
        }));
      // Create exactly one new iteration per recurring series (recurringId).
      const recurringSeeds = Array.from(
        prevItems
          .filter((i) => !!i.recurring)
          .reduce((acc, i) => {
            const rid = String(i.recurringId || i.id || '');
            if (!rid) return acc;
            if (!acc.has(rid)) acc.set(rid, i);
            return acc;
          }, new Map())
          .values(),
      );
      const recurring = recurringSeeds.map((i) => {
          const effectiveRecurrence =
            i.recurrence ||
            (i.dueDate
              ? {
                  type: 'monthly_fixed_day',
                  dayOfMonth: new Date(i.dueDate).getDate(),
                }
              : null);
          return {
            id: `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            text: i.text,
            done: false,
            doneAt: null,
            pinned: false,
            recurring: true,
            recurringId: i.recurringId || i.id,
            assigneeEmails: Array.isArray(i.assigneeEmails)
              ? i.assigneeEmails.filter(Boolean)
              : [],
            recurrence: i.recurrence || effectiveRecurrence,
            dueDate: computeRecurringDueDate(effectiveRecurrence, cycleStart),
          };
        });
      cycles[String(cycleStart)][ck] = { closed: false, items: [...carried, ...recurring] };
    });
    return cycles;
  };

  const updateClientTodo = async (client, cycleStart, categoryKey, nextCategoryData) => {
    const cycles = ensureCurrentCycleTodoData(client, cycleStart);
    const cycleData = cycles[String(cycleStart)] || {};
    cycles[String(cycleStart)] = { ...cycleData, [categoryKey]: nextCategoryData };
    const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(client, cycles);
    await updateDoc(doc(db, 'clients', client.id), { todoCycles: cycles, ...teamAccessPatch });
  };

  // Batch update multiple to-do categories in a single Firestore write.
  // This is important because calling `updateClientTodo` multiple times in a row
  // would otherwise overwrite earlier category updates based on stale client state.
  const updateClientTodosBatch = async (client, cycleStart, categoryKeyToData) => {
    const cycles = ensureCurrentCycleTodoData(client, cycleStart);
    const cycleData = cycles[String(cycleStart)] || {};
    cycles[String(cycleStart)] = {
      ...cycleData,
      ...categoryKeyToData,
    };
    const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(client, cycles);
    await updateDoc(doc(db, 'clients', client.id), { todoCycles: cycles, ...teamAccessPatch });
  };

  // Dynamic Billing Period & Global Carryover Logic
  const getBillingPeriod = (billingDay = 1, offsetMonths = 0) => {
    const now = new Date();
    let currentMonth = now.getMonth();
    let currentYear = now.getFullYear();

    if (now.getDate() < billingDay) currentMonth--;
    currentMonth += offsetMonths;

    while (currentMonth < 0) { currentMonth += 12; currentYear--; }
    while (currentMonth > 11) { currentMonth -= 12; currentYear++; }

    const start = new Date(currentYear, currentMonth, billingDay, 0, 0, 0, 0).getTime();
    
    let nextMonth = currentMonth + 1;
    let nextYear = currentYear;
    if (nextMonth > 11) { nextMonth = 0; nextYear++; }
    const end = new Date(nextYear, nextMonth, billingDay - 1, 23, 59, 59, 999).getTime();

    return { start, end };
  };

  const getPeriodsPassed = (firstDateMs, currentDateMs, billingDay) => {
    const first = new Date(firstDateMs);
    const current = new Date(currentDateMs);

    let firstMonth = first.getMonth();
    let firstYear = first.getFullYear();
    if (first.getDate() < billingDay) {
        firstMonth--;
        if(firstMonth < 0) { firstMonth = 11; firstYear--; }
    }

    let currentMonth = current.getMonth();
    let currentYear = current.getFullYear();
    if (current.getDate() < billingDay) {
        currentMonth--;
        if(currentMonth < 0) { currentMonth = 11; currentYear--; }
    }

    const monthsDiff = (currentYear - firstYear) * 12 + (currentMonth - firstMonth);
    return Math.max(0, monthsDiff);
  };

  const getGlobalRetainerStats = (client, mStart, mEnd) => {
    // Retainers pool math is in hours (task/expense equivalent hours). We exclude
    // dollar-only categories from the combined pool so the existing progress bars remain consistent.
    const hourRetainerBase = Object.entries(client.retainers || {}).reduce(
      (sum, [cat, val]) => (isDollarCategory(client, cat) ? sum : sum + (Number(val) || 0)),
      0,
    );
    
    const clientStartMs = client.clientStartDate || 0;
    const globalResetMs = client.lastCarryoverResetDate || 0;
    const perCategoryReset = client.carryoverResetByCategory || {};

    const pastAddons = addons
      .filter((a) => a.clientId === client.id && a.date < mStart)
      .filter((a) => !clientStartMs || a.date >= clientStartMs)
      .filter((a) => !globalResetMs || a.date >= globalResetMs);
    const pastAddonHours = pastAddons.reduce(
      (acc, a) => acc + Number(a.hours || 0),
      0,
    );

    const hourCategories = Object.keys(client.retainers || {}).filter(
      (cat) => !isDollarCategory(client, cat),
    );

    let carryover = 0;
    hourCategories.forEach((cat) => {
      const catResetMs = Number(
        perCategoryReset[carryoverCategoryKey(cat)] || 0,
      );
      const effectiveResetMs = Math.max(globalResetMs, catResetMs);

      let pastTasksCat = taskLogs.filter(
        (t) =>
          t.clientName === client.name &&
          t.clockInTime < mStart &&
          !t.projectId &&
          t.projectName === cat,
      );
      let pastExpsCat = expenses.filter(
        (e) =>
          e.clientName === client.name &&
          e.date < mStart &&
          !e.projectId &&
          e.category === cat,
      );

      if (clientStartMs) {
        pastTasksCat = pastTasksCat.filter((t) => t.clockInTime >= clientStartMs);
        pastExpsCat = pastExpsCat.filter((e) => e.date >= clientStartMs);
      }
      if (effectiveResetMs) {
        pastTasksCat = pastTasksCat.filter(
          (t) => t.clockInTime >= effectiveResetMs,
        );
        pastExpsCat = pastExpsCat.filter((e) => e.date >= effectiveResetMs);
      }

      const firstTaskTime =
        pastTasksCat.length > 0
          ? Math.min(...pastTasksCat.map((t) => t.clockInTime))
          : null;
      const firstExpTime =
        pastExpsCat.length > 0
          ? Math.min(...pastExpsCat.map((e) => e.date))
          : null;

      let firstDateMs = null;
      if (firstTaskTime && firstExpTime) firstDateMs = Math.min(firstTaskTime, firstExpTime);
      else if (firstTaskTime) firstDateMs = firstTaskTime;
      else if (firstExpTime) firstDateMs = firstExpTime;

      if (effectiveResetMs) {
        firstDateMs = firstDateMs
          ? Math.max(firstDateMs, effectiveResetMs)
          : effectiveResetMs;
      }
      if (clientStartMs && firstDateMs !== null) {
        firstDateMs = Math.max(firstDateMs, clientStartMs);
      } else if (clientStartMs) {
        firstDateMs = clientStartMs;
      }

      if (!firstDateMs) return;

      const periodsPassed = getPeriodsPassed(
        firstDateMs,
        mStart,
        client.billingDay || 1,
      );
      const base = Number(client.retainers?.[cat] || 0);
      const totalAllottedPast = periodsPassed * base;
      const pastTaskHours =
        pastTasksCat.reduce((acc, t) => acc + getTaskDuration(t), 0) / 3600000;
      const pastExpHours = pastExpsCat.reduce(
        (acc, e) => acc + Number(e.equivalentHours || 0),
        0,
      );

      carryover += totalAllottedPast - (pastTaskHours + pastExpHours);
    });

    // Keep historical Add Hours behavior as a global carryover contributor.
    carryover += pastAddonHours;

    const currentTasks = taskLogs.filter(t => t.clientName === client.name && t.clockInTime >= mStart && t.clockInTime <= mEnd && !t.projectId);
    const currentExps = expenses.filter(e => e.clientName === client.name && e.date >= mStart && e.date <= mEnd && !e.projectId);
    const currentAddons = addons.filter(a => a.clientId === client.id && a.date >= mStart && a.date <= mEnd);

    // Exclude in-progress task from totals so the kiosk can add live time once via activeDeltaHours (avoids double-counting).
    const completedTasksThisCycle = currentTasks.filter((t) => t.status !== 'active');
    const currentTaskHours = completedTasksThisCycle.reduce((acc, t) => acc + getTaskDuration(t), 0) / 3600000;
    const currentExpHours = currentExps.reduce((acc, e) => acc + (e.equivalentHours || 0), 0);
    const currentAddonHours = currentAddons.reduce((acc, a) => acc + Number(a.hours), 0);

    const currentUsed = currentTaskHours + currentExpHours;
    const activeBase = client.status === 'paused' ? 0 : hourRetainerBase;
    const adjustedAllotted = activeBase + carryover + currentAddonHours;

    const categoryBreakdown = {};

    // Hours-based categories (from completed tasks only; active task live time is added in kiosk via activeDeltaHours).
    completedTasksThisCycle.reduce((acc, t) => {
      if (t.projectName === GENERAL_LABEL) return acc;
      acc[t.projectName] = (acc[t.projectName] || 0) + (getTaskDuration(t) / 3600000);
      return acc;
    }, categoryBreakdown);

    // Dollar categories use finalCost; hour categories use equivalentHours.
    currentExps.forEach((e) => {
      if (!e.category || !client.retainers) return;
      if (isDollarCategory(client, e.category)) {
        categoryBreakdown[e.category] = (categoryBreakdown[e.category] || 0) + (Number(e.finalCost) || 0);
      } else {
        categoryBreakdown[e.category] = (categoryBreakdown[e.category] || 0) + (Number(e.equivalentHours) || 0);
      }
    });

    return {
        base: activeBase,
        carryover,
        currentAddons: currentAddonHours,
        adjustedAllotted,
        currentUsed,
        isOver: currentUsed > adjustedAllotted,
        percent: adjustedAllotted > 0 ? Math.min(Math.max((currentUsed / adjustedAllotted) * 100, 0), 100) : (currentUsed > 0 ? 100 : 0),
        categoryBreakdown,
    };
  };

  // Export Logic & Filtering
  const getDateRange = () => {
    const now = new Date();
    let start, end;
    if (dateFilterType === 'day') { start = new Date(now.setHours(0,0,0,0)).getTime(); end = new Date(now.setHours(23,59,59,999)).getTime(); } 
    else if (dateFilterType === 'week') {
      const day = now.getDay(); const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now.setDate(diffToMonday)); start = new Date(monday.setHours(0,0,0,0)).getTime();
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); end = new Date(sunday.setHours(23,59,59,999)).getTime();
    } 
    else if (dateFilterType === 'month') { start = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime(); } 
    else if (dateFilterType === 'custom' && customDateRange.start && customDateRange.end) { start = new Date(customDateRange.start).getTime(); end = new Date(customDateRange.end).setHours(23,59,59,999); } 
    else return { start: null, end: null };
    return { start, end };
  };

  const currentRange = getDateRange();
  const filteredTimesheets = timesheets.filter(shift => {
    const matchesSearch = searchQuery === '' || shift.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) || taskLogs.some(t => t.shiftId === shift.id && t.clientName.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesClient = clientFilter === '' || taskLogs.some(t => t.shiftId === shift.id && t.clientName === clientFilter);
    let matchesDate = true;
    if (currentRange.start && currentRange.end) matchesDate = shift.clockInTime >= currentRange.start && shift.clockInTime <= currentRange.end;
    return matchesSearch && matchesClient && matchesDate;
  });

  const toggleShiftAccordion = (shiftId) => { setExpandedShifts(prev => ({ ...prev, [shiftId]: !prev[shiftId] })); };
  const toggleClientAccordion = (clientId) => { setExpandedClients(prev => ({ ...prev, [clientId]: !prev[clientId] })); };

  const startEditing = (type, item) => {
    setEditingItem({ type, id: item.id });
    const clockInDate = new Date(item.clockInTime).toISOString().slice(0, 16);
    const clockOutDate = item.clockOutTime ? new Date(item.clockOutTime).toISOString().slice(0, 16) : '';
    if (type === 'shift') {
      setEditValues({ ...item, clockInDate, clockOutDate });
      return;
    }
    const billingTarget = item.projectId
      ? `project_${item.projectId}`
      : `retainer_${item.projectName || ''}`;
    setEditValues({
      ...item,
      clockInDate,
      clockOutDate,
      billingTarget,
      clientName: item.clientName || '',
    });
  };

  const saveEdit = async () => {
    if (editingItem.type === 'task' && (!editValues.clientName || !editValues.billingTarget)) {
      window.alert('Please select both Client and Billing Target for the task.');
      return;
    }
    const coll = editingItem.type === 'shift' ? 'timesheets' : 'taskLogs';
    const updates = { ...editValues };
    updates.clockInTime = new Date(editValues.clockInDate).getTime();

    if (editValues.clockOutDate) {
      updates.clockOutTime = new Date(editValues.clockOutDate).getTime();
      updates.duration = updates.clockOutTime - updates.clockInTime;
      updates.totalSavedDuration = updates.duration;
    }

    if (editingItem.type === 'task') {
      const clientName = updates.clientName || '';
      const client = clients.find((c) => c.name === clientName);
      updates.clientId = client?.id ?? null;
      updates.clientName = clientName;
      const bt = updates.billingTarget || '';
      if (bt.startsWith('project_')) {
        updates.projectId = bt.replace('project_', '');
        const proj = projects.find((p) => p.id === updates.projectId);
        updates.projectName = proj ? proj.title : 'Custom Project';
      } else {
        updates.projectId = null;
        updates.projectName = bt.replace('retainer_', '') || GENERAL_LABEL;
      }
    }

    delete updates.clockInDate;
    delete updates.clockOutDate;
    delete updates.billingTarget;
    delete updates.id;

    await updateDoc(doc(db, coll, editingItem.id), updates);
    setEditingItem(null);
  };

  const exportCSV = () => {
    let rows = [["Employee", "Date", "Client", "Task Type", "Start", "End", "Duration", "Notes"]];
    filteredTimesheets.forEach(shift => {
      const shiftDate = new Date(shift.clockInTime).toLocaleDateString();
      const tasks = taskLogs.filter(t => t.shiftId === shift.id);
      
      if (tasks.length === 0) {
        rows.push([
          shift.employeeName, shiftDate, "N/A", "General Shift",
          new Date(shift.clockInTime).toLocaleTimeString(),
          shift.clockOutTime ? new Date(shift.clockOutTime).toLocaleTimeString() : "Active",
          formatTime(getShiftDuration(shift)), ""
        ]);
      } else {
        tasks.forEach(t => {
          if (clientFilter && t.clientName !== clientFilter) return; 
          rows.push([
            shift.employeeName, shiftDate, t.clientName, t.projectName,
            new Date(t.clockInTime).toLocaleTimeString(),
            t.clockOutTime ? new Date(t.clockOutTime).toLocaleTimeString() : "Active",
            formatTime(getTaskDuration(t)),
            t.notes ? `"${t.notes.replace(/"/g, '""')}"` : ""
          ]);
        });
      }
    });

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Ignite_Report_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
  };

  const exportPDF = () => {
    const printWindow = window.open('', '_blank');
    let html = `
      <html>
        <head>
          <title>Ignite PM Timesheet Report</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #333; }
            h2 { color: #fd7414; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            .meta { color: #666; margin-bottom: 30px; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #f8fafc; font-weight: bold; color: #475569; }
            tr:nth-child(even) { background-color: #fcfcfc; }
            .shift-row { background-color: #f1f5f9 !important; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>Ignite PM Timesheet Report</h2>
          <div class="meta">
            Generated on: ${new Date().toLocaleString()}<br/>
            Filter: ${dateFilterType.toUpperCase()} | Client: ${clientFilter || 'All'}
          </div>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Client / Task</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
    `;

    filteredTimesheets.forEach(shift => {
      const tasks = taskLogs.filter(t => t.shiftId === shift.id);
      
      html += `
        <tr class="shift-row">
          <td>${shift.employeeName}</td>
          <td>${new Date(shift.clockInTime).toLocaleDateString()}</td>
          <td colspan="3"><strong>Total Shift Time</strong></td>
          <td>${formatTime(getShiftDuration(shift))}</td>
        </tr>
      `;

      if (tasks.length > 0) {
        tasks.forEach(t => {
          if (clientFilter && t.clientName !== clientFilter) return;
          html += `
            <tr>
              <td></td>
              <td></td>
              <td>${t.clientName} - ${t.projectName}<br/><small style="color:#666">${t.notes || ''}</small></td>
              <td>${new Date(t.clockInTime).toLocaleTimeString()}</td>
              <td>${t.clockOutTime ? new Date(t.clockOutTime).toLocaleTimeString() : 'Active'}</td>
              <td>${formatTime(getTaskDuration(t))}</td>
            </tr>
          `;
        });
      }
    });

    html += `</tbody></table></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  // Render Checks
  if (loading || (user && !adminDocReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b1120]">
        <RotateCw className="w-8 h-8 text-[#fd7414] animate-spin" />
      </div>
    );
  }

  // Global Auth Gate
  if (
    user &&
    !isUserAdmin &&
    !isClientUser &&
    !user.email.endsWith('@ignitepm.com') &&
    !(ENABLE_DEMOS && (user.uid === 'demo-user-123' || user.uid === 'demo-client-123'))
  ) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b1120] p-6">
        <div className="bg-white p-12 rounded-[40px] shadow-2xl border border-slate-100 text-center max-w-sm w-full">
          <Shield className="w-16 h-16 text-red-500 mx-auto mb-6" />
          <h2 className="text-2xl font-black mb-2">Access Denied</h2>
          <p className="text-slate-500 text-sm mb-6 font-medium">Your account ({user.email}) is not authorized. Please contact an administrator.</p>
          <button onClick={() => { setUser(null); signOut(auth); }} className="w-full bg-slate-100 text-slate-600 p-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-200 transition-all">Sign Out</button>
        </div>
      </div>
    );
  }

  // --- LOGIN SCREEN ---
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b1120] p-6">
        <div className="bg-white p-10 rounded-[40px] shadow-2xl border border-slate-100 flex flex-col items-center max-w-sm w-full text-center">
          <div className="w-28 h-28 mb-4 flex items-center justify-center"><IgniteLogo className="w-full h-full object-contain" /></div>
          <h1 className="text-3xl font-black text-slate-900 mb-1 tracking-tight">Ignite PM</h1>
          <p className="text-slate-400 font-bold mb-6 uppercase tracking-widest text-[10px]">Internal Workspace TimeTracker</p>
          
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 font-bold">{error}</div>}
          
          <form onSubmit={handleEmailAuth} className="w-full space-y-3 mb-4 text-left">
            <input type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" required />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" required />
            
            <button type="submit" className="w-full bg-[#fd7414] text-white py-4 rounded-2xl font-black transition-all shadow-lg hover:bg-[#e66a12] active:scale-95 text-lg">
              {isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="flex flex-col gap-2 justify-center items-center w-full px-2 mb-6">
            <button onClick={() => setIsSignUp(!isSignUp)} className="text-xs font-bold text-slate-500 hover:text-[#fd7414] transition-colors">
              {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
            </button>
            {!isSignUp && (
              <button type="button" onClick={handleResetPassword} className="text-xs font-bold text-slate-500 hover:text-[#fd7414] transition-colors">
                Forgot Password?
              </button>
            )}
          </div>

          <div className="relative w-full flex items-center justify-center mb-6">
            <div className="border-t border-slate-200 w-full"></div>
            <span className="bg-white px-3 text-[10px] font-black uppercase text-slate-300 absolute">OR</span>
          </div>

          <div className="w-full space-y-3">
            <button onClick={loginWithGoogle} type="button" className="w-full bg-black text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-lg active:scale-95">
              Sign in with Google Workspace
            </button>
            {ENABLE_DEMOS && (
              <div className="flex gap-2">
                <button onClick={enterDemoMode} type="button" className="flex-1 bg-slate-100 text-slate-500 py-3 rounded-2xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all">Admin Demo</button>
                <button onClick={enterClientDemo} type="button" className="flex-1 bg-slate-100 text-slate-500 py-3 rounded-2xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all">Client Demo</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const kioskRouteProps = {
    user,
    activeShift,
    activeTask,
    liveDuration,
    liveTaskDuration,
    clients: clients.filter(
      (c) => !c.archived && c.status !== 'paused',
    ),
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
    clientsFull: clients,
    getBillingPeriod,
    taskLogs,
    handleClockIn,
    handleEndBreak,
    handleStartTask,
    handleStopTask,
    handleResumeTask,
    handleTakeBreak,
    handleClockOut,
    getGlobalRetainerStats: (client, start, end) =>
      getGlobalRetainerStats(client, start, end),
    formatTime,
    onLogSocialAdSpend: logSocialAdSpend,
    onLogClientExpense: logKioskClientExpense,
    getTodoStateForCycle,
    updateClientTodo,
    todoCategoryKey,
    projects,
    queueKioskTaskStart,
  };

  const adminDashboardBaseProps = {
    adminTab,
    setAdminTab,
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
    setProjectValues,
    setEditingClient,
    setDeleteConfirm,
    startEditing,
    activeTaskTypes,
    getBillingPeriod,
    getShiftDuration,
    getTaskDuration,
    formatTime,
    getGlobalRetainerStats: (client, start, end) =>
      getGlobalRetainerStats(client, start, end),
    exportCSV,
    exportPDF,
    addDoc,
    setDoc,
    collection: (coll) => collection(db, coll),
    updateDoc,
    doc: (coll, id) => doc(db, coll, id),
    logAudit,
    policy,
    getTodoStateForCycle,
    updateClientTodo,
    updateClientTodosBatch,
    todoCategoryKey,
    userTodos,
    updateUserTodos,
    updatePolicy,
    navigateToKioskWithTask: (clientName, billingTarget) =>
      navigate(
        `/kiosk?autostart=1&client=${encodeURIComponent(clientName)}&target=${encodeURIComponent(billingTarget)}`,
      ),
  };

  const adminDashboardRouteProps = {
    ...adminDashboardBaseProps,
    adminBasePath: '/admin',
    dashboardTitle: 'Admin',
  };

  const workspaceDashboardRouteProps = {
    ...adminDashboardBaseProps,
    adminBasePath: '/workspace',
    dashboardTitle: 'Workspace',
  };

  const content =
    view === 'client_portal' && clientProfile ? (
      <ClientPortal
        clientProfile={clientProfile}
        portalOffset={portalOffset}
        setPortalOffset={setPortalOffset}
        taskLogs={taskLogs}
        expenses={expenses}
        projects={projects}
        addons={addons}
        getBillingPeriod={getBillingPeriod}
        getGlobalRetainerStats={(client, start, end) =>
          getGlobalRetainerStats(client, start, end)
        }
        formatTime={formatTime}
        getTaskDuration={getTaskDuration}
        getTodoStateForCycle={getTodoStateForCycle}
        todoCategoryKey={todoCategoryKey}
        setAddonModal={setAddonModal}
        setProjectModal={setProjectModal}
        updateProject={(projectId, data) =>
          updateDoc(doc(db, 'projects', projectId), data)
        }
        logAudit={logAudit}
        setUser={setUser}
        signOut={signOut}
        auth={auth}
      />
    ) : (
      <div className="min-h-screen bg-[#0b1120] text-slate-900 font-sans">
        <nav className="bg-white border-b border-slate-100 p-4 sticky top-0 z-40 shadow-sm">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <div
              className="flex items-center gap-2 group cursor-pointer"
              onClick={() => navigate('/kiosk')}
            >
              <div className="w-10 h-10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <IgniteLogo className="w-full h-full object-contain" />
              </div>
              <span className="font-black text-xl tracking-tighter hidden sm:inline">
                TimeTracker
              </span>
            </div>

          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
              <button
                onClick={() => navigate('/kiosk')}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  view === 'employee'
                    ? 'bg-white shadow-md text-[#fd7414]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Kiosk
              </button>
            {currentUserRole === 'kiosk' ? (
              <button
                onClick={() => navigate('/workspace')}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  view === 'admin'
                    ? 'bg-white shadow-md text-[#fd7414]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Workspace
              </button>
            ) : (
              <button
                onClick={() => navigate('/admin')}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  view === 'admin'
                    ? 'bg-white shadow-md text-[#fd7414]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Admin
              </button>
            )}
              <button
                onClick={() => {
                  setUser(null);
                  signOut(auth);
                }}
                className="ml-2 p-2 text-slate-300 hover:text-red-500 transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto p-6 pb-24">
          <Routes>
            <Route path="/" element={<Navigate to="/kiosk" replace />} />
            <Route path="/kiosk" element={<KioskRouteView {...kioskRouteProps} />} />
            <Route
              path="/admin"
              element={
                currentUserRole === 'kiosk' ? (
                  <Navigate to="/workspace" replace />
                ) : (
                  <AdminDashboardRouteView
                    adminDashboardProps={adminDashboardRouteProps}
                    navigate={navigate}
                  />
                )
              }
            />
            <Route
              path="/admin/clients/:clientId"
              element={
                currentUserRole === 'kiosk' ? (
                  <RedirectKioskAdminClientToWorkspace />
                ) : (
                  <AdminDashboardRouteView
                    adminDashboardProps={adminDashboardRouteProps}
                    navigate={navigate}
                  />
                )
              }
            />
            <Route
              path="/workspace"
              element={
                currentUserRole === 'kiosk' ? (
                  <AdminDashboardRouteView
                    adminDashboardProps={workspaceDashboardRouteProps}
                    navigate={navigate}
                  />
                ) : (
                  <Navigate to="/admin" replace />
                )
              }
            />
            <Route
              path="/workspace/clients/:clientId"
              element={
                currentUserRole === 'kiosk' ? (
                  <AdminDashboardRouteView
                    adminDashboardProps={workspaceDashboardRouteProps}
                    navigate={navigate}
                  />
                ) : (
                  <RedirectStaffWorkspaceClientToAdmin />
                )
              }
            />
            <Route path="*" element={<Navigate to="/kiosk" replace />} />
          </Routes>
        </main>
      </div>
    );

  // --- MAIN APP RENDER (ALL VIEWS) ---
  return (
    <>
      {content}

      {/* --- ALL MODALS BELOW --- */}

      {/* Manual Task Modal with SMART EXTRACT */}
      {manualTaskModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div className="bg-white rounded-[32px] w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
              <div>
                <h3 className="font-black text-2xl text-slate-900">Log Manual Task</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Import from Hubspot / Past Work</p>
              </div>
              <button onClick={() => setManualTaskModal(false)} className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-8 space-y-5 overflow-y-auto text-left">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1 space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Client</label>
                  <select value={manualTaskValues.clientName} onChange={e => setManualTaskValues({...manualTaskValues, clientName: e.target.value, billingTarget: ''})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]">
                    <option value="">Select Client...</option>
                    {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-1 space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Billing Target</label>
                  <select value={manualTaskValues.billingTarget} onChange={e => setManualTaskValues({...manualTaskValues, billingTarget: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]">
                    <option value="">Select Target...</option>
                    <optgroup label="Monthly Retainers">
                      {activeTaskTypes.map(t => <option key={t} value={`retainer_${t}`}>{t}</option>)}
                    </optgroup>
                    {clientActiveProjectsManual.length > 0 && (
                      <optgroup label="Custom Projects">
                        {clientActiveProjectsManual.map(p => <option key={p.id} value={`project_${p.id}`}>{p.title}</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-1 space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Employee Name</label>
                  <input type="text" value={manualTaskValues.employeeName} onChange={e => setManualTaskValues({...manualTaskValues, employeeName: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" placeholder="John Doe" />
                </div>
                <div className="col-span-2 sm:col-span-1 space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Start Date/Time</label>
                  <input type="datetime-local" value={manualTaskValues.date} onChange={e => setManualTaskValues({...manualTaskValues, date: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Duration Spent</label>
                  <div className="flex gap-4">
                    <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-2xl px-4 focus-within:ring-2 focus-within:ring-[#fd7414] transition-all">
                      <input type="number" min="0" placeholder="0" value={manualTaskValues.hours} onChange={e => setManualTaskValues({...manualTaskValues, hours: e.target.value})} className="w-full bg-transparent p-4 font-black text-xl outline-none" />
                      <span className="text-xs font-black text-slate-400 uppercase">Hours</span>
                    </div>
                    <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-2xl px-4 focus-within:ring-2 focus-within:ring-[#fd7414] transition-all">
                      <input type="number" min="0" max="59" placeholder="0" value={manualTaskValues.minutes} onChange={e => setManualTaskValues({...manualTaskValues, minutes: e.target.value})} className="w-full bg-transparent p-4 font-black text-xl outline-none" />
                      <span className="text-xs font-black text-slate-400 uppercase">Mins</span>
                    </div>
                  </div>
                </div>
                
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Notes (Paste HubSpot Notes Here)</label>
                  <textarea value={manualTaskValues.notes} onChange={e => setManualTaskValues({...manualTaskValues, notes: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[100px]" placeholder="Work completed..."/>
                  
                  <div className="flex justify-between items-center mt-2">
                    <button onClick={extractFromNotes} className="text-[10px] bg-[#fd7414]/10 hover:bg-[#fd7414]/20 text-[#fd7414] px-4 py-2 rounded-xl font-black uppercase tracking-widest transition-all">
                      ✨ Auto-Extract Time & Cost
                    </button>
                  </div>
                  
                  {manualTaskValues.parsedExpense > 0 && (
                    <div className="mt-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex justify-between items-center">
                      <div>
                        <span className="text-emerald-700 font-bold text-sm block">Found Expense: ${manualTaskValues.parsedExpense.toFixed(2)}</span>
                        <span className="text-emerald-500 text-[10px] uppercase font-black tracking-widest">Will be logged automatically with markup</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="p-8 border-t border-slate-100 shrink-0">
              <button onClick={saveManualTask} className="w-full bg-black text-white p-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">Save Manual Entry</button>
            </div>
          </div>
        </div>
      )}

      {/* Expense Modal */}
      {expenseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-blue-50/50 text-left">
              <div>
                <h3 className="font-black text-2xl text-blue-900">Add Expense</h3>
                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mt-1">{expenseModal.name}</p>
              </div>
              <button onClick={() => setExpenseModal(null)} className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-8 space-y-5 text-left">
              {!expenseModal.hourlyRate ? (
                <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-sm font-bold border border-red-100">
                  Please set an Hourly Rate in this client's settings before adding expenses, so we can deduct the correct hours.
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Expense Date</label>
                    <input type="date" value={expenseValues.date} onChange={e => setExpenseValues({...expenseValues, date: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Billing Target</label>
                    <select value={expenseValues.billingTarget} onChange={e => setExpenseValues({...expenseValues, billingTarget: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select Target...</option>
                      <optgroup label="Monthly Retainers">
                        {Object.keys(expenseModal.retainers || {}).map(t => <option key={t} value={`retainer_${t}`}>{t}</option>)}
                      </optgroup>
                      {clientActiveProjectsExp.length > 0 && (
                        <optgroup label="Custom Projects">
                          {clientActiveProjectsExp.map(p => <option key={p.id} value={`project_${p.id}`}>{p.title}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Expense Description</label>
                    <input type="text" value={expenseValues.description} onChange={e => setExpenseValues({...expenseValues, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g., Backlinks, Software..." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Currency</label>
                    <select
                      value={expenseValues.currency || 'CAD'}
                      onChange={e => setExpenseValues({ ...expenseValues, currency: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="CAD">CAD (Canadian Dollar)</option>
                      <option value="USD">USD (US Dollar)</option>
                      <option value="EUR">EUR (Euro)</option>
                      <option value="GBP">GBP (British Pound)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Amount ({expenseValues.currency || 'CAD'})</label>
                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl px-4 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                      <span className="font-black text-slate-400 text-xl">
                        {expenseValues.currency === 'GBP' ? '£' : expenseValues.currency === 'EUR' ? '€' : '$'}
                      </span>
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={expenseValues.amount} onChange={e => setExpenseValues({ ...expenseValues, amount: e.target.value })} className="w-full bg-transparent p-4 pl-2 font-black text-2xl outline-none text-slate-900" />
                    </div>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={expenseValues.applyMarkup !== false}
                      onChange={e => setExpenseValues({ ...expenseValues, applyMarkup: e.target.checked })}
                      className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-bold text-slate-700">Add 30% markup (HST)</span>
                  </label>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Recurrence</label>
                    <select
                      value={expenseValues.recurrenceMode || 'none'}
                      onChange={e => setExpenseValues({ ...expenseValues, recurrenceMode: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="none">One-time</option>
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annually</option>
                    </select>
                    {(expenseValues.recurrenceMode || 'none') !== 'none' && (
                      <p className="text-[10px] font-bold text-slate-500">
                        Recurring expenses auto-create each period when the app loads.
                      </p>
                    )}
                  </div>
                  {expenseValues.amount && (
                    (() => {
                      const currency = expenseValues.currency || 'CAD';
                      const rateToCad = FX_TO_CAD[currency] ?? 1;
                      const amountOrig = Number(expenseValues.amount);
                      const amountCad = amountOrig * rateToCad;
                      const applyMarkup = expenseValues.applyMarkup !== false;
                      const finalCostCad = applyMarkup ? amountCad * 1.30 : amountCad;
                      return (
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2 mt-4">
                          {currency !== 'CAD' && (
                            <div className="flex justify-between text-xs font-bold text-slate-500">
                              <span>Converted to CAD (×{rateToCad.toFixed(2)}):</span>
                              <span>${amountCad.toFixed(2)} CAD</span>
                            </div>
                          )}
                          <div className="flex justify-between text-xs font-bold text-slate-500">
                            <span>Cost in CAD:</span>
                            <span>${amountCad.toFixed(2)}</span>
                          </div>
                          {applyMarkup && (
                            <>
                              <div className="flex justify-between text-xs font-bold text-slate-500"><span>Markup (30%):</span><span className="text-emerald-500">+${(amountCad * 0.3).toFixed(2)}</span></div>
                              <div className="h-px bg-slate-200 my-1"></div>
                            </>
                          )}
                          <div className="flex justify-between font-black text-slate-800"><span>Final Cost (CAD):</span><span>${finalCostCad.toFixed(2)}</span></div>
                          {(() => {
                            const retainerCat = expenseValues.billingTarget?.startsWith('retainer_') ? expenseValues.billingTarget.replace('retainer_', '') : null;
                            const isDollar = retainerCat && isDollarCategory(expenseModal, retainerCat);
                            if (isDollar) return <div className="flex justify-between text-[10px] font-black uppercase text-slate-500 pt-2"><span>Dollar category</span><span>No hours deduction</span></div>;
                            return <div className="flex justify-between text-[10px] font-black uppercase text-[#fd7414] pt-2"><span>Retainer Deduction:</span><span>{(expenseModal.hourlyRate ? (finalCostCad / expenseModal.hourlyRate).toFixed(2) : '0.00')} hrs</span></div>;
                          })()}
                        </div>
                      );
                    })()
                  )}

                  <button onClick={saveExpense} disabled={!expenseValues.amount || !expenseValues.billingTarget} className="w-full bg-blue-600 text-white p-5 rounded-2xl font-black text-lg shadow-xl shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-30 mt-4">Log Expense</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Editing Shift/Task Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-black text-2xl">Edit {editingItem.type === 'shift' ? 'Shift Log' : 'Task Record'}</h3>
              <button onClick={() => setEditingItem(null)} className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-left">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Clock In Time</label>
                  <input type="datetime-local" value={editValues.clockInDate} onChange={e => setEditValues({...editValues, clockInDate: e.target.value})} className="w-full bg-slate-50 border-slate-200 border p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Clock Out Time</label>
                  <input type="datetime-local" value={editValues.clockOutDate} onChange={e => setEditValues({...editValues, clockOutDate: e.target.value})} className="w-full bg-slate-50 border-slate-200 border p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" />
                </div>
              </div>

              {editingItem.type === 'task' && (
                <div className="space-y-4 text-left">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Client</label>
                    <select
                      value={editValues.clientName || ''}
                      onChange={e => setEditValues({ ...editValues, clientName: e.target.value, billingTarget: '' })}
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                    >
                      <option value="">Select client...</option>
                      {clients.filter(c => !c.archived).map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Retainer / Billing Target</label>
                    <select
                      value={editValues.billingTarget || ''}
                      onChange={e => setEditValues({ ...editValues, billingTarget: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                      disabled={!editValues.clientName}
                    >
                      <option value="">Select target...</option>
                      {editValues.clientName && (() => {
                        const client = clients.find(c => c.name === editValues.clientName);
                        const retainers = client?.retainers ? Object.keys(client.retainers) : [];
                        const clientProjs = projects.filter(p => !p.archived && p.clientName === editValues.clientName && (p.status === 'active' || p.status === 'approved'));
                        return (
                          <>
                            <optgroup label="Retainers">
                              <option value={`retainer_${GENERAL_LABEL}`}>{GENERAL_LABEL}</option>
                              {retainers.map(name => (
                                <option key={name} value={`retainer_${name}`}>{name}</option>
                              ))}
                            </optgroup>
                            {clientProjs.length > 0 && (
                              <optgroup label="Custom Projects">
                                {clientProjs.map(p => (
                                  <option key={p.id} value={`project_${p.id}`}>{p.title}</option>
                                ))}
                              </optgroup>
                            )}
                          </>
                        );
                      })()}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Work Description / Notes</label>
                    <textarea value={editValues.notes || ''} onChange={e => setEditValues({...editValues, notes: e.target.value})} className="w-full bg-slate-50 border-slate-200 border p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[100px]" placeholder="Task notes..." />
                  </div>
                </div>
              )}

              <button onClick={saveEdit} className="w-full bg-[#fd7414] hover:bg-[#e66a12] text-white p-5 rounded-2xl font-black text-lg shadow-xl shadow-[#fd7414]/20 flex items-center justify-center gap-3 mt-4 transition-all">
                <Save className="w-5 h-5" /> Commit Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Retainer Setup Modal */}
      {editingClient && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
              <div className="text-left">
                <h3 className="font-black text-2xl text-slate-900">{editingClient.name}</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Client Settings & Retainers</p>
              </div>
              <button onClick={() => setEditingClient(null)} className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-8 space-y-8 overflow-y-auto text-left">
              {/* Core Settings */}
              <div className="space-y-4 bg-slate-50 p-6 rounded-3xl border border-slate-100">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="font-bold text-slate-700 text-sm">Account Status</span>
                  <select 
                    value={editingClient.status || 'active'} 
                    onChange={e => setEditingClient({...editingClient, status: e.target.value})}
                    className="bg-white border border-slate-200 p-2 rounded-lg text-sm font-bold outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
                {editingClient.status === 'paused' && (
                  <div className="bg-orange-100 text-orange-700 p-3 rounded-xl text-xs font-bold">
                    This account is paused. Employees cannot log new tasks, and retainers will not actively renew or accrue base hours this period.
                  </div>
                )}

                <div className="space-y-2 pt-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Billing Day of Month (1-31)</label>
                  <input type="number" min="1" max="31" value={editingClient.billingDay || 1} onChange={e => setEditingClient({...editingClient, billingDay: Number(e.target.value)})} className="w-full bg-white border border-slate-200 p-4 rounded-xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]" placeholder="e.g. 15" />
                  <p className="text-xs text-slate-400 mt-2 ml-1">Retainer periods reset on this day. Unused hours carry forward.</p>
                </div>
                <div className="space-y-2 pt-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Client Start Date (first invoice)</label>
                  <input
                    type="date"
                    value={editingClient.clientStartDate ? (() => { const d = new Date(editingClient.clientStartDate); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() : ''}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) { setEditingClient({ ...editingClient, clientStartDate: null }); return; }
                      const [y, m, d] = v.split('-').map(Number);
                      setEditingClient({ ...editingClient, clientStartDate: new Date(y, m - 1, d, 0, 0, 0, 0).getTime() });
                    }}
                    className="w-full bg-white border border-slate-200 p-4 rounded-xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                  />
                  <p className="text-xs text-slate-400 mt-2 ml-1">Reporting and tracking for this client will only include data from this date onward.</p>
                </div>
                <div className="space-y-2 pt-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Client Hourly Rate ($)</label>
                  <input type="number" value={editingClient.hourlyRate || ''} onChange={e => setEditingClient({...editingClient, hourlyRate: Number(e.target.value)})} className="w-full bg-white border border-slate-200 p-4 rounded-xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]" placeholder="e.g. 100" />
                </div>
                <div className="space-y-2 pt-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Authorized Emails (Comma separated)</label>
                  <p className="text-xs text-slate-400 mb-2">These users can log in to the Client Portal.</p>
                  <textarea value={(editingClient.clientEmails || []).join(', ')} onChange={e => setEditingClient({...editingClient, clientEmails: e.target.value.split(',').map(em => em.trim())})} className="w-full bg-white border border-slate-200 p-4 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[80px]" placeholder="ceo@client.com, cmo@client.com" />
                </div>
              </div>

              {/* Workspace access */}
              {(() => {
                const kioskEmails = Array.from(
                  new Set(
                    (adminUsers || [])
                      .filter((u) => u?.role === 'kiosk')
                      .map((u) =>
                        String(u?.email || '').trim().toLowerCase(),
                      )
                      .filter(Boolean),
                  ),
                ).sort();

                const current = editingClient.teamMemberAccessEmails;
                const legacyOpen = current == null;

                return (
                  <div className="space-y-2 pt-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">
                      Workspace access (Kiosk users)
                    </label>
                    <p className="text-xs text-slate-400">
                      Until you set a list, every kiosk user can see this client
                      (legacy). An explicit empty list blocks all kiosk access.
                    </p>
                    {legacyOpen ? (
                      <button
                        type="button"
                        className="w-full px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black uppercase tracking-widest"
                        onClick={() => {
                          if (kioskEmails.length === 0) {
                            window.alert(
                              'No users with the Kiosk role found. Add a kiosk user under Users first.',
                            );
                            return;
                          }
                          setEditingClient({
                            ...editingClient,
                            teamMemberAccessEmails: kioskEmails,
                          });
                        }}
                      >
                        Set access list (all kiosk users)
                      </button>
                    ) : (
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {kioskEmails.length === 0 ? (
                          <p className="text-xs italic text-slate-400">
                            No kiosk users exist yet.
                          </p>
                        ) : (
                          kioskEmails.map((email) => {
                            const normalized = String(email || '').trim().toLowerCase();
                            const selected =
                              Array.isArray(current) &&
                              current
                                .map((e) => String(e || '').trim().toLowerCase())
                                .includes(normalized);
                            return (
                              <label
                                key={normalized}
                                className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => {
                                    const cur = Array.isArray(
                                      editingClient.teamMemberAccessEmails,
                                    )
                                      ? editingClient.teamMemberAccessEmails
                                          .map((e) => String(e || '').trim().toLowerCase())
                                      : [];
                                    const set = new Set(cur);
                                    if (set.has(normalized)) set.delete(normalized);
                                    else set.add(normalized);
                                    const next = [...set].sort();
                                    setEditingClient({
                                      ...editingClient,
                                      teamMemberAccessEmails: next,
                                    });
                                  }}
                                  className="rounded border-slate-300"
                                />
                                <span>{email}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Retainers */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">
                    Monthly Base Allocation
                    <span className="ml-1 text-[9px] font-bold text-slate-400 normal-case">
                      (set hours or dollars per category below)
                    </span>
                  </label>
                  <button 
                    onClick={() => {
                      if(confirm("Are you sure? This will permanently clear any compounded surplus or deficit carryover hours from past months, starting them fresh for this current period.")) {
                        setEditingClient({
                          ...editingClient,
                          lastCarryoverResetDate: Date.now(),
                          carryoverResetByCategory: {},
                        })
                      }
                    }} 
                    className="text-[10px] bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest transition-all"
                  >
                    Reset Carryover (All)
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Tip: each hourly retainer row has its own
                  <span className="mx-1 font-black text-amber-700">
                    Reset Carryover
                  </span>
                  button.
                </p>
                <div className="space-y-3">
                  {retainerConfigCategories.map((type) => {
                    const units = (editingClient.retainerUnits || {})[type] ?? (type === 'Social Ad Budget' ? 'dollar' : 'hours');
                    const unitLabel = units === 'dollar' ? '$' : 'hrs';
                    const step = units === 'dollar' ? 1 : 0.5;
                    const categoryResetKey = carryoverCategoryKey(type);
                    const lastCategoryReset = editingClient.carryoverResetByCategory?.[categoryResetKey];
                    return (
                      <div
                        key={type}
                        className="flex justify-between items-start bg-slate-50 p-4 rounded-2xl border border-slate-100 gap-3"
                      >
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-700 text-sm">
                            {type}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {units === 'dollar' ? 'Per-cycle budget (dollars)' : 'Allocation in hours'}
                          </span>
                          {units !== 'dollar' && (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    !confirm(
                                      `Reset carryover for "${type}" only? This starts this category fresh from the current period.`,
                                    )
                                  ) {
                                    return;
                                  }
                                  setEditingClient({
                                    ...editingClient,
                                    carryoverResetByCategory: {
                                      ...(editingClient.carryoverResetByCategory || {}),
                                      [categoryResetKey]: Date.now(),
                                    },
                                  });
                                }}
                                className="text-[10px] bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded-lg font-black uppercase tracking-widest transition-all"
                                title="Reset this category carryover only"
                              >
                                Reset Carryover
                              </button>
                              {lastCategoryReset ? (
                                <div className="mt-1 text-[10px] font-bold text-slate-400">
                                  Last reset:{' '}
                                  {new Date(lastCategoryReset).toLocaleDateString()}
                                </div>
                              ) : (
                                <div className="mt-1 text-[10px] font-bold text-slate-400">
                                  Last reset: never
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={units}
                            onChange={(e) =>
                              setEditingClient({
                                ...editingClient,
                                retainerUnits: { ...(editingClient.retainerUnits || {}), [type]: e.target.value },
                              })
                            }
                            className="bg-white border border-slate-200 p-2 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                          >
                            <option value="hours">Hours</option>
                            <option value="dollar">Dollars ($)</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            step={step}
                            value={editingClient.retainers?.[type] || ''}
                            onChange={(e) =>
                              setEditingClient({
                                ...editingClient,
                                retainers: {
                                  ...editingClient.retainers,
                                  [type]: Number(e.target.value),
                                },
                              })
                            }
                            className="w-24 bg-white border border-slate-200 p-2 text-center rounded-xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                            placeholder="0"
                          />
                          <span className="text-xs font-bold text-slate-400 uppercase">
                            {unitLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-8 border-t border-slate-100 bg-white shrink-0">
              <button 
                onClick={async () => { await updateDoc(doc(db, 'clients', editingClient.id), { retainers: editingClient.retainers, retainerUnits: editingClient.retainerUnits || {}, hourlyRate: editingClient.hourlyRate || 0, clientEmails: editingClient.clientEmails || [], billingDay: editingClient.billingDay || 1, status: editingClient.status || 'active', teamMemberAccessEmails: editingClient.teamMemberAccessEmails === undefined ? null : editingClient.teamMemberAccessEmails, lastCarryoverResetDate: editingClient.lastCarryoverResetDate || null, carryoverResetByCategory: editingClient.carryoverResetByCategory || {}, clientStartDate: editingClient.clientStartDate || null }); setEditingClient(null); }} 
                className="w-full bg-black hover:bg-slate-800 text-white p-5 rounded-2xl font-black text-lg shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95"
              >
                <Save className="w-5 h-5" /> Save Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Addon Modal */}
      {addonModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 text-left">
              <div>
                <h3 className="font-black text-2xl text-slate-900">Add Hours</h3>
              </div>
              <button onClick={() => setAddonModal(null)} className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-8 space-y-5 text-left">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Additional Hours Requested</label>
                {view === 'client_portal' ? (
                  <div className="space-y-3">
                    <input
                      type="range"
                      min="1"
                      max="25"
                      step="1"
                      value={Math.max(1, Math.min(25, Number(addonValues.hours) || 1))}
                      onChange={(e) =>
                        setAddonValues({ ...addonValues, hours: e.target.value })
                      }
                      className="w-full"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-black text-slate-800">
                        {Math.max(1, Math.min(25, Number(addonValues.hours) || 1))} hours
                      </span>
                      <span className="text-xs font-bold text-slate-400">
                        1–25
                      </span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1">
                      {(() => {
                        const hoursNum = Math.max(
                          1,
                          Math.min(25, Number(addonValues.hours) || 1),
                        );
                        const rate = Number(addonModal.hourlyRate) || 0;
                        const subtotal = hoursNum * rate;
                        const hst = subtotal * 0.13;
                        const total = subtotal + hst;
                        return (
                          <>
                            <div className="flex justify-between text-sm font-black">
                              <span className="text-slate-600">
                                Subtotal
                              </span>
                              <span className="text-slate-900">
                                ${subtotal.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs font-bold">
                              <span className="text-slate-400">
                                HST (13%)
                              </span>
                              <span className="text-slate-500">
                                ${hst.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm font-black pt-2 border-t border-slate-200">
                              <span className="text-slate-700">
                                Total
                              </span>
                              <span className="text-[#fd7414]">
                                ${total.toFixed(2)}
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <p className="text-xs text-slate-400 font-bold">
                      Additional retainer cost will be added to your next billing cycle.
                    </p>
                  </div>
                ) : (
                  <input type="number" min="0" step="0.5" value={addonValues.hours} onChange={e => setAddonValues({...addonValues, hours: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]" placeholder="e.g. 5" />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Notes / Reason (Optional)</label>
                <textarea value={addonValues.notes} onChange={e => setAddonValues({...addonValues, notes: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[80px]" placeholder="..." />
              </div>
              <button onClick={submitAddonRequest} disabled={!addonValues.hours} className="w-full bg-[#fd7414] text-white p-5 rounded-2xl font-black text-lg shadow-xl shadow-[#fd7414]/20 active:scale-95 transition-all disabled:opacity-30 mt-4">Submit Request</button>
            </div>
          </div>
        </div>
      )}

      {/* Project Modal */}
      {projectModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 text-left">
              <div>
                <h3 className="font-black text-2xl text-slate-900">Custom Project</h3>
              </div>
              <button
                onClick={() => {
                  setProjectModal(null);
                  setProjectBudgetOverride(false);
                  setProjectSubmitting(false);
                  setProjectSubmitError('');
                }}
                className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-8 space-y-5 text-left">
              {projectSubmitError && (
                <div className="bg-red-50 text-red-700 border border-red-100 p-3 rounded-2xl text-sm font-bold">
                  {projectSubmitError}
                </div>
              )}
              {view === 'client_portal' ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                      Category
                    </label>
                    <select
                      value={projectValues.category}
                      onChange={(e) =>
                        setProjectValues({
                          ...projectValues,
                          category: e.target.value,
                        })
                      }
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                    >
                      <option value="">Select a category...</option>
                      {DEFAULT_PROJECT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                      Project Description
                    </label>
                    <textarea
                      value={projectValues.requestDescription}
                      onChange={(e) =>
                        setProjectValues({
                          ...projectValues,
                          requestDescription: e.target.value,
                        })
                      }
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[120px]"
                      placeholder="Describe what you want completed..."
                    />
                  </div>
                  <button
                    onClick={submitProjectRequest}
                    disabled={!projectValues.category || !projectValues.requestDescription}
                    className="w-full bg-black text-white p-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all disabled:opacity-30 mt-4"
                  >
                    {projectSubmitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </>
              ) : (
                <>
                  {projectModal?.lockClient ? (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                        Client
                      </label>
                      <div className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black text-slate-800">
                        {projectValues.clientName || projectModal?.name || 'Selected client'}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                        Client
                      </label>
                      <select
                        value={projectValues.clientId}
                        onChange={(e) => {
                          const id = e.target.value;
                          const client = clients.find((c) => c.id === id);
                          setProjectValues((prev) => ({
                            ...prev,
                            clientId: id,
                            clientName: client?.name || '',
                          }));
                          if (!projectBudgetOverride) {
                            const hours = Number(projectValues.estimatedHours) || 0;
                            const rate = Number(client?.hourlyRate) || 0;
                            if (hours > 0 && rate > 0) {
                              setProjectValues((prev) => ({
                                ...prev,
                                estimatedBudget: (hours * rate).toFixed(2),
                              }));
                            }
                          }
                        }}
                        className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                      >
                        <option value="">Select client...</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Project Title</label>
                    <input type="text" value={projectValues.title} onChange={e => setProjectValues({...projectValues, title: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]" placeholder="e.g. Website Redesign" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Scope / Description / Notes</label>
                    <textarea value={projectValues.description} onChange={e => setProjectValues({...projectValues, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[120px]" placeholder="Details about what you need done..." />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Estimated Budget ($)</label>
                      <input
                        type="number"
                        min="0"
                        value={projectValues.estimatedBudget}
                        onChange={(e) => {
                          setProjectBudgetOverride(true);
                          setProjectValues({ ...projectValues, estimatedBudget: e.target.value });
                        }}
                        disabled={!projectBudgetOverride}
                        className={`w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414] ${
                          projectBudgetOverride ? '' : 'opacity-60'
                        }`}
                        placeholder="e.g. 5000"
                      />
                      <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 mt-2 select-none">
                        <input
                          type="checkbox"
                          checked={projectBudgetOverride}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setProjectBudgetOverride(checked);
                            if (!checked) {
                              const hours = Number(projectValues.estimatedHours) || 0;
                              const client = clients.find((c) => c.id === projectValues.clientId);
                              const rate = Number(client?.hourlyRate) || 0;
                              if (hours > 0 && rate > 0) {
                                setProjectValues((prev) => ({
                                  ...prev,
                                  estimatedBudget: (hours * rate).toFixed(2),
                                }));
                              }
                            }
                          }}
                        />
                        Override budget
                      </label>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Estimated Hours</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={projectValues.estimatedHours}
                        onChange={(e) => {
                          const hoursStr = e.target.value;
                          const hours = Number(hoursStr) || 0;
                          setProjectValues({ ...projectValues, estimatedHours: hoursStr });
                          if (!projectBudgetOverride) {
                            const client = clients.find((c) => c.id === projectValues.clientId);
                            const rate = Number(client?.hourlyRate) || 0;
                            if (hours > 0 && rate > 0) {
                              setProjectValues((prev) => ({
                                ...prev,
                                estimatedBudget: (hours * rate).toFixed(2),
                              }));
                            }
                          }
                        }}
                        className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                        placeholder="e.g. 40"
                      />
                    </div>
                  </div>
                  <button
                    onClick={submitProjectRequest}
                    disabled={!projectValues.title}
                    className="w-full bg-black text-white p-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all disabled:opacity-30 mt-4"
                  >
                    {projectSubmitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Custom Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[110] animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto border border-red-100">
              <Trash2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-black text-xl mb-2">Confirm Deletion</h3>
              <p className="text-sm text-slate-500 font-medium">Are you sure you want to delete {deleteConfirm.title}? This action cannot be undone.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-all">Cancel</button>
              <button
                onClick={async () => {
                  const ids = Array.isArray(deleteConfirm.ids)
                    ? deleteConfirm.ids
                    : [deleteConfirm.id].filter(Boolean);
                  await Promise.all(
                    ids.map((id) =>
                      deleteDoc(doc(db, deleteConfirm.collection, id)).catch(() => {})
                    )
                  );
                  setDeleteConfirm(null);
                }}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-red-500/30 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}