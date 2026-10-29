// src/lib/pipeline.js
//
// Bobcat of Indy's lead management. This is the one place that says which
// status belongs to which tab. Everything else — the sidebar, its counts, the
// status dropdowns, the tests — reads it from here.
//
//   New -> Working (Working, Pending) -> Prospect (Prospect, Dead, Unqualified,
//   Lost) / Wanted -> Completed
//
// Reworked Oct 2026 after Indy's process meeting. Leads, Sales Submittals and
// Sales Requests are three separate processes that can be tied together:
//   - Completed means a done deal, nothing else. Choosing Completed opens the
//     Sales Submittal; the lead goes straight to Completed and the submittal
//     joins the back office's own queue (`lead.salesRequest.status`).
//   - Dead, Unqualified and Lost live under Prospect, filterable by type, so
//     they stay a resource to come back to.
//
// A lead's tab is DERIVED from its status, never stored: one status, exactly
// one tab, nothing to fall out of sync.
//
// Pure module on purpose — no React, no Firebase — so scripts/test-helpers.mjs
// can import it under plain node.

export const STAGE_INCOMING      = 'incoming';    // labelled "New"; id kept for diffing with Atlanta
export const STAGE_WORKING       = 'working';
export const STAGE_PROSPECT      = 'prospect';
export const STAGE_WANTED        = 'wanted';
export const STAGE_COMPLETED     = 'completed';
export const STAGE_JUNK          = 'junk';   // not a tab; Junk is a sub-tab of New
// The old third step. No longer a lead step (Sales Submittals are their own
// queue); kept so colours and accents keyed on it still resolve.
export const STAGE_SALES_REQUEST = 'sales-request';

export const NEW_STATUS       = 'New';
export const WORKING_STATUS   = 'Working';
export const PENDING_STATUS   = 'Pending';
export const PROSPECT_STATUS  = 'Prospect';
export const WANTED_STATUS    = 'Wanted';
// The status a finished sale ends in. Named WON_STATUS so the shared report
// code reads the same across forks; Indy's value is 'Completed'.
export const WON_STATUS       = 'Completed';
export const LOST_STATUS      = 'Lost';
export const DEAD_STATUS      = 'Dead';
export const UNQUALIFIED_STATUS = 'Unqualified';
export const JUNK_STATUS      = 'Junk';
// Retired lead statuses, still recognised on old leads (see LEGACY_STATUS_RENAMES).
export const SALES_REQUEST_STATUS = 'Sales Submittal';
export const CANCELLED_STATUS     = 'Cancelled';

export const PIPELINE_STAGES = [
  {
    id: STAGE_INCOMING,
    label: 'New',
    view: 'stage-incoming',
    blurb: 'Every new lead lands here. Assign it and make contact.',
    statuses: [NEW_STATUS]
  },
  {
    id: STAGE_WORKING,
    label: 'Working',
    view: 'stage-working',
    blurb: 'Being worked by a rep, including deals pending.',
    statuses: [WORKING_STATUS, PENDING_STATUS]
  },
  {
    id: STAGE_PROSPECT,
    label: 'Prospect',
    view: 'stage-prospect',
    blurb: 'Prospects to come back to, and leads that went dead, unqualified or lost.',
    statuses: [PROSPECT_STATUS, DEAD_STATUS, UNQUALIFIED_STATUS, LOST_STATUS]
  },
  {
    id: STAGE_WANTED,
    label: 'Wanted',
    view: 'stage-wanted',
    blurb: 'Customers waiting on a unit that isn’t available yet.',
    statuses: [WANTED_STATUS]
  },
  {
    id: STAGE_COMPLETED,
    label: 'Completed',
    view: 'stage-completed',
    blurb: 'Done deals.',
    statuses: [WON_STATUS]
  }
];

// The Prospect tab's type buttons. "Prospect" is the default view and holds
// prospects added by hand as well as leads a rep moved to Prospect.
export const PROSPECT_TYPES = [
  { id: 'prospect',    label: 'Prospect',    status: PROSPECT_STATUS },
  { id: 'dead',        label: 'Dead',        status: DEAD_STATUS },
  { id: 'unqualified', label: 'Unqualified', status: UNQUALIFIED_STATUS },
  { id: 'lost',        label: 'Lost',        status: LOST_STATUS }
];
// Moving a lead into any of these asks for keywords (Cat, CTL, …) so the
// prospect list can be searched later.
export const PROSPECT_GROUP_STATUSES = PROSPECT_TYPES.map(t => t.status);

// Every status the pipeline needs, in display order, Junk last.
export const PIPELINE_STATUSES = [
  ...PIPELINE_STAGES.flatMap(s => s.statuses),
  JUNK_STATUS
];

// "Closed" = finished for good: archived 30 days on, never stale. Only done
// deals and junk. Dead / Unqualified / Lost stay live under Prospect.
export const PIPELINE_CLOSED_STATUSES = [WON_STATUS, JUNK_STATUS];

// Statuses the older forks (or earlier Indy drafts) used. A lead carrying one
// still has to land in a sensible tab.
export const LEGACY_STATUS_STAGE = {
  Contacted:     STAGE_INCOMING,
  Qualified:     STAGE_WORKING,
  Quoted:        STAGE_WORKING,
  Want:          STAGE_WANTED,
  Wants:         STAGE_WANTED,
  Won:           STAGE_COMPLETED,
  'No Decision': STAGE_PROSPECT,
  'Sales Request': STAGE_COMPLETED,
  'Sales Submittal': STAGE_COMPLETED,
  Cancelled:     STAGE_PROSPECT
};

// Statuses that were renamed. Leads still storing the old name are shown under
// the new one on read and rewritten once by an admin (App.jsx); Settings and
// staleness thresholds heal in ensurePipelineStatuses.
//   Sales Request / Sales Submittal -> Completed: the submittal now has its own
//   queue, so the lead itself is a done deal (its submittal stays Open).
export const LEGACY_STATUS_RENAMES = {
  Qualified: WORKING_STATUS,
  Want: WANTED_STATUS,
  Wants: WANTED_STATUS,
  'Sales Request': WON_STATUS,
  'Sales Submittal': WON_STATUS,
  Cancelled: LOST_STATUS
};
export function renamedStatus(status) {
  return Object.prototype.hasOwnProperty.call(LEGACY_STATUS_RENAMES, status) ? LEGACY_STATUS_RENAMES[status] : status;
}

const STAGE_BY_ID = Object.fromEntries(PIPELINE_STAGES.map(s => [s.id, s]));

export function getStage(stageId) {
  return STAGE_BY_ID[stageId] || null;
}

export function stageForView(view) {
  return PIPELINE_STAGES.find(s => s.view === view) || null;
}

/**
 * Which tab a status belongs to. The fixed mapping wins, then legacy names,
 * then anything an admin marked closed in Settings goes to Completed. An
 * unknown open status — one an admin added — falls back to New.
 */
export function stageOfStatus(status, closedStatuses = PIPELINE_CLOSED_STATUSES) {
  if (status === JUNK_STATUS) return STAGE_JUNK;
  for (const stage of PIPELINE_STAGES) {
    if (stage.statuses.includes(status)) return stage.id;
  }
  if (LEGACY_STATUS_STAGE[status]) return LEGACY_STATUS_STAGE[status];
  if (Array.isArray(closedStatuses) && closedStatuses.includes(status)) return STAGE_COMPLETED;
  return STAGE_INCOMING;
}

export function stageOfLead(lead, closedStatuses) {
  return stageOfStatus(lead && lead.status, closedStatuses);
}

/**
 * The statuses a lead can be moved to. Leads move freely between the tabs —
 * a prospect can come back to Working, a Wanted customer can buy — with two
 * rules: Completed opens the Sales Submittal (completesViaSalesRequest), and
 * Junk is offered everywhere. Custom statuses an admin added are appended.
 * The current status is always included so a <select> can show it.
 */
export function statusOptionsFor(current, allStatuses = PIPELINE_STATUSES, closedStatuses = PIPELINE_CLOSED_STATUSES /*, opts */) {
  const base = PIPELINE_STATUSES.slice();
  const custom = (Array.isArray(allStatuses) ? allStatuses : [])
    .filter(s => !PIPELINE_STATUSES.includes(s) && !LEGACY_STATUS_STAGE[s]);
  const out = [...base.filter(s => s !== JUNK_STATUS), ...custom, JUNK_STATUS];
  if (current && !out.includes(current)) out.unshift(current);
  return out.filter((s, i) => out.indexOf(s) === i);
}

/** Kept for callers from the old flow: anyone may now set any status. */
export function canCloseSalesRequest() {
  return true;
}

/**
 * True when moving a lead to `to` means "the rep made the sale": Completed
 * chosen on a lead that isn't Completed yet. The app opens the Sales Submittal
 * first; on submit the lead is written as Completed.
 */
export function completesViaSalesRequest(from, to) {
  return to === WON_STATUS && from !== WON_STATUS;
}

/** True when moving into the Prospect group from outside it (asks for keywords). */
export function entersProspectGroup(from, to) {
  return PROSPECT_GROUP_STATUSES.includes(to) && !PROSPECT_GROUP_STATUSES.includes(from);
}

/**
 * Statuses offered by a tab's bulk "Set status…" menu. Completed is left out —
 * it needs a Sales Submittal filled in one lead at a time.
 */
export function bulkStatusOptionsFor(stageId, allStatuses, closedStatuses) {
  if (!STAGE_BY_ID[stageId]) return [];
  return statusOptionsFor(null, allStatuses, closedStatuses).filter(s => s !== WON_STATUS);
}

/**
 * Stored config replaces the defaults rather than merging, so a project whose
 * Settings were saved before these statuses existed would be missing them. This
 * puts the pipeline statuses back in order, keeps any custom ones an admin
 * added, drops the legacy names, and sets the closed list. Thresholds are only
 * added where the key is absent — an admin's value is never overwritten.
 */
export function ensurePipelineStatuses(config, defaultThresholds = {}) {
  if (!config) return config;
  const stored = Array.isArray(config.statuses) ? config.statuses : [];
  const custom = stored.filter(s => !PIPELINE_STATUSES.includes(s) && !LEGACY_STATUS_STAGE[s]);
  const statuses = [...PIPELINE_STATUSES.filter(s => s !== JUNK_STATUS), ...custom, JUNK_STATUS];

  const storedClosed = Array.isArray(config.closedStatuses) ? config.closedStatuses : [];
  const customClosed = storedClosed.filter(s => custom.includes(s));
  const closedStatuses = [...PIPELINE_CLOSED_STATUSES, ...customClosed];

  const out = { ...config, statuses, closedStatuses };

  if (out.staleness && out.staleness.thresholds) {
    const th = { ...out.staleness.thresholds };
    let added = false;
    // A renamed status keeps the threshold someone set under its old name —
    // unless the new name is a closed one (Completed is never stale).
    for (const [oldName, newName] of Object.entries(LEGACY_STATUS_RENAMES)) {
      if (Object.prototype.hasOwnProperty.call(th, oldName)) {
        if (!Object.prototype.hasOwnProperty.call(th, newName) && !PIPELINE_CLOSED_STATUSES.includes(newName)) th[newName] = th[oldName];
        delete th[oldName]; added = true;
      }
    }
    for (const [k, v] of Object.entries(defaultThresholds)) {
      if (!Object.prototype.hasOwnProperty.call(th, k)) { th[k] = v; added = true; }
    }
    if (added) out.staleness = { ...out.staleness, thresholds: th };
  }
  return out;
}

/**
 * Who sees a lead in a tab. Admins see everything. A rep sees leads assigned
 * to them (primary or secondary) — plus, in New only, leads nobody owns yet,
 * so they can pick them up.
 */
export function isLeadVisibleInStage(lead, stageId, viewer) {
  if (!lead || !viewer) return false;
  if (viewer.role === 'admin') return true;
  if (lead.assignedTo === viewer.id || lead.secondaryAssignedTo === viewer.id) return true;
  return stageId === STAGE_INCOMING && isUnassigned(lead);
}

export function isUnassigned(lead) {
  return !lead || !lead.assignedTo || lead.assignedTo === 'u_1';
}

/* ===================== TEMPERATURE ===================== */
// Set by the rep by hand (Hot / Warm / Cold) and filterable like a status.
// Replaced the computed heat score in Oct 2026. Stored as `lead.temperature`;
// leads from before then kept it in `lead.deal.temperature`, read as a fallback.
export const TEMPERATURES = ['Hot', 'Warm', 'Cold'];
export function leadTemperature(lead) {
  if (!lead) return '';
  const t = lead.temperature || (lead.deal && lead.deal.temperature) || '';
  return TEMPERATURES.includes(t) ? t : '';
}

/* ===================== SALES SUBMITTAL QUEUE ===================== */
// A submittal is its own process: Open until the back office completes it,
// whatever the lead's status. Submittals made before Oct 2026 had no status of
// their own — a lead that had already reached Completed was finished by the
// back office then, so it reads as Complete; anything else is Open.
export const SUBMITTAL_OPEN = 'Open';
export const SUBMITTAL_COMPLETE = 'Complete';
export function submittalStatus(lead) {
  const sr = lead && lead.salesRequest;
  if (!sr) return null;
  if (sr.status === SUBMITTAL_OPEN || sr.status === SUBMITTAL_COMPLETE) return sr.status;
  return lead.status === WON_STATUS && !lead._migratedFrom ? SUBMITTAL_COMPLETE : SUBMITTAL_OPEN;
}

/* ===================== PROSPECT KEYWORDS ===================== */
// Free text the rep adds when a lead goes to Prospect (or a prospect is added):
// "Cat, CTL, needs trailer". Split into tags for display and search.
export function prospectKeywordList(lead) {
  const raw = (lead && lead.prospectKeywords) || '';
  return String(raw).split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
}

/* ===================== DEAL DETAILS ===================== */
// What the rep records while working a lead. Taken from the columns Indy's deal
// tracker shares across its Want / Prospect / Pending / Completed / Lost views
// — the fields do not change by status, so this is one section on every lead.
// Stored as `lead.deal`. Initial contact is the lead's own submitted date, and
// comments live in the lead's notes timeline, so neither is repeated here.
export const MACHINE_OPTIONS = [
  'Compact Track Loader', 'Mini Excavator', 'Skid Steer Loader', 'Mini Track Loader',
  'Zero-Turn Mower', 'Compact Tractor', 'Attachment', 'Other'
];

export const DEAL_FIELDS = [
  { key: 'machines',          label: 'Machine to Purchase',    type: 'multi',  options: MACHINE_OPTIONS },
  { key: 'model',             label: 'Model to Purchase',      type: 'text',   placeholder: 'e.g. T76, E35' },
  { key: 'attachment',        label: 'Attachment to Purchase', type: 'text' },
  { key: 'other',             label: 'Other',                  type: 'text',   placeholder: 'Trailer, compactor, …' },
  { key: 'newUsed',           label: 'New / Used',             type: 'select', options: ['New', 'Used', 'Either'] },
  { key: 'includeAttachment', label: 'Include Attachment?',    type: 'select', options: ['Yes', 'No'] },
  { key: 'dateQuoted',        label: 'Date Quoted',            type: 'date' },
  { key: 'location',          label: 'Location',               type: 'text',   placeholder: 'City, County' },
  { key: 'competitor',        label: 'Competitor',             type: 'text',   placeholder: 'Kubota, Deere, CAT, …' }
];

// Asked when a single lead is set to Lost. The reason is required; which
// competitor won is optional (often not known).
export const LOST_FIELDS = [
  { key: 'lostReason', label: 'Reason for Lost Deal', type: 'textarea', required: true },
  { key: 'competitor', label: 'Competitor',           type: 'text',     placeholder: 'Who won it, if known' }
];

