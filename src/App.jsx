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
  storage,
  storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  collection,
  query,
  where,
  writeBatch,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  doc,
  deleteDoc,
  deleteField,
} from './firebase';
import {
  computeGlobalRetainerStats,
  getBillingPeriod,
  getTaskDuration,
  formatTime,
} from './utils/billingEngine.js';
import ClientPortal from './components/ClientPortal.jsx';
import EmployeeKiosk from './components/EmployeeKiosk.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import DurationSlider from './components/DurationSlider.jsx';
import { getTaskDurationHours, getTaskEmployeeName } from './utils/taskLogDisplay.js';
import {
  buildPerplexityExpenseDescription,
  computePerplexityExpenseAmounts,
} from './utils/perplexityCredits.js';
import { buildTeamAccessMergeForTodoAssignees } from './utils/teamClientAccess.js';
import { isClientActiveForWork } from './utils/clientActiveForWork.js';
import {
  filterClientsForTeamMember,
  teamMemberCanViewClient,
} from './utils/teamClientAccess.js';
import {
  ensureRecurringSkipOnCategory,
  computeRecurringDueDate,
  dedupeRecurringSeedsAgainstCarried,
  markPrimaryTodoDoneAcrossCycles,
  mergeOpenItemsFromPrevCycle,
  projectSubtasksForNewRecurringPrimaryCycle,
  reconcileRecurringTodoInstances,
  recurringAnchorKey,
  removeRecurringSeriesFromAllCycles,
  removeTodoItemFromAllCycles,
  seedNextRecurringOccurrence,
  subtasksForCarryover,
} from './utils/recurringTodoMaterialize.js';
import { canMarkParentTodoDone } from './utils/todoSubtasks.js';
import {
  addAttachmentToItem,
  buildClientDocumentRecord,
  buildClientFileStoragePath,
  getTodoAttachments,
  MAX_TODO_ATTACHMENTS,
  newContactId,
  newDocumentId,
  normalizeClientContacts,
  normalizePrimaryContact,
  removeDocumentFromTodoCycles,
  validateClientUploadFile,
} from './utils/clientDocuments.js';
import {
  getEnabledRetainerCategoryNames,
  isRetainerCategoryEnabled,
  normalizeRetainerCategoryEnabled,
} from './utils/retainerCategories.js';
import {
  removeSubtaskFromItems,
} from './utils/todoSubtasks.js';
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

/** Same dark zinc remaps as kiosk (`index.css` :is(..., [data-ignite-theme="dark"])) */
const StaffThemeShell = ({ children }) => (
  <div data-ignite-theme="dark" className="w-full">
    {children}
  </div>
);

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

