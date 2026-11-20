// Who may open what. Pure — no Firebase imports — so scripts/test-helpers.mjs
// can test it directly. firestore.rules enforces the same model on the server
// (canUseLeads / canUseTelematics); keep the two in step.
//
// Two switches on each users/{uid} doc (Nov 2026, for the Telematics module):
//   leadAccess       Lead Management: leads, back office, To Do, search.
//                    Absent = on, so every account that existed before this
//                    change keeps working without a migration.
//   telematicsAccess The Telematics module. Absent = off.
// Admins always have both. A user with leadAccess: false is "telematics only"
// (Carter): fully blocked from lead data, in the rules as well as the UI (Erin).

export const TELEMATICS_BOARD_VIEW = 'telematics-board';
export const TELEMATICS_CODES_VIEW = 'telematics-codes';
export const TELEMATICS_SETTINGS_VIEW = 'telematics-settings';
export const TELEMATICS_DASHBOARD_VIEW = 'telematics-dashboard';
// The board split in two (Nov 19, Erin): TELEMATICS_BOARD_VIEW is "Fault
// Codes" (the original board, so old links still work); this is "Service Due".
export const TELEMATICS_SERVICE_VIEW = 'telematics-service';
// Every Telematics view.
export const TELEMATICS_VIEWS = [TELEMATICS_BOARD_VIEW, TELEMATICS_SERVICE_VIEW, TELEMATICS_DASHBOARD_VIEW, TELEMATICS_CODES_VIEW, TELEMATICS_SETTINGS_VIEW];
// Where a telematics-only user lands: Carter lives on the board (Tanner).
export const TELEMATICS_DEFAULT_VIEW = TELEMATICS_BOARD_VIEW;
// Shown to an account with neither switch on.
export const NO_ACCESS_VIEW = 'no-access';

const isAdmin = (user) => !!user && user.role === 'admin';

export function hasLeadAccess(user) {
  if (!user || user.isSystem) return false;
  return isAdmin(user) || user.leadAccess !== false;
}

export function hasTelematicsAccess(user) {
  if (!user || user.isSystem) return false;
  return isAdmin(user) || user.telematicsAccess === true;
}

// One label for the Users list and the account menu.
export function accessLabel(user) {
  if (isAdmin(user)) return 'Admin';
  const leads = hasLeadAccess(user), tele = hasTelematicsAccess(user);
  if (leads && tele) return 'Sales Rep + Telematics';
  if (tele) return 'Telematics';
  if (leads) return 'Sales Rep';
  return 'No access';
}

// The add-user form's access choices for a non-admin, as the two fields.
export const ACCESS_PRESETS = [
  { id: 'leads',      label: 'Lead Management',              fields: { leadAccess: true,  telematicsAccess: false } },
  { id: 'both',       label: 'Lead Management + Telematics', fields: { leadAccess: true,  telematicsAccess: true  } },
  { id: 'telematics', label: 'Telematics only',              fields: { leadAccess: false, telematicsAccess: true  } }
];

export function canOpenView(view, user, adminOnlyViews = []) {
  if (!user) return false;
  if (adminOnlyViews.includes(view)) return isAdmin(user);
  if (view === NO_ACCESS_VIEW) return true;
  // Only useful with more than one dashboard to choose from.
  if (view === 'workspace-picker') return workspacesFor(user).length > 1;
  if (TELEMATICS_VIEWS.includes(view)) return hasTelematicsAccess(user);
  // Everything else is Lead Management.
  return hasLeadAccess(user);
}

export function defaultViewFor(user, leadDefaultView) {
  if (hasLeadAccess(user)) return leadDefaultView;
  if (hasTelematicsAccess(user)) return TELEMATICS_DEFAULT_VIEW;
  return NO_ACCESS_VIEW;
}

/* ===================== DASHBOARDS (workspaces) ===================== */
// The left menu shows one dashboard at a time, switched from the bottom of the
// menu (Erin, Nov 2026). Admins pick one on a "Choose a dashboard" screen at
// sign-in; everyone else lands straight in theirs. Users / Settings belong to
// none — they show under every dashboard for admins.
export const WORKSPACE_PICKER_VIEW = 'workspace-picker';
export const WORKSPACES = [
  { id: 'leads',      label: 'Lead Management', hint: 'New leads through completed deals, To Do and reports' },
  { id: 'backoffice', label: 'Back Office',     hint: 'Sales submittals, sales requests, finance and trade-ins' },
  // Shown as "Customer Asset Management" (Erin, Nov 20); the id stays 'telematics'.
  { id: 'telematics', label: 'Customer Asset Management', hint: 'Fault codes, service due, the code list and follow-ups' }
];
export const BACK_OFFICE_VIEWS = ['submittals', 'requests', 'finance', 'trade-ins'];
const SHARED_VIEWS = ['users', 'settings', NO_ACCESS_VIEW, WORKSPACE_PICKER_VIEW];

// Which dashboard a view belongs to; null for the shared ones.
export function workspaceOfView(view) {
  if (TELEMATICS_VIEWS.includes(view)) return 'telematics';
  if (BACK_OFFICE_VIEWS.includes(view)) return 'backoffice';
  if (SHARED_VIEWS.includes(view)) return null;
  return 'leads';
}

// The dashboards this person may switch between, in menu order. Reps keep
// Back Office: it's where their own submittals, requests and trade-ins live.
export function workspacesFor(user) {
  const lead = hasLeadAccess(user), tele = hasTelematicsAccess(user);
  return WORKSPACES.filter(w => (w.id === 'telematics' ? tele : lead)).map(w => w.id);
}

// Where each dashboard opens.
export function workspaceHomeView(id, leadDefaultView) {
  if (id === 'telematics') return TELEMATICS_BOARD_VIEW;
  if (id === 'backoffice') return 'submittals';
  return leadDefaultView;
}

// The first screen after sign-in. `remembered` = the dashboard this browser
// tab was last in (a refresh shouldn't bounce an admin back to the picker).
export function landingView(user, leadDefaultView, remembered = '') {
  const mine = workspacesFor(user);
  if (remembered && mine.includes(remembered)) return workspaceHomeView(remembered, leadDefaultView);
  if (user && user.role === 'admin' && mine.length > 1) return WORKSPACE_PICKER_VIEW;
  return defaultViewFor(user, leadDefaultView);
}
