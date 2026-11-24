// src/lib/todo.js
//
// Follow Ups (was "To Do"; renamed Nov 2026 for Derek): everything that needs
// someone's attention, worked
// out from the leads and records the LMT already holds. Pure — no React, no
// Firebase — so scripts/test-helpers.mjs can import it under plain node.
//
// A rep's list is about leads they own (primary assignee). Admins also get a
// Back Office list: submittals to complete, trade-ins to approve, requests due,
// and finance audit flags.

import {
  WON_STATUS, NEW_STATUS, WORKING_STATUS, PENDING_STATUS, PROSPECT_STATUS, OPEN_REQUEST_STATUSES, tradeInStatus,
  submittalStatus, SUBMITTAL_OPEN, submittalNeedsFinance, leadTemperature
} from './pipeline.js';

/* ===================== SALES DEAL PAPERWORK ===================== */
// What a done deal needs on file. A document counts as received when a file
// was uploaded as that document (attachment.docType) or someone ticked it off
// as a paper copy (salesRequest.docs[key]). The credit application is only
// asked for on financed deals.
export const SUBMITTAL_DOCS = [
  { key: 'purchaseAgreement', label: 'Signed purchase agreement' },
  { key: 'creditApp',         label: 'Credit application', when: (sr) => submittalNeedsFinance(sr) },
  { key: 'customerId',        label: 'Customer ID / tax exemption' },
  { key: 'delivery',          label: 'Delivery / warranty forms' }
];

export function submittalDocStatus(lead) {
  const sr = lead && lead.salesRequest;
  if (!sr) return [];
  const files = Array.isArray(lead.attachments) ? lead.attachments : [];
  const ticks = sr.docs || {};
  return SUBMITTAL_DOCS
    .filter(d => !d.when || d.when(sr))
    .map(d => {
      const file = files.find(f => f && f.docType === d.key);
      const tick = ticks[d.key] && ticks[d.key].receivedAt ? ticks[d.key] : null;
      return { key: d.key, label: d.label, received: !!(file || tick), file: file || null, tick };
    });
}

export function missingSubmittalDocs(lead) {
  return submittalDocStatus(lead).filter(d => !d.received);
}

/* ===================== DATES ===================== */
const DAY = 86400e3;
// Local calendar date as YYYY-MM-DD (the browser's day, not UTC's).
export function ymd(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function daysBetween(a, b) {
  const pa = Date.parse(a + 'T00:00:00'), pb = Date.parse(b + 'T00:00:00');
  return Number.isFinite(pa) && Number.isFinite(pb) ? Math.round((pb - pa) / DAY) : null;
}
export function dueLabel(dateYmd, today) {
  const d = daysBetween(dateYmd, today);
  if (d === null) return '';
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d > 1) return `${d} days overdue`;
  return d === -1 ? 'Tomorrow' : `In ${-d} days`;
}

/* ===================== FOLLOW-UP DATES ===================== */
// Set by the rep on a lead: lead.followUp = { date: 'YYYY-MM-DD', note, setBy, setAt }.
export function followUpDue(lead, today) {
  const f = lead && lead.followUp;
  return !!(f && f.date && f.date <= today);
}

/* ===================== FOLLOW-UP SCHEDULE (Derek, Nov 2026) ===================== */
// Every lead a rep is working gets a check-in on a schedule set by how hot it
// is — no emails, it shows in Follow Ups:
//   Hot       the next day, then every week
//   Warm      once a month
//   Cold      every 3 months
//   Prospect  every 6 months
//   Wanted    none (we don't have it; the list is for reference)
// Each can be switched off in Settings → Notifications → Follow Ups
// (config.notifications.followUpCadence = { hot, warm, cold, prospect }; absent = on).
// The clock restarts whenever someone touches the lead: Done on a follow-up,
// a note, a status or temperature change. A follow-up date set by hand on
// the lead takes over until it's done.
export const CADENCE = [
  { id: 'hot',      label: 'Hot',      first: 1, every: 7,   hint: 'The next day, then every week' },
  { id: 'warm',     label: 'Warm',     every: 30,            hint: 'Once a month' },
  { id: 'cold',     label: 'Cold',     every: 91,            hint: 'Every 3 months' },
  { id: 'prospect', label: 'Prospect', every: 182,           hint: 'Every 6 months' }
];
export function cadenceSettings(config) {
  const c = (config && config.notifications && config.notifications.followUpCadence) || {};
  return Object.fromEntries(CADENCE.map(k => [k.id, c[k.id] !== false]));
}

// Which schedule a lead is on: Working / Pending Deals by temperature (none set
// = Warm), Prospect status = prospect; everything else (New, Wanted, done,
// dead…) none.
export function cadenceKind(lead) {
  if (!lead) return null;
  if (lead.status === WORKING_STATUS || lead.status === PENDING_STATUS) {
    const t = leadTemperature(lead);
    return t ? t.toLowerCase() : 'warm';
  }
  if (lead.status === PROSPECT_STATUS) return 'prospect';
  return null;
}

