// src/lib/pipeline.js
//
// Bobcat of Indy's four-step sales pipeline. This is the one place that says
// which status belongs to which step. Everything else — the dashboards, their
// counts, the status dropdowns, the tests — reads it from here.
//
//   Incoming -> Working -> Sales Request -> Completed
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
export const WON_STATUS           = 'Won';
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
    statuses: [WORKING_STATUS, 'Pending', 'Prospect', 'Wants']
  },
  {
    id: STAGE_SALES_REQUEST,
    label: 'Sales Request',
    view: 'stage-sales-request',
    blurb: 'Won by the rep. The sales request has gone out and is being completed.',
    statuses: [SALES_REQUEST_STATUS]
  },
  {
    id: STAGE_COMPLETED,
    label: 'Completed',
    view: 'stage-completed',
    blurb: 'Finished: sold, lost, unqualified or cancelled.',
    statuses: [WON_STATUS, 'Lost', 'Unqualified', 'No Decision', CANCELLED_STATUS]
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
  Contacted: STAGE_INCOMING,
  Qualified: STAGE_WORKING,
  Quoted:    STAGE_WORKING
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
 *   Incoming       -> any Working status, or straight to Completed if it falls through
 *   Working        -> other Working statuses, Sales Request, or fall through
 *   Sales Request  -> Won (completed), back to Working, or Cancelled
 *   Completed      -> other completed statuses, or reopen into Working
 *
 * Junk is offered everywhere except Sales Request, and a junked lead can go
 * anywhere (restoring it). Custom statuses an admin added are appended so they
 * stay reachable. The current status is always included so a <select> can show it.
 *
 * @param {string} current  the lead's current status
 * @param {string[]} allStatuses  config.statuses
 * @param {string[]} [closedStatuses]  config.closedStatuses
 */
export function statusOptionsFor(current, allStatuses = PIPELINE_STATUSES, closedStatuses = PIPELINE_CLOSED_STATUSES) {
  const stage = stageOfStatus(current, closedStatuses);
  const working   = STAGE_BY_ID[STAGE_WORKING].statuses;
  const fellThrough = ['Lost', 'Unqualified', 'No Decision'];
  const completed = STAGE_BY_ID[STAGE_COMPLETED].statuses;

  let base;
  switch (stage) {
    case STAGE_INCOMING:      base = [NEW_STATUS, ...working, ...fellThrough, JUNK_STATUS]; break;
    case STAGE_WORKING:       base = [...working, SALES_REQUEST_STATUS, ...fellThrough, JUNK_STATUS]; break;
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
 * Statuses offered by a dashboard's bulk "Set status…" menu. Sales Request is
 * left out on purpose: entering it needs the sales request form, one per lead.
 */
export function bulkStatusOptionsFor(stageId, allStatuses, closedStatuses) {
  const stage = STAGE_BY_ID[stageId];
  if (!stage) return [];
  return statusOptionsFor(stage.statuses[0], allStatuses, closedStatuses)
    .filter(s => s !== SALES_REQUEST_STATUS);
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

// The fields on the sales request form, in order. Shared by the form, the
// detail panel and — as a copy, since there is no shared build — the email in
// functions/index.js (search SALES_REQUEST_FIELDS). Keep the two in step.
export const SALES_REQUEST_FIELDS = [
  { key: 'equipment',    label: 'Equipment / Model', type: 'text', required: true, placeholder: 'e.g. S66 skid steer' },
  { key: 'condition',    label: 'New or Used',       type: 'select', options: ['New', 'Used'] },
  { key: 'stockNumber',  label: 'Stock #',           type: 'text' },
  { key: 'serialNumber', label: 'Serial #',          type: 'text' },
  { key: 'quantity',     label: 'Quantity',          type: 'number' },
  { key: 'salePrice',    label: 'Sale Price',        type: 'text', placeholder: '$' },
  { key: 'tradeIn',      label: 'Trade-In',          type: 'text', placeholder: 'None, or year / make / model / hours' },
  { key: 'financing',    label: 'Financing',         type: 'select', options: ['Cash', 'Bobcat Financial Services', 'Third-party financing', 'Lease', 'TBD'] },
  { key: 'deliveryDate', label: 'Requested Delivery', type: 'date' },
  { key: 'poNumber',     label: 'Customer PO #',     type: 'text' },
  { key: 'notes',        label: 'Notes',             type: 'textarea', placeholder: 'Attachments, delivery details, anything the order desk needs' }
];

export function validateSalesRequest(form) {
  const errors = {};
  for (const f of SALES_REQUEST_FIELDS) {
    if (f.required && !String((form && form[f.key]) || '').trim()) errors[f.key] = 'Required';
  }
  if (form && form.quantity !== undefined && form.quantity !== '') {
    const q = Number(form.quantity);
    if (!Number.isInteger(q) || q < 1) errors.quantity = 'Whole number, 1 or more';
  }
  return errors;
}
