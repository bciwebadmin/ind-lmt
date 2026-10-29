// src/lib/todo.js
//
// The To Do hub (Oct 2026): everything that needs someone's attention, worked
// out from the leads and records the LMT already holds. Pure — no React, no
// Firebase — so scripts/test-helpers.mjs can import it under plain node.
//
// A rep's list is about leads they own (primary assignee). Admins also get a
// Back Office list: submittals to complete, trade-ins to approve, requests due,
// and finance audit flags.

import {
  WON_STATUS, NEW_STATUS, WORKING_STATUS, OPEN_REQUEST_STATUSES, tradeInStatus, financeAudit,
  submittalStatus, SUBMITTAL_OPEN, submittalNeedsFinance
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

/* ===================== THE LIST ===================== */
const leadName = (l) => l.customerName || l.companyName || 'Unnamed lead';
const isAssignedTo = (l, repId) => repId === '*' ? (l.assignedTo && l.assignedTo !== 'u_1') : l.assignedTo === repId;

export const TODO_SECTIONS = [
  { id: 'followup',  label: 'Follow-ups due' },
  { id: 'contact',   label: 'Make contact' },
  { id: 'paperwork', label: 'Missing paperwork' },
  { id: 'deadline',  label: 'Working deadline passed' },
  { id: 'postsale',  label: '30-day check-in' },
  { id: 'submittal', label: 'Sales Submittals to complete', backOffice: true },
  { id: 'tradein',   label: 'Trade-ins to approve',         backOffice: true },
  { id: 'request',   label: 'Sales Requests due',           backOffice: true },
  { id: 'finance',   label: 'Finance flags',                backOffice: true }
];

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
export function buildTodos({ leads = [], records = {}, repId, backOffice = false, today, now = Date.now() }) {
  const items = [];
  const live = leads.filter(l => l && l.status !== 'Junk');

  for (const l of live) {
    if (!isAssignedTo(l, repId)) continue;
    const base = { leadId: l.id, assignedTo: l.assignedTo, title: leadName(l) };

    if (followUpDue(l, today)) {
      items.push({ ...base, id: `followup:${l.id}`, section: 'followup',
        subtitle: l.followUp.note || 'Follow-up date reached', due: dueLabel(l.followUp.date, today),
        overdue: l.followUp.date < today, sortKey: l.followUp.date });
    }
    if (l.status === NEW_STATUS) {
      const at = Date.parse(l.dateAssigned || l.createdDate || '');
      if (Number.isFinite(at) && now - at >= 12 * 3600e3) {
        const days = Math.floor((now - at) / DAY);
        items.push({ ...base, id: `contact:${l.id}`, section: 'contact',
          subtitle: [l.phone, l.contactEmail].filter(Boolean).join(' · ') || 'No contact details',
          due: days >= 1 ? `Assigned ${days} day${days === 1 ? '' : 's'} ago` : 'Assigned today', overdue: days >= 1, sortKey: String(at) });
      }
    }
    if (l.status === WORKING_STATUS && l.workingUntil && Date.parse(l.workingUntil) < now) {
      items.push({ ...base, id: `deadline:${l.id}`, section: 'deadline',
        subtitle: 'Move it on, or extend the working deadline', due: dueLabel(String(l.workingUntil).slice(0, 10), today),
        overdue: true, sortKey: l.workingUntil });
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
    for (const d of records.finance || []) {
      const issues = financeAudit(d, today);
      if (!issues.length) continue;
      items.push({ id: `finance:${d.id}`, section: 'finance', recordKind: 'finance', recordId: d.id, leadId: d.leadId || null,
        assignedTo: d.salesPerson, title: d.customerName || d.assetToFinance || 'Finance deal',
        subtitle: issues.join(' · '), due: '', overdue: true, sortKey: d.dealStatusChangedAt || '' });
    }
  }

  const order = Object.fromEntries(TODO_SECTIONS.map((s, i) => [s.id, i]));
  return items.sort((a, b) => order[a.section] - order[b.section] || String(a.sortKey).localeCompare(String(b.sortKey)));
}