const ms = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };
// The last time a person did something on the lead.
function noteTimes(lead) {
  return (Array.isArray(lead.internalComments) ? lead.internalComments : [])
    .filter(c => c && !c.isSystem && c.author !== 'system').map(c => ms(c.timestamp));
}
export function lastTouchAt(lead) {
  return Math.max(0, ms(lead.followUpDoneAt), ms(lead.statusChangedAt), ms(lead.temperatureSetAt),
    ms(lead.processedAt), ms(lead.createdDate), ...noteTimes(lead));
}

// → { kind, dueAt (ms) } or null.
export function cadenceDue(lead, config) {
  const kind = cadenceKind(lead);
  if (!kind || !cadenceSettings(config)[kind]) return null;
  if (lead.followUp && lead.followUp.date) return null;      // a date set by hand wins
  const k = CADENCE.find(c => c.id === kind);
  const last = lastTouchAt(lead);
  if (!last) return null;
  if (k.first) {
    // Hot: the day after it became hot, unless someone has followed up since.
    const since = Math.max(ms(lead.temperatureSetAt), ms(lead.processedAt), ms(lead.statusChangedAt), ms(lead.createdDate));
    const touched = Math.max(ms(lead.followUpDoneAt), ...noteTimes(lead), 0) > since;
    if (!touched) return { kind, dueAt: since + k.first * DAY };
  }
  return { kind, dueAt: last + k.every * DAY };
}

/* ===================== THE LIST ===================== */
const leadName = (l) => l.customerName || l.companyName || 'Unnamed lead';
const isAssignedTo = (l, repId) => repId === '*' ? (l.assignedTo && l.assignedTo !== 'u_1') : l.assignedTo === repId;

export const TODO_SECTIONS = [
  { id: 'process',   label: 'New leads to process' },
  { id: 'followup',  label: 'Follow-up dates you set' },
  { id: 'cadence',   label: 'Check-ins due' },
  { id: 'paperwork', label: 'Missing paperwork' },
  { id: 'postsale',  label: '30-day check-in' },
  { id: 'submittal', label: 'Sales Submittals to complete', backOffice: true },
  { id: 'tradein',   label: 'Trade-ins to approve',         backOffice: true },
  { id: 'request',   label: 'Sales Requests due',           backOffice: true }
];

// "Sort by Hot → Warm → Cold → Prospect" (Derek): each item's group.
export const TEMP_GROUPS = [
  { id: 'Hot', label: 'Hot' }, { id: 'Warm', label: 'Warm' }, { id: 'Cold', label: 'Cold' },
  { id: 'Prospect', label: 'Prospect' }, { id: 'Other', label: 'Everything else' }
];
export function tempGroupOf(lead) {
  if (!lead) return 'Other';
  if (lead.status === PROSPECT_STATUS) return 'Prospect';
  return leadTemperature(lead) || 'Other';
}

/**
 * @param {object}   o
 * @param {object[]} o.leads       every lead the viewer may see (junk/archived fine — filtered here)
 * @param {object}   o.records     { requests, tradeIns, finance } the viewer may see
 * @param {string}   o.repId       whose lead items: a user id, or '*' for every rep
 * @param {boolean}  o.backOffice  include the back-office sections (admins)
 * @param {string}   o.today       YYYY-MM-DD
 * @param {number}   o.now         ms
 * @returns {object[]} items: { id, section, title, subtitle, due, overdue, leadId, recordKind, recordId, assignedTo, missing }
 */
