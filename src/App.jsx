import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import {
  Search, Plus, Upload, Users as UsersIcon, Settings as SettingsIcon,
  Filter, X, Download, Trash2, Mail, Phone, MapPin, Building, Building2,
  Calendar, User, ChevronDown, FileText, LayoutGrid, AlertCircle,
  CheckCircle2, Clock, Tag, MessageSquare, ArrowUpDown, MoreHorizontal,
  Edit3, Send, RefreshCw, LogOut, Shield, KeyRound, UserPlus, Check,
  Lock, AlertTriangle, Flame, Sparkles, BarChart3, TrendingUp, TrendingDown,
  Trophy, Target, Printer, FileSpreadsheet, Eye, EyeOff, Copy, Menu,
  RotateCcw, CalendarOff, Archive, ArchiveX, Key, Route,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Inbox, Briefcase, ClipboardList, LayoutDashboard, ArrowRight
} from 'lucide-react';

import {
  subscribeToLeads, subscribeToConfig, subscribeToUsers, subscribeToAccessRequests,
  addLeadDoc, updateLeadDoc, deleteLeadDoc, bulkImportLeads, clearAllLeads, bulkDeleteLeads,
  saveConfigDoc, saveUserDoc, deleteUserDoc,
  addAccessRequestDoc, deleteAccessRequestDoc,
  subscribeToRecords, addRecordDoc, updateRecordDoc,
  addAttachmentRecords, removeAttachmentRecord
} from './lib/firestoreData';

import {
  signInWithCredentials, signOutCurrent, watchAuthState,
  sendResetEmail, createUserOnSecondaryApp, sendWelcomeEmailToUser,
  reassignUserLeadsViaFunction, restoreLoaLeadsForUserViaFunction,
  adminResetUserPasswordViaFunction,
  sendImportSummaryEmailViaFunction,
  sendSalesRequestEmailViaFunction,
  sendRecordEmailViaFunction
} from './lib/firestoreAuth';
import { nearestBranchForZip } from './lib/branchRouting';
import {
  PIPELINE_STAGES, PIPELINE_STATUSES, PIPELINE_CLOSED_STATUSES,
  STAGE_INCOMING, STAGE_WORKING, STAGE_SALES_REQUEST, STAGE_COMPLETED,
  SALES_REQUEST_STATUS, WON_STATUS, LOST_STATUS,
  getStage, stageForView, stageOfStatus, stageOfLead, statusOptionsFor, bulkStatusOptionsFor,
  ensurePipelineStatuses, isLeadVisibleInStage, isUnassigned, completesViaSalesRequest, canCloseSalesRequest,
  DEAL_FIELDS, LOST_FIELDS, SALES_REQUEST_FIELDS, SALES_REQUEST_SECTIONS, BACK_OFFICE_FIELDS,
  isFieldShown, pruneHiddenAnswers, validateSalesRequest,
  OPEN_REQUEST_STATUSES, REQUEST_FIELDS, REQUEST_DEPARTMENTS, validateRequest, isRequestFieldShown, pruneRequest,
  departmentsFor, requestStatusFromDone, requestStatusOptionsFor, fromLocationForBranch, EXTERNAL_LOCATION,
  TRADE_IN_FIELDS, TRADE_IN_SECTIONS, TRADE_IN_MANAGER_FIELDS, tradeInStatus, validateFields,
  FINANCE_REP_FIELDS, FINANCE_ADMIN_FIELDS, FINANCE_CLOSED_STATUSES, financeAudit,
  submittalNeedsFinance, financeFromSubmittal, isOwnRecordVisible,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES, ATTACHMENT_ACCEPT, checkAttachment, formatBytes
} from './lib/pipeline';
import { uploadAttachments, attachmentUrl, deleteAttachmentFile } from './lib/attachments';

const DEFAULT_CONFIG = {
  // Indy's four-step pipeline — see src/lib/pipeline.js for which status is in which step.
  statuses: PIPELINE_STATUSES,
  // Which of the statuses above count as "closed" (terminal). Configurable via
  // Settings → Closed Statuses. Non-closed statuses count as open.
  closedStatuses: PIPELINE_CLOSED_STATUSES,
  branches: ['Anderson', 'Columbus', 'Ellettsville', 'Indy', 'Indy North'],
  departments: ['Sales', 'Rental', 'Parts', 'Service', 'Supplies'],
  // The first four are the web/system sources shared with the other forks; the
  // rest are how Indy's reps record where a deal came from.
  sources: ['Gravity Forms', 'Bobcat Leads', 'Manual Entry', 'CSV Import',
            'Call In', 'Walk In', 'Cold Call', 'Customer Relationship', 'Customer Referral',
            'Internal Referral', 'Internet', 'SPICE'],
  // Departments used for ROUTING. Deliberately separate from `departments` above,
  // which categorises the lead itself — a lead's department and the team that
  // handles it are not the same list.
  routingDepartments: ['Sales', 'Rental', 'Parts', 'Service', 'Supplies'],
  // Per location+department contact set. Key: `${branch}::${department}`.
  // Value: { primaryUserId, backupEmail, cc1, cc2, cc3 }
  // NOTE: collected but NOT yet acted on — intake still uses branchRouting.js.
  leadRouting: {},
  scoringRules: null,  // filled with DEFAULT_SCORING_RULES at runtime
  staleness: null,     // filled with DEFAULT_STALENESS at runtime
  duplicateDetection: null,  // filled with DEFAULT_DUPLICATE_DETECTION at runtime
  routing: {
    // Single email address BCC'd on EVERY lead notification (company-wide oversight).
    masterBcc: '',
    // Per-location BCC. Key: branch name, Value: email string.
    // Each one is BCC'd on lead notifications for leads at that location only.
    locationBcc: {},
    // Master Sales BCC — array of up to 2 emails BCC'd on every sales lead.
    // Stored as a positional 2-element array (empty strings allowed).
    salesBcc: ['', ''],
    // Per-store, per-department manager contact info.
    // Key format: `${branch}::${routingDepartment}` (e.g. "Indy North::Parts")
    // Value: { name, email, phone }
    managers: {},
    // Per-rep ZIP code assignments.
    // Key: rep userId, Value: array of ZIP strings
    zipAssignments: {}
  }
};

// Role-based view access.
//   admin              → can access EVERY view
//   user (sales rep)   → only their own views (My Open, My Closed, Add Lead)
// The Department Manager tier was removed in BMH — everything is admin or rep.
// Views only an admin may open at all.
// NOTE: 'lead-routing' is deliberately NOT here. Every signed-in user can open it;
// reps get the read-only Routing Logic Overview instead of the editor, so anyone
// can answer "where do our leads go?" without being able to change it.
const ADMIN_ONLY_VIEWS = ['reports', 'users', 'settings'];

// The four step dashboards plus the picker in front of them. Every signed-in
// user can open all five; what they SEE inside is narrowed by
// isLeadVisibleInStage (reps get their own leads, plus unowned ones in Incoming).
const HOME_VIEW = 'home';
const STAGE_VIEWS = PIPELINE_STAGES.map(s => s.view);
// View ids the older forks used. Indy replaced them with the step dashboards, so
// an old bookmark or email link carrying one lands on the picker instead.
const RETIRED_VIEWS = ['leads', 'my-open', 'my-closed', 'all-closed', 'my-created'];

// Views Indy folded into others: Junk and Archived became tabs on the Incoming
// and Completed dashboards; Import, Scoring and Lead Routing became Settings
// tabs. An old link to one lands on its new home. [view, tab]
const MOVED_VIEWS = {
  junk:           ['stage-incoming', 'junk'],
  archived:       ['stage-completed', 'archived'],
  import:         ['settings', 'import'],
  scoring:        ['settings', 'scoring'],
  'lead-routing': ['settings', 'routing']
};

const SETTINGS_TABS = [
  ['general',       'General'],
  ['notifications', 'Notifications'],
  ['routing',       'Lead Routing'],
  ['scoring',       'Scoring'],
  ['import',        'Import CSV']
];

// Empty-state copy for each step dashboard.
const STAGE_EMPTY = {
  [STAGE_INCOMING]: {
    title: 'Nothing waiting in Incoming',
    admin: 'New leads from the web forms, CSV imports and Add Lead land here first.',
    rep:   'New leads assigned to you, and unassigned ones you can pick up, land here first.'
  },
  [STAGE_WORKING]: {
    title: 'No leads being worked',
    admin: 'Assign a lead in Incoming and set it to Working, Prospect, Pending or Want to move it here.',
    rep:   'Assign yourself a lead in Incoming and set it to Working, Prospect, Pending or Want to move it here.'
  },
  [STAGE_SALES_REQUEST]: {
    title: 'No open sales submittals',
    admin: 'When a rep sets a Working lead to Completed, they fill in the Sales Submittal and it lands here for the back office.',
    rep:   'When you set a Working lead to Completed, you fill in the Sales Submittal and it waits here for the back office.'
  },
  [STAGE_COMPLETED]: {
    title: 'Nothing completed yet',
    admin: 'Completed sales, lost, unqualified and cancelled leads end up here. After 30 days they move to Archived.',
    rep:   'Your completed sales, lost, unqualified and cancelled leads end up here for 30 days.'
  }
};

const STAGE_ICONS = {
  [STAGE_INCOMING]:      Inbox,
  [STAGE_WORKING]:       Briefcase,
  [STAGE_SALES_REQUEST]: ClipboardList,
  [STAGE_COMPLETED]:     CheckCircle2
};
// Accent per step, reused from the status palette so a step and its statuses
// read as the same colour family. Text shades are all -700 on a -50 tint (AA).
const STAGE_ACCENTS = {
  [STAGE_INCOMING]:      { bar: 'bg-blue-500',    soft: 'bg-blue-50',    text: 'text-blue-700'    },
  [STAGE_WORKING]:       { bar: 'bg-violet-500',  soft: 'bg-violet-50',  text: 'text-violet-700'  },
  [STAGE_SALES_REQUEST]: { bar: 'bg-orange-500',  soft: 'bg-orange-50',  text: 'text-orange-700'  },
  [STAGE_COMPLETED]:     { bar: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700' }
};

function canAccessView(view, role) {
  if (ADMIN_ONLY_VIEWS.includes(view)) return role === 'admin';
  return true;  // Default views (my-open, my-closed, add) — every signed-in user
}

// Landing page and safety-redirect fallback. Admins see the full pipeline;
// sales reps land on their own open leads.
function getDefaultView(role) {
  return HOME_VIEW;
}

// Auto-archival rule: leads closed for this many consecutive days (no reopen in between)
// drop out of "My Closed" / "All Closed" and into the Archived bucket.
const ARCHIVE_DAYS = 30;

// Walk history backward to find the most recent transition INTO a closed status.
// If the lead has been reopened since (a transition OUT of closed), this returns null —
// the archive clock should reset whenever a lead is reopened.
// Returns ISO timestamp string or null.
function getMostRecentCloseDate(lead, config) {
  const closedStatuses = getClosedStatuses(config);
  if (!closedStatuses.includes(lead.status)) return null;
  const history = lead.history || [];

  // Scan backward. The most recent status_change is the operative one.
  for (let i = history.length - 1; i >= 0; i--) {
    const event = history[i];
    if (event.type !== 'status_change') continue;
    // The latest status_change must be INTO a closed status (i.e. the current state).
    // Since we walk in reverse, the first status_change we hit IS the most recent.
    if (closedStatuses.includes(event.to)) {
      return event.timestamp;
    }
    // Otherwise the latest status change was OUT of closed — but the lead's current
    // status is closed, which means it must have been re-closed without a history event
    // (shouldn't happen, but safe to fall through).
    break;
  }

  // No status_change history (e.g. lead was imported already-closed, or created closed).
  // Fall back to createdDate so importers don't get stuck holding ancient deals forever.
  return lead.createdDate || null;
}

// A lead is "archived" when EITHER:
//   - An admin/user has manually flagged it via the Archive button (manuallyArchived === true), OR
//   - It's been continuously closed for >= ARCHIVE_DAYS
// Manual archival takes precedence so an admin can shelf a lead at any time
// without waiting for the 30-day timer.
function isLeadArchived(lead, now = new Date(), config) {
  if (lead.manuallyArchived === true) return true;
  const closedStatuses = getClosedStatuses(config);
  if (!closedStatuses.includes(lead.status)) return false;
  const closeDate = getMostRecentCloseDate(lead, config);
  if (!closeDate) return false;
  const daysSinceClose = (now - new Date(closeDate)) / 86400000;
  return daysSinceClose >= ARCHIVE_DAYS;
}

const SYSTEM_UNASSIGNED = { id: 'u_1', name: 'Unassigned', email: '', isSystem: true };

// Which statuses count as "closed" (terminal). Read from config.closedStatuses so
// admins can add new statuses (like "No Decision") and mark them closed via Settings.
// If a config isn't provided or the field is missing, fall back to the defaults —
// this matters for cold-start renders before the Firestore config has loaded.
const DEFAULT_CLOSED_STATUSES = PIPELINE_CLOSED_STATUSES;

// When the current status was set. Leads created before this field existed have
// no `statusChangedAt`, so fall back to the most recent status_change event in
// history, then to the lead's creation date — a lead that has never changed
// status has held its current one since it was created.
function getStatusChangedAt(lead) {
  if (!lead) return null;
  if (lead.statusChangedAt) return lead.statusChangedAt;
  const history = lead.history || [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].type === 'status_change' && history[i].timestamp) return history[i].timestamp;
  }
  return lead.createdDate || null;
}

// "3 days", "5 hours", "just now" — how long the lead has held its current status.
function formatDuration(fromIso, now = new Date()) {
  if (!fromIso) return null;
  const ms = now - new Date(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'}`;
}

// Flip to true to hide the status history from sales reps. Left open because the
// trail exposes nothing a rep can't already see on the lead itself — it just puts
// the status changes in one place instead of scattered through the activity feed.
const STATUS_HISTORY_ADMIN_ONLY = false;

// The full status trail for one lead: when it landed, then every status change
// since, oldest first. Reads `lead.history`, which is append-only and never
// pruned, so this goes back as far as the lead does.
//
// Two cases need care. History arrays come back from Firestore in stored order,
// which is not guaranteed sorted, so sort by timestamp rather than trusting it.
// And leads that predate history tracking have a `statusChangedAt` with nothing
// explaining it — those get one entry flagged `inferred`, and the opening status
// is left null rather than back-filled with the current one, because we genuinely
// do not know what the lead arrived as.
function buildStatusTrail(lead) {
  if (!lead) return [];

  const history = Array.isArray(lead.history) ? lead.history : [];
  const changes = history
    .filter(h => h && h.type === 'status_change' && h.timestamp && h.to)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const created = lead.dateSubmitted || lead.createdDate || null;

  const hasInferred =
    changes.length === 0 &&
    !!lead.statusChangedAt &&
    !!lead.status &&
    (!created || (new Date(lead.statusChangedAt) - new Date(created)) > 60000);

  const openingStatus = changes.length
    ? (changes[0].from || null)
    : (hasInferred ? null : (lead.status || null));

  const trail = [{
    key: 'submitted',
    status: openingStatus,
    at: created,
    actor: null,
    isOrigin: true
  }];

  changes.forEach((h, i) => {
    trail.push({
      key: h.id || `change_${i}`,
      status: h.to,
      from: h.from || null,
      at: h.timestamp,
      actor: h.actor || null
    });
  });

  if (hasInferred) {
    trail.push({
      key: 'inferred',
      status: lead.status,
      at: lead.statusChangedAt,
      actor: lead.statusChangedBy || null,
      inferred: true
    });
  }

  return trail;
}

function getClosedStatuses(config) {
  if (config?.closedStatuses && Array.isArray(config.closedStatuses) && config.closedStatuses.length > 0) {
    return config.closedStatuses;
  }
  return DEFAULT_CLOSED_STATUSES;
}

const STATUS_COLORS = {
  New:            { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  Contacted:      { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  Working:        { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  Qualified:      { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },  // legacy alias of Working
  Quoted:         { bg: 'bg-cyan-50',   text: 'text-cyan-700',   dot: 'bg-cyan-500'   },
  Pending:        { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  Prospect:       { bg: 'bg-sky-50',    text: 'text-sky-700',    dot: 'bg-sky-500'    },
  Want:           { bg: 'bg-cyan-50',   text: 'text-cyan-700',   dot: 'bg-cyan-500'   },
  Completed:      { bg: 'bg-emerald-50',text: 'text-emerald-700',dot: 'bg-emerald-500'},
  'Sales Request':{ bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  Cancelled:      { bg: 'bg-stone-100', text: 'text-stone-600',  dot: 'bg-stone-400'  },
  Dead:           { bg: 'bg-stone-200', text: 'text-stone-700',  dot: 'bg-stone-600'  },
  Won:            { bg: 'bg-emerald-50',text: 'text-emerald-700',dot: 'bg-emerald-500'},
  Lost:           { bg: 'bg-rose-50',   text: 'text-rose-700',   dot: 'bg-rose-500'   },
  Unqualified:    { bg: 'bg-stone-100', text: 'text-stone-600',  dot: 'bg-stone-400'  },
  'No Decision':  { bg: 'bg-stone-100', text: 'text-stone-600',  dot: 'bg-stone-400'  },
  Junk:           { bg: 'bg-stone-200', text: 'text-stone-700',  dot: 'bg-stone-500'  }
};

// The Junk status. Junk leads are pulled out of every pipeline view and
// surfaced only in the dedicated Junk tab. It is a CLOSED status, so the
// normal 30-day archive clock applies and stale junk drains into Archived.
// Reverting is just a status change — set anything else and the lead returns
// to the normal views automatically.
const JUNK_STATUS = 'Junk';

// "Qualified" was renamed to "Working". The old name is still the stored value on
// every lead written before the rename, so it survives here as a legacy alias:
// leads are normalised on read and rewritten once by an admin (see migrateLegacy-
// WorkingLeads), and the config self-heals via ensureWorkingStatus.
const WORKING_STATUS = 'Working';
const LEGACY_WORKING_STATUS = 'Qualified';
const WORKING_WEEK_OPTIONS = [1, 2, 3, 4];

// A Working lead carries an absolute deadline rather than the usual
// time-since-last-activity clock: pick +2 and it stays active for 14 days no
// matter how much anyone touches it, then goes stale as day 15 begins. The
// deadline lands at the end of the final day so leads turn stale overnight
// rather than mid-afternoon.
function workingDeadlineFrom(weeks, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + weeks * 7);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

// Only meaningful while the lead is actually in Working — a deadline left over
// from a previous stint must not keep suppressing staleness in Quoted.
function getWorkingDeadline(lead) {
  if (!lead || lead.status !== WORKING_STATUS) return null;
  return lead.workingUntil || null;
}

// Presents a legacy 'Qualified' lead as 'Working' everywhere in the app, and
// flags it so the one-time migration can find it. `_`-prefixed fields are
// local-only by convention here (see _score, _staleness) and never written back.
function normalizeLeadStatus(lead) {
  if (!lead || lead.status !== LEGACY_WORKING_STATUS) return lead;
  return { ...lead, status: WORKING_STATUS, _migratedFrom: LEGACY_WORKING_STATUS };
}

// Stored config replaces the defaults rather than merging with them, so a rename
// in DEFAULT_CONFIG alone would never reach the live project. Same reason
// ensureJunkStatus exists.
function ensureWorkingStatus(config) {
  if (!config) return config;
  const out = { ...config };

  const list = Array.isArray(out.statuses) ? out.statuses : [];
  if (list.includes(LEGACY_WORKING_STATUS)) {
    out.statuses = list
      .map(st => (st === LEGACY_WORKING_STATUS ? WORKING_STATUS : st))
      .filter((st, i, arr) => arr.indexOf(st) === i);
  }

  const th = out.staleness && out.staleness.thresholds;
  if (th && Object.prototype.hasOwnProperty.call(th, LEGACY_WORKING_STATUS)) {
    const moved = { ...th };
    // Don't clobber a Working threshold someone already set by hand.
    if (!Object.prototype.hasOwnProperty.call(moved, WORKING_STATUS)) {
      moved[WORKING_STATUS] = moved[LEGACY_WORKING_STATUS];
    }
    delete moved[LEGACY_WORKING_STATUS];
    out.staleness = { ...out.staleness, thresholds: moved };
  }

  return out;
}

/* ===================== LEAD ROUTING ===================== */
// Contact slots for each location+department. Order matters — it is the order
// they render, and the order routing will eventually try them in.
const ROUTING_SLOTS = [
  { key: 'primaryUserId', label: 'Local Primary', type: 'user',
    hint: 'The lead is assigned to this person' },
  // A user rather than an email address: an email cannot own a slot in someone's
  // "My Open". Optional — leave it blank where a second pair of eyes isn't needed.
  { key: 'backupUserId',  label: 'Local Backup',  type: 'user', optional: true,
    hint: 'Also sees the lead in their My Open, and is emailed' },
  { key: 'cc1',           label: 'CC 1',          type: 'email' },
  { key: 'cc2',           label: 'CC 2',          type: 'email' },
  { key: 'cc3',           label: 'CC 3',          type: 'email' }
];

// Firestore returns the users collection in document-id order, which looks
// random in a dropdown. Everything downstream reads `config.users`, so sorting
// once at the subscription puts every picker, filter and table in the same
// order for free.
//
// Case-insensitive on purpose: accounts get created with names like
// "JUSTIN CASSITY" alongside "Gabe Taton", and a plain string sort would file
// every all-caps name ahead of every mixed-case one. System users ("Unassigned")
// stay pinned to the top — it's the empty choice, not a person named U.
const nameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function sortUsersByName(list) {
  return [...(list || [])].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    return nameCollator.compare((a.name || '').trim(), (b.name || '').trim());
  });
}

// One key format, defined once. When the routing function is built it must use
// this same shape to read the config the UI writes.
const routingKey = (branch, department) => `${branch}::${department}`;

// A lead belongs to someone if they are the assignee OR the secondary. Used by
// My Open, My Closed and their sidebar counts so the list and the badge can't
// disagree. Reports deliberately does NOT use this — see below.
function isLeadForUser(lead, userId) {
  if (!lead || !userId) return false;
  return lead.assignedTo === userId || lead.secondaryAssignedTo === userId;
}

// The `created` event, guarded. `history` is normally an array, but a malformed
// document would otherwise take the whole table down with it — `|| []` doesn't
// protect against a truthy non-array.
function createdEventOf(lead) {
  const history = Array.isArray(lead && lead.history) ? lead.history : [];
  return history.find(h => h && h.type === 'created') || null;
}

// Who typed this lead in. Leads added through the Add Lead form now carry an
// explicit `createdBy`; everything older is read back out of the `created`
// history event, which has recorded the actor since the app shipped — so this
// works on leads that predate the field with no migration.
function getLeadCreator(lead) {
  if (!lead) return null;
  if (lead.createdBy) return lead.createdBy;
  const created = createdEventOf(lead);
  return (created && created.actor) || null;
}

// "I entered this lead by hand." Zapier intake records no actor, so web-form
// leads belong to nobody. CSV imports DO record one, but a single import can be
// hundreds of rows and would bury the handful of leads someone actually typed —
// so imports are excluded and this stays the Add Lead form only.
function isCreatedByUser(lead, userId) {
  if (!lead || !userId) return false;
  if (getLeadCreator(lead) !== userId) return false;
  const created = createdEventOf(lead);
  return !(created && (created.viaImport || created.viaIntake));
}

/* ===================== LEAD SOURCE DISPLAY ===================== */
// `leadSource` stays one of the configured values so the Source filter and the
// Reports source mix keep working; who keyed it in lives in `submittedBy`.
// This is the only place the two get combined for display — use it everywhere a
// source is shown so the table, detail panel and exports can't disagree.
const MANUAL_SOURCE = 'Manual Entry';
// Sentinel for the Submitter filter: manual leads recorded before the field existed.
const NO_SUBMITTER = '— No submitter —';

function formatLeadSource(lead) {
  if (!lead) return '';
  const source = lead.leadSource || '';
  const by = (lead.submittedBy || '').trim();
  return by ? `${source} from ${by}` : source;
}

const EMPTY_ROUTING_ENTRY = { primaryUserId: '', backupUserId: '', cc1: '', cc2: '', cc3: '' };

function getRoutingEntry(config, branch, department) {
  return { ...EMPTY_ROUTING_ENTRY, ...(config.leadRouting?.[routingKey(branch, department)] || {}) };
}

function getRoutingDepartments(config) {
  const list = config.routingDepartments;
  return Array.isArray(list) && list.length > 0 ? list : DEFAULT_CONFIG.routingDepartments;
}

// How many of the five slots are filled — drives the per-department progress chip.
function countRoutingFilled(entry) {
  return ROUTING_SLOTS.filter(slot => (entry[slot.key] || '').trim() !== '').length;
}

// Firestore's stored config REPLACES the defaults rather than merging into them,
// so a project that predates the Junk feature would come back without it — the
// status dropdown would not offer Junk and junked leads would never reach the
// 30-day archive rule. This heals that in memory on every config read, without
// touching the stored document or disturbing any custom statuses the admin added.
function ensureJunkStatus(config) {
  const hasStatuses = Array.isArray(config.statuses) && config.statuses.length > 0;
  const hasClosed   = Array.isArray(config.closedStatuses) && config.closedStatuses.length > 0;
  const statuses = hasStatuses ? config.statuses : DEFAULT_CONFIG.statuses;
  const closed   = hasClosed   ? config.closedStatuses : DEFAULT_CLOSED_STATUSES;
  // Only hand the object back untouched when it genuinely carries both lists
  // already — otherwise we would return a config with no statuses at all.
  if (hasStatuses && hasClosed
      && statuses.includes(JUNK_STATUS) && closed.includes(JUNK_STATUS)) return config;
  return {
    ...config,
    statuses: statuses.includes(JUNK_STATUS) ? statuses : [...statuses, JUNK_STATUS],
    closedStatuses: closed.includes(JUNK_STATUS) ? closed : [...closed, JUNK_STATUS]
  };
}

const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '—';
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ===================== PASSWORD HELPERS ===================== */

// Generate a strong password using crypto.getRandomValues (not Math.random).
// Avoids easily-confused chars (0/O, 1/l/I) for shareability.
function generateStrongPassword(length = 16) {
  const lower   = 'abcdefghijkmnopqrstuvwxyz';
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits  = '23456789';
  const symbols = '!@#$%^&*';
  const all = lower + upper + digits + symbols;

  const randInt = (max) => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  };

  // Guarantee at least one char from each pool
  const out = [
    lower[randInt(lower.length)],
    upper[randInt(upper.length)],
    digits[randInt(digits.length)],
    symbols[randInt(symbols.length)]
  ];
  // Fill remaining length
  while (out.length < length) {
    out.push(all[randInt(all.length)]);
  }
  // Shuffle so guaranteed chars aren't always in positions 0-3
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

// Returns { score: 0-4, label, barColor, textColor, segments: 0-4 }
function scorePassword(pw) {
  if (!pw) return { score: 0, label: '', barColor: '', textColor: '', segments: 0 };

  // Very short = automatic fail regardless of variety
  if (pw.length < 6) {
    return { score: 0, label: 'Too short', barColor: 'bg-rose-500', textColor: 'text-rose-600', segments: 1 };
  }

  let points = 0;
  if (pw.length >= 8)  points++;
  if (pw.length >= 12) points++;
  if (pw.length >= 16) points++;

  const hasLower  = /[a-z]/.test(pw);
  const hasUpper  = /[A-Z]/.test(pw);
  const hasDigit  = /[0-9]/.test(pw);
  const hasSymbol = /[^a-zA-Z0-9]/.test(pw);
  const variety = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  if (variety >= 2) points++;
  if (variety >= 3) points++;
  if (variety >= 4) points++;

  // Penalize common patterns
  if (/(.)\1{2,}/.test(pw))       points--; // 3+ repeated chars: "aaa", "111"
  if (/^[0-9]+$/.test(pw))        points--; // only digits
  if (/^[a-zA-Z]+$/.test(pw))     points--; // only letters
  if (/^(password|qwerty|admin|letmein|bobcat|indy|indianapolis|berry|bmh)/i.test(pw)) points -= 2;

  const score = Math.max(0, Math.min(4, points));

  const tiers = [
    { score: 0, label: 'Very weak',   barColor: 'bg-rose-500',    textColor: 'text-rose-600',    segments: 1 },
    { score: 1, label: 'Weak',        barColor: 'bg-rose-500',    textColor: 'text-rose-600',    segments: 1 },
    { score: 2, label: 'Fair',        barColor: 'bg-amber-500',   textColor: 'text-amber-700',   segments: 2 },
    { score: 3, label: 'Strong',      barColor: 'bg-emerald-500', textColor: 'text-emerald-700', segments: 3 },
    { score: 4, label: 'Very strong', barColor: 'bg-emerald-500', textColor: 'text-emerald-700', segments: 4 }
  ];
  return tiers[score];
}

/* ===================== LEAD SCORING ===================== */

// Bobcat of Indy's territory is Indiana — all five branches are in central and
// south-central Indiana (Anderson, Columbus, Ellettsville, Indianapolis, Whitestown).
// NOTE: the config fields stay named `texas*` so this fork remains diffable
// against HOU — same convention as tiers.hot backing the "Urgent" label.
const DEFAULT_TEXAS_PREFIXES = ['46', '47'];
// Bordering: Illinois (60-62), Ohio (43-45), Kentucky (40-42), Michigan (48-49).
const DEFAULT_ADJACENT_PREFIXES = ['60', '61', '62', '43', '44', '45', '40', '41', '42', '48', '49'];
const DEFAULT_DISPOSABLE_DOMAINS = [
  'mailinator', 'tempmail', 'guerrillamail', '10minutemail', 'throwaway',
  'fakeinbox', 'trashmail', 'maildrop', 'yopmail', 'dispostable', 'sharklasers',
  'getairmail', 'mintemail', 'mohmal'
];

const DEFAULT_URGENCY_KEYWORDS   = ['buy', 'purchase', 'ready to buy', 'ready', 'today', 'asap', 'immediately', 'right away', 'urgent', 'right now'];
const DEFAULT_PRICING_KEYWORDS   = ['quote', 'price', 'pricing', 'cost', 'how much', 'financing', 'finance', 'lease', 'payment', 'budget'];
const DEFAULT_TIMEFRAME_KEYWORDS = ['this week', 'next week', 'this month', 'next month', 'by friday', 'by monday', 'soon', 'within a week'];

const DEFAULT_EQUIPMENT_KEYWORDS = [
  // Brands Bobcat of Indy carries
  'bobcat', 'doosan', 'develon',

  // Machine families
  'skid steer', 'skid-steer', 'skidsteer', 'skid loader',
  'track loader', 'compact track loader', 'ctl', 'mini track loader',
  'excavator', 'mini excavator', 'compact excavator', 'mini ex',
  'backhoe', 'backhoe loader',
  'telehandler', 'telescopic handler', 'reach forklift',
  'toolcat', 'utility work machine',
  'utv', 'side by side', 'side-by-side', 'utility vehicle',
  'compact tractor', 'sub compact tractor', 'sub-compact tractor', 'tractor',
  'zero turn', 'zero-turn', 'mower', 'zero turn mower',
  'articulated loader', 'small articulated loader', 'wheel loader',
  'compact loader', 'compact equipment', 'construction equipment',
  'grader', 'motor grader',

  // Attachments and work tools
  'attachment', 'work tool', 'bucket', 'grapple', 'pallet fork', 'forks',
  'auger', 'breaker', 'hydraulic breaker', 'hammer', 'brush cutter', 'brushcat',
  'mulcher', 'forestry cutter', 'stump grinder', 'trencher', 'tiller',
  'box blade', 'land plane', 'landplane', 'land leveler', 'angle broom',
  'sweeper', 'snow blower', 'snowblower', 'snow blade', 'snow pusher',
  'planer', 'wheel saw', 'vibratory roller', 'compactor', 'plate compactor',
  'quick attach', 'bob-tach', 'bobtach', 'three point', '3 point',
  'clamp', 'dozer blade', 'grapple bucket', 'rock bucket',

  // Undercarriage, tyres and parts
  'tracks', 'rubber tracks', 'steel tracks', 'undercarriage', 'tires', 'tyres',
  'filter', 'hydraulic hose', 'cutting edge', 'bucket teeth', 'final drive',

  // Service / rental / fleet intent
  'planned maintenance', 'pm program', 'preventive maintenance', 'fleet management',
  'machine iq', 'operator training', 'osha',
  'short term rental', 'long term rental', 'rental fleet', 'lease',
  'lift capacity', 'operating capacity', 'rated operating capacity', 'roc',
  'dig depth', 'lift height', 'horsepower', 'hp'
];


// Catches the model designations Bobcat's lines carry:
//   Skid steer / CTL      S64, S66, S70, S76, S86, T64, T66, T76, T86
//   Mini track loader     MT55, MT85, MT100
//   Excavator             E10, E20, E26, E32, E35, E42, E50, E60, E88
//   Telehandler           V519, V723, TL519, TL723
//   Toolcat / UTV         UW56, UV34, UTV
//   Compact tractor       CT1021, CT2025, CT2535, CT4045
//   Zero-turn mower       ZT2000, ZT3500, ZT6000
//   Articulated loader    L23, L28, L65, L85
// Single-letter families are split out and require 2-3 digits: every real
// one is in that range (S64-S86, T64-T86, E10-E88, L23-L85, V519/V723), and
// allowing 1 digit made 'lot 5 building T 3' and 'V 8 engine' score as
// equipment mentions. 'Suite E 200' still slips through; it is worth 8 points
// out of ~100, so a rare false positive is cheaper than missing a real model.
const MODEL_REGEX = /\b(?:(?:UW|ZT|MT|CT|TL|UV|UTV|CTL)[\s-]?\d{1,4}|[STELV][\s-]?\d{2,3})(?:[.-]\d+)?(?:[A-Z]+)?\b/i;

const SPAM_NAME_PATTERNS = [
  /^test\b/i, /^asdf/i, /^qwer/i, /^(.)\1{2,}$/, /^[a-z]{1,2}$/i,
  /^\d/, /^xxx/i, /^aaa/i, /^name\b/i
];

const DEFAULT_SCORING_RULES = {
  tiers: { hot: 75, warm: 50, cool: 25 },
  serviceArea: {
    texasPoints: 25,
    adjacentPoints: 12,
    otherPoints: 5,
    texasPrefixes: DEFAULT_TEXAS_PREFIXES,
    adjacentPrefixes: DEFAULT_ADJACENT_PREFIXES
  },
  commentQuality: {
    detailedChars: 200,    detailedPoints: 25,
    substantialChars: 100, substantialPoints: 20,
    moderateChars: 50,     moderatePoints: 15,
    shortChars: 20,        shortPoints: 8,
    briefPoints: 2
  },
  buyIntent: {
    urgencyPoints: 10,   urgencyKeywords: DEFAULT_URGENCY_KEYWORDS,
    pricingPoints: 8,    pricingKeywords: DEFAULT_PRICING_KEYWORDS,
    timeframePoints: 6,  timeframeKeywords: DEFAULT_TIMEFRAME_KEYWORDS,
    equipmentPoints: 8,  equipmentKeywords: DEFAULT_EQUIPMENT_KEYWORDS
  },
  legitimacy: {
    disposableEmailDeduction: 15,
    suspiciousNameDeduction: 10,
    fakePhoneDeduction: 8,
    allCapsDeduction: 3,
    invalidEmailDeduction: 5,
    disposableDomains: DEFAULT_DISPOSABLE_DOMAINS
  }
};

function scoreLead(lead, rules = DEFAULT_SCORING_RULES) {
  const sa = rules.serviceArea, cq = rules.commentQuality, bi = rules.buyIntent, lg = rules.legitimacy;
  const breakdown = [];
  let total = 0;

  // A) Service Area
  let pts = 0, status = 'miss', detail = 'No ZIP provided';
  if (lead.zip && /^\d{5}/.test(lead.zip)) {
    const prefix = lead.zip.slice(0, 2);
    if (sa.texasPrefixes.includes(prefix))         { pts = sa.texasPoints;    status = 'hit';     detail = 'Indiana (primary service area)'; }
    else if (sa.adjacentPrefixes.includes(prefix)) { pts = sa.adjacentPoints; status = 'partial'; detail = 'Adjacent state'; }
    else                                            { pts = sa.otherPoints;    status = 'partial'; detail = 'Out of service area'; }
  }
  const saMax = Math.max(sa.texasPoints, sa.adjacentPoints, sa.otherPoints);
  breakdown.push({ label: 'Service Area', detail, points: pts, max: saMax, status });
  total += pts;

  // B) Comment Quality
  pts = 0; status = 'miss'; detail = 'No comment';
  const comment = (lead.comment || '').trim();
  if (comment) {
    const len = comment.length;
    if      (len >= cq.detailedChars)    { pts = cq.detailedPoints;    status = 'hit';     detail = `Detailed (${len} chars)`; }
    else if (len >= cq.substantialChars) { pts = cq.substantialPoints; status = 'hit';     detail = `Substantial (${len} chars)`; }
    else if (len >= cq.moderateChars)    { pts = cq.moderatePoints;    status = 'partial'; detail = `Moderate (${len} chars)`; }
    else if (len >= cq.shortChars)       { pts = cq.shortPoints;       status = 'partial'; detail = `Short (${len} chars)`; }
    else                                  { pts = cq.briefPoints;       status = 'partial'; detail = `Very brief (${len} chars)`; }
  }
  const cqMax = Math.max(cq.detailedPoints, cq.substantialPoints, cq.moderatePoints, cq.shortPoints, cq.briefPoints);
  breakdown.push({ label: 'Comment Quality', detail, points: pts, max: cqMax, status });
  total += pts;

  // C) Buy Intent
  pts = 0;
  const hits = [];
  const lc = comment.toLowerCase();
  if (bi.urgencyKeywords.some(k => lc.includes(k.toLowerCase())))                              { pts += bi.urgencyPoints;   hits.push('urgency'); }
  if (bi.pricingKeywords.some(k => lc.includes(k.toLowerCase())))                              { pts += bi.pricingPoints;   hits.push('pricing'); }
  if (bi.timeframeKeywords.some(k => lc.includes(k.toLowerCase())))                            { pts += bi.timeframePoints; hits.push('timeframe'); }
  if (bi.equipmentKeywords.some(k => lc.includes(k.toLowerCase())) || MODEL_REGEX.test(comment)) { pts += bi.equipmentPoints; hits.push('specific equipment'); }
  const biMax = bi.urgencyPoints + bi.pricingPoints + bi.timeframePoints + bi.equipmentPoints;
  pts = Math.min(pts, biMax);
  status = pts >= biMax * 0.66 ? 'hit' : pts >= biMax * 0.25 ? 'partial' : 'miss';
  detail = hits.length ? hits.join(', ') : (comment ? 'No buy signals detected' : 'No comment to analyze');
  breakdown.push({ label: 'Buy Intent', detail, points: pts, max: biMax, status });
  total += pts;

  // D) Legitimacy
  const lgMax = 20;
  pts = lgMax;
  const flags = [];
  if (lead.contactEmail) {
    const domain = lead.contactEmail.split('@')[1]?.toLowerCase() || '';
    if (lg.disposableDomains.some(d => domain.includes(d.toLowerCase()))) { pts -= lg.disposableEmailDeduction; flags.push('disposable email'); }
    if (!validEmail(lead.contactEmail))                                    { pts -= lg.invalidEmailDeduction;    flags.push('invalid email format'); }
  }
  const name = (lead.customerName || '').trim();
  if (SPAM_NAME_PATTERNS.some(re => re.test(name)))   { pts -= lg.suspiciousNameDeduction; flags.push('suspicious name'); }
  else if (name.length === 1)                          { pts -= 5;                          flags.push('one-character name'); }
  if (lead.phone) {
    const digits = lead.phone.replace(/\D/g, '');
    if (digits.length >= 7 && (/^(\d)\1+$/.test(digits) || ['1234567890', '0000000000', '1111111111'].includes(digits))) {
      pts -= lg.fakePhoneDeduction; flags.push('fake phone');
    }
  }
  if (comment.length > 0 && comment.length < 30 && comment === comment.toUpperCase() && /[A-Z]/.test(comment)) {
    pts -= lg.allCapsDeduction; flags.push('all-caps brief comment');
  }
  pts = Math.max(pts, 0);
  status = pts >= lgMax * 0.9 ? 'hit' : pts >= lgMax * 0.5 ? 'partial' : 'miss';
  detail = flags.length ? flags.join(', ') : 'No red flags';
  breakdown.push({ label: 'Legitimacy', detail, points: pts, max: lgMax, status });
  total += pts;

  // Tier field values are shown to users directly (in badges, chips, filters).
  // Renamed from "Hot" to "Urgent" for clearer semantics.
  // NOTE: the config field `rules.tiers.hot` stays as `hot` to avoid a
  // Firestore data migration — only the derived tier name changes.
  const tier =
    total >= rules.tiers.hot  ? 'Urgent'  :
    total >= rules.tiers.warm ? 'Warm' :
    total >= rules.tiers.cool ? 'Cool' : 'Cold';

  return { total, tier, breakdown };
}

const TIER_STYLES = {
  Urgent: { bg: 'bg-brand-50',  text: 'text-brand-700',  bar: 'bg-brand-500', icon: '🚨', dot: 'bg-brand-500' },
  Warm:   { bg: 'bg-amber-50',  text: 'text-amber-700',  bar: 'bg-amber-500', icon: '⚡', dot: 'bg-amber-500' },
  Cool:   { bg: 'bg-sky-50',    text: 'text-sky-700',    bar: 'bg-sky-500',   icon: '·',  dot: 'bg-sky-500'   },
  Cold:   { bg: 'bg-stone-100', text: 'text-stone-500',  bar: 'bg-stone-400', icon: '·',  dot: 'bg-stone-400' }
};

/* ===================== STALENESS / AGING ===================== */

const DEFAULT_STALENESS = {
  enabled: true,
  thresholds: {
    // Hours a lead can sit in each status before being flagged as stale.
    // null/0 = never goes stale.
    New: 24,           // 1 day to review, fill in and assign
    Working: 168,      // fallback only — a Working lead with a deadline ignores this
    Prospect: 336,     // 14 days
    Pending: 168,      // 7 days
    Want: 336,         // 14 days
    'Sales Request': 72, // 3 days for the back office to complete the submittal
    Completed: null,
    Lost: null,
    Unqualified: null,
    Dead: null,
    Cancelled: null
  }
};
// Thresholds ensurePipelineStatuses adds to a stored config that predates them.
const PIPELINE_STALENESS_DEFAULTS = {
  Prospect: 336, Pending: 168, Want: 336, 'Sales Request': 72, Completed: null, Dead: null, Cancelled: null
};

function getLastActivityAt(lead) {
  let latest = new Date(lead.createdDate || lead.dateSubmitted || Date.now()).getTime();
  (lead.history || []).forEach(h => {
    const t = new Date(h.timestamp).getTime();
    if (t > latest) latest = t;
  });
  (lead.internalComments || []).forEach(c => {
    const t = new Date(c.timestamp).getTime();
    if (t > latest) latest = t;
  });
  return latest;
}

function getLeadAgeHours(lead) {
  return (Date.now() - getLastActivityAt(lead)) / (1000 * 60 * 60);
}

function isLeadStale(lead, staleness) {
  // A Working deadline is absolute: it holds even if staleness tracking is off
  // globally, because a rep explicitly promised a date.
  const deadline = getWorkingDeadline(lead);
  if (deadline) return new Date(deadline).getTime() - Date.now() <= 0;

  if (!staleness?.enabled) return false;
  const threshold = staleness.thresholds?.[lead.status];
  if (!threshold || threshold <= 0) return false;
  return getLeadAgeHours(lead) > threshold;
}

function getStaleness(lead, staleness) {
  // Working leads with a deadline ignore the activity clock entirely — working
  // a lead shouldn't buy it more time than the rep asked for.
  const deadline = getWorkingDeadline(lead);
  if (deadline) {
    const ms = new Date(deadline).getTime() - Date.now();
    const stale = ms <= 0;
    return {
      hours: getLeadAgeHours(lead),
      threshold: null,
      stale,
      approaching: !stale && ms <= 3 * 86400000,   // final three days
      tracked: true,
      workingUntil: deadline,
      daysLeft: Math.max(0, Math.ceil(ms / 86400000))
    };
  }

  const hours = getLeadAgeHours(lead);
  const threshold = staleness?.thresholds?.[lead.status];
  const enabled = !!staleness?.enabled;
  const tracked = enabled && threshold && threshold > 0;
  const stale = tracked && hours > threshold;
  // "approaching" = past 75% of the threshold but not yet stale
  const approaching = tracked && !stale && hours > threshold * 0.75;
  return { hours, threshold, stale, approaching, tracked };
}

function formatAge(hours) {
  if (hours < 1) {
    const m = Math.max(1, Math.round(hours * 60));
    return `${m}m`;
  }
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)}d`;
  const weeks = days / 7;
  if (weeks < 5) return `${Math.round(weeks)}w`;
  const months = days / 30;
  return `${Math.round(months)}mo`;
}

/* ===================== DUPLICATE DETECTION ===================== */

const DEFAULT_DUPLICATE_DETECTION = {
  enabled: true,
  withinDays: 90
};

// Format a Date for use as the value of <input type="datetime-local">.
// That input expects local time WITHOUT a timezone suffix (e.g. "2026-05-19T20:08").
// new Date().toISOString().slice(0,16) is wrong here — it produces UTC, which the input
// then mis-displays as if it were local time (off by however many hours from UTC).
function toLocalDateTimeInputValue(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeEmail(e) {
  return (e || '').trim().toLowerCase();
}
function normalizePhone(p) {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function getMatchedOn(existing, candidate) {
  const matches = [];
  const cEmail = normalizeEmail(candidate.contactEmail);
  const eEmail = normalizeEmail(existing.contactEmail);
  if (cEmail && cEmail === eEmail) matches.push('email');
  const cPhone = normalizePhone(candidate.phone);
  const ePhone = normalizePhone(existing.phone);
  if (cPhone && cPhone.length >= 7 && cPhone === ePhone) matches.push('phone');
  return matches;
}

function findDuplicates(candidate, leads, config = DEFAULT_DUPLICATE_DETECTION) {
  if (!config?.enabled) return [];
  const cutoff = Date.now() - (config.withinDays || 90) * 24 * 60 * 60 * 1000;
  const results = [];
  for (const lead of leads) {
    const createdTime = new Date(lead.createdDate || lead.dateSubmitted || 0).getTime();
    if (createdTime < cutoff) continue;
    const matchedOn = getMatchedOn(lead, candidate);
    if (matchedOn.length > 0) results.push({ lead, matchedOn });
  }
  // Sort newest first
  return results.sort((a, b) => new Date(b.lead.createdDate) - new Date(a.lead.createdDate));
}


function HeatBadge({ score, tier, compact = false }) {
  const s = TIER_STYLES[tier];
  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <span className={`font-mono font-bold text-sm ${s.text} w-7 text-right`}>{score}</span>
        <div className="w-12 h-1.5 bg-stone-100 rounded-full overflow-hidden">
          <div className={`h-full ${s.bar} transition-all`} style={{ width: `${score}%` }}/>
        </div>
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${s.bg} ${s.text}`}>
      <span>{s.icon}</span>{tier} · {score}
    </span>
  );
}

export default function BobcatIndyCRM() {
  const [view, setView] = useState(() => {
    // Allow ?view=users or ?view=leads etc. via URL — used by email notifications
    try {
      const requested = new URLSearchParams(window.location.search).get('view');
      const valid = [HOME_VIEW, ...STAGE_VIEWS, 'requests', 'finance', 'trade-ins', 'add', 'reports', 'users', 'settings'];
      if (requested && valid.includes(requested)) return requested;
      if (requested && MOVED_VIEWS[requested]) return MOVED_VIEWS[requested][0];
    } catch { /* ignore */ }
    return HOME_VIEW;
  });
  const [leads, setLeads] = useState([]);
  // Indy's records that hang off leads but can also stand alone (see
  // pipeline.js): operations requests, trade-in evaluations, finance deals.
  const [records, setRecords] = useState({ requests: [], tradeIns: [], finance: [] });
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [users, setUsers] = useState([SYSTEM_UNASSIGNED]);
  const [accessRequests, setAccessRequests] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [toast, setToast] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // One-shot signal sent when a stat chip is clicked. LeadsView consumes it and clears.
  const [leadsPrefilter, setLeadsPrefilter] = useState(null);
  // Lead ID requested via URL query param (?lead=xyz) — set once on first render,
  // consumed by an effect below as soon as the leads subscription has data.
  const [requestedLeadId, setRequestedLeadId] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('lead');
    } catch {
      return null;
    }
  });

  // Stat chip handler — switches to a leads-style view and sets the prefilter signal.
  // For sales reps who can't see the team-wide Leads view, keep them on their own
  // scoped view instead.
  const applyChipFilter = (preset) => {
    // Chips only render on the step dashboards, so the table the
    // chip filters is already on screen — stay on it.
    if (!STAGE_VIEWS.includes(view)) setView(HOME_VIEW);
    setLeadsPrefilter(preset);
  };

  // Watch Firebase Auth state — runs once on mount, persists across sign-in/sign-out
  useEffect(() => {
    const unsubAuth = watchAuthState((firebaseUser) => {
      setCurrentUserId(firebaseUser?.uid || null);
      // Once auth state is determined, the UI can render (login screen or app)
      setLoaded(true);
    });
    // Safety net: if auth never resolves, render anyway after 4s
    const t = setTimeout(() => setLoaded(true), 4000);
    return () => { unsubAuth(); clearTimeout(t); };
  }, []);

  // Subscribe to Firestore collections only when signed in.
  // Firestore listeners that start while unauthenticated immediately fail with
  // permission-denied and don't auto-retry, so we wait for an actual user.
  useEffect(() => {
    if (!currentUserId) {
      // Reset to defaults when signed out so a re-sign-in starts clean
      setLeads([]);
      setRecords({ requests: [], tradeIns: [], finance: [] });
      setConfig(DEFAULT_CONFIG);
      setUsers([SYSTEM_UNASSIGNED]);
      setAccessRequests([]);
      return;
    }

    const unsubLeads = subscribeToLeads((data) => {
      // Present legacy 'Qualified' leads as 'Working' immediately. The stored
      // value is rewritten separately (see the migration effect below); until
      // that lands, this keeps every filter, chart and dropdown coherent.
      setLeads(data.map(normalizeLeadStatus));
    });

    const unsubRecords = ['requests', 'tradeIns', 'finance'].map(kind =>
      subscribeToRecords(kind, (data) => setRecords(r => ({ ...r, [kind]: data }))));

    const unsubConfig = subscribeToConfig((data) => {
      const merged = {
        ...DEFAULT_CONFIG,
        scoringRules: DEFAULT_SCORING_RULES,
        staleness: DEFAULT_STALENESS,
        duplicateDetection: DEFAULT_DUPLICATE_DETECTION,
        ...data
      };
      setConfig(ensurePipelineStatuses(ensureWorkingStatus(ensureJunkStatus(merged)), PIPELINE_STALENESS_DEFAULTS));
    });

    const unsubUsers = subscribeToUsers((data) => {
      // Always include the system "Unassigned" pseudo-user even if it's not in Firestore yet
      const hasSystem = data.some(u => u.id === 'u_1');
      setUsers(sortUsersByName(hasSystem ? data : [SYSTEM_UNASSIGNED, ...data]));
    });

    return () => {
      unsubLeads(); unsubRecords.forEach(u => u()); unsubConfig(); unsubUsers();
    };
  }, [currentUserId]);

  // Strip the ?view= query param after sign-in so refresh doesn't keep re-applying it.
  useEffect(() => {
    if (!currentUserId) return;
    try {
      const url = new URL(window.location);
      if (url.searchParams.has('view')) {
        url.searchParams.delete('view');
        window.history.replaceState({}, '', url.toString());
      }
    } catch { /* ignore */ }
  }, [currentUserId]);

  // Auto-open a lead requested via URL query param (e.g. from an email "View Lead" link).
  // Waits until the user is signed in and leads have started loading. Cleans the URL afterward.
  useEffect(() => {
    if (!requestedLeadId || !currentUserId) return;
    const lead = leads.find(l => l.id === requestedLeadId);
    if (!lead) return;  // not yet loaded, or doesn't exist / no permission — try again on next sync

    setSelectedLead(lead);
    setRequestedLeadId(null);

    // Strip the ?lead= param so a refresh doesn't re-open the panel
    try {
      const url = new URL(window.location);
      url.searchParams.delete('lead');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // window.history may be unavailable in some contexts — silently ignore
    }
  }, [requestedLeadId, currentUserId, leads]);

  // Save helpers — all Firestore-backed now
  const saveConfig = async (patch) => {
    try { await saveConfigDoc(patch); }
    catch (e) { showToast('Failed to save settings', 'error'); }
  };

  const showToast = (message, kind = 'success') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 2800);
  };

  // Determine current user and auth state
  const currentUser = useMemo(() => {
    if (!currentUserId) return null;
    return users.find(u => u.id === currentUserId && !u.isSystem) || null;
  }, [currentUserId, users]);

  // accessRequests is admin-read-only (see firestore.rules) and only the Users tab
  // consumes it, so a rep subscribing just left a permission-denied listener
  // retrying in the background.
  //
  // This lives in its own effect deliberately: the main subscription effect runs
  // as soon as we have a uid, which is BEFORE the users collection has loaded —
  // `currentUser` is still null there, so gating on role inside it would stop
  // admins subscribing too. Keying on the resolved role instead means this fires
  // once the role is actually known, and again if it ever changes.
  useEffect(() => {
    if (currentUser?.role !== 'admin') {
      setAccessRequests([]);
      return;
    }
    const unsub = subscribeToAccessRequests((data) => setAccessRequests(data));
    return () => unsub();
  }, [currentUser?.role]);

  // One-time rewrite of leads still storing the old 'Qualified' status.
  // Admin-only, and self-limiting: once a lead is written it no longer carries
  // `_migratedFrom`, so this stops firing on its own. The ref keeps a slow write
  // batch from being started twice while the first is still in flight.
  const migrationRan = useRef(false);
  useEffect(() => {
    if (currentUser?.role !== 'admin') return;
    if (migrationRan.current) return;

    const stragglers = leads.filter(l => l._migratedFrom === LEGACY_WORKING_STATUS);
    if (stragglers.length === 0) return;

    migrationRan.current = true;
    (async () => {
      let done = 0;
      for (const lead of stragglers) {
        try {
          await updateLeadDoc(lead.id, {
            status: WORKING_STATUS,
            history: [
              ...(lead.history || []),
              {
                id: uid('h'),
                type: 'status_change',
                timestamp: new Date().toISOString(),
                actor: null,
                from: LEGACY_WORKING_STATUS,
                to: WORKING_STATUS,
                systemNote: 'Status renamed'
              }
            ]
          });
          done++;
        } catch (e) {
          console.error('Status rename migration failed for', lead.id, e);
        }
      }
      if (done > 0) {
        showToast(`Renamed Qualified to Working on ${done} lead${done === 1 ? '' : 's'}`, 'success');
      }
    })();
  }, [currentUser?.role, leads]);

  // Safety redirect: if a user lands on a view they can't access (e.g. via deep link
  // or after a role change while signed in), bounce them to the role-appropriate
  // default (Leads for admins/dept mgrs, My Open for sales reps).
  useEffect(() => {
    if (!currentUser) return;
    if (MOVED_VIEWS[view]) { goTo(view); return; }
    if (RETIRED_VIEWS.includes(view) || !canAccessView(view, currentUser.role)) {
      setView(getDefaultView(currentUser.role));
    }
  }, [view, currentUser]);

  const hasAdmin = useMemo(
    () => users.some(u => u.role === 'admin' && !u.isSystem),
    [users]
  );

  // Split leads into active (everything users actively work with) vs archived (closed >=30 days).
  // All views except the dedicated Archived tab work with activeLeads only.
  const archivedLeads = useMemo(() => {
    const now = new Date();
    return leads.filter(l => isLeadArchived(l, now, config));
  }, [leads, config.closedStatuses]);
  const activeLeads = useMemo(() => {
    const archivedIds = new Set(archivedLeads.map(l => l.id));
    return leads.filter(l => !archivedIds.has(l.id));
  }, [leads, archivedLeads]);

  // Junk is carved out of the active set. `pipelineLeads` is what every normal
  // view, counter and report reads, so junk never pollutes totals or win rate.
  // `junkLeads` backs the Junk tab only. Once a junk lead passes the 30-day
  // archive threshold it drops out of BOTH (it lands in archivedLeads instead).
  const junkLeads = useMemo(
    () => activeLeads.filter(l => l.status === JUNK_STATUS),
    [activeLeads]
  );
  const pipelineLeads = useMemo(
    () => activeLeads.filter(l => l.status !== JUNK_STATUS),
    [activeLeads]
  );

  // The four step dashboards. Each bucket holds the leads in that step that the
  // current user may see: admins everything, reps their own plus (Incoming only)
  // unowned leads. Sidebar badges, the picker's counts, the top-bar chips and the
  // tables all read these same buckets, so a count can never disagree with its list.
  const stageLeads = useMemo(() => {
    const out = Object.fromEntries(PIPELINE_STAGES.map(s => [s.id, []]));
    if (!currentUser) return out;
    const closed = getClosedStatuses(config);
    for (const l of pipelineLeads) {
      const st = stageOfLead(l, closed);
      // Reps also see leads they entered by hand, wherever they went — this is
      // what the old My Created Leads view was for (watch-only in the table).
      if (out[st] && (isLeadVisibleInStage(l, st, currentUser) || isCreatedByUser(l, currentUser.id))) out[st].push(l);
    }
    return out;
  }, [pipelineLeads, config.closedStatuses, currentUser]);

  // Records this user may see (admins all; reps their own), per kind.
  const visibleRecords = useMemo(() => {
    const out = { requests: [], tradeIns: [], finance: [] };
    if (!currentUser) return out;
    for (const k of Object.keys(out)) out[k] = records[k].filter(r => isOwnRecordVisible(r, currentUser));
    return out;
  }, [records, currentUser]);
  const visibleRequests = visibleRecords.requests;
  const openRequestCount = visibleRequests.filter(r => OPEN_REQUEST_STATUSES.includes(r.status)).length;
  const openFinanceCount = visibleRecords.finance.filter(f => !FINANCE_CLOSED_STATUSES.includes(f.admin?.dealStatus)).length;
  const pendingTradeInCount = visibleRecords.tradeIns.filter(t => tradeInStatus(t) === 'Awaiting Approval').length;

  // The Archived tab on Completed: admins see every archived lead, reps the ones
  // that were theirs (as on the Completed dashboard).
  const visibleArchivedLeads = useMemo(() => !currentUser ? [] : archivedLeads.filter(l =>
    isLeadVisibleInStage(l, STAGE_COMPLETED, currentUser) || isCreatedByUser(l, currentUser.id)),
  [archivedLeads, currentUser]);

  // Where a given lead lives, for "take me to it" navigation after adding one.
  const stageViewOf = (lead) => {
    const st = stageOfLead(lead, getClosedStatuses(config));
    if (st === 'junk') return 'junk';
    return getStage(st)?.view || HOME_VIEW;
  };

  // Adapter: child components were written expecting users/accessRequests to live inside config.
  // We keep them as separate top-level state but inject them into a derived config
  // so the child UI components don't all need new props.
  // IMPORTANT: this useMemo must stay BEFORE any conditional returns to satisfy
  // React's Rules of Hooks.
  const configWithUsers = useMemo(
    () => ({ ...config, users, accessRequests }),
    [config, users, accessRequests]
  );

  // Defensive guard: redirect non-admins away from admin-only views
  useEffect(() => {
    if (!currentUser) return;
    const adminOnly = ADMIN_ONLY_VIEWS;
    if (currentUser.role !== 'admin' && adminOnly.includes(view)) {
      setView(HOME_VIEW);
    }
  }, [currentUser, view]);

  // ------------- AUTH HANDLERS -------------
  const createFirstAdmin = async () => {
    // No longer used — admin is bootstrapped manually in Firebase Console (see SETUP.md Step 4)
    showToast('Admin must be set up via Firebase Console. See SETUP.md.', 'error');
  };

  const signIn = async ({ email, password }) => {
    try {
      await signInWithCredentials(email, password);
      return { ok: true };
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) {
        return { ok: false, error: 'Invalid email or password.' };
      }
      if (code.includes('too-many-requests')) {
        return { ok: false, error: 'Too many failed attempts. Try again in a few minutes.' };
      }
      return { ok: false, error: 'Sign-in failed. Please try again.' };
    }
  };

  const signOut = async () => {
    await signOutCurrent();
    setView(HOME_VIEW);
    setSelectedLead(null);
  };

  const requestPasswordReset = async (email) => {
    const trimmed = (email || '').trim();
    if (!validEmail(trimmed)) {
      return { ok: false, error: 'Please enter a valid email address.' };
    }
    try {
      await sendResetEmail(trimmed);
      // Always report success — even if the email doesn't have an account,
      // we don't want to leak account-existence info. Firebase Auth handles
      // the "no such account" case silently for the same reason.
      return { ok: true };
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('too-many-requests')) {
        return { ok: false, error: 'Too many reset attempts. Try again in a few minutes.' };
      }
      // Don't expose user-not-found errors — return success to avoid enumeration
      if (code.includes('user-not-found')) {
        return { ok: true };
      }
      return { ok: false, error: 'Could not send reset email. Please try again.' };
    }
  };

  const submitAccessRequest = async ({ name, email, reason }) => {
    const lcEmail = email.trim().toLowerCase();
    if (users.some(u => (u.email || '').toLowerCase() === lcEmail)) {
      return { ok: false, error: 'An account with that email already exists. Try signing in.' };
    }
    if (accessRequests.some(r => (r.email || '').toLowerCase() === lcEmail)) {
      return { ok: false, error: 'A request for that email is already pending review.' };
    }
    try {
      await addAccessRequestDoc({
        name: name.trim(),
        email: email.trim(),
        reason: reason.trim(),
        requestedAt: new Date().toISOString()
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not submit request. Please try again.' };
    }
  };

  const approveRequest = async (reqId) => {
    const req = accessRequests.find(r => r.id === reqId);
    if (!req) return;

    // Generate a temporary password the user will immediately replace via email reset link
    const tempPassword = `IND-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      // Create the Firebase Auth user using a SECONDARY app instance so the
      // admin's own session is not affected.
      const newUid = await createUserOnSecondaryApp(req.email, tempPassword);

      // Create their Firestore profile keyed by the new UID
      await saveUserDoc(newUid, {
        name: req.name,
        email: req.email,
        role: 'user',
        isSystem: false,
        createdAt: new Date().toISOString()
      });

      // Email them a password reset link so they can set their own password
      await sendResetEmail(req.email);

      // Remove the access request
      await deleteAccessRequestDoc(reqId);

      showToast(`${req.name} approved — password reset link sent to ${req.email}`);
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('email-already-in-use')) {
        showToast('That email already has a Firebase account', 'error');
      } else {
        showToast('Approval failed: ' + (err.message || code || 'unknown error'), 'error');
      }
    }
  };

  const denyRequest = async (reqId) => {
    try {
      await deleteAccessRequestDoc(reqId);
      showToast('Request denied');
    } catch (e) {
      showToast('Could not deny request', 'error');
    }
  };

  const toggleUserRole = async (userId) => {
    const user = users.find(u => u.id === userId && !u.isSystem);
    if (!user) return;
    const newRole = user.role === 'admin' ? 'user' : 'admin';

    // Ensure at least one admin remains
    const otherAdmins = users.filter(u => u.id !== userId && u.role === 'admin' && !u.isSystem);
    if (newRole === 'user' && otherAdmins.length === 0) {
      showToast('At least one admin is required', 'error');
      return;
    }
    try {
      await saveUserDoc(userId, { role: newRole });
    } catch (e) {
      showToast('Could not update role', 'error');
    }
  };

  // ------------- LEAD HANDLERS -------------
  const addLead = async (leadData, sourceLabel = 'Manual Entry') => {
    const now = new Date().toISOString();
    const defaultDept = (config.departments && config.departments[0]) || '';
    const lead = {
      customerName: '', companyName: '', contactEmail: '', phone: '', comment: '',
      branch: '', zip: '', dateSubmitted: now, formTitle: '',
      department: defaultDept,
      createdDate: now, leadSource: sourceLabel,
      // Who entered it, as a user id — `submittedBy` is free text and editable,
      // so it can't be trusted to identify an account. Backs My Created Leads.
      createdBy: currentUser?.id || null,
      dateAssigned: null, assignedTo: 'u_1',
      internalComments: [], status: 'New', statusChangedAt: now,
      history: [{
        id: uid('h'), type: 'created', timestamp: now,
        actor: currentUser?.id, source: sourceLabel
      }],
      ...leadData
    };
    try {
      const id = await addLeadDoc(lead);
      return { id, ...lead };
    } catch (e) {
      showToast('Failed to add lead', 'error');
      return null;
    }
  };
  // Marking as junk is just a status change, so it flows through updateLead and
  // picks up the normal `status_change` history event for free. Reverting is the
  // same operation in reverse — set any other status and the lead rejoins the
  // pipeline views. We stash the prior status so "Restore" can offer it back.
  const markLeadAsJunk = async (id) => {
    const lead = leads.find(l => l.id === id);
    if (!lead || lead.status === JUNK_STATUS) return;
    await updateLead(id, { status: JUNK_STATUS, preJunkStatus: lead.status });
  };

  // Restore puts the lead back on whatever status it held before it was junked,
  // falling back to the first configured status for leads junked before this
  // field existed (or imported straight to Junk).
  const restoreLeadFromJunk = async (id) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    const statuses = (config.statuses || DEFAULT_CONFIG.statuses).filter(st => st !== JUNK_STATUS);
    const target = (lead.preJunkStatus && statuses.includes(lead.preJunkStatus))
      ? lead.preJunkStatus
      : statuses[0];
    await updateLead(id, { status: target, preJunkStatus: null });
  };

  // Create a full user: auth account, Firestore profile, welcome email. Shared by
  // the Users tab and the Lead Routing "Add new rep" modal so the two can't drift.
  // Returns the new uid so the caller can wire it straight into routing.
  const createFullUser = async ({ name, email, password, role }) => {
    const newUid = await createUserOnSecondaryApp(email, password);
    await saveUserDoc(newUid, {
      name, email, role: role || 'user',
      isSystem: false,
      createdAt: new Date().toISOString()
    });
    try {
      await sendWelcomeEmailToUser({ email, name, password });
    } catch (emailErr) {
      // The account exists; only the email failed. Surface the credentials so the
      // admin can pass them on rather than losing them.
      console.error('Welcome email failed:', emailErr);
      window.alert(
        `User created, but the welcome email could not be sent.\n\n` +
        `Share these with ${name} manually:\n\n` +
        `Email:    ${email}\n` +
        `Password: ${password}`
      );
    }
    return newUid;
  };

  const updateLead = async (id, patch) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;

    // Pipeline guards. Every write path (row dropdown, bulk menu, detail panel)
    // lands here, so these hold however the change was made.
    if (patch.status !== undefined && patch.status !== lead.status) {
      const closed = getClosedStatuses(config);
      const fromStage = stageOfStatus(lead.status, closed);
      const toStage   = stageOfStatus(patch.status, closed);
      // A lead only enters Working once a rep owns it.
      const owner = patch.assignedTo !== undefined ? patch.assignedTo : lead.assignedTo;
      if (toStage === STAGE_WORKING && fromStage !== STAGE_WORKING && isUnassigned({ assignedTo: owner })) {
        showToast('Assign a rep before moving this lead to Working', 'error');
        return false;
      }
      if (!canCloseSalesRequest(lead.status, patch.status, currentUser?.role === 'admin', closed)) {
        showToast('Only the back office (an admin) can mark a submittal Completed', 'error');
        return false;
      }
      // A sale made while the lead is being worked goes through the Sales
      // Submittal, which is what supplies patch.salesRequest.
      if ((patch.status === SALES_REQUEST_STATUS || completesViaSalesRequest(lead.status, patch.status, closed))
          && !patch.salesRequest) {
        showToast('Completing a sale opens the Sales Submittal — change one lead at a time', 'error');
        return false;
      }
    }

    const events = [];
    const now = new Date().toISOString();
    const actor = currentUser?.id;

    // Status change. We stamp `statusChangedAt` on the lead itself in addition to
    // logging the history event, so the current status's age is a plain field read
    // rather than a history walk — cheap enough to render on every row later.
    if (patch.status !== undefined && patch.status !== lead.status) {
      events.push({
        id: uid('h'), type: 'status_change', timestamp: now, actor,
        from: lead.status, to: patch.status
      });
      patch = { ...patch, statusChangedAt: now, statusChangedBy: actor || null };
    }

    // A submitted sales request gets its own timeline entry alongside the status
    // change. Back-office edits to it later come through with _salesRequestEdit.
    if (patch.salesRequest && patch.status === SALES_REQUEST_STATUS) {
      events.push({
        id: uid('h'), type: 'sales_request', timestamp: now, actor,
        equipment: patch.salesRequest.model || ''
      });
    }
    if (patch.deal !== undefined) {
      events.push({ id: uid('h'), type: 'edited', timestamp: now, actor, changes: [{ field: 'deal' }] });
    }
    if (patch._salesRequestEdit) {
      events.push({ id: uid('h'), type: 'edited', timestamp: now, actor, changes: [{ field: 'salesRequest' }] });
      patch = { ...patch };
      delete patch._salesRequestEdit;
    }

    // Secondary assignment change — logged so "why is this in my list?" is answerable
    if (patch.secondaryAssignedTo !== undefined && patch.secondaryAssignedTo !== lead.secondaryAssignedTo) {
      events.push({
        id: uid('h'), type: 'secondary_change', timestamp: now, actor,
        from: lead.secondaryAssignedTo || null, to: patch.secondaryAssignedTo || null
      });
    }

    // Assignment change
    if (patch.assignedTo !== undefined && patch.assignedTo !== lead.assignedTo) {
      events.push({
        id: uid('h'), type: 'assignment_change', timestamp: now, actor,
        from: lead.assignedTo, to: patch.assignedTo
      });
    }

    // Field edits — skip internal arrays and computed/side-effect fields
    const trackedFields = ['customerName', 'companyName', 'contactEmail', 'phone', 'comment', 'branch', 'zip', 'formTitle', 'leadSource', 'submittedBy', 'dateSubmitted'];
    const changes = [];
    for (const f of trackedFields) {
      if (patch[f] !== undefined && patch[f] !== lead[f]) {
        changes.push({ field: f, from: lead[f] || '', to: patch[f] || '' });
      }
    }
    if (changes.length) {
      events.push({ id: uid('h'), type: 'edited', timestamp: now, actor, changes });
    }

    const finalPatch = { ...patch };

    // Leaving Working drops the deadline. Without this, a lead that went
    // Working -> Quoted -> Working would silently inherit the old date.
    if (patch.status !== undefined && patch.status !== WORKING_STATUS && lead.workingUntil) {
      finalPatch.workingUntil = null;
    }

    if (events.length) {
      const baseHistory = patch.history !== undefined ? patch.history : (lead.history || []);
      finalPatch.history = [...baseHistory, ...events];
    }

    try {
      await updateLeadDoc(id, finalPatch);
      if (selectedLead?.id === id) setSelectedLead({ ...selectedLead, ...finalPatch });
      return true;
    } catch (e) {
      showToast('Failed to save change', 'error');
      return false;
    }
  };
  // Single-lead status changes route through here so entering Working can ask
  // for a deadline first. Bulk changes deliberately bypass it — one dialog per
  // lead across a 40-row selection would be unusable, so those fall back to the
  // ordinary staleness threshold.
  const [workingPrompt, setWorkingPrompt] = useState(null);

  const requestStatusChange = (id, status) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    // Check ownership before opening any dialog, so nobody fills one in only to
    // have the change refused at the end.
    const closed = getClosedStatuses(config);
    if (stageOfStatus(status, closed) === STAGE_WORKING
        && stageOfStatus(lead.status, closed) !== STAGE_WORKING
        && isUnassigned(lead)) {
      showToast('Assign a rep before moving this lead to Working', 'error');
      return;
    }
    // Completed on a lead still being worked = the rep made the sale. That opens
    // the Sales Submittal and the lead goes to Sales Request, per Indy's process.
    if (completesViaSalesRequest(lead.status, status, closed)
        || (status === SALES_REQUEST_STATUS && lead.status !== SALES_REQUEST_STATUS)) {
      setSalesRequestPrompt({ leadId: id });
      return;
    }
    // Lost asks why (and who won it) before the lead goes to Completed.
    if (status === LOST_STATUS && lead.status !== LOST_STATUS) {
      setLostPrompt({ leadId: id });
      return;
    }
    if (status === WORKING_STATUS && lead.status !== WORKING_STATUS) {
      setWorkingPrompt({ leadId: id, leadName: lead.customerName || lead.companyName || '', current: null });
      return;
    }
    updateLead(id, { status });
  };

  // Re-picking a length for a lead already in Working, from the Status section.
  const requestWorkingExtend = (id) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    setWorkingPrompt({
      leadId: id,
      leadName: lead.customerName || lead.companyName || '',
      current: lead.workingUntil || null
    });
  };

  const applyWorkingWeeks = (weeks) => {
    if (!workingPrompt) return;
    const { leadId } = workingPrompt;
    setWorkingPrompt(null);
    updateLead(leadId, {
      status: WORKING_STATUS,
      workingUntil: workingDeadlineFrom(weeks),
      workingWeeks: weeks
    });
  };

  // ------------- SALES REQUEST -------------
  // Opened when a lead is moved into Sales Request. Submitting saves the form on
  // the lead, moves it into the Sales Request step, then asks the server to
  // email the order desk (Settings → Sales Request recipients) and the rep. The
  // server re-reads the lead rather than trusting what the browser sends.
  const [salesRequestPrompt, setSalesRequestPrompt] = useState(null);
  const [lostPrompt, setLostPrompt] = useState(null);

  // Lost reason and competitor are kept on the deal record, next to what the
  // customer wanted, so the Completed step shows why it was lost.
  const submitLost = async ({ lostReason, competitor }) => {
    if (!lostPrompt) return;
    const lead = leads.find(l => l.id === lostPrompt.leadId);
    setLostPrompt(null);
    if (!lead) return;
    await updateLead(lead.id, {
      status: LOST_STATUS,
      deal: { ...(lead.deal || {}), lostReason, competitor: competitor || (lead.deal && lead.deal.competitor) || '' }
    });
  };
  const [salesRequestBusy, setSalesRequestBusy] = useState(false);

  const submitSalesRequest = async (form, extraPatch = {}, _newLead = null, files = []) => {
    if (!salesRequestPrompt) return;
    const { leadId } = salesRequestPrompt;
    const lead = leads.find(l => l.id === leadId);
    if (!lead) { setSalesRequestPrompt(null); return; }
    setSalesRequestBusy(true);
    const salesRequest = {
      ...form,
      submittedAt: new Date().toISOString(),
      submittedBy: currentUser?.id || null
    };
    const saved = await updateLead(leadId, { ...extraPatch, status: SALES_REQUEST_STATUS, salesRequest });
    if (!saved) { setSalesRequestBusy(false); return; }   // updateLead already said why
    if (files.length) await attachFiles('leads', leadId, files, 'submittal');
    const res = await sendSalesRequestEmailViaFunction({ leadId });
    // A financed deal goes to the finance team's tracker too — pre-filled, so
    // the rep doesn't type it twice. Only once per lead.
    if (submittalNeedsFinance(salesRequest) && !records.finance.some(f => f.leadId === leadId)) {
      const salesPerson = !isUnassigned(lead) ? lead.assignedTo : currentUser.id;
      await createRecord('finance', { ...financeFromSubmittal(salesRequest, lead), salesPerson }, leadId, { quiet: true });
    }
    setSalesRequestBusy(false);
    setSalesRequestPrompt(null);
    if (res?.sent && res.deskRecipients > 0) {
      showToast(`Sales Submittal sent to ${res.deskRecipients} recipient${res.deskRecipients === 1 ? '' : 's'}`);
    } else if (res?.sent) {
      showToast('Moved to Sales Request — no back-office recipients set in Settings, so only the rep was emailed', 'error');
    } else if (res?.reason === 'no-recipients') {
      showToast('Moved to Sales Request — but no one was emailed. Add recipients in Settings.', 'error');
    } else {
      showToast('Moved to Sales Request — but the email failed to send', 'error');
    }
  };

  // ------------- INDY RECORDS: requests, trade-ins, finance -------------
  // One prompt state for all three forms: { kind, leadId (or null), prefill }.
  const [recordPrompt, setRecordPrompt] = useState(null);
  const [recordBusy, setRecordBusy] = useState(false);
  const RECORD_NAMES = { requests: 'Sales request', tradeIns: 'Trade-in evaluation', finance: 'Finance deal' };

  const emailOutcome = (res, what) => {
    if (res?.sent && res.deskRecipients > 0) {
      showToast(`${what} sent to ${res.deskRecipients} recipient${res.deskRecipients === 1 ? '' : 's'}`);
    } else if (res?.sent) {
      showToast(`${what} saved — no recipients set in Settings, so only the sales person was emailed`, 'error');
    } else if (res?.reason === 'no-recipients') {
      showToast(`${what} saved — but no one was emailed. Add recipients in Settings.`, 'error');
    } else {
      showToast(`${what} saved — but the email failed to send`, 'error');
    }
  };

  // ------------- ATTACHMENTS -------------
  // Upload files for a lead ('leads'), request or trade-in and record them on
  // that document. category tags lead files that belong to the Sales Submittal.
  const attachFiles = async (collectionName, id, files, category) => {
    if (!files || !files.length || !currentUser) return true;
    const { done, failed } = await uploadAttachments(`${collectionName}/${id}`, files, { uploadedBy: currentUser.id, category });
    try {
      await addAttachmentRecords(collectionName, id, done);
    } catch (e) {
      showToast('Files uploaded but could not be linked — try again', 'error');
      return false;
    }
    if (failed.length) {
      showToast(`Couldn't upload ${failed.join(', ')}. Check Storage is enabled and try again.`, 'error');
      return false;
    }
    return true;
  };
  const detachFile = async (collectionName, id, att) => {
    try {
      await deleteAttachmentFile(att.path);
      await removeAttachmentRecord(collectionName, id, att);
    } catch (e) {
      showToast(`Couldn't remove ${att.name}`, 'error');
    }
  };

  // Saves a new record, then emails whoever handles that kind. Returns the id.
  const createRecord = async (kind, fields, leadId = null, { email = true, quiet = false, files = [] } = {}) => {
    if (!currentUser) return null;
    const now = new Date().toISOString();
    const shape = {
      ...fields,
      leadId: leadId || null,
      salesPerson: fields.salesPerson || currentUser.id,
      createdAt: now,
      createdBy: currentUser.id,
      history: [{ id: uid('h'), type: 'created', timestamp: now, actor: currentUser.id }]
    };
    if (kind === 'requests') { shape.status = 'Open'; shape.statusChangedAt = now; shape.done = {}; }
    if (kind === 'finance')  { shape.admin = { dealStatus: 'Submitted' }; shape.dealStatusChangedAt = now; }
    let id;
    try {
      id = await addRecordDoc(kind, shape);
    } catch (e) {
      showToast(`Failed to save the ${RECORD_NAMES[kind].toLowerCase()}`, 'error');
      return null;
    }
    // Files go up once the record exists (they're stored under its id), and
    // before the email, so the email can list them.
    if (files.length) await attachFiles(kind, id, files);
    if (email) {
      const res = await sendRecordEmailViaFunction({ kind, id });
      if (!quiet) emailOutcome(res, RECORD_NAMES[kind]);
    }
    return id;
  };

  const submitRecordPrompt = async (fields, files = []) => {
    if (!recordPrompt) return;
    setRecordBusy(true);
    // A trade-in or finance deal made from a lead belongs to the lead's rep, not
    // to whoever happened to type it (a request picks its Sales Person itself).
    const lead = recordPrompt.leadId ? leads.find(l => l.id === recordPrompt.leadId) : null;
    const withRep = (!fields.salesPerson && lead && !isUnassigned(lead)) ? { ...fields, salesPerson: lead.assignedTo } : fields;
    const id = await createRecord(recordPrompt.kind, withRep, recordPrompt.leadId, { files });
    setRecordBusy(false);
    if (id) setRecordPrompt(null);
  };

  // Every change to a record goes through here so its history stays complete.
  // `changes` names what changed for the log (status moves are logged as such).
  const updateRecord = async (kind, id, patch, note) => {
    const rec = records[kind].find(r => r.id === id);
    if (!rec) return false;
    const now = new Date().toISOString();
    const out = { ...patch };
    const events = [];
    if (patch.status !== undefined && patch.status !== rec.status) {
      out.statusChangedAt = now;
      events.push({ type: 'status_change', from: rec.status || null, to: patch.status });
    }
    const newDeal = patch.admin && patch.admin.dealStatus;
    if (newDeal !== undefined && newDeal !== (rec.admin && rec.admin.dealStatus)) {
      out.dealStatusChangedAt = now;
      events.push({ type: 'status_change', from: (rec.admin && rec.admin.dealStatus) || null, to: newDeal });
    }
    if (note) events.push({ type: 'edited', note });
    if (events.length) {
      out.history = [...(rec.history || []), ...events.map(e => ({ id: uid('h'), timestamp: now, actor: currentUser?.id || null, ...e }))];
    }
    try {
      await updateRecordDoc(kind, id, out);
      return true;
    } catch (e) {
      showToast('Failed to save the change', 'error');
      return false;
    }
  };

  // Requests: a department checking off recomputes the status.
  const updateRequest = async (id, patch) => {
    const rec = records.requests.find(r => r.id === id);
    if (!rec) return false;
    if (patch.done) {
      const status = requestStatusFromDone(rec.requestTypes, patch.done, rec.status);
      return updateRecord('requests', id, { ...patch, status }, 'Department check-off');
    }
    return updateRecord('requests', id, patch);
  };

  // A sale that never went through the LMT (walk-in, counter sale): creates the
  // lead and its Sales Submittal together, straight into the Sales Request step.
  const [newSubmittalOpen, setNewSubmittalOpen] = useState(false);
  // Sub-tabs: Incoming | Junk, Completed | Archived, and the Settings sections.
  const [incomingTab, setIncomingTab] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('view') === 'junk' ? 'junk' : 'incoming'; } catch { return 'incoming'; }
  });
  const [completedTab, setCompletedTab] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('view') === 'archived' ? 'archived' : 'completed'; } catch { return 'completed'; }
  });
  const [settingsTab, setSettingsTab] = useState(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('view');
      return MOVED_VIEWS[v] && MOVED_VIEWS[v][0] === 'settings' ? MOVED_VIEWS[v][1] : 'general';
    } catch { return 'general'; }
  });
  // Follow a retired view id to its new home (e.g. after a role change).
  const goTo = (v) => {
    if (MOVED_VIEWS[v]) {
      const [to, tab] = MOVED_VIEWS[v];
      if (to === 'stage-incoming') setIncomingTab(tab);
      if (to === 'stage-completed') setCompletedTab(tab);
      if (to === 'settings') setSettingsTab(tab);
      setView(to);
      return;
    }
    setView(v);
  };

  // The + New menu.
  const handleNew = (kind) => {
    if (kind === 'lead') { setView('add'); return; }
    if (kind === 'submittal') { setNewSubmittalOpen(true); return; }
    setRecordPrompt({ kind, leadId: null });
  };
  const submitNewSubmittal = async (form, extraPatch, newLead, files = []) => {
    if (!currentUser) return;
    setSalesRequestBusy(true);
    const now = new Date().toISOString();
    const lead = await addLead({
      customerName: newLead.customerName,
      companyName: newLead.companyName,
      phone: newLead.phone,
      contactEmail: newLead.contactEmail,
      branch: extraPatch.branch || '',
      department: 'Sales',
      formTitle: 'Manual Sales Submittal',
      submittedBy: currentUser.name || '',
      assignedTo: newLead.assignedTo,
      dateAssigned: now,
      status: SALES_REQUEST_STATUS,
      statusChangedAt: now,
      statusChangedBy: currentUser.id,
      salesRequest: { ...form, submittedAt: now, submittedBy: currentUser.id },
      history: [
        { id: uid('h'), type: 'created', timestamp: now, actor: currentUser.id, source: MANUAL_SOURCE },
        { id: uid('h'), type: 'sales_request', timestamp: now, actor: currentUser.id, equipment: form.model || '' }
      ]
    }, MANUAL_SOURCE);
    if (!lead) { setSalesRequestBusy(false); return; }
    if (files.length) await attachFiles('leads', lead.id, files, 'submittal');
    const res = await sendSalesRequestEmailViaFunction({ leadId: lead.id });
    if (submittalNeedsFinance(form)) {
      await createRecord('finance', { ...financeFromSubmittal(form, lead), salesPerson: newLead.assignedTo }, lead.id, { quiet: true });
    }
    setSalesRequestBusy(false);
    setNewSubmittalOpen(false);
    emailOutcome(res, 'Sales Submittal');
    setSelectedLead(lead);
  };

  const deleteLead = async (id) => {
    try {
      await deleteLeadDoc(id);
      if (selectedLead?.id === id) setSelectedLead(null);
    } catch (e) {
      showToast('Failed to delete lead', 'error');
    }
  };

  // Manually archive a lead. The lead can still be unarchived later — its
  // close date and history are preserved. This action is independent of the
  // automatic 30-day archive: it just sets a flag that isLeadArchived honors.
  const archiveLead = async (id) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    const now = new Date().toISOString();
    const event = {
      id: uid('h'), type: 'manually_archived',
      timestamp: now, actor: currentUser?.id
    };
    const patch = {
      manuallyArchived: true,
      manuallyArchivedDate: now,
      history: [...(lead.history || []), event]
    };
    try {
      await updateLeadDoc(id, patch);
      if (selectedLead?.id === id) setSelectedLead({ ...selectedLead, ...patch });
      showToast('Lead archived');
    } catch (e) {
      showToast('Failed to archive lead', 'error');
    }
  };

  const unarchiveLead = async (id) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    const now = new Date().toISOString();
    const event = {
      id: uid('h'), type: 'unarchived',
      timestamp: now, actor: currentUser?.id
    };
    const patch = {
      manuallyArchived: false,
      history: [...(lead.history || []), event]
    };
    try {
      await updateLeadDoc(id, patch);
      if (selectedLead?.id === id) setSelectedLead({ ...selectedLead, ...patch });
      showToast('Lead unarchived');
    } catch (e) {
      showToast('Failed to unarchive lead', 'error');
    }
  };
  const importLeads = async (rows) => {
    const now = new Date().toISOString();
    const newLeads = rows.map(r => {
      const source = r.leadSource || 'CSV Import';
      return {
        customerName: r.customerName || '', companyName: r.companyName || '', contactEmail: r.contactEmail || '',
        phone: r.phone || '', comment: r.comment || '',
        branch: r.branch || '', zip: r.zip || '',
        dateSubmitted: r.dateSubmitted || now, formTitle: r.formTitle || '',
        createdDate: now, leadSource: source,
        dateAssigned: null, assignedTo: 'u_1',
        internalComments: [], status: r.status || 'New', statusChangedAt: now,
        history: [{
          id: uid('h'), type: 'created', timestamp: now,
          actor: currentUser?.id, source, viaImport: true
        }]
      };
    });
    try {
      await bulkImportLeads(newLeads);
      showToast(`Imported ${newLeads.length} lead${newLeads.length === 1 ? '' : 's'}`);

      // One digest instead of one alert per lead. The per-lead trigger deliberately
      // skips imports (createdEvent.viaImport), so this is the only notification
      // that goes out for a CSV. Deliberately not awaited into the try above —
      // a failed email must never make a successful import report as failed.
      const branches = {};
      for (const l of newLeads) {
        const b = l.branch || '— No branch —';
        branches[b] = (branches[b] || 0) + 1;
      }
      sendImportSummaryEmailViaFunction({
        imported: newLeads.length,
        unassigned: newLeads.filter(l => !l.assignedTo || l.assignedTo === 'u_1').length,
        branches
      }).catch(() => { /* already logged in the wrapper */ });
    } catch (e) {
      showToast('Import failed', 'error');
    }
  };

  // ------------- DUPLICATE DETECTION -------------
  const [duplicateCheck, setDuplicateCheck] = useState(null);
  // { payload, matches, sourceLabel }

  const submitNewLead = async (payload, sourceLabel = 'Manual Entry') => {
    const matches = findDuplicates(payload, leads, config.duplicateDetection);
    if (matches.length === 0) {
      const lead = await addLead(payload, sourceLabel);
      showToast('Lead added');
      if (lead) setView(stageViewOf(lead));
      setSelectedLead(lead);
      return;
    }
    setDuplicateCheck({ payload, matches, sourceLabel });
  };

  const linkSubmissionToLead = async (existingLeadId, payload, sourceLabel) => {
    const existing = leads.find(l => l.id === existingLeadId);
    if (!existing) return;
    const now = new Date().toISOString();
    const event = {
      id: uid('h'),
      type: 'resubmission',
      timestamp: now,
      actor: currentUser?.id,
      source: sourceLabel || payload.leadSource || 'Manual Entry',
      formTitle: payload.formTitle,
      newComment: payload.comment,
      matchedOn: getMatchedOn(existing, payload)
    };
    try {
      await updateLeadDoc(existingLeadId, {
        history: [...(existing.history || []), event],
        dateSubmitted: now
      });
      showToast('New submission linked to existing lead');
      setDuplicateCheck(null);
      setView(stageViewOf(existing));
      // selectedLead will get refreshed via the onSnapshot subscription
      setSelectedLead({ ...existing, history: [...(existing.history || []), event], dateSubmitted: now });
    } catch (e) {
      showToast('Failed to link submission', 'error');
    }
  };

  const createDuplicateAnyway = async () => {
    if (!duplicateCheck) return;
    const lead = await addLead(duplicateCheck.payload, duplicateCheck.sourceLabel);
    showToast('Lead created as new (duplicate override)');
    setDuplicateCheck(null);
    if (lead) setView(stageViewOf(lead));
    setSelectedLead(lead);
  };

  const openExistingLead = (id) => {
    const existing = leads.find(l => l.id === id);
    setDuplicateCheck(null);
    if (existing) setView(stageViewOf(existing));
    setSelectedLead(existing);
  };

  // ------------- RENDER GATES -------------
  // (Loading gate is below, after FontStyles is defined.)

  // Shared font/animation styles, used by all gated screens too
  const FontStyles = () => (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Saira+Condensed:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
      .font-display { font-family: 'Saira Condensed', sans-serif; letter-spacing: 0.02em; }
      .font-mono { font-family: 'JetBrains Mono', monospace; }
      .scrollbar-thin::-webkit-scrollbar { width: 8px; height: 8px; }
      .scrollbar-thin::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 4px; }
      .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
      @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
      .slide-in { animation: slideIn 0.2s ease-out; }
      @keyframes fadeUp { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:translateY(0);} }
      .fade-up { animation: fadeUp 0.18s ease-out; }

      /* Brand palette derived from #ff3300 (Bobcat orange).
         MUST stay identical to tailwind.config.js — this block paints before
         Tailwind loads, so any drift flashes the wrong color on first render.
         Note: for buttons with bg-brand-500, pair with text-white — orange
         takes white text (the BMH amber fork is the opposite). */
      .bg-brand-50  { background-color: #ffece5; }
      .bg-brand-100 { background-color: #ffd1c2; }
      .bg-brand-200 { background-color: #ff9b75; }
      .bg-brand-500 { background-color: #ff3300; }
      .bg-brand-600 { background-color: #d62b00; }
      .text-brand-500 { color: #ff3300; }
      .text-brand-600 { color: #d62b00; }
      .text-brand-700 { color: #ad2300; }
      .border-brand-200 { border-color: #ff9b75; }
      .border-brand-300 { border-color: #ff7444; }
      .border-brand-400 { border-color: #ff5219; }
      .border-brand-500 { border-color: #ff3300; }
      .accent-brand-500 { accent-color: #ff3300; }
      .hover\\:bg-brand-50:hover  { background-color: #ffece5; }
      .hover\\:bg-brand-100:hover { background-color: #ffd1c2; }
      .hover\\:bg-brand-200:hover { background-color: #ff9b75; }
      .hover\\:border-brand-300:hover { border-color: #ff7444; }
      .hover\\:bg-brand-600:hover { background-color: #d62b00; }
      .hover\\:text-brand-600:hover { color: #d62b00; }
      .focus\\:border-brand-500:focus { border-color: #ff3300; }
      .focus\\:ring-brand-500:focus { --tw-ring-color: #ff3300; box-shadow: 0 0 0 1px #ff3300; }
      .focus\\:ring-brand-200:focus { --tw-ring-color: #ff9b75; box-shadow: 0 0 0 2px #ff9b75; }
      .group:hover .group-hover\\:text-brand-500 { color: #ff3300; }
      .group:hover .group-hover\\:text-brand-600 { color: #d62b00; }

      /* Print styles */
      .print-only { display: none; }
      @media print {
        @page { margin: 0.5in; }
        body { background: white !important; }
        aside, .no-print { display: none !important; }
        main { flex: 1 !important; width: 100% !important; }
        .print-only { display: block !important; }
        .print-break-avoid { break-inside: avoid; }
        header.sticky { position: static !important; }
        /* Chart cards should not split across pages awkwardly */
        .bg-white.border { break-inside: avoid; }
      }
    `}</style>
  );

  // Loading state while Firestore subscriptions warm up
  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50" style={{fontFamily: "'Manrope', system-ui, sans-serif"}}>
        <FontStyles />
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 bg-brand-500 flex items-center justify-center rounded">
            <span className="font-display text-2xl font-bold text-white">B</span>
          </div>
          <div className="text-sm text-stone-500">Loading LMT…</div>
        </div>
      </div>
    );
  }

  // Not signed in → login screen
  if (!currentUser) {
    return (
      <div style={{fontFamily: "'Manrope', system-ui, sans-serif"}}>
        <FontStyles />
        <AuthScreen
          onSignIn={signIn}
          onRequestAccess={submitAccessRequest}
          onForgotPassword={requestPasswordReset}
        />
      </div>
    );
  }

  // Signed in → main app
  return (
    // overflow-x-clip (not -hidden) prevents horizontal scroll on mobile from
    // wide content or the off-canvas sidebar, WITHOUT creating a new scroll
    // container. Using -hidden here broke the sidebar's `md:sticky` behavior
    // because sticky positioning walks up looking for a scroll container and
    // `overflow: hidden` counts as one.
    <div className="min-h-screen bg-stone-50 text-stone-900 overflow-x-clip" style={{fontFamily: "'Manrope', system-ui, sans-serif"}}>
      <FontStyles />

      <div className="flex">
        <Sidebar
          view={view} setView={goTo}
          stageCounts={Object.fromEntries(PIPELINE_STAGES.map(s => [s.id, stageLeads[s.id].length]))}
          backOfficeCounts={{ requests: openRequestCount, finance: openFinanceCount, tradeIns: pendingTradeInCount }}
          userRole={currentUser.role}
          pendingCount={accessRequests.length}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          onNew={handleNew}
        />

        <main className="flex-1 min-h-screen min-w-0 overflow-x-clip">
          <TopBar
            view={view} leads={pipelineLeads} stageLeads={stageLeads} config={configWithUsers}
            currentUser={currentUser} onSignOut={signOut}
            onMobileMenuOpen={() => setMobileNavOpen(true)}
            onChipFilter={applyChipFilter}
          />

          <div className="px-4 md:px-8 py-4 md:py-6">
            {view === HOME_VIEW && (
              <StageHomeView
                stageLeads={stageLeads}
                openRequestCount={openRequestCount}
                onOpenRequests={() => setView('requests')}
                openFinanceCount={openFinanceCount}
                onOpenFinance={() => setView('finance')}
                config={configWithUsers}
                currentUser={currentUser}
                onOpen={setView}
              />
            )}

            {/* Tabs on the two dashboards that absorbed old sidebar items. */}
            {view === getStage(STAGE_INCOMING).view && (
              <SubTabs value={incomingTab} onChange={setIncomingTab}
                tabs={[['incoming', 'Incoming', stageLeads[STAGE_INCOMING].length], ['junk', 'Junk', junkLeads.length]]}/>
            )}
            {view === getStage(STAGE_COMPLETED).view && (
              <SubTabs value={completedTab} onChange={setCompletedTab}
                tabs={[['completed', 'Completed', stageLeads[STAGE_COMPLETED].length], ['archived', 'Archived', visibleArchivedLeads.length]]}/>
            )}
            {view === getStage(STAGE_SALES_REQUEST).view && (
              <div className="flex justify-end mb-3">
                <button onClick={() => setNewSubmittalOpen(true)}
                  className="text-xs px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-md inline-flex items-center gap-1.5"
                  title="Enter a sale that didn't come through the LMT">
                  <Plus size={13}/> New Sales Submittal
                </button>
              </div>
            )}

            {PIPELINE_STAGES.map(stage => view === stage.view
              && !(stage.id === STAGE_INCOMING && incomingTab === 'junk')
              && !(stage.id === STAGE_COMPLETED && completedTab === 'archived') && (
              /* One dashboard per step. `stageLeads` is already narrowed to the
                 step AND to what this user may see, so the table does no
                 scoping of its own (scope="all"). `stage` only drives the
                 status options and the empty state. key= resets filters when
                 switching between steps. Leads a rep only sees because they
                 entered them are watch-only for that rep. */
              <LeadsView
                key={stage.id}
                leads={stageLeads[stage.id]} config={configWithUsers}
                onSelect={setSelectedLead}
                onUpdate={updateLead} onDelete={deleteLead}
                onStatusChange={requestStatusChange}
                stage={stage.id}
                isAdmin={currentUser.role === 'admin'}
                createdByUserId={currentUser.id}
                watchOnly={currentUser.role === 'admin' ? null
                  : (l) => !isLeadVisibleInStage(l, stage.id, currentUser)}
                scope="all"
                prefilter={leadsPrefilter}
                onPrefilterConsumed={() => setLeadsPrefilter(null)}
              />
            ))}
            {view === getStage(STAGE_INCOMING).view && incomingTab === 'junk' && (
              <JunkLeadsView
                leads={junkLeads} config={configWithUsers}
                onSelect={setSelectedLead}
                onUpdate={updateLead} onDelete={deleteLead}
                onStatusChange={requestStatusChange}
              />
            )}
            {view === getStage(STAGE_COMPLETED).view && completedTab === 'archived' && (
              <ArchivedLeadsView
                leads={visibleArchivedLeads} config={configWithUsers}
                onSelect={setSelectedLead}
              />
            )}

            {/* Back office */}
            {view === 'requests' && (
              <RequestsView
                requests={visibleRequests} leads={leads} config={configWithUsers} currentUser={currentUser}
                onUpdate={updateRequest}
                onOpenLead={setSelectedLead}
                onNew={() => setRecordPrompt({ kind: 'requests', leadId: null })}
                onAddFiles={(id, files) => attachFiles('requests', id, files)}
                onRemoveFile={(id, att) => detachFile('requests', id, att)}
              />
            )}
            {view === 'finance' && (
              <FinanceView
                deals={visibleRecords.finance} leads={leads} config={configWithUsers} currentUser={currentUser}
                onUpdate={(id, patch, note) => updateRecord('finance', id, patch, note)}
                onOpenLead={setSelectedLead}
                onNew={() => setRecordPrompt({ kind: 'finance', leadId: null })}
              />
            )}
            {view === 'trade-ins' && (
              <TradeInsView
                tradeIns={visibleRecords.tradeIns} leads={leads} config={configWithUsers} currentUser={currentUser}
                onUpdate={(id, patch, note) => updateRecord('tradeIns', id, patch, note)}
                onOpenLead={setSelectedLead}
                onNew={() => setRecordPrompt({ kind: 'tradeIns', leadId: null })}
                onAddFiles={(id, files) => attachFiles('tradeIns', id, files)}
                onRemoveFile={(id, att) => detachFile('tradeIns', id, att)}
              />
            )}

            {view === 'add' && (
              <AddLeadView config={configWithUsers} currentUser={currentUser} onAdd={(d) => submitNewLead(d, 'Manual Entry')} />
            )}
            {view === 'reports' && canAccessView('reports', currentUser.role) && (
              <ReportsView leads={pipelineLeads} config={configWithUsers}/>
            )}
            {view === 'users' && canAccessView('users', currentUser.role) && (
              <UsersView
                config={configWithUsers} onSave={saveConfig} leads={pipelineLeads}
                onApprove={approveRequest} onDeny={denyRequest}
                onToggleRole={toggleUserRole}
                currentUserId={currentUser.id}
                currentUserRole={currentUser.role}
              />
            )}
            {view === 'settings' && canAccessView('settings', currentUser.role) && (
              <>
                <SubTabs value={settingsTab} onChange={setSettingsTab} tabs={SETTINGS_TABS}/>
                {settingsTab === 'general' && (
                  <SettingsConfigView config={configWithUsers} onSave={saveConfig} leads={leads} />
                )}
                {settingsTab === 'notifications' && (
                  <div className="max-w-3xl"><NotificationsConfigCard config={configWithUsers} onSave={saveConfig}/></div>
                )}
                {settingsTab === 'routing' && (
                  <LeadRoutingView config={configWithUsers} onSave={saveConfig} onCreateUser={createFullUser} canEdit/>
                )}
                {settingsTab === 'scoring' && (
                  <ScoringRulesView config={configWithUsers} onSave={saveConfig} />
                )}
                {settingsTab === 'import' && (
                  <ImportView config={configWithUsers} onImport={importLeads} leads={pipelineLeads}/>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {selectedLead && (
        <LeadDetailPanel
          /* The live copy from the subscription, so the panel reflects files,
             records and edits made anywhere — by this user or someone else —
             while it is open. Falls back to the snapshot for a lead that has
             just been created and hasn't arrived from Firestore yet. */
          lead={leads.find(l => l.id === selectedLead.id) || selectedLead} config={configWithUsers} currentUser={currentUser}
          onClose={() => setSelectedLead(null)}
          onUpdate={updateLead}
          onDelete={(id) => { deleteLead(id); showToast('Lead deleted'); }}
          onArchive={archiveLead}
          onUnarchive={unarchiveLead}
          onMarkJunk={markLeadAsJunk}
          onRestoreJunk={restoreLeadFromJunk}
          onStatusChange={requestStatusChange}
          onExtendWorking={requestWorkingExtend}
          leadRecords={{
            requests: records.requests.filter(r => r.leadId === selectedLead.id),
            tradeIns: records.tradeIns.filter(r => r.leadId === selectedLead.id),
            finance:  records.finance.filter(r => r.leadId === selectedLead.id)
          }}
          onUpdateRequest={updateRequest}
          onUpdateRecord={updateRecord}
          onNewRecord={(kind, leadId) => setRecordPrompt({ kind, leadId })}
          onAddLeadFiles={(id, files) => attachFiles('leads', id, files)}
          onRemoveLeadFile={(id, att) => detachFile('leads', id, att)}
        />
      )}

      {lostPrompt && (() => {
        const lostLead = leads.find(l => l.id === lostPrompt.leadId);
        if (!lostLead) return null;
        return (
          <LostDealModal
            lead={lostLead}
            onSubmit={submitLost}
            onCancel={() => setLostPrompt(null)}
          />
        );
      })()}

      {recordPrompt && (() => {
        const recLead = recordPrompt.leadId ? leads.find(l => l.id === recordPrompt.leadId) : null;
        const common = {
          lead: recLead, config: configWithUsers, currentUser, busy: recordBusy,
          onSubmit: submitRecordPrompt,
          onCancel: () => { if (!recordBusy) setRecordPrompt(null); }
        };
        if (recordPrompt.kind === 'requests') return <RequestModal {...common}/>;
        if (recordPrompt.kind === 'tradeIns') return <TradeInModal {...common}/>;
        return <FinanceModal {...common}/>;
      })()}

      {newSubmittalOpen && (
        <SalesRequestModal
          lead={{}}
          newLead
          config={configWithUsers}
          currentUser={currentUser}
          busy={salesRequestBusy}
          onSubmit={submitNewSubmittal}
          onCancel={() => { if (!salesRequestBusy) setNewSubmittalOpen(false); }}
        />
      )}

      {salesRequestPrompt && (() => {
        const srLead = leads.find(l => l.id === salesRequestPrompt.leadId);
        if (!srLead) return null;
        return (
          <SalesRequestModal
            lead={srLead}
            config={configWithUsers}
            busy={salesRequestBusy}
            onSubmit={submitSalesRequest}
            onCancel={() => { if (!salesRequestBusy) setSalesRequestPrompt(null); }}
          />
        );
      })()}

      {workingPrompt && (
        <WorkingWeeksModal
          leadName={workingPrompt.leadName}
          current={workingPrompt.current}
          onChoose={applyWorkingWeeks}
          onCancel={() => setWorkingPrompt(null)}
        />
      )}

      {duplicateCheck && (
        <DuplicateCheckModal
          check={duplicateCheck}
          config={configWithUsers}
          onLinkSubmission={(existingId) => linkSubmissionToLead(existingId, duplicateCheck.payload, duplicateCheck.sourceLabel)}
          onOpenExisting={openExistingLead}
          onCreateAnyway={createDuplicateAnyway}
          onCancel={() => setDuplicateCheck(null)}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg fade-up text-sm font-medium ${
          toast.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-stone-900 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

/* ===================== AUTH SCREENS ===================== */

function AuthShell({ children, subtitle }) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background industrial pattern */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, #1c1917 0 2px, transparent 2px 24px)' }}/>
      <div className="absolute top-0 left-0 w-full h-1 bg-brand-500"/>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="w-11 h-11 bg-brand-500 flex items-center justify-center rounded-sm">
              <span className="font-display text-2xl font-bold text-white">B</span>
            </div>
          </div>
          <div className="font-display text-3xl font-bold text-stone-900 tracking-wide">BOBCAT OF INDY</div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500 mt-1">{subtitle}</div>
        </div>

        <div className="bg-white border border-stone-200 rounded-lg shadow-sm p-7">
          {children}
        </div>
      </div>
    </div>
  );
}

function AuthScreen({ onSignIn, onRequestAccess, onForgotPassword }) {
  const [mode, setMode] = useState('signin'); // signin | request | requestSent | forgot | forgotSent
  const [forgotEmailDefault, setForgotEmailDefault] = useState('');

  return (
    <AuthShell subtitle={
      mode === 'signin'      ? 'LMT · Sign in' :
      mode === 'request'     ? 'LMT · Request access' :
      mode === 'requestSent' ? 'LMT · Request access' :
                               'LMT · Reset password'
    }>
      {mode === 'signin' && (
        <SignInForm
          onSignIn={onSignIn}
          onRequestAccess={() => setMode('request')}
          onForgotPassword={(prefillEmail) => { setForgotEmailDefault(prefillEmail || ''); setMode('forgot'); }}
        />
      )}
      {mode === 'request'     && <RequestAccessForm onSubmit={onRequestAccess} onCancel={() => setMode('signin')} onSent={() => setMode('requestSent')} />}
      {mode === 'requestSent' && <RequestSentMessage onBack={() => setMode('signin')} />}
      {mode === 'forgot' && (
        <ForgotPasswordForm
          initialEmail={forgotEmailDefault}
          onSubmit={onForgotPassword}
          onCancel={() => setMode('signin')}
          onSent={() => setMode('forgotSent')}
        />
      )}
      {mode === 'forgotSent' && <ResetSentMessage onBack={() => setMode('signin')} />}
    </AuthShell>
  );
}

function SignInForm({ onSignIn, onRequestAccess, onForgotPassword }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    if (!email || !password) return setErr('Please enter your email and password.');
    setBusy(true);
    const res = await onSignIn({ email, password });
    setBusy(false);
    if (!res.ok) setErr(res.error);
  };

  return (
    <div className="space-y-3">
      <AuthField label="Email">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus
          className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
      </AuthField>
      <AuthField label="Password">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
      </AuthField>

      <div className="flex justify-end -mt-1">
        <button
          type="button"
          onClick={() => onForgotPassword(email)}
          className="text-xs font-medium text-stone-500 hover:text-brand-600 transition-colors">
          Forgot password?
        </button>
      </div>

      {err && (
        <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 flex items-center gap-2">
          <AlertCircle size={12}/> {err}
        </div>
      )}

      <button onClick={submit} disabled={busy}
        className="w-full mt-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-stone-300 text-white text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-colors">
        <KeyRound size={15}/> Sign In
      </button>
    </div>
  );
}

function ForgotPasswordForm({ initialEmail = '', onSubmit, onCancel, onSent }) {
  const [email, setEmail] = useState(initialEmail);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    setBusy(true);
    const res = await onSubmit(email);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onSent();
  };

  return (
    <div className="space-y-3">
      <div className="text-center mb-1">
        <div className="font-semibold text-stone-900">Reset your password</div>
        <div className="text-xs text-stone-500 mt-1">Enter the email associated with your account. We'll send you a link to set a new password.</div>
      </div>

      <AuthField label="Email">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus
          onKeyDown={e => e.key === 'Enter' && submit()}
          className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
      </AuthField>

      {err && (
        <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 flex items-center gap-2">
          <AlertCircle size={12}/> {err}
        </div>
      )}

      <button onClick={submit} disabled={busy}
        className="w-full mt-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-stone-300 text-white text-sm font-semibold rounded-md flex items-center justify-center gap-2 transition-colors">
        <Send size={14}/> {busy ? 'Sending…' : 'Send reset link'}
      </button>
      <button onClick={onCancel}
        className="w-full py-2 text-stone-600 hover:text-stone-900 text-sm font-medium">
        ← Back to sign in
      </button>
    </div>
  );
}

function ResetSentMessage({ onBack }) {
  return (
    <div className="text-center space-y-3 py-2">
      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
        <Mail size={20} className="text-emerald-700"/>
      </div>
      <div>
        <div className="font-semibold text-stone-900">Check your inbox</div>
        <div className="text-xs text-stone-500 mt-1 leading-relaxed">
          If an account exists for that email, you'll receive a link to set a new password within a minute. The link expires after one hour.
        </div>
        <div className="text-[10px] text-stone-400 mt-2">
          Don't see it? Check your spam folder, or contact your administrator.
        </div>
      </div>
      <button onClick={onBack}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-stone-900 hover:text-brand-600">
        ← Back to sign in
      </button>
    </div>
  );
}

function RequestAccessForm({ onSubmit, onCancel, onSent }) {
  const [form, setForm] = useState({ name: '', email: '', reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    if (!form.name.trim()) return setErr('Name is required.');
    if (!validEmail(form.email)) return setErr('Enter a valid email.');
    setBusy(true);
    const res = await onSubmit({
      name: form.name, email: form.email, reason: form.reason
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onSent();
  };

  return (
    <div className="space-y-3">
      <div className="text-center mb-2">
        <div className="font-semibold text-stone-900">Request Access</div>
        <div className="text-xs text-stone-500 mt-1">An administrator will review and approve your request. You'll be emailed a link to set your password.</div>
      </div>

      <AuthField label="Full Name">
        <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
          className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
      </AuthField>
      <AuthField label="Work Email">
        <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
          className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
      </AuthField>
      <AuthField label="Reason for Access (optional)">
        <textarea value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} rows={2}
          placeholder="e.g. Sales rep, Indy North branch"
          className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"/>
      </AuthField>

      {err && (
        <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 flex items-center gap-2">
          <AlertCircle size={12}/> {err}
        </div>
      )}

      <button onClick={submit} disabled={busy}
        className="w-full mt-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-stone-300 text-white text-sm font-semibold rounded-md flex items-center justify-center gap-2">
        <Send size={14}/> Submit Request
      </button>
      <button onClick={onCancel}
        className="w-full py-2 text-stone-600 hover:text-stone-900 text-sm font-medium">
        ← Back to sign in
      </button>
    </div>
  );
}

function RequestSentMessage({ onBack }) {
  return (
    <div className="text-center py-4">
      <div className="w-12 h-12 mx-auto bg-emerald-50 rounded-full flex items-center justify-center mb-3">
        <CheckCircle2 size={24} className="text-emerald-600"/>
      </div>
      <div className="font-semibold text-stone-900">Request Submitted</div>
      <div className="text-sm text-stone-500 mt-1.5 leading-relaxed px-2">
        Your request has been sent for review. You'll be able to sign in once an administrator approves your account.
      </div>
      <button onClick={onBack}
        className="mt-5 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold rounded-md">
        Back to sign in
      </button>
    </div>
  );
}

function AuthField({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1.5">{label}</label>
      {children}
    </div>
  );
}

/* ===================== SIDEBAR ===================== */
// The + New menu: every form in one place, the way each Smartsheet had its own.
const NEW_MENU = [
  { kind: 'lead',        label: 'Lead',            hint: 'A new sales opportunity',            icon: UserPlus },
  { kind: 'requests',    label: 'Sales Request',   hint: 'Delivery, get ready, demo, parts…',  icon: Send },
  { kind: 'tradeIns',    label: 'Trade-In',        hint: 'Evaluate a customer’s machine',      icon: RefreshCw },
  { kind: 'submittal',   label: 'Sales Submittal', hint: 'A sale that didn’t start as a lead', icon: ClipboardList },
  { kind: 'finance',     label: 'Finance Deal',    hint: 'For the finance team’s tracker',     icon: Briefcase }
];

function Sidebar({ view, setView, stageCounts = {}, backOfficeCounts = {}, userRole, pendingCount, mobileOpen, onMobileClose, onNew }) {
  const [newOpen, setNewOpen] = useState(false);
  // Groups, in order. Access is still decided centrally by canAccessView, and a
  // group whose items are all filtered out disappears with them.
  const groups = [
    { title: 'Pipeline', items: [
      { id: HOME_VIEW, label: 'Dashboards', icon: LayoutDashboard },
      ...PIPELINE_STAGES.map(s => ({ id: s.view, label: s.label, icon: STAGE_ICONS[s.id], badge: stageCounts[s.id], indent: true }))
    ] },
    { title: 'Back Office', items: [
      { id: 'requests',  label: 'Sales Requests',     icon: Send,          badge: backOfficeCounts.requests },
      { id: 'finance',   label: 'Finance',            icon: Briefcase,     badge: backOfficeCounts.finance },
      { id: 'trade-ins', label: userRole === 'admin' ? 'Trade-In Approvals' : 'Trade-Ins', icon: RefreshCw,     badge: backOfficeCounts.tradeIns }
    ] },
    { title: null, items: [
      { id: 'reports',   label: 'Reports',            icon: BarChart3 }
    ] },
    { title: 'Admin', items: [
      { id: 'users',     label: 'Users',              icon: UsersIcon, badge: pendingCount, badgeAccent: pendingCount > 0 },
      { id: 'settings',  label: 'Settings',           icon: SettingsIcon }
    ] }
  ].map(g => ({ ...g, items: g.items.filter(i => canAccessView(i.id, userRole)) }))
   .filter(g => g.items.length);

  const handleNav = (id) => {
    setView(id);
    if (onMobileClose) onMobileClose();
  };

  return (
    <>
      {/* Backdrop — only visible when mobile drawer is open */}
      {mobileOpen && (
        <div
          onClick={onMobileClose}
          className="md:hidden fixed inset-0 bg-stone-900/60 z-40"
          aria-hidden="true"
        />
      )}

      {/* Sidebar — sticky on desktop, off-canvas on mobile */}
      <aside className={`
        bg-stone-900 text-stone-100 flex flex-col z-50
        fixed md:sticky inset-y-0 left-0 md:top-0
        h-screen w-64 md:w-60
        transform transition-transform duration-200 ease-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="px-5 py-6 border-b border-stone-800 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-brand-500 flex items-center justify-center rounded-sm">
              <span className="font-display text-xl font-bold text-white">B</span>
            </div>
            <div className="leading-tight">
              <div className="font-display text-lg font-bold tracking-wide">BOBCAT</div>
              <div className="text-[9px] uppercase tracking-[0.1em] text-stone-400 -mt-0.5 whitespace-nowrap">of Indy · LMT</div>
            </div>
          </div>
          {/* Close button — visible only on mobile when drawer is open */}
          <button
            onClick={onMobileClose}
            className="md:hidden p-1 text-stone-400 hover:text-white"
            aria-label="Close menu">
            <X size={20}/>
          </button>
        </div>

        {/* + New — every form in one place */}
        <div className="px-3 pt-4 relative">
          <button onClick={() => setNewOpen(o => !o)} aria-haspopup="menu" aria-expanded={newOpen}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold">
            <Plus size={16}/> New
            <ChevronDown size={14} className={`transition-transform ${newOpen ? 'rotate-180' : ''}`}/>
          </button>
          {newOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNewOpen(false)} aria-hidden="true"/>
              <div role="menu" className="absolute left-3 right-3 mt-1 z-20 bg-white text-stone-900 rounded-md shadow-xl border border-stone-200 py-1">
                {NEW_MENU.map(m => {
                  const Icon = m.icon;
                  return (
                    <button key={m.kind} role="menuitem"
                      onClick={() => { setNewOpen(false); onNew(m.kind); if (onMobileClose) onMobileClose(); }}
                      className="w-full text-left px-3 py-2 hover:bg-stone-50 flex items-start gap-2.5">
                      <Icon size={15} className="text-brand-700 mt-0.5 shrink-0"/>
                      <span>
                        <span className="block text-sm font-semibold">{m.label}</span>
                        <span className="block text-[11px] text-stone-500">{m.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <nav className="flex-1 px-3 py-3 overflow-y-auto scrollbar-thin">
          {groups.map((g, gi) => (
            <div key={g.title || gi} className={gi ? 'mt-4' : ''}>
              {g.title && (
                <div className="px-3 pb-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold text-stone-500">{g.title}</div>
              )}
              <div className="space-y-0.5">
                {g.items.map(item => {
                  const Icon = item.icon;
                  const active = view === item.id;
                  return (
                    <button key={item.id} onClick={() => handleNav(item.id)} aria-current={active ? 'page' : undefined}
                      className={`w-full flex items-center gap-3 ${item.indent ? 'pl-6 pr-3' : 'px-3'} py-2.5 md:py-2 rounded-md text-sm font-medium transition-colors ${
                        active ? 'bg-stone-800 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-800/50'
                      }`}>
                      <Icon size={16} className={active ? 'text-brand-500' : ''} />
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.badge > 0 && (
                        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                          item.badgeAccent ? 'bg-brand-600 text-white font-bold' : 'bg-stone-800'
                        }`}>{item.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

/* ===================== TOP BAR ===================== */
function TopBar({ view, leads, stageLeads = {}, config, currentUser, onSignOut, onMobileMenuOpen, onChipFilter }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const stage = stageForView(view);
  const titles = {
    [HOME_VIEW]: 'Dashboards',
    ...Object.fromEntries(PIPELINE_STAGES.map(s => [s.view, s.label])),
    requests: 'Sales Requests',
    finance: 'Finance',
    'trade-ins': 'Trade-In Evaluations',
    archived: 'Archived Leads',
    junk: 'Junk',
    add: 'Add Lead', import: 'Import Leads',
    reports: 'Reports',
    users: 'Users', scoring: 'Scoring Rules', settings: 'Settings',
    'lead-routing': 'Lead Routing'
  };

  const stats = useMemo(() => {
    const closedStatuses = getClosedStatuses(config);
    // A step dashboard counts exactly what its table shows (the same bucket).
    let lst;
    if (stage)            lst = stageLeads[stage.id] || [];
    else                  lst = [];

    return {
      total:      lst.length,
      hot:        lst.filter(l => scoreLead(l, config.scoringRules).tier === 'Urgent').length,
      stale:      lst.filter(l => isLeadStale(l, config.staleness)).length,
      unassigned: lst.filter(l => isUnassigned(l)).length,
      open:       lst.filter(l => !closedStatuses.includes(l.status)).length,
      won:        lst.filter(l => l.status === WON_STATUS).length,
      lost:       lst.filter(l => l.status === 'Lost').length
    };
  }, [stageLeads, stage, config.scoringRules, config.staleness, config.closedStatuses]);

  const initials = currentUser.name.split(' ').map(s => s[0]).join('').slice(0,2).toUpperCase();
  const mine = currentUser.role !== 'admin';

  return (
    <header className="border-b border-stone-200 bg-white sticky top-0 z-30 no-print">
      <div className="px-4 md:px-8 py-3 md:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Hamburger — mobile only */}
          <button
            onClick={onMobileMenuOpen}
            className="md:hidden p-1.5 -ml-1 text-stone-700 hover:bg-stone-100 rounded"
            aria-label="Open menu">
            <Menu size={22}/>
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-xl md:text-3xl font-bold text-stone-900 leading-tight truncate">{titles[view]}</h1>
            <div className="text-[11px] md:text-xs text-stone-500 mt-0.5 truncate hidden sm:block">
              {view === HOME_VIEW && (mine ? 'Your leads at each step of the sale' : 'Every lead, at each step of the sale')}
              {stage && `${stats.total} lead${stats.total === 1 ? '' : 's'}${mine ? (stage.id === STAGE_INCOMING ? ' assigned to you or unassigned' : ' assigned to you') : ''} · ${stage.blurb}`}
              {view === 'requests' && (mine ? 'Deliveries, get-readies, demos, parts, pick-ups and service you\'ve requested' : 'Operations requests, checked off by Rental, Service and Parts')}
              {view === 'finance' && (mine ? 'Your financed deals and where they are in funding' : 'Financed deals from submittal to funding')}
              {view === 'trade-ins' && (mine ? 'Your trade-in evaluations and their approval status' : 'Trade-in evaluations waiting for a value and approval')}
              {view === 'archived' && 'Leads closed for 30+ days — exported or cleared from here'}
              {view === 'junk' && 'Spam and non-leads, kept out of every dashboard and report'}
              {view === 'add' && 'Manually enter a new lead'}
              {view === 'import' && 'Upload a CSV file with leads'}
              {view === 'reports' && 'Pipeline health, conversion, and team performance'}
              {view === 'users' && 'Manage sales team members and access requests'}
              {view === 'scoring' && 'Tune how leads are scored and ranked'}
              {view === 'lead-routing' && 'Who each location and department routes leads to'}
              {view === 'settings' && 'Configure statuses, branches, departments, and lead sources'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          {/* Stat chips — desktop only; mobile keeps the top bar uncluttered */}
          {stage && stage.id !== STAGE_COMPLETED && (
            <div className="hidden lg:flex gap-2">
              <StatChip label="Total"      value={stats.total}      onClick={() => onChipFilter('all')}        title="Show every lead in this step (clear filters)"/>
              <StatChip label="🚨 Urgent"  value={stats.hot}        accent="brand" onClick={() => onChipFilter('hot')}        title="Filter to Urgent leads"/>
              <StatChip label="Stale"      value={stats.stale}      accent={stats.stale > 0 ? 'rose' : undefined} onClick={() => onChipFilter('stale')}      title="Filter to stale leads"/>
              {stage.id === STAGE_INCOMING && (
                <StatChip label="Unassigned" value={stats.unassigned} onClick={() => onChipFilter('unassigned')} title="Filter to unassigned leads"/>
              )}
            </div>
          )}
          {stage && stage.id === STAGE_COMPLETED && (
            <div className="hidden lg:flex gap-2">
              <StatChip label="Total" value={stats.total} onClick={() => onChipFilter('all')}  title="Show everything in this step (clear filters)"/>
              <StatChip label={WON_STATUS} value={stats.won}   accent="brand" onClick={() => onChipFilter('won')}  title="Filter to completed sales"/>
              <StatChip label="Lost"      value={stats.lost}  accent={stats.lost > 0 ? 'rose' : undefined} onClick={() => onChipFilter('lost')} title="Filter to lost deals"/>
            </div>
          )}

          {/* User menu — compact on mobile (avatar only), expanded on desktop */}
          <div className="relative">
            <button onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-2 pl-1 pr-1 md:pr-2.5 py-1 rounded-md hover:bg-stone-50 border border-stone-200">
              <div className="w-8 h-8 md:w-7 md:h-7 rounded-full bg-stone-900 text-white text-[10px] font-semibold flex items-center justify-center">{initials}</div>
              <div className="text-left leading-tight hidden md:block">
                <div className="text-xs font-semibold text-stone-900">{currentUser.name}</div>
                <div className="text-[10px] uppercase tracking-wider text-stone-500">
                  {currentUser.role === 'admin' ? 'Admin' : 'Sales Rep'}
                </div>
              </div>
              <ChevronDown size={12} className="text-stone-400 hidden md:block"/>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)}/>
                <div className="absolute right-0 mt-1 w-52 bg-white border border-stone-200 rounded-md shadow-lg z-30 py-1">
                  <div className="px-3 py-2 border-b border-stone-100">
                    <div className="text-sm font-semibold text-stone-900">{currentUser.name}</div>
                    <div className="text-xs text-stone-500 truncate">{currentUser.email}</div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 mt-0.5">
                      {currentUser.role === 'admin' ? 'Admin' : 'Sales Rep'}
                    </div>
                  </div>
                  <button onClick={() => { setMenuOpen(false); onSignOut(); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 text-stone-700 flex items-center gap-2">
                    <LogOut size={13}/> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function StatChip({ label, value, accent, onClick, title }) {
  // accent: undefined | 'brand' | 'rose' | true (legacy = 'brand')
  const tone = accent === true ? 'brand' : accent;
  const palette = {
    brand: { border: 'border-brand-200', bg: 'bg-brand-50', text: 'text-brand-700', hoverBg: 'hover:bg-brand-100' },
    rose:  { border: 'border-rose-200',  bg: 'bg-rose-50',  text: 'text-rose-700',  hoverBg: 'hover:bg-rose-100'  }
  }[tone];
  const wrap = palette ? `${palette.border} ${palette.bg}` : 'border-stone-200 bg-stone-50';
  const hoverBg = palette ? palette.hoverBg : 'hover:bg-stone-100';
  const valColor = palette ? palette.text : 'text-stone-900';

  const content = (
    <>
      <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold">{label}</div>
      <div className={`font-mono font-semibold text-lg leading-tight ${valColor}`}>{value}</div>
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        title={title}
        className={`px-3.5 py-2 rounded-md border text-left transition-colors cursor-pointer ${wrap} ${hoverBg} active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-brand-500/40`}>
        {content}
      </button>
    );
  }

  return (
    <div className={`px-3.5 py-2 rounded-md border ${wrap}`}>
      {content}
    </div>
  );
}

/* ===================== LEADS VIEW ===================== */
/* ===================== ARCHIVED LEADS VIEW =====================
 * Read-only catalog of leads that have been closed for 30+ consecutive days.
 *
 * Provides:
 *   - Export to CSV filtered by recency window (30/60/90/180/360/720 days, or all time)
 *   - A "Clear All" flow that hard-deletes every archived lead from Firestore.
 *     The clear flow gates deletion behind a forced export step so admins never
 *     accidentally nuke the archive without keeping a copy.
 *
 * Archived leads are excluded from every other view in the app. They live
 * here until an admin clears them.
 */
function ArchivedLeadsView({ leads, config, onSelect }) {
  const [exportWindow, setExportWindow] = useState('all');  // '30' | '60' | '90' | '180' | '360' | '720' | 'all'
  const [showClearModal, setShowClearModal] = useState(false);

  const userMap = useMemo(
    () => Object.fromEntries(config.users.map(u => [u.id, u])),
    [config.users]
  );

  // Add the computed archive date to each lead so we can filter and display it.
  // For manually archived leads (which may not be in a closed status), fall back
  // to manuallyArchivedDate as the relevant timestamp for sorting/filtering.
  const enriched = useMemo(() => leads.map(l => ({
    ...l,
    _closedAt: getMostRecentCloseDate(l, config) || l.manuallyArchivedDate || null
  })), [leads, config.closedStatuses]);

  // Sort newest archive first
  const sorted = useMemo(() => {
    return [...enriched].sort((a, b) => {
      if (!a._closedAt) return 1;
      if (!b._closedAt) return -1;
      return new Date(b._closedAt) - new Date(a._closedAt);
    });
  }, [enriched]);

  // Pre-compute counts for each window so the dropdown can show them
  const windowCounts = useMemo(() => {
    const now = new Date();
    const counts = { '30': 0, '60': 0, '90': 0, '180': 0, '360': 0, '720': 0, 'all': enriched.length };
    enriched.forEach(l => {
      if (!l._closedAt) return;
      const daysAgo = (now - new Date(l._closedAt)) / 86400000;
      ['30','60','90','180','360','720'].forEach(w => {
        if (daysAgo <= Number(w)) counts[w]++;
      });
    });
    return counts;
  }, [enriched]);

  const exportSelection = useMemo(() => {
    if (exportWindow === 'all') return sorted;
    const cutoff = Date.now() - Number(exportWindow) * 86400000;
    return sorted.filter(l => l._closedAt && new Date(l._closedAt).getTime() >= cutoff);
  }, [sorted, exportWindow]);

  const exportToCsv = (leadsToExport) => {
    if (leadsToExport.length === 0) {
      alert('No archived leads in the selected range.');
      return;
    }
    const rows = leadsToExport.map(l => ({
      'Customer Name': l.customerName || '', 'Company Name': l.companyName || '',
      'Contact Email': l.contactEmail || '',
      'Phone': l.phone || '',
      'Comment': l.comment || '',
      'Branch': l.branch || '',
      'Department': l.department || '',
      'Zip': l.zip || '',
      'Status': l.status || '',
      'Date Submitted': l.dateSubmitted || '',
      'Date Closed': l._closedAt || '',
      'Lead Source': formatLeadSource(l) || '',
      'Assigned To': userMap[l.assignedTo]?.name || '',
      'Form Title': l.formTitle || '',
      'Internal Comments': (l.internalComments || []).map(c => `[${fmtDateTime(c.timestamp)}] ${c.text}`).join(' | ')
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    const label = exportWindow === 'all' ? 'all' : `last-${exportWindow}-days`;
    a.download = `ind-lmt-archived-${label}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Top controls — export window + actions. Always visible, even when empty,
          so admins can see what the screen offers. Actions disable when nothing
          to export or clear. */}
      <div className="bg-white border border-stone-200 rounded-lg p-4 mb-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-bold mb-1">Export window</label>
            <select
              value={exportWindow}
              onChange={e => setExportWindow(e.target.value)}
              disabled={leads.length === 0}
              className="px-3 py-2 border border-stone-200 rounded-md text-sm bg-white disabled:bg-stone-50 disabled:text-stone-400">
              <option value="30">Last 30 days ({windowCounts['30']})</option>
              <option value="60">Last 60 days ({windowCounts['60']})</option>
              <option value="90">Last 90 days ({windowCounts['90']})</option>
              <option value="180">Last 180 days ({windowCounts['180']})</option>
              <option value="360">Last 360 days ({windowCounts['360']})</option>
              <option value="720">Last 720 days ({windowCounts['720']})</option>
              <option value="all">All archived ({windowCounts['all']})</option>
            </select>
          </div>
          <div className="text-xs text-stone-500 md:max-w-xs">
            {leads.length === 0
              ? 'No archived leads to export or clear yet.'
              : `${exportSelection.length} lead${exportSelection.length === 1 ? '' : 's'} match this window. They'll be included in the CSV export.`}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => exportToCsv(exportSelection)}
            disabled={exportSelection.length === 0}
            className="px-3 py-2 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white text-sm font-semibold rounded-md flex items-center gap-1.5">
            <Download size={14}/> Export CSV
          </button>
          <button
            onClick={() => setShowClearModal(true)}
            disabled={leads.length === 0}
            className="px-3 py-2 border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:border-stone-200 disabled:text-stone-400 disabled:hover:bg-transparent text-sm font-semibold rounded-md flex items-center gap-1.5">
            <Trash2 size={14}/> Clear All
          </button>
        </div>
      </div>

      {/* List or empty state */}
      {leads.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-lg p-12 text-center">
          <ArchiveX size={36} className="mx-auto text-stone-300 mb-3"/>
          <div className="text-base font-semibold text-stone-900">No archived leads yet</div>
          <div className="text-sm text-stone-500 mt-1 max-w-md mx-auto">
            Leads automatically move here {ARCHIVE_DAYS} days after they're closed (Won, Lost, or Unqualified) without being reopened.
          </div>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-stone-200 bg-stone-50 text-[10px] uppercase tracking-widest font-bold text-stone-500">
            {leads.length} archived lead{leads.length === 1 ? '' : 's'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50/40 text-[10px] uppercase tracking-widest text-stone-500 font-bold">
                <tr>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Branch · Dept</th>
                  <th className="px-3 py-2 text-left">Assigned</th>
                  <th className="px-3 py-2 text-left">Closed</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(lead => (
                  <tr key={lead.id}
                      onClick={() => onSelect(lead)}
                      className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-stone-900">{lead.customerName || <span className="text-stone-400 italic font-normal">No name</span>}</span>
                        {lead.manuallyArchived && (
                          <span
                            title="Manually archived by an admin"
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 border border-stone-300">
                            MANUAL
                          </span>
                        )}
                      </div>
                      {lead.contactEmail && <div className="text-xs text-stone-500">{lead.contactEmail}</div>}
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={lead.status}/></td>
                    <td className="px-3 py-2.5 text-xs text-stone-600">
                      {[lead.branch, lead.department].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-stone-600">
                      {userMap[lead.assignedTo]?.name || <span className="text-stone-400 italic">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-stone-500">
                      {lead._closedAt ? fmtDate(lead._closedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showClearModal && (
        <ClearArchivedLeadsModal
          totalCount={leads.length}
          onExport={() => exportToCsv(sorted)}
          onCancel={() => setShowClearModal(false)}
          archivedLeadIds={leads.map(l => l.id)}
        />
      )}
    </div>
  );
}

/* ===================== CLEAR ARCHIVED LEADS MODAL =====================
 * Two-step confirm:
 *   Step 1: warn the admin and require an export before they can proceed
 *   Step 2: after export, the "Delete" button unlocks
 */
function ClearArchivedLeadsModal({ totalCount, onExport, onCancel, archivedLeadIds }) {
  const [hasExported, setHasExported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const handleExport = () => {
    onExport();
    setHasExported(true);
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await bulkDeleteLeads(archivedLeadIds);
      onCancel();  // close modal
    } catch (e) {
      alert('Failed to clear archived leads: ' + (e.message || 'Unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const canDelete = hasExported && confirmText === 'DELETE';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={18} className="text-rose-600 shrink-0"/>
            <div className="text-base font-semibold text-stone-900">Clear all archived leads</div>
          </div>
          <div className="text-xs text-stone-500 mt-1">
            This permanently deletes <strong>{totalCount} archived lead{totalCount === 1 ? '' : 's'}</strong> from the database. There is no undo.
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Step 1: export */}
          <div className={`p-3 border rounded-md ${hasExported ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-bold uppercase tracking-widest text-stone-700 flex items-center gap-1.5">
                {hasExported ? <Check size={12} className="text-emerald-600"/> : <span className="text-amber-700">Step 1</span>}
                Export all archived leads
              </div>
            </div>
            <div className="text-xs text-stone-700 mb-2 leading-relaxed">
              {hasExported
                ? 'CSV downloaded. You can now proceed to deletion below.'
                : 'Download a complete CSV of every archived lead before deleting. This is your only chance to keep a copy.'}
            </div>
            <button
              onClick={handleExport}
              disabled={busy}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md flex items-center gap-1.5 ${
                hasExported
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-stone-900 hover:bg-stone-800 text-white'
              }`}>
              <Download size={13}/> {hasExported ? 'Export again' : 'Export CSV now'}
            </button>
          </div>

          {/* Step 2: delete */}
          <div className={`p-3 border rounded-md ${hasExported ? 'border-stone-200' : 'border-stone-200 opacity-50'}`}>
            <div className="text-xs font-bold uppercase tracking-widest text-stone-700 mb-2 flex items-center gap-1.5">
              <span className={hasExported ? 'text-rose-700' : 'text-stone-400'}>Step 2</span>
              Confirm permanent deletion
            </div>
            <div className="text-xs text-stone-700 mb-2 leading-relaxed">
              Type <code className="px-1 py-0.5 bg-stone-100 border border-stone-200 rounded font-mono text-[11px]">DELETE</code> in the box below to confirm.
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              disabled={!hasExported || busy}
              className="w-full px-2.5 py-1.5 border border-stone-200 rounded text-sm font-mono focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 disabled:bg-stone-50"
            />
          </div>
        </div>

        <div className="px-5 py-3 bg-stone-50 border-t border-stone-200 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 border border-stone-200 hover:bg-white text-stone-700 text-sm font-semibold rounded-md disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || busy}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-stone-200 disabled:text-stone-400 text-white text-sm font-semibold rounded-md flex items-center gap-1.5">
            {busy
              ? <><RefreshCw size={13} className="animate-spin"/> Deleting…</>
              : <><Trash2 size={13}/> Delete {totalCount} lead{totalCount === 1 ? '' : 's'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== JUNK ===================== */
// The Junk tab is deliberately unscoped — every user sees every junked lead, so
// anyone can spot a good lead that was binned by mistake and put it back. This
// is the one view that isn't filtered by assignee.
//
// It reuses LeadsView so junk keeps the same search / filter / sort / pagination
// the rest of the app has; a junk pile is exactly where you need to search.
// Reverting is just a status change, done from the row dropdown or the detail
// panel — no separate un-junk plumbing.
function JunkLeadsView({ leads, config, onSelect, onUpdate, onDelete, onStatusChange }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 px-3.5 py-3 bg-stone-100 border border-stone-200 rounded-lg">
        <Trash2 size={16} className="text-stone-500 shrink-0 mt-0.5"/>
        <div className="text-xs text-stone-600 leading-relaxed">
          <span className="font-semibold text-stone-800">Junk</span> holds leads marked as
          spam or not real. They are excluded from the pipeline, from every closed-leads
          view, and from all report metrics. Everyone can see this tab.
          <br/>
          Change a lead&rsquo;s status to put it back into the pipeline. Junk left untouched
          for {ARCHIVE_DAYS} days moves to Archived on its own.
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-stone-200 rounded-lg">
          <Trash2 size={28} className="mx-auto text-stone-300 mb-3"/>
          <div className="text-sm font-medium text-stone-600">No junk leads</div>
          <div className="text-xs text-stone-400 mt-1">
            Mark a lead as junk from its detail panel and it will show up here.
          </div>
        </div>
      ) : (
        <LeadsView
          leads={leads} config={config}
          onSelect={onSelect}
          onUpdate={onUpdate} onDelete={onDelete}
          onStatusChange={onStatusChange}
          scope="junk"
        />
      )}
    </div>
  );
}

function LeadsView({ leads, config, onSelect, onUpdate, onDelete, onStatusChange, myUserId, creatorUserId, createdByUserId, watchOnly, readOnly = false, scope = 'all', stage = null, isAdmin = false, prefilter, onPrefilterConsumed }) {
  // "Created by me" toggle — replaces the old My Created Leads page. Only
  // offered when the caller passes the signed-in user's id.
  const [onlyCreated, setOnlyCreated] = useState(false);
  // A rep sees leads they entered even after handing them off; those rows are
  // watch-only (no bulk select, no inline assign/status).
  const rowReadOnly = (l) => readOnly || (watchOnly ? watchOnly(l) : false);
  // Falls back to a plain write if a caller didn't pass the gate, so a missing
  // prop degrades to the old behaviour rather than throwing on first click.
  const changeStatus = onStatusChange || ((id, status) => onUpdate(id, { status }));
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterAssigned, setFilterAssigned] = useState('All');
  const [filterSource, setFilterSource] = useState('All');
  // Only meaningful while filterSource is Manual Entry — see submitterOptions below.
  const [filterSubmitter, setFilterSubmitter] = useState('All');
  const [filterBranch, setFilterBranch] = useState('All');
  const [filterDepartment, setFilterDepartment] = useState('All');
  const [filterHeat, setFilterHeat] = useState('All');
  const [filterStale, setFilterStale] = useState('All');
  const [sortBy, setSortBy] = useState(
    myUserId ? { field: 'heat', dir: 'desc' } : { field: 'createdDate', dir: 'desc' }
  );
  const [selected, setSelected] = useState(new Set());

  // Pagination — page size defaults to 50 (reads well on desktop, fast on mobile).
  // Persisted per-tab in localStorage so a user's preferred page size sticks
  // across navigations within a session.
  const [pageSize, setPageSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem('lmt.leadsPageSize'));
      return [25, 50, 100, 200].includes(stored) ? stored : 50;
    } catch { return 50; }
  });
  const [page, setPage] = useState(1);
  useEffect(() => {
    try { localStorage.setItem('lmt.leadsPageSize', String(pageSize)); } catch {}
  }, [pageSize]);

  // Consume the chip prefilter signal: when set, apply the matching local filters,
  // clear any conflicting ones, then notify App to clear the signal.
  useEffect(() => {
    if (!prefilter) return;

    // Reset all chip-controlled filters first so each preset starts clean
    const clear = () => {
      setFilterStatus('All');
      setFilterHeat('All');
      setFilterStale('All');
      setFilterAssigned('All');
    };

    switch (prefilter) {
      case 'all':
        clear();
        setSearch('');
        setFilterSource('All');
        setFilterBranch('All');
        setFilterDepartment('All');
        break;
      case 'hot':
        clear();
        // Chip preset key stays 'hot' (internal identifier); tier value uses 'Urgent'
        setFilterHeat('Urgent');
        break;
      case 'stale':
        clear();
        setFilterStale('Stale');
        break;
      case 'unassigned':
        clear();
        setFilterAssigned('u_1');
        break;
      case 'open':
        clear();
        setFilterStatus('Open');
        break;
      case 'won':
        clear();
        setFilterStatus(WON_STATUS);
        break;
      case 'lost':
        clear();
        setFilterStatus('Lost');
        break;
      default:
        break;
    }
    onPrefilterConsumed?.();
  }, [prefilter, onPrefilterConsumed]);

  const userMap = useMemo(() => Object.fromEntries(config.users.map(u => [u.id, u])), [config.users]);

  // Only offer statuses this view can actually contain. Without this, an open-scoped
  // Who has actually submitted a manual lead in this table. Built from the data
  // rather than the user list on purpose: Submitter is free text, so it can hold a
  // name that never had an account, and offering a name with no leads behind it
  // just produces an empty grid.
  const submitterOptions = useMemo(() => {
    const names = new Set();
    let anyBlank = false;
    for (const l of leads) {
      if (l.leadSource !== MANUAL_SOURCE) continue;
      const by = (l.submittedBy || '').trim();
      if (by) names.add(by); else anyBlank = true;
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    // Manual leads that predate the Submitter field still need to be findable.
    return ['All', ...sorted, ...(anyBlank ? [NO_SUBMITTER] : [])];
  }, [leads]);

  // Leaving Manual Entry would otherwise strand this on a name, silently narrowing
  // a source the filter no longer applies to.
  useEffect(() => {
    if (filterSource !== MANUAL_SOURCE && filterSubmitter !== 'All') setFilterSubmitter('All');
  }, [filterSource, filterSubmitter]);

  // table lets you filter to "Won" and stare at an empty grid wondering what broke.
  // Offer only statuses this table can structurally contain, so nobody picks a
  // filter that returns an empty grid.
  //   open   -> the working statuses
  //   closed -> the closed statuses MINUS Junk. Junk is a closed status, but the
  //             closed tables are fed pipelineLeads, which strips junk out first.
  //   junk   -> every row is Junk by definition, so a status filter is meaningless
  //             and the control hides itself (FilterSelect drops a lone option).
  const statusFilterOptions = useMemo(() => {
    const closedStatuses = getClosedStatuses(config);
    const all = config.statuses || [];
    // A step dashboard only ever holds that step's statuses.
    if (stage)              return ['All', ...all.filter(st => stageOfStatus(st, closedStatuses) === stage)];
    if (scope === 'junk')   return ['All'];
    if (scope === 'open')   return ['All', ...all.filter(st => !closedStatuses.includes(st))];
    if (scope === 'closed') return ['All', ...all.filter(st => closedStatuses.includes(st) && st !== JUNK_STATUS)];
    return ['All', 'Open', ...all];
  }, [scope, stage, config.statuses, config.closedStatuses]);

  // A scope change can strand the filter on a status the new scope excludes.
  useEffect(() => {
    if (filterStatus !== 'All' && !statusFilterOptions.includes(filterStatus)) setFilterStatus('All');
  }, [statusFilterOptions, filterStatus]);

  // Pre-filter to current user's leads when in My Leads mode.
  // `creatorUserId` is the My Created Leads tab: ownership by who entered the
  // lead, not who it's assigned to — deliberately independent of assignment, so
  // a lead you typed in and handed off still shows up here.
  const visibleLeads = useMemo(() => {
    const closedStatuses = getClosedStatuses(config);
    let lst = leads;
    if (creatorUserId)  lst = lst.filter(l => isCreatedByUser(l, creatorUserId));
    else if (myUserId)  lst = lst.filter(l => isLeadForUser(l, myUserId));
    if (createdByUserId && onlyCreated) lst = lst.filter(l => isCreatedByUser(l, createdByUserId));
    if (scope === 'open')   lst = lst.filter(l => !closedStatuses.includes(l.status));
    if (scope === 'closed') lst = lst.filter(l =>  closedStatuses.includes(l.status));
    return lst;
  }, [leads, myUserId, creatorUserId, createdByUserId, onlyCreated, scope, config.closedStatuses]);

  // Pre-compute scores and staleness once per leads change
  const scored = useMemo(() => visibleLeads.map(l => ({
    ...l,
    _score: scoreLead(l, config.scoringRules),
    _staleness: getStaleness(l, config.staleness)
  })), [visibleLeads, config.scoringRules, config.staleness]);

  // For the "Assigned" filter dropdown: only show users who actually have leads
  // in the current scope. Reduces clutter (admins don't see every rep listed when
  // most have zero matches). Always include 'u_1' (Unassigned) if any leads are
  // unassigned, and always include the currently-selected value so the dropdown
  // doesn't show a blank when you pick someone then change other filters.
  const assignedOptionIds = useMemo(() => {
    const ids = new Set(visibleLeads.map(l => l.assignedTo || 'u_1'));
    if (filterAssigned !== 'All') ids.add(filterAssigned);
    return ids;
  }, [visibleLeads, filterAssigned]);

  const filtered = useMemo(() => {
    let result = scored.filter(l => {
      if (filterStatus !== 'All') {
        if (filterStatus === 'Open') {
          // Virtual filter: any status that isn't a closed/terminal one
          if (getClosedStatuses(config).includes(l.status)) return false;
        } else {
          if (l.status !== filterStatus) return false;
        }
      }
      if (!myUserId && filterAssigned !== 'All' && l.assignedTo !== filterAssigned) return false;
      if (filterSource !== 'All' && l.leadSource !== filterSource) return false;
      if (filterSource === MANUAL_SOURCE && filterSubmitter !== 'All') {
        const by = (l.submittedBy || '').trim();
        if (filterSubmitter === NO_SUBMITTER ? by !== '' : by !== filterSubmitter) return false;
      }
      if (filterBranch !== 'All' && l.branch !== filterBranch) return false;
      if (filterDepartment !== 'All' && l.department !== filterDepartment) return false;
      if (filterHeat !== 'All' && l._score.tier !== filterHeat) return false;
      if (filterStale === 'Stale' && !l._staleness.stale) return false;
      if (filterStale === 'Fresh' && l._staleness.stale) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        return [l.customerName, l.companyName, l.contactEmail, l.phone, l.zip, l.comment, l.formTitle]
          .filter(Boolean).some(v => v.toLowerCase().includes(s));
      }
      return true;
    });
    result.sort((a, b) => {
      let av, bv;
      if (sortBy.field === 'heat') {
        av = a._score.total; bv = b._score.total;
      } else if (sortBy.field === 'age') {
        av = a._staleness.hours; bv = b._staleness.hours;
      } else {
        av = a[sortBy.field] || ''; bv = b[sortBy.field] || '';
      }
      if (av < bv) return sortBy.dir === 'asc' ? -1 : 1;
      if (av > bv) return sortBy.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [scored, search, filterStatus, filterAssigned, filterSource, filterSubmitter, filterBranch, filterHeat, filterStale, sortBy, myUserId]);

  // Pagination derivations. When filters change, the current page may no longer
  // exist (e.g. was on page 5, filter narrows to only 2 pages). Clamp back to 1
  // so the user isn't stranded on an empty page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [filtered.length, pageSize, totalPages, page]);

  // Paged slice — this is what actually renders. filtered stays the full list
  // so bulk-select-all, export, and counts still see everything that matches.
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const toggleSort = (field) => {
    setSortBy(prev => prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'desc' });
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleSelectAll = () => {
    const selectable = filtered.filter(l => !rowReadOnly(l));
    if (selected.size === selectable.length) setSelected(new Set());
    else setSelected(new Set(selectable.map(l => l.id)));
  };

  const bulkAssign = async (userId) => {
    const now = new Date().toISOString();
    for (const id of selected) {
      await onUpdate(id, { assignedTo: userId, dateAssigned: userId === 'u_1' ? null : now });
    }
    setSelected(new Set());
  };
  const bulkStatus = async (status) => {
    for (const id of selected) await onUpdate(id, { status });
    setSelected(new Set());
  };
  const bulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} leads? This cannot be undone.`)) return;
    for (const id of selected) await onDelete(id);
    setSelected(new Set());
  };

  const exportCSV = () => {
    const rows = filtered.map(l => ({
      'Customer Name': l.customerName, 'Company Name': l.companyName || '', 'Contact Email': l.contactEmail, 'Phone': l.phone,
      'Comment': l.comment, 'Branch': l.branch, 'Department': l.department || '', 'Zip': l.zip,
      'Date Submitted': l.dateSubmitted, 'Form Title': l.formTitle,
      'Created Date': l.createdDate, 'Lead Source': formatLeadSource(l),
      'Date Assigned': l.dateAssigned || '',
      'Assigned To': userMap[l.assignedTo]?.name || '',
      'Internal Comments': l.internalComments.map(c => `[${fmtDateTime(c.timestamp)}] ${c.text}`).join(' | '),
      'Status': l.status,
      'Heat Score': l._score.total,
      'Heat Tier': l._score.tier
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ind-leads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="bg-white border border-stone-200 rounded-lg mb-4">
        <div className="p-2.5 md:p-3 flex items-center gap-2 flex-wrap">
          <div className="relative w-full md:flex-1 md:w-auto md:min-w-[240px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, phone, zip…"
              className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
          </div>
          <FilterSelect value={filterStatus}   onChange={setFilterStatus}   options={statusFilterOptions} label="Status" />
          <FilterSelect value={filterHeat}     onChange={setFilterHeat}     options={['All', 'Urgent', 'Warm', 'Cool', 'Cold']} label="Heat" />
          <FilterSelect value={filterStale}    onChange={setFilterStale}    options={['All', 'Stale', 'Fresh']} label="Age" />
          {!myUserId && (
            <FilterSelect
              value={filterAssigned}
              onChange={setFilterAssigned}
              options={['All', ...config.users.filter(u => assignedOptionIds.has(u.id)).map(u => u.id)]}
              labelMap={{
                All: 'All Users',
                ...Object.fromEntries(config.users.map(u => [u.id, u.name + (u.onLeaveOfAbsence ? ' (on leave)' : '')]))
              }}
              label="Assigned"
              searchable
            />
          )}
          <FilterSelect value={filterSource}   onChange={setFilterSource}   options={['All', ...config.sources]} label="Source" />
          {filterSource === MANUAL_SOURCE && submitterOptions.length > 1 && (
            <FilterSelect value={filterSubmitter} onChange={setFilterSubmitter} options={submitterOptions} label="Submitter" />
          )}
          <FilterSelect value={filterBranch}   onChange={setFilterBranch}   options={['All', ...config.branches]} label="Branch" />
          <FilterSelect value={filterDepartment} onChange={setFilterDepartment} options={['All', ...(config.departments || [])]} label="Department" />
          {createdByUserId && (
            <button type="button" onClick={() => setOnlyCreated(v => !v)} aria-pressed={onlyCreated}
              title="Show only leads you entered yourself"
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider border rounded-md flex items-center gap-1.5 ${onlyCreated ? 'bg-brand-600 border-brand-600 text-white' : 'border-stone-200 hover:bg-stone-50 text-stone-700'}`}>
              <UserPlus size={13}/> Created by me
            </button>
          )}
          <button onClick={exportCSV} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider border border-stone-200 rounded-md hover:bg-stone-50 flex items-center gap-1.5">
            <Download size={13}/> <span className="hidden sm:inline">Export</span>
          </button>
        </div>

        {!readOnly && selected.size > 0 && (
          <div className="px-3 py-2.5 border-t border-stone-200 bg-brand-50 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-stone-900">{selected.size} selected</span>
            <div className="h-4 w-px bg-stone-300 mx-1" />
            <SearchableSelect
              value=""
              onChange={(userId) => { if (userId) bulkAssign(userId); }}
              options={config.users.map(u => ({
                value: u.id,
                label: u.isSystem ? '— Unassigned —' : u.name,
                hint: u.onLeaveOfAbsence ? 'on leave' : undefined,
                italic: u.isSystem
              }))}
              ariaLabel="Assign selected leads to"
              searchPlaceholder="Search reps…"
              renderTrigger={({ open }) => (
                <div className={`text-xs px-2.5 py-1.5 border rounded bg-white flex items-center gap-1.5 ${open ? 'border-brand-400' : 'border-stone-300'}`}>
                  Assign to… <ChevronDown size={11} className="text-stone-400"/>
                </div>
              )}
            />
            <select onChange={e => { if (e.target.value) { bulkStatus(e.target.value); e.target.value=''; } }} defaultValue=""
              className="text-xs px-2.5 py-1.5 border border-stone-300 rounded bg-white">
              <option value="" disabled>Set status…</option>
              {/* On a step dashboard, only the moves that step allows — and never
                  Sales Request, which needs its form filled in one lead at a time. */}
              {(stage ? bulkStatusOptionsFor(stage, config.statuses, getClosedStatuses(config), { isAdmin }) : config.statuses)
                .map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={bulkDelete} className="text-xs px-2.5 py-1.5 text-rose-700 hover:bg-rose-100 rounded flex items-center gap-1">
              <Trash2 size={12}/> Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs text-stone-600 hover:text-stone-900 ml-auto">Clear</button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={
            stage ? STAGE_ICONS[stage]
            : scope === 'closed' ? CheckCircle2
            : myUserId ? User
            : LayoutGrid
          }
          title={
            visibleLeads.length === 0
              ? (stage ? STAGE_EMPTY[stage].title
                : scope === 'open'   ? (myUserId ? 'No open leads in your pipeline' : 'No leads in the working pipeline')
                : scope === 'closed' ? 'No closed deals yet'
                : myUserId           ? 'No leads assigned to you yet'
                                     : 'No leads yet')
              : 'No leads match your filters'
          }
          subtitle={
            visibleLeads.length === 0
              ? (stage ? (isAdmin ? STAGE_EMPTY[stage].admin : STAGE_EMPTY[stage].rep)
                : scope === 'open'   ? (myUserId
                    ? 'Open leads assigned to you will appear here. Check My Closed for completed deals.'
                    : 'Leads being worked \u2014 New, Contacted, Working or Quoted \u2014 appear here. Closed leads move to All Closed.')
                : scope === 'closed' ? 'When you mark a lead as Won, Lost, Unqualified or No Decision it moves here.'
                : myUserId           ? 'Once an admin assigns leads to you, they will appear here.'
                                     : 'Add a lead manually or import a CSV to get started.')
              : 'Try adjusting your filters or search query.'
          }
        />
      ) : (
        <>
          {/* MOBILE CARD LIST — visible on small screens only */}
          <div className="md:hidden space-y-2.5">
            {/* Sort dropdown for mobile (since cards don't have column headers) */}
            <div className="flex items-center justify-between text-xs text-stone-500 px-1">
              <span>{filtered.length} lead{filtered.length === 1 ? '' : 's'}</span>
              <select
                value={`${sortBy.field}:${sortBy.dir}`}
                onChange={(e) => {
                  const [field, dir] = e.target.value.split(':');
                  setSortBy({ field, dir });
                }}
                className="text-xs px-2 py-1 border border-stone-200 rounded-md bg-white"
              >
                <option value="heat:desc">🚨 Most urgent first</option>
                <option value="heat:asc">Coldest first</option>
                <option value="createdDate:desc">Newest first</option>
                <option value="createdDate:asc">Oldest first</option>
                <option value="customerName:asc">Name A–Z</option>
                <option value="customerName:desc">Name Z–A</option>
                <option value="status:asc">Status A–Z</option>
              </select>
            </div>

            {paged.map(lead => (
              <MobileLeadCard
                key={lead.id}
                lead={lead}
                config={config}
                readOnly={rowReadOnly(lead)}
                watchOnly={!readOnly && rowReadOnly(lead)}
                isAdmin={isAdmin}
                onStatusChange={changeStatus}
                isSelected={selected.has(lead.id)}
                onSelect={() => onSelect(lead)}
                onToggleSelect={() => toggleSelect(lead.id)}
                onUpdate={onUpdate}
              />
            ))}
          </div>

          {/* DESKTOP TABLE — hidden on mobile */}
          <div className="hidden md:block bg-white border border-stone-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase tracking-widest text-stone-500">
                    {!readOnly && (
                      <th className="px-3 py-2.5 w-8">
                        <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.filter(l => !rowReadOnly(l)).length}
                          onChange={toggleSelectAll} className="accent-brand-500"/>
                      </th>
                    )}
                    <SortHeader label="Customer"  field="customerName"  sortBy={sortBy} onClick={toggleSort} />
                    <SortHeader label="Heat"      field="heat"          sortBy={sortBy} onClick={toggleSort} />
                    <SortHeader label="Contact"   field="contactEmail"  sortBy={sortBy} onClick={toggleSort} />
                    <SortHeader label="Source"    field="leadSource"    sortBy={sortBy} onClick={toggleSort} />
                    <SortHeader label="Branch"    field="branch"        sortBy={sortBy} onClick={toggleSort} />
                    <SortHeader label="Dept"      field="department"    sortBy={sortBy} onClick={toggleSort} />
                    <SortHeader label="Submitted" field="dateSubmitted" sortBy={sortBy} onClick={toggleSort} />
                    <SortHeader label="Assigned"  field="assignedTo"    sortBy={sortBy} onClick={toggleSort} />
                    <SortHeader label="Status"    field="status"        sortBy={sortBy} onClick={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {paged.map(lead => (
                    <tr key={lead.id} className="border-b border-stone-100 hover:bg-stone-50 transition-colors group">
                      {!readOnly && (
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          {!rowReadOnly(lead) && (
                            <input type="checkbox" checked={selected.has(lead.id)}
                              onChange={() => toggleSelect(lead.id)} className="accent-brand-500"/>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-3 cursor-pointer" onClick={() => onSelect(lead)}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-stone-900">{lead.customerName || <span className="text-stone-400 italic font-normal">No name</span>}</span>
                          {!readOnly && rowReadOnly(lead) && (
                            <span title="You entered this lead; it's assigned to someone else" className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200 shrink-0">Created by you</span>
                          )}
                          {(() => {
                            const n = (lead.history || []).filter(h => h.type === 'resubmission').length;
                            if (n === 0) return null;
                            return (
                              <span
                                title={`Submitted ${n + 1} times`}
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-0.5 shrink-0">
                                <RefreshCw size={9}/>{n + 1}×
                              </span>
                            );
                          })()}
                        </div>
                        {lead.companyName && (
                          <div className="text-xs text-stone-500 truncate max-w-[220px]">{lead.companyName}</div>
                        )}
                        {lead.zip && <div className="text-xs text-stone-500 font-mono mt-0.5">ZIP {lead.zip}</div>}
                        {lead.comment && (
                          <div className="text-xs text-stone-600 mt-1 line-clamp-4 max-w-[420px] leading-snug" title={lead.comment}>
                            {lead.comment}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 cursor-pointer" onClick={() => onSelect(lead)}>
                        <HeatBadge score={lead._score.total} tier={lead._score.tier} compact/>
                      </td>
                      <td className="px-3 py-3 cursor-pointer" onClick={() => onSelect(lead)}>
                        {lead.contactEmail && <div className="text-stone-700 truncate max-w-[200px]">{lead.contactEmail}</div>}
                        {lead.phone && <div className="text-xs text-stone-500 font-mono mt-0.5">{lead.phone}</div>}
                      </td>
                      <td className="px-3 py-3 cursor-pointer" onClick={() => onSelect(lead)}>
                        <span className="text-xs px-2 py-1 rounded bg-stone-100 text-stone-700 font-medium">{formatLeadSource(lead)}</span>
                      </td>
                      <td className="px-3 py-3 cursor-pointer text-stone-700" onClick={() => onSelect(lead)}>{lead.branch || '—'}</td>
                      <td className="px-3 py-3 cursor-pointer text-stone-700 text-xs" onClick={() => onSelect(lead)}>{lead.department || '—'}</td>
                      <td className="px-3 py-3 cursor-pointer text-stone-700 font-mono text-xs" onClick={() => onSelect(lead)}>{fmtDate(lead.dateSubmitted)}</td>
                      <td className="px-3 py-3 cursor-pointer" onClick={() => onSelect(lead)}>
                        <InlineAssignSelect
                          readOnly={rowReadOnly(lead)}
                          value={lead.assignedTo}
                          users={config.users}
                          onChange={(userId) => onUpdate(lead.id, {
                            assignedTo: userId,
                            dateAssigned: userId === 'u_1' ? null : new Date().toISOString()
                          })}
                        />
                      </td>
                      <td className="px-3 py-3 cursor-pointer" onClick={() => onSelect(lead)}>
                        <InlineStatusSelect
                          readOnly={rowReadOnly(lead)}
                          value={lead.status}
                          options={statusOptionsFor(lead.status, config.statuses, getClosedStatuses(config), { isAdmin })}
                          onChange={(status) => changeStatus(lead.id, status)}
                        />
                        <AgeIndicator staleness={lead._staleness}/>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination — one instance below both list variants. It's always
              visible when there's more than one page's worth of leads, so users
              on any device get the same controls. */}
          {filtered.length > pageSize && (
            <PaginationControls
              page={page} totalPages={totalPages}
              pageSize={pageSize}
              totalCount={filtered.length}
              onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ===================== PAGINATION CONTROLS =====================
 * Compact pagination bar for the leads table.
 *
 * Design goals:
 *   - Show the current window ("Showing 51–100 of 347") — the most useful info
 *   - Prev / Next as the primary controls (touch-friendly, keyboard-friendly)
 *   - First / Last jumps for long lists
 *   - Page-size picker so heavy users can crank it up to 100 or 200
 *   - Numbered pages with ellipses when there are many pages
 */
function PaginationControls({ page, totalPages, pageSize, totalCount, onPageChange, onPageSizeChange }) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  // Build a small windowed page list around the current page. Always shows
  // first and last, plus the current page and its neighbors. Extra pages are
  // collapsed into "…" placeholders (rendered as non-clickable spans).
  const pageNumbers = useMemo(() => {
    const pages = new Set([1, totalPages, page, page - 1, page + 1]);
    // On wider screens we can afford to show one more on each side
    if (page > 3) pages.add(page - 2);
    if (page < totalPages - 2) pages.add(page + 2);
    const sorted = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    // Insert ellipses where there are gaps
    const out = [];
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) out.push('…');
      out.push(p);
      prev = p;
    }
    return out;
  }, [page, totalPages]);

  return (
    <div className="mt-4 bg-white border border-stone-200 rounded-lg px-3 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      {/* Left: range summary + page size */}
      <div className="flex items-center gap-3 text-xs text-stone-600">
        <span>
          Showing <span className="font-semibold text-stone-900">{start.toLocaleString()}</span>
          –<span className="font-semibold text-stone-900">{end.toLocaleString()}</span>
          {' '}of <span className="font-semibold text-stone-900">{totalCount.toLocaleString()}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline text-stone-500">Per page:</span>
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            className="text-xs px-2 py-1 border border-stone-200 rounded bg-white">
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </div>
      </div>

      {/* Right: page navigation */}
      <div className="flex items-center gap-1">
        {/* First page */}
        <button
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          title="First page"
          className="p-1.5 rounded text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent">
          <ChevronsLeft size={14}/>
        </button>
        {/* Prev */}
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          title="Previous page"
          className="p-1.5 rounded text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent">
          <ChevronLeft size={14}/>
        </button>

        {/* Numbered pages — hidden on very small screens where space is tight;
            the compact "page X of Y" below serves those users instead. */}
        <div className="hidden md:flex items-center gap-0.5 mx-1">
          {pageNumbers.map((p, i) => (
            p === '…' ? (
              <span key={`ellipsis-${i}`} className="px-1.5 text-stone-400 text-xs">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`min-w-[28px] px-2 py-1 text-xs rounded font-semibold ${
                  p === page
                    ? 'bg-brand-600 text-white'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}>
                {p}
              </button>
            )
          ))}
        </div>

        {/* Compact indicator on mobile */}
        <span className="md:hidden text-xs text-stone-600 mx-2">
          Page <span className="font-semibold text-stone-900">{page}</span> of <span className="font-semibold text-stone-900">{totalPages}</span>
        </span>

        {/* Next */}
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          title="Next page"
          className="p-1.5 rounded text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent">
          <ChevronRight size={14}/>
        </button>
        {/* Last page */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          title="Last page"
          className="p-1.5 rounded text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent">
          <ChevronsRight size={14}/>
        </button>
      </div>
    </div>
  );
}

/* ===================== MOBILE LEAD CARD ===================== */
function MobileLeadCard({ lead, config, isSelected, onSelect, onToggleSelect, onUpdate, onStatusChange, readOnly, watchOnly = false, isAdmin = false }) {
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      className="bg-white border border-stone-200 rounded-lg p-3 active:bg-stone-50 cursor-pointer"
    >
      {/* Header row: checkbox, name+meta, heat badge */}
      <div className="flex items-start gap-2.5">
        {!readOnly && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 accent-brand-500 shrink-0 w-4 h-4"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="font-semibold text-stone-900 truncate">
                {lead.customerName || <span className="text-stone-400 italic font-normal">No name</span>}
              </div>
              {watchOnly && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200 shrink-0">Created by you</span>
              )}
              {(() => {
                const n = (lead.history || []).filter(h => h.type === 'resubmission').length;
                if (n === 0) return null;
                return (
                  <span
                    title={`Submitted ${n + 1} times`}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-0.5 shrink-0">
                    <RefreshCw size={9}/>{n + 1}×
                  </span>
                );
              })()}
            </div>
            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
              <HeatBadge score={lead._score.total} tier={lead._score.tier} compact />
            </div>
          </div>
          {lead.companyName && (
            <div className="text-xs text-stone-500 truncate">{lead.companyName}</div>
          )}
          <div className="text-[11px] text-stone-500 mt-0.5 font-mono">
            {[lead.zip && `ZIP ${lead.zip}`, lead.branch, lead.department, fmtDate(lead.dateSubmitted)].filter(Boolean).join(' · ')}
          </div>
          {lead.comment && (
            <div className="text-xs text-stone-600 mt-1.5 line-clamp-4 leading-snug">
              {lead.comment}
            </div>
          )}
        </div>
      </div>

      {/* Contact info — tap-to-act on mobile */}
      {(lead.phone || lead.contactEmail) && (
        <div className="mt-3 space-y-1.5 pl-7">
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 text-sm text-stone-700 active:text-brand-600">
              <Phone size={13} className="text-stone-400 shrink-0" />
              <span className="font-mono">{lead.phone}</span>
            </a>
          )}
          {lead.contactEmail && (
            <a
              href={`mailto:${lead.contactEmail}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 text-sm text-stone-700 active:text-brand-600 min-w-0">
              <Mail size={13} className="text-stone-400 shrink-0" />
              <span className="truncate">{lead.contactEmail}</span>
            </a>
          )}
        </div>
      )}

      {/* Footer: source (small chip on its own row) + assign & status
          stacked full-width for easy tapping on mobile. Previously all three
          shared a single row, which truncated the assign dropdown badly. */}
      <div className="mt-3 pt-3 border-t border-stone-100 pl-7 space-y-2">
        <div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium whitespace-nowrap">
            {formatLeadSource(lead)}
          </span>
        </div>
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1.5">
          <InlineAssignSelect
            fullWidth
            readOnly={readOnly}
            value={lead.assignedTo}
            users={config.users}
            onChange={(userId) => onUpdate(lead.id, {
              assignedTo: userId,
              dateAssigned: userId === 'u_1' ? null : new Date().toISOString()
            })}
          />
          <InlineStatusSelect
            fullWidth
            readOnly={readOnly}
            value={lead.status}
            options={statusOptionsFor(lead.status, config.statuses, getClosedStatuses(config), { isAdmin })}
            onChange={(status) => onStatusChange(lead.id, status)}
          />
        </div>
      </div>

      {/* Age indicator */}
      <div className="pl-7 mt-1">
        <AgeIndicator staleness={lead._staleness} />
      </div>
    </div>
  );
}

function SortHeader({ label, field, sortBy, onClick }) {
  const active = sortBy.field === field;
  return (
    <th className="px-3 py-2.5 text-left font-semibold cursor-pointer hover:text-stone-900" onClick={() => onClick(field)}>
      <span className="inline-flex items-center gap-1">{label}
        <ArrowUpDown size={10} className={active ? 'text-brand-500' : 'text-stone-300'} />
      </span>
    </th>
  );
}

/* ===================== SEARCHABLE SELECT ===================== */
// A <select> replacement with a type-to-filter box. Built because the rep list
// passed ~15 people and scrolling a native dropdown to find someone stopped
// being reasonable.
//
// The panel renders through a PORTAL on purpose. The leads table lives inside
// `overflow-hidden` + `overflow-x-auto`, which would clip an absolutely
// positioned panel — a native select escapes that because the browser draws it
// outside the document, and nothing in CSS reproduces that. Portalling to
// <body> with fixed coordinates is the only reliable way to match it.

// Rank a match: 0 = starts the string, 1 = starts a word, 2 = mid-word, -1 = no
// match. Typing "mar" should surface MARTIN above a stray mid-word hit.
function matchRank(label, q) {
  const s = (label || '').toLowerCase();
  const i = s.indexOf(q);
  if (i < 0) return -1;
  if (i === 0) return 0;
  if (/[\s"'(\-.]/.test(s[i - 1])) return 1;
  return 2;
}

function filterOptions(options, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return options;
  return options
    .map((o, i) => ({ o, rank: matchRank(o.label, q), i }))
    .filter(x => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(x => x.o);
}

function nextIndex(current, delta, length) {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}

function SearchableSelect({
  value,
  onChange,
  options,                       // [{ value, label, hint?, italic? }]
  renderTrigger,                 // ({ selected, open }) => JSX
  searchPlaceholder = 'Search…',
  minForSearch = 8,              // below this, the box is clutter — skip it
  panelClassName = '',
  disabled = false,
  ariaLabel
}) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [rect, setRect]       = useState(null);

  const triggerRef = useRef(null);
  const panelRef   = useRef(null);
  const inputRef   = useRef(null);

  const selected = options.find(o => o.value === value) || null;
  const shown    = useMemo(() => filterOptions(options, query), [options, query]);
  const showSearch = options.length >= minForSearch;

  // Measure the trigger and decide whether the panel opens down or up.
  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelH = Math.min(320, 52 + shown.length * 32);
    const below = window.innerHeight - r.bottom;
    setRect({
      left: Math.min(r.left, window.innerWidth - 260),
      top: below < panelH && r.top > below ? r.top - panelH - 4 : r.bottom + 4,
      width: Math.max(r.width, 220)
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    // capture:true so scrolling ANY ancestor (the table's own scroller included)
    // repositions the panel rather than leaving it floating over the page.
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shown.length]);

  useEffect(() => {
    if (open && showSearch) inputRef.current?.focus();
  }, [open, showSearch]);

  // Close on any click that isn't in the trigger or the panel. Pointerdown so it
  // beats the click landing on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // A shrinking result list must never leave the highlight pointing past the end.
  useEffect(() => {
    setHighlight(h => (h < 0 ? -1 : Math.min(h, shown.length - 1)));
  }, [shown.length]);

  const choose = (v) => {
    onChange(v);
    setOpen(false);
    setQuery('');
    setHighlight(-1);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape')      { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'Tab')         { setOpen(false); return; }
    if (e.key === 'ArrowDown')   { e.preventDefault(); setHighlight(h => nextIndex(h,  1, shown.length)); return; }
    if (e.key === 'ArrowUp')     { e.preventDefault(); setHighlight(h => nextIndex(h, -1, shown.length)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Nothing highlighted but exactly one result: take it. Type three letters,
      // press Enter, done.
      const pick = highlight >= 0 ? shown[highlight] : (shown.length === 1 ? shown[0] : null);
      if (pick) choose(pick.value);
    }
  };

  return (
    <>
      <div
        ref={triggerRef}
        onClick={e => { e.stopPropagation(); if (!disabled) setOpen(o => !o); }}
        onKeyDown={e => {
          if (disabled) return;
          if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault(); setOpen(true);
          } else if (open) onKeyDown(e);
        }}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        tabIndex={disabled ? -1 : 0}
        className={`outline-none focus:ring-1 focus:ring-brand-500 rounded ${disabled ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
      >
        {renderTrigger({ selected, open })}
      </div>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          onKeyDown={onKeyDown}
          /* Above everything. The app's top layer is z-[70] (the duplicate-lead
             modal); a picker opened inside any dialog has to clear it. */
          style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, zIndex: 80 }}
          className={`bg-white border border-stone-200 rounded-md shadow-lg overflow-hidden ${panelClassName}`}
        >
          {showSearch && (
            <div className="p-1.5 border-b border-stone-100">
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setHighlight(-1); }}
                placeholder={searchPlaceholder}
                className="w-full px-2 py-1.5 text-xs border border-stone-200 rounded focus:outline-none focus:border-brand-500"
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto scrollbar-thin py-1" role="listbox">
            {shown.length === 0 ? (
              <div className="px-3 py-3 text-xs text-stone-400 text-center">No matches</div>
            ) : shown.map((o, i) => {
              const isSelected  = o.value === value;
              const isHighlight = i === highlight;
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={e => { e.stopPropagation(); choose(o.value); }}
                  className={`px-3 py-1.5 text-xs cursor-pointer flex items-center gap-2 ${
                    isHighlight ? 'bg-brand-50' : ''
                  } ${isSelected ? 'font-semibold text-stone-900' : 'text-stone-700'} ${o.italic ? 'italic text-stone-400' : ''}`}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-[10px] text-stone-400 shrink-0">{o.hint}</span>}
                  {isSelected && <Check size={12} className="text-brand-600 shrink-0"/>}
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function FilterSelect({ value, onChange, options, label, labelMap, searchable = false }) {
  // Nothing to choose between — render nothing rather than a dead control.
  if (!options || options.length <= 1) return null;

  // Long option lists (the rep roster) get the type-to-filter panel instead.
  if (searchable) {
    const text = (o) => labelMap?.[o] ?? o;
    return (
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options.map(o => ({ value: o, label: text(o) }))}
        ariaLabel={label}
        searchPlaceholder={`Search ${label.toLowerCase()}…`}
        renderTrigger={({ open }) => (
          <div className={`text-xs font-medium pl-2.5 pr-7 py-2 border rounded-md bg-white relative whitespace-nowrap ${
            open ? 'border-brand-500' : 'border-stone-200 hover:border-stone-300'
          }`}>
            {label}: {text(value)}
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400"/>
          </div>
        )}
      />
    );
  }

  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none text-xs font-medium pl-2.5 pr-7 py-2 border border-stone-200 rounded-md bg-white hover:border-stone-300 focus:outline-none focus:border-brand-500 cursor-pointer">
        {options.map(o => <option key={o} value={o}>{label}: {labelMap?.[o] ?? o}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400" />
    </div>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.New;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`}/>{status}
    </span>
  );
}

function InlineStatusSelect({ value, options, onChange, fullWidth, readOnly }) {
  const c = STATUS_COLORS[value] || STATUS_COLORS.New;

  if (readOnly) {
    return (
      <span className={`relative inline-block pl-5 pr-2 py-1 rounded text-xs font-medium ${c.bg} ${c.text} ${fullWidth ? 'w-full' : ''}`}>
        <span className={`absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${c.dot}`}/>
        {value}
      </span>
    );
  }

  return (
    <div className={`relative group ${fullWidth ? 'block w-full' : 'inline-block'}`} onClick={e => e.stopPropagation()}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`appearance-none cursor-pointer pl-5 pr-6 py-1 rounded text-xs font-medium border border-transparent hover:border-stone-300 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors ${c.bg} ${c.text} ${fullWidth ? 'w-full' : ''}`}
        title="Click to change status"
      >
        {options.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <span className={`absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none ${c.dot}`}/>
      <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity"/>
    </div>
  );
}

function AgeIndicator({ staleness }) {
  if (!staleness) return null;
  const { hours, stale, approaching, tracked } = staleness;
  const ageText = formatAge(hours);

  if (stale) {
    return (
      <div className="text-[10px] font-bold mt-1 flex items-center gap-1 text-rose-600 font-mono">
        <AlertCircle size={9}/>
        <span>{ageText} · STALE</span>
      </div>
    );
  }
  if (approaching) {
    return (
      <div className="text-[10px] font-semibold mt-1 flex items-center gap-1 text-amber-600 font-mono">
        <Clock size={9}/>
        <span>{ageText}</span>
      </div>
    );
  }
  return (
    <div className="text-[10px] mt-1 text-stone-400 font-mono">{ageText}{!tracked ? '' : ''}</div>
  );
}

function InlineAssignSelect({ value, users, onChange, fullWidth, readOnly }) {
  const user = users.find(u => u.id === value);
  const isUnassigned = !user || user.isSystem;

  // Watch-only tables (My Created Leads for non-admins) show the name as plain
  // text. A disabled <select> would still look like a control you could use.
  if (readOnly) {
    return (
      <span className={`inline-block pl-2 pr-1 py-1 text-xs ${fullWidth ? 'w-full' : 'max-w-[140px] truncate'} ${isUnassigned ? 'text-stone-400 italic' : 'text-stone-700'}`}>
        {isUnassigned ? '— Unassigned —' : user.name}
      </span>
    );
  }
  // Hide LOA users from the picker so they can't receive new assignments.
  // But still show the current value if it happens to be a LOA user (data consistency).
  const visibleUsers = users.filter(u => u.isSystem || !u.onLeaveOfAbsence || u.id === value);
  const options = visibleUsers.map(u => ({
    value: u.id,
    label: u.isSystem ? '— Unassigned —' : u.name,
    hint: u.onLeaveOfAbsence ? 'on leave' : undefined,
    italic: u.isSystem
  }));

  return (
    <div className={fullWidth ? 'block w-full' : 'inline-block'} onClick={e => e.stopPropagation()}>
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options}
        ariaLabel="Assigned to"
        searchPlaceholder="Search reps…"
        renderTrigger={({ open }) => (
          <div
            title="Click to reassign"
            className={`group relative flex items-center pl-2 pr-6 py-1 rounded text-xs border transition-colors ${
              open ? 'border-stone-300 bg-white' : 'border-transparent hover:border-stone-300 hover:bg-white'
            } ${fullWidth ? 'w-full' : 'max-w-[140px]'} ${isUnassigned ? 'text-stone-400 italic' : 'text-stone-700'}`}
          >
            <span className="truncate">{isUnassigned ? '— Unassigned —' : user.name}</span>
            <ChevronDown size={10} className={`absolute right-1.5 top-1/2 -translate-y-1/2 transition-opacity ${open ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`}/>
          </div>
        )}
      />
    </div>
  );
}

/* ===================== ADD LEAD ===================== */
function AddLeadView({ config, onAdd, currentUser }) {
  const defaultDept = (config.departments && config.departments[0]) || '';
  const [form, setForm] = useState({
    customerName: '', companyName: '', contactEmail: '', phone: '', comment: '',
    branch: '', zip: '', formTitle: 'Manual Entry',
    department: defaultDept,
    leadSource: MANUAL_SOURCE, status: 'New', assignedTo: 'u_1',
    // Only used when status is Working — how many weeks the lead stays active.
    workingWeeks: null,
    dateSubmitted: toLocalDateTimeInputValue(),
    // Defaults to whoever is signed in, but stays editable — somebody often keys
    // in a lead that a colleague took over the phone.
    submittedBy: currentUser?.name || ''
  });
  const [errors, setErrors] = useState({});

  // Compute nearest-branch suggestion whenever ZIP changes
  const branchSuggestion = useMemo(
    () => nearestBranchForZip(form.zip, config.branches),
    [form.zip, config.branches]
  );

  const handleSubmit = () => {
    const errs = {};
    if (!form.customerName.trim()) errs.customerName = 'Required';
    if (!form.contactEmail.trim() && !form.phone.trim()) {
      errs.contactEmail = 'Email or phone required';
      errs.phone = 'Email or phone required';
    }
    // Matches the dialog: a lead can't enter Working without a deadline.
    if (form.status === WORKING_STATUS && !form.workingWeeks) {
      errs.workingWeeks = 'Pick how long this stays active';
    }
    // A lead only reaches the Working step once a rep owns it.
    if (stageOfStatus(form.status) === STAGE_WORKING && isUnassigned(form)) {
      errs.status = 'Assign a rep to add this straight to Working';
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const payload = {
      ...form,
      dateSubmitted: new Date(form.dateSubmitted).toISOString(),
      dateAssigned: form.assignedTo && form.assignedTo !== 'u_1' ? new Date().toISOString() : null,
      // Only meaningful for manual entry. Anything arriving from a form or an
      // import has no submitter, so don't leave a stale name on the record.
      submittedBy: form.leadSource === MANUAL_SOURCE ? (form.submittedBy || '').trim() : '',
      // Computed here rather than at render so a form left open overnight still
      // saves a deadline counted from when it was actually submitted.
      workingUntil: form.status === WORKING_STATUS && form.workingWeeks
        ? workingDeadlineFrom(form.workingWeeks)
        : null,
      workingWeeks: form.status === WORKING_STATUS ? form.workingWeeks : null
    };
    onAdd(payload);
  };

  const update = (field, value) => {
    setForm(f => {
      const next = { ...f, [field]: value };
      // Special case: when ZIP changes and branch is empty, auto-fill from routing
      if (field === 'zip' && !f.branch) {
        const suggestion = nearestBranchForZip(value, config.branches);
        if (suggestion) next.branch = suggestion.branch;
      }
      // Moving off Working drops the length, so a leftover choice can't ride
      // along on a lead that isn't Working.
      if (field === 'status' && value !== WORKING_STATUS) next.workingWeeks = null;
      return next;
    });
    if (errors[field]) setErrors(e => ({ ...e, [field]: undefined }));
    // Picking a rep clears the "assign a rep" complaint on Status.
    if (field === 'assignedTo' && errors.status) setErrors(e => ({ ...e, status: undefined }));
  };

  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-stone-200 rounded-lg p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Customer Name" required error={errors.customerName}>
            <input type="text" value={form.customerName} onChange={e => update('customerName', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm"/>
          </Field>
          <Field label="Company Name">
            <input type="text" value={form.companyName} onChange={e => update('companyName', e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm"/>
          </Field>
          <Field label="Form Title">
            <input type="text" value={form.formTitle} onChange={e => update('formTitle', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm"/>
          </Field>
          <Field label="Contact Email" error={errors.contactEmail}>
            <input type="email" value={form.contactEmail} onChange={e => update('contactEmail', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm"/>
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm"/>
          </Field>
          <Field label="Branch">
            <select value={form.branch} onChange={e => update('branch', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm bg-white">
              <option value="">— Select —</option>
              {config.branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select value={form.department} onChange={e => update('department', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm bg-white">
              <option value="">— Select —</option>
              {(config.departments || []).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="ZIP">
            <input type="text" value={form.zip} onChange={e => update('zip', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm font-mono"/>
            {branchSuggestion && (
              <div className="text-[11px] text-stone-500 mt-1 flex items-center gap-1">
                <MapPin size={11} className="text-stone-400"/>
                Nearest branch: <span className="font-semibold text-stone-700">{branchSuggestion.branch}</span>
                <span className="text-stone-400">(~{branchSuggestion.distanceMiles} mi)</span>
              </div>
            )}
          </Field>
          <Field label="Date Submitted">
            <input type="datetime-local" value={form.dateSubmitted} onChange={e => update('dateSubmitted', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm"/>
          </Field>
          <Field label="Lead Source">
            <select value={form.leadSource} onChange={e => update('leadSource', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm bg-white">
              {config.sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          {form.leadSource === MANUAL_SOURCE && (
            <Field label="Submitter">
              <input type="text" value={form.submittedBy}
                onChange={e => update('submittedBy', e.target.value)}
                placeholder="Who is entering this lead"
                className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm"/>
              <div className="text-[11px] text-stone-400 mt-1">
                Recorded as &ldquo;{formatLeadSource({ leadSource: MANUAL_SOURCE, submittedBy: form.submittedBy })}&rdquo;
              </div>
            </Field>
          )}
          <Field label="Assigned To">
            <SearchableSelect
              value={form.assignedTo}
              onChange={(userId) => update('assignedTo', userId)}
              options={config.users
                .filter(u => u.isSystem || !u.onLeaveOfAbsence)
                .map(u => ({ value: u.id, label: u.name, italic: u.isSystem }))}
              ariaLabel="Assign this lead to"
              searchPlaceholder="Search reps…"
              renderTrigger={({ selected, open }) => (
                <div className={`w-full px-3 py-2 border rounded-md text-sm bg-white flex items-center justify-between gap-2 ${
                  open ? 'border-brand-500' : 'border-stone-200'
                }`}>
                  <span className="truncate">{selected?.label || 'Unassigned'}</span>
                  <ChevronDown size={13} className="text-stone-400 shrink-0"/>
                </div>
              )}
            />
          </Field>
          <Field label="Status" error={errors.status}>
            {/* A new lead starts in Incoming or Working. Sales Request needs its
                form and Completed means there is nothing to add. */}
            <select value={form.status} onChange={e => update('status', e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm bg-white">
              {config.statuses
                .filter(s => [STAGE_INCOMING, STAGE_WORKING].includes(stageOfStatus(s, getClosedStatuses(config))))
                .map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        {form.status === WORKING_STATUS && (
          <div className="mt-4">
            <Field label="Working Until" required error={errors.workingWeeks}>
              <div className="text-xs text-stone-500 mb-2 -mt-0.5">
                How long this lead stays active. Working it doesn&rsquo;t push the date back.
              </div>
              <WorkingWeeksChoices
                value={form.workingWeeks}
                onChange={(w) => update('workingWeeks', w)}
                columns="grid-cols-2 md:grid-cols-4"
              />
            </Field>
          </div>
        )}

        <div className="mt-4">
          <Field label="Customer Comment (from form)">
            <textarea value={form.comment} onChange={e => update('comment', e.target.value)} rows={4}
              className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:border-brand-500 text-sm resize-none"/>
          </Field>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 pt-4 border-t border-stone-100">
          <button onClick={handleSubmit}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-md transition-colors flex items-center gap-2">
            <Plus size={15}/> Save Lead
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required, error }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1.5">
        {label}{required && <span className="text-brand-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <div className="text-xs text-rose-600 mt-1">{error}</div>}
    </div>
  );
}

/* ===================== IMPORT ===================== */
function ImportView({ config, onImport, leads }) {
  const [csvData, setCsvData] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [defaultSource, setDefaultSource] = useState('CSV Import');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const fileRef = useRef(null);

  const fieldOptions = [
    { key: 'customerName',   label: 'Customer Name'  },
    { key: 'companyName',    label: 'Company Name'   },
    { key: 'contactEmail',   label: 'Contact Email'  },
    { key: 'phone',          label: 'Phone'          },
    { key: 'comment',        label: 'Comment'        },
    { key: 'branch',         label: 'Branch'         },
    { key: 'department',     label: 'Department'     },
    { key: 'zip',            label: 'Zip'            },
    { key: 'dateSubmitted',  label: 'Date Submitted' },
    { key: 'formTitle',      label: 'Form Title'     },
    { key: 'leadSource',     label: 'Lead Source'    },
    { key: 'status',         label: 'Status'         }
  ];

  const handleFile = (file) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        setCsvData(results.data);
        const heads = results.meta.fields || [];
        setHeaders(heads);
        const auto = {};
        heads.forEach(h => {
          const low = h.toLowerCase().replace(/[^a-z0-9]/g, '');
          const match = fieldOptions.find(f => f.label.toLowerCase().replace(/[^a-z0-9]/g,'') === low);
          if (match) auto[match.key] = h;
        });
        setMapping(auto);
      }
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) handleFile(file);
  };

  // Map a CSV row to a lead-shaped object
  const mapRow = (row) => {
    const obj = {};
    fieldOptions.forEach(f => {
      if (mapping[f.key]) obj[f.key] = row[mapping[f.key]] || '';
    });
    if (!obj.leadSource) obj.leadSource = defaultSource;
    return obj;
  };

  // Pre-compute which rows are duplicates (for preview + import decision)
  const rowAnalysis = useMemo(() => {
    if (!csvData) return [];
    return csvData.map(row => {
      const mapped = mapRow(row);
      const valid = !!(mapped.customerName || mapped.companyName || mapped.contactEmail || mapped.phone);
      const dups = valid ? findDuplicates(mapped, leads, config.duplicateDetection) : [];
      return { row, mapped, valid, duplicates: dups };
    });
  }, [csvData, mapping, defaultSource, leads, config.duplicateDetection]);

  const duplicateCount = rowAnalysis.filter(r => r.duplicates.length > 0).length;
  const importableCount = rowAnalysis.filter(r => r.valid && (!skipDuplicates || r.duplicates.length === 0)).length;

  const doImport = () => {
    const rows = rowAnalysis
      .filter(r => r.valid && (!skipDuplicates || r.duplicates.length === 0))
      .map(r => r.mapped);
    onImport(rows);
    reset();
  };

  const reset = () => {
    setCsvData(null); setHeaders([]); setMapping({});
    if (fileRef.current) fileRef.current.value = '';
  };

  // Download a starter CSV with all expected columns so reps don't have to guess.
  // Includes one sample row demonstrating expected formatting.
  const downloadTemplate = () => {
    const headers = fieldOptions.map(f => f.label);
    const sampleRow = {
      'Customer Name': 'Jane Smith',
      'Company Name': 'Acme Warehousing',
      'Contact Email': 'jane@example.com',
      'Phone': '317-555-0123',
      'Comment': 'Interested in a skid steer for landscaping work',
      'Branch': (config.branches && config.branches[0]) || 'Indy',
      'Department': (config.departments && config.departments[0]) || 'Sales',
      'Zip': '77584',
      'Date Submitted': new Date().toISOString().slice(0, 10),
      'Form Title': 'Equipment Inquiry',
      'Lead Source': 'Manual Entry',
      'Status': (config.statuses && config.statuses[0]) || 'New'
    };
    const csv = Papa.unparse([sampleRow], { columns: headers });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ind-lmt-import-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl">
      {!csvData ? (
        <div onDragOver={e => e.preventDefault()} onDrop={handleDrop}
          className="bg-white border-2 border-dashed border-stone-300 rounded-lg p-12 text-center hover:border-brand-400 transition-colors">
          <Upload size={36} className="mx-auto text-stone-400 mb-3"/>
          <div className="font-semibold text-stone-900 mb-1">Upload CSV File</div>
          <div className="text-sm text-stone-500 mb-4">Drag a file here or click to browse</div>
          <input ref={fileRef} type="file" accept=".csv" onChange={e => e.target.files[0] && handleFile(e.target.files[0])} className="hidden" />
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button onClick={() => fileRef.current?.click()}
              className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium rounded-md">
              Choose File
            </button>
            <button onClick={downloadTemplate}
              className="px-4 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 text-sm font-medium rounded-md flex items-center gap-1.5"
              title="Download a sample CSV with all expected columns">
              <Download size={14}/> Download Template
            </button>
          </div>
          <div className="mt-6 text-xs text-stone-500">
            CSV should include columns like Customer Name, Email, Phone, etc. You'll map them in the next step.
            <br/>Not sure how to format your file? Download the template above for a working example.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white border border-stone-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-stone-900">Map Columns</div>
                <div className="text-xs text-stone-500 mt-0.5">{csvData.length} rows detected · Match your CSV columns to lead fields</div>
              </div>
              <button onClick={reset} className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">
                <X size={12}/> Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fieldOptions.map(f => (
                <div key={f.key} className="flex items-center gap-2">
                  <div className="text-xs font-medium text-stone-700 w-32 shrink-0">{f.label}</div>
                  <select value={mapping[f.key] || ''} onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                    className="flex-1 px-2.5 py-1.5 border border-stone-200 rounded text-xs bg-white">
                    <option value="">— Don't import —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-stone-100">
              <Field label="Default Lead Source (used if not mapped)">
                <select value={defaultSource} onChange={e => setDefaultSource(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm bg-white">
                  {config.sources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-stone-500">Preview</div>
                <div className="text-[11px] text-stone-500 mt-0.5">
                  Showing first 5 of {csvData.length} rows · {importableCount} will be imported
                  {duplicateCount > 0 && <> · <span className="text-amber-700 font-semibold">{duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'} detected</span></>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {duplicateCount > 0 && (
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)}
                      className="accent-brand-500"/>
                    <span className="font-semibold text-stone-700">Skip duplicates</span>
                  </label>
                )}
                <button onClick={doImport} disabled={importableCount === 0}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-stone-300 text-white text-xs font-semibold uppercase tracking-wider rounded-md flex items-center gap-1.5">
                  <Upload size={12}/> Import {importableCount} lead{importableCount === 1 ? '' : 's'}
                </button>
              </div>
            </div>

            {duplicateCount > 0 && (
              <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
                <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0"/>
                <div className="text-[11px] text-amber-900 leading-relaxed">
                  <strong>{duplicateCount}</strong> row{duplicateCount === 1 ? ' matches' : 's match'} existing leads created within the last {config.duplicateDetection?.withinDays || 90} days (by email or phone).
                  {skipDuplicates ? ' They will be skipped.' : ' They will be imported as new records.'}
                </div>
              </div>
            )}

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 text-[10px] uppercase tracking-widest text-stone-500">
                  <tr>
                    <th className="px-3 py-2 w-8"/>
                    {fieldOptions.filter(f => mapping[f.key]).map(f => (
                      <th key={f.key} className="px-3 py-2 text-left font-semibold">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowAnalysis.slice(0, 5).map((analysis, i) => {
                    const isDup = analysis.duplicates.length > 0;
                    return (
                      <tr key={i} className={`border-b border-stone-100 ${isDup ? 'bg-amber-50/50' : ''}`}>
                        <td className="px-3 py-2 text-center">
                          {isDup
                            ? <span title={`Matches ${analysis.duplicates.length} existing lead(s)`}
                                className="inline-block text-[9px] font-bold uppercase tracking-wider bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">
                                Dup
                              </span>
                            : null}
                        </td>
                        {fieldOptions.filter(f => mapping[f.key]).map(f => (
                          <td key={f.key} className="px-3 py-2 text-stone-700 truncate max-w-[200px]">{analysis.row[mapping[f.key]] || '—'}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== USERS VIEW ===================== */
function UsersView({ config, onSave, leads, onApprove, onDeny, onToggleRole, currentUserId, currentUserRole }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', password: '',
    role: 'user'
  });
  const [addErr, setAddErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset-password modal state. Holds the target user, plus busy/result/error
  // so we can show progress and the outcome inline. Separated from `busy` above
  // so the create-user form and reset-password modal don't collide.
  const [resetTarget, setResetTarget] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetResult, setResetResult] = useState(null);  // { emailSentTo } on success
  const [resetError, setResetError] = useState('');

  const pwStrength = useMemo(() => scorePassword(form.password), [form.password]);

  const handleGenerate = () => {
    const pw = generateStrongPassword(16);
    setForm({ ...form, password: pw });
    setShowPw(true); // reveal so admin can copy/share
  };

  const handleCopy = async () => {
    if (!form.password) return;
    try {
      await navigator.clipboard.writeText(form.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      // Fallback: ignore — clipboard access may be blocked in some contexts
    }
  };

  const addUser = async () => {
    setAddErr('');
    if (!form.name.trim()) return setAddErr('Name is required.');
    if (!validEmail(form.email)) return setAddErr('Enter a valid email.');
    if (form.password.length < 6) return setAddErr('Password must be at least 6 characters.');
    if (config.users.some(u => (u.email || '').toLowerCase() === form.email.trim().toLowerCase())) {
      return setAddErr('A user with that email already exists.');
    }

    setBusy(true);
    try {
      const trimmedEmail = form.email.trim();
      const trimmedName = form.name.trim();
      const password = form.password;

      // Create the Firebase Auth user via a secondary app so admin stays signed in
      const newUid = await createUserOnSecondaryApp(trimmedEmail, password);

      // Create their Firestore profile
      await saveUserDoc(newUid, {
        name: trimmedName,
        email: trimmedEmail,
        role: form.role,
        isSystem: false,
        createdAt: new Date().toISOString()
      });

      // Send welcome email (best-effort — user is already created either way)
      try {
        await sendWelcomeEmailToUser({
          email: trimmedEmail,
          name: trimmedName,
          password
        });
      } catch (emailErr) {
        // User exists, just the welcome email failed. Surface credentials so the
        // admin can share manually, then carry on.
        console.error('Welcome email failed:', emailErr);
        window.alert(
          `User created successfully, but the welcome email could not be sent.\n\n` +
          `Share these credentials with ${trimmedName} manually:\n\n` +
          `Email:    ${trimmedEmail}\n` +
          `Password: ${password}\n\n` +
          `They can change their password after signing in (Forgot password? on the sign-in screen).`
        );
      }

      setForm({ name: '', email: '', password: '', role: 'user' });
      setAdding(false);
      setShowPw(false);
      setCopied(false);
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('email-already-in-use')) {
        setAddErr('That email already has a Firebase account.');
      } else if (code.includes('weak-password')) {
        setAddErr('Password is too weak (minimum 6 characters).');
      } else {
        setAddErr('Could not add user: ' + (err.message || code || 'unknown error'));
      }
    } finally {
      setBusy(false);
    }
  };

  // When the admin acts on a user (delete OR set leave-of-absence), decide what to show:
  //   - If user has no leads → simple confirm, then do the action
  //   - If user has leads → open the reassignment modal so admin picks where leads go first
  // reassignTarget carries an `action` field: 'delete' or 'loa' to drive copy and behavior.
  const [reassignTarget, setReassignTarget] = useState(null);
  const [reassignBusy, setReassignBusy] = useState(false);

  const removeUser = (id) => {
    if (id === 'u_1' || id === currentUserId) return;
    const user = config.users.find(u => u.id === id);
    if (!user) return;
    const assigned = leads.filter(l => l.assignedTo === id).length;

    if (assigned > 0) {
      setReassignTarget({
        id, name: user.name || user.email || 'this user',
        leadCount: assigned, action: 'delete'
      });
    } else {
      if (!window.confirm('Remove this user from the LMT? Their Firebase Auth login will remain — you can disable it separately in the Firebase Console.')) return;
      deleteUserDoc(id).catch(e =>
        alert('Could not remove user: ' + (e.message || 'unknown error'))
      );
    }
  };

  // State for the "return from LOA" modal — appears when a returning user has leads
  // that were reassigned to others during their leave.
  const [loaReturnTarget, setLoaReturnTarget] = useState(null);  // { id, name, restorable: [...] } or null
  const [loaReturnBusy, setLoaReturnBusy] = useState(false);

  // Helper: find leads that were moved away from this user via an LOA bulk reassignment
  // and are still assigned to the interim assignee from that event.
  const findLoaReassignedLeads = (userId) => {
    return leads.filter(lead => {
      const history = lead.history || [];
      const loaEvent = [...history].reverse().find(h =>
        h.type === 'assignment_change' &&
        h.bulkReassignment &&
        h.fromUser === userId &&
        h.mode === 'loa'
      );
      if (!loaEvent) return false;
      // Only consider restorable if the lead hasn't been moved since the LOA event
      return lead.assignedTo === loaEvent.toUser;
    });
  };

  // Open the reset-password confirm modal for a user.
  // Actual work happens in confirmResetPassword when the admin clicks through.
  const openResetPassword = (id) => {
    const user = config.users.find(u => u.id === id);
    if (!user || user.isSystem || id === currentUserId) return;
    setResetTarget({
      id, name: user.name || user.email || 'this user', email: user.email
    });
    setResetResult(null);
    setResetError('');
  };

  const confirmResetPassword = async () => {
    if (!resetTarget) return;
    setResetBusy(true);
    setResetError('');
    try {
      const result = await adminResetUserPasswordViaFunction({ targetUid: resetTarget.id });
      setResetResult(result);  // { ok: true, emailSentTo: ... }
    } catch (err) {
      // If email failed but password DID reset, the error message contains the new password.
      // Show it to the admin so they can share it manually.
      setResetError(err?.message || 'Password reset failed. Please try again.');
    } finally {
      setResetBusy(false);
    }
  };

  const closeResetPassword = () => {
    if (resetBusy) return;
    setResetTarget(null);
    setResetResult(null);
    setResetError('');
  };

  // Set or unset a user's "Leave of Absence" status.
  // When SETTING LOA: prompts to reassign their leads first (since LOA users can't be assignees).
  // When CLEARING LOA: if there are restorable leads, opens the LOA-return modal; otherwise
  //   a simple confirm + flag flip.
  const setUserLoa = (id, isOnLoa) => {
    if (id === 'u_1' || id === currentUserId) return;
    const user = config.users.find(u => u.id === id);
    if (!user) return;

    // Returning from leave
    if (!isOnLoa) {
      const restorable = findLoaReassignedLeads(id);
      if (restorable.length > 0) {
        // Open modal — admin chooses whether to pull leads back
        setLoaReturnTarget({
          id, name: user.name || user.email || 'this user',
          restorableCount: restorable.length
        });
      } else {
        // No restorable leads — simple confirm + clear flag
        if (!window.confirm(`Return ${user.name} from leave of absence? They'll appear in lead assignment dropdowns again.`)) return;
        saveUserDoc(id, { onLeaveOfAbsence: false }).catch(e =>
          alert('Could not update user: ' + (e.message || 'unknown error'))
        );
      }
      return;
    }

    // Going on leave — handle leads first if any are assigned
    const assigned = leads.filter(l => l.assignedTo === id).length;
    if (assigned > 0) {
      setReassignTarget({
        id, name: user.name || user.email || 'this user',
        leadCount: assigned, action: 'loa'
      });
    } else {
      // No leads — straight to confirm + flag
      if (!window.confirm(`Set ${user.name} as on Leave of Absence? They'll be removed from lead assignment dropdowns but their account stays active.`)) return;
      saveUserDoc(id, { onLeaveOfAbsence: true }).catch(e =>
        alert('Could not update user: ' + (e.message || 'unknown error'))
      );
    }
  };

  // Confirm the LOA-return action: either restore the leads + clear LOA, or just clear LOA.
  const confirmLoaReturn = async (restoreLeads) => {
    if (!loaReturnTarget) return;
    setLoaReturnBusy(true);
    try {
      if (restoreLeads) {
        await restoreLoaLeadsForUserViaFunction({ userId: loaReturnTarget.id });
      }
      await saveUserDoc(loaReturnTarget.id, { onLeaveOfAbsence: false });
      setLoaReturnTarget(null);
    } catch (e) {
      alert(
        'Could not complete the operation:\n\n' + (e.message || 'Unknown error') +
        '\n\nCheck the user list and leads view to verify the final state.'
      );
    } finally {
      setLoaReturnBusy(false);
    }
  };

  // Confirms reassignment + the follow-up action (delete or LOA flag).
  const confirmReassign = async (targetUserId) => {
    if (!reassignTarget) return;
    setReassignBusy(true);
    try {
      // Step 1: bulk-reassign all the leads (Cloud Function handles batches + summary email).
      // Pass mode so the lead history records *why* (delete vs. loa) — return-from-LOA
      // uses this to identify restorable leads.
      await reassignUserLeadsViaFunction({
        fromUserId: reassignTarget.id,
        toUserId: targetUserId,
        deletedUserName: reassignTarget.name,
        mode: reassignTarget.action  // 'delete' or 'loa'
      });

      // Step 2: the follow-up action depends on whether this was a delete or LOA
      if (reassignTarget.action === 'delete') {
        await deleteUserDoc(reassignTarget.id);
      } else if (reassignTarget.action === 'loa') {
        await saveUserDoc(reassignTarget.id, { onLeaveOfAbsence: true });
      }

      setReassignTarget(null);
    } catch (e) {
      alert(
        'Could not complete the operation:\n\n' + (e.message || 'Unknown error') +
        '\n\nThe leads may have been partially reassigned. Check the leads view to verify.'
      );
    } finally {
      setReassignBusy(false);
    }
  };

  const userLeadCounts = useMemo(() => {
    const counts = {};
    leads.forEach(l => { counts[l.assignedTo] = (counts[l.assignedTo] || 0) + 1; });
    return counts;
  }, [leads]);

  const pending = config.accessRequests || [];

  return (
    <div className="max-w-3xl space-y-4">
      {/* Pending Access Requests */}
      {pending.length > 0 && (
        <div className="bg-white border border-brand-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-brand-200 bg-brand-50 flex items-center gap-2">
            <Clock size={14} className="text-brand-700"/>
            <div className="text-sm font-semibold text-stone-900">
              Pending Access Requests
              <span className="ml-2 font-mono text-xs bg-brand-600 text-white px-1.5 py-0.5 rounded">{pending.length}</span>
            </div>
          </div>
          <div className="divide-y divide-stone-100">
            {pending.map(req => (
              <div key={req.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-stone-900">{req.name}</div>
                    <div className="text-xs text-stone-600 mt-0.5">{req.email}</div>
                    {req.reason && (
                      <div className="text-xs text-stone-500 mt-1.5 italic bg-stone-50 px-2 py-1 rounded">
                        "{req.reason}"
                      </div>
                    )}
                    <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mt-1.5">
                      Requested {fmtDateTime(req.requestedAt)}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => onApprove(req.id)}
                      className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded flex items-center gap-1">
                      <Check size={12}/> Approve
                    </button>
                    <button onClick={() => onDeny(req.id)}
                      className="px-2.5 py-1.5 border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-semibold rounded flex items-center gap-1">
                      <X size={12}/> Deny
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Members */}
      <div className="bg-white border border-stone-200 rounded-lg">
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="text-sm font-semibold text-stone-900">Team Members</div>
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-md flex items-center gap-1.5">
              <Plus size={12}/> Add User
            </button>
          )}
        </div>

        {adding && (
          <div className="px-5 py-4 border-b border-stone-200 bg-stone-50 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" placeholder="Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                className="px-3 py-2 border border-stone-200 rounded-md text-sm bg-white" autoFocus />
              <input type="email" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                className="px-3 py-2 border border-stone-200 rounded-md text-sm bg-white" />

              {/* Password field with eye toggle + copy + generate */}
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="Password (6+ chars)"
                  value={form.password}
                  onChange={e => setForm({...form, password: e.target.value})}
                  className="w-full px-3 py-2 pr-20 border border-stone-200 rounded-md text-sm bg-white font-mono"
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!form.password}
                    title={copied ? 'Copied!' : 'Copy password'}
                    className="p-1.5 text-stone-400 hover:text-stone-700 disabled:opacity-30 disabled:hover:text-stone-400 rounded">
                    {copied ? <Check size={14} className="text-emerald-600"/> : <Copy size={14}/>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    title={showPw ? 'Hide password' : 'Show password'}
                    className="p-1.5 text-stone-400 hover:text-stone-700 rounded">
                    {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
                  </button>
                </div>
              </div>

              <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                className="px-3 py-2 border border-stone-200 rounded-md text-sm bg-white">
                <option value="user">Sales Rep</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {/* Generate password + strength meter */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                className="px-2.5 py-1.5 border border-stone-200 hover:bg-white text-xs font-semibold rounded-md flex items-center gap-1.5 text-stone-700 shrink-0">
                <Sparkles size={12} className="text-brand-500"/> Generate strong password
              </button>

              {form.password && (
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <div className="flex-1 flex gap-1">
                    {[0, 1, 2, 3].map(i => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          i < pwStrength.segments ? pwStrength.barColor : 'bg-stone-200'
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ${pwStrength.textColor}`}>
                    {pwStrength.label}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={addUser} disabled={busy}
                className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 text-white text-sm font-medium rounded-md">
                {busy ? 'Creating…' : 'Create User'}
              </button>
              <button onClick={() => { setAdding(false); setAddErr(''); setShowPw(false); setCopied(false); setForm({ name: '', email: '', password: '', role: 'user' }); }} className="px-3 py-1.5 text-stone-600 hover:text-stone-900 text-sm">Cancel</button>
            </div>
            {addErr && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 flex items-center gap-2">
                <AlertCircle size={12}/> {addErr}
              </div>
            )}
          </div>
        )}

        <div className="divide-y divide-stone-100">
          {config.users.map(u => {
            const isCurrent = u.id === currentUserId;
            const isLoa = u.onLeaveOfAbsence === true;
            return (
              <div key={u.id} className={`px-5 py-3 flex items-center gap-3 ${isLoa ? 'bg-stone-50/60' : ''}`}>
                <div className={`w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 text-xs font-semibold uppercase ${isLoa ? 'opacity-50' : ''}`}>
                  {u.isSystem ? '—' : (u.name.split(' ').map(s => s[0]).join('').slice(0,2))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-900 flex items-center gap-2 flex-wrap">
                    <span className={isLoa ? 'text-stone-500' : ''}>{u.name}</span>
                    {isCurrent && <span className="text-[10px] uppercase tracking-widest text-brand-600 font-semibold">(You)</span>}
                    {u.isSystem && <span className="text-[10px] uppercase tracking-widest text-stone-400">(System)</span>}
                    {isLoa && (
                      <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                        On Leave
                      </span>
                    )}
                  </div>
                  {u.email && <div className="text-xs text-stone-500 truncate">{u.email}</div>}
                </div>
                {!u.isSystem && (
                  <button onClick={() => onToggleRole(u.id)} disabled={isCurrent}
                    className={`px-2 py-1 text-[10px] uppercase tracking-widest font-bold rounded ${
                      u.role === 'admin'
                        ? 'bg-brand-100 text-brand-700 hover:bg-brand-200'
                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    } ${isCurrent ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    title={isCurrent ? "Can't change your own role" : 'Click to toggle role'}>
                    {u.role === 'admin' ? 'Admin' : 'Sales Rep'}
                  </button>
                )}
                <div className="font-mono text-xs text-stone-500 w-16 text-right">{userLeadCounts[u.id] || 0} leads</div>
                {!u.isSystem && !isCurrent && (
                  <>
                    <button
                      onClick={() => openResetPassword(u.id)}
                      className="text-stone-400 hover:text-brand-600 hover:bg-brand-50 p-1 rounded"
                      title={`Reset password — sends ${u.name || 'user'} a new temporary password by email`}>
                      <Key size={14}/>
                    </button>
                    <button
                      onClick={() => setUserLoa(u.id, !isLoa)}
                      className={`p-1 rounded ${isLoa ? 'text-emerald-600 hover:bg-emerald-50' : 'text-stone-400 hover:text-amber-600 hover:bg-amber-50'}`}
                      title={isLoa ? 'Return from leave of absence' : 'Set as on leave of absence'}>
                      {isLoa ? <RotateCcw size={14}/> : <CalendarOff size={14}/>}
                    </button>
                    <button onClick={() => removeUser(u.id)} className="text-stone-400 hover:text-rose-600 p-1" title="Remove user">
                      <Trash2 size={14}/>
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {reassignTarget && (
        <ReassignLeadsModal
          target={reassignTarget}
          users={config.users}
          currentUserId={currentUserId}
          busy={reassignBusy}
          onConfirm={confirmReassign}
          onCancel={() => !reassignBusy && setReassignTarget(null)}
        />
      )}

      {loaReturnTarget && (
        <ReturnFromLoaModal
          target={loaReturnTarget}
          busy={loaReturnBusy}
          onConfirm={confirmLoaReturn}
          onCancel={() => !loaReturnBusy && setLoaReturnTarget(null)}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal
          target={resetTarget}
          busy={resetBusy}
          result={resetResult}
          error={resetError}
          onConfirm={confirmResetPassword}
          onClose={closeResetPassword}
        />
      )}
    </div>
  );
}

/* ===================== REASSIGN LEADS MODAL ===================== */
function ReassignLeadsModal({ target, users, currentUserId, busy, onConfirm, onCancel }) {
  // Eligible targets: any active user EXCEPT the one being changed AND not on LOA.
  // 'u_1' (Unassigned) is always available as a safe default.
  const eligibleUsers = users.filter(u =>
    u.id !== target.id && u.id !== 'u_1' && !u.onLeaveOfAbsence
  );
  const [selected, setSelected] = useState('u_1');

  const selectedName =
    selected === 'u_1' ? 'Unassigned' :
    eligibleUsers.find(u => u.id === selected)?.name || 'this user';

  const isLoa = target.action === 'loa';
  const title = isLoa ? 'Set as Leave of Absence' : 'Reassign leads before deleting';
  const intro = isLoa
    ? <><strong>{target.name}</strong> has {target.leadCount} lead{target.leadCount === 1 ? '' : 's'} assigned. While they're on leave, their leads need to move to someone else.</>
    : <><strong>{target.name}</strong> has {target.leadCount} lead{target.leadCount === 1 ? '' : 's'} assigned. Choose where these leads should go.</>;
  const confirmLabel = isLoa ? 'Reassign and Set on Leave' : 'Reassign and Delete';
  const confirmIcon = isLoa ? <CalendarOff size={13}/> : <Trash2 size={13}/>;
  const confirmClass = isLoa
    ? 'bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300'
    : 'bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200">
          <div className="text-base font-semibold text-stone-900">{title}</div>
          <div className="text-xs text-stone-500 mt-1">{intro}</div>
        </div>

        <div className="px-5 py-4">
          <label className="block text-[11px] uppercase tracking-widest text-stone-500 font-semibold mb-2">Reassign to</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-stone-50">
            <option value="u_1">Unassigned (admin will redistribute later)</option>
            {eligibleUsers.length > 0 && <optgroup label="Sales team">
              {eligibleUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name}{u.id === currentUserId ? ' (you)' : ''}{u.role === 'admin' ? ' · admin' : ''}
                </option>
              ))}
            </optgroup>}
          </select>

          <div className="mt-3 px-3 py-2 bg-stone-50 border border-stone-200 rounded text-xs text-stone-600 leading-relaxed">
            {selected === 'u_1'
              ? <>All {target.leadCount} lead{target.leadCount === 1 ? '' : 's'} will be marked Unassigned. No email will be sent.</>
              : <><strong>{selectedName}</strong> will receive a single summary email listing all {target.leadCount} reassigned lead{target.leadCount === 1 ? '' : 's'}.</>
            }
            {isLoa && (
              <div className="mt-1.5 text-stone-500">
                <strong>{target.name}</strong>'s account stays active — they can still sign in and view My Closed.
                They won't appear in lead-assignment dropdowns until you return them from leave.
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 bg-stone-50 border-t border-stone-200 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 border border-stone-200 hover:bg-white text-stone-700 text-sm font-semibold rounded-md disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selected)}
            disabled={busy}
            className={`px-3 py-1.5 ${confirmClass} text-white text-sm font-semibold rounded-md flex items-center gap-1.5`}>
            {busy
              ? <><RefreshCw size={13} className="animate-spin"/> Working…</>
              : <>{confirmIcon} {confirmLabel}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

function ReturnFromLoaModal({ target, busy, onConfirm, onCancel }) {
  // Default to "reassign back" since that's the usual intent when someone returns from leave.
  const [reassignBack, setReassignBack] = useState(true);

  const count = target.restorableCount;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200">
          <div className="text-base font-semibold text-stone-900">Return {target.name} from leave</div>
          <div className="text-xs text-stone-500 mt-1">
            <strong>{target.name}</strong> has {count} lead{count === 1 ? '' : 's'} that {count === 1 ? 'was' : 'were'} reassigned to other reps when they went on leave. How would you like to handle {count === 1 ? 'it' : 'them'}?
          </div>
        </div>

        <div className="px-5 py-4 space-y-2">
          <label className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
            reassignBack ? 'border-brand-400 bg-brand-50' : 'border-stone-200 hover:bg-stone-50'
          }`}>
            <input
              type="radio"
              checked={reassignBack}
              onChange={() => setReassignBack(true)}
              disabled={busy}
              className="mt-0.5 accent-brand-500"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-stone-900">Reassign {count} lead{count === 1 ? '' : 's'} back to {target.name}</div>
              <div className="text-xs text-stone-500 mt-0.5">
                {target.name} gets a welcome-back email with a summary. Leads that have been intentionally moved elsewhere since they left aren't touched.
              </div>
            </div>
          </label>

          <label className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
            !reassignBack ? 'border-brand-400 bg-brand-50' : 'border-stone-200 hover:bg-stone-50'
          }`}>
            <input
              type="radio"
              checked={!reassignBack}
              onChange={() => setReassignBack(false)}
              disabled={busy}
              className="mt-0.5 accent-brand-500"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-stone-900">Leave the leads with their current assignees</div>
              <div className="text-xs text-stone-500 mt-0.5">
                {target.name} returns to the assignment rotation but starts with no leads. The reps who took over keep them.
              </div>
            </div>
          </label>
        </div>

        <div className="px-5 py-3 bg-stone-50 border-t border-stone-200 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 border border-stone-200 hover:bg-white text-stone-700 text-sm font-semibold rounded-md disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reassignBack)}
            disabled={busy}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-semibold rounded-md flex items-center gap-1.5">
            {busy
              ? <><RefreshCw size={13} className="animate-spin"/> Working…</>
              : <><RotateCcw size={13}/> Return from Leave</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== RESET PASSWORD MODAL =====================
 * Confirms an admin wants to reset another user's password, then shows
 * the outcome inline (success or error).
 *
 * The Cloud Function generates a random password server-side and emails
 * it directly to the target — the admin never sees the plaintext (unless
 * the email send fails, in which case the error message contains it as
 * a fallback so the admin can share it manually).
 */
function ResetPasswordModal({ target, busy, result, error, onConfirm, onClose }) {
  // Three states rendered as three different bodies:
  //   1. Initial     — confirm the action
  //   2. Success     — result is set
  //   3. Error       — error is set (usually with the new password embedded)
  const state = result ? 'success' : error ? 'error' : 'confirm';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200">
          <div className="flex items-center gap-2 mb-1">
            <Key size={18} className={state === 'success' ? 'text-emerald-600 shrink-0' : state === 'error' ? 'text-amber-600 shrink-0' : 'text-brand-600 shrink-0'}/>
            <div className="text-base font-semibold text-stone-900">
              {state === 'success' && 'Password reset'}
              {state === 'error'   && 'Password reset — email failed'}
              {state === 'confirm' && 'Reset password'}
            </div>
          </div>
          <div className="text-xs text-stone-500 mt-1 truncate">
            For <strong>{target.name}</strong>{target.email ? ` (${target.email})` : ''}
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {state === 'confirm' && (
            <>
              <div className="text-sm text-stone-700 leading-relaxed">
                A new random password will be generated and applied immediately. {target.name}'s current password will stop working.
              </div>
              <div className="p-3 border border-stone-200 rounded-md bg-stone-50 text-xs text-stone-700 leading-relaxed">
                <strong>What happens next:</strong>
                <ol className="mt-1.5 ml-4 list-decimal space-y-0.5">
                  <li>{target.name} receives an email with the new temporary password</li>
                  <li>They sign in with it, then can use "Forgot password?" to set their own</li>
                  <li>You never see the new password — it's sent straight to their inbox</li>
                </ol>
              </div>
            </>
          )}

          {state === 'success' && (
            <div className="p-3 border border-emerald-200 rounded-md bg-emerald-50">
              <div className="flex items-start gap-2">
                <Check size={16} className="text-emerald-600 shrink-0 mt-0.5"/>
                <div className="text-sm text-emerald-900 leading-relaxed">
                  New temporary password sent to <strong>{result.emailSentTo || target.email}</strong>. They can sign in with it right away.
                </div>
              </div>
            </div>
          )}

          {state === 'error' && (
            <div className="p-3 border border-amber-200 rounded-md bg-amber-50">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-700 shrink-0 mt-0.5"/>
                <div className="text-sm text-amber-900 leading-relaxed break-words">
                  {error}
                </div>
              </div>
              <div className="mt-2 text-xs text-amber-800">
                If the message above contains a password, share it with {target.name} directly (e.g. text or in-person). Their old password no longer works.
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-stone-50 border-t border-stone-200 flex justify-end gap-2">
          {state === 'confirm' ? (
            <>
              <button
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 border border-stone-200 hover:bg-white text-stone-700 text-sm font-semibold rounded-md disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={busy}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300 text-white text-sm font-semibold rounded-md flex items-center gap-1.5">
                {busy
                  ? <><RefreshCw size={13} className="animate-spin"/> Resetting…</>
                  : <><Key size={13}/> Reset & email new password</>
                }
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold rounded-md">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================== SCORING RULES VIEW ===================== */
function ScoringRulesView({ config, onSave }) {
  const rules = config.scoringRules || DEFAULT_SCORING_RULES;

  const update = (path, value) => {
    const next = JSON.parse(JSON.stringify(rules));
    const keys = path.split('.');
    let cursor = next;
    for (let i = 0; i < keys.length - 1; i++) cursor = cursor[keys[i]];
    cursor[keys[keys.length - 1]] = value;
    onSave({ ...config, scoringRules: next });
  };

  const resetAll = () => {
    if (window.confirm('Reset ALL scoring rules to defaults? This cannot be undone.')) {
      onSave({ ...config, scoringRules: DEFAULT_SCORING_RULES });
    }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 flex gap-2.5">
        <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0"/>
        <div className="text-xs text-amber-900 leading-relaxed">
          Changes apply immediately to all lead scores. The "Test Lead" panel at the bottom lets you preview how a hypothetical lead would score under the current rules.
        </div>
      </div>

      <TierThresholdsCard rules={rules} update={update}/>
      <ServiceAreaCard    rules={rules} update={update}/>
      <CommentQualityCard rules={rules} update={update}/>
      <BuyIntentCard      rules={rules} update={update}/>
      <LegitimacyCard     rules={rules} update={update}/>
      <TestLeadCard       rules={rules}/>

      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <div className="text-sm font-semibold text-stone-900 mb-1">Reset</div>
        <div className="text-xs text-stone-500 mb-3">Restore all scoring rules, point values, and keyword lists to their original defaults.</div>
        <button onClick={resetAll}
          className="px-3 py-1.5 border border-stone-200 text-stone-700 hover:bg-stone-50 text-xs font-semibold rounded-md flex items-center gap-1.5">
          <RefreshCw size={12}/> Reset all to defaults
        </button>
      </div>
    </div>
  );
}

function RulesCard({ title, subtitle, accent, children }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-stone-200 bg-stone-50">
        <div className="flex items-center gap-2">
          {accent && <span className="text-sm">{accent}</span>}
          <div className="text-sm font-semibold text-stone-900">{title}</div>
        </div>
        {subtitle && <div className="text-xs text-stone-500 mt-0.5">{subtitle}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function NumberField({ label, value, onChange, suffix, min = 0, max = 100, hint }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1">{label}</label>
      <div className="relative">
        <input type="number" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full pr-12 px-3 py-2 border border-stone-200 rounded-md text-sm font-mono focus:outline-none focus:border-brand-500"/>
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 font-mono pointer-events-none">{suffix}</span>}
      </div>
      {hint && <div className="text-[10px] text-stone-500 mt-1">{hint}</div>}
    </div>
  );
}

function KeywordEditor({ keywords, onChange, placeholder }) {
  const [val, setVal] = useState('');
  const add = () => {
    const v = val.trim().toLowerCase();
    if (v && !keywords.includes(v)) onChange([...keywords, v]);
    setVal('');
  };
  const remove = (kw) => onChange(keywords.filter(k => k !== kw));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
        {keywords.length === 0 ? (
          <span className="text-xs text-stone-400 italic">No keywords — this category will never trigger</span>
        ) : keywords.map(kw => (
          <span key={kw} className="inline-flex items-center gap-1 px-2 py-0.5 bg-stone-100 text-stone-700 text-xs rounded">
            {kw}
            <button onClick={() => remove(kw)} className="text-stone-400 hover:text-rose-600">
              <X size={10}/>
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder={placeholder}
          className="flex-1 px-2.5 py-1.5 border border-stone-200 rounded text-xs focus:outline-none focus:border-brand-500"/>
        <button onClick={add} className="px-2.5 py-1.5 bg-stone-900 text-white text-xs font-semibold rounded hover:bg-stone-800">Add</button>
      </div>
    </div>
  );
}

function TierThresholdsCard({ rules, update }) {
  const t = rules.tiers;
  return (
    <RulesCard title="Tier Thresholds" subtitle="Minimum total score required to qualify for each heat tier (out of 100)">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <NumberField label="🚨 Urgent ≥"  value={t.hot}  onChange={v => update('tiers.hot', v)}  suffix="pts" hint={`Currently ${t.hot}+`}/>
        <NumberField label="⚡ Warm ≥" value={t.warm} onChange={v => update('tiers.warm', v)} suffix="pts" hint={`${t.warm}–${t.hot - 1}`}/>
        <NumberField label="Cool ≥"   value={t.cool} onChange={v => update('tiers.cool', v)} suffix="pts" hint={`${t.cool}–${t.warm - 1} · Cold below ${t.cool}`}/>
      </div>
    </RulesCard>
  );
}

function ServiceAreaCard({ rules, update }) {
  const sa = rules.serviceArea;
  return (
    <RulesCard title="Service Area" subtitle="Points awarded based on the lead's ZIP code prefix" accent="📍">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <NumberField label="Primary area points"        value={sa.texasPoints}    onChange={v => update('serviceArea.texasPoints', v)}    suffix="pts" max={50}/>
        <NumberField label="Adjacent state points" value={sa.adjacentPoints} onChange={v => update('serviceArea.adjacentPoints', v)} suffix="pts" max={50}/>
        <NumberField label="Other points"        value={sa.otherPoints}    onChange={v => update('serviceArea.otherPoints', v)}    suffix="pts" max={50}/>
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1.5">Primary ZIP prefixes (first 2 digits)</div>
          <KeywordEditor keywords={sa.texasPrefixes} onChange={v => update('serviceArea.texasPrefixes', v)} placeholder="e.g. 67"/>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1.5">Adjacent state ZIP prefixes</div>
          <KeywordEditor keywords={sa.adjacentPrefixes} onChange={v => update('serviceArea.adjacentPrefixes', v)} placeholder="e.g. 74"/>
        </div>
      </div>
    </RulesCard>
  );
}

function CommentQualityCard({ rules, update }) {
  const cq = rules.commentQuality;
  return (
    <RulesCard title="Comment Quality" subtitle="Points awarded based on the customer comment length" accent="💬">
      <div className="space-y-2.5">
        <CommentTier label="Detailed"    chars={cq.detailedChars}    points={cq.detailedPoints}    onCharChange={v => update('commentQuality.detailedChars', v)}    onPointChange={v => update('commentQuality.detailedPoints', v)}/>
        <CommentTier label="Substantial" chars={cq.substantialChars} points={cq.substantialPoints} onCharChange={v => update('commentQuality.substantialChars', v)} onPointChange={v => update('commentQuality.substantialPoints', v)}/>
        <CommentTier label="Moderate"    chars={cq.moderateChars}    points={cq.moderatePoints}    onCharChange={v => update('commentQuality.moderateChars', v)}    onPointChange={v => update('commentQuality.moderatePoints', v)}/>
        <CommentTier label="Short"       chars={cq.shortChars}       points={cq.shortPoints}       onCharChange={v => update('commentQuality.shortChars', v)}       onPointChange={v => update('commentQuality.shortPoints', v)}/>
        <CommentTier label="Brief"       chars={1}                   points={cq.briefPoints}       onPointChange={v => update('commentQuality.briefPoints', v)}     readonlyChars/>
      </div>
    </RulesCard>
  );
}

function CommentTier({ label, chars, points, onCharChange, onPointChange, readonlyChars }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="font-semibold text-stone-700 w-24 shrink-0">{label}</div>
      <div className="text-xs text-stone-500 shrink-0">≥</div>
      {readonlyChars ? (
        <div className="font-mono text-xs text-stone-500 w-20">1+ chars</div>
      ) : (
        <div className="flex items-center gap-1">
          <input type="number" min={1} value={chars} onChange={e => onCharChange(Number(e.target.value))}
            className="w-20 px-2 py-1 border border-stone-200 rounded text-sm font-mono focus:outline-none focus:border-brand-500"/>
          <span className="text-xs text-stone-500">chars</span>
        </div>
      )}
      <div className="text-xs text-stone-500 ml-auto">=</div>
      <div className="flex items-center gap-1">
        <input type="number" min={0} max={50} value={points} onChange={e => onPointChange(Number(e.target.value))}
          className="w-16 px-2 py-1 border border-stone-200 rounded text-sm font-mono focus:outline-none focus:border-brand-500"/>
        <span className="text-xs text-stone-500">pts</span>
      </div>
    </div>
  );
}

function BuyIntentCard({ rules, update }) {
  const bi = rules.buyIntent;
  const categories = [
    { key: 'urgency',   label: 'Urgency',           hint: 'Customer signals they want to act fast' },
    { key: 'pricing',   label: 'Pricing Interest',  hint: 'Customer is asking about cost or financing' },
    { key: 'timeframe', label: 'Timeframe',         hint: 'Customer mentions a specific timeline' },
    { key: 'equipment', label: 'Specific Equipment',hint: 'Customer names a category or model (also triggers on model numbers like S70, T76)' }
  ];
  return (
    <RulesCard title="Buy Intent Keywords"
      subtitle={`Total max: ${bi.urgencyPoints + bi.pricingPoints + bi.timeframePoints + bi.equipmentPoints} pts. A category triggers if any of its keywords appear in the comment.`}
      accent="🎯">
      <div className="space-y-5">
        {categories.map(cat => (
          <div key={cat.key}>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <div className="text-sm font-semibold text-stone-900">{cat.label}</div>
                <div className="text-xs text-stone-500">{cat.hint}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <input type="number" min={0} max={30}
                  value={bi[`${cat.key}Points`]}
                  onChange={e => update(`buyIntent.${cat.key}Points`, Number(e.target.value))}
                  className="w-16 px-2 py-1 border border-stone-200 rounded text-sm font-mono text-right focus:outline-none focus:border-brand-500"/>
                <span className="text-xs text-stone-500">pts</span>
              </div>
            </div>
            <KeywordEditor
              keywords={bi[`${cat.key}Keywords`]}
              onChange={v => update(`buyIntent.${cat.key}Keywords`, v)}
              placeholder={cat.key === 'equipment' ? 'e.g. skid steer, telehandler' : 'Add a keyword and press Enter'}
            />
          </div>
        ))}
      </div>
    </RulesCard>
  );
}

function LegitimacyCard({ rules, update }) {
  const lg = rules.legitimacy;
  return (
    <RulesCard title="Legitimacy Deductions" subtitle="Each lead starts with 20 legitimacy points. Red flags reduce the score." accent="🛡️">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <NumberField label="Disposable email"      value={lg.disposableEmailDeduction} onChange={v => update('legitimacy.disposableEmailDeduction', v)} suffix="–pts" max={20}/>
        <NumberField label="Suspicious name"       value={lg.suspiciousNameDeduction}  onChange={v => update('legitimacy.suspiciousNameDeduction', v)}  suffix="–pts" max={20}/>
        <NumberField label="Fake phone number"     value={lg.fakePhoneDeduction}        onChange={v => update('legitimacy.fakePhoneDeduction', v)}        suffix="–pts" max={20}/>
        <NumberField label="Invalid email format"  value={lg.invalidEmailDeduction}     onChange={v => update('legitimacy.invalidEmailDeduction', v)}     suffix="–pts" max={20}/>
        <NumberField label="All-caps brief comment" value={lg.allCapsDeduction}         onChange={v => update('legitimacy.allCapsDeduction', v)}          suffix="–pts" max={20}/>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1.5">Disposable email domains</div>
        <KeywordEditor keywords={lg.disposableDomains} onChange={v => update('legitimacy.disposableDomains', v)} placeholder="e.g. mailinator"/>
      </div>
    </RulesCard>
  );
}

function TestLeadCard({ rules }) {
  const [test, setTest] = useState({
    customerName: 'John Smith',
    contactEmail: 'john@example.com',
    phone: '281-555-0142',
    zip: '77002',
    comment: 'Looking to buy a T76 compact track loader. Need a quote this week. What is your best price?'
  });
  const score = useMemo(() => scoreLead(test, rules), [test, rules]);
  const s = TIER_STYLES[score.tier];

  return (
    <RulesCard title="Test Lead" subtitle="Type sample lead data to preview scoring in real time" accent="🧪">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1">Customer Name</label>
          <input type="text" value={test.customerName} onChange={e => setTest({...test, customerName: e.target.value})}
            className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500"/>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1">Email</label>
          <input type="email" value={test.contactEmail} onChange={e => setTest({...test, contactEmail: e.target.value})}
            className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500"/>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1">Phone</label>
          <input type="tel" value={test.phone} onChange={e => setTest({...test, phone: e.target.value})}
            className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm font-mono focus:outline-none focus:border-brand-500"/>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1">ZIP</label>
          <input type="text" value={test.zip} onChange={e => setTest({...test, zip: e.target.value})}
            className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm font-mono focus:outline-none focus:border-brand-500"/>
        </div>
      </div>
      <div className="mb-4">
        <label className="block text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-1">Comment</label>
        <textarea value={test.comment} onChange={e => setTest({...test, comment: e.target.value})} rows={3}
          className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm resize-none focus:outline-none focus:border-brand-500"/>
      </div>

      {/* Live score readout */}
      <div className={`${s.bg} rounded-lg p-4 border border-stone-200`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-widest font-semibold text-stone-600 flex items-center gap-1.5">
            <Flame size={12} className={s.text}/> Live Score
          </div>
          <div className={`text-[10px] uppercase tracking-widest font-bold ${s.text}`}>{s.icon} {score.tier}</div>
        </div>
        <div className="flex items-end gap-3 mb-3">
          <div className="font-display text-3xl font-bold text-stone-900 leading-none">
            {score.total}<span className="font-mono text-xs text-stone-400 font-normal ml-1">/ 100</span>
          </div>
          <div className="flex-1 mb-1.5">
            <div className="w-full h-2 bg-white/70 rounded-full overflow-hidden">
              <div className={`h-full ${s.bar} transition-all`} style={{ width: `${score.total}%` }}/>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          {score.breakdown.map((b, i) => <ScoreLine key={i} {...b}/>)}
        </div>
      </div>
    </RulesCard>
  );
}

/* ===================== SETTINGS VIEW ===================== */
/* ===================== REPORTS VIEW ===================== */

const CHART_COLORS = ['#ff3300', '#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16'];

const RANGE_OPTIONS = [
  { value: 7,    label: '7d' },
  { value: 30,   label: '30d' },
  { value: 90,   label: '90d' },
  { value: null, label: 'All' }
];

function filterByRange(leads, days) {
  if (!days) return leads;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return leads.filter(l => new Date(l.createdDate).getTime() >= cutoff);
}

function getPriorRange(leads, days) {
  if (!days) return [];
  const now = Date.now();
  const start = now - days * 24 * 60 * 60 * 1000;
  const priorStart = start - days * 24 * 60 * 60 * 1000;
  return leads.filter(l => {
    const t = new Date(l.createdDate).getTime();
    return t >= priorStart && t < start;
  });
}

function pctChange(curr, prior) {
  if (prior === 0) return curr > 0 ? null : 0;
  return ((curr - prior) / prior) * 100;
}

function avgTimeToFirstContactHours(leads) {
  const times = [];
  leads.forEach(l => {
    const firstChange = (l.history || []).find(h => h.type === 'status_change');
    if (firstChange) {
      times.push((new Date(firstChange.timestamp) - new Date(l.createdDate)) / (1000 * 60 * 60));
    }
  });
  if (!times.length) return null;
  return times.reduce((a, b) => a + b, 0) / times.length;
}

function bucketLeadsByDay(leads, days) {
  const buckets = {};
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dayCount = days || 30;
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { date: key, count: 0, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
  }
  leads.forEach(l => {
    const key = new Date(l.createdDate).toISOString().slice(0, 10);
    if (buckets[key]) buckets[key].count++;
  });
  return Object.values(buckets);
}

function ReportsView({ leads, config }) {
  const [range, setRange] = useState(30);
  // 'all' = the unscoped dashboard (the default). Otherwise a user id.
  const [repFilter, setRepFilter] = useState('all');

  // Scoping happens once, before the range split, so every KPI, chart, table and
  // export downstream inherits it without needing to know the filter exists.
  const scopedLeads = useMemo(
    // Primary only, deliberately. Counting a lead for both its assignee and its
    // secondary would make team totals exceed the real lead count.
    () => repFilter === 'all' ? leads : leads.filter(l => l.assignedTo === repFilter),
    [leads, repFilter]
  );
  const selectedRep = useMemo(
    () => repFilter === 'all' ? null : (config.users || []).find(u => u.id === repFilter) || null,
    [repFilter, config.users]
  );

  const rangeLeads = useMemo(() => filterByRange(scopedLeads, range), [scopedLeads, range]);
  const priorLeads = useMemo(() => getPriorRange(scopedLeads, range), [scopedLeads, range]);

  // ---- KPIs ----
  const kpis = useMemo(() => {
    const total = rangeLeads.length;
    const priorTotal = priorLeads.length;

    const won = rangeLeads.filter(l => l.status === WON_STATUS).length;
    const lost = rangeLeads.filter(l => l.status === 'Lost').length;
    const closed = won + lost;
    const winRate = closed > 0 ? won / closed : null;

    const open = rangeLeads.filter(l => !getClosedStatuses(config).includes(l.status)).length;
    const hot = rangeLeads.filter(l => scoreLead(l, config.scoringRules).tier === 'Urgent').length;

    const avgFirstContact = avgTimeToFirstContactHours(rangeLeads);

    return {
      total, priorTotal, totalChange: pctChange(total, priorTotal),
      won, lost, closed, winRate,
      open, hot, avgFirstContact
    };
  }, [rangeLeads, priorLeads, config.scoringRules]);

  // ---- Time series ----
  const overTimeData = useMemo(
    () => bucketLeadsByDay(rangeLeads, range || 30),
    [rangeLeads, range]
  );

  // ---- Status funnel ----
  const statusData = useMemo(() => config.statuses.map(s => ({
    name: s,
    count: rangeLeads.filter(l => l.status === s).length
  })), [rangeLeads, config.statuses]);

  // ---- Source breakdown ----
  const sourceData = useMemo(() => {
    const counts = {};
    rangeLeads.forEach(l => { counts[l.leadSource] = (counts[l.leadSource] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rangeLeads]);

  // ---- Heat distribution ----
  const heatData = useMemo(() => {
    const tiers = { Urgent: 0, Warm: 0, Cool: 0, Cold: 0 };
    rangeLeads.forEach(l => { tiers[scoreLead(l, config.scoringRules).tier]++; });
    return ['Urgent', 'Warm', 'Cool', 'Cold'].map(name => ({ name, value: tiers[name] }));
  }, [rangeLeads, config.scoringRules]);

  // ---- Branch breakdown ----
  const branchData = useMemo(() => {
    const counts = {};
    rangeLeads.forEach(l => {
      const b = l.branch || '— No branch —';
      counts[b] = (counts[b] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rangeLeads]);

  // ---- Department breakdown ----
  const departmentData = useMemo(() => {
    const counts = {};
    rangeLeads.forEach(l => {
      const d = l.department || '— No department —';
      counts[d] = (counts[d] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rangeLeads]);

  // ---- Rep leaderboard ----
  const repStats = useMemo(() => {
    return config.users.filter(u => !u.isSystem).map(u => {
      const userLeads = rangeLeads.filter(l => l.assignedTo === u.id);  // primary only — no double counting
      const won = userLeads.filter(l => l.status === WON_STATUS).length;
      const lost = userLeads.filter(l => l.status === 'Lost').length;
      const closed = won + lost;
      const hot = userLeads.filter(l => scoreLead(l, config.scoringRules).tier === 'Urgent').length;
      const open = userLeads.filter(l => !getClosedStatuses(config).includes(l.status)).length;
      const stale = userLeads.filter(l => isLeadStale(l, config.staleness)).length;
      return {
        user: u, total: userLeads.length, open, won, closed, hot, stale,
        winRate: closed > 0 ? won / closed : null
      };
    }).sort((a, b) => b.total - a.total);
  }, [rangeLeads, config.users, config.scoringRules, config.staleness]);

  if (leads.length === 0) {
    return <EmptyState icon={BarChart3} title="No data to report yet" subtitle="Add some leads to start seeing pipeline metrics here."/>;
  }

  // ---- Exports ----
  const rangeLabel = range ? `Last ${range} days` : 'All time';
  const generatedAt = new Date().toLocaleString();

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const userMap = Object.fromEntries(config.users.map(u => [u.id, u]));

    // Summary sheet
    const summary = [
      ['Bobcat of Indy · LMT Report'],
      [],
      ['Generated', generatedAt],
      ['Range', rangeLabel],
      ['Sales Rep', selectedRep ? selectedRep.name : 'All reps'],
      ['Leads in range', rangeLeads.length],
      [],
      ['KPI', 'Value'],
      ['Total Leads', kpis.total],
      ['Open Pipeline', kpis.open],
      ['Urgent Leads', kpis.hot],
      ['Won', kpis.won],
      ['Lost', kpis.lost],
      ['Closed', kpis.closed],
      ['Win Rate', kpis.winRate !== null ? Math.round(kpis.winRate * 100) + '%' : '—'],
      ['Avg Time to First Contact', kpis.avgFirstContact !== null ? formatAge(kpis.avgFirstContact) : '—']
    ];
    if (range && kpis.totalChange !== null && kpis.totalChange !== undefined) {
      summary.push(['Total vs Prior Period', (kpis.totalChange > 0 ? '+' : '') + Math.round(kpis.totalChange) + '%']);
    }
    const summarySheet = XLSX.utils.aoa_to_sheet(summary);
    summarySheet['!cols'] = [{ wch: 28 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    // Leads Over Time
    const timeSheet = XLSX.utils.aoa_to_sheet([['Date', 'Count'], ...overTimeData.map(d => [d.date, d.count])]);
    timeSheet['!cols'] = [{ wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, timeSheet, 'Leads Over Time');

    // By Status
    const statusSheet = XLSX.utils.aoa_to_sheet([['Status', 'Count'], ...statusData.map(s => [s.name, s.count])]);
    statusSheet['!cols'] = [{ wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, statusSheet, 'By Status');

    // By Source
    const sourceSheet = XLSX.utils.aoa_to_sheet([['Source', 'Count'], ...sourceData.map(s => [s.name, s.value])]);
    sourceSheet['!cols'] = [{ wch: 22 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, sourceSheet, 'By Source');

    // By Heat
    const heatSheet = XLSX.utils.aoa_to_sheet([['Heat Tier', 'Count'], ...heatData.map(h => [h.name, h.value])]);
    heatSheet['!cols'] = [{ wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, heatSheet, 'By Heat');

    // By Branch
    const branchSheet = XLSX.utils.aoa_to_sheet([['Branch', 'Count'], ...branchData.map(b => [b.name, b.value])]);
    branchSheet['!cols'] = [{ wch: 22 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, branchSheet, 'By Branch');

    const deptSheet = XLSX.utils.aoa_to_sheet([['Department', 'Count'], ...departmentData.map(d => [d.name, d.value])]);
    deptSheet['!cols'] = [{ wch: 22 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, deptSheet, 'By Department');

    // Rep Performance
    const repHeaders = ['Rep', 'Email', 'Role', 'Total', 'Open', 'Urgent', 'Stale', 'Won', 'Lost', 'Closed', 'Win Rate'];
    const repRows = repStats.map(r => [
      r.user.name, r.user.email, r.user.role === 'admin' ? 'Admin' : 'Sales Rep',
      r.total, r.open, r.hot, r.stale, r.won, r.closed - r.won, r.closed,
      r.winRate !== null ? Math.round(r.winRate * 100) + '%' : '—'
    ]);
    const repSheet = XLSX.utils.aoa_to_sheet([repHeaders, ...repRows]);
    repSheet['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, repSheet, 'Rep Performance');

    // Lead Detail
    const leadHeaders = [
      'Customer Name', 'Company Name', 'Email', 'Phone', 'Branch', 'ZIP', 'Status', 'Lead Source',
      'Heat Score', 'Heat Tier', 'Form Title', 'Comment',
      'Date Submitted', 'Created Date', 'Date Assigned', 'Assigned To'
    ];
    const leadRows = rangeLeads.map(l => {
      const score = scoreLead(l, config.scoringRules);
      return [
        l.customerName, l.companyName || '', l.contactEmail, l.phone, l.branch, l.zip, l.status, formatLeadSource(l),
        score.total, score.tier, l.formTitle, l.comment,
        l.dateSubmitted, l.createdDate, l.dateAssigned || '',
        userMap[l.assignedTo]?.name || ''
      ];
    });
    const leadSheet = XLSX.utils.aoa_to_sheet([leadHeaders, ...leadRows]);
    leadSheet['!cols'] = leadHeaders.map(h => ({ wch: Math.min(h.length + 6, 30) }));
    XLSX.utils.book_append_sheet(wb, leadSheet, 'Lead Detail');

    const dateStr = new Date().toISOString().slice(0, 10);
    const rangeStr = range ? `${range}d` : 'all';
    // Slugged rep name in the filename so a folder of exports stays legible.
    const repStr = selectedRep
      ? '-' + selectedRep.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : '';
    XLSX.writeFile(wb, `ind-lmt-report${repStr}-${rangeStr}-${dateStr}.xlsx`);
  };

  const printReport = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Print-only header (only visible when printing) */}
      <div className="print-only mb-6 pb-4 border-b border-stone-300">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-brand-500 flex items-center justify-center rounded-sm">
            <span className="font-display text-2xl font-bold text-white">B</span>
          </div>
          <div>
            <div className="font-display text-2xl font-bold tracking-wide">BOBCAT OF INDY</div>
            <div className="text-xs uppercase tracking-widest text-stone-500">
              LMT Report{selectedRep ? ` · ${selectedRep.name}` : ''}
            </div>
          </div>
        </div>
        <div className="text-xs text-stone-600 mt-3">
          <span className="font-semibold">Sales Rep:</span> {selectedRep ? selectedRep.name : 'All reps'}{' · '}
          <span className="font-semibold">Range:</span> {rangeLabel}{' · '}
          <span className="font-semibold">Generated:</span> {generatedAt}{' · '}
          <span className="font-semibold">Leads in range:</span> {rangeLeads.length}
        </div>
      </div>

      {/* Range selector + Export toolbar (hidden in print) */}
      <div className="flex items-center justify-between gap-3 flex-wrap no-print">
        <div className="text-sm text-stone-600">
          Showing {rangeLeads.length} lead{rangeLeads.length === 1 ? '' : 's'}
          {selectedRep && <> assigned to <span className="font-semibold text-stone-900">{selectedRep.name}</span></>}
          {range && <> created in the last <span className="font-semibold text-stone-900">{range} days</span></>}
          {!range && <> (all time)</>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportExcel}
            className="px-3 py-2 text-xs font-semibold border border-stone-200 hover:bg-stone-50 rounded-md flex items-center gap-1.5 text-stone-700">
            <FileSpreadsheet size={13} className="text-emerald-700"/> Export Excel
          </button>
          <button onClick={printReport}
            className="px-3 py-2 text-xs font-semibold border border-stone-200 hover:bg-stone-50 rounded-md flex items-center gap-1.5 text-stone-700">
            <Printer size={13}/> Print / PDF
          </button>
          <div className="w-px h-6 bg-stone-200 mx-1"/>
          <RepSelector value={repFilter} onChange={setRepFilter} config={config}/>
          <RangeSelector value={range} onChange={setRange}/>
        </div>
      </div>

      {selectedRep && rangeLeads.length === 0 && (
        <div className="flex items-start gap-3 px-3.5 py-3 bg-stone-100 border border-stone-200 rounded-lg no-print">
          <AlertCircle size={16} className="text-stone-500 shrink-0 mt-0.5"/>
          <div className="text-xs text-stone-600 leading-relaxed">
            <span className="font-semibold text-stone-800">{selectedRep.name}</span> has no leads
            {range ? ` created in the last ${range} days` : ''}. Try a wider range, or{' '}
            <button onClick={() => setRepFilter('all')} className="underline font-semibold text-brand-700 hover:text-brand-800">
              show all reps
            </button>.
          </div>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Leads"    value={kpis.total}    change={range ? kpis.totalChange : null}/>
        <KpiCard label="Open Pipeline"  value={kpis.open}     subtitle={`${kpis.hot} urgent`}/>
        <KpiCard label="Won / Lost"     value={`${kpis.won} / ${kpis.lost}`} subtitle={kpis.closed > 0 ? `${kpis.closed} closed` : 'no closed deals yet'}/>
        <KpiCard label="Win Rate"       value={kpis.winRate !== null ? `${Math.round(kpis.winRate * 100)}%` : '—'} subtitle={kpis.closed > 0 ? `of ${kpis.closed} closed` : 'no closed deals'} accent={kpis.winRate !== null && kpis.winRate >= 0.5 ? 'good' : null}/>
        <KpiCard label="Avg First Contact" value={kpis.avgFirstContact !== null ? formatAge(kpis.avgFirstContact) : '—'} subtitle="created → first status change"/>
      </div>

      {/* Leads Over Time */}
      <ChartCard title="Leads Over Time" subtitle="New leads created per day">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={overTimeData} margin={{ top: 5, right: 12, bottom: 5, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false}/>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716c' }} interval={Math.max(0, Math.floor(overTimeData.length / 12))}/>
            <YAxis tick={{ fontSize: 10, fill: '#78716c' }} allowDecimals={false}/>
            <Tooltip
              cursor={{ fill: '#fafaf9' }}
              contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 6, padding: '6px 10px' }}
              labelStyle={{ fontWeight: 600, color: '#1c1917' }}
            />
            <Bar dataKey="count" fill="#ff3300" radius={[3, 3, 0, 0]}/>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Two-column row: Status & Source */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Pipeline by Status" subtitle="Where leads sit right now">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={statusData} layout="vertical" margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false}/>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#78716c' }} allowDecimals={false}/>
              <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11, fill: '#44403c' }}/>
              <Tooltip
                cursor={{ fill: '#fafaf9' }}
                contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 6 }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {statusData.map((entry, i) => (
                  <Cell key={i} fill={statusBarColor(entry.name)}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead Source Mix" subtitle="Where new leads came from">
          {sourceData.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-stone-400 italic">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={sourceData} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={80} innerRadius={45} paddingAngle={2}>
                  {sourceData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]}/>)}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 6 }}
                  formatter={(value, name) => [`${value} lead${value === 1 ? '' : 's'}`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          {/* Manual legend so we can show counts */}
          {sourceData.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 px-1">
              {sourceData.map((s, i) => (
                <div key={s.name} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}/>
                  <span className="text-stone-700">{s.name}</span>
                  <span className="text-stone-500 font-mono">{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      {/* Two-column row: Heat & Branch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Heat Distribution" subtitle="How many leads in each tier">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={heatData} layout="vertical" margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false}/>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#78716c' }} allowDecimals={false}/>
              <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11, fill: '#44403c' }}/>
              <Tooltip cursor={{ fill: '#fafaf9' }} contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 6 }}/>
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {heatData.map((entry, i) => (
                  <Cell key={i} fill={heatBarColor(entry.name)}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Leads by Branch" subtitle="Geographic distribution">
          {branchData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-stone-400 italic">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={branchData} layout="vertical" margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false}/>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#78716c' }} allowDecimals={false}/>
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#44403c' }}/>
                <Tooltip cursor={{ fill: '#fafaf9' }} contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 6 }}/>
                <Bar dataKey="value" fill="#0ea5e9" radius={[0, 3, 3, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Leads by Department" subtitle="Category breakdown">
          {departmentData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-stone-400 italic">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={departmentData} layout="vertical" margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false}/>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#78716c' }} allowDecimals={false}/>
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#44403c' }}/>
                <Tooltip cursor={{ fill: '#fafaf9' }} contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 6 }}/>
                <Bar dataKey="value" fill="#8b5cf6" radius={[0, 3, 3, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Rep Leaderboard — hidden when scoped to a single rep, where a
          one-row "leaderboard" says nothing the KPI cards above haven't. */}
      {!selectedRep && (
      <ChartCard title="Sales Team Performance" subtitle="Activity and outcomes per rep" icon={Trophy}>
        {repStats.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400 italic">No sales reps yet — add team members in Users.</div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin -mx-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-stone-500 border-b border-stone-200">
                  <th className="px-4 py-2 text-left font-semibold">Rep</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-right font-semibold">Open</th>
                  <th className="px-3 py-2 text-right font-semibold">🚨 Urgent</th>
                  <th className="px-3 py-2 text-right font-semibold">Stale</th>
                  <th className="px-3 py-2 text-right font-semibold">Won</th>
                  <th className="px-3 py-2 text-right font-semibold">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {repStats.map(rep => (
                  <tr key={rep.user.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-stone-100 text-stone-600 text-[10px] font-semibold uppercase flex items-center justify-center">
                          {rep.user.name.split(' ').map(s => s[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-medium text-stone-900">{rep.user.name}</div>
                          {rep.user.role === 'admin' && <div className="text-[10px] uppercase tracking-wider text-brand-700 font-semibold">Admin</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-stone-900">{rep.total}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-stone-700">{rep.open}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-brand-700 font-semibold">{rep.hot || ''}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{rep.stale > 0 ? <span className="text-rose-600 font-semibold">{rep.stale}</span> : <span className="text-stone-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-emerald-700">{rep.won || ''}</td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {rep.winRate !== null
                        ? <span className={rep.winRate >= 0.5 ? 'text-emerald-700 font-semibold' : 'text-stone-700'}>{Math.round(rep.winRate * 100)}%</span>
                        : <span className="text-stone-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
      )}
    </div>
  );
}

// Scopes the whole Reports tab to one rep. Defaults to 'all' — the unscoped
// dashboard — so the tab opens exactly as it did before this existed.
// "Unassigned" is offered deliberately: leads parked on the system user are
// worth being able to look at on their own.
function RepSelector({ value, onChange, config }) {
  const users = config.users || [];
  const reps = sortUsersByName(users.filter(u => !u.isSystem));
  const unassigned = users.find(u => u.isSystem);
  const scoped = value !== 'all';

  const options = [
    { value: 'all', label: 'All Reps' },
    ...reps.map(u => ({ value: u.id, label: u.name, hint: u.onLeaveOfAbsence ? 'on leave' : undefined })),
    ...(unassigned ? [{ value: unassigned.id, label: unassigned.name, italic: true }] : [])
  ];

  return (
    <div className="inline-block">
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options}
        ariaLabel="Filter reporting by sales rep"
        searchPlaceholder="Search reps…"
        renderTrigger={({ selected, open }) => (
          <div className={`relative pl-7 pr-7 py-2 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap ${
            scoped
              ? 'bg-brand-50 border-brand-200 text-brand-700'
              : `bg-white text-stone-700 hover:bg-stone-50 ${open ? 'border-brand-500' : 'border-stone-200'}`
          }`}>
            {selected?.label || 'All Reps'}
            <User size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${scoped ? 'text-brand-700' : 'text-stone-400'}`}/>
            <ChevronDown size={13} className={`absolute right-2 top-1/2 -translate-y-1/2 ${scoped ? 'text-brand-700' : 'text-stone-400'}`}/>
          </div>
        )}
      />
    </div>
  );
}

function RangeSelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 bg-stone-100 rounded-md p-1">
      {RANGE_OPTIONS.map(r => (
        <button key={r.label} onClick={() => onChange(r.value)}
          className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
            value === r.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'
          }`}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

function KpiCard({ label, value, change, subtitle, accent }) {
  const accentClass = accent === 'good' ? 'text-emerald-700' : accent === 'bad' ? 'text-rose-700' : 'text-stone-900';
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-3 md:p-4">
      <div className="text-[10px] uppercase tracking-widest font-semibold text-stone-500">{label}</div>
      <div className={`font-display text-xl md:text-2xl font-bold mt-1 leading-tight ${accentClass}`}>{value}</div>
      {change !== null && change !== undefined && (
        <div className={`text-[11px] mt-1 flex items-center gap-1 font-medium ${
          change > 0 ? 'text-emerald-700' : change < 0 ? 'text-rose-700' : 'text-stone-500'
        }`}>
          {change > 0 ? <TrendingUp size={11}/> : change < 0 ? <TrendingDown size={11}/> : null}
          {change > 0 ? '+' : ''}{Math.round(change)}% vs prior
        </div>
      )}
      {subtitle && (!change && change !== 0) && (
        <div className="text-[11px] mt-1 text-stone-500">{subtitle}</div>
      )}
      {subtitle && (change !== null && change !== undefined) && (
        <div className="text-[11px] mt-0.5 text-stone-400">{subtitle}</div>
      )}
    </div>
  );
}

function ChartCard({ title, subtitle, icon: Icon, children }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-3 md:p-4">
      <div className="mb-3 flex items-center gap-2">
        {Icon && <Icon size={14} className="text-stone-500"/>}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-900 truncate">{title}</div>
          {subtitle && <div className="text-xs text-stone-500 truncate">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function statusBarColor(status) {
  const map = {
    New: '#3b82f6', Contacted: '#f59e0b', Working: '#8b5cf6', Qualified: '#8b5cf6', Quoted: '#06b6d4',
    Won: '#10b981', Completed: '#10b981', Lost: '#f43f5e', Unqualified: '#a8a29e',
    Prospect: '#0ea5e9', Pending: '#f59e0b', Want: '#06b6d4', 'Sales Request': '#f97316', Cancelled: '#a8a29e', Dead: '#57534e'
  };
  return map[status] || '#a8a29e';
}

function heatBarColor(tier) {
  const map = { Urgent: '#ff3300', Warm: '#f59e0b', Cool: '#0ea5e9', Cold: '#a8a29e' };
  return map[tier] || '#a8a29e';
}

/* ===================== LEAD ROUTING VIEW ===================== */
// Collects, per location and department, who a lead should go to. The routing
// LOGIC is not built yet — intake still uses branchRouting.js. This tab only
// stores the configuration that logic will read, which is why the banner says so
// plainly rather than letting an admin assume leads are already flowing here.
function LeadRoutingView({ config, onSave, onCreateUser, canEdit = true }) {
  const branches = config.branches || [];
  const departments = getRoutingDepartments(config);
  const [activeBranch, setActiveBranch] = useState(branches[0] || '');
  const [addingFor, setAddingFor] = useState(null);   // routing key awaiting a new rep
  const [showOverview, setShowOverview] = useState(false);

  // Keep the selected tab valid if branches change in Settings underneath us.
  useEffect(() => {
    if (branches.length > 0 && !branches.includes(activeBranch)) setActiveBranch(branches[0]);
  }, [branches, activeBranch]);

  const updateSlot = (branch, department, slotKey, value) => {
    const key = routingKey(branch, department);
    const entry = getRoutingEntry(config, branch, department);
    onSave({
      ...config,
      leadRouting: {
        ...(config.leadRouting || {}),
        [key]: { ...entry, [slotKey]: value }
      }
    });
  };

  // Assignable people: everyone with a real account who is not on leave.
  const assignableUsers = useMemo(
    () => sortUsersByName((config.users || []).filter(u => !u.isSystem && !u.onLeaveOfAbsence)),
    [config.users]
  );

  // Coverage across the whole location, for the tab badges.
  const branchFilled = (branch) => departments.reduce(
    (n, d) => n + countRoutingFilled(getRoutingEntry(config, branch, d)), 0
  );
  const branchTotal = departments.length * ROUTING_SLOTS.length;

  if (branches.length === 0) {
    return <EmptyState icon={Route} title="No locations configured"
      subtitle="Add branches under Settings before setting up lead routing."/>;
  }

  // A rep only ever gets the report — showing them a disabled editor would be
  // worse than not showing the editor at all. No "Back to setup" for them, since
  // there is no setup to go back to.
  if (!canEdit) {
    return <RoutingOverview config={config} readOnly/>;
  }

  // Swapped in rather than layered over, so window.print() picks up the report and
  // not the editor behind it.
  if (showOverview) {
    return <RoutingOverview config={config} onBack={() => setShowOverview(false)}/>;
  }

  return (
    <div className="space-y-4">
      {/* Live. Says plainly what happens and what happens when it can't — an admin
          needs to know a blank Local Primary means the lead falls back, not that it
          quietly goes nowhere. */}
      <div className="flex items-start gap-3 px-3.5 py-3 bg-emerald-50 border border-emerald-200 rounded-lg">
        <CheckCircle2 size={16} className="text-emerald-700 shrink-0 mt-0.5"/>
        <div className="text-xs text-stone-700 leading-relaxed">
          <span className="font-semibold text-stone-900">Routing is live.</span> An incoming lead is matched on
          its location and department. The <span className="font-semibold">Local Primary</span> is assigned the
          lead and emailed; <span className="font-semibold">Local Backup</span> and the CCs are copied on that email.
          <span className="block mt-1">
            If it can&rsquo;t match &mdash; no location, no department, a department with no routing set up (Sales,
            for instance), or a Local Primary who has been removed or is on leave &mdash; the lead stays
            unassigned and notifies
            <span className="font-semibold"> Settings &rarr; Email Notifications &rarr; New Leads</span> instead.
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-stone-500">
          Set who each location and department sends leads to.
        </div>
        <button
          onClick={() => setShowOverview(true)}
          className="px-3 py-2 text-xs font-semibold border border-stone-200 hover:bg-stone-50 rounded-md flex items-center gap-1.5 text-stone-700">
          <FileText size={13}/> Routing Logic Overview
        </button>
      </div>

      {/* Location tabs */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin border-b border-stone-200 -mx-1 px-1">
        {branches.map(branch => {
          const filled = branchFilled(branch);
          const active = branch === activeBranch;
          return (
            <button key={branch} onClick={() => setActiveBranch(branch)}
              className={`shrink-0 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                active ? 'border-brand-500 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}>
              {branch}
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                filled === 0 ? 'bg-stone-100 text-stone-400'
                : filled === branchTotal ? 'bg-emerald-50 text-emerald-700'
                : 'bg-brand-50 text-brand-700'
              }`}>{filled}/{branchTotal}</span>
            </button>
          );
        })}
      </div>

      {/* Department cards for the selected location */}
      <div className="space-y-4">
        {departments.map(department => (
          <RoutingDepartmentCard
            key={`${activeBranch}::${department}`}
            branch={activeBranch}
            department={department}
            entry={getRoutingEntry(config, activeBranch, department)}
            users={assignableUsers}
            onChange={(slotKey, value) => updateSlot(activeBranch, department, slotKey, value)}
            onAddNew={(slotKey) => setAddingFor({ branch: activeBranch, department, slotKey })}
          />
        ))}
      </div>

      <div className="text-[11px] text-stone-400 leading-relaxed px-1">
        A lead is matched by its own department field against the names below, so these must match the
        department values your web forms send. Edit the list under Settings &rarr; Routing Departments.
      </div>

      {addingFor && (
        <AddRoutingRepModal
          branch={addingFor.branch}
          department={addingFor.department}
          existingUsers={config.users || []}
          onCancel={() => setAddingFor(null)}
          onCreated={(newUid) => {
            updateSlot(addingFor.branch, addingFor.department, addingFor.slotKey || 'primaryUserId', newUid);
            setAddingFor(null);
          }}
          onCreateUser={onCreateUser}
        />
      )}
    </div>
  );
}

// A read-only, printable picture of the whole routing table. The config UI shows
// one location at a time, which is right for editing and useless for answering
// "where do our leads actually go?" — this shows all of it at once.
//
// Rendered as a view swap rather than a modal so printing works with the app's
// existing rules (sidebar hidden by `aside`, controls by `.no-print`) instead of
// fighting a fixed overlay.
function RoutingOverview({ config, onBack, readOnly = false }) {
  const branches = config.branches || [];
  const departments = getRoutingDepartments(config);
  const users = config.users || [];
  const generatedAt = new Date().toLocaleString();

  const userById = useMemo(
    () => Object.fromEntries(users.map(u => [u.id, u])),
    [users]
  );

  // Resolve one department row the same way the backend does, so the report
  // reflects what will actually happen rather than what was typed in.
  const resolveRow = (branch, department) => {
    const entry = getRoutingEntry(config, branch, department);
    const primary = entry.primaryUserId ? userById[entry.primaryUserId] : null;
    const secondary = entry.backupUserId ? userById[entry.backupUserId] : null;
    const primaryUnavailable = !!entry.primaryUserId && (!primary || primary.onLeaveOfAbsence);
    const secondaryUnavailable = !!entry.backupUserId && (!secondary || secondary.onLeaveOfAbsence);
    // Routing only assigns when it can produce a real, available owner.
    const routes = !!primary && !primary.onLeaveOfAbsence;
    return {
      branch, department, entry, primary, secondary,
      primaryUnavailable, secondaryUnavailable, routes,
      ccs: [entry.cc1, entry.cc2, entry.cc3].map(c => (c || '').trim()).filter(Boolean)
    };
  };

  const rows = useMemo(
    () => branches.flatMap(b => departments.map(d => resolveRow(b, d))),
    [branches, departments, config, userById]
  );

  const routedCount = rows.filter(r => r.routes).length;
  const fallbackRecipients = Array.isArray(config.notifications?.newLeadEmails)
    ? config.notifications.newLeadEmails : [];

  const exportExcel = () => {
    const header = ['Location', 'Department', 'Routes?', 'Local Primary', 'Primary Email',
                    'Local Backup', 'Backup Email', 'CC 1', 'CC 2', 'CC 3', 'Notes'];
    const body = rows.map(r => [
      r.branch, r.department, r.routes ? 'Yes' : 'No — falls back',
      r.primary?.name || '', r.primary?.email || '',
      r.secondary?.name || '', r.secondary?.email || '',
      r.ccs[0] || '', r.ccs[1] || '', r.ccs[2] || '',
      r.primaryUnavailable ? 'Primary unavailable (removed or on leave)'
        : !r.entry.primaryUserId ? 'No Local Primary set'
        : r.secondaryUnavailable ? 'Backup unavailable (removed or on leave)' : ''
    ]);
    const meta = [
      ['Bobcat of Indy · Routing Logic Overview'],
      ['Generated', generatedAt],
      ['Departments routing', `${routedCount} of ${rows.length}`],
      ['Fallback recipients', fallbackRecipients.join(', ') || '— none configured —'],
      []
    ];
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([...meta, header, ...body]);
    sheet['!cols'] = header.map(h => ({ wch: Math.min(Math.max(h.length + 6, 14), 34) }));
    XLSX.utils.book_append_sheet(wb, sheet, 'Routing Logic');
    XLSX.writeFile(wb, `ind-routing-overview-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Print header — only appears on paper */}
      <div className="print-only mb-6 pb-4 border-b border-stone-300">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-brand-500 flex items-center justify-center rounded-sm">
            <span className="font-display text-2xl font-bold text-white">B</span>
          </div>
          <div>
            <div className="font-display text-2xl font-bold tracking-wide">BOBCAT OF INDY</div>
            <div className="text-xs uppercase tracking-widest text-stone-500">Routing Logic Overview</div>
          </div>
        </div>
        <div className="text-xs text-stone-600 mt-3">
          <span className="font-semibold">Generated:</span> {generatedAt}{' · '}
          <span className="font-semibold">Departments routing:</span> {routedCount} of {rows.length}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap no-print">
        <div>
          <div className="font-display text-xl font-bold text-stone-900">Routing Logic Overview</div>
          <div className="text-xs text-stone-500 mt-0.5">
            {routedCount} of {rows.length} location/department pairs route to a person · everything else falls back
          </div>
          {readOnly && (
            <div className="text-[11px] text-stone-400 mt-1 flex items-center gap-1">
              <Lock size={11}/> View only — an administrator maintains these settings
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack}
              className="px-3 py-2 text-xs font-semibold border border-stone-200 hover:bg-stone-50 rounded-md flex items-center gap-1.5 text-stone-700">
              <ChevronLeft size={13}/> Back to setup
            </button>
          )}
          <button onClick={exportExcel}
            className="px-3 py-2 text-xs font-semibold border border-stone-200 hover:bg-stone-50 rounded-md flex items-center gap-1.5 text-stone-700">
            <FileSpreadsheet size={13} className="text-emerald-700"/> Export Excel
          </button>
          <button onClick={() => window.print()}
            className="px-3 py-2 text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-md flex items-center gap-1.5">
            <Printer size={13}/> Print / PDF
          </button>
        </div>
      </div>

      {/* One table per location */}
      {branches.map(branch => {
        const branchRows = rows.filter(r => r.branch === branch);
        const branchRouted = branchRows.filter(r => r.routes).length;
        return (
          <div key={branch} className="bg-white border border-stone-200 rounded-lg overflow-hidden print-break-avoid">
            <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Building size={14} className="text-stone-400"/>
                <div className="text-sm font-semibold text-stone-900">{branch}</div>
              </div>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                {branchRouted}/{branchRows.length} routing
              </span>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-stone-500 border-b border-stone-200">
                    <th className="px-4 py-2 text-left font-semibold">Department</th>
                    <th className="px-3 py-2 text-left font-semibold">Assigned to</th>
                    <th className="px-3 py-2 text-left font-semibold">Also sees it</th>
                    <th className="px-3 py-2 text-left font-semibold">Copied on email</th>
                  </tr>
                </thead>
                <tbody>
                  {branchRows.map(r => (
                    <tr key={r.department} className="border-b border-stone-100 align-top">
                      <td className="px-4 py-2.5 font-medium text-stone-800 whitespace-nowrap">{r.department}</td>

                      <td className="px-3 py-2.5">
                        {r.routes ? (
                          <div>
                            <div className="text-stone-900">{r.primary.name}</div>
                            {r.primary.email && <div className="text-[11px] text-stone-400">{r.primary.email}</div>}
                          </div>
                        ) : (
                          <div className="text-stone-500 italic">
                            Falls back
                            <div className="text-[11px] text-amber-700 not-italic">
                              {r.primaryUnavailable
                                ? 'Primary removed or on leave'
                                : 'No Local Primary set'}
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        {r.secondary && !r.secondaryUnavailable ? (
                          <div>
                            <div className="text-stone-800">{r.secondary.name}</div>
                            {r.secondary.email && <div className="text-[11px] text-stone-400">{r.secondary.email}</div>}
                          </div>
                        ) : r.secondaryUnavailable ? (
                          <span className="text-[11px] text-amber-700">Backup removed or on leave</span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        {r.ccs.length === 0
                          ? <span className="text-stone-300">—</span>
                          : <div className="space-y-0.5">
                              {r.ccs.map(c => <div key={c} className="text-[11px] text-stone-600">{c}</div>)}
                            </div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* What happens when nothing matches */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden print-break-avoid">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
          <div className="text-sm font-semibold text-stone-900">When a lead doesn&rsquo;t match</div>
          <div className="text-xs text-stone-500 mt-0.5">It stays unassigned and these people are emailed instead</div>
        </div>
        <div className="p-5 space-y-3">
          {fallbackRecipients.length === 0 ? (
            <div className="text-xs text-amber-700 flex items-start gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5"/>
              No fallback recipients configured. Unmatched leads will arrive with nobody notified &mdash;
              add addresses under Settings &rarr; Email Notifications &rarr; New Leads.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {fallbackRecipients.map(e => (
                <span key={e} className="inline-flex items-center gap-1.5 px-2 py-1 bg-stone-100 text-stone-700 text-xs rounded">
                  <Mail size={11} className="text-stone-400"/>{e}
                </span>
              ))}
            </div>
          )}

          <div className="text-xs text-stone-600 leading-relaxed pt-1">
            A lead falls back when it has <span className="font-medium">no location</span>, <span className="font-medium">no
            department</span>, a department with no routing set up (a Sales enquiry, for instance), no Local Primary
            chosen, or a Local Primary who has been removed or put on leave.
          </div>
        </div>
      </div>

      <div className="text-[11px] text-stone-400 leading-relaxed px-1 print-break-avoid">
        Leads are matched on the department value sent by the web form against the department names above.
        Reporting counts a lead against the person it is assigned to; a secondary sees it in their My Open but
        it is not counted twice.
      </div>
    </div>
  );
}

function RoutingDepartmentCard({ branch, department, entry, users, onChange, onAddNew }) {
  const filled = countRoutingFilled(entry);
  // A user slot that no longer resolves — deleted or put on leave after being set
  // here. Silently showing "not set" would hide a broken routing rule.
  const isOrphaned = (slotKey) => entry[slotKey] && !users.find(u => u.id === entry[slotKey]);
  // Local Backup used to be a free-text email. Surface any leftover value so it can
  // be re-picked as a user rather than vanishing without trace.
  const legacyBackupEmail = (entry.backupEmail || '').trim();
  const legacyMatch = legacyBackupEmail
    ? users.find(u => (u.email || '').toLowerCase() === legacyBackupEmail.toLowerCase())
    : null;

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Building size={14} className="text-stone-400 shrink-0"/>
          <div className="text-sm font-semibold text-stone-900 truncate">{department}</div>
          <span className="text-xs text-stone-400 truncate">· {branch}</span>
        </div>
        <span className={`shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded ${
          filled === 0 ? 'bg-stone-100 text-stone-400'
          : filled === ROUTING_SLOTS.length ? 'bg-emerald-50 text-emerald-700'
          : 'bg-brand-50 text-brand-700'
        }`}>{filled}/{ROUTING_SLOTS.length}</span>
      </div>

      <div className="p-5 space-y-3">
        {ROUTING_SLOTS.map(slot => (
          <div key={slot.key} className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-1.5 sm:gap-3 sm:items-start">
            <div className="pt-1.5">
              <div className="text-xs font-medium text-stone-700">{slot.label}</div>
              {slot.hint && <div className="text-[10px] text-stone-400 leading-tight mt-0.5">{slot.hint}</div>}
            </div>

            {slot.type === 'user' ? (
              <div>
                <SearchableSelect
                  value={isOrphaned(slot.key) ? '' : (entry[slot.key] || '')}
                  onChange={(v) => {
                    if (v === '__add__') { onAddNew(slot.key); return; }
                    onChange(slot.key, v);
                  }}
                  options={[
                    { value: '', label: slot.optional ? '— None —' : '— Not set —', italic: true },
                    ...users.map(u => ({ value: u.id, label: u.name })),
                    { value: '__add__', label: '+ Add new rep…', italic: true }
                  ]}
                  ariaLabel={slot.label}
                  searchPlaceholder="Search reps…"
                  renderTrigger={({ selected, open }) => (
                    <div className={`w-full px-2.5 py-1.5 border rounded text-sm bg-white flex items-center justify-between gap-2 ${
                      open ? 'border-brand-500 ring-1 ring-brand-500' : 'border-stone-200'
                    }`}>
                      <span className={`truncate ${selected && selected.value ? '' : 'text-stone-400'}`}>
                        {selected ? selected.label : (slot.optional ? '— None —' : '— Not set —')}
                      </span>
                      <ChevronDown size={13} className="text-stone-400 shrink-0"/>
                    </div>
                  )}
                />
                {isOrphaned(slot.key) && (
                  <div className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                    <AlertTriangle size={11}/>
                    Previously-set user is no longer available (removed or on leave). Pick someone else.
                  </div>
                )}
                {slot.key === 'backupUserId' && !entry.backupUserId && legacyBackupEmail && (
                  <div className="text-[11px] text-amber-700 mt-1 flex items-start gap-1">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                    <span>
                      Was <span className="font-mono">{legacyBackupEmail}</span>. Local Backup is now a user, so
                      they also see the lead in My Open.
                      {legacyMatch
                        ? <> That address matches <span className="font-semibold">{legacyMatch.name}</span> — pick them above.</>
                        : <> No account matches that address — pick someone, or add them.</>}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <RoutingEmailField
                value={entry[slot.key] || ''}
                onCommit={(v) => onChange(slot.key, v)}
                placeholder="name@berrycompaniesinc.com"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Local draft state so typing doesn't write to Firestore on every keystroke —
// commits on blur or Enter. Flags a malformed address without blocking the save,
// since a half-typed value being rejected outright is worse than a warning.
function RoutingEmailField({ value, onCommit, placeholder }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== (value || '')) onCommit(trimmed);
  };
  const invalid = draft.trim() !== '' && !validEmail(draft.trim());

  return (
    <div>
      <input
        type="email"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }}
        placeholder={placeholder}
        className={`w-full px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-1 ${
          invalid
            ? 'border-amber-300 focus:border-amber-400 focus:ring-amber-300'
            : 'border-stone-200 focus:border-brand-500 focus:ring-brand-500'
        }`}
      />
      {invalid && (
        <div className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
          <AlertTriangle size={11}/> That does not look like a valid email address.
        </div>
      )}
    </div>
  );
}

// Inline rep creation from the routing tab. Deliberately reuses the same
// create-auth-user → write-profile → welcome-email path as the Users tab rather
// than a lighter shortcut: a Local Primary must be a real assignable account, or
// routing would resolve to somebody who cannot own a lead.
function AddRoutingRepModal({ branch, department, existingUsers, onCancel, onCreated, onCreateUser }) {
  const [form, setForm] = useState({ name: '', email: '', password: generateStrongPassword(), role: 'user' });
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!form.name.trim()) return setErr('Name is required.');
    if (!validEmail(form.email)) return setErr('Enter a valid email address.');
    if (form.password.length < 6) return setErr('Password must be at least 6 characters.');
    if (existingUsers.some(u => (u.email || '').toLowerCase() === form.email.trim().toLowerCase())) {
      return setErr('A user with that email already exists — pick them from the dropdown instead.');
    }

    setBusy(true);
    try {
      const newUid = await onCreateUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role
      });
      onCreated(newUid);
    } catch (e) {
      setErr(e?.message || 'Could not create the user.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-stone-200">
          <div className="text-sm font-semibold text-stone-900">Add a new rep</div>
          <div className="text-xs text-stone-500 mt-0.5">
            They will be set as Local Primary for <span className="font-medium text-stone-700">{department} · {branch}</span>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <Field label="Name" required>
            <input type="text" value={form.name} autoFocus
              onChange={(e) => { setForm({ ...form, name: e.target.value }); setErr(''); }}
              className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
          </Field>

          <Field label="Email" required>
            <input type="email" value={form.email}
              onChange={(e) => { setForm({ ...form, email: e.target.value }); setErr(''); }}
              placeholder="name@berrycompaniesinc.com"
              className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
          </Field>

          <Field label="Temporary password" required>
            <div className="flex gap-2">
              <input type={showPw ? 'text' : 'password'} value={form.password}
                onChange={(e) => { setForm({ ...form, password: e.target.value }); setErr(''); }}
                className="flex-1 px-3 py-2 border border-stone-200 rounded-md text-sm font-mono focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
              <button onClick={() => setShowPw(!showPw)} type="button"
                className="px-2.5 text-stone-500 hover:text-stone-800 border border-stone-200 rounded-md"
                title={showPw ? 'Hide' : 'Show'}>
                {showPw ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
            <button type="button"
              onClick={() => setForm({ ...form, password: generateStrongPassword() })}
              className="mt-1.5 text-[11px] text-stone-500 hover:text-brand-700 inline-flex items-center gap-1">
              <Sparkles size={11}/> Generate a new one
            </button>
          </Field>

          <Field label="Role">
            <select value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm bg-white focus:outline-none focus:border-brand-500">
              <option value="user">Sales Rep</option>
              <option value="admin">Admin</option>
            </select>
          </Field>

          <div className="text-[11px] text-stone-500 leading-relaxed">
            They receive a welcome email with these credentials and can change the password after signing in.
          </div>

          {err && (
            <div className="text-xs text-rose-600 flex items-start gap-1.5">
              <AlertCircle size={13} className="shrink-0 mt-0.5"/> {err}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy}
            className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={busy}
            className="px-3 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-stone-300 text-white text-sm font-semibold rounded-md flex items-center gap-1.5">
            {busy ? <RefreshCw size={13} className="animate-spin"/> : <UserPlus size={13}/>}
            {busy ? 'Creating…' : 'Create and assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsConfigView({ config, onSave, leads }) {
  return (
    <div className="max-w-3xl space-y-4">
      <ListEditor title="Statuses"     items={config.statuses} onChange={items => onSave({ ...config, statuses: items })} />
      <ClosedStatusesEditor config={config} onSave={onSave} />
      <ListEditor title="Branches"     items={config.branches} onChange={items => onSave({ ...config, branches: items })} />
      <ListEditor title="Departments"  items={config.departments || []} onChange={items => onSave({ ...config, departments: items })} />
      <ListEditor title="Lead Sources" items={config.sources}  onChange={items => onSave({ ...config, sources: items  })} />
      <ListEditor title="Routing Departments" items={getRoutingDepartments(config)} onChange={items => onSave({ ...config, routingDepartments: items })} />

      <StalenessConfigCard config={config} onSave={onSave}/>
      <DuplicateDetectionConfigCard config={config} onSave={onSave}/>
      {/* Email recipients live on the Notifications tab. */}

      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <div className="text-sm font-semibold text-stone-900 mb-1">Danger Zone</div>
        <div className="text-xs text-stone-500 mb-3">{leads.length} leads currently stored</div>
        <button
          onClick={async () => {
            if (window.confirm(`Permanently delete all ${leads.length} leads? This cannot be undone.`)) {
              try {
                await clearAllLeads();
                // No reload needed — onSnapshot subscription will reflect the empty state
              } catch (e) {
                alert('Could not clear leads: ' + (e.message || 'unknown error'));
              }
            }
          }}
          className="px-3 py-1.5 border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold rounded-md">
          Clear All Leads
        </button>
      </div>
    </div>
  );
}

// Reusable recipient list. Extracted so the access-request and new-lead sections
// stay identical in behaviour rather than drifting as two near-copies.
function EmailRecipientList({ recipients, onChange, lockLastRow, emptyHint }) {
  const [newEmail, setNewEmail] = useState('');
  const [err, setErr] = useState('');

  const addEmail = () => {
    setErr('');
    const trimmed = newEmail.trim();
    if (!validEmail(trimmed)) return setErr('Enter a valid email address.');
    if (recipients.some(e => e.toLowerCase() === trimmed.toLowerCase())) {
      return setErr('That email is already on the list.');
    }
    onChange([...recipients, trimmed]);
    setNewEmail('');
  };

  return (
    <>
      <div className="space-y-1.5">
        {recipients.length === 0 ? (
          <div className="text-xs text-stone-400 italic px-1 py-2">{emptyHint || 'No recipients yet.'}</div>
        ) : recipients.map((email) => (
          <div key={email} className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <Mail size={13} className="text-stone-400 shrink-0"/>
              <span className="text-sm text-stone-800 truncate">{email}</span>
            </div>
            {!(lockLastRow && recipients.length === 1) && (
              <button
                onClick={() => onChange(recipients.filter(e => e !== email))}
                className="text-stone-400 hover:text-rose-600 p-1"
                title="Remove">
                <X size={14}/>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-3">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => { setNewEmail(e.target.value); setErr(''); }}
          onKeyDown={(e) => e.key === 'Enter' && addEmail()}
          placeholder="name@example.com"
          className="flex-1 px-3 py-1.5 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <button
          onClick={addEmail}
          className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold rounded-md flex items-center gap-1.5">
          <Plus size={13}/> Add
        </button>
      </div>

      {err && (
        <div className="text-xs text-rose-600 mt-2 flex items-center gap-1">
          <AlertCircle size={12}/> {err}
        </div>
      )}
    </>
  );
}

function NotificationsConfigCard({ config, onSave }) {
  const DEFAULT_RECIPIENT = 'webadmin@berrycompaniesinc.com';
  const current = config.notifications?.accessRequestEmails;
  // Use configured list if it exists; otherwise show the default as a starting suggestion
  const recipients = Array.isArray(current) && current.length > 0 ? current : [DEFAULT_RECIPIENT];
  const isUsingDefault = !current || current.length === 0;

  // New-lead alerts. No default recipient — an empty list means the feature is
  // simply off, which is the safe state for something that emails people.
  const newLeadEmails = Array.isArray(config.notifications?.newLeadEmails)
    ? config.notifications.newLeadEmails : [];
  const newLeadEnabled = config.notifications?.newLeadAlertsEnabled !== false;
  const listOf = (k) => (Array.isArray(config.notifications?.[k]) ? config.notifications[k] : []);
  const salesRequestEmails = listOf('salesRequestEmails');

  const persistNotifications = (patch) => {
    onSave({ ...config, notifications: { ...(config.notifications || {}), ...patch } });
  };
  const persist = (list) => persistNotifications({ accessRequestEmails: list });

  return (
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="px-5 py-3 border-b border-stone-100">
        <div className="text-sm font-semibold text-stone-900">Email Notifications</div>
        <div className="text-xs text-stone-500 mt-0.5">Who gets emailed for system events</div>
      </div>

      <div className="px-5 py-4">
        <div className="text-xs uppercase tracking-widest font-semibold text-stone-500 mb-2">Access Requests</div>
        <div className="text-xs text-stone-500 mb-3">
          Send a notification when someone submits a "Request Access" form on the sign-in screen. Recipients can review and approve/deny in the Users tab.
          {isUsingDefault && <span className="block mt-1 text-amber-700">Using default recipient — add one below to save your own list.</span>}
        </div>

        <EmailRecipientList
          recipients={recipients}
          onChange={persist}
          lockLastRow={isUsingDefault}
        />
      </div>

      {/* ---- New leads ---- */}
      <div className="px-5 py-4 border-t border-stone-100">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <div className="text-xs uppercase tracking-widest font-semibold text-stone-500">New Leads</div>
          </div>
          <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newLeadEnabled}
              onChange={(e) => persistNotifications({ newLeadAlertsEnabled: e.target.checked })}
              className="accent-brand-500"
            />
            <span className="text-xs font-medium text-stone-600">{newLeadEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="text-xs text-stone-500 mb-3">
          Email these people whenever a lead arrives <span className="font-semibold text-stone-700">unassigned</span> and
          needs an owner &mdash; which is every lead that comes in through the web forms. This is separate from the
          assignment email, which goes to one rep once somebody has been chosen.
          {newLeadEmails.length === 0 && (
            <span className="block mt-1 text-amber-700">No recipients yet &mdash; these alerts are not being sent.</span>
          )}
          {!newLeadEnabled && newLeadEmails.length > 0 && (
            <span className="block mt-1 text-amber-700">Turned off &mdash; recipients are saved but nothing is being sent.</span>
          )}
        </div>

        <div className={newLeadEnabled ? '' : 'opacity-50 pointer-events-none'}>
          <EmailRecipientList
            recipients={newLeadEmails}
            onChange={(list) => persistNotifications({ newLeadEmails: list })}
            emptyHint="No recipients yet — add one to start receiving new-lead alerts."
          />
        </div>

        <div className="text-[11px] text-stone-400 mt-3 leading-relaxed">
          A CSV import sends one summary email instead of one per lead.
        </div>
      </div>

      {/* ---- Sales requests ---- */}
      <div className="px-5 py-4 border-t border-stone-100">
        <div className="text-xs uppercase tracking-widest font-semibold text-stone-500 mb-2">Sales Submittals</div>
        <div className="text-xs text-stone-500 mb-3">
          Email these people (the back office) whenever a rep submits a Sales Submittal. The rep who owns the lead
          always gets a copy, and replies go to the rep.
          {salesRequestEmails.length === 0 && (
            <span className="block mt-1 text-amber-700">No recipients yet &mdash; submittals only reach the rep.</span>
          )}
        </div>
        <EmailRecipientList
          recipients={salesRequestEmails}
          onChange={(list) => persistNotifications({ salesRequestEmails: list })}
          emptyHint="No recipients yet — add the back office to start receiving Sales Submittals."
        />
        <div className="text-[11px] text-stone-400 mt-3 leading-relaxed">
          Sales Requests (delivery, get ready, demo, parts, pick up, service) go to this list too.
        </div>
      </div>

      {[['tradeInEmails', 'Trade-In Evaluations', 'Sales managers who value and approve trade-ins.'],
        ['financeEmails', 'Finance', 'The finance team — new finance deals, including ones created automatically from financed Sales Submittals.']]
        .map(([key, title, blurb]) => (
          <div key={key} className="px-5 py-4 border-t border-stone-100">
            <div className="text-xs uppercase tracking-widest font-semibold text-stone-500 mb-2">{title}</div>
            <div className="text-xs text-stone-500 mb-3">
              {blurb} The rep always gets a copy.
              {listOf(key).length === 0 && <span className="block mt-1 text-amber-700">No recipients yet &mdash; only the rep is emailed.</span>}
            </div>
            <EmailRecipientList
              recipients={listOf(key)}
              onChange={(list) => persistNotifications({ [key]: list })}
              emptyHint="No recipients yet."
            />
          </div>
        ))}
    </div>
  );
}

function StalenessConfigCard({ config, onSave }) {
  const s = config.staleness || DEFAULT_STALENESS;

  const updateThreshold = (status, hours) => {
    const value = (!hours || hours <= 0) ? null : hours;
    onSave({
      ...config,
      staleness: { ...s, thresholds: { ...s.thresholds, [status]: value } }
    });
  };

  const toggleEnabled = () => {
    onSave({ ...config, staleness: { ...s, enabled: !s.enabled } });
  };

  const reset = () => {
    if (window.confirm('Reset staleness thresholds to defaults?')) {
      onSave({ ...config, staleness: DEFAULT_STALENESS });
    }
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-900">Stale Lead Alerts</div>
          <div className="text-xs text-stone-500 mt-0.5">Flag leads that have sat too long in a status without any activity</div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={s.enabled} onChange={toggleEnabled} className="accent-brand-500 w-4 h-4"/>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-700">
            {s.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>
      <div className={`p-5 ${!s.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="text-xs text-stone-500 mb-4">
          A lead is "stale" if the time since any activity (status change, note, edit, or assignment) exceeds the threshold for its current status.
          Leave a status at <span className="font-mono">0</span> to never flag it as stale (e.g. for closed states).
        </div>
        <div className="space-y-2">
          {config.statuses.map(status => (
            <div key={status} className="flex items-center gap-3 py-1">
              <div className="w-32 shrink-0"><StatusBadge status={status}/></div>
              <div className="flex-1 text-xs text-stone-500">stale after</div>
              <input
                type="number" min={0}
                value={s.thresholds?.[status] || 0}
                onChange={e => updateThreshold(status, Number(e.target.value))}
                className="w-20 px-2 py-1 border border-stone-200 rounded text-sm font-mono text-right focus:outline-none focus:border-brand-500"
              />
              <span className="text-xs text-stone-500 w-12">hours</span>
              <span className="text-[10px] uppercase tracking-widest text-stone-400 w-16 text-right">
                {s.thresholds?.[status] ? `≈ ${formatAge(s.thresholds[status])}` : '—'}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-stone-100 flex items-center justify-between">
          <div className="text-[11px] text-stone-500">
            Leads approaching their threshold (past 75% of the limit) get an amber "Aging" indicator;
            crossing the threshold turns it into a red "STALE" flag.
          </div>
          <button onClick={reset}
            className="px-3 py-1.5 border border-stone-200 text-stone-700 hover:bg-stone-50 text-xs font-semibold rounded-md flex items-center gap-1.5 shrink-0 ml-3">
            <RefreshCw size={11}/> Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateDetectionConfigCard({ config, onSave }) {
  const d = config.duplicateDetection || DEFAULT_DUPLICATE_DETECTION;
  const toggleEnabled = () => onSave({ ...config, duplicateDetection: { ...d, enabled: !d.enabled } });
  const updateDays = (days) => onSave({ ...config, duplicateDetection: { ...d, withinDays: Math.max(1, days || 1) } });

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-900">Duplicate Detection</div>
          <div className="text-xs text-stone-500 mt-0.5">
            When new leads come in, check if they match an existing lead's email or phone within a recent time window.
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={d.enabled} onChange={toggleEnabled} className="accent-brand-500 w-4 h-4"/>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-700">
            {d.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>
      <div className={`p-5 ${!d.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-stone-700 w-32 shrink-0">Detection window</label>
          <input
            type="number" min={1}
            value={d.withinDays || 90}
            onChange={e => updateDays(Number(e.target.value))}
            className="w-24 px-3 py-1.5 border border-stone-200 rounded text-sm font-mono focus:outline-none focus:border-brand-500"
          />
          <span className="text-xs text-stone-500">days</span>
          <span className="text-[11px] text-stone-400 ml-2">
            Leads older than this aren't considered as potential duplicates.
          </span>
        </div>
        <div className="text-[11px] text-stone-500 mt-4 leading-relaxed">
          A new lead is flagged as a duplicate if its email <em>or</em> phone (last 10 digits) matches an existing lead created within the window above.
          Manual Add Lead surfaces a confirmation modal; CSV Import flags matching rows in the preview with a "Skip duplicates" toggle.
        </div>
      </div>
    </div>
  );
}

function ListEditor({ title, items, onChange }) {
  const [val, setVal] = useState('');
  return (
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="px-5 py-4 border-b border-stone-200 text-sm font-semibold text-stone-900">{title}</div>
      <div className="p-3 flex flex-wrap gap-2">
        {items.map(item => (
          <span key={item} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-stone-100 text-stone-700 text-xs rounded-md">
            {item}
            <button onClick={() => onChange(items.filter(i => i !== item))} className="text-stone-400 hover:text-rose-600">
              <X size={11}/>
            </button>
          </span>
        ))}
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <input type="text" value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onChange([...items, val.trim()]); setVal(''); } }}
          placeholder={`Add ${title.toLowerCase().replace(/s$/,'')}...`}
          className="flex-1 px-3 py-1.5 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500"/>
        <button onClick={() => { if (val.trim()) { onChange([...items, val.trim()]); setVal(''); } }}
          className="px-3 py-1.5 bg-stone-900 text-white text-xs font-semibold rounded-md hover:bg-stone-800">Add</button>
      </div>
    </div>
  );
}

/* ===================== CLOSED STATUSES EDITOR =====================
 * Lets admins mark which statuses count as "closed" (terminal).
 * A closed status routes leads into My Closed / All Closed, starts the 30-day
 * archive clock, and is excluded from the Open filter.
 *
 * Renders as a checklist of every status in config.statuses. Toggling a
 * checkbox writes back to config.closedStatuses immediately.
 */
function ClosedStatusesEditor({ config, onSave }) {
  const statuses = config.statuses || [];
  const closed = new Set(getClosedStatuses(config));

  const toggleClosed = (status) => {
    const next = new Set(closed);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    // Preserve the order of config.statuses so the array is stable across saves
    const nextArr = statuses.filter(s => next.has(s));
    onSave({ ...config, closedStatuses: nextArr });
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-5">
      <div className="text-sm font-semibold text-stone-900 mb-1">Closed Statuses</div>
      <div className="text-xs text-stone-500 mb-3 leading-relaxed">
        Statuses checked here count as <strong>closed</strong> — leads move into My Closed / All Closed,
        the 30-day archive clock starts, and they're excluded from the Open filter.
        Unchecked statuses count as open.
      </div>

      {statuses.length === 0 ? (
        <div className="text-xs text-stone-500 italic">Add statuses above to configure which count as closed.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {statuses.map(s => {
            const isClosed = closed.has(s);
            return (
              <label
                key={s}
                className={`flex items-center gap-2 px-2.5 py-2 rounded border cursor-pointer transition-colors ${
                  isClosed
                    ? 'bg-stone-50 border-stone-300'
                    : 'bg-white border-stone-200 hover:bg-stone-50'
                }`}>
                <input
                  type="checkbox"
                  checked={isClosed}
                  onChange={() => toggleClosed(s)}
                  className="accent-brand-500"
                />
                <StatusBadge status={s}/>
                <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400 ml-auto">
                  {isClosed ? 'Closed' : 'Open'}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ===================== LEAD DETAIL PANEL ===================== */
function LeadDetailPanel({ lead, config, currentUser, onClose, onUpdate, onDelete, onArchive, onUnarchive, onMarkJunk, onRestoreJunk, onStatusChange, onExtendWorking, leadRecords = { requests: [], tradeIns: [], finance: [] }, onUpdateRequest, onUpdateRecord, onNewRecord, onAddLeadFiles, onRemoveLeadFile }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lead);
  const [newComment, setNewComment] = useState('');

  useEffect(() => { setDraft(lead); }, [lead.id]);

  const userMap = Object.fromEntries(config.users.map(u => [u.id, u]));
  const assignedUser = userMap[lead.assignedTo];

  const save = () => {
    const patch = { ...draft };
    if (draft.assignedTo !== lead.assignedTo && draft.assignedTo !== 'u_1' && !lead.dateAssigned) {
      patch.dateAssigned = new Date().toISOString();
    }
    if (draft.assignedTo === 'u_1') patch.dateAssigned = null;
    // Mirrors AddLeadView: a submitter only belongs on a manual entry, so switching
    // the source away from Manual Entry clears it rather than leaving a stale name.
    patch.submittedBy = draft.leadSource === MANUAL_SOURCE ? (draft.submittedBy || '').trim() : '';
    onUpdate(lead.id, patch);
    setEditing(false);
  };

  const addComment = () => {
    if (!newComment.trim()) return;
    const comment = {
      id: uid('c'), text: newComment.trim(),
      timestamp: new Date().toISOString(),
      author: currentUser?.id
    };
    onUpdate(lead.id, { internalComments: [...(lead.internalComments || []), comment] });
    setNewComment('');
  };

  const deleteComment = (id) => {
    onUpdate(lead.id, { internalComments: lead.internalComments.filter(c => c.id !== id) });
  };

  const quickAssign = (userId) => {
    onUpdate(lead.id, {
      assignedTo: userId,
      dateAssigned: userId === 'u_1' ? null : (lead.dateAssigned || new Date().toISOString())
    });
  };

  const quickStatus = (status) => onStatusChange(lead.id, status);
  const leadStage = stageOfLead(lead, getClosedStatuses(config));
  const stageInfo = getStage(leadStage);

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40 hidden md:block" onClick={onClose}/>
      {/* overflow-x-hidden prevents any long content inside from pushing the panel
          wider than the viewport, which was hiding the close button on mobile.
          Content that would have overflowed horizontally now clips instead. */}
      <div className="fixed inset-0 md:inset-y-0 md:right-0 md:left-auto md:w-[520px] bg-white shadow-2xl z-50 slide-in flex flex-col overflow-x-hidden">
        {/* Sticky header so the close X stays visible even if the panel body is
            scrolled far down. Only applies on mobile where there's no other exit
            gesture — desktop users can also click the backdrop. */}
        <div className="sticky top-0 z-10 bg-white px-4 md:px-6 py-3 md:py-4 border-b border-stone-200 flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {stageInfo && (
                <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded flex items-center gap-1 ${STAGE_ACCENTS[stageInfo.id].soft} ${STAGE_ACCENTS[stageInfo.id].text}`}>
                  {(() => { const I = STAGE_ICONS[stageInfo.id]; return <I size={10}/>; })()} {stageInfo.label}
                </span>
              )}
              <StatusBadge status={lead.status}/>
              {isLeadArchived(lead, undefined, config) && (
                <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded bg-stone-200 text-stone-700 border border-stone-300 flex items-center gap-1">
                  <ArchiveX size={10}/> Archived{lead.manuallyArchived ? ' (manual)' : ''}
                </span>
              )}
              {lead.department && (
                <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 flex items-center gap-1">
                  <LayoutGrid size={10}/> {lead.department}
                </span>
              )}
              {(() => {
                const resubmissions = (lead.history || []).filter(h => h.type === 'resubmission').length;
                if (resubmissions === 0) return null;
                const total = resubmissions + 1;
                return (
                  <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                    <RefreshCw size={10}/> Submitted {total}×
                  </span>
                );
              })()}
              <span className="font-mono text-[10px] uppercase tracking-widest text-stone-400 truncate">{lead.id}</span>
            </div>
            <div className="font-display text-xl md:text-2xl font-bold text-stone-900 truncate">{lead.customerName || 'Unnamed Lead'}</div>
            {lead.companyName && (
              <div className="text-sm font-medium text-stone-600 truncate">{lead.companyName}</div>
            )}
            <div className="text-xs text-stone-500 mt-0.5">Created {fmtDateTime(lead.createdDate)}</div>
            {/* Staleness chip lives in the header (under Created) rather than in the
                actions row, so the action buttons stay flush left with the dropdowns. */}
            <div className="mt-1.5">
              <PanelStalenessChip lead={lead} staleness={config.staleness}/>
            </div>
          </div>
          <button onClick={onClose}
            className="text-stone-400 hover:text-stone-900 p-2 -mr-1 -mt-1 shrink-0"
            aria-label="Close panel">
            <X size={22}/>
          </button>
        </div>

        {!editing && (
          <div className="px-4 md:px-6 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2 flex-wrap">
            <select value={lead.status} onChange={e => quickStatus(e.target.value)}
              className="text-xs px-2.5 py-1.5 border border-stone-200 rounded bg-white">
              {statusOptionsFor(lead.status, config.statuses, getClosedStatuses(config), { isAdmin: currentUser?.role === 'admin' })
                .map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {/* The one move worth a button: a sale made in Working means
                filling in the Sales Submittal. */}
            {leadStage === STAGE_WORKING && (
              <button onClick={() => quickStatus(WON_STATUS)}
                className="text-xs px-2.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded inline-flex items-center gap-1"
                title="Sale made — fill in the Sales Submittal and send it to the back office">
                <ClipboardList size={12}/> Sales Submittal
              </button>
            )}
            <SearchableSelect
              value={lead.assignedTo}
              onChange={quickAssign}
              options={config.users
                .filter(u => u.isSystem || !u.onLeaveOfAbsence || u.id === lead.assignedTo)
                .map(u => ({
                  value: u.id,
                  label: u.name,
                  hint: u.onLeaveOfAbsence ? 'on leave' : undefined,
                  italic: u.isSystem
                }))}
              ariaLabel="Assign this lead to"
              searchPlaceholder="Search reps…"
              renderTrigger={({ selected, open }) => (
                <div className={`text-xs px-2.5 py-1.5 border rounded bg-white flex items-center gap-1.5 ${
                  open ? 'border-brand-500' : 'border-stone-200'
                }`}>
                  <span className="truncate max-w-[140px]">{selected?.label || 'Unassigned'}</span>
                  <ChevronDown size={11} className="text-stone-400 shrink-0"/>
                </div>
              )}
            />
            <div className="flex gap-1">
              <button onClick={() => setEditing(true)} className="text-xs px-2.5 py-1.5 border border-stone-200 rounded hover:bg-white flex items-center gap-1">
                <Edit3 size={11}/> Edit
              </button>
              {/* Archive / Unarchive — manually archived leads can be restored back to
                  their previous state via the unarchive button. Auto-archived leads
                  (closed 30+ days) can also be unarchived to bring them back into
                  the active views. Icon-only to keep the action row from wrapping. */}
              {isLeadArchived(lead, undefined, config) ? (
                <button
                  onClick={() => {
                    if (window.confirm('Unarchive this lead? It will reappear in the closed leads views.')) onUnarchive(lead.id);
                  }}
                  className="text-xs px-2.5 py-1.5 text-stone-600 hover:bg-stone-50 rounded"
                  title="Unarchive this lead — bring it back to active views">
                  <RotateCcw size={12}/>
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (window.confirm('Archive this lead? It will be removed from the active views and moved to the Archived tab.')) onArchive(lead.id);
                  }}
                  className="text-xs px-2.5 py-1.5 text-stone-600 hover:bg-stone-50 rounded"
                  title="Archive this lead — move it to the Archived tab">
                  <ArchiveX size={12}/>
                </button>
              )}
              {/* Mark as Junk / Restore. Junk is a normal status underneath, so this
                  is a shortcut for the status dropdown, not a separate mechanism. */}
              {lead.status === JUNK_STATUS ? (
                <button
                  onClick={() => onRestoreJunk(lead.id)}
                  className="text-xs px-2.5 py-1.5 text-stone-700 hover:bg-stone-100 rounded font-medium inline-flex items-center gap-1"
                  title="Restore this lead — put it back into the pipeline">
                  <RotateCcw size={12}/> Restore
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (window.confirm('Mark this lead as junk? It moves to the Junk tab and drops out of the pipeline and reports. You can restore it later.')) onMarkJunk(lead.id);
                  }}
                  className="text-xs px-2.5 py-1.5 text-stone-600 hover:bg-stone-100 rounded"
                  title="Mark as junk — spam or not a real lead">
                  <Trash2 size={12}/>
                </button>
              )}
              <button onClick={() => { if (window.confirm('Delete this lead permanently? This cannot be undone \u2014 use Junk instead if you may want it back.')) onDelete(lead.id); }}
                className="text-xs px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 rounded"
                title="Delete this lead permanently">
                <X size={12}/>
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {editing ? (
            <div className="p-4 md:p-6 space-y-3">
              {[
                ['customerName', 'Customer Name', 'text'],
                ['companyName',  'Company Name',  'text'],
                ['contactEmail', 'Contact Email', 'email'],
                ['phone',        'Phone',         'tel'],
                ['zip',          'Zip',           'text'],
                ['formTitle',    'Form Title',    'text']
              ].map(([k, label, type]) => (
                <Field key={k} label={label}>
                  <input type={type} value={draft[k] || ''} onChange={e => setDraft({...draft, [k]: e.target.value})}
                    className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500"/>
                </Field>
              ))}
              <Field label="Branch">
                <select value={draft.branch || ''} onChange={e => setDraft({...draft, branch: e.target.value})}
                  className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm bg-white">
                  <option value="">—</option>
                  {config.branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Department">
                <select value={draft.department || ''} onChange={e => setDraft({...draft, department: e.target.value})}
                  className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm bg-white">
                  <option value="">—</option>
                  {(config.departments || []).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Lead Source">
                <select value={draft.leadSource} onChange={e => setDraft({...draft, leadSource: e.target.value})}
                  className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm bg-white">
                  {config.sources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              {draft.leadSource === MANUAL_SOURCE && (
                <Field label="Submitter">
                  <input type="text" value={draft.submittedBy || ''}
                    onChange={e => setDraft({...draft, submittedBy: e.target.value})}
                    placeholder="Who entered this lead"
                    className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500"/>
                  <div className="text-[11px] text-stone-400 mt-1">
                    Shows as &ldquo;{formatLeadSource({ leadSource: MANUAL_SOURCE, submittedBy: draft.submittedBy })}&rdquo;
                  </div>
                </Field>
              )}
              <Field label="Date Submitted">
                <input type="datetime-local"
                  value={draft.dateSubmitted ? toLocalDateTimeInputValue(new Date(draft.dateSubmitted)) : ''}
                  onChange={e => setDraft({...draft, dateSubmitted: new Date(e.target.value).toISOString()})}
                  className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm"/>
              </Field>
              <Field label="Customer Comment">
                <textarea value={draft.comment || ''} onChange={e => setDraft({...draft, comment: e.target.value})} rows={4}
                  className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm resize-none"/>
              </Field>
              <div className="flex gap-2 pt-2">
                <button onClick={save} className="flex-1 px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-md">Save Changes</button>
                <button onClick={() => { setDraft(lead); setEditing(false); }} className="px-3 py-2 text-stone-600 hover:text-stone-900 text-sm">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <LeadScoreSection lead={lead} rules={config.scoringRules}/>

              {/* Near the top: once a lead has a sales request, what was sold is
                  the first thing anyone opening it wants. */}
              <SalesRequestSection lead={lead} config={config} currentUser={currentUser}
                onUpdate={onUpdate} onStatusChange={onStatusChange}/>

              {leadStage !== 'junk' && (
                <LeadRequestsSection lead={lead} requests={leadRecords.requests} currentUser={currentUser}
                  onUpdate={onUpdateRequest} onNew={() => onNewRecord('requests', lead.id)}/>
              )}
              {leadStage !== 'junk' && (
                <LeadTradeInsSection tradeIns={leadRecords.tradeIns}
                  onNew={() => onNewRecord('tradeIns', lead.id)}/>
              )}
              {(leadRecords.finance.length > 0 || leadStage === STAGE_SALES_REQUEST || leadStage === STAGE_COMPLETED) && (
                <LeadFinanceSection deals={leadRecords.finance}
                  onNew={() => onNewRecord('finance', lead.id)}/>
              )}

              {leadStage !== 'junk' && <DealSection lead={lead} onUpdate={onUpdate}/>}

              <Section title="Files">
                <AttachmentList attachments={lead.attachments} currentUser={currentUser}
                  emptyText="Quotes, photos, spec sheets, signed paperwork."
                  onAdd={(files) => onAddLeadFiles(lead.id, files)}
                  onRemove={(att) => onRemoveLeadFile(lead.id, att)}/>
              </Section>

              <Section title="Contact">
                <DetailRow icon={Building2} label="Company" value={lead.companyName}/>
                <DetailRow icon={Mail}     label="Email"  value={lead.contactEmail} href={lead.contactEmail ? `mailto:${lead.contactEmail}` : undefined}/>
                <DetailRow icon={Phone}    label="Phone"  value={lead.phone}        mono href={lead.phone ? `tel:${lead.phone}` : undefined}/>
                <DetailRow icon={MapPin}   label="ZIP"    value={lead.zip}          mono />
                <DetailRow icon={Building} label="Branch" value={lead.branch}/>
                <DetailRow icon={LayoutGrid} label="Department" value={lead.department}/>
              </Section>

              <Section title="Source">
                <DetailRow icon={Tag}      label="Lead Source"    value={formatLeadSource(lead)}/>
                <DetailRow icon={FileText} label="Form Title"     value={lead.formTitle}/>
                <DetailRow icon={Calendar} label="Date Submitted" value={fmtDateTime(lead.dateSubmitted)} mono/>
                <DetailRow icon={Calendar} label="Date Created"   value={fmtDateTime(lead.createdDate)}   mono/>
              </Section>

              <Section title="Status">
                <StatusDetailRows lead={lead} config={config} onExtendWorking={onExtendWorking}/>
                <StatusAuditLog lead={lead} config={config} currentUser={currentUser}/>
              </Section>

              <Section title="Assignment">
                <EditableAssignmentRow
                  lead={lead} config={config}
                  onAssign={quickAssign}
                />
                <SecondaryAssigneeRow
                  lead={lead} config={config}
                  onChange={(userId) => onUpdate(lead.id, { secondaryAssignedTo: userId })}
                />
                <DetailRow icon={Calendar} label="Date Assigned" value={fmtDateTime(lead.dateAssigned)} mono/>
              </Section>

              {lead.comment && (
                <Section title="Customer Comment">
                  <div className="text-sm text-stone-700 bg-stone-50 p-3 rounded-md border border-stone-100 whitespace-pre-wrap leading-relaxed">
                    {lead.comment}
                  </div>
                </Section>
              )}

              <ActivityTimeline
                lead={lead} config={config}
                newComment={newComment}
                setNewComment={setNewComment}
                onAddComment={addComment}
                onDeleteComment={deleteComment}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div className="px-4 md:px-6 py-3 md:py-4 border-b border-stone-100">
      <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-2.5">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

// Current status + when it was last changed, laid out to match the Assignment
// block above it. The elapsed time is the useful half — "Quoted, 9 days" tells a
// rep more at a glance than the raw timestamp does.
function StatusDetailRows({ lead, config, onExtendWorking }) {
  const changedAt = getStatusChangedAt(lead);
  const elapsed = formatDuration(changedAt);
  const users = config.users || [];
  const actor = lead.statusChangedBy
    ? users.find(u => u.id === lead.statusChangedBy)
    : null;

  return (
    <>
      <div className="flex items-start gap-3 py-1">
        <Tag size={14} className="text-stone-400 mt-0.5 shrink-0"/>
        <div className="text-xs text-stone-500 w-20 md:w-28 shrink-0 pt-0.5">Current Status</div>
        <div className="flex-1"><StatusBadge status={lead.status}/></div>
      </div>

      {lead.status === WORKING_STATUS && (
        <div className="flex items-start gap-3 py-1">
          <CalendarOff size={14} className="text-stone-400 mt-0.5 shrink-0"/>
          <div className="text-xs text-stone-500 w-20 md:w-28 shrink-0 pt-0.5">Working Until</div>
          <div className="flex-1 min-w-0">
            {(() => {
              const until = getWorkingDeadline(lead);
              if (!until) {
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-stone-400 italic">No deadline set</span>
                    {onExtendWorking && (
                      <button onClick={() => onExtendWorking(lead.id)}
                        className="text-[11px] font-semibold text-brand-700 hover:underline">Set one</button>
                    )}
                  </div>
                );
              }
              const ms = new Date(until).getTime() - Date.now();
              const days = Math.max(0, Math.ceil(ms / 86400000));
              const overdue = ms <= 0;
              return (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${overdue ? 'text-rose-700' : 'text-stone-800'}`}>
                      {fmtDate(until)}
                    </span>
                    <span className={`text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded ${
                      overdue ? 'bg-rose-100 text-rose-700'
                              : days <= 3 ? 'bg-amber-100 text-amber-800'
                                          : 'bg-stone-100 text-stone-600'
                    }`}>
                      {overdue ? 'Past due' : `${days} day${days === 1 ? '' : 's'} left`}
                    </span>
                  </div>
                  {onExtendWorking && (
                    <button onClick={() => onExtendWorking(lead.id)}
                      className="text-[11px] font-semibold text-brand-700 hover:underline mt-0.5">
                      {overdue ? 'Give it more time' : 'Change'}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 py-1">
        <Clock size={14} className="text-stone-400 mt-0.5 shrink-0"/>
        <div className="text-xs text-stone-500 w-20 md:w-28 shrink-0 pt-0.5">Status Changed</div>
        <div className="flex-1 min-w-0">
          {changedAt ? (
            <>
              <div className="text-sm text-stone-800 font-mono">{fmtDateTime(changedAt)}</div>
              {elapsed && (
                <div className="text-xs text-stone-500 mt-0.5">
                  {elapsed === 'just now' ? 'Changed just now' : `In this status for ${elapsed}`}
                  {actor?.name ? ` \u00b7 by ${actor.name}` : ''}
                </div>
              )}
            </>
          ) : (
            <span className="text-sm text-stone-400 italic">&mdash;</span>
          )}
        </div>
      </div>
    </>
  );
}

// A running log of how the lead moved through the pipeline: when it landed, every
// status change since, who made each one, and how long the lead sat in each step.
//
// Collapsed by default. This is reference material \u2014 you want it when a customer
// asks "when did you last touch this?", not while you're working the lead \u2014 so it
// stays a single line until clicked. The data behind it is append-only, so a lead
// from a year ago opens with its whole trail intact.
function StatusAuditLog({ lead, config, currentUser }) {
  const [open, setOpen] = useState(false);
  const trail = useMemo(() => buildStatusTrail(lead), [lead]);

  if (STATUS_HISTORY_ADMIN_ONLY && currentUser?.role !== 'admin') return null;

  const users = config.users || [];
  const changeCount = trail.filter(e => !e.isOrigin).length;

  return (
    <div className="pt-2">
      {/* Full-width and brand-tinted so it reads as a control, not a footnote.
          brand-700 on brand-50 is 5.13:1 — amber's text shade, never the fill. */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`w-full flex items-center gap-2 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 hover:bg-brand-100 hover:border-brand-300 px-3 py-2 transition-colors ${
          open ? 'rounded-t-md' : 'rounded-md'
        }`}>
        <RotateCcw size={13} className="shrink-0"/>
        Status history
        <span className="text-stone-600 font-normal">
          {changeCount === 0 ? '· no changes yet' : `· ${changeCount} change${changeCount === 1 ? '' : 's'}`}
        </span>
        <ChevronDown size={14} className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}/>
      </button>

      {open && (
        /* Border-top removed so the open panel and its button read as one object. */
        <div className="border border-t-0 border-brand-200 rounded-b-md bg-white px-3 py-3">
          {trail.map((entry, i) => {
            const next    = trail[i + 1];
            const isLast  = i === trail.length - 1;
            // How long the lead held this status: until the next change, or until
            // now if this is where it still sits.
            const held    = entry.at
              ? formatDuration(entry.at, next?.at ? new Date(next.at) : new Date())
              : null;
            const actor     = entry.actor ? users.find(u => u.id === entry.actor) : null;
            const actorName = entry.actor ? (actor ? actor.name : 'Former user') : null;
            const dot       = (STATUS_COLORS[entry.status] || {}).dot || 'bg-stone-300';

            return (
              <div key={entry.key} className="flex gap-2.5">
                <div className="flex flex-col items-center shrink-0 pt-1.5">
                  <div className={`w-2 h-2 rounded-full ${dot}`}/>
                  {!isLast && <div className="w-px flex-1 bg-stone-200 my-1"/>}
                </div>

                <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-3'}`}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-semibold text-stone-800">
                      {entry.isOrigin
                        ? (entry.status ? `Submitted as ${entry.status}` : 'Submitted')
                        : entry.status}
                    </span>
                    {held && (
                      <span className="text-[10px] text-stone-400">
                        {isLast ? `${held} so far` : `held ${held}`}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    {entry.at ? fmtDateTime(entry.at) : 'Date unknown'}
                    {actorName ? ` \u00b7 by ${actorName}` : ''}
                  </div>
                  {entry.inferred && (
                    <div className="text-[10px] text-stone-400 mt-0.5 italic">
                      Recorded before change tracking &mdash; earlier steps unknown
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, mono, href }) {
  if (!value) value = <span className="text-stone-400 italic">—</span>;
  const valueClasses = `text-sm text-stone-800 flex-1 break-all ${mono ? 'font-mono' : ''}`;
  return (
    <div className="flex items-start gap-3 py-1">
      <Icon size={14} className="text-stone-400 mt-0.5 shrink-0"/>
      <div className="text-xs text-stone-500 w-20 md:w-28 shrink-0 pt-0.5">{label}</div>
      {href ? (
        <a href={href} className={`${valueClasses} text-brand-600 hover:underline active:text-brand-700`}>{value}</a>
      ) : (
        <div className={valueClasses}>{value}</div>
      )}
    </div>
  );
}

function LeadScoreSection({ lead, rules }) {
  const { total, tier, breakdown } = useMemo(() => scoreLead(lead, rules), [lead, rules]);
  const s = TIER_STYLES[tier];

  return (
    <div className={`px-4 md:px-6 py-3 md:py-4 border-b border-stone-200 ${s.bg}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flame size={14} className={s.text}/>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-stone-600">Lead Heat</span>
        </div>
        <div className={`text-[10px] uppercase tracking-widest font-bold ${s.text}`}>{s.icon} {tier}</div>
      </div>

      <div className="flex items-end gap-3 mb-3">
        <div className="font-display text-4xl font-bold text-stone-900 leading-none">
          {total}
          <span className="font-mono text-sm text-stone-400 font-normal ml-1">/ 100</span>
        </div>
        <div className="flex-1 mb-1.5">
          <div className="w-full h-2 bg-white/60 rounded-full overflow-hidden">
            <div className={`h-full ${s.bar} transition-all`} style={{ width: `${total}%` }}/>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 mt-3">
        {breakdown.map((b, i) => (
          <ScoreLine key={i} {...b}/>
        ))}
      </div>
    </div>
  );
}

function ScoreLine({ label, detail, points, max, status }) {
  const color =
    status === 'hit'     ? 'bg-emerald-500' :
    status === 'partial' ? 'bg-amber-500'   : 'bg-stone-300';
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`}/>
      <div className="font-semibold text-stone-700 w-28 shrink-0">{label}</div>
      <div className="text-stone-500 flex-1 truncate" title={detail}>{detail}</div>
      <div className="font-mono font-semibold text-stone-700 shrink-0 tabular-nums">
        +{points}<span className="text-stone-400"> / {max}</span>
      </div>
    </div>
  );
}

function ActivityTimeline({ lead, config, newComment, setNewComment, onAddComment, onDeleteComment }) {
  const userMap = useMemo(() => Object.fromEntries(config.users.map(u => [u.id, u])), [config.users]);

  const events = useMemo(() => {
    const items = [];

    // Internal comments → 'note' events
    (lead.internalComments || []).forEach(c => {
      items.push({
        id: c.id, type: 'note',
        timestamp: c.timestamp, actor: c.author,
        text: c.text, isComment: true,
        isSystem: c.isSystem === true,
        authorName: c.authorName || null
      });
    });

    // Recorded history events
    (lead.history || []).forEach(h => items.push(h));

    // Fallback: synthesize a 'created' event for older leads without history
    if (!(lead.history || []).some(h => h.type === 'created')) {
      items.push({
        id: 'created_synthetic',
        type: 'created',
        timestamp: lead.createdDate,
        source: formatLeadSource(lead),
        synthetic: true
      });
    }

    return items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [lead.internalComments, lead.history, lead.createdDate, lead.leadSource]);

  return (
    <Section title={`Activity (${events.length})`}>
      <div className="flex gap-2 mb-4">
        <textarea value={newComment} onChange={e => setNewComment(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onAddComment(); }}
          placeholder="Add a note... (Ctrl+Enter to save)"
          rows={2}
          className="flex-1 px-3 py-2 border border-stone-200 rounded-md text-sm resize-none focus:outline-none focus:border-brand-500"/>
        <button onClick={onAddComment} disabled={!newComment.trim()}
          className="px-3 self-stretch bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white rounded-md flex items-center justify-center">
          <Send size={14}/>
        </button>
      </div>

      <div className="space-y-2.5">
        {events.map(event => (
          <ActivityEvent key={event.id} event={event} userMap={userMap} onDeleteComment={onDeleteComment} />
        ))}
      </div>
    </Section>
  );
}

function ActivityEvent({ event, userMap, onDeleteComment }) {
  const actor = event.actor && userMap[event.actor];
  const actorName = actor ? actor.name : (event.actor ? 'Former user' : 'System');
  const time = fmtDateTime(event.timestamp);

  if (event.type === 'note') {
    // System-generated notes (from the resubmission detector, future automation, etc.)
    // are styled differently so reps can tell at a glance what's machine vs. human.
    if (event.isSystem) {
      return (
        <div className="bg-stone-50 border border-stone-200 rounded-md p-3">
          <div className="flex items-center gap-1.5 text-xs mb-1">
            <RefreshCw size={11} className="text-stone-500"/>
            <span className="font-semibold text-stone-700">{event.authorName || 'System'}</span>
            <span className="text-stone-400">· {time}</span>
            <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 ml-auto">Auto</span>
          </div>
          <div className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">{event.text}</div>
        </div>
      );
    }

    return (
      <div className="bg-amber-50 border border-amber-100 rounded-md p-3 group">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 text-xs">
            <MessageSquare size={11} className="text-amber-700"/>
            <span className="font-semibold text-amber-900">{actorName}</span>
            <span className="text-stone-500">· {time}</span>
          </div>
          <button onClick={() => onDeleteComment(event.id)} className="text-amber-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity">
            <X size={12}/>
          </button>
        </div>
        <div className="text-sm text-stone-800 whitespace-pre-wrap">{event.text}</div>
      </div>
    );
  }

  if (event.type === 'resubmission') {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-3 px-1">
          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <RefreshCw size={12} className="text-blue-600"/>
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="text-sm text-stone-800 leading-snug">
              <span className="font-semibold">{actorName}</span>{' '}
              linked a new submission{event.source ? <> from <span className="font-medium">{event.source}</span></> : null}
              {event.matchedOn?.length > 0 && <span className="text-xs text-stone-500"> · matched on {event.matchedOn.join(' + ')}</span>}
            </div>
            <div className="text-xs text-stone-500 mt-0.5">{time}</div>
          </div>
        </div>
        {event.newComment && (
          <div className="ml-10 bg-blue-50 border border-blue-100 rounded-md p-3 text-sm text-stone-800 whitespace-pre-wrap">
            {event.newComment}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 px-1">
      <div className="w-7 h-7 rounded-full bg-stone-100 flex items-center justify-center shrink-0">
        <ActivityIcon type={event.type}/>
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="text-sm text-stone-800 leading-snug">
          {event.synthetic ? null : <span className="font-semibold">{actorName}</span>}
          {event.synthetic ? null : ' '}
          {renderEventText(event, userMap)}
        </div>
        <div className="text-xs text-stone-500 mt-0.5">{time}</div>
      </div>
    </div>
  );
}

function ActivityIcon({ type }) {
  const icons = {
    created:           <Sparkles size={12} className="text-emerald-600"/>,
    status_change:     <RefreshCw size={12} className="text-blue-600"/>,
    assignment_change: <User size={12} className="text-violet-600"/>,
    edited:            <Edit3 size={12} className="text-stone-600"/>,
    sales_request:     <ClipboardList size={12} className="text-orange-600"/>
  };
  return icons[type] || <ChevronDown size={12} className="text-stone-400"/>;
}

const FIELD_LABELS = {
  customerName: 'Customer Name', companyName: 'Company Name', contactEmail: 'Email', phone: 'Phone',
  comment: 'Customer Comment', branch: 'Branch', zip: 'ZIP',
  formTitle: 'Form Title', leadSource: 'Lead Source', dateSubmitted: 'Date Submitted',
  deal: 'Deal details', salesRequest: 'Sales Submittal'
};

function renderEventText(event, userMap) {
  switch (event.type) {
    case 'created':
      if (event.synthetic) return <>Lead created{event.source ? <> from <span className="font-medium">{event.source}</span></> : null}</>;
      return event.viaImport
        ? <>imported this lead from <span className="font-medium">{event.source || 'CSV'}</span></>
        : (event.source ? <>created this lead from <span className="font-medium">{event.source}</span></> : <>created this lead</>);

    case 'sales_request':
      return <>submitted the Sales Submittal{event.equipment ? <> for <span className="font-medium">{event.equipment}</span></> : null}</>;

    case 'status_change':
      return <>changed status from <span className="font-medium">{event.from}</span> to <span className="font-medium">{event.to}</span></>;

    case 'assignment_change': {
      const fromUser = event.from && userMap[event.from];
      const toUser   = event.to   && userMap[event.to];
      const fromName = fromUser && !fromUser.isSystem ? fromUser.name : null;
      const toName   = toUser   && !toUser.isSystem   ? toUser.name   : null;
      if (!fromName && toName)  return <>assigned this lead to <span className="font-medium">{toName}</span></>;
      if (fromName && !toName)  return <>unassigned this lead (was <span className="font-medium">{fromName}</span>)</>;
      if (fromName && toName)   return <>reassigned from <span className="font-medium">{fromName}</span> to <span className="font-medium">{toName}</span></>;
      return <>updated assignment</>;
    }

    case 'edited': {
      const labels = (event.changes || []).map(c => FIELD_LABELS[c.field] || c.field);
      if (labels.length === 1) return <>edited <span className="font-medium">{labels[0]}</span></>;
      if (labels.length === 2) return <>edited <span className="font-medium">{labels[0]}</span> and <span className="font-medium">{labels[1]}</span></>;
      return <>edited <span className="font-medium">{labels.length} fields</span> ({labels.join(', ')})</>;
    }

    default:
      return <>made a change</>;
  }
}

function PanelStalenessChip({ lead, staleness }) {
  const s = getStaleness(lead, staleness);
  if (!s.tracked) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-stone-400 font-semibold px-1.5">
        <Clock size={10}/> {formatAge(s.hours)} since activity
      </span>
    );
  }
  if (s.stale) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded bg-rose-100 text-rose-700">
        <AlertCircle size={10}/> Stale · {formatAge(s.hours)} idle
      </span>
    );
  }
  if (s.approaching) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-semibold px-2 py-1 rounded bg-amber-100 text-amber-700">
        <Clock size={10}/> Aging · {formatAge(s.hours)} idle
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-stone-500 font-semibold px-1.5">
      <Clock size={10}/> Fresh · {formatAge(s.hours)} idle
    </span>
  );
}

// The secondary sees this lead in their My Open alongside the assignee, but does
// not own it — Reports still counts the lead against the primary only. Optional,
// and blank on most leads, so it renders quietly when unset.
function SecondaryAssigneeRow({ lead, config, onChange }) {
  const users = (config.users || []).filter(u => !u.isSystem);
  const secondary = users.find(u => u.id === lead.secondaryAssignedTo);
  // Set, but the account is gone or the person is on leave.
  const orphaned = lead.secondaryAssignedTo && !secondary;

  // "None" is a real option here, not an absent value \u2014 clearing a secondary is a
  // thing people do, and it has to be reachable without a separate control.
  const options = [
    { value: '', label: '\u2014 None \u2014', italic: true },
    ...users
      .filter(u => u.id !== lead.assignedTo)
      .map(u => ({
        value: u.id,
        label: u.name,
        hint: u.onLeaveOfAbsence ? 'on leave' : undefined
      }))
  ];

  return (
    <div className="flex items-start gap-3 py-1">
      <UsersIcon size={14} className="text-stone-400 mt-0.5 shrink-0"/>
      <div className="text-xs text-stone-500 w-20 md:w-28 shrink-0 pt-0.5">Secondary</div>
      <div className="flex-1 min-w-0">
        <SearchableSelect
          value={lead.secondaryAssignedTo || ''}
          onChange={onChange}
          options={options}
          ariaLabel="Secondary assignee"
          searchPlaceholder="Search reps\u2026"
          renderTrigger={({ open }) => (
            <div className={`group w-full text-left -mx-2 px-2 py-1 rounded transition-colors flex items-center gap-2 min-w-0 ${
              open ? 'bg-brand-50' : 'hover:bg-brand-50'
            }`}>
              <span className={`text-sm flex-1 truncate ${secondary ? 'text-stone-800' : 'text-stone-400 italic'}`}>
                {secondary ? secondary.name : orphaned ? 'No longer available' : '\u2014 None \u2014'}
              </span>
              <span className={`text-[10px] uppercase tracking-widest transition-colors font-semibold inline-flex items-center gap-0.5 ${
                open ? 'text-brand-700' : 'text-stone-300 group-hover:text-brand-700'
              }`}>
                <Edit3 size={10}/> {secondary ? 'Change' : 'Add'}
              </span>
            </div>
          )}
        />
      </div>
    </div>
  );
}

function EditableAssignmentRow({ lead, config, onAssign }) {
  const assignedUser = config.users.find(u => u.id === lead.assignedTo);
  const isUnassigned = !assignedUser || assignedUser.isSystem;

  // The row itself is the trigger — no separate "editing" state. The picker owns
  // its own open/close, and an earlier version that kept both fought itself:
  // closing the panel without choosing left the row stuck in edit mode.
  return (
    <div className="flex items-start gap-3 py-1">
      <User size={14} className="text-stone-400 mt-0.5 shrink-0"/>
      <div className="text-xs text-stone-500 w-28 shrink-0 pt-1">Assigned To</div>
      <div className="flex-1 min-w-0">
        <SearchableSelect
          value={lead.assignedTo}
          onChange={onAssign}
          options={config.users
            .filter(u => u.isSystem || !u.onLeaveOfAbsence || u.id === lead.assignedTo)
            .map(u => ({
              value: u.id,
              label: u.isSystem ? '\u2014 Unassigned \u2014' : u.name,
              hint: u.onLeaveOfAbsence ? 'on leave' : undefined,
              italic: u.isSystem
            }))}
          ariaLabel="Assign this lead to"
          searchPlaceholder="Search reps\u2026"
          renderTrigger={({ open }) => (
            <div className={`group w-full text-left -mx-2 px-2 py-1 rounded transition-colors flex items-center gap-2 ${
              open ? 'bg-brand-50' : 'hover:bg-brand-50'
            }`}>
              <span className={`text-sm flex-1 truncate ${isUnassigned ? 'text-stone-400 italic' : 'text-stone-800'}`}>
                {isUnassigned ? '\u2014 Unassigned \u2014' : assignedUser.name}
              </span>
              <span className={`text-[10px] uppercase tracking-widest transition-colors font-semibold inline-flex items-center gap-0.5 ${
                open ? 'text-brand-500' : 'text-stone-300 group-hover:text-brand-500'
              }`}>
                <Edit3 size={10}/> Change
              </span>
            </div>
          )}
        />
      </div>
    </div>
  );
}

// The four length options, shared by the dialog and the manual entry form.
// `value` is only passed by the form, where the choice is a selection that sits
// there until submit; in the dialog a click commits immediately.
function WorkingWeeksChoices({ value, onChange, columns = 'grid-cols-2' }) {
  return (
    <div className={`grid ${columns} gap-2`}>
      {WORKING_WEEK_OPTIONS.map(w => {
        const until = workingDeadlineFrom(w);
        const active = value === w;
        return (
          <button key={w} type="button" onClick={() => onChange(w)}
            aria-pressed={active}
            className={`border rounded-md px-3 py-3 text-left transition-colors group ${
              active
                ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                : 'border-stone-200 hover:border-brand-400 hover:bg-brand-50'
            }`}>
            <div className={`font-display text-xl font-bold ${active ? 'text-brand-700' : 'text-stone-900 group-hover:text-brand-700'}`}>+{w}</div>
            <div className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold">
              {w === 1 ? '1 week' : `${w} weeks`}
            </div>
            <div className="text-xs text-stone-600 mt-1.5">through {fmtDate(until)}</div>
          </button>
        );
      })}
    </div>
  );
}

// Asked whenever a rep moves a single lead into Working. Cancelling abandons the
// status change entirely — a Working lead without a deadline is the thing this
// feature exists to prevent. Each option shows the real date so "+2" is never
// ambiguous about which day the lead comes back.
function WorkingWeeksModal({ leadName, current, onChoose, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
         onClick={onCancel} role="dialog" aria-modal="true" aria-label="Choose how long to work this lead">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200">
          <div className="font-display text-lg font-bold text-stone-900">
            {current ? 'Extend this lead' : 'How long are you working this lead?'}
          </div>
          <div className="text-sm text-stone-500 mt-1">
            {leadName ? <><span className="font-medium text-stone-700">{leadName}</span> stays active until the date you pick</> : 'The lead stays active until the date you pick'}
            {' '}&mdash; working it doesn&rsquo;t push the date back.
          </div>
        </div>

        <div className="p-4">
          <WorkingWeeksChoices onChange={onChoose}/>
        </div>

        {current && (
          <div className="px-5 pb-1 -mt-1 text-xs text-stone-500">
            Currently active through <span className="font-medium text-stone-700">{fmtDate(current)}</span>. Picking a new length restarts from today.
          </div>
        )}

        <div className="px-5 py-3 border-t border-stone-200 bg-stone-50 flex justify-end">
          <button onClick={onCancel}
            className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900 font-medium">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== PIPELINE: DASHBOARD PICKER ===================== */
// The first screen after sign-in. One card per step, in order, each opening that
// step's dashboard. Counts come from the same buckets the dashboards render, so
// "12 in Working" here is exactly the 12 rows on the other side of the click.
function StageHomeView({ stageLeads, config, currentUser, onOpen, openRequestCount = 0, onOpenRequests, openFinanceCount = 0, onOpenFinance }) {
  const mine = currentUser.role !== 'admin';
  return (
    <div className="max-w-6xl">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {PIPELINE_STAGES.map((stage, i) => {
          const list = stageLeads[stage.id] || [];
          const Icon = STAGE_ICONS[stage.id];
          const accent = STAGE_ACCENTS[stage.id];
          const stale = list.filter(l => isLeadStale(l, config.staleness)).length;
          const urgent = list.filter(l => scoreLead(l, config.scoringRules).tier === 'Urgent').length;
          const unassigned = list.filter(l => isUnassigned(l)).length;
          const won = list.filter(l => l.status === WON_STATUS).length;
          return (
            <button key={stage.id} type="button" onClick={() => onOpen(stage.view)}
              className="relative flex flex-col items-stretch text-left bg-white border border-stone-200 rounded-lg overflow-hidden hover:border-stone-400 hover:shadow-md transition-all group focus:outline-none focus:ring-2 focus:ring-brand-500">
              <div className={`h-1.5 shrink-0 ${accent.bar}`}/>
              <div className="p-5 flex-1">
                <div className="flex items-center justify-between">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center ${accent.soft}`}>
                    <Icon size={20} className={accent.text}/>
                  </div>
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-stone-500">Step {i + 1}</span>
                </div>
                <div className="font-display text-2xl font-bold text-stone-900 mt-4">{stage.label}</div>
                <div className="text-xs text-stone-500 mt-1 xl:min-h-[3.75rem] leading-relaxed">{stage.blurb}</div>
                <div className="flex items-end justify-between mt-4">
                  <div>
                    <div className="font-display text-5xl font-bold text-stone-900 leading-none">{list.length}</div>
                    <div className="text-[11px] text-stone-500 mt-1">
                      {mine
                        ? (stage.id === STAGE_INCOMING ? 'yours or unassigned' : 'assigned to you')
                        : (list.length === 1 ? 'lead' : 'leads')}
                    </div>
                  </div>
                  <ArrowRight size={18} className="text-stone-300 group-hover:text-brand-600 transition-colors mb-1"/>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-4 min-h-[1.5rem]">
                  {stage.id === STAGE_COMPLETED ? (
                    won > 0 && <HomeChip className="bg-emerald-50 text-emerald-700">{won} won</HomeChip>
                  ) : (
                    <>
                      {stale > 0 && <HomeChip className="bg-rose-50 text-rose-700">{stale} stale</HomeChip>}
                      {urgent > 0 && <HomeChip className="bg-brand-50 text-brand-700">{urgent} urgent</HomeChip>}
                      {stage.id === STAGE_INCOMING && unassigned > 0 && (
                        <HomeChip className="bg-stone-100 text-stone-700">{unassigned} unassigned</HomeChip>
                      )}
                      {stage.id === STAGE_SALES_REQUEST && openRequestCount > 0 && (
                        <span role="link" tabIndex={0}
                          onClick={e => { e.stopPropagation(); onOpenRequests && onOpenRequests(); }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onOpenRequests && onOpenRequests(); } }}
                          className="text-[11px] font-semibold px-2 py-0.5 rounded bg-orange-50 text-orange-700 hover:underline">
                          {openRequestCount} open request{openRequestCount === 1 ? '' : 's'}
                        </span>
                      )}
                      {stage.id === STAGE_SALES_REQUEST && openFinanceCount > 0 && (
                        <span role="link" tabIndex={0}
                          onClick={e => { e.stopPropagation(); onOpenFinance && onOpenFinance(); }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onOpenFinance && onOpenFinance(); } }}
                          className="text-[11px] font-semibold px-2 py-0.5 rounded bg-violet-50 text-violet-700 hover:underline">
                          {openFinanceCount} in finance
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="text-xs text-stone-500 mt-4 leading-relaxed">
        A lead is in exactly one step at a time. Changing its status moves it to the next step and out of the last one.
        Completed leads move to Archived after 30 days.
      </div>
    </div>
  );
}

function HomeChip({ className, children }) {
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${className}`}>{children}</span>;
}

/* ===================== PIPELINE: FORM FIELDS ===================== */
// One renderer for the field lists in src/lib/pipeline.js (deal, lost, sales
// submittal, back office), so each form is just "which list, which values".
function PipelineFieldInput({ field, value, onChange, error, idPrefix = 'f' }) {
  const cls = `w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:border-brand-500 bg-white ${
    error ? 'border-rose-400' : 'border-stone-200'
  }`;
  if (field.type === 'select') {
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)} className={cls}>
        <option value="">—</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === 'multi') {
    const picked = Array.isArray(value) ? value : [];
    const toggle = (o) => onChange(picked.includes(o) ? picked.filter(x => x !== o) : [...picked, o]);
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map(o => {
          const on = picked.includes(o);
          return (
            <button key={o} type="button" onClick={() => toggle(o)} aria-pressed={on}
              className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                on ? 'border-brand-500 bg-brand-50 text-brand-700 font-semibold' : 'border-stone-200 text-stone-600 hover:border-stone-400'
              }`}>
              {o}
            </button>
          );
        })}
      </div>
    );
  }
  if (field.type === 'textarea') {
    return <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={3}
      placeholder={field.placeholder} className={`${cls} resize-none`}/>;
  }
  const listId = field.suggestions ? `${idPrefix}-${field.key}-list` : undefined;
  return (
    <>
      <input type={field.type} value={value || ''} onChange={e => onChange(e.target.value)}
        min={field.type === 'number' ? 0 : undefined} list={listId}
        placeholder={field.placeholder} className={cls}/>
      {listId && (
        <datalist id={listId}>
          {field.suggestions.map(s => <option key={s} value={s}/>)}
        </datalist>
      )}
    </>
  );
}

// Display value for a stored answer; null when there is nothing to show.
function pipelineFieldDisplay(field, value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.length ? value.join(', ') : null;
  const v = String(value).trim();
  if (!v) return null;
  if (field.type === 'date') return fmtDate(`${v}T12:00:00`);
  return v;
}

function ModalShell({ label, icon: Icon, accent, title, subtitle, onCancel, footer, children, wide = true }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start md:items-center justify-center p-4 overflow-y-auto"
         onClick={onCancel} role="dialog" aria-modal="true" aria-label={label}>
      <div className={`bg-white rounded-lg ${wide ? 'max-w-2xl' : 'max-w-md'} w-full shadow-xl overflow-hidden my-4`}
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200 flex items-start gap-3">
          <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${accent.soft}`}>
            <Icon size={18} className={accent.text}/>
          </div>
          <div className="min-w-0">
            <div className="font-display text-lg font-bold text-stone-900">{title}</div>
            <div className="text-sm text-stone-500 mt-0.5">{subtitle}</div>
          </div>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto scrollbar-thin">{children}</div>
        <div className="px-5 py-3 border-t border-stone-200 bg-stone-50 flex items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

/* ===================== PIPELINE: SALES SUBMITTAL ===================== */
// Opened when a rep marks a Working lead Completed. Submitting saves the
// submittal on the lead, moves it to Sales Request and emails the back office.
// Store is the lead's branch — asked here too because the back office cannot
// act without it, and written back to the lead rather than stored twice. A lead
// sent back to Working keeps its last submittal, so doing it again starts from
// what was already filled in.
// With `newLead`, it is also how a sale that never went through the LMT gets
// entered: the form asks for the customer and the rep as well, and the lead is
// created straight into Sales Request.
function SalesRequestModal({ lead, config, busy, onSubmit, onCancel, newLead = false, currentUser = null }) {
  const [customer, setCustomer] = useState({
    customerName: '', companyName: '', phone: '', contactEmail: '',
    // Reps enter their own sales; an admin picks whose it was.
    assignedTo: currentUser && currentUser.role !== 'admin' ? currentUser.id : ''
  });
  const setCust = (k, v) => {
    setCustomer(c => ({ ...c, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };
  const [formState, setForm] = useState(() => {
    const prior = lead.salesRequest || {};
    const init = {};
    for (const f of SALES_REQUEST_FIELDS) init[f.key] = prior[f.key] ?? '';
    // Sensible starting answers, all editable.
    if (!init.customerName) init.customerName = lead.companyName || lead.customerName || '';
    if (!init.model && lead.deal?.model) init.model = lead.deal.model;
    for (const k of ['rebate', 'drSubmission', 'spiff', 'trade']) if (!init[k]) init[k] = 'No';
    if (!init.specialization) init.specialization = 'None';
    return init;
  });
  const [branch, setBranch] = useState(lead.branch || '');
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  const submit = () => {
    // A walk-in's paperwork name defaults to the company (or contact) typed above.
    const form = (newLead && !String(formState.customerName || '').trim())
      ? { ...formState, customerName: (customer.companyName || customer.customerName).trim() }
      : formState;
    const errs = validateSalesRequest(form);
    if (!branch) errs.branch = 'Required';
    if (newLead) {
      if (!customer.customerName.trim() && !customer.companyName.trim()) errs.customerName = 'Contact or company required';
      if (!customer.phone.trim() && !customer.contactEmail.trim()) errs.phone = 'Phone or email required';
      if (!customer.assignedTo) errs.assignedTo = 'Required';
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const pruned = pruneHiddenAnswers(SALES_REQUEST_FIELDS, form);
    const clean = {};
    for (const f of SALES_REQUEST_FIELDS) clean[f.key] = String(pruned[f.key] ?? '').trim();
    // Back-office answers survive a resubmission.
    if (lead.salesRequest?.backOffice) clean.backOffice = lead.salesRequest.backOffice;
    if (newLead) {
      const c = Object.fromEntries(Object.entries(customer).map(([k, v]) => [k, String(v).trim()]));
      if (!clean.customerName) clean.customerName = c.companyName || c.customerName;
      onSubmit(clean, { branch }, c, files);
      return;
    }
    onSubmit(clean, branch !== lead.branch ? { branch } : {}, null, files);
  };

  const accent = STAGE_ACCENTS[STAGE_SALES_REQUEST];
  return (
    <ModalShell label="Sales submittal" icon={ClipboardList} accent={accent} onCancel={() => { if (!busy) onCancel(); }}
      title={newLead ? 'New Sales Submittal' : 'Sales Submittal'}
      subtitle={newLead
        ? <>For a sale that didn&rsquo;t come through the LMT. Creates the lead in Sales Request and emails the back office.</>
        : <>Submitting moves <span className="font-medium text-stone-700">{lead.customerName || lead.companyName || 'this lead'}</span> to Sales Request and emails the back office.</>}
      footer={<>
        <button onClick={onCancel} disabled={busy}
          className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900 font-medium disabled:opacity-50">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-md flex items-center gap-2 disabled:opacity-60">
          <Send size={14}/> {busy ? 'Sending…' : 'Submit to Back Office'}
        </button>
      </>}>
      {newLead ? (
        <div>
          <div className="text-[10px] uppercase tracking-widest font-semibold text-stone-500 mb-2 pb-1 border-b border-stone-100">Customer</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
            {[['customerName', 'Contact Name', 'text'], ['companyName', 'Company', 'text'],
              ['phone', 'Phone', 'tel'], ['contactEmail', 'Email', 'email']].map(([k, label, type]) => (
              <Field key={k} label={label} error={errors[k]}>
                <input type={type} value={customer[k]} onChange={e => setCust(k, e.target.value)}
                  className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:border-brand-500 ${errors[k] ? 'border-rose-400' : 'border-stone-200'}`}/>
              </Field>
            ))}
            <Field label="Sales Rep" required error={errors.assignedTo}>
              <select value={customer.assignedTo} onChange={e => setCust('assignedTo', e.target.value)}
                disabled={currentUser?.role !== 'admin'}
                className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:border-brand-500 bg-white disabled:bg-stone-50 ${errors.assignedTo ? 'border-rose-400' : 'border-stone-200'}`}>
                <option value="">Choose a rep…</option>
                {(config.users || []).filter(u => !u.isSystem).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          </div>
        </div>
      ) : (
        <div className="bg-stone-50 border border-stone-200 rounded-md px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div><span className="text-stone-500">Contact:</span> <span className="font-medium text-stone-900">{lead.customerName || '—'}</span></div>
          <div><span className="text-stone-500">Company:</span> <span className="text-stone-900">{lead.companyName || '—'}</span></div>
          <div><span className="text-stone-500">Phone:</span> <span className="font-mono text-stone-900">{lead.phone || '—'}</span></div>
          <div className="truncate"><span className="text-stone-500">Email:</span> <span className="text-stone-900">{lead.contactEmail || '—'}</span></div>
        </div>
      )}

      {SALES_REQUEST_SECTIONS.map(section => {
        const fields = SALES_REQUEST_FIELDS.filter(f => f.section === section && isFieldShown(f, formState));
        return (
          <div key={section}>
            <div className="text-[10px] uppercase tracking-widest font-semibold text-stone-500 mb-2 pb-1 border-b border-stone-100">{section}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
              {section === 'Unit' && (
                <Field label="Store" required error={errors.branch}>
                  <select value={branch} onChange={e => { setBranch(e.target.value); if (errors.branch) setErrors(er => ({ ...er, branch: undefined })); }}
                    className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:border-brand-500 bg-white ${errors.branch ? 'border-rose-400' : 'border-stone-200'}`}>
                    <option value="">Choose a store…</option>
                    {(config.branches || []).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </Field>
              )}
              {fields.map(f => (
                <div key={f.key} className={f.type === 'textarea' ? 'md:col-span-2' : ''}>
                  <Field label={f.label} required={f.required} error={errors[f.key]}>
                    <PipelineFieldInput field={f} value={formState[f.key]} onChange={v => set(f.key, v)} error={errors[f.key]} idPrefix="sr"/>
                  </Field>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <AttachmentStager files={files} onChange={setFiles} label="Paperwork"
        hint="Signed sales agreement, credit application, quote — anything the back office needs."/>
    </ModalShell>
  );
}

// Asked when a single lead is set to Lost.
function LostDealModal({ lead, onSubmit, onCancel }) {
  const [form, setForm] = useState({ lostReason: '', competitor: lead.deal?.competitor || '' });
  const [errors, setErrors] = useState({});
  const submit = () => {
    const errs = {};
    for (const f of LOST_FIELDS) if (f.required && !String(form[f.key] || '').trim()) errs[f.key] = 'Required';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSubmit({ lostReason: form.lostReason.trim(), competitor: (form.competitor || '').trim() });
  };
  return (
    <ModalShell label="Lost deal" icon={X} accent={{ soft: 'bg-rose-50', text: 'text-rose-700' }} wide={false} onCancel={onCancel}
      title="Mark as Lost"
      subtitle={<><span className="font-medium text-stone-700">{lead.customerName || lead.companyName || 'This lead'}</span> moves to Completed.</>}
      footer={<>
        <button onClick={onCancel} className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900 font-medium">Cancel</button>
        <button onClick={submit} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold rounded-md">Mark Lost</button>
      </>}>
      {LOST_FIELDS.map(f => (
        <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
          <PipelineFieldInput field={f} value={form[f.key]} error={errors[f.key]}
            onChange={v => { setForm(x => ({ ...x, [f.key]: v })); if (errors[f.key]) setErrors(e => ({ ...e, [f.key]: undefined })); }}/>
        </Field>
      ))}
    </ModalShell>
  );
}

/* ===================== PIPELINE: DEAL SECTION ===================== */
// What the customer wants, recorded while the lead is worked. One section on
// every lead — Indy's tracker uses the same columns whatever the status.
function DealSection({ lead, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lead.deal || {});
  useEffect(() => { setDraft(lead.deal || {}); setEditing(false); }, [lead.id]);

  const deal = lead.deal || {};
  const shown = DEAL_FIELDS.map(f => [f, pipelineFieldDisplay(f, deal[f.key])]).filter(([, v]) => v);

  if (editing) {
    return (
      <Section title="Deal">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3 pt-1">
          {DEAL_FIELDS.map(f => (
            <div key={f.key} className={f.type === 'multi' ? 'sm:col-span-2' : ''}>
              <Field label={f.label}>
                <PipelineFieldInput field={f} value={draft[f.key]} idPrefix="deal"
                  onChange={v => setDraft(d => ({ ...d, [f.key]: v }))}/>
              </Field>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={() => { onUpdate(lead.id, { deal: { ...(lead.deal || {}), ...draft } }); setEditing(false); }}
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-md">Save Deal</button>
          <button onClick={() => { setDraft(lead.deal || {}); setEditing(false); }}
            className="px-3 py-1.5 text-stone-600 hover:text-stone-900 text-xs">Cancel</button>
        </div>
      </Section>
    );
  }

  return (
    <Section title={
      <span className="flex items-center justify-between w-full">
        <span>Deal</span>
        <button onClick={() => setEditing(true)} className="normal-case tracking-normal text-xs font-medium text-brand-700 hover:underline inline-flex items-center gap-1">
          <Edit3 size={11}/> {shown.length ? 'Edit' : 'Add deal details'}
        </button>
      </span>
    }>
      {shown.length === 0 && !deal.lostReason && (
        <div className="text-xs text-stone-400">What they want, the model, whether it&rsquo;s been quoted.</div>
      )}
      {shown.map(([f, v]) => <DetailRow key={f.key} icon={Tag} label={f.label} value={v}/>)}
      {deal.lostReason && (
        <div className="text-sm text-rose-800 bg-rose-50 p-3 rounded-md border border-rose-100 whitespace-pre-wrap leading-relaxed mt-1">
          <span className="font-semibold">Lost: </span>{deal.lostReason}
        </div>
      )}
    </Section>
  );
}

// The submittal on the lead: what the rep sent, and the back office's fields.
// Shown from Sales Request onwards so the record of the sale stays with the lead.
// Admins (the back office) edit their fields here and close the submittal out.
function SalesRequestSection({ lead, config, currentUser, onUpdate, onStatusChange }) {
  const sr = lead.salesRequest;
  const isAdmin = currentUser?.role === 'admin';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState((sr && sr.backOffice) || {});
  useEffect(() => { setDraft((lead.salesRequest && lead.salesRequest.backOffice) || {}); setEditing(false); }, [lead.id]);
  if (!sr) return null;

  const submitter = (config.users || []).find(u => u.id === sr.submittedBy);
  const bo = sr.backOffice || {};
  const inSalesRequest = lead.status === SALES_REQUEST_STATUS;

  const saveBackOffice = (extra = {}) => {
    const backOffice = pruneHiddenAnswers(BACK_OFFICE_FIELDS, { ...draft });
    onUpdate(lead.id, { salesRequest: { ...sr, backOffice }, _salesRequestEdit: true, ...extra });
    setEditing(false);
  };

  return (
    <Section title="Sales Submittal">
      <DetailRow icon={Building} label="Store" value={lead.branch}/>
      {SALES_REQUEST_SECTIONS.map(section => {
        const rows = SALES_REQUEST_FIELDS
          .filter(f => f.section === section && f.type !== 'textarea')
          .map(f => [f, pipelineFieldDisplay(f, sr[f.key])])
          .filter(([, v]) => v);
        return rows.map(([f, v]) => <DetailRow key={f.key} icon={FileText} label={f.label} value={v}/>);
      })}
      {sr.notes && (
        <div className="text-sm text-stone-700 bg-stone-50 p-3 rounded-md border border-stone-100 whitespace-pre-wrap leading-relaxed mt-1">
          {sr.notes}
        </div>
      )}
      <div className="text-[11px] text-stone-500 pt-1">
        Submitted {fmtDateTime(sr.submittedAt)}{submitter ? ` by ${submitter.name}` : ''}
      </div>

      {/* ---- Back office ---- */}
      <div className="mt-3 pt-3 border-t border-stone-100">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold">Back Office</div>
          {isAdmin && !editing && (
            <button onClick={() => setEditing(true)} className="text-xs font-medium text-brand-700 hover:underline inline-flex items-center gap-1">
              <Edit3 size={11}/> Edit
            </button>
          )}
        </div>
        {editing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3">
              {BACK_OFFICE_FIELDS.filter(f => isFieldShown(f, draft)).map(f => (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <Field label={f.label}>
                    <PipelineFieldInput field={f} value={draft[f.key]} idPrefix="bo"
                      onChange={v => setDraft(d => ({ ...d, [f.key]: v }))}/>
                  </Field>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-3">
              <button onClick={() => saveBackOffice()}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-md">Save</button>
              <button onClick={() => { setDraft(bo); setEditing(false); }}
                className="px-3 py-1.5 text-stone-600 hover:text-stone-900 text-xs">Cancel</button>
            </div>
          </>
        ) : (
          <>
            {BACK_OFFICE_FIELDS.map(f => {
              const v = pipelineFieldDisplay(f, bo[f.key]);
              if (!v) return null;
              return f.type === 'textarea'
                ? <div key={f.key} className="text-sm text-stone-700 bg-stone-50 p-3 rounded-md border border-stone-100 whitespace-pre-wrap mt-1"><span className="font-semibold">{f.label}: </span>{v}</div>
                : <DetailRow key={f.key} icon={FileText} label={f.label} value={v}/>;
            })}
            {!BACK_OFFICE_FIELDS.some(f => pipelineFieldDisplay(f, bo[f.key])) && (
              <div className="text-xs text-stone-400">{isAdmin ? 'Nothing recorded yet.' : 'The back office hasn’t recorded anything yet.'}</div>
            )}
          </>
        )}
        {isAdmin && inSalesRequest && !editing && (
          <button
            onClick={() => {
              if (!window.confirm('Mark this submittal complete? The lead moves to Completed.')) return;
              const today = new Date().toISOString().slice(0, 10);
              const backOffice = { ...bo, completionDate: bo.completionDate || today };
              onUpdate(lead.id, { status: WON_STATUS, salesRequest: { ...sr, backOffice } });
            }}
            className="mt-3 w-full px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-md inline-flex items-center justify-center gap-1.5">
            <CheckCircle2 size={13}/> Mark Submittal Complete
          </button>
        )}
      </div>
    </Section>
  );
}

// Underline tabs above a view (Incoming | Junk, Completed | Archived, Settings).
function SubTabs({ value, onChange, tabs }) {
  return (
    <div className="flex gap-1 border-b border-stone-200 mb-4 overflow-x-auto" role="tablist">
      {tabs.map(([k, label, n]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
            value === k ? 'border-brand-600 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}>
          {label}{n !== undefined && <span className="ml-1.5 font-mono text-xs text-stone-400">{n}</span>}
        </button>
      ))}
    </div>
  );
}

/* ===================== ATTACHMENTS ===================== */
// AttachmentStager: pick files inside a form before it's submitted (they
// upload once the record exists). AttachmentList: the files already on a lead
// or record — open, add more, remove. Limits: checkAttachment in pipeline.js.

function AttachmentStager({ files, onChange, label = 'Attachments', hint }) {
  const [errors, setErrors] = useState([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const add = (list) => {
    const incoming = Array.from(list || []);
    const bad = [];
    const good = [];
    for (const f of incoming) {
      const why = checkAttachment(f);
      if (why) bad.push(`${f.name}: ${why}`); else good.push(f);
    }
    const next = [...files, ...good].slice(0, ATTACHMENT_MAX_FILES);
    if (files.length + good.length > ATTACHMENT_MAX_FILES) bad.push(`Up to ${ATTACHMENT_MAX_FILES} files at a time`);
    setErrors(bad);
    onChange(next);
  };
  return (
    <Field label={label}>
      {hint && <div className="text-xs text-stone-500 mb-2 -mt-0.5">{hint}</div>}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        onClick={() => inputRef.current && inputRef.current.click()}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current && inputRef.current.click(); } }}
        className={`border-2 border-dashed rounded-md px-4 py-4 text-center cursor-pointer transition-colors ${
          drag ? 'border-brand-500 bg-brand-50' : 'border-stone-300 hover:border-stone-400 bg-white'
        }`}>
        <Upload size={18} className="mx-auto text-stone-400"/>
        <div className="text-sm font-medium text-stone-700 mt-1">Drop files here or <span className="text-brand-700 underline">browse</span></div>
        <div className="text-[11px] text-stone-400 mt-0.5">Photos, PDFs, Office documents · up to {ATTACHMENT_MAX_BYTES / 1024 / 1024} MB each</div>
        <input ref={inputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden"
          onChange={e => { add(e.target.files); e.target.value = ''; }}/>
      </div>
      {errors.map(er => <div key={er} className="text-xs text-rose-700 mt-1">{er}</div>)}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-sm bg-stone-50 border border-stone-200 rounded px-2.5 py-1.5">
              <span className="truncate flex items-center gap-1.5"><FileText size={13} className="text-stone-400 shrink-0"/>{f.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-stone-400">{formatBytes(f.size)}</span>
                <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}
                  className="text-stone-400 hover:text-rose-600" aria-label={`Remove ${f.name}`}><X size={13}/></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

// Files already saved. `onAdd(files)` uploads more; `onRemove(att)` deletes one
// (offered to its uploader and to admins).
function AttachmentList({ attachments = [], currentUser, onAdd, onRemove, emptyText = 'No files yet.', compact = false }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const isAdmin = currentUser?.role === 'admin';
  const open = async (att) => {
    // Open the tab synchronously (popup blockers), then point it at the file.
    const w = window.open('', '_blank');
    try {
      const url = await attachmentUrl(att.path);
      if (w) w.location = url; else window.location.href = url;
    } catch (e) {
      if (w) w.close();
      setErr('Could not open that file.');
    }
  };
  const pick = async (list) => {
    const files = Array.from(list || []);
    const bad = files.map(f => [f, checkAttachment(f)]).filter(([, why]) => why);
    const good = files.filter(f => !checkAttachment(f)).slice(0, ATTACHMENT_MAX_FILES);
    setErr(bad.map(([f, why]) => `${f.name}: ${why}`).join(' · '));
    if (!good.length || !onAdd) return;
    setBusy(true);
    try { await onAdd(good); } finally { setBusy(false); }
  };
  const sorted = [...attachments].sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  return (
    <div>
      {sorted.length === 0 && <div className="text-xs text-stone-400">{emptyText}</div>}
      <ul className="space-y-1">
        {sorted.map(att => (
          <li key={att.id} className="flex items-center justify-between gap-2 text-sm">
            <button type="button" onClick={() => open(att)} className="truncate text-left text-brand-700 hover:underline flex items-center gap-1.5 min-w-0">
              <FileText size={13} className="text-stone-400 shrink-0"/><span className="truncate">{att.name}</span>
            </button>
            <span className="flex items-center gap-2 shrink-0">
              {att.category === 'submittal' && !compact && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">Submittal</span>
              )}
              <span className="text-[11px] text-stone-400">{formatBytes(att.size)}</span>
              {onRemove && (isAdmin || att.uploadedBy === currentUser?.id) && (
                <button type="button" aria-label={`Remove ${att.name}`} className="text-stone-400 hover:text-rose-600"
                  onClick={() => { if (window.confirm(`Remove ${att.name}?`)) onRemove(att); }}>
                  <X size={13}/>
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {onAdd && (
        <>
          <button type="button" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}
            className="mt-2 text-xs font-medium text-brand-700 hover:underline inline-flex items-center gap-1 disabled:opacity-50">
            <Upload size={11}/> {busy ? 'Uploading…' : 'Add files'}
          </button>
          <input ref={inputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden"
            onChange={e => { pick(e.target.files); e.target.value = ''; }}/>
        </>
      )}
      {err && <div className="text-xs text-rose-700 mt-1">{err}</div>}
    </div>
  );
}

/* ===================== INDY RECORDS: shared pieces ===================== */
// Requests, trade-in evaluations and finance deals share one pattern: a form
// the rep submits (a modal), a list the back office / manager / finance team
// works (rows expand to show everything plus the fields only they edit), and a
// short section on the lead. The field lists live in src/lib/pipeline.js.

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtYmd = (v) => (v ? fmtDate(`${String(v).slice(0, 10)}T12:00:00`) : '—');

// Renders a field list in a two-column grid. `shown` decides visibility (the
// submittal-style showIf by default); ratings and long fields span both columns.
function FieldGrid({ fields, values, onChange, errors = {}, idPrefix, shown = (f, v) => isFieldShown(f, v), users = [] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
      {fields.filter(f => shown(f, values)).map(f => (
        <div key={f.key} className={['textarea', 'multi', 'radio'].includes(f.type) ? 'md:col-span-2' : ''}>
          <Field label={f.label} required={f.required} error={errors[f.key]}>
            <RecordFieldInput field={f} value={values[f.key]} error={errors[f.key]} idPrefix={idPrefix} users={users}
              onChange={v => onChange(f.key, v)}/>
          </Field>
        </div>
      ))}
    </div>
  );
}

// PipelineFieldInput plus the extra types the Smartsheet forms use: radio
// (one of a short list, shown as buttons), rating (1–5 or N/A) and user.
function RecordFieldInput({ field, value, onChange, error, idPrefix, users = [] }) {
  if (field.type === 'radio' || field.type === 'rating') {
    const rating = field.type === 'rating';
    return (
      <div className={`flex flex-wrap gap-1.5 ${error ? 'ring-1 ring-rose-300 rounded-md p-1' : ''}`} role="radiogroup">
        {field.options.map(o => {
          const on = String(value ?? '') === o;
          return (
            <button key={o} type="button" role="radio" aria-checked={on} onClick={() => onChange(on && !field.required ? '' : o)}
              className={`text-sm rounded-md border transition-colors ${rating ? 'w-11 py-1.5 font-semibold' : 'px-3 py-1.5'} ${
                on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 text-stone-700 hover:border-stone-400'
              }`}>
              {o}
            </button>
          );
        })}
      </div>
    );
  }
  if (field.type === 'user') {
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:border-brand-500 bg-white ${error ? 'border-rose-400' : 'border-stone-200'}`}>
        <option value="">Choose…</option>
        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    );
  }
  return <PipelineFieldInput field={field} value={value} onChange={onChange} error={error} idPrefix={idPrefix}/>;
}

// Read-only rows for a field list, skipping blanks.
function FieldRows({ fields, values, users = [] }) {
  const rows = fields.map(f => {
    let v = values ? values[f.key] : undefined;
    if (f.type === 'user') v = users.find(u => u.id === v)?.name;
    const shownV = f.type === 'date' ? (v ? fmtYmd(v) : null) : pipelineFieldDisplay(f, v);
    return shownV ? [f, shownV] : null;
  }).filter(Boolean);
  if (!rows.length) return <div className="text-xs text-stone-400">Nothing recorded.</div>;
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[minmax(0,11rem)_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([f, v]) => (
        <Fragment key={f.key}>
          <dt className="text-stone-500">{f.label}</dt>
          <dd className="text-stone-900 whitespace-pre-wrap break-words">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

// The part of an expanded row only the handling team edits (admins).
function AdminFieldsEditor({ title, fields, values, onSave, canEdit, idPrefix }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values || {});
  useEffect(() => { if (!editing) setDraft(values || {}); }, [values, editing]);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold">{title}</div>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs font-medium text-brand-700 hover:underline inline-flex items-center gap-1">
            <Edit3 size={11}/> Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <FieldGrid fields={fields} values={draft} idPrefix={idPrefix}
            onChange={(k, v) => setDraft(d => ({ ...d, [k]: v }))}/>
          <div className="flex gap-2 pt-3">
            <button onClick={async () => { const ok = await onSave(pruneHiddenAnswers(fields, draft)); if (ok !== false) setEditing(false); }}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-md">Save</button>
            <button onClick={() => { setDraft(values || {}); setEditing(false); }}
              className="px-3 py-1.5 text-stone-600 hover:text-stone-900 text-xs">Cancel</button>
          </div>
        </>
      ) : (
        <FieldRows fields={fields} values={values || {}}/>
      )}
    </div>
  );
}

function RecordListTabs({ tabs, value, onChange, onNew, newLabel }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <div className="inline-flex rounded-md border border-stone-200 bg-white p-0.5">
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => onChange(k)}
            className={`text-xs font-medium px-3 py-1.5 rounded ${value === k ? 'bg-stone-900 text-white' : 'text-stone-600 hover:text-stone-900'}`}>
            {label} <span className="font-mono opacity-70">{n}</span>
          </button>
        ))}
      </div>
      <button onClick={onNew}
        className="text-xs px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-md inline-flex items-center gap-1.5">
        <Plus size={13}/> {newLabel}
      </button>
    </div>
  );
}

function LeadSummaryBox({ lead }) {
  if (!lead) return null;
  return (
    <div className="bg-stone-50 border border-stone-200 rounded-md px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <div><span className="text-stone-500">Customer:</span> <span className="font-medium text-stone-900">{lead.companyName || lead.customerName || '—'}</span></div>
      <div><span className="text-stone-500">Phone:</span> <span className="font-mono text-stone-900">{lead.phone || '—'}</span></div>
      {(lead.salesRequest?.model || lead.deal?.model) && (
        <div><span className="text-stone-500">Unit:</span> <span className="text-stone-900">{lead.salesRequest?.model || lead.deal?.model}</span></div>
      )}
      {lead.branch && <div><span className="text-stone-500">Branch:</span> <span className="text-stone-900">{lead.branch}</span></div>}
    </div>
  );
}

const leadName = (lead) => (lead ? (lead.companyName || lead.customerName || 'Lead') : null);

function RecordCustomerCell({ rec, lead, onOpenLead }) {
  if (lead) {
    return (
      <button onClick={e => { e.stopPropagation(); onOpenLead(lead); }} className="text-left font-medium text-stone-900 hover:text-brand-700 hover:underline"
        title="Open the lead">
        {rec.customerName || leadName(lead)}
      </button>
    );
  }
  return (
    <>
      <span className="text-stone-900">{rec.customerName || '—'}</span>
      <div className="text-[10px] uppercase tracking-wider text-stone-400 mt-0.5">No lead</div>
    </>
  );
}

/* ===================== SALES REQUESTS (operations) ===================== */
// Indy's "Sales Request" form: delivery, demo, get-ready, parts, pick-up and
// service requests to the back office. The back office checks each involved
// department off (Rental / Service / Parts); the request completes when all
// have. Separate from the Sales Submittal (the deal paperwork).

const REQUEST_STATUS_STYLES = {
  'Open':        'bg-blue-50 text-blue-700',
  'In Progress': 'bg-amber-50 text-amber-700',
  'Completed':   'bg-emerald-50 text-emerald-700',
  'Cancelled':   'bg-stone-100 text-stone-600'
};

function RequestModal({ lead, config, currentUser, busy, onSubmit, onCancel }) {
  const users = (config.users || []).filter(u => !u.isSystem);
  const [form, setForm] = useState(() => ({
    requestDate: todayYmd(),
    salesPerson: lead && !isUnassigned(lead) ? lead.assignedTo : (currentUser?.id || ''),
    requestTypes: [],
    fromLocation: lead ? fromLocationForBranch(lead.branch) : '',
    toLocation: lead ? EXTERNAL_LOCATION : '',
    customerName: lead ? (lead.companyName || lead.customerName || '') : '',
    customerAddress: '',
    dateNeeded: '',
    equipmentRequest: lead ? (lead.salesRequest?.model || lead.deal?.model || '') : '',
    serviceRequest: '', partsRequest: '', comments: ''
  }));
  const [errors, setErrors] = useState({});
  const [files, setFiles] = useState([]);
  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };
  const submit = () => {
    const errs = validateRequest(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const pruned = pruneRequest(form);
    const clean = {};
    for (const f of REQUEST_FIELDS) clean[f.key] = Array.isArray(pruned[f.key]) ? pruned[f.key] : String(pruned[f.key] ?? '').trim();
    onSubmit(clean, files);
  };
  return (
    <ModalShell label="Sales request" icon={Send} accent={STAGE_ACCENTS[STAGE_SALES_REQUEST]} onCancel={() => { if (!busy) onCancel(); }}
      title="Sales Request"
      subtitle={lead
        ? <>For <span className="font-medium text-stone-700">{leadName(lead)}</span> — emailed to the back office.</>
        : 'Delivery, demo, get ready, parts, pick up or service — emailed to the back office.'}
      footer={<>
        <button onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900 font-medium disabled:opacity-50">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-md flex items-center gap-2 disabled:opacity-60">
          <Send size={14}/> {busy ? 'Sending…' : 'Submit Request'}
        </button>
      </>}>
      <LeadSummaryBox lead={lead}/>
      <FieldGrid fields={REQUEST_FIELDS} values={form} errors={errors} onChange={set} idPrefix="rq" users={users}
        shown={(f, v) => isRequestFieldShown(f, v)}/>
      <AttachmentStager files={files} onChange={setFiles} label="File Upload"
        hint="Please include any documents related to this request."/>
    </ModalShell>
  );
}

function RequestStatusControl({ req, isAdmin, onUpdate }) {
  const options = requestStatusOptionsFor(req.status, isAdmin);
  const cls = REQUEST_STATUS_STYLES[req.status] || REQUEST_STATUS_STYLES.Open;
  if (options.length <= 1) {
    return <span className={`inline-block text-xs font-medium px-2 py-1 rounded ${cls}`}>{req.status}</span>;
  }
  return (
    <select value={req.status} onClick={e => e.stopPropagation()}
      onChange={e => {
        const next = e.target.value;
        if (next === 'Cancelled' && !window.confirm('Cancel this request?')) return;
        onUpdate(req.id, { status: next });
      }}
      className={`text-xs font-medium px-2 py-1 rounded border border-transparent hover:border-stone-300 cursor-pointer ${cls}`}>
      {options.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// Rental / Service / Parts check-offs. Departments the request's types don't
// need are shown faded but can still be ticked (the sheet often has all three).
function DepartmentCheckoffs({ req, canEdit, onUpdate }) {
  const needed = departmentsFor(req.requestTypes);
  const done = req.done || {};
  return (
    <div className="flex flex-wrap gap-1.5" onClick={e => e.stopPropagation()}>
      {REQUEST_DEPARTMENTS.map(d => {
        const on = !!done[d.key];
        const need = needed.includes(d.key);
        return (
          <label key={d.key} title={need ? `${d.label} is needed for this request` : `${d.label} not needed for these request types`}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border ${
              on ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : need ? 'bg-white border-stone-300 text-stone-700' : 'bg-white border-stone-200 text-stone-400'
            } ${canEdit ? 'cursor-pointer' : ''}`}>
            <input type="checkbox" checked={on} disabled={!canEdit} className="accent-emerald-600"
              onChange={() => onUpdate(req.id, { done: { ...done, [d.key]: !on } })}/>
            {d.label}
          </label>
        );
      })}
    </div>
  );
}

function RequestsView({ requests, leads, config, currentUser, onUpdate, onOpenLead, onNew, onAddFiles, onRemoveFile }) {
  const isAdmin = currentUser?.role === 'admin';
  const [show, setShow] = useState('open');
  const [openId, setOpenId] = useState(null);
  const users = config.users || [];
  const userMap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const leadMap = useMemo(() => Object.fromEntries(leads.map(l => [l.id, l])), [leads]);
  const today = todayYmd();
  const isOpen = (r) => OPEN_REQUEST_STATUSES.includes(r.status);

  const rows = useMemo(() => {
    const list = requests.filter(r => show === 'all' || (show === 'open' ? isOpen(r) : !isOpen(r)));
    return [...list].sort((a, b) => show === 'open'
      ? (a.dateNeeded || '9999').localeCompare(b.dateNeeded || '9999')
      : (b.dateNeeded || '').localeCompare(a.dateNeeded || ''));
  }, [requests, show]);

  return (
    <div>
      <RecordListTabs value={show} onChange={setShow} onNew={onNew} newLabel="New Sales Request"
        tabs={[['open', 'Open', requests.filter(isOpen).length],
               ['closed', 'Completed / Cancelled', requests.filter(r => !isOpen(r)).length],
               ['all', 'All', requests.length]]}/>
      {rows.length === 0 ? (
        <EmptyState icon={Send} title={show === 'open' ? 'No open sales requests' : 'Nothing here'}
          subtitle="Deliveries, demos, get-readies, parts, pick-ups and service requests. Add one from a lead, or with New Sales Request."/>
      ) : (
        <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-stone-200 text-left text-[10px] uppercase tracking-widest text-stone-500">
                <th className="px-3 py-2.5 font-semibold">Needed By</th>
                <th className="px-3 py-2.5 font-semibold">Request</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 font-semibold">From → To</th>
                <th className="px-3 py-2.5 font-semibold">Sales Person</th>
                <th className="px-3 py-2.5 font-semibold">Departments</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const lead = r.leadId ? leadMap[r.leadId] : null;
                const overdue = isOpen(r) && r.dateNeeded && r.dateNeeded < today;
                const expanded = openId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => setOpenId(expanded ? null : r.id)}
                      className={`border-b border-stone-100 align-top cursor-pointer hover:bg-stone-50 ${expanded ? 'bg-stone-50' : ''}`}>
                      <td className={`px-3 py-3 whitespace-nowrap font-mono text-xs ${overdue ? 'text-rose-700 font-semibold' : 'text-stone-700'}`}>
                        {fmtYmd(r.dateNeeded)}
                        {overdue && <div className="text-[10px] font-sans uppercase tracking-wider">Overdue</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(r.requestTypes || []).map(t => (
                            <span key={t} className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">{t}</span>
                          ))}
                        </div>
                        {r.equipmentRequest && <div className="text-xs text-stone-500 mt-1 line-clamp-2 max-w-xs whitespace-pre-line">{r.equipmentRequest}</div>}
                      </td>
                      <td className="px-3 py-3"><RecordCustomerCell rec={r} lead={lead} onOpenLead={onOpenLead}/></td>
                      <td className="px-3 py-3 text-xs text-stone-700">
                        <div className="whitespace-nowrap">{r.fromLocation || '—'}</div>
                        {r.toLocation && <div className="whitespace-nowrap text-stone-500">→ {r.toLocation}</div>}
                      </td>
                      <td className="px-3 py-3 text-xs text-stone-700 whitespace-nowrap">
                        {userMap[r.salesPerson]?.name || '—'}
                        <div className="text-[10px] text-stone-400">requested {fmtYmd(r.requestDate)}</div>
                      </td>
                      <td className="px-3 py-3"><DepartmentCheckoffs req={r} canEdit={isAdmin && r.status !== 'Cancelled'} onUpdate={onUpdate}/></td>
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}><RequestStatusControl req={r} isAdmin={isAdmin} onUpdate={onUpdate}/></td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-stone-200 bg-stone-50">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <FieldRows fields={REQUEST_FIELDS} values={r} users={users}/>
                            <div className="space-y-5">
                              <AdminFieldsEditor title="Back Office" canEdit={isAdmin} idPrefix={`rqbo-${r.id}`}
                                fields={[{ key: 'serviceOrderNumber', label: 'Service Order Number', type: 'text' }]}
                                values={{ serviceOrderNumber: r.serviceOrderNumber || '' }}
                                onSave={(v) => onUpdate(r.id, { serviceOrderNumber: v.serviceOrderNumber || '' })}/>
                              <div>
                                <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-2">Files</div>
                                <AttachmentList attachments={r.attachments} currentUser={currentUser}
                                  onAdd={(files) => onAddFiles(r.id, files)} onRemove={(att) => onRemoveFile(r.id, att)}/>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeadRequestsSection({ requests, currentUser, onUpdate, onNew }) {
  const isAdmin = currentUser?.role === 'admin';
  const list = [...requests].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return (
    <Section title={
      <span className="flex items-center justify-between w-full">
        <span>Sales Requests</span>
        <button onClick={onNew} className="normal-case tracking-normal text-xs font-medium text-brand-700 hover:underline inline-flex items-center gap-1">
          <Plus size={11}/> Add request
        </button>
      </span>
    }>
      {list.length === 0 && <div className="text-xs text-stone-400">Delivery, demo, get ready, parts, pick up or service for this customer.</div>}
      {list.map(r => (
        <div key={r.id} className="flex items-start justify-between gap-2 py-1.5 border-b border-stone-100 last:border-0">
          <div className="min-w-0">
            <div className="text-sm font-medium text-stone-900">{(r.requestTypes || []).join(', ')}</div>
            <div className="text-xs text-stone-500">Needed {fmtYmd(r.dateNeeded)} · {r.fromLocation}{r.toLocation ? ` → ${r.toLocation}` : ''}</div>
          </div>
          <RequestStatusControl req={r} isAdmin={isAdmin} onUpdate={onUpdate}/>
        </div>
      ))}
    </Section>
  );
}

/* ===================== TRADE-IN EVALUATION ===================== */
// The rep inspects the customer's machine; a sales manager (admin) puts a value
// on it and approves or declines.

const TRADE_STATUS_STYLES = {
  'Awaiting Approval': 'bg-amber-50 text-amber-700',
  'Approved':          'bg-emerald-50 text-emerald-700',
  'Declined':          'bg-rose-50 text-rose-700'
};

function TradeInModal({ lead, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => {
    const init = {};
    for (const f of TRADE_IN_FIELDS) init[f.key] = f.type === 'multi' ? [] : '';
    return init;
  });
  const [errors, setErrors] = useState({});
  const [files, setFiles] = useState([]);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: undefined })); };
  const submit = () => {
    const errs = validateFields(TRADE_IN_FIELDS, form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const pruned = pruneHiddenAnswers(TRADE_IN_FIELDS, form);
    pruned.customerName = lead ? leadName(lead) : customer.trim();
    onSubmit(pruned, files);
  };
  const [customer, setCustomer] = useState('');
  return (
    <ModalShell label="Trade-in evaluation" icon={RefreshCw} accent={{ soft: 'bg-violet-50', text: 'text-violet-700' }}
      onCancel={() => { if (!busy) onCancel(); }}
      title="Trade-In Evaluation"
      subtitle={lead ? <>Trade for <span className="font-medium text-stone-700">{leadName(lead)}</span> — sent to a sales manager for a value.</> : 'Sent to a sales manager for a value and approval.'}
      footer={<>
        <button onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900 font-medium disabled:opacity-50">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-md flex items-center gap-2 disabled:opacity-60">
          <Send size={14}/> {busy ? 'Sending…' : 'Submit for Approval'}
        </button>
      </>}>
      <LeadSummaryBox lead={lead}/>
      {!lead && (
        <Field label="Customer">
          <input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Who is trading it in"
            className="w-full px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-brand-500"/>
        </Field>
      )}
      {TRADE_IN_SECTIONS.map(section => (
        <div key={section}>
          <div className="text-[10px] uppercase tracking-widest font-semibold text-stone-500 mb-2 pb-1 border-b border-stone-100">
            {section}{section === 'Condition' && <span className="normal-case tracking-normal font-normal text-stone-400"> — 1 poor · 5 excellent</span>}
          </div>
          <FieldGrid fields={TRADE_IN_FIELDS.filter(f => f.section === section)} values={form} errors={errors} onChange={set} idPrefix="ti"/>
        </div>
      ))}
      <AttachmentStager files={files} onChange={setFiles} label="Photos"
        hint="All four sides, the hour meter, the cab, tracks or tires, and any damage."/>
    </ModalShell>
  );
}

function TradeInsView({ tradeIns, leads, config, currentUser, onUpdate, onOpenLead, onNew, onAddFiles, onRemoveFile }) {
  const isAdmin = currentUser?.role === 'admin';
  const [show, setShow] = useState('Awaiting Approval');
  const [openId, setOpenId] = useState(null);
  const users = config.users || [];
  const userMap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const leadMap = useMemo(() => Object.fromEntries(leads.map(l => [l.id, l])), [leads]);
  const rows = tradeIns.filter(t => show === 'all' || tradeInStatus(t) === show);
  const count = (s) => tradeIns.filter(t => tradeInStatus(t) === s).length;
  return (
    <div>
      <RecordListTabs value={show} onChange={setShow} onNew={onNew} newLabel="New Trade-In"
        tabs={[['Awaiting Approval', 'Awaiting Approval', count('Awaiting Approval')], ['Approved', 'Approved', count('Approved')],
               ['Declined', 'Declined', count('Declined')], ['all', 'All', tradeIns.length]]}/>
      {rows.length === 0 ? (
        <EmptyState icon={RefreshCw} title="No trade-ins here" subtitle="Reps add a trade-in evaluation from the lead, or with New Trade-In."/>
      ) : (
        <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-stone-200 text-left text-[10px] uppercase tracking-widest text-stone-500">
                <th className="px-3 py-2.5 font-semibold">Submitted</th>
                <th className="px-3 py-2.5 font-semibold">Machine</th>
                <th className="px-3 py-2.5 font-semibold">Hours</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 font-semibold">Sales Person</th>
                <th className="px-3 py-2.5 font-semibold">Value</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => {
                const expanded = openId === t.id;
                const status = tradeInStatus(t);
                return (
                  <Fragment key={t.id}>
                    <tr onClick={() => setOpenId(expanded ? null : t.id)}
                      className={`border-b border-stone-100 align-top cursor-pointer hover:bg-stone-50 ${expanded ? 'bg-stone-50' : ''}`}>
                      <td className="px-3 py-3 text-xs font-mono text-stone-700 whitespace-nowrap">{fmtYmd(t.createdAt)}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-stone-900">{[t.year, t.make, t.model].filter(Boolean).join(' ')}</div>
                        <div className="text-xs text-stone-500 font-mono">S/N {t.serial}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-stone-700">{t.hours}</td>
                      <td className="px-3 py-3"><RecordCustomerCell rec={t} lead={t.leadId ? leadMap[t.leadId] : null} onOpenLead={onOpenLead}/></td>
                      <td className="px-3 py-3 text-xs text-stone-700">{userMap[t.salesPerson]?.name || '—'}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-stone-900">{t.manager?.tradeInValue || '—'}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-medium px-2 py-1 rounded ${TRADE_STATUS_STYLES[status]}`}>{status}</span>
                          {isAdmin && status === 'Awaiting Approval' && !expanded && (
                            <span className="text-xs font-semibold text-brand-700 inline-flex items-center gap-0.5">Review <ChevronRight size={12}/></span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-stone-200 bg-stone-50">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="order-2 lg:order-1">
                              <FieldRows fields={TRADE_IN_FIELDS} values={tradeInDisplayValues(t)}/>
                            </div>
                            <div className="space-y-5 order-1 lg:order-2">
                              <TradeInDecisionCard tradeIn={t} isAdmin={isAdmin} userMap={userMap}
                                onDecide={(manager, note) => onUpdate(t.id, { manager: { ...manager, decidedBy: currentUser?.id || null } }, note)}/>
                              <div>
                                <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-2">Photos &amp; Files</div>
                                <AttachmentList attachments={Array.isArray(t.attachments) ? t.attachments : []} currentUser={currentUser} emptyText="No photos yet."
                                  onAdd={(files) => onAddFiles(t.id, files)} onRemove={(att) => onRemoveFile(t.id, att)}/>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Old trade-ins stored the typed "Attachments (Please explain)" answer under
// `attachments`, which now holds uploaded files.
function tradeInDisplayValues(t) {
  if (t.attachmentsDetail !== undefined || typeof t.attachments !== 'string') return t;
  return { ...t, attachmentsDetail: t.attachments };
}

// The sales manager's decision. Replaces a generic "Edit" link: an admin sees
// the value, comments and Approve / Decline right where the row opens.
function TradeInDecisionCard({ tradeIn, isAdmin, userMap, onDecide }) {
  const m = tradeIn.manager || {};
  const status = tradeInStatus(tradeIn);
  const decided = status !== 'Awaiting Approval';
  const [editing, setEditing] = useState(!decided);
  const [value, setValue] = useState(m.tradeInValue || '');
  const [comments, setComments] = useState(m.managerComments || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEditing(tradeInStatus(tradeIn) === 'Awaiting Approval');
    setValue((tradeIn.manager || {}).tradeInValue || '');
    setComments((tradeIn.manager || {}).managerComments || '');
    setError('');
  }, [tradeIn.id, tradeIn.manager]);

  const decide = async (approved) => {
    if (approved === 'Yes' && !String(value).trim()) { setError('Enter the trade-in value before approving.'); return; }
    setError(''); setBusy(true);
    const manager = { tradeInValue: String(value).trim(), approved, managerComments: comments.trim(),
      decidedAt: new Date().toISOString(), decidedBy: null };
    try {
      const ok = await onDecide(manager, approved === 'Yes' ? 'Approved by sales manager' : 'Declined by sales manager');
      if (ok !== false) setEditing(false);
    } finally { setBusy(false); }
  };

  const heading = <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-2">Sales Manager Decision</div>;

  if (!isAdmin && !decided) {
    return (
      <div>
        {heading}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Waiting for a sales manager to set a value and approve or decline.
        </div>
      </div>
    );
  }

  if (!editing) {
    const who = m.decidedBy && userMap[m.decidedBy]?.name;
    return (
      <div>
        {heading}
        <div className={`rounded-lg border px-4 py-3 ${status === 'Approved' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={`text-sm font-semibold ${status === 'Approved' ? 'text-emerald-800' : 'text-rose-800'}`}>
                {status}{m.tradeInValue ? ` at ${m.tradeInValue}` : ''}
              </div>
              {(who || m.decidedAt) && (
                <div className="text-xs text-stone-600 mt-0.5">{[who, m.decidedAt && fmtDateTime(m.decidedAt)].filter(Boolean).join(' · ')}</div>
              )}
            </div>
            {isAdmin && (
              <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-brand-700 hover:underline shrink-0">
                Change decision
              </button>
            )}
          </div>
          {m.managerComments && <div className="text-sm text-stone-700 mt-2 whitespace-pre-wrap">{m.managerComments}</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      {heading}
      <div className="rounded-lg border-2 border-brand-500 bg-white p-4 space-y-3">
        <div className="text-sm text-stone-700">Review the evaluation, set a value, then approve or decline.</div>
        <div>
          <label htmlFor={`tiv-${tradeIn.id}`} className="block text-xs font-semibold text-stone-700 mb-1">Trade-In Value</label>
          <input id={`tiv-${tradeIn.id}`} value={value} onChange={e => { setValue(e.target.value); setError(''); }} placeholder="$"
            className="w-full md:w-60 px-3 py-2 border border-stone-300 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
        </div>
        <div>
          <label htmlFor={`tic-${tradeIn.id}`} className="block text-xs font-semibold text-stone-700 mb-1">Comments <span className="font-normal text-stone-500">(optional)</span></label>
          <textarea id={`tic-${tradeIn.id}`} rows={2} value={comments} onChange={e => setComments(e.target.value)}
            className="w-full px-3 py-2 border border-stone-300 rounded-md text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"/>
        </div>
        {error && <div className="text-xs text-rose-700">{error}</div>}
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" disabled={busy} onClick={() => decide('Yes')}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold rounded-md inline-flex items-center gap-1.5">
            <Check size={14}/> Approve
          </button>
          <button type="button" disabled={busy} onClick={() => decide('No')}
            className="px-4 py-2 border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60 text-sm font-semibold rounded-md inline-flex items-center gap-1.5">
            <X size={14}/> Decline
          </button>
          {decided && (
            <button type="button" onClick={() => setEditing(false)} className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900">Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

function LeadTradeInsSection({ tradeIns, onNew }) {
  return (
    <Section title={
      <span className="flex items-center justify-between w-full">
        <span>Trade-Ins</span>
        <button onClick={onNew} className="normal-case tracking-normal text-xs font-medium text-brand-700 hover:underline inline-flex items-center gap-1">
          <Plus size={11}/> Add trade-in
        </button>
      </span>
    }>
      {tradeIns.length === 0 && <div className="text-xs text-stone-400">Evaluate the customer&rsquo;s machine for a manager&rsquo;s value.</div>}
      {tradeIns.map(t => {
        const status = tradeInStatus(t);
        return (
          <div key={t.id} className="flex items-start justify-between gap-2 py-1.5 border-b border-stone-100 last:border-0">
            <div className="min-w-0">
              <div className="text-sm font-medium text-stone-900">{[t.year, t.make, t.model].filter(Boolean).join(' ')}</div>
              <div className="text-xs text-stone-500">{t.hours} hrs · S/N {t.serial}{t.manager?.tradeInValue ? ` · Value ${t.manager.tradeInValue}` : ''}</div>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${TRADE_STATUS_STYLES[status]}`}>{status}</span>
          </div>
        );
      })}
    </Section>
  );
}

/* ===================== FINANCE (Sales Tracker) ===================== */
// The finance team's funding pipeline. The rep's half comes from the Sales
// Submittal automatically for financed deals (or is entered by hand); the
// sales admin works the Deal Status and dates here.

const FINANCE_STATUS_STYLES = {
  'Submitted':                   'bg-blue-50 text-blue-700',
  'Approved':                    'bg-emerald-50 text-emerald-700',
  'Manual Review':               'bg-amber-50 text-amber-700',
  'Additional Info Needed':      'bg-amber-50 text-amber-700',
  'Declined':                    'bg-rose-50 text-rose-700',
  'Declined, Sent to 2nd Source':'bg-rose-50 text-rose-700',
  'Ready to Invoice':            'bg-violet-50 text-violet-700',
  'Invoiced-Pending Funding':    'bg-violet-50 text-violet-700',
  'Invoice-Funded':              'bg-stone-100 text-stone-700'
};

function FinanceModal({ lead, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => {
    const base = lead && lead.salesRequest ? financeFromSubmittal(lead.salesRequest, lead) : {};
    const init = {};
    for (const f of FINANCE_REP_FIELDS) init[f.key] = base[f.key] ?? '';
    if (!init.customerName && lead) init.customerName = leadName(lead);
    return init;
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: undefined })); };
  const submit = () => {
    const errs = validateFields(FINANCE_REP_FIELDS, form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSubmit(pruneHiddenAnswers(FINANCE_REP_FIELDS, form));
  };
  return (
    <ModalShell label="Finance deal" icon={ClipboardList} accent={{ soft: 'bg-violet-50', text: 'text-violet-700' }}
      onCancel={() => { if (!busy) onCancel(); }}
      title="Finance Deal"
      subtitle="Goes to the finance team's tracker."
      footer={<>
        <button onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900 font-medium disabled:opacity-50">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-md flex items-center gap-2 disabled:opacity-60">
          <Send size={14}/> {busy ? 'Sending…' : 'Submit to Finance'}
        </button>
      </>}>
      <LeadSummaryBox lead={lead}/>
      <FieldGrid fields={FINANCE_REP_FIELDS} values={form} errors={errors} onChange={set} idPrefix="fi"/>
    </ModalShell>
  );
}

function FinanceView({ deals, leads, config, currentUser, onUpdate, onOpenLead, onNew }) {
  const isAdmin = currentUser?.role === 'admin';
  const [show, setShow] = useState('open');
  const [openId, setOpenId] = useState(null);
  const users = config.users || [];
  const userMap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const leadMap = useMemo(() => Object.fromEntries(leads.map(l => [l.id, l])), [leads]);
  const today = todayYmd();
  const isOpen = (d) => !FINANCE_CLOSED_STATUSES.includes(d.admin?.dealStatus);
  const rows = deals.filter(d => show === 'all' || (show === 'open' ? isOpen(d) : !isOpen(d)));
  const flagged = deals.filter(d => isOpen(d) && financeAudit(d, today).length).length;
  return (
    <div>
      <RecordListTabs value={show} onChange={setShow} onNew={onNew} newLabel="New Finance Deal"
        tabs={[['open', 'In Progress', deals.filter(isOpen).length], ['closed', 'Funded / Declined', deals.filter(d => !isOpen(d)).length], ['all', 'All', deals.length]]}/>
      {flagged > 0 && show !== 'closed' && (
        <div className="mb-3 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 inline-flex items-center gap-1.5">
          <AlertTriangle size={13}/> {flagged} deal{flagged === 1 ? '' : 's'} failing the 3-day audit
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No finance deals here"
          subtitle="Financed Sales Submittals appear here automatically. Add one by hand with New Finance Deal."/>
      ) : (
        <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-stone-200 text-left text-[10px] uppercase tracking-widest text-stone-500">
                <th className="px-3 py-2.5 font-semibold">Created</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 font-semibold">Asset</th>
                <th className="px-3 py-2.5 font-semibold">Amount</th>
                <th className="px-3 py-2.5 font-semibold">Deal Type</th>
                <th className="px-3 py-2.5 font-semibold">Sales Person</th>
                <th className="px-3 py-2.5 font-semibold">Lender</th>
                <th className="px-3 py-2.5 font-semibold">Deal Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => {
                const expanded = openId === d.id;
                const st = d.admin?.dealStatus || 'Submitted';
                const audit = isOpen(d) ? financeAudit(d, today) : [];
                return (
                  <Fragment key={d.id}>
                    <tr onClick={() => setOpenId(expanded ? null : d.id)}
                      className={`border-b border-stone-100 align-top cursor-pointer hover:bg-stone-50 ${expanded ? 'bg-stone-50' : ''}`}>
                      <td className="px-3 py-3 text-xs font-mono text-stone-700 whitespace-nowrap">
                        {fmtYmd(d.createdAt)}
                        <div className="text-[10px] font-sans text-stone-400">{daysSince(d.createdAt)}d old</div>
                      </td>
                      <td className="px-3 py-3"><RecordCustomerCell rec={d} lead={d.leadId ? leadMap[d.leadId] : null} onOpenLead={onOpenLead}/></td>
                      <td className="px-3 py-3 text-xs text-stone-800 max-w-[14rem]">{d.assetToFinance}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-stone-900 whitespace-nowrap">{d.amount}</td>
                      <td className="px-3 py-3 text-xs text-stone-700">{d.dealType}</td>
                      <td className="px-3 py-3 text-xs text-stone-700 whitespace-nowrap">{userMap[d.salesPerson]?.name || '—'}</td>
                      <td className="px-3 py-3 text-xs text-stone-700">{d.admin?.lenderName || '—'}</td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded whitespace-nowrap ${FINANCE_STATUS_STYLES[st] || ''}`}>{st}</span>
                        {audit.map(a => <div key={a} className="text-[10px] font-semibold text-rose-700 mt-1">{a}</div>)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-stone-200 bg-stone-50">
                        <td colSpan={8} className="px-5 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                              <div className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold mb-2">From the rep</div>
                              <FieldRows fields={FINANCE_REP_FIELDS} values={d}/>
                            </div>
                            <AdminFieldsEditor title="Finance" canEdit={isAdmin} idPrefix={`fa-${d.id}`}
                              fields={FINANCE_ADMIN_FIELDS} values={d.admin || {}}
                              onSave={(v) => onUpdate(d.id, { admin: v }, 'Finance update')}/>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function daysSince(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function LeadFinanceSection({ deals, onNew }) {
  return (
    <Section title={
      <span className="flex items-center justify-between w-full">
        <span>Finance</span>
        {deals.length === 0 && (
          <button onClick={onNew} className="normal-case tracking-normal text-xs font-medium text-brand-700 hover:underline inline-flex items-center gap-1">
            <Plus size={11}/> Add finance deal
          </button>
        )}
      </span>
    }>
      {deals.length === 0 && <div className="text-xs text-stone-400">Financed submittals create this automatically.</div>}
      {deals.map(d => {
        const st = d.admin?.dealStatus || 'Submitted';
        return (
          <div key={d.id} className="flex items-start justify-between gap-2 py-1.5 border-b border-stone-100 last:border-0">
            <div className="min-w-0">
              <div className="text-sm font-medium text-stone-900">{d.assetToFinance}</div>
              <div className="text-xs text-stone-500">{d.dealType} · {d.amount}{d.admin?.lenderName ? ` · ${d.admin.lenderName}` : ''}</div>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${FINANCE_STATUS_STYLES[st] || ''}`}>{st}</span>
          </div>
        );
      })}
    </Section>
  );
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg py-16 text-center">
      <Icon size={32} className="mx-auto text-stone-300 mb-3"/>
      <div className="font-semibold text-stone-700">{title}</div>
      <div className="text-sm text-stone-500 mt-1">{subtitle}</div>
    </div>
  );
}

function DuplicateCheckModal({ check, config, onLinkSubmission, onOpenExisting, onCreateAnyway, onCancel }) {
  const { payload, matches } = check;
  const userMap = Object.fromEntries(config.users.map(u => [u.id, u]));

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onCancel}/>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 md:p-6 pointer-events-none">
        <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[92vh] md:max-h-[85vh] overflow-hidden flex flex-col pointer-events-auto fade-up">
          {/* Header */}
          <div className="px-4 md:px-6 py-3 md:py-4 border-b border-stone-200 bg-amber-50 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0"/>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-stone-900">
                {matches.length === 1 ? 'Possible duplicate found' : `${matches.length} possible duplicates found`}
              </div>
              <div className="text-xs text-stone-600 mt-0.5">
                An existing lead matches the contact info you entered. Review your options before creating a new record.
              </div>
            </div>
            <button onClick={onCancel} className="text-stone-400 hover:text-stone-900 p-1 -mr-1 shrink-0">
              <X size={18}/>
            </button>
          </div>

          {/* New submission summary */}
          <div className="px-4 md:px-6 py-3 border-b border-stone-200 bg-stone-50">
            <div className="text-[10px] uppercase tracking-widest font-semibold text-stone-500 mb-1.5">New Submission</div>
            <div className="text-sm">
              <span className="font-semibold text-stone-900">{payload.customerName || 'Unnamed'}</span>
              {payload.contactEmail && <span className="text-stone-600 ml-2">{payload.contactEmail}</span>}
              {payload.phone && <span className="text-stone-500 ml-2 font-mono text-xs">{payload.phone}</span>}
            </div>
            {payload.comment && (
              <div className="text-xs text-stone-600 mt-1.5 line-clamp-2">"{payload.comment}"</div>
            )}
          </div>

          {/* Matches list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="px-4 md:px-6 py-3 md:py-4">
              <div className="text-[10px] uppercase tracking-widest font-semibold text-stone-500 mb-3">
                Existing Match{matches.length === 1 ? '' : 'es'}
              </div>
              <div className="space-y-3">
                {matches.map(({ lead, matchedOn }) => (
                  <DuplicateMatchCard
                    key={lead.id} lead={lead} matchedOn={matchedOn}
                    userMap={userMap}
                    onLink={() => onLinkSubmission(lead.id)}
                    onOpen={() => onOpenExisting(lead.id)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-4 md:px-6 py-3 border-t border-stone-200 bg-stone-50 flex items-center justify-between gap-3 flex-wrap">
            <button onClick={onCancel} className="text-sm text-stone-600 hover:text-stone-900">
              ← Cancel
            </button>
            <button onClick={onCreateAnyway}
              className="px-4 py-2 border border-stone-300 hover:bg-white text-sm font-semibold text-stone-700 rounded-md">
              Create as separate lead
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DuplicateMatchCard({ lead, matchedOn, userMap, onLink, onOpen }) {
  const score = useMemo(() => scoreLead(lead), [lead]);
  const tier = TIER_STYLES[score.tier];
  const assigned = userMap[lead.assignedTo];
  const assignedName = assigned && !assigned.isSystem ? assigned.name : '— Unassigned —';

  return (
    <div className="border border-stone-200 rounded-md overflow-hidden">
      <div className="px-4 py-3 bg-white">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-stone-900 truncate">{lead.customerName || 'Unnamed lead'}</span>
              <StatusBadge status={lead.status}/>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${tier.bg} ${tier.text}`}>
                {tier.icon} {score.total}
              </span>
            </div>
            <div className="text-xs text-stone-600 space-y-0.5">
              {lead.contactEmail && (
                <div className="flex items-center gap-1.5">
                  <Mail size={11} className="text-stone-400"/>
                  <span className={matchedOn.includes('email') ? 'font-semibold text-amber-700' : ''}>{lead.contactEmail}</span>
                  {matchedOn.includes('email') && <span className="text-[10px] uppercase tracking-widest bg-amber-100 text-amber-700 px-1.5 rounded font-bold">Match</span>}
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone size={11} className="text-stone-400"/>
                  <span className={`font-mono ${matchedOn.includes('phone') ? 'font-semibold text-amber-700' : ''}`}>{lead.phone}</span>
                  {matchedOn.includes('phone') && <span className="text-[10px] uppercase tracking-widest bg-amber-100 text-amber-700 px-1.5 rounded font-bold">Match</span>}
                </div>
              )}
              <div className="text-stone-500">
                Assigned to <span className="text-stone-700">{assignedName}</span> · Created {fmtDate(lead.createdDate)} · Source: {formatLeadSource(lead)}
              </div>
            </div>
            {lead.comment && (
              <div className="text-xs text-stone-600 mt-2 italic line-clamp-2 bg-stone-50 px-2 py-1 rounded">"{lead.comment}"</div>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 py-2 bg-stone-50 border-t border-stone-200 flex gap-2 justify-end">
        <button onClick={onOpen}
          className="px-2.5 py-1.5 text-xs font-semibold border border-stone-200 hover:bg-white rounded text-stone-700">
          Open this lead
        </button>
        <button onClick={onLink}
          className="px-2.5 py-1.5 text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded flex items-center gap-1">
          <RefreshCw size={11}/> Link as new submission
        </button>
      </div>
    </div>
  );
}
