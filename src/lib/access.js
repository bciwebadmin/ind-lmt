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

export const TELEMATICS_CODES_VIEW = 'telematics-codes';
// Every Telematics view. Later steps add the board here.
export const TELEMATICS_VIEWS = [TELEMATICS_CODES_VIEW];
// Where a telematics-only user lands.
export const TELEMATICS_DEFAULT_VIEW = TELEMATICS_CODES_VIEW;
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
  if (TELEMATICS_VIEWS.includes(view)) return hasTelematicsAccess(user);
  // Everything else is Lead Management.
  return hasLeadAccess(user);
}

export function defaultViewFor(user, leadDefaultView) {
  if (hasLeadAccess(user)) return leadDefaultView;
  if (hasTelematicsAccess(user)) return TELEMATICS_DEFAULT_VIEW;
  return NO_ACCESS_VIEW;
}