/** `<input type="datetime-local">` uses local wall time — never use `toISOString().slice(0,16)` (that is UTC). */
function formatMsForDatetimeLocal(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Parse `YYYY-MM-DDTHH:mm` from datetime-local as local civil time → epoch ms. */
function parseDatetimeLocalToMs(s) {
  if (s == null || typeof s !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s.trim());
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const h = Number(m[4]);
  const min = Number(m[5]);
  const sec = m[6] != null ? Number(m[6]) : 0;
  const d = new Date(y, mo, day, h, min, sec, 0);
  return d.getTime();
}

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

  const [liveDuration, setLiveDuration] = useState(0);
  const [liveTaskDuration, setLiveTaskDuration] = useState(0);

  const [clients, setClients] = useState([]);
  const clientsRef = useRef([]);
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
  const [archiveConfirm, setArchiveConfirm] = useState(null);
  const [editingClient, setEditingClient] = useState(null);
  const [clientLogoUploading, setClientLogoUploading] = useState(false);
  const [expenseModal, setExpenseModal] = useState(null);
  const [expenseValues, setExpenseValues] = useState({
    billingTarget: '',
    description: '',
    amount: '',
    perplexityCredits: '',
    inputMode: 'amount',
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
    deadline: '',
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
  const recurringTodoReconcileInFlightRef = useRef(false);
  const policyWritePendingRef = useRef({});
  const policyWriteTimerRef = useRef(null);
  const [activeTaskNotes, setActiveTaskNotes] = useState('');

  const idleShutdownRef = useRef({
    activeTask: null,
    activeShift: null,
    activeTaskNotes: '',
  });
  const idleAutoClockOutLockRef = useRef(false);

  // Client Portal State
  const [portalOffset, setPortalOffset] = useState(0);
  // Admin-only: preview the client portal as a specific client.
  const [portalPreviewClientId, setPortalPreviewClientId] = useState(null);
  // Slack notification settings (settings/notifications, read by Cloud Functions).
  const [notifySettings, setNotifySettings] = useState({});
  const POLICY_DEFAULTS = {
    requireClockOutNote: false,
    idleReminderMinutes: 0,
    // Idle failsafe defaults ON: prompt after 2 hours of no kiosk activity.
    idleFailsafeMinutes: 120,
    idleFailsafeConfirmSeconds: 120,
    // Payroll (Wagepoint) export settings.
    payrollFrequency: 'biweekly',
    payrollAnchorDate: '',
  };
  const [policy, setPolicy] = useState(() => {
    try {
      const raw = localStorage.getItem('ignite_policy');
      if (!raw) return POLICY_DEFAULTS;
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed
        ? { ...POLICY_DEFAULTS, ...parsed }
        : POLICY_DEFAULTS;
    } catch {
      return POLICY_DEFAULTS;
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
    // Policy must reach every kiosk device, not just this browser. Debounce
    // the write so typing in a settings field doesn't fire one per keystroke.
    policyWritePendingRef.current = { ...policyWritePendingRef.current, ...updates };
    if (policyWriteTimerRef.current) clearTimeout(policyWriteTimerRef.current);
    policyWriteTimerRef.current = setTimeout(() => {
      const pending = policyWritePendingRef.current;
      policyWritePendingRef.current = {};
      policyWriteTimerRef.current = null;
      setDoc(doc(db, 'settings', 'policy'), pending, { merge: true }).catch(
        () => {},
      );
    }, 600);
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

  // Staff (anyone with an admins/{email} doc) subscribe to the full workspace
  // dataset. Client portal users get narrow, per-client queries instead so
  // other clients' data never reaches their browser (see effects below).
  useEffect(() => {
    if (!user || !adminDocReady) return;
    const isDemoStaff = ENABLE_DEMOS && user.uid === 'demo-user-123';
    if (!myAdminDoc && !isDemoStaff) return;

    // Rolling history window: carryover math only needs the previous billing
    // cycle, so ~18 months covers all billing views while keeping listener
    // size/cost bounded as data grows. Older docs stay in Firestore.
    const HISTORY_WINDOW_MS = 548 * 24 * 60 * 60 * 1000; // ~18 months
    const historyCutoff = Date.now() - HISTORY_WINDOW_MS;

    const unsubTimesheets = onSnapshot(query(collection(db, 'timesheets'), where('clockInTime', '>=', historyCutoff)), (snapshot) => setTimesheets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.clockInTime - a.clockInTime)));
    // Internal staff notes live in a separate staff-only collection
    // (clientNotes/{clientId}) so portal users reading their client doc can't
    // see them. Merge them back onto the client objects for all staff UI.
    let rawClients = [];
    let staffNotesById = {};
    const applyMergedClients = () => {
      const merged = rawClients.map((c) => {
        const n = staffNotesById[c.id];
        // Flag legacy notes still stored on the (portal-readable) client doc
        // so the one-time migration knows to move and remove them.
        const legacyNotesOnDoc = !!(
          c.generalNotes ||
          (c.cycleNotes && Object.keys(c.cycleNotes).length)
        );
        return {
          ...c,
          _legacyNotesOnDoc: legacyNotesOnDoc,
          ...(n
            ? {
                generalNotes: n.generalNotes ?? c.generalNotes ?? '',
                cycleNotes: n.cycleNotes ?? c.cycleNotes ?? {},
              }
            : {}),
        };
      });
      clientsRef.current = merged;
      setClients(merged);
    };
    const unsubClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      rawClients = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      applyMergedClients();
    });
    const unsubClientNotes = onSnapshot(
      collection(db, 'clientNotes'),
      (snapshot) => {
        staffNotesById = Object.fromEntries(
          snapshot.docs.map((d) => [d.id, d.data()]),
        );
        applyMergedClients();
      },
      () => {}, // rules may not be deployed yet; legacy fields still merge
    );
    const unsubTasks = onSnapshot(query(collection(db, 'taskLogs'), where('clockInTime', '>=', historyCutoff)), (snapshot) => setTaskLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.clockInTime - a.clockInTime)));
    const unsubTaskTypes = onSnapshot(collection(db, 'taskTypes'), (snapshot) => setTaskTypes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    const unsubExpenses = onSnapshot(query(collection(db, 'expenses'), where('date', '>=', historyCutoff)), (snapshot) => setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => b.date - a.date)));
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
    // Slack notification settings (webhook + toggles) read by Cloud Functions.
    const unsubNotify = onSnapshot(
      doc(db, 'settings', 'notifications'),
      (snapshot) => setNotifySettings(snapshot.exists() ? snapshot.data() : {}),
      () => {},
    );
    // Shared policy (idle failsafe etc.) so kiosks on other devices honor it.
    const unsubPolicy = onSnapshot(
      doc(db, 'settings', 'policy'),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data() || {};
        setPolicy((prev) => ({ ...prev, ...data }));
        try {
          localStorage.setItem('ignite_policy', JSON.stringify(data));
        } catch {
          // localStorage may be unavailable; Firestore copy is authoritative.
        }
      },
      () => {
        // Rules may not allow this read yet; local defaults still apply.
      },
    );

    return () => {
      unsubTimesheets();
      unsubClients();
      unsubClientNotes();
      unsubTasks();
      unsubTaskTypes();
      unsubExpenses();
      unsubProjects();
      unsubAddons();
      unsubUserTodos();
      unsubNotify();
      unsubPolicy();
    };
  }, [user, adminDocReady, myAdminDoc?.id]);

  // Portal users (no admin doc): only the client docs that list their email.
  useEffect(() => {
    if (!user?.email || !adminDocReady || myAdminDoc) return;
    if (ENABLE_DEMOS && (user.uid === 'demo-user-123' || user.uid === 'demo-client-123')) return;
    const emailKey = String(user.email).trim().toLowerCase();
    const unsub = onSnapshot(
      query(collection(db, 'clients'), where('clientEmails', 'array-contains', emailKey)),
      (snapshot) => {
        const next = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        clientsRef.current = next;
        setClients(next);
      },
      () => {
        // Unauthorized accounts simply see the Access Denied screen.
      },
    );
    return () => unsub();
  }, [user, adminDocReady, myAdminDoc?.id]);

  useEffect(() => {
    if (!user || !Array.isArray(expenses) || expenses.length === 0) return;
    // Only staff materialize recurring expenses; portal users lack write access.
    if (!myAdminDoc) return;
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
              // Deterministic doc id (series + due date) makes this idempotent:
              // two open tabs racing on the same instance write the same doc
              // instead of creating duplicates.
              setDoc(doc(db, 'expenses', `rec_${e.recurringId}_${Number(e.date || 0)}`), {
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
  }, [user, expenses, myAdminDoc]);

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

  // New @ignitepm.com employees self-provision a kiosk-role admins doc so
  // security rules recognize them as staff before an admin assigns a role.
  useEffect(() => {
    if (!user?.email || !adminDocReady || myAdminDoc) return;
    const emailKey = String(user.email).trim().toLowerCase();
    if (!emailKey.endsWith('@ignitepm.com')) return;
    if (emailKey === 'chris@ignitepm.com') return; // owner bootstrap below
    setDoc(doc(db, 'admins', emailKey), { email: user.email, role: 'kiosk' }).catch(() => {});
  }, [user?.email, adminDocReady, myAdminDoc]);

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
  const userEmailLower = String(user?.email || '').trim().toLowerCase();
  let clientProfile = user && userEmailLower
    ? clients.find(
        (c) =>
          c.clientEmails &&
          c.clientEmails.map((e) => e.toLowerCase().trim()).includes(userEmailLower),
      )
    : null;
  if (ENABLE_DEMOS && user && user.uid === 'demo-client-123' && !clientProfile) {
    clientProfile = { id: 'demo', name: "Demo Client", status: 'active', hourlyRate: 100, billingDay: 1, clientEmails: ["client@demo.com"], retainers: { "SEO": 10 } };
  }
  
  const isClientUser = !!clientProfile && !isUserAdmin; 

  useEffect(() => {
    if (isClientUser && view !== 'client_portal') setView('client_portal');
    else if (isUserAdmin && view === 'client_portal')
      setView(currentUserRole === 'kiosk' ? 'employee' : 'admin');
  }, [isClientUser, isUserAdmin, currentUserRole, view]);

  // Portal users: per-client activity queries (tasks, expenses, projects,
  // addons stamped with their clientId). Security rules deny anything wider.
  const portalClientId = isClientUser && clientProfile?.id !== 'demo' ? clientProfile?.id : null;
  useEffect(() => {
    if (!portalClientId) return;
    const byClient = (name) =>
      query(collection(db, name), where('clientId', '==', portalClientId));
    const ignoreErr = () => {};
    const unsubTasks = onSnapshot(byClient('taskLogs'), (s) =>
      setTaskLogs(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.clockInTime - a.clockInTime)), ignoreErr);
    const unsubExpenses = onSnapshot(byClient('expenses'), (s) =>
      setExpenses(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.date - a.date)), ignoreErr);
    const unsubProjects = onSnapshot(byClient('projects'), (s) =>
      setProjects(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt)), ignoreErr);
    const unsubAddons = onSnapshot(byClient('addons'), (s) =>
      setAddons(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.date - a.date)), ignoreErr);
    return () => {
      unsubTasks();
      unsubExpenses();
      unsubProjects();
      unsubAddons();
    };
  }, [portalClientId]);

  // One-time per session (admin/billing): stamp clientId onto legacy taskLogs
  // and expenses (joins were name-based, which breaks on client rename and is
  // required for scoped portal queries), and normalize clientEmails to
  // lowercase so portal logins match regardless of how the email was typed.
  const dataBackfillDoneRef = useRef({ tasks: false, expenses: false, clients: false, notes: false });
  useEffect(() => {
    if (!user?.email || !isUserAdmin || currentUserRole === 'kiosk') return;
    if (!clients?.length) return;

    const done = dataBackfillDoneRef.current;
    const idByName = new Map(clients.map((c) => [c.name, c.id]));
    const updates = [];

    if (!done.tasks && taskLogs.length) {
      done.tasks = true;
      taskLogs.forEach((t) => {
        if (t.clientId || !t.clientName) return;
        const cid = idByName.get(t.clientName);
        if (cid) updates.push({ coll: 'taskLogs', id: t.id, patch: { clientId: cid } });
      });
    }
    if (!done.expenses && expenses.length) {
      done.expenses = true;
      expenses.forEach((e) => {
        const cur = String(e.clientId || '');
        if (cur && cur !== 'manual') return;
        const cid = idByName.get(e.clientName);
        if (cid) updates.push({ coll: 'expenses', id: e.id, patch: { clientId: cid } });
      });
    }
    if (!done.clients) {
      done.clients = true;
      clients.forEach((c) => {
        const emails = Array.isArray(c.clientEmails) ? c.clientEmails : [];
        const lowered = emails
          .map((em) => String(em || '').trim().toLowerCase())
          .filter(Boolean);
        if (JSON.stringify(lowered) !== JSON.stringify(emails)) {
          updates.push({ coll: 'clients', id: c.id, patch: { clientEmails: lowered } });
        }
      });
    }
    if (!done.notes) {
      done.notes = true;
      // Migrate internal notes off the client doc (portal users can read it)
      // into the staff-only clientNotes collection. Copy first, then remove.
      (async () => {
        for (const c of clients) {
          if (!c._legacyNotesOnDoc) continue;
          try {
            await setDoc(
              doc(db, 'clientNotes', c.id),
              {
                ...(c.generalNotes ? { generalNotes: c.generalNotes } : {}),
                ...(c.cycleNotes && Object.keys(c.cycleNotes).length
                  ? { cycleNotes: c.cycleNotes }
                  : {}),
              },
              { merge: true },
            );
            await updateDoc(doc(db, 'clients', c.id), {
              generalNotes: deleteField(),
              cycleNotes: deleteField(),
            });
          } catch {
            // Rules not deployed yet or offline; retried next session.
          }
        }
      })();
    }

    if (!updates.length) return;
    (async () => {
      for (let i = 0; i < updates.length; i += 400) {
        const batch = writeBatch(db);
        updates
          .slice(i, i + 400)
          .forEach((u) => batch.update(doc(db, u.coll, u.id), u.patch));
        try {
          await batch.commit();
        } catch {
          // Offline or permission hiccup; next session retries.
        }
      }
    })();
  }, [user?.email, isUserAdmin, currentUserRole, clients, taskLogs, expenses]);

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

  useEffect(() => {
    idleShutdownRef.current = { activeTask, activeShift, activeTaskNotes };
  }, [activeTask, activeShift, activeTaskNotes]);

  // Active Billing Targets
  const clientActiveProjects = projects.filter(p => !p.archived && p.clientName === selectedClient && (p.status === 'active' || p.status === 'approved'));
  const clientActiveProjectsManual = projects.filter(p => !p.archived && p.clientName === manualTaskValues.clientName && (p.status === 'active' || p.status === 'approved'));
  const clientActiveProjectsExp = expenseModal ? projects.filter(p => !p.archived && p.clientName === expenseModal.name && (p.status === 'active' || p.status === 'approved')) : [];

  const selectedClientObj = clients.find(c => c.name === selectedClient);
  useEffect(() => {
    if (!selectedClient || !clients?.length) return;
    const c = clients.find((x) => x.name === selectedClient);
    if (c && isClientActiveForWork(c)) return;
    if (activeTask?.clientName === selectedClient) return;
    setSelectedClient('');
    setSelectedBillingTarget('');
  }, [clients, selectedClient, activeTask?.clientName]);
  const selectableRetainers = selectedClientObj
    ? Object.keys(selectedClientObj.retainers || {}).map((name) => ({
        name,
        enabled: isRetainerCategoryEnabled(selectedClientObj, name),
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
      // Accounts are provisioned by an administrator; public sign-up is disabled.
      await signInWithEmailAndPassword(auth, email, password);
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
    // Guard against duplicate active shifts (second tab/device, stale shift
    // left over after a crash). Tasks attach to one shift id, so a duplicate
    // makes the admin Active Shifts panel show "No active task".
    const existing = timesheets.find(
      (t) =>
        t.userId === user?.uid &&
        (t.status === 'active' || t.status === 'break'),
    );
    if (existing) return;
    // Clock-in is a user gesture, so this is the best moment to ask for
    // notification permission (used by the idle "Still working?" failsafe).
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch {
      // Notifications unsupported; failsafe still works via the modal.
    }
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
    const c = clients.find((x) => x.name === clientName);
    if (!isClientActiveForWork(c)) return;
    setSelectedClient(clientName);
    setSelectedBillingTarget(billingTarget);
    kioskAutostartClockInAttemptedRef.current = false;
    setKioskAutostartPending(true);
  }, [clients]);

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
    if (!clients?.length) return;
    const clientName = decodeURIComponent(c);
    const clientObj = clients.find((x) => x.name === clientName);
    if (!clientObj || !isClientActiveForWork(clientObj)) {
      kioskAutostartSearchProcessedRef.current = qs;
      navigate('/kiosk', { replace: true });
      return;
    }
    kioskAutostartSearchProcessedRef.current = qs;
    setSelectedClient(clientName);
    setSelectedBillingTarget(decodeURIComponent(t));
    kioskAutostartClockInAttemptedRef.current = false;
    setKioskAutostartPending(true);
    navigate('/kiosk', { replace: true });
  }, [user, location.pathname, location.search, navigate, clients]);

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
    await updateDoc(doc(db, 'taskLogs', task.id), {
      status: 'active',
      lastResumeTime: Date.now(),
      shiftId: activeShift?.id || task.shiftId,
      userId: user?.uid || task.userId,
    });
    setActiveTaskNotes(task.notes || '');
  };

  const handleStartTask = async () => {
    if (!selectedClient || !selectedBillingTarget || !activeShift?.id) return;

    const isProject = selectedBillingTarget.startsWith('project_');
    const isGeneral = selectedBillingTarget === 'retainer_GENERAL_UNCLASSIFIED';
    const targetId = isProject ? selectedBillingTarget.replace('project_', '') : null;
    let projName;

    if (isProject) projName = 'Custom Project';
    else if (isGeneral) projName = GENERAL_LABEL;
    else projName = selectedBillingTarget.replace('retainer_', '');

    const matchesPausedForSelection = (t) => {
      if (t.shiftId !== activeShift.id || t.status !== 'completed') return false;
      if (t.clientName !== selectedClient) return false;
      if (isProject) return t.projectId === targetId;
      if (isGeneral) return !t.projectId && t.projectName === GENERAL_LABEL;
      return !t.projectId && t.projectName === projName;
    };

    const pausedCandidates = taskLogs.filter(matchesPausedForSelection);
    if (pausedCandidates.length > 0) {
      pausedCandidates.sort((a, b) => (b.clockOutTime || 0) - (a.clockOutTime || 0));
      await handleResumeTask(pausedCandidates[0]);
      return;
    }

    const startClient = clients.find((x) => x.name === selectedClient);
    if (!isClientActiveForWork(startClient)) return;

    await addDoc(collection(db, 'taskLogs'), {
      shiftId: activeShift.id,
      userId: user.uid,
      clientName: selectedClient,
      clientId: startClient?.id || '',
      projectName: projName,
      projectId: targetId,
      clockInTime: Date.now(),
      lastResumeTime: Date.now(),
      totalSavedDuration: 0,
      status: 'active',
      notes: '',
    });
    setActiveTaskNotes('');
  };

  useEffect(() => {
    if (!user || !kioskAutostartPending) return;
    if (!selectedClient || !selectedBillingTarget) return;
    if (!activeShift) {
      if (!kioskAutostartClockInAttemptedRef.current) {
        kioskAutostartClockInAttemptedRef.current = true;
        // On failure, allow a retry instead of leaving autostart stuck.
        Promise.resolve(handleClockIn()).catch(() => {
          kioskAutostartClockInAttemptedRef.current = false;
        });
      }
      return;
    }
    kioskAutostartClockInAttemptedRef.current = false;
    if (activeTask) {
      setKioskAutostartPending(false);
      return;
    }
    setKioskAutostartPending(false);
    Promise.resolve(handleStartTask()).catch(() => {
      // Shift exists but the task didn't start (offline/permissions); the
      // kiosk UI still lets the user start it manually.
    });
  }, [
    user,
    kioskAutostartPending,
    selectedClient,
    selectedBillingTarget,
    activeShift,
    activeTask,
  ]);

  const handleTakeBreak = async () => {
    if (!activeShift) return;
    if (activeTask) await handleStopTask();
    const endTime = Date.now();
    const segment = endTime - (activeShift.lastResumeTime || activeShift.clockInTime);
    await updateDoc(doc(db, 'timesheets', activeShift.id), { status: 'break', totalSavedDuration: (activeShift.totalSavedDuration || 0) + segment, lastResumeTime: endTime });
  };

  const handleEndBreak = async () => {
    if (!activeShift) return;
    await updateDoc(doc(db, 'timesheets', activeShift.id), { status: 'active', lastResumeTime: Date.now() });
  };

  const handleClockOut = async () => {
    if (!activeShift) return;
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

  const forceClockOutShift = useCallback(
    async (shift, { adminNote = '' } = {}) => {
      if (!shift?.id) {
        return { ok: false, error: 'Missing shift.' };
      }
      if (shift.status !== 'active' && shift.status !== 'break') {
        return { ok: false, error: 'This shift is not active.' };
      }

      const endTime = Date.now();
      const adminTag = `[Clocked out by admin: ${user?.email || 'admin'}]`;

      try {
        // Other shifts still live for this user; tasks tied to them stay put.
        const otherLiveShiftIds = new Set(
          timesheets
            .filter(
              (s) =>
                s.id !== shift.id &&
                s.userId === shift.userId &&
                (s.status === 'active' || s.status === 'break'),
            )
            .map((s) => s.id),
        );
        const activeTasksForShift = taskLogs.filter(
          (t) =>
            t.status === 'active' &&
            (t.shiftId === shift.id ||
              // Orphaned task: same user, but its shift id no longer matches
              // any live shift (stale/duplicate shift was created later).
              (shift.userId &&
                t.userId === shift.userId &&
                !otherLiveShiftIds.has(t.shiftId))),
        );

        for (const task of activeTasksForShift) {
          const segment = endTime - (task.lastResumeTime || task.clockInTime);
          const newTotal = (task.totalSavedDuration || 0) + segment;
          const noteParts = [
            String(task.notes || '').trim(),
            String(adminNote || '').trim(),
            adminTag,
          ].filter(Boolean);
          await updateDoc(doc(db, 'taskLogs', task.id), {
            clockOutTime: endTime,
            status: 'completed',
            totalSavedDuration: newTotal,
            duration: newTotal,
            notes: noteParts.join('\n\n'),
          });
        }

        let newTotal = shift.totalSavedDuration || 0;
        if (shift.status === 'active') {
          newTotal += endTime - (shift.lastResumeTime || shift.clockInTime);
        }
        const shiftNoteParts = [
          String(shift.shiftNote || '').trim(),
          String(adminNote || '').trim(),
          adminTag,
        ].filter(Boolean);

        await updateDoc(doc(db, 'timesheets', shift.id), {
          clockOutTime: endTime,
          status: 'completed',
          totalSavedDuration: newTotal,
          duration: newTotal,
          forcedClockOutBy: user?.email || '',
          forcedClockOutAt: endTime,
          shiftNote: shiftNoteParts.join('\n\n'),
        });

        logAudit?.({
          type: 'admin_force_clock_out',
          entityType: 'timesheet',
          entityId: shift.id,
          meta: {
            employeeName: shift.employeeName,
            userId: shift.userId,
            adminEmail: user?.email || '',
          },
        });

        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },
    [taskLogs, timesheets, user?.email, logAudit],
  );

  const handleIdleAutoClockOut = useCallback(async ({ endTime: endTimeArg } = {}) => {
    if (idleAutoClockOutLockRef.current) return;
    idleAutoClockOutLockRef.current = true;
    const { activeTask: task, activeShift: shift, activeTaskNotes: notes } =
      idleShutdownRef.current;
    const IDLE_TAG =
      '[Clock stopped automatically: session was idle — Ignite PM kiosk]';
    // Backdate the clock-out to when the idle deadline expired (e.g. the
    // laptop slept overnight) so idle hours are not recorded as work time.
    const endTime = Math.min(
      Number(endTimeArg) > 0 ? Number(endTimeArg) : Date.now(),
      Date.now(),
    );
    let shiftUpdateError = null;
    try {
      if (task?.id) {
        try {
          const segment = Math.max(
            0,
            endTime - (task.lastResumeTime || task.clockInTime),
          );
          const newTotal = (task.totalSavedDuration || 0) + segment;
          const base = String(notes || '').trim() || String(task.notes || '').trim();
          const finalNotes = base ? `${base}\n\n${IDLE_TAG}` : IDLE_TAG;
          await updateDoc(doc(db, 'taskLogs', task.id), {
            clockOutTime: endTime,
            status: 'completed',
            totalSavedDuration: newTotal,
            duration: newTotal,
            notes: finalNotes,
          });
          setActiveTaskNotes('');
        } catch (err) {
          console.error('Idle auto clock-out: task update failed:', err);
        }
      }
      if (shift?.id) {
        try {
          let newTotal = shift.totalSavedDuration || 0;
          if (shift.status === 'active') {
            newTotal += Math.max(
              0,
              endTime - (shift.lastResumeTime || shift.clockInTime),
            );
          }
          await updateDoc(doc(db, 'timesheets', shift.id), {
            clockOutTime: endTime,
            status: 'completed',
            totalSavedDuration: newTotal,
            duration: newTotal,
            autoStoppedReason: 'idle_timeout',
            autoStoppedAt: endTime,
            shiftNote: IDLE_TAG,
          });
        } catch (err) {
          shiftUpdateError = err;
          console.error('Idle auto clock-out: shift update failed:', err);
        }
      }
    } finally {
      idleAutoClockOutLockRef.current = false;
    }
    if (shiftUpdateError) {
      window.alert(
        'Could not end your shift automatically after idle timeout. Please clock out manually or try again.',
      );
    }
  }, []);

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

    const manualClient = clients.find((c) => c.name === manualTaskValues.clientName);
    if (!isClientActiveForWork(manualClient)) {
      return alert('That client is inactive or archived. Manual tasks can only be logged for active clients.');
    }
    
    const isProject = manualTaskValues.billingTarget.startsWith('project_');
    const targetId = isProject ? manualTaskValues.billingTarget.replace('project_', '') : null;
    const projName = isProject ? 'Custom Project' : manualTaskValues.billingTarget.replace('retainer_', '');

    // Parse date-only values as LOCAL noon — `new Date('YYYY-MM-DD')` is
    // interpreted as UTC midnight, which lands on the previous local day in
    // negative-offset timezones and books the task into the wrong cycle.
    const startMs = (() => {
      const raw = String(manualTaskValues.date || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split('-').map(Number);
        return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
      }
      return new Date(raw).getTime();
    })();
    if (!Number.isFinite(startMs)) return alert('Invalid date');
    const durationMs = ((Number(manualTaskValues.hours) || 0) * 3600000) + ((Number(manualTaskValues.minutes) || 0) * 60000);
    const endMs = startMs + durationMs;

    const shiftDoc = await addDoc(collection(db, 'timesheets'), {
      employeeName: manualTaskValues.employeeName, clockInTime: startMs, clockOutTime: endMs, duration: durationMs, totalSavedDuration: durationMs, status: 'completed', userId: 'manual', isManual: true
    });

    await addDoc(collection(db, 'taskLogs'), {
      shiftId: shiftDoc.id, userId: 'manual', clientName: manualTaskValues.clientName,
      clientId: manualClient?.id || '',
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
        clientId: clientObj?.id || '',
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
    if (!expenseValues.billingTarget) return;

    const isProject = expenseValues.billingTarget.startsWith('project_');
    const targetId = isProject ? expenseValues.billingTarget.replace('project_', '') : null;
    const catName = isProject ? 'Custom Project' : expenseValues.billingTarget.replace('retainer_', '');

    const isPerplexity = expenseValues.inputMode === 'perplexity_credits';
    const isDollar = isDollarCategory(expenseModal, catName);
    const clientRate = expenseModal.hourlyRate || 0;
    const applyMarkup = expenseValues.applyMarkup !== false && !isDollar;

    let rawAmount;
    let finalCost;
    let equivalentHours;
    let originalCurrency;
    let originalAmount;
    let perplexityCredits;
    let description = expenseValues.description;

    if (isPerplexity) {
      const credits = Number(expenseValues.perplexityCredits);
      if (!Number.isFinite(credits) || credits <= 0) return;
      const computed = computePerplexityExpenseAmounts(credits, {
        applyMarkup: expenseValues.applyMarkup !== false,
        hourlyRate: clientRate,
        isDollar,
      });
      rawAmount = computed.rawAmount;
      finalCost = computed.finalCost;
      equivalentHours = computed.equivalentHours;
      originalCurrency = 'PERPLEXITY_CREDITS';
      originalAmount = credits;
      perplexityCredits = credits;
      description = buildPerplexityExpenseDescription(credits, expenseValues.description);
    } else {
      if (!expenseValues.amount) return;
      const currency = expenseValues.currency || 'CAD';
      const rateToCad = FX_TO_CAD[currency] ?? 1;
      const amountInOriginalCurrency = Number(expenseValues.amount);
      const amountCad = amountInOriginalCurrency * rateToCad;
      rawAmount = amountCad;
      finalCost = applyMarkup ? amountCad * 1.30 : amountCad;
      equivalentHours = isDollar ? 0 : clientRate > 0 ? (finalCost / clientRate) : 0;
      originalCurrency = currency;
      originalAmount = amountInOriginalCurrency;
    }

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
      description,
      rawAmount,
      finalCost,
      equivalentHours,
      date: expenseDate,
      originalCurrency,
      originalAmount,
      ...(perplexityCredits != null ? { perplexityCredits } : {}),
      recurring,
      recurringId,
      recurrence,
    });
    setExpenseModal(null);
    setExpenseValues({
      billingTarget: '',
      description: '',
      amount: '',
      perplexityCredits: '',
      inputMode: 'amount',
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
    perplexityCredits: perplexityCreditsInput,
  }) => {
    const clientObj = clients.find((c) => String(c.id) === String(clientId));
    const isDollar = isDollarCategory(clientObj, category);
    const hourlyRate = Number(clientObj?.hourlyRate || 0);

    let rawAmount;
    let finalCost;
    let equivalentHours;
    let originalCurrency;
    let originalAmount;
    let perplexityCredits;
    let expenseDescription = description;

    if (perplexityCreditsInput != null && perplexityCreditsInput !== '') {
      const credits = Number(perplexityCreditsInput);
      if (!clientId || !clientName || !category || !Number.isFinite(credits) || credits <= 0) return;
      const computed = computePerplexityExpenseAmounts(credits, {
        applyMarkup,
        hourlyRate,
        isDollar,
      });
      rawAmount = computed.rawAmount;
      finalCost = computed.finalCost;
      equivalentHours = computed.equivalentHours;
      originalCurrency = 'PERPLEXITY_CREDITS';
      originalAmount = credits;
      perplexityCredits = credits;
      expenseDescription = buildPerplexityExpenseDescription(credits, description);
    } else {
      const amt = Number(amount);
      if (!clientId || !clientName || !category || !Number.isFinite(amt) || amt <= 0) return;
      const fx = FX_TO_CAD[currency] ?? 1;
      rawAmount = amt * fx;
      const shouldMarkup = applyMarkup && !isDollar;
      finalCost = shouldMarkup ? rawAmount * 1.3 : rawAmount;
      equivalentHours = isDollar ? 0 : hourlyRate > 0 ? finalCost / hourlyRate : 0;
      originalCurrency = currency;
      originalAmount = amt;
      expenseDescription = description || 'Logged from kiosk';
    }

    await addDoc(collection(db, 'expenses'), {
      clientId,
      clientName,
      category,
      projectId: projectId || null,
      description: expenseDescription,
      rawAmount,
      finalCost,
      equivalentHours,
      date: Date.now(),
      originalCurrency,
      originalAmount,
      ...(perplexityCredits != null ? { perplexityCredits } : {}),
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

  const parseProjectDeadlineMs = (value) => {
    if (!value || typeof value !== 'string') return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
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

        const portalDue = parseProjectDeadlineMs(projectValues.deadline);
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
          dueDate: portalDue || null,
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
          deadline: '',
        });
        return;
      }

      if (!projectValues.title || !clientId) return;

      const adminDue = parseProjectDeadlineMs(projectValues.deadline);
      await addDoc(collection(db, 'projects'), {
        clientId,
        clientName,
        title: projectValues.title,
        description: projectValues.description,
        category: projectValues.category || null,
        requestDescription: projectValues.requestDescription || null,
        estimatedBudget: Number(projectValues.estimatedBudget) || 0,
        estimatedHours: Number(projectValues.estimatedHours) || 0,
        dueDate: adminDue || null,
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
        deadline: '',
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

  const todoCategoryKey = (cat) =>
    String(cat ?? '').replace(/[~*[\]/]/g, '_').replace(/\./g, '_');

  const carryoverCategoryKey = (cat) =>
    String(cat ?? '').replace(/[~*[\]/]/g, '_').replace(/\./g, '_');

  const getTodoStateForCycle = (client, cycleStart) => {
    const cycles = client.todoCycles || {};
    const currentCycleStart = getBillingPeriod(client.billingDay || 1, 0).start;
    const existing = cycles[String(cycleStart)];
    if (existing) {
      if (cycleStart !== currentCycleStart) return existing;
      const prevStart = getBillingPeriod(client.billingDay || 1, -1).start;
      const prevData = cycles[String(prevStart)] || {};
      return mergeOpenItemsFromPrevCycle(existing, prevData);
    }
    if (cycleStart !== currentCycleStart) return {};
    const prevStart = getBillingPeriod(client.billingDay || 1, -1).start;
    const prevData = cycles[String(prevStart)] || {};
    // Carry over *all* previously-existing category keys (including custom project
    // task categories), not just retainer categories + General.
    const categoryKeys = new Set([
      ...getEnabledRetainerCategoryNames(client).map((cat) => todoCategoryKey(cat)),
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
          subtasks: subtasksForCarryover(i),
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
          const newParentDue = computeRecurringDueDate(effectiveRecurrence, cycleStart);
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
            dueDate: newParentDue,
            subtasks: projectSubtasksForNewRecurringPrimaryCycle(
              i,
              newParentDue,
              cycleStart,
            ),
          };
        });
      // Don't seed a fresh instance when the carried-over open copy already
      // represents the same occurrence (identical-looking duplicates).
      const dedupedRecurring = dedupeRecurringSeedsAgainstCarried(carried, recurring);
      result[ck] = { closed: false, items: [...carried, ...dedupedRecurring] };
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
      ...getEnabledRetainerCategoryNames(client).map((cat) => todoCategoryKey(cat)),
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
          subtasks: subtasksForCarryover(i),
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
          const newParentDue = computeRecurringDueDate(effectiveRecurrence, cycleStart);
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
            dueDate: newParentDue,
            subtasks: projectSubtasksForNewRecurringPrimaryCycle(
              i,
              newParentDue,
              cycleStart,
            ),
          };
        });
      // Same dedupe as getTodoStateForCycle: never persist a seed that
      // duplicates a carried-over open instance of the series.
      const dedupedRecurring = dedupeRecurringSeedsAgainstCarried(carried, recurring);
      cycles[String(cycleStart)][ck] = { closed: false, items: [...carried, ...dedupedRecurring] };
    });
    return cycles;
  };

  const newRecurringTodoRowId = useCallback(
    () => `todo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    [],
  );

  const resolveClient = useCallback((clientOrId) => {
    const id =
      typeof clientOrId === 'string' ? clientOrId : clientOrId?.id;
    if (!id) return null;
    return (
      clientsRef.current.find((c) => c.id === id) ||
      (typeof clientOrId === 'object' ? clientOrId : null)
    );
  }, []);

  const updateClientTodo = async (client, cycleStart, categoryKey, nextCategoryData) => {
    const freshClient = resolveClient(client) || client;
    const cycles = ensureCurrentCycleTodoData(freshClient, cycleStart);
    const cycleData = cycles[String(cycleStart)] || {};
    cycles[String(cycleStart)] = { ...cycleData, [categoryKey]: nextCategoryData };
    const period = getBillingPeriod(freshClient.billingDay || 1, 0);
    if (String(cycleStart) === String(period.start)) {
      const slice = cycles[String(cycleStart)];
      const { cycleDataByCategory, changed } = reconcileRecurringTodoInstances(
        slice,
        period.start,
        period.end,
        newRecurringTodoRowId,
      );
      if (changed) cycles[String(cycleStart)] = cycleDataByCategory;
    }
    const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(freshClient, cycles);
    await updateDoc(doc(db, 'clients', freshClient.id), { todoCycles: cycles, ...teamAccessPatch });
  };

  /** Mark a primary client task complete across every stored billing cycle copy. */
  const setClientTodoItemDone = useCallback(
    async (client, cycleStart, categoryKey, item, done = true) => {
      const freshClient = resolveClient(client) || client;
      if (!freshClient?.id || !item?.id) return false;

      if (done && !canMarkParentTodoDone(item)) return false;

      const period = getBillingPeriod(freshClient.billingDay || 1, 0);
      let cycles = { ...(freshClient.todoCycles || {}) };
      if (String(cycleStart) === String(period.start)) {
        cycles = ensureCurrentCycleTodoData(freshClient, cycleStart);
      }

      const todoState = getTodoStateForCycle(freshClient, cycleStart);
      const catTodo = todoState[categoryKey] || { closed: false, items: [] };
      const items = catTodo.items || [];
      if (!items.some((row) => row?.id === item.id)) return false;

      if (done) {
        const nextItems = items.map((row) =>
          row.id === item.id
            ? { ...row, done: true, doneAt: Date.now() }
            : row,
        );
        cycles[String(cycleStart)] = {
          ...(cycles[String(cycleStart)] || {}),
          [categoryKey]: { ...catTodo, items: nextItems },
        };

        let recurringSkipKey = '';
        if (item.recurring) {
          recurringSkipKey = recurringAnchorKey(
            item.recurringId || item.id,
            item.dueDate,
          );
        }

        const { cycles: markedCycles, touched } = markPrimaryTodoDoneAcrossCycles(
          cycles,
          categoryKey,
          item.id,
          true,
          { recurringSkipKey },
        );
        if (!touched) return false;
        cycles = markedCycles;

        if (String(cycleStart) === String(period.start)) {
          const slice = cycles[String(period.start)];
          const { cycleDataByCategory, changed } = reconcileRecurringTodoInstances(
            slice,
            period.start,
            period.end,
            newRecurringTodoRowId,
          );
          if (changed) cycles[String(period.start)] = cycleDataByCategory;
        }
      } else {
        const nextItems = items.map((row) =>
          row.id === item.id ? { ...row, done: false, doneAt: null } : row,
        );
        cycles[String(cycleStart)] = {
          ...(cycles[String(cycleStart)] || {}),
          [categoryKey]: { ...catTodo, items: nextItems },
        };
      }

      const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(freshClient, cycles);
      await updateDoc(doc(db, 'clients', freshClient.id), {
        todoCycles: cycles,
        ...teamAccessPatch,
      });
      return true;
    },
    [resolveClient, newRecurringTodoRowId],
  );

  // Batch update multiple to-do categories in a single Firestore write.
  // This is important because calling `updateClientTodo` multiple times in a row
  // would otherwise overwrite earlier category updates based on stale client state.
  const updateClientTodosBatch = async (client, cycleStart, categoryKeyToData) => {
    const freshClient = resolveClient(client) || client;
    const cycles = ensureCurrentCycleTodoData(freshClient, cycleStart);
    const cycleData = cycles[String(cycleStart)] || {};
    cycles[String(cycleStart)] = {
      ...cycleData,
      ...categoryKeyToData,
    };
    const period = getBillingPeriod(freshClient.billingDay || 1, 0);
    if (String(cycleStart) === String(period.start)) {
      const slice = cycles[String(cycleStart)];
      const { cycleDataByCategory, changed } = reconcileRecurringTodoInstances(
        slice,
        period.start,
        period.end,
        newRecurringTodoRowId,
      );
      if (changed) cycles[String(cycleStart)] = cycleDataByCategory;
    }
    const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(freshClient, cycles);
    await updateDoc(doc(db, 'clients', freshClient.id), { todoCycles: cycles, ...teamAccessPatch });
  };

  /** Delete a client task (or sub-task) in one Firestore write; removes primary tasks from all cycles. */
  const deleteClientTodoItem = useCallback(
    async (
      clientId,
      cycleStart,
      categoryKey,
      itemId,
      { subtaskId, scope = 'occurrence' } = {},
    ) => {
      const client = resolveClient(clientId);
      if (!client?.id) return false;

      if (subtaskId) {
        const cycles = ensureCurrentCycleTodoData(client, cycleStart);
        const cat =
          cycles[String(cycleStart)]?.[categoryKey] || { closed: false, items: [] };
        const list = cat.items || [];
        if (!list.some((i) => i?.id === itemId)) return false;
        const nextList = removeSubtaskFromItems(list, itemId, subtaskId);
        await updateClientTodo(client, cycleStart, categoryKey, {
          ...cat,
          items: nextList,
        });
        return true;
      }

      const todoState = getTodoStateForCycle(client, cycleStart);
      const catTodo = todoState[categoryKey] || { closed: false, items: [] };
      const item = (catTodo.items || []).find((i) => i?.id === itemId);
      if (!item) return false;

      let cycles = ensureCurrentCycleTodoData(client, cycleStart);

      // Recurring + "delete all future": end the whole series everywhere.
      if (item.recurring && scope === 'series') {
        const rid = String(item.recurringId || item.id || '');
        const { cycles: endedCycles, touched } = removeRecurringSeriesFromAllCycles(
          cycles,
          categoryKey,
          rid,
        );
        if (!touched) return false;
        const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(
          client,
          endedCycles,
        );
        await updateDoc(doc(db, 'clients', client.id), {
          todoCycles: endedCycles,
          ...teamAccessPatch,
        });
        return true;
      }

      let recurringSkipKey = '';
      if (item.recurring) {
        recurringSkipKey = recurringAnchorKey(
          item.recurringId || item.id,
          item.dueDate,
        );
      }

      const { cycles: strippedCycles, removed } = removeTodoItemFromAllCycles(
        cycles,
        categoryKey,
        itemId,
        { recurringSkipKey },
      );
      if (!removed) return false;

      cycles = strippedCycles;
      if (recurringSkipKey) {
        cycles = ensureRecurringSkipOnCategory(
          cycles,
          String(cycleStart),
          categoryKey,
          recurringSkipKey,
        );
      }

      // Occurrence-only delete of a recurring task: if this was the last live
      // instance of the series anywhere, re-seed the next occurrence so the
      // series keeps going (otherwise it would silently end).
      if (item.recurring && scope === 'occurrence') {
        const rid = String(item.recurringId || item.id || '');
        const seriesStillAlive = Object.values(cycles).some((cycleData) => {
          const cat = cycleData?.[categoryKey];
          return (cat?.items || []).some(
            (row) =>
              row?.recurring && String(row.recurringId || row.id || '') === rid,
          );
        });
        if (!seriesStillAlive) {
          const fresh = seedNextRecurringOccurrence(
            item,
            Number(item.dueDate || Date.now()),
            newRecurringTodoRowId,
          );
          if (fresh) {
            const cycleKey = String(cycleStart);
            const cat = cycles[cycleKey]?.[categoryKey] || {
              closed: false,
              items: [],
            };
            cycles[cycleKey] = {
              ...(cycles[cycleKey] || {}),
              [categoryKey]: { ...cat, items: [...(cat.items || []), fresh] },
            };
          }
        }
      }

      const period = getBillingPeriod(client.billingDay || 1, 0);
      if (String(cycleStart) === String(period.start)) {
        const slice = cycles[String(cycleStart)];
        const { cycleDataByCategory, changed } = reconcileRecurringTodoInstances(
          slice,
          period.start,
          period.end,
          newRecurringTodoRowId,
        );
        if (changed) cycles[String(cycleStart)] = cycleDataByCategory;
      }

      const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(client, cycles);
      await updateDoc(doc(db, 'clients', client.id), {
        todoCycles: cycles,
        ...teamAccessPatch,
      });
      return true;
    },
    [resolveClient, newRecurringTodoRowId],
  );

  const uploadClientDocument = useCallback(
    async (client, file, options = {}) => {
      if (!client?.id || !file) throw new Error('Missing client or file.');
      const validationError = validateClientUploadFile(file);
      if (validationError) throw new Error(validationError);

      const {
        linkedTodoId = null,
        linkedTodoText = null,
        linkedCategoryKey = null,
        linkedCycleStart = null,
      } = options;

      if (linkedTodoId) {
        const freshClient = clients.find((c) => c.id === client.id) || client;
        const cycleKey = String(linkedCycleStart);
        const cat = freshClient.todoCycles?.[cycleKey]?.[linkedCategoryKey];
        const item = (cat?.items || []).find((i) => i.id === linkedTodoId);
        if (item && getTodoAttachments(item).length >= MAX_TODO_ATTACHMENTS) {
          throw new Error(`Maximum ${MAX_TODO_ATTACHMENTS} attachments per task.`);
        }
      }

      const documentId = newDocumentId();
      const path = buildClientFileStoragePath(client.id, documentId, file.name);
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file, {
        contentType: file.type || 'application/octet-stream',
      });
      const url = await getDownloadURL(ref);
      const record = buildClientDocumentRecord({
        id: documentId,
        name: file.name,
        storagePath: path,
        contentType: file.type,
        sizeBytes: file.size,
        uploadedBy: user?.email || myAdminDoc?.email || '',
        url,
        linkedTodoId,
        linkedTodoText,
        linkedCategoryKey,
        linkedCycleStart,
      });

      const freshClient = clients.find((c) => c.id === client.id) || client;
      const documents = [...(freshClient.documents || []), record];
      const patch = { documents };

      if (linkedTodoId && linkedCategoryKey != null && linkedCycleStart != null) {
        const cycles = ensureCurrentCycleTodoData(freshClient, linkedCycleStart);
        const cycleKey = String(linkedCycleStart);
        const catTodo = cycles[cycleKey]?.[linkedCategoryKey];
        if (catTodo?.items) {
          const nextItems = catTodo.items.map((item) =>
            item.id === linkedTodoId ? addAttachmentToItem(item, record) : item,
          );
          cycles[cycleKey] = {
            ...cycles[cycleKey],
            [linkedCategoryKey]: { ...catTodo, items: nextItems },
          };
          patch.todoCycles = cycles;
          Object.assign(
            patch,
            buildTeamAccessMergeForTodoAssignees(freshClient, cycles),
          );
        }
      }

      await updateDoc(doc(db, 'clients', client.id), patch);
      return record;
    },
    [clients, user?.email, myAdminDoc?.email],
  );

  const removeClientDocument = useCallback(
    async (client, documentId) => {
      if (!client?.id || !documentId) return;
      const freshClient = clients.find((c) => c.id === client.id) || client;
      const docRecord = (freshClient.documents || []).find((d) => d.id === documentId);
      const documents = (freshClient.documents || []).filter((d) => d.id !== documentId);
      const todoCycles = removeDocumentFromTodoCycles(
        freshClient.todoCycles || {},
        documentId,
      );

      if (docRecord?.storagePath) {
        try {
          await deleteObject(storageRef(storage, docRecord.storagePath));
        } catch {
          // File may already be gone.
        }
      }

      await updateDoc(doc(db, 'clients', client.id), { documents, todoCycles });
    },
    [clients],
  );

  // Periodically materialize missing recurring rows (e.g. weekly anchors) even when
  // no one edits a category that billing period.
  useEffect(() => {
    if (!user || !clients?.length) return;

    const run = async () => {
      if (recurringTodoReconcileInFlightRef.current) return;
      recurringTodoReconcileInFlightRef.current = true;
      try {
        for (const client of clients) {
          const bd = client.billingDay || 1;
          const period = getBillingPeriod(bd, 0);
          const key = String(period.start);
          const existing = (client.todoCycles || {})[key];
          if (!existing || typeof existing !== 'object') continue;

          const { cycleDataByCategory, changed } = reconcileRecurringTodoInstances(
            existing,
            period.start,
            period.end,
            newRecurringTodoRowId,
          );
          if (!changed) continue;

          const cycles = { ...(client.todoCycles || {}), [key]: cycleDataByCategory };
          const teamAccessPatch = buildTeamAccessMergeForTodoAssignees(client, cycles);
          try {
            await updateDoc(doc(db, 'clients', client.id), {
              todoCycles: cycles,
              ...teamAccessPatch,
            });
          } catch {
            // Offline / permission — skip
          }
        }
      } finally {
        recurringTodoReconcileInFlightRef.current = false;
      }
    };

    run();
    const interval = setInterval(run, 2 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [clients, user, newRecurringTodoRowId]);

  // Extracted to utils/billingEngine.js; bind the live collections here.
  const getGlobalRetainerStats = (client, mStart, mEnd) =>
    computeGlobalRetainerStats(client, mStart, mEnd, { taskLogs, expenses, addons });

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
    const matchesSearch = searchQuery === '' || String(shift.employeeName || '').toLowerCase().includes(searchQuery.toLowerCase()) || taskLogs.some(t => t.shiftId === shift.id && String(t.clientName || '').toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesClient = clientFilter === '' || taskLogs.some(t => t.shiftId === shift.id && t.clientName === clientFilter);
    let matchesDate = true;
    if (currentRange.start && currentRange.end) matchesDate = shift.clockInTime >= currentRange.start && shift.clockInTime <= currentRange.end;
    return matchesSearch && matchesClient && matchesDate;
  });

  const toggleShiftAccordion = (shiftId) => { setExpandedShifts(prev => ({ ...prev, [shiftId]: !prev[shiftId] })); };
  const toggleClientAccordion = (clientId) => { setExpandedClients(prev => ({ ...prev, [clientId]: !prev[clientId] })); };

  const startEditing = (type, item) => {
    setEditingItem({ type, id: item.id });
    const clockInDate = formatMsForDatetimeLocal(item.clockInTime);
    const clockOutDate = item.clockOutTime
      ? formatMsForDatetimeLocal(item.clockOutTime)
      : '';
    if (type === 'shift') {
      const rawHours = getShiftDuration(item) / 3600000;
      const steppedHours = Math.min(12, Math.max(0, Math.round(rawHours * 4) / 4));
      const origIn = Number(item.clockInTime || 0);
      const origOut = Number(item.clockOutTime || 0);
      const origDuration = Number(item.duration ?? item.totalSavedDuration ?? 0);
      const breakMs =
        origIn && origOut && origOut > origIn && origDuration > 0
          ? Math.max(0, origOut - origIn - origDuration)
          : 0;
      setEditValues({
        ...item,
        clockInDate,
        clockOutDate,
        editDurationHours: steppedHours || (rawHours > 0 ? 0.25 : 0),
        editBreakMs: breakMs,
      });
      return;
    }
    const billingTarget = item.projectId
      ? `project_${item.projectId}`
      : `retainer_${item.projectName || ''}`;
    const rawHours = getTaskDurationHours(item, getTaskDuration);
    const steppedHours = Math.min(12, Math.max(0, Math.round(rawHours * 4) / 4));
    setEditValues({
      ...item,
      clockInDate,
      clockOutDate,
      editDurationHours: steppedHours || (rawHours > 0 ? 0.25 : 0),
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
    const clockInMs = parseDatetimeLocalToMs(editValues.clockInDate);
    if (!Number.isFinite(clockInMs)) {
      window.alert('Clock in time is invalid. Use the date and time picker.');
      return;
    }
    updates.clockInTime = clockInMs;

    const durationHours = Number(editValues.editDurationHours || 0);
    if (durationHours <= 0) {
      window.alert('Please set a duration greater than zero.');
      return;
    }
    const durationMs = durationHours * 3600000;
    if (editingItem.type === 'task') {
      updates.clockOutTime = clockInMs + durationMs;
      updates.duration = durationMs;
      updates.totalSavedDuration = durationMs;
    } else {
      const breakMs = Number(editValues.editBreakMs || 0);
      updates.duration = durationMs;
      updates.totalSavedDuration = durationMs;
      updates.clockOutTime = clockInMs + durationMs + breakMs;
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
    delete updates.editDurationHours;
    delete updates.editBreakMs;
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
            t.notes || ""
          ]);
        });
      }
    });

    // Quote every field so commas/quotes/newlines in names or notes can't
    // shift columns in the export.
    const csvContent = rows
      .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Ignite_Report_${new Date().toLocaleDateString().replace(/[/\\]/g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.alert(
        'Could not open the report window. Allow pop-ups for this site and try again.',
      );
      return;
    }
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
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f11]">
        <RotateCw className="w-8 h-8 text-[#fd7414] animate-spin" />
      </div>
    );
  }

  // Global Auth Gate
  if (
    user &&
    !isUserAdmin &&
    !isClientUser &&
    !userEmailLower.endsWith('@ignitepm.com') &&
    !(ENABLE_DEMOS && (user.uid === 'demo-user-123' || user.uid === 'demo-client-123'))
  ) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0f0f11] p-6">
        <div className="bg-white p-12 rounded-[40px] shadow-2xl border border-slate-100 text-center max-w-sm w-full">
          <Shield className="w-16 h-16 text-red-500 mx-auto mb-6" />
          <h2 className="text-2xl font-black mb-2">Access Denied</h2>
          <p className="text-slate-500 text-sm mb-6 font-medium">Your account ({String(user?.email || '').trim() || user?.uid || 'unknown'}) is not authorized. Please contact an administrator.</p>
          <button onClick={() => { setUser(null); signOut(auth); }} className="w-full bg-slate-100 text-slate-600 p-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-200 transition-all">Sign Out</button>
        </div>
      </div>
    );
  }

  // --- LOGIN SCREEN ---
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0f0f11] p-6">
        <div className="bg-white p-10 rounded-[40px] shadow-2xl border border-slate-100 flex flex-col items-center max-w-sm w-full text-center">
          <div className="w-28 h-28 mb-4 flex items-center justify-center"><IgniteLogo className="w-full h-full object-contain" /></div>
          <h1 className="text-3xl font-black text-slate-900 mb-1 tracking-tight">Ignite PM</h1>
          <p className="text-slate-400 font-bold mb-6 uppercase tracking-widest text-[10px]">Internal Workspace TimeTracker</p>
          
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 font-bold">{error}</div>}
          
          <form onSubmit={handleEmailAuth} className="w-full space-y-3 mb-4 text-left">
            <input type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" required />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" required />
            
            <button type="submit" className="w-full bg-[#fd7414] text-white py-4 rounded-2xl font-black transition-all shadow-lg hover:bg-[#e66a12] active:scale-95 text-lg">
              Sign In
            </button>
          </form>

          <div className="flex flex-col gap-2 justify-center items-center w-full px-2 mb-6">
            <button type="button" onClick={handleResetPassword} className="text-xs font-bold text-slate-500 hover:text-[#fd7414] transition-colors">
              Forgot Password?
            </button>
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
    clients: clients
      .filter(isClientActiveForWork)
      .filter((c) =>
        teamMemberCanViewClient(
          c,
          String(user?.email || myAdminDoc?.email || '').trim().toLowerCase(),
        ),
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
    setClientTodoItemDone,
    deleteClientTodoItem,
    todoCategoryKey,
    projects,
    queueKioskTaskStart,
    userTodos,
    updateUserTodos,
    adminUsers,
    currentUserRole,
    staffEmail: String(user?.email || myAdminDoc?.email || '').trim().toLowerCase(),
    uploadClientDocument,
    removeClientDocument,
    handleIdleAutoClockOut,
  };

  const adminDashboardBaseProps = {
    adminTab,
    setAdminTab,
    currentUserRole,
    previewClientPortal: (clientId) => setPortalPreviewClientId(clientId),
    notifySettings,
    updateNotifySettings: (patch) =>
      setDoc(doc(db, 'settings', 'notifications'), patch, { merge: true }),
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
    setClientTodoItemDone,
    deleteClientTodoItem,
    uploadClientDocument,
    removeClientDocument,
    todoCategoryKey,
    userTodos,
    updateUserTodos,
    updatePolicy,
    navigateToKioskWithTask: (clientName, billingTarget) => {
      const cl = clients.find((c) => c.name === clientName);
      if (!isClientActiveForWork(cl)) return;
      navigate(
        `/kiosk?autostart=1&client=${encodeURIComponent(clientName)}&target=${encodeURIComponent(billingTarget)}`,
      );
    },
    forceClockOutShift,
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

  const portalPreviewClient =
    isUserAdmin && portalPreviewClientId
      ? clients.find((c) => c.id === portalPreviewClientId) || null
      : null;

  const content = portalPreviewClient ? (
    <div>
      <div className="sticky top-0 z-50 bg-amber-400 text-black px-4 py-2.5 flex items-center justify-between gap-3 shadow-md">
        <span className="text-xs font-black uppercase tracking-widest">
          Previewing client portal — {portalPreviewClient.name} (what this
          client&apos;s contacts see when they sign in)
        </span>
        <button
          type="button"
          onClick={() => setPortalPreviewClientId(null)}
          className="px-4 py-1.5 rounded-xl bg-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shrink-0"
        >
          Exit preview
        </button>
      </div>
      <ClientPortal
        clientProfile={portalPreviewClient}
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
        setUser={() => {}}
        signOut={() => setPortalPreviewClientId(null)}
        auth={auth}
      />
    </div>
  ) : view === 'client_portal' && clientProfile ? (
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
      <div className="min-h-screen bg-[#0f0f11] text-zinc-100 font-sans">
        <nav className="sticky top-0 z-40 border-b border-white/10 bg-[#0f0f11]/90 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[min(1720px,calc(100vw-1.5rem))] items-center justify-between px-4 py-3 sm:px-6">
            <div
              className="flex items-center gap-2 group cursor-pointer"
              onClick={() => navigate('/kiosk')}
            >
              <div className="w-10 h-10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <IgniteLogo className="w-full h-full object-contain" />
              </div>
              <span className="font-black text-xl tracking-tighter text-white hidden sm:inline">
                TimeTracker
              </span>
            </div>

          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1.5">
              <button
                onClick={() => navigate('/kiosk')}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  view === 'employee'
                    ? 'bg-[#fd7414] text-white shadow-md shadow-[#fd7414]/25'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Kiosk
              </button>
            {currentUserRole === 'kiosk' ? (
              <button
                onClick={() => navigate('/workspace')}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  view === 'admin'
                    ? 'bg-[#fd7414] text-white shadow-md shadow-[#fd7414]/25'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Workspace
              </button>
            ) : (
              <button
                onClick={() => navigate('/admin')}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  view === 'admin'
                    ? 'bg-[#fd7414] text-white shadow-md shadow-[#fd7414]/25'
                    : 'text-zinc-400 hover:text-white'
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
                className="ml-1 p-2 text-zinc-500 hover:text-white transition-colors"
                title="Sign out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </nav>

        <main className="mx-auto w-full max-w-[min(1720px,calc(100vw-1.5rem))] px-4 py-6 pb-24 sm:px-6 sm:py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/kiosk" replace />} />
            <Route
              path="/kiosk"
              element={
                <div data-kiosk-theme="dark" className="w-full">
                  <KioskRouteView {...kioskRouteProps} />
                </div>
              }
            />
            <Route
              path="/admin"
              element={
                currentUserRole === 'kiosk' ? (
                  <Navigate to="/workspace" replace />
                ) : (
                  <StaffThemeShell>
                    <AdminDashboardRouteView
                      adminDashboardProps={adminDashboardRouteProps}
                      navigate={navigate}
                    />
                  </StaffThemeShell>
                )
              }
            />
            <Route
              path="/admin/clients/:clientId"
              element={
                currentUserRole === 'kiosk' ? (
                  <RedirectKioskAdminClientToWorkspace />
                ) : (
                  <StaffThemeShell>
                    <AdminDashboardRouteView
                      adminDashboardProps={adminDashboardRouteProps}
                      navigate={navigate}
                    />
                  </StaffThemeShell>
                )
              }
            />
            <Route
              path="/workspace"
              element={
                currentUserRole === 'kiosk' ? (
                  <StaffThemeShell>
                    <AdminDashboardRouteView
                      adminDashboardProps={workspaceDashboardRouteProps}
                      navigate={navigate}
                    />
                  </StaffThemeShell>
                ) : (
                  <Navigate to="/admin" replace />
                )
              }
            />
            <Route
              path="/workspace/clients/:clientId"
              element={
                currentUserRole === 'kiosk' ? (
                  <StaffThemeShell>
                    <AdminDashboardRouteView
                      adminDashboardProps={workspaceDashboardRouteProps}
                      navigate={navigate}
                    />
                  </StaffThemeShell>
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
                    {clients.filter(isClientActiveForWork).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-1 space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Billing Target</label>
                  <select value={manualTaskValues.billingTarget} onChange={e => setManualTaskValues({...manualTaskValues, billingTarget: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]">
                    <option value="">Select Target...</option>
                    <optgroup label="Monthly Retainers">
                      <option value={`retainer_${GENERAL_LABEL}`}>{GENERAL_LABEL}</option>
                      {manualTaskValues.clientName &&
                        (() => {
                          const client = clients.find(
                            (c) => c.name === manualTaskValues.clientName,
                          );
                          return getEnabledRetainerCategoryNames(client || {}).map(
                            (t) => (
                              <option key={t} value={`retainer_${t}`}>
                                {t}
                              </option>
                            ),
                          );
                        })()}
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
                        {getEnabledRetainerCategoryNames(expenseModal).map((t) => (
                          <option key={t} value={`retainer_${t}`}>
                            {t}
                          </option>
                        ))}
                      </optgroup>
                      {clientActiveProjectsExp.length > 0 && (
                        <optgroup label="Custom Projects">
                          {clientActiveProjectsExp.map(p => <option key={p.id} value={`project_${p.id}`}>{p.title}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Expense Type</label>
                    <select
                      value={expenseValues.inputMode || 'amount'}
                      onChange={(e) =>
                        setExpenseValues({
                          ...expenseValues,
                          inputMode: e.target.value,
                          amount: '',
                          perplexityCredits: '',
                        })
                      }
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="amount">Dollar amount</option>
                      <option value="perplexity_credits">Perplexity Computer Credits</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Expense Description</label>
                    <input type="text" value={expenseValues.description} onChange={e => setExpenseValues({...expenseValues, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder={expenseValues.inputMode === 'perplexity_credits' ? 'Optional note (credits are logged automatically)' : 'e.g., Backlinks, Software...'} />
                  </div>
                  {expenseValues.inputMode === 'perplexity_credits' ? (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Credits used</label>
                      <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl px-4 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="0"
                          value={expenseValues.perplexityCredits}
                          onChange={(e) => setExpenseValues({ ...expenseValues, perplexityCredits: e.target.value })}
                          className="w-full bg-transparent p-4 font-black text-2xl outline-none text-slate-900"
                        />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
                          credits
                        </span>
                      </div>
                      <p className="text-[10px] font-bold text-slate-500">
                        1 credit = $0.01 CAD before markup
                      </p>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
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
                  {expenseValues.amount && expenseValues.inputMode !== 'perplexity_credits' && (
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
                  {expenseValues.perplexityCredits && expenseValues.inputMode === 'perplexity_credits' && (
                    (() => {
                      const credits = Number(expenseValues.perplexityCredits);
                      const retainerCat = expenseValues.billingTarget?.startsWith('retainer_')
                        ? expenseValues.billingTarget.replace('retainer_', '')
                        : null;
                      const isDollar = retainerCat && isDollarCategory(expenseModal, retainerCat);
                      const computed = computePerplexityExpenseAmounts(credits, {
                        applyMarkup: expenseValues.applyMarkup !== false,
                        hourlyRate: expenseModal.hourlyRate,
                        isDollar,
                      });
                      return (
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2 mt-4">
                          <div className="flex justify-between text-xs font-bold text-slate-500">
                            <span>Credits × $0.01:</span>
                            <span>${computed.rawAmount.toFixed(2)} CAD</span>
                          </div>
                          {computed.applyMarkup && (
                            <>
                              <div className="flex justify-between text-xs font-bold text-slate-500">
                                <span>Markup (30%):</span>
                                <span className="text-emerald-500">
                                  +${(computed.rawAmount * 0.3).toFixed(2)}
                                </span>
                              </div>
                              <div className="h-px bg-slate-200 my-1" />
                            </>
                          )}
                          <div className="flex justify-between font-black text-slate-800">
                            <span>Final Cost (CAD):</span>
                            <span>${computed.finalCost.toFixed(2)}</span>
                          </div>
                          {isDollar ? (
                            <div className="flex justify-between text-[10px] font-black uppercase text-slate-500 pt-2">
                              <span>Dollar category</span>
                              <span>No hours deduction</span>
                            </div>
                          ) : (
                            <div className="flex justify-between text-[10px] font-black uppercase text-[#fd7414] pt-2">
                              <span>Retainer Deduction:</span>
                              <span>{computed.equivalentHours.toFixed(2)} hrs</span>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}

                  <button
                    onClick={saveExpense}
                    disabled={
                      !expenseValues.billingTarget ||
                      (expenseValues.inputMode === 'perplexity_credits'
                        ? !expenseValues.perplexityCredits || Number(expenseValues.perplexityCredits) <= 0
                        : !expenseValues.amount)
                    }
                    className="w-full bg-blue-600 text-white p-5 rounded-2xl font-black text-lg shadow-xl shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-30 mt-4"
                  >
                    Log Expense
                  </button>
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
              <div className="space-y-2 text-left">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Clock In Time</label>
                <input type="datetime-local" value={editValues.clockInDate} onChange={e => setEditValues({...editValues, clockInDate: e.target.value})} className="w-full bg-slate-50 border-slate-200 border p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]" />
              </div>

              <div className="space-y-2 text-left rounded-2xl border border-slate-100 bg-slate-50/80 p-5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block mb-1">
                  Duration (adjust hours logged)
                </label>
                <DurationSlider
                  valueHours={editValues.editDurationHours ?? 0}
                  onChange={(hours) => setEditValues({ ...editValues, editDurationHours: hours })}
                  startTimeMs={parseDatetimeLocalToMs(editValues.clockInDate)}
                  extraEndMs={editingItem.type === 'shift' ? Number(editValues.editBreakMs || 0) : 0}
                  maxHours={12}
                />
                {editingItem.type === 'shift' && Number(editValues.editBreakMs || 0) > 0 && (
                  <p className="text-[10px] font-bold text-slate-400 mt-2">
                    Break time from the original shift is preserved and added to the end time shown above.
                  </p>
                )}
              </div>

              {editingItem.type === 'shift' && (
                <p className="text-xs font-bold text-slate-500 text-left">
                  Employee{' '}
                  <span className="text-slate-800">{editValues.employeeName || '—'}</span>
                </p>
              )}

              {editingItem.type === 'task' && (
                <div className="space-y-4 text-left">
                  <p className="text-xs font-bold text-slate-500">
                    Logged by{' '}
                    <span className="text-slate-800">
                      {getTaskEmployeeName(editValues, timesheets)}
                    </span>
                  </p>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Client</label>
                    <select
                      value={editValues.clientName || ''}
                      onChange={e => setEditValues({ ...editValues, clientName: e.target.value, billingTarget: '' })}
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-[#fd7414]"
                    >
                      <option value="">Select client...</option>
                      {clients.filter(
                        (c) =>
                          isClientActiveForWork(c) ||
                          (editValues.clientName && c.name === editValues.clientName),
                      ).map(c => (
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
                        const retainers = client
                          ? getEnabledRetainerCategoryNames(client)
                          : [];
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
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0 gap-4">
              <div className="text-left flex items-center gap-4 min-w-0">
                {editingClient.logoUrl ? (
                  <img
                    src={editingClient.logoUrl}
                    alt=""
                    className="h-14 w-14 rounded-2xl object-cover border border-slate-200 shrink-0 bg-white"
                  />
                ) : (
                  <div
                    className="h-14 w-14 rounded-2xl border border-dashed border-slate-300 bg-white shrink-0 flex items-center justify-center text-[10px] font-bold text-slate-400 text-center leading-tight px-1"
                    aria-hidden
                  >
                    No logo
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-black text-2xl text-slate-900 truncate">{editingClient.name}</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Client Settings & Retainers</p>
                </div>
              </div>
              <button onClick={() => setEditingClient(null)} className="p-2 bg-white rounded-full hover:bg-slate-100 border border-slate-200 shrink-0"><X className="w-5 h-5" /></button>
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
                <div className="space-y-4 pt-4 border-t border-slate-200">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Company profile</p>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Website</label>
                    <input
                      type="url"
                      value={editingClient.website || ''}
                      onChange={(e) => setEditingClient({ ...editingClient, website: e.target.value })}
                      className="w-full bg-white border border-slate-200 p-4 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                      placeholder="https://example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone</label>
                    <input
                      type="tel"
                      value={editingClient.phone || ''}
                      onChange={(e) => setEditingClient({ ...editingClient, phone: e.target.value })}
                      className="w-full bg-white border border-slate-200 p-4 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                      placeholder="+1 (555) 555-5555"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Google Drive folder URL</label>
                    <input
                      type="url"
                      value={editingClient.googleDriveFolderUrl || ''}
                      onChange={(e) =>
                        setEditingClient({
                          ...editingClient,
                          googleDriveFolderUrl: e.target.value,
                        })
                      }
                      className="w-full bg-white border border-slate-200 p-4 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                      placeholder="https://drive.google.com/drive/folders/..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">HubSpot profile URL</label>
                    <input
                      type="url"
                      value={editingClient.hubspotProfileUrl || ''}
                      onChange={(e) =>
                        setEditingClient({
                          ...editingClient,
                          hubspotProfileUrl: e.target.value,
                        })
                      }
                      className="w-full bg-white border border-slate-200 p-4 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                      placeholder="https://app.hubspot.com/contacts/..."
                    />
                  </div>
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Primary contact</p>
                    {['name', 'title', 'email', 'phone'].map((field) => (
                      <input
                        key={field}
                        type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                        value={editingClient.primaryContact?.[field] || ''}
                        onChange={(e) =>
                          setEditingClient({
                            ...editingClient,
                            primaryContact: {
                              ...normalizePrimaryContact(editingClient.primaryContact),
                              [field]: e.target.value,
                            },
                          })
                        }
                        className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                        placeholder={
                          field === 'name'
                            ? 'Full name'
                            : field === 'title'
                              ? 'Title / role'
                              : field === 'email'
                                ? 'Email address'
                                : 'Phone number'
                        }
                      />
                    ))}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Additional contacts</p>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingClient({
                            ...editingClient,
                            contacts: [
                              ...(editingClient.contacts || []),
                              { id: newContactId(), name: '', email: '', phone: '', title: '', notes: '' },
                            ],
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-200"
                      >
                        <Plus className="w-3 h-3" /> Add contact
                      </button>
                    </div>
                    {(editingClient.contacts || []).length === 0 ? (
                      <p className="text-xs italic text-slate-400">No additional contacts yet.</p>
                    ) : (
                      (editingClient.contacts || []).map((contact, idx) => (
                        <div key={contact.id || idx} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              Contact {idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingClient({
                                  ...editingClient,
                                  contacts: (editingClient.contacts || []).filter((_, i) => i !== idx),
                                })
                              }
                              className="text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                          {['name', 'title', 'email', 'phone'].map((field) => (
                            <input
                              key={field}
                              type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                              value={contact[field] || ''}
                              onChange={(e) => {
                                const next = [...(editingClient.contacts || [])];
                                next[idx] = { ...next[idx], [field]: e.target.value };
                                setEditingClient({ ...editingClient, contacts: next });
                              }}
                              className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414]"
                              placeholder={
                                field === 'name'
                                  ? 'Full name'
                                  : field === 'title'
                                    ? 'Title / role'
                                    : field === 'email'
                                      ? 'Email address'
                                      : 'Phone number'
                              }
                            />
                          ))}
                          <textarea
                            value={contact.notes || ''}
                            onChange={(e) => {
                              const next = [...(editingClient.contacts || [])];
                              next[idx] = { ...next[idx], notes: e.target.value };
                              setEditingClient({ ...editingClient, contacts: next });
                            }}
                            className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-[#fd7414] min-h-[70px]"
                            placeholder="Notes (optional)"
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="space-y-2 pt-4 border-t border-slate-200">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Client logo</label>
                  <p className="text-xs text-slate-400 mb-2">
                    Shown next to the client name in admin, kiosk, and the client portal. PNG, JPG, WebP, or GIF — max 2.5 MB. If upload fails, enable Storage and publish the project&apos;s{' '}
                    <code className="text-[11px] bg-slate-100 px-1 rounded">storage.rules</code>.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-40">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                        className="sr-only"
                        disabled={clientLogoUploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file || !editingClient?.id) return;
                          if (!file.type.startsWith('image/')) {
                            window.alert('Please choose an image file.');
                            return;
                          }
                          if (file.size > 2.5 * 1024 * 1024) {
                            window.alert('Image must be under 2.5 MB.');
                            return;
                          }
                          setClientLogoUploading(true);
                          try {
                            const safe =
                              file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) ||
                              'logo';
                            const path = `client-logos/${editingClient.id}/${Date.now()}_${safe}`;
                            const r = storageRef(storage, path);
                            await uploadBytes(r, file, { contentType: file.type });
                            const url = await getDownloadURL(r);
                            setEditingClient((prev) => ({ ...prev, logoUrl: url }));
                          } catch (err) {
                            window.alert(
                              err?.message ||
                                'Upload failed. Enable Firebase Storage and deploy storage.rules (see project storage.rules).',
                            );
                          } finally {
                            setClientLogoUploading(false);
                          }
                        }}
                      />
                      {clientLogoUploading ? 'Uploading…' : 'Upload image'}
                    </label>
                    {editingClient.logoUrl && (
                      <button
                        type="button"
                        className="text-xs font-bold text-red-600 hover:underline"
                        onClick={() => setEditingClient((prev) => ({ ...prev, logoUrl: null }))}
                      >
                        Remove logo
                      </button>
                    )}
                  </div>
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
                      if(confirm("Are you sure? This will clear surplus/deficit carryover from prior billing periods for this client, starting fresh for the current period.")) {
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
                  button. Toggle
                  <span className="mx-1 font-black text-slate-600">Active</span>
                  off for services this client does not receive — disabled
                  categories are hidden everywhere in the app.
                </p>
                <div className="space-y-3">
                  {retainerConfigCategories.map((type) => {
                    const units = (editingClient.retainerUnits || {})[type] ?? (type === 'Social Ad Budget' ? 'dollar' : 'hours');
                    const unitLabel = units === 'dollar' ? '$' : 'hrs';
                    const step = units === 'dollar' ? 1 : 0.5;
                    const categoryResetKey = carryoverCategoryKey(type);
                    const lastCategoryReset = editingClient.carryoverResetByCategory?.[categoryResetKey];
                    const categoryActive = isRetainerCategoryEnabled(editingClient, type);
                    return (
                      <div
                        key={type}
                        className={`flex justify-between items-start p-4 rounded-2xl border gap-3 transition-opacity ${
                          categoryActive
                            ? 'bg-slate-50 border-slate-100'
                            : 'bg-slate-100/80 border-slate-200 opacity-70'
                        }`}
                      >
                        <div className="flex flex-col gap-2 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="font-bold text-slate-700 text-sm">
                              {type}
                            </span>
                            <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                checked={categoryActive}
                                onChange={(e) => {
                                  const enabled = e.target.checked;
                                  setEditingClient({
                                    ...editingClient,
                                    retainerCategoryEnabled: {
                                      ...(editingClient.retainerCategoryEnabled || {}),
                                      [type]: enabled,
                                    },
                                    retainers: {
                                      ...(editingClient.retainers || {}),
                                      [type]:
                                        editingClient.retainers?.[type] ??
                                        0,
                                    },
                                  });
                                }}
                                className="rounded border-slate-300 text-[#fd7414] focus:ring-[#fd7414]"
                              />
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Active for this client
                              </span>
                            </label>
                          </div>
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
                            disabled={!categoryActive}
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
                            disabled={!categoryActive}
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

              {currentUserRole !== 'kiosk' && (
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    Archive &amp; delete
                  </p>
                  <p className="text-xs text-slate-500">
                    Archiving hides the client from the main list. Deleting removes
                    the client record from the database permanently.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setArchiveConfirm({
                          id: editingClient.id,
                          name: editingClient.name,
                          unarchive: !!editingClient.archived,
                        })
                      }
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-slate-800 font-bold text-sm hover:bg-slate-100 transition-colors"
                    >
                      <FolderGit2 className="w-4 h-4" />
                      {editingClient.archived
                        ? 'Unarchive client'
                        : 'Archive client'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteConfirm({
                          collection: 'clients',
                          id: editingClient.id,
                          title: `the client "${editingClient.name}"`,
                        })
                      }
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-red-200 bg-red-50 text-red-600 font-bold text-sm hover:bg-red-100 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete client permanently
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-8 border-t border-slate-100 bg-white shrink-0">
              <button 
                onClick={async () => {
                  await updateDoc(doc(db, 'clients', editingClient.id), {
                    retainers: editingClient.retainers,
                    retainerUnits: editingClient.retainerUnits || {},
                    hourlyRate: editingClient.hourlyRate || 0,
                    clientEmails: (editingClient.clientEmails || [])
                      .map((em) => String(em || '').trim().toLowerCase())
                      .filter(Boolean),
                    billingDay: editingClient.billingDay || 1,
                    status: editingClient.status || 'active',
                    teamMemberAccessEmails:
                      editingClient.teamMemberAccessEmails === undefined
                        ? null
                        : editingClient.teamMemberAccessEmails,
                    lastCarryoverResetDate: editingClient.lastCarryoverResetDate || null,
                    carryoverResetByCategory: editingClient.carryoverResetByCategory || {},
                    clientStartDate: editingClient.clientStartDate || null,
                    retainerHourMovesByCycle: editingClient.retainerHourMovesByCycle || {},
                    logoUrl: editingClient.logoUrl || null,
                    website: String(editingClient.website || '').trim(),
                    phone: String(editingClient.phone || '').trim(),
                    googleDriveFolderUrl: String(editingClient.googleDriveFolderUrl || '').trim(),
                    hubspotProfileUrl: String(editingClient.hubspotProfileUrl || '').trim(),
                    retainerCategoryEnabled: normalizeRetainerCategoryEnabled(
                      editingClient.retainerCategoryEnabled,
                    ),
                    primaryContact: normalizePrimaryContact(editingClient.primaryContact),
                    contacts: normalizeClientContacts(editingClient.contacts),
                  });
                  setEditingClient(null);
                }} 
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
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                      Target deadline (optional)
                    </label>
                    <input
                      type="date"
                      value={projectValues.deadline || ''}
                      onChange={(e) =>
                        setProjectValues({ ...projectValues, deadline: e.target.value })
                      }
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
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
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-1">
                      Project deadline (optional)
                    </label>
                    <input
                      type="date"
                      value={projectValues.deadline || ''}
                      onChange={(e) =>
                        setProjectValues({ ...projectValues, deadline: e.target.value })
                      }
                      className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:ring-2 focus:ring-[#fd7414]"
                    />
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

      {/* Archive / unarchive confirmation */}
      {archiveConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[110] animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center mx-auto border border-slate-200">
              <FolderGit2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-black text-xl mb-2">
                {archiveConfirm.unarchive
                  ? 'Restore this client?'
                  : 'Archive this client?'}
              </h3>
              <p className="text-sm text-slate-500 font-medium">
                {archiveConfirm.unarchive
                  ? `Are you sure you want to restore "${archiveConfirm.name}" to the client list?`
                  : `Are you sure you want to archive "${archiveConfirm.name}"? They will be hidden from the main list until you unarchive them from Client settings or Firestore.`}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setArchiveConfirm(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await updateDoc(doc(db, 'clients', archiveConfirm.id), {
                    archived: !archiveConfirm.unarchive,
                  }).catch(() => {});
                  setArchiveConfirm(null);
                  setEditingClient(null);
                }}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-2xl transition-all"
              >
                {archiveConfirm.unarchive ? 'Restore' : 'Archive'}
              </button>
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
              <h3 className="font-black text-xl mb-2">Confirm permanent deletion</h3>
              <p className="text-sm text-slate-500 font-medium">
                Are you sure you want to delete {deleteConfirm.title}?
              </p>
              {deleteConfirm.collection === 'clients' && (
                <p className="text-sm text-red-600 font-bold mt-3 leading-snug">
                  This permanently removes the client and all references in this app.
                  Only proceed if you are absolutely sure.
                </p>
              )}
              {deleteConfirm.collection !== 'clients' && (
                <p className="text-xs text-slate-400 font-medium mt-2">
                  This action cannot be undone.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 rounded-2xl transition-all">Cancel</button>
              <button
                type="button"
                onClick={async () => {
                  const ids = Array.isArray(deleteConfirm.ids)
                    ? deleteConfirm.ids
                    : [deleteConfirm.id].filter(Boolean);
                  await Promise.all(
                    ids.map((id) =>
                      deleteDoc(doc(db, deleteConfirm.collection, id)).catch(() => {})
                    )
                  );
                  if (deleteConfirm.collection === 'clients') {
                    setEditingClient(null);
                  }
                  setDeleteConfirm(null);
                }}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-red-500/30 transition-all"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}