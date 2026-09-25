// src/lib/pipeline.js
//
// Bobcat of Indy's four-step sales pipeline. This is the one place that says
// which status belongs to which step. Everything else — the dashboards, their
// counts, the status dropdowns, the tests — reads it from here.
//
//   Incoming -> Working -> Sales Request -> Completed
//
// Indy's own words for a sale are used throughout: a deal that closes is
// "Completed" (the older forks call it "Won"). A rep setting a Working lead to
// Completed is really saying "we got it" — that opens the Sales Submittal and
// the lead goes to Sales Request. It only reaches the Completed step once the
// back office finishes the submittal.
//
// A lead's step is DERIVED from its status, never stored. That is what makes
// "when a lead moves on it leaves the previous step" automatic: one status,
// therefore exactly one step, with no second field to fall out of sync and no
// migration if the mapping changes.
//
// Pure module on purpose — no React, no Firebase — so scripts/test-helpers.mjs
// can import it under plain node. Indy-only: the other forks do not have steps.

export const STAGE_INCOMING      = 'incoming';
export const STAGE_WORKING       = 'working';
export const STAGE_SALES_REQUEST = 'sales-request';
export const STAGE_COMPLETED     = 'completed';
export const STAGE_JUNK          = 'junk';   // not a step; Junk keeps its own tab

export const NEW_STATUS           = 'New';
export const WORKING_STATUS       = 'Working';
export const SALES_REQUEST_STATUS = 'Sales Request';
// The status a finished sale ends in. Named WON_STATUS so the shared report
// code reads the same across forks; Indy's value is 'Completed'.
export const WON_STATUS           = 'Completed';
export const LOST_STATUS          = 'Lost';
export const CANCELLED_STATUS     = 'Cancelled';
export const JUNK_STATUS          = 'Junk';

export const PIPELINE_STAGES = [
  {
    id: STAGE_INCOMING,
    label: 'Incoming',
    view: 'stage-incoming',
    blurb: 'Every new lead lands here. Review it, fill in what is missing, assign a rep.',
    statuses: [NEW_STATUS]
  },
  {
    id: STAGE_WORKING,
    label: 'Working',
    view: 'stage-working',
    blurb: 'Assigned to a rep and being worked.',
    statuses: [WORKING_STATUS, 'Prospect', 'Pending', 'Want']
  },
  {
    id: STAGE_SALES_REQUEST,
    label: 'Sales Request',
    view: 'stage-sales-request',
    blurb: 'Sold by the rep. The sales submittal is with the back office.',
    statuses: [SALES_REQUEST_STATUS]
  },
  {
    id: STAGE_COMPLETED,
    label: 'Completed',
    view: 'stage-completed',
    blurb: 'Finished: completed sales, lost, unqualified or cancelled.',
    statuses: [WON_STATUS, LOST_STATUS, 'Unqualified', CANCELLED_STATUS]
  }
];

// Every status the pipeline needs, in display order, Junk last.
export const PIPELINE_STATUSES = [
  ...PIPELINE_STAGES.flatMap(s => s.statuses),
  JUNK_STATUS
];

export const PIPELINE_CLOSED_STATUSES = [
  ...PIPELINE_STAGES.find(s => s.id === STAGE_COMPLETED).statuses,
  JUNK_STATUS
];

// Statuses the older forks used. Indy never offers them, but a lead carrying one
// (a CSV import, a lead copied across) still has to land in a sensible step.
export const LEGACY_STATUS_STAGE = {
  Contacted:     STAGE_INCOMING,
  Qualified:     STAGE_WORKING,
  Quoted:        STAGE_WORKING,
  Wants:         STAGE_WORKING,     // Indy's first draft of the pipeline
  Won:           STAGE_COMPLETED,   // what every other fork calls Completed
  'No Decision': STAGE_COMPLETED
};

const STAGE_BY_ID = Object.fromEntries(PIPELINE_STAGES.map(s => [s.id, s]));

export function getStage(stageId) {
  return STAGE_BY_ID[stageId] || null;
}

export function stageForView(view) {
  return PIPELINE_STAGES.find(s => s.view === view) || null;
}

/**
 * Which step a status belongs to.
 *
 * Order matters: the fixed mapping wins, then legacy names, then anything an
 * admin marked closed in Settings goes to Completed. An unknown open status —
 * one an admin added — falls back to Incoming, so a lead is never in no step.
 *
 * @param {string} status
 * @param {string[]} [closedStatuses] config.closedStatuses
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
 * The statuses a lead can be moved to from where it is now. This is what keeps
 * the flow one-directional in the dropdowns:
 *
 *   Incoming       -> any Working status, or Lost / Unqualified if it falls through
 *   Working        -> other Working statuses, Completed (which opens the Sales
 *                     Submittal and lands in Sales Request), Lost, Unqualified
 *   Sales Request  -> Completed, back to Working, or Cancelled
 *   Completed      -> other completed statuses, or reopen into Working
 *
 * Only admins (the back office) can mark a Sales Request lead Completed — pass
 * { isAdmin: false } for a rep.
 *
 * Junk is offered everywhere except Sales Request, and a junked lead can go
 * anywhere (restoring it). Custom statuses an admin added are appended so they
 * stay reachable. The current status is always included so a <select> can show it.
 *
 * @param {string} current  the lead's current status
 * @param {string[]} allStatuses  config.statuses
 * @param {string[]} [closedStatuses]  config.closedStatuses
 */
export function statusOptionsFor(current, allStatuses = PIPELINE_STATUSES, closedStatuses = PIPELINE_CLOSED_STATUSES, { isAdmin = true } = {}) {
  const stage = stageOfStatus(current, closedStatuses);
  // Closing out a submittal is the back office's call (admins); a rep can pull
  // it back to Working or cancel it, but not mark it Completed.
  if (stage === STAGE_SALES_REQUEST && !isAdmin) {
    return [SALES_REQUEST_STATUS, WORKING_STATUS, CANCELLED_STATUS];
  }
  const working   = STAGE_BY_ID[STAGE_WORKING].statuses;
  const fellThrough = [LOST_STATUS, 'Unqualified'];
  const completed = STAGE_BY_ID[STAGE_COMPLETED].statuses;

  let base;
  switch (stage) {
    case STAGE_INCOMING:      base = [NEW_STATUS, ...working, ...fellThrough, JUNK_STATUS]; break;
    // Completed from Working is intercepted by the app and routed through the
    // Sales Submittal — see completesViaSalesRequest().
    case STAGE_WORKING:       base = [...working, WON_STATUS, ...fellThrough, JUNK_STATUS]; break;
    case STAGE_SALES_REQUEST: base = [SALES_REQUEST_STATUS, WON_STATUS, WORKING_STATUS, CANCELLED_STATUS]; break;
    case STAGE_COMPLETED:     base = [...completed, WORKING_STATUS, JUNK_STATUS]; break;
    default:                  base = PIPELINE_STATUSES.slice(); // junk: restore anywhere
  }

  const custom = (Array.isArray(allStatuses) ? allStatuses : [])
    .filter(s => !PIPELINE_STATUSES.includes(s) && !LEGACY_STATUS_STAGE[s]);
  const out = [...base, ...(stage === STAGE_SALES_REQUEST ? [] : custom)];
  if (current && !out.includes(current)) out.unshift(current);
  return out.filter((s, i) => out.indexOf(s) === i);
}

/**
 * True when moving a lead from `from` to `to` means "the rep made the sale":
 * Completed chosen on a lead that is still being worked (Incoming or Working).
 * The app opens the Sales Submittal instead of writing Completed, and the lead
 * goes to Sales Request. From Sales Request, Completed is the back office
 * closing it out and is written as-is.
 */
/** Only admins close a submittal out (Sales Request -> Completed). */
export function canCloseSalesRequest(fromStatus, toStatus, isAdmin, closedStatuses = PIPELINE_CLOSED_STATUSES) {
  if (stageOfStatus(fromStatus, closedStatuses) !== STAGE_SALES_REQUEST) return true;
  return toStatus !== WON_STATUS || !!isAdmin;
}

export function completesViaSalesRequest(from, to, closedStatuses = PIPELINE_CLOSED_STATUSES) {
  if (to !== WON_STATUS && to !== SALES_REQUEST_STATUS) return false;
  const stage = stageOfStatus(from, closedStatuses);
  return stage === STAGE_INCOMING || stage === STAGE_WORKING;
}

/**
 * Statuses offered by a dashboard's bulk "Set status…" menu. Anything that
 * needs a form filled in one lead at a time is left out: Sales Request, and
 * Completed on the steps where it would open the Sales Submittal.
 */
export function bulkStatusOptionsFor(stageId, allStatuses, closedStatuses, opts = {}) {
  const stage = STAGE_BY_ID[stageId];
  if (!stage) return [];
  return statusOptionsFor(stage.statuses[0], allStatuses, closedStatuses, opts)
    .filter(s => s !== SALES_REQUEST_STATUS)
    .filter(s => !(s === WON_STATUS && completesViaSalesRequest(stage.statuses[0], s, closedStatuses)));
}

/**
 * Stored config replaces the defaults rather than merging, so a project whose
 * Settings were saved before these statuses existed would be missing them. This
 * puts the pipeline statuses back in order, keeps any custom ones an admin
 * added, drops the legacy names, and makes sure every Completed status counts as
 * closed. Thresholds are only added where the key is absent — an admin's value
 * is never overwritten.
 */
export function ensurePipelineStatuses(config, defaultThresholds = {}) {
  if (!config) return config;
  const stored = Array.isArray(config.statuses) ? config.statuses : [];
  const custom = stored.filter(s => !PIPELINE_STATUSES.includes(s) && !LEGACY_STATUS_STAGE[s]);
  const statuses = [...PIPELINE_STATUSES.filter(s => s !== JUNK_STATUS), ...custom, JUNK_STATUS];

  const storedClosed = Array.isArray(config.closedStatuses) ? config.closedStatuses : [];
  // A pipeline status that isn't a Completed one can never be closed — that
  // would hide a Working lead in the Completed dashboard.
  const customClosed = storedClosed.filter(s => custom.includes(s));
  const closedStatuses = [...PIPELINE_CLOSED_STATUSES, ...customClosed];

  const out = { ...config, statuses, closedStatuses };

  if (out.staleness && out.staleness.thresholds) {
    const th = { ...out.staleness.thresholds };
    let added = false;
    for (const [k, v] of Object.entries(defaultThresholds)) {
      if (!Object.prototype.hasOwnProperty.call(th, k)) { th[k] = v; added = true; }
    }
    if (added) out.staleness = { ...out.staleness, thresholds: th };
  }
  return out;
}

/**
 * Who sees a lead in a dashboard. Admins see everything. A rep sees leads
 * assigned to them (primary or secondary) — plus, in Incoming only, leads nobody
 * owns yet, so they can pick them up.
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
  { key: 'temperature',       label: 'Temperature',            type: 'select', options: ['Hot', 'Warm', 'Cold'] },
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
  return Object.entries(field.showIf).every(([k, allowed]) => allowed.includes((values || {})[k]));
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