export function buildTodos({ leads = [], records = {}, repId, backOffice = false, today, now = Date.now(), config = null }) {
  const items = [];
  const live = leads.filter(l => l && l.status !== 'Junk');
  const comeIn = (l) => {
    const at = ms(l.createdDate || l.dateSubmitted || l.dateAssigned);
    const days = at ? Math.floor((now - at) / DAY) : null;
    return days === null ? '' : days < 1 ? 'Came in today' : `Came in ${days} day${days === 1 ? '' : 's'} ago`;
  };

  // New leads nobody owns yet: admins (back office on) see them to assign.
  if (backOffice) {
    for (const l of live) {
      if (l.status !== NEW_STATUS || (l.assignedTo && l.assignedTo !== 'u_1')) continue;
      items.push({ id: `process:${l.id}`, section: 'process', leadId: l.id, assignedTo: null, title: leadName(l), temp: tempGroupOf(l),
        subtitle: ['Unassigned', l.phone, l.contactEmail].filter(Boolean).join(' · '), due: comeIn(l),
        overdue: now - ms(l.createdDate || l.dateSubmitted) >= DAY, sortKey: String(ms(l.createdDate || l.dateSubmitted)) });
    }
  }

  for (const l of live) {
    if (!isAssignedTo(l, repId)) continue;
    const base = { leadId: l.id, assignedTo: l.assignedTo, title: leadName(l), temp: tempGroupOf(l) };

    // Every day until it's processed (Derek): open it and pick Prospect /
    // Hot / Warm / Cold / Wanted.
    if (l.status === NEW_STATUS) {
      items.push({ ...base, id: `process:${l.id}`, section: 'process',
        subtitle: ['Open it and choose Hot, Warm, Cold, Prospect or Wanted', l.phone].filter(Boolean).join(' · '),
        due: comeIn(l), overdue: now - ms(l.dateAssigned || l.createdDate) >= DAY, sortKey: String(ms(l.dateAssigned || l.createdDate)) });
    }
    const cd = cadenceDue(l, config);
    if (cd && ymd(cd.dueAt) <= today) {
      const k = CADENCE.find(c => c.id === cd.kind);
      const d = ymd(cd.dueAt);
      items.push({ ...base, id: `cadence:${l.id}`, section: 'cadence', cadence: cd.kind,
        subtitle: [`${k.label} — ${k.hint.toLowerCase()}`, l.phone].filter(Boolean).join(' · '),
        due: dueLabel(d, today), overdue: d < today, sortKey: d });
    }

    if (followUpDue(l, today)) {
      items.push({ ...base, id: `followup:${l.id}`, section: 'followup',
        subtitle: l.followUp.note || 'Follow-up date reached', due: dueLabel(l.followUp.date, today),
        overdue: l.followUp.date < today, sortKey: l.followUp.date });
    }
    if (l.salesRequest && submittalStatus(l) === SUBMITTAL_OPEN) {
      const missing = missingSubmittalDocs(l);
      if (missing.length) {
        items.push({ ...base, id: `paperwork:${l.id}`, section: 'paperwork',
          subtitle: `Missing: ${missing.map(d => d.label).join(', ')}`, due: '', overdue: false,
          missing: missing.map(d => d.key), sortKey: l.salesRequest.submittedAt || '' });
      }
    }
    if (l.status === WON_STATUS && !l.postSaleFollowUpDoneAt) {
      const done = Date.parse(l.completedAt || l.statusChangedAt || '');
      const age = Number.isFinite(done) ? (now - done) / DAY : null;
      if (age !== null && age >= 30 && age < 90) {
        items.push({ ...base, id: `postsale:${l.id}`, section: 'postsale',
          subtitle: 'Completed a month ago — check in with the customer', due: `${Math.floor(age)} days since completed`,
          overdue: false, sortKey: String(done) });
      }
    }
  }

  if (backOffice) {
    for (const l of live) {
      if (!l.salesRequest || submittalStatus(l) !== SUBMITTAL_OPEN) continue;
      const missing = missingSubmittalDocs(l);
      const sub = l.salesRequest.submittedAt ? String(l.salesRequest.submittedAt).slice(0, 10) : '';
      items.push({ id: `submittal:${l.id}`, section: 'submittal', leadId: l.id, assignedTo: l.assignedTo,
        title: l.salesRequest.customerName || leadName(l),
        subtitle: [l.salesRequest.model, missing.length ? `${missing.length} document${missing.length === 1 ? '' : 's'} missing` : 'Paperwork complete'].filter(Boolean).join(' · '),
        due: sub ? `Submitted ${dueLabel(sub, today).toLowerCase().replace(' overdue', ' ago')}` : '', overdue: false,
        missing: missing.map(d => d.key), sortKey: sub });
    }
    for (const t of records.tradeIns || []) {
      if (tradeInStatus(t) !== 'Awaiting Approval') continue;
      items.push({ id: `tradein:${t.id}`, section: 'tradein', recordKind: 'tradeIns', recordId: t.id, leadId: t.leadId || null,
        assignedTo: t.salesPerson, title: [t.year, t.make, t.model].filter(Boolean).join(' ') || 'Trade-in',
        subtitle: [t.customerName, t.serial && `S/N ${t.serial}`].filter(Boolean).join(' · '), due: '', overdue: false, sortKey: t.createdAt || '' });
    }
    for (const r of records.requests || []) {
      if (!OPEN_REQUEST_STATUSES.includes(r.status) || !r.dateNeeded || r.dateNeeded > today) continue;
      items.push({ id: `request:${r.id}`, section: 'request', recordKind: 'requests', recordId: r.id, leadId: r.leadId || null,
        assignedTo: r.salesPerson, title: (r.requestTypes || []).join(', ') || 'Sales request',
        subtitle: [r.customerName, r.fromLocation && `${r.fromLocation}${r.toLocation ? ' → ' + r.toLocation : ''}`].filter(Boolean).join(' · '),
        due: dueLabel(r.dateNeeded, today), overdue: r.dateNeeded < today, sortKey: r.dateNeeded });
    }
  }

  const order = Object.fromEntries(TODO_SECTIONS.map((s, i) => [s.id, i]));
  return items.sort((a, b) => order[a.section] - order[b.section] || String(a.sortKey).localeCompare(String(b.sortKey)));
}