/* ===================== SALES SUBMITTAL ===================== */
// Indy's Sales Submittal, split the way the work splits:
//
//   SALES_REQUEST_FIELDS — what the rep fills in to submit. Stored on
//     `lead.salesRequest`. The email in functions/index.js carries a copy of the
//     keys and labels (search SALES_REQUEST_FIELDS there); a test fails if the
//     two drift.
//   BACK_OFFICE_FIELDS — what the back office fills in while completing it,
//     admin-only in the app. Stored on `lead.salesRequest.backOffice`.
//
// `showIf` hides a field until the answer it depends on is given, so a cash
// deal with no trade is a short form. Submission Date and Submitted By are
// stamped automatically, and Store is the lead's branch.
export const SALES_REQUEST_SECTIONS = ['Unit', 'Financing', 'Rebate & Programs', 'Trade-In', 'Other'];

export const SALES_REQUEST_FIELDS = [
  { section: 'Unit', key: 'model',          label: 'Model Number of Unit/Attachment', type: 'text', required: true, placeholder: 'e.g. T66, MT Pallet Forks' },
  { section: 'Unit', key: 'estimatedValue', label: 'Estimated Value of Sale',         type: 'text', required: true, placeholder: '$' },
  { section: 'Unit', key: 'customerName',   label: 'Customer Name',                   type: 'text', required: true, placeholder: 'As it should appear on the paperwork' },

  { section: 'Financing', key: 'payment',        label: 'Payment/Financing',       type: 'select', required: true, options: ['Cash', 'Loan', 'Lease', 'RP', 'Other Financing'] },
  { section: 'Financing', key: 'loanLender',     label: 'Loan/Lease',              type: 'text', suggestions: ['Wells Fargo', 'AUX', 'Sheffield'], showIf: { payment: ['Loan'] } },
  { section: 'Financing', key: 'lease',          label: 'Lease',                   type: 'text', suggestions: ['Wells Fargo Lease'],              showIf: { payment: ['Lease'] } },
  { section: 'Financing', key: 'otherFinancing', label: 'Other Financing Options', type: 'text', showIf: { payment: ['Other Financing', 'RP'] } },

  { section: 'Rebate & Programs', key: 'rebate',           label: 'Rebate',                   type: 'select', options: ['No', 'Yes'] },
  { section: 'Rebate & Programs', key: 'rebateType',       label: 'Type of Rebate',           type: 'select', options: ['Cash in lieu of financing', 'Municipal', 'Other'], showIf: { rebate: ['Yes'] } },
  { section: 'Rebate & Programs', key: 'rebateAmount',     label: 'Dollar Amount for Rebate', type: 'text', placeholder: '$', showIf: { rebate: ['Yes'] } },
  { section: 'Rebate & Programs', key: 'specialization',   label: 'Specialization',           type: 'select', options: ['None', 'MTC', 'MTC/LND', 'MTC/LNFD', 'LND LEASE'] },
  { section: 'Rebate & Programs', key: 'competitiveModel', label: 'Competitive Model',        type: 'text', placeholder: 'e.g. Kubota SVL75' },
  { section: 'Rebate & Programs', key: 'drSubmission',     label: 'DR Submission',            type: 'select', options: ['No', 'Yes'] },
  { section: 'Rebate & Programs', key: 'spiff',            label: 'Spiff?',                   type: 'select', options: ['No', 'Yes'] },
  { section: 'Rebate & Programs', key: 'spiffAmount',      label: 'Amount for Spiff',         type: 'text', placeholder: 'e.g. New Customer $1000', showIf: { spiff: ['Yes'] } },

  { section: 'Trade-In', key: 'trade',              label: 'Trade?',                              type: 'select', options: ['No', 'Yes'] },
  { section: 'Trade-In', key: 'tradeOptions',       label: 'Options',                             type: 'text', placeholder: 'Year, model, S/N, cab, attachments', showIf: { trade: ['Yes'] } },
  { section: 'Trade-In', key: 'tradeHours',         label: 'Hours',                               type: 'number', showIf: { trade: ['Yes'] } },
  { section: 'Trade-In', key: 'tradeSerial',        label: 'S/N',                                 type: 'text', showIf: { trade: ['Yes'] } },
  { section: 'Trade-In', key: 'tradeBucket',        label: 'Bucket',                              type: 'select', options: ['No', 'Yes'], showIf: { trade: ['Yes'] } },
  { section: 'Trade-In', key: 'tradeBucketDesc',    label: 'Bucket Description',                  type: 'text', showIf: { tradeBucket: ['Yes'] } },
  { section: 'Trade-In', key: 'overAllowance',      label: 'Over allowance Amount',               type: 'text', placeholder: '$', showIf: { trade: ['Yes'] } },
  { section: 'Trade-In', key: 'tradeEinNotes',      label: 'Trade EIN - Notes',                   type: 'text', showIf: { trade: ['Yes'] } },
  { section: 'Trade-In', key: 'payoffNeeded',       label: 'Payoff Needed for Customer Trade-In', type: 'select', options: ['No', 'Yes'], showIf: { trade: ['Yes'] } },
  { section: 'Trade-In', key: 'payoffInstitution',  label: 'Financial Institution for Payoff',    type: 'text', showIf: { payoffNeeded: ['Yes'] } },
  { section: 'Trade-In', key: 'payoffAmount',       label: 'Amount Needed for Payoff',            type: 'text', placeholder: '$', showIf: { payoffNeeded: ['Yes'] } },

  { section: 'Other', key: 'expectedMargin', label: 'Expected Profit Margin', type: 'text', placeholder: 'e.g. 18% or 4.55% - 1595.86' },
  { section: 'Other', key: 'notes',          label: 'Notes',                  type: 'textarea', placeholder: 'Anything the back office needs — docs filed, commission, special pricing' }
];

export const BACK_OFFICE_FIELDS = [
  { key: 'assignedTo',     label: 'Assigned To',            type: 'text' },
  { key: 'irwDraft',       label: 'IRW Draft',              type: 'text' },
  { key: 'retailClaim',    label: 'Retail Claim Number',    type: 'text' },
  { key: 'adminMargin',    label: 'Admin. Profit Margin',   type: 'text' },
  { key: 'testing',        label: 'Testing',                type: 'text' },
  { key: 'sold',           label: 'Sold?',                  type: 'select', options: ['No', 'Yes'] },
  { key: 'soldTo',         label: 'Sold To Customer',       type: 'text', showIf: { sold: ['Yes'] } },
  { key: 'completionDate', label: 'Completion Date',        type: 'date' },
  { key: 'punchNotes',     label: 'Punch Notes',            type: 'textarea' }
];

/** Is a showIf-gated field currently visible, given the other answers? */
export function isFieldShown(field, values) {
  if (!field.showIf) return true;
  return Object.entries(field.showIf).every(([k, allowed]) => {
    const v = (values || {})[k];
    // A multi-select answer shows the field when any picked option matches.
    return Array.isArray(v) ? v.some(x => allowed.includes(x)) : allowed.includes(v);
  });
}

/**
 * Drop answers to questions that are no longer shown — e.g. a lender left
 * behind after switching the deal to Cash — so the saved record and the email
 * only carry what applies. Runs until stable because hiding one field can hide
 * another (Trade? No hides Payoff Needed, which hides the payoff fields).
 */
export function pruneHiddenAnswers(fields, values) {
  let out = { ...(values || {}) };
  for (let pass = 0; pass < fields.length; pass++) {
    let changed = false;
    for (const f of fields) {
      if (!isFieldShown(f, out) && out[f.key] !== undefined && out[f.key] !== '') {
        out[f.key] = ''; changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

export function validateSalesRequest(form) {
  const errors = {};
  for (const f of SALES_REQUEST_FIELDS) {
    if (!isFieldShown(f, form)) continue;
    if (f.required && !String((form && form[f.key]) || '').trim()) errors[f.key] = 'Required';
  }
  if (form && form.tradeHours !== undefined && String(form.tradeHours).trim() !== '') {
    const h = Number(form.tradeHours);
    if (!Number.isFinite(h) || h < 0) errors.tradeHours = 'A number of hours';
  }
  return errors;
}

/* ===================== SALES REQUESTS (operations) ===================== */
// Indy's "Bobcat of Indy Sales Request" sheet: a request to the back office to
// move or prep something. NOT the Sales Submittal (the deal paperwork above).
// A lead can have several requests, and many have no lead at all (moving a
// unit between stores). Stored in their own `requests` collection.
//
// Field list reconstructed from the form screenshots plus the 3,496-row
// "Sales Request Completed" export (the screenshots cut off the middle).

export const REQUEST_TYPES = ['Delivery', 'Demo Equipment', '"Get Ready"', 'Parts', 'Pick Up', 'Service'];

// Indy's location codes, mapped to branch names so a request can default to
// the lead's branch. M5 is not on the form.
export const EXTERNAL_LOCATION = 'External Customer';
export const FROM_LOCATIONS = [
  { code: 'M1', label: 'M1 (Indy)',         branch: 'Indy' },
  { code: 'M2', label: 'M2 (Anderson)',     branch: 'Anderson' },
  { code: 'M3', label: 'M3 (Indy North)',   branch: 'Indy North' },
  { code: 'M4', label: 'M4 (Ellettsville)', branch: 'Ellettsville' },
  { code: 'M6', label: 'M6 (Columbus)',     branch: 'Columbus' },
  { code: 'EXT', label: EXTERNAL_LOCATION,  branch: null }
];
const LOCATION_LABELS = FROM_LOCATIONS.map(l => l.label);

export function fromLocationForBranch(branch) {
  const hit = FROM_LOCATIONS.find(l => l.branch && l.branch === branch);
  return hit ? hit.label : '';
}

const involvesExternal = (v) => v.fromLocation === EXTERNAL_LOCATION || v.toLocation === EXTERNAL_LOCATION;
const hasType = (...types) => (v) => Array.isArray(v.requestTypes) && v.requestTypes.some(t => types.includes(t));

// `showWhen` is a predicate over the answers so far (the Submittal's showIf is
// value-matching; requests need "any of these types" and "either location").
export const REQUEST_FIELDS = [
  { key: 'requestDate',      label: 'Request Date',      type: 'date',  required: true },
  { key: 'salesPerson',      label: 'Sales Person',      type: 'user',  required: true },
  { key: 'requestTypes',     label: 'Request Type',      type: 'multi', required: true, options: REQUEST_TYPES },
  { key: 'fromLocation',     label: 'From Location',     type: 'radio', required: true, options: LOCATION_LABELS },
  { key: 'toLocation',       label: 'To Location',       type: 'radio', options: LOCATION_LABELS },
  { key: 'customerName',     label: 'Customer Name',     type: 'text',  requiredWhen: involvesExternal, showWhen: involvesExternal },
  { key: 'customerAddress',  label: 'Customer Address',  type: 'textarea', requiredWhen: v => v.toLocation === EXTERNAL_LOCATION, showWhen: involvesExternal, placeholder: 'Street, city, ZIP' },
  { key: 'dateNeeded',       label: 'Date Needed By',    type: 'date',  required: true },
  { key: 'equipmentRequest', label: 'Equipment Request', type: 'textarea', placeholder: 'Model – EIN – serial, one unit or attachment per line' },
  { key: 'serviceRequest',   label: 'Service Request',   type: 'textarea', showWhen: hasType('Service', '"Get Ready"'), placeholder: 'PDI, install cutting edge, fix wiring…' },
  { key: 'partsRequest',     label: 'Parts Request',     type: 'textarea', showWhen: hasType('Parts') },
  { key: 'comments',         label: 'Additional Comments', type: 'textarea', placeholder: 'Please provide any additional information if necessary' }
];

export function isRequestFieldShown(field, values) {
  return !field.showWhen || field.showWhen(values || {});
}

export function validateRequest(form) {
  const v = form || {};
  const errors = {};
  for (const f of REQUEST_FIELDS) {
    if (!isRequestFieldShown(f, v)) continue;
    const required = f.required || (f.requiredWhen && f.requiredWhen(v));
    const val = v[f.key];
    const empty = Array.isArray(val) ? val.length === 0 : !String(val ?? '').trim();
    if (required && empty) errors[f.key] = f.type === 'multi' ? 'Pick at least one' : 'Required';
  }
  if (v.requestDate && v.dateNeeded && v.dateNeeded < v.requestDate) {
    errors.dateNeeded = 'Can’t be before the request date';
  }
  return errors;
}

/** Blank out answers to questions no longer shown (e.g. an address left after switching to an internal move). */
export function pruneRequest(values) {
  const out = { ...(values || {}) };
  for (const f of REQUEST_FIELDS) if (!isRequestFieldShown(f, out)) out[f.key] = '';
  return out;
}

// The back office completes a request department by department, as on the
// Smartsheet: Rental (the yard: deliveries, pick-ups, demos), Service (get
// ready, service) and Parts. Which departments a request needs follows from its
// types; the request is Completed when every one of those has checked off.
export const REQUEST_DEPARTMENTS = [
  { key: 'rental',  label: 'Rental',  types: ['Delivery', 'Pick Up', 'Demo Equipment'] },
  { key: 'service', label: 'Service', types: ['Service', '"Get Ready"'] },
  { key: 'parts',   label: 'Parts',   types: ['Parts'] }
];

export function departmentsFor(requestTypes) {
  const types = Array.isArray(requestTypes) ? requestTypes : [];
  return REQUEST_DEPARTMENTS.filter(d => d.types.some(t => types.includes(t))).map(d => d.key);
}

export const REQUEST_STATUSES = ['Open', 'In Progress', 'Completed', 'Cancelled'];
export const OPEN_REQUEST_STATUSES = ['Open', 'In Progress'];

/**
 * Status follows the check-offs: none -> Open, some -> In Progress, every
 * involved department -> Completed. Cancelled is only ever set by hand and
 * sticks until reopened.
 */
export function requestStatusFromDone(requestTypes, done, current) {
  if (current === 'Cancelled') return 'Cancelled';
  const needed = departmentsFor(requestTypes);
  const d = done || {};
  const count = needed.filter(k => d[k]).length;
  if (needed.length > 0 && count === needed.length) return 'Completed';
  return count > 0 || Object.values(d).some(Boolean) ? 'In Progress' : 'Open';
}

/**
 * Who sees a request: admins (the back office) see all; a rep sees requests
 * where they are the sales person or which they entered.
 */
export function isRequestVisible(req, viewer) {
  if (!req || !viewer) return false;
  if (viewer.role === 'admin') return true;
  return req.salesPerson === viewer.id || req.createdBy === viewer.id;
}

/** A rep can only cancel their own open request; the back office does the rest. */
export function requestStatusOptionsFor(current, isAdmin) {
  if (isAdmin) return REQUEST_STATUSES;
  return OPEN_REQUEST_STATUSES.includes(current) ? [current, 'Cancelled'] : [current];
}

/* ===================== TRADE-IN EVALUATION ===================== */
// Indy's "Trade-In Evaluation" form: the rep inspects the customer's machine;
// a sales manager (admin) sets the value and approves. Stored in `tradeIns`,
// linked to a lead when there is one. Ratings are 1 (poor) to 5 (excellent).

export const TRADE_MAKES = ['Bobcat', 'Kubota', 'John Deere', 'CAT', 'Case', 'New Holland', 'Takeuchi', 'Wacker Neuson', 'Can-Am', 'Other'];
export const TRADE_MACHINE_OPTIONS = ['Cab', 'Heat', 'A/C', '2 Speed', 'Keyless', 'Radio', 'SJC', 'Hand/Foot Control', 'Clamp', 'Arm', 'Miscellaneous'];
export const RATING_OPTIONS = ['1', '2', '3', '4', '5', 'N/A'];
export const TRADE_CONDITIONS = [
  { key: 'paint',      label: 'Paint' },
  { key: 'decal',      label: 'Decal' },
  { key: 'pinBushing', label: 'Pin/Bushing' },
  { key: 'bobtach',    label: 'Bobtach/X-Change' },
  { key: 'interior',   label: 'Interior' },
  { key: 'tiresTracks', label: 'Rubber Tires/Tracks' },
  { key: 'sprocket',   label: 'Sprocket' },
  { key: 'idler',      label: 'Idler' },
  { key: 'attachment', label: 'Attachment' }
];

export const TRADE_IN_FIELDS = [
  { section: 'Machine', key: 'make',           label: 'Make',          type: 'select', required: true, options: TRADE_MAKES },
  { section: 'Machine', key: 'model',          label: 'Model',         type: 'text',   required: true },
  { section: 'Machine', key: 'year',           label: 'Year',          type: 'number', required: true },
  { section: 'Machine', key: 'serial',         label: 'Serial Number', type: 'text',   required: true },
  { section: 'Machine', key: 'hours',          label: 'Hour Meter',    type: 'number', required: true },
  { section: 'Machine', key: 'machineOptions', label: 'Machine Options', type: 'multi', options: TRADE_MACHINE_OPTIONS },
  { section: 'Machine', key: 'miscOptions',    label: 'Miscellaneous Options (Please explain)', type: 'text', showIf: { machineOptions: ['Miscellaneous'] } },
  { section: 'Machine', key: 'attachmentsIncluded', label: 'Attachments Included?', type: 'select', required: true, options: ['Yes', 'No'] },
  // Not `attachments` — that name holds the uploaded files on every record.
  { section: 'Machine', key: 'attachmentsDetail', label: 'Attachments (Please explain)', type: 'text', showIf: { attachmentsIncluded: ['Yes'] } },
  ...TRADE_CONDITIONS.map(c => ({ section: 'Condition', key: c.key, label: `${c.label} Condition`, type: 'rating', required: true, options: RATING_OPTIONS })),
  { section: 'Notes', key: 'operationalNotes', label: 'Operational Notes', type: 'text', placeholder: 'e.g. Y, Y, Y, N, N' },
  { section: 'Notes', key: 'finalComments',    label: 'Final Comments',    type: 'textarea' }
];
export const TRADE_IN_SECTIONS = ['Machine', 'Condition', 'Notes'];

export const TRADE_IN_MANAGER_FIELDS = [
  { key: 'tradeInValue',    label: 'Trade-In Value',          type: 'text', placeholder: '$' },
  { key: 'approved',        label: 'Approved',                type: 'select', options: ['Yes', 'No'] },
  { key: 'managerComments', label: 'Sales Manager Comments',  type: 'textarea' }
];

export function tradeInStatus(t) {
  const a = t && t.manager && t.manager.approved;
  if (a === 'Yes') return 'Approved';
  if (a === 'No') return 'Declined';
  return 'Awaiting Approval';
}

export function validateFields(fields, form) {
  const errors = {};
  for (const f of fields) {
    if (!isFieldShown(f, form)) continue;
    const v = form ? form[f.key] : undefined;
    const empty = Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim();
    if (f.required && empty) errors[f.key] = f.type === 'multi' ? 'Pick at least one' : 'Required';
    if (!empty && f.type === 'number' && !Number.isFinite(Number(v))) errors[f.key] = 'A number';
  }
  return errors;
}

/* ===================== FINANCE (Sales Tracker) ===================== */
// Indy's "Bobcat of Indy Sales Tracker": the finance team's funding pipeline
// for financed deals. The rep's half is what they submit; the finance half is
// worked by the sales admin (admins in the app). Stored in `finance`, linked
// to a lead. A Sales Submittal with financing creates one automatically,
// pre-filled from the submittal (financeFromSubmittal).

export const FINANCE_DEAL_STATUSES = [
  'Submitted', 'Approved', 'Manual Review', 'Additional Info Needed', 'Declined',
  'Declined, Sent to 2nd Source', 'Ready to Invoice', 'Invoiced-Pending Funding', 'Invoice-Funded'
];
export const FINANCE_CLOSED_STATUSES = ['Declined', 'Invoice-Funded'];
export const READY_TO_INVOICE = 'Ready to Invoice';

export const FINANCE_REP_FIELDS = [
  { key: 'customerName',   label: 'Customer Name',       type: 'text', required: true },
  { key: 'preludeNumber',  label: 'Prelude Customer #',  type: 'text' },
  { key: 'salesRepNumber', label: 'SalesRep #',          type: 'text', placeholder: 'e.g. Alex Vasquez #819' },
  { key: 'assetToFinance', label: 'Asset To Finance',    type: 'text', required: true, placeholder: 'e.g. T450 w/ Bucket' },
  { key: 'unitStatus',     label: 'Unit Status',         type: 'select', required: true, options: ['In Stock', 'Order'] },
  { key: 'orderNumber',    label: 'Order #',             type: 'text', showIf: { unitStatus: ['Order'] } },
  { key: 'amount',         label: 'Amount',              type: 'text', required: true, placeholder: '$' },
  { key: 'dealType',       label: 'Deal Type',           type: 'select', required: true, options: ['Loan', 'Lease', 'Cash', 'RP Conversion Request'] },
  { key: 'creditApp',      label: 'Credit App?',         type: 'select', options: ['Yes', 'No'] },
  { key: 'rebates',        label: 'Rebates',             type: 'select', options: ['NONE', 'Cash In Lieu Rebate', 'Mower Rebate', 'Other'] },
  { key: 'salesRepComments', label: 'Sales Rep Comments', type: 'textarea' }
];

export const FINANCE_ADMIN_FIELDS = [
  { key: 'dealStatus',      label: 'Deal Status',        type: 'select', options: FINANCE_DEAL_STATUSES },
  { key: 'salesAdmin',      label: 'Sales Admin Name',   type: 'text' },
  { key: 'lenderName',      label: 'Lender Name',        type: 'text', suggestions: ['Aux Capital', 'PNC', 'WF', 'Commercial Capital', 'Sheffield', 'CASH', 'WIRE'] },
  { key: 'term',            label: 'Term # of months',   type: 'select', options: ['12', '24', '36', '48', '60', '72', '84', 'CASH'] },
  { key: 'autoApproved',    label: 'Auto Approved',      type: 'select', options: ['Yes', 'No'] },
  { key: 'approvedDate',    label: 'Approved Date',      type: 'date' },
  { key: 'resubmitApproval', label: 'Resubmit Approval', type: 'text' },
  { key: 'docsPreparedDate', label: 'Docs Prepared Date', type: 'date' },
  { key: 'docsToRepDate',   label: 'Docs to Rep Date',   type: 'date' },
  { key: 'docsReturnedDate', label: 'Docs Returned Date', type: 'date' },
  { key: 'invoicingDate',   label: 'Date submitted for invoicing', type: 'date' },
  { key: 'docsToLenderDate', label: 'Invoice Date and Docs to Lender Date', type: 'date' },
  { key: 'fundedDate',      label: 'Funded Date',        type: 'date' },
  { key: 'bcOrderNumber',   label: 'BC ORDER #',         type: 'text' },
  { key: 'financeComments', label: 'Finance Comments',   type: 'textarea' }
];

/** Days between two YYYY-MM-DD dates (b defaults to today); null if a is missing. */
export function daysBetween(a, b) {
  if (!a) return null;
  const toUtc = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const end = b || new Date().toISOString().slice(0, 10);
  return Math.round((toUtc(end) - toUtc(a)) / 86400000);
}

/**
 * The tracker's two audit formulas:
 *  - "Audit for 3 days on Ready to Invoice": sat in Ready to Invoice > 3 days.
 *  - "Days Docs to Lender": invoiced but docs not at the lender > 3 days on.
 */
export function financeAudit(rec, today) {
  const f = (rec && rec.admin) || {};
  const issues = [];
  if (f.dealStatus === READY_TO_INVOICE && rec.dealStatusChangedAt) {
    const d = daysBetween(String(rec.dealStatusChangedAt).slice(0, 10), today);
    if (d !== null && d > 3) issues.push(`Ready to Invoice for ${d} days`);
  }
  if (f.invoicingDate && !f.docsToLenderDate) {
    const d = daysBetween(f.invoicingDate, today);
    if (d !== null && d > 3) issues.push(`Docs not to lender ${d} days after invoicing`);
  }
  return issues;
}

/** A Sales Submittal financed with a loan, lease or RP needs a finance deal. */
export function submittalNeedsFinance(sr) {
  return !!sr && ['Loan', 'Lease', 'RP', 'Other Financing'].includes(sr.payment);
}

/** Pre-fill a finance deal from the submittal so the rep doesn't type it twice. */
export function financeFromSubmittal(sr, lead) {
  const lender = sr.loanLender || sr.lease || sr.otherFinancing || '';
  return {
    customerName: sr.customerName || (lead && (lead.companyName || lead.customerName)) || '',
    assetToFinance: sr.model || '',
    unitStatus: 'In Stock',
    amount: sr.estimatedValue || '',
    dealType: sr.payment === 'RP' ? 'RP Conversion Request' : (sr.payment === 'Other Financing' ? 'Loan' : sr.payment),
    creditApp: '',
    rebates: sr.rebate === 'Yes' ? (sr.rebateType === 'Cash in lieu of financing' ? 'Cash In Lieu Rebate' : 'Other') : 'NONE',
    salesRepComments: lender ? `Lender on submittal: ${lender}` : ''
  };
}

export function isOwnRecordVisible(rec, viewer) {
  if (!rec || !viewer) return false;
  if (viewer.role === 'admin') return true;
  return rec.salesPerson === viewer.id || rec.createdBy === viewer.id;
}

/* ===================== ATTACHMENTS ===================== */
// Files on leads, Sales Submittals, Sales Requests and Trade-In Evaluations,
// stored in Firebase Storage under attachments/<owner>/… (see
// src/lib/attachments.js). storage.rules enforces the same size and type
// limits server-side — keep ATTACHMENT_TYPE_PATTERN in step with it.
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 10;   // per upload
export const ATTACHMENT_TYPE_PATTERN =
  /^(image\/.+|application\/pdf|text\/plain|text\/csv|application\/msword|application\/vnd\.openxmlformats-officedocument\..+|application\/vnd\.ms-excel|application\/vnd\.ms-powerpoint)$/;
export const ATTACHMENT_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt';

// Browsers leave `type` blank for some files (HEIC photos from older phones,
// Office files on some systems); fill it in from the extension so the rule
// check and Storage both see a real content type.
const EXT_TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
export function attachmentContentType(file) {
  if (file && file.type) return file.type;
  const ext = String((file && file.name) || '').split('.').pop().toLowerCase();
  return EXT_TYPES[ext] || '';
}

/** Why a file can't be attached, or null if it can. */
export function checkAttachment(file) {
  if (!file) return 'No file';
  if (!file.size) return 'The file is empty';
  if (file.size > ATTACHMENT_MAX_BYTES) return `Over the ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB limit`;
  if (!ATTACHMENT_TYPE_PATTERN.test(attachmentContentType(file))) return 'Only photos, PDFs and Office documents';
  return null;
}

/** A Storage-safe file name that still reads like the original. */
export function safeFileName(name) {
  const cleaned = String(name || 'file').replace(/[^\w.\- ()]+/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(-120);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
