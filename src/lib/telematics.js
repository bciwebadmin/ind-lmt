// Telematics module — pure rules, no Firebase imports (tested in
// scripts/test-helpers.mjs). See CLAUDE.md → "Telematics".
//
// Step 1 (Nov 2026): the critical code master list. Bobcat labels every
// fault email CRITICAL; this list is where Tanner decides which codes really
// are, so Carter only calls on the ones that matter.

// What the board does with a code. Order = display order.
export const CODE_LEVELS = [
  { id: 'critical',    label: 'Critical',     hint: 'On Carter’s board' },
  { id: 'noncritical', label: 'Non-critical', hint: 'Still lands in New, shown blue' },
  { id: 'ignore',      label: 'Ignore',       hint: 'Still lands in New, shown grey' }
];
export const CODE_LEVEL_IDS = CODE_LEVELS.map(l => l.id);
// A code nobody has classified yet counts as critical until it is reviewed
// (Erin, Nov 2026) — a missed real fault costs more than an extra call.
export const DEFAULT_CODE_LEVEL = 'critical';

// "CRITICAL - M0217" / "WARNING - E00009714" → { severity, code }.
// A bare code ("m0217") parses too. Anything else → null.
export function parsePrimaryCode(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const m = s.match(/^([A-Za-z]+)\s*-\s*([A-Za-z0-9][A-Za-z0-9-]*)$/);
  if (m) return { severity: m[1].toUpperCase(), code: normalizeCode(m[2]) };
  if (/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(s)) return { severity: '', code: normalizeCode(s) };
  return null;
}

export function normalizeCode(code) {
  return String(code == null ? '' : code).trim().toUpperCase();
}

// Codes are the telematicsCodes document ids. Bobcat codes are letters, digits
// and dashes; anything else is rejected rather than escaped.
export function isValidCode(code) {
  const c = normalizeCode(code);
  return c.length >= 2 && c.length <= 40 && /^[A-Z0-9][A-Z0-9-]*$/.test(c);
}

export function codeLevelLabel(level) {
  const l = CODE_LEVELS.find(x => x.id === level);
  return l ? l.label : CODE_LEVELS[0].label;
}

// How the board treats a code. `codesById` maps code → telematicsCodes doc.
// Unknown or unreviewed codes are critical, but say so, so the UI can flag
// them for review.
export function classifyCode(code, codesById = {}) {
  const c = normalizeCode(code);
  const doc = codesById[c];
  if (!doc) return { code: c, level: DEFAULT_CODE_LEVEL, known: false, reviewed: false };
  const level = CODE_LEVEL_IDS.includes(doc.level) ? doc.level : DEFAULT_CODE_LEVEL;
  return { code: c, level, known: true, reviewed: doc.reviewed === true };
}

// The fields a review writes: changing the level (or confirming it) marks the
// code reviewed, by whom and when.
export function reviewPatch(level, userId, now = new Date().toISOString()) {
  const lv = CODE_LEVEL_IDS.includes(level) ? level : DEFAULT_CODE_LEVEL;
  return { level: lv, reviewed: true, reviewedBy: userId || '', reviewedAt: now, updatedAt: now };
}

// The document a seed row (src/lib/telematicsSeed.js) or a hand-added code
// becomes. New codes start critical and unreviewed.
export function newCodeDoc({ code, summary = '', seenCount = 0, topModels = [], lastSeen = '' }, userId, now = new Date().toISOString()) {
  return {
    code: normalizeCode(code),
    summary: String(summary || '').trim(),
    level: DEFAULT_CODE_LEVEL,
    reviewed: false,
    seenCount: Number(seenCount) || 0,
    topModels: Array.isArray(topModels) ? topModels.slice(0, 5) : [],
    lastSeen: lastSeen || '',
    notes: '',
    createdAt: now,
    createdBy: userId || '',
    updatedAt: now
  };
}

// The Code List's filter chips. `filter`: 'all' | 'unreviewed' | a level id.
export function codeMatchesFilter(doc, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'unreviewed') return doc.reviewed !== true;
  return (CODE_LEVEL_IDS.includes(doc.level) ? doc.level : DEFAULT_CODE_LEVEL) === filter;
}

export function codeMatchesQuery(doc, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [doc.code, doc.summary, doc.notes, ...(doc.topModels || [])].join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

export function codeCounts(docs = []) {
  const counts = { all: docs.length, unreviewed: 0 };
  CODE_LEVEL_IDS.forEach(id => { counts[id] = 0; });
  docs.forEach(d => {
    if (d.reviewed !== true) counts.unreviewed++;
    counts[CODE_LEVEL_IDS.includes(d.level) ? d.level : DEFAULT_CODE_LEVEL]++;
  });
  return counts;
}

// Not reviewed first, then most-seen, then by code.
export function sortCodes(docs = []) {
  return [...docs].sort((a, b) =>
    (a.reviewed === true) - (b.reviewed === true)
    || (Number(b.seenCount) || 0) - (Number(a.seenCount) || 0)
    || String(a.code).localeCompare(String(b.code)));
}

/* ===================== STEP 2: CASES, WINS, DESTINATIONS ===================== */
// A case = one machine's critical fault that Carter works. Its board tab is
// derived from `status`, never stored (same rule as leads).

// Two kinds of case (Nov 19, Erin), on two boards with the same process:
// Bobcat's critical fault codes, and its "<n> Hr Service Due" reminders.
// Cases from before the split have no `kind` and are faults.
export const CASE_KINDS = [
  { id: 'fault',   label: 'Fault Codes' },
  { id: 'service', label: 'Service Due' }
];
export function caseKind(c) { return c && c.kind === 'service' ? 'service' : 'fault'; }
// "1500 hr service". KEEP IN STEP with functions/telematicsIntakeRules.js.
export function serviceLabel(c) {
  const n = c && c.service && c.service.interval;
  return n ? `${n} hr service` : 'Service';
}

export const CASE_STATUSES = [
  { id: 'new',       label: 'New' },
  { id: 'working',   label: 'Working' },
  { id: 'sent',      label: 'Sent On' },          // won to Field / Shop: waiting on a work order (Erin, Nov 19: was "Sent to service")
  { id: 'completed', label: 'Completed' },        // work order confirmed, or won to Parts
  { id: 'lost',      label: 'Lost' },
  { id: 'closed',    label: 'Closed' }            // no action needed, duplicate, …
];
export const CASE_STATUS_IDS = CASE_STATUSES.map(s => s.id);
export const OPEN_CASE_STATUSES = ['new', 'working', 'sent'];

export const CASE_TABS = [
  { id: 'new',       label: 'New',             statuses: ['new'] },
  { id: 'working',   label: 'Working',         statuses: ['working'] },
  { id: 'sent',      label: 'Sent On',         statuses: ['sent'] },
  { id: 'completed', label: 'Completed',       statuses: ['completed'] },
  // One archive with filters (Tanner, discovery call).
  { id: 'archive',   label: 'Archive',         statuses: ['lost', 'closed'] }
];

export function caseStatusLabel(status) {
  const s = CASE_STATUSES.find(x => x.id === status);
  return s ? s.label : 'New';
}
export function caseTab(c) {
  const t = CASE_TABS.find(x => x.statuses.includes(c && c.status));
  return t ? t.id : 'new';
}
export function isOpenCase(c) {
  return OPEN_CASE_STATUSES.includes((c && c.status) || 'new');
}

// The tiers of winning (Tanner). Field and Shop wait for a work order on the
// serial (WIP match, step 4); Parts is an email only — no serial to match.
// KEEP IN STEP with functions/telematicsRules.js (a test compares them).
export const WIN_TIERS = [
  { id: 'field', label: 'Field Service',   destKind: 'field',   needsWorkOrder: true  },
  { id: 'shop',  label: 'Shop (in-house)', destKind: 'service', needsWorkOrder: true  },
  { id: 'parts', label: 'Parts',           destKind: 'parts',   needsWorkOrder: false }
];
export function winTier(id) { return WIN_TIERS.find(t => t.id === id) || null; }

export const LOST_REASONS = [
  'Customer declined',
  'Customer fixed it themselves',
  'Couldn’t reach the customer',
  'Already being serviced',
  'Machine sold / not our customer',
  'Went to another dealer',
  'Other'
];
// Service Due cases (Nov 19) — the customer passing on a scheduled service.
export const SERVICE_LOST_REASONS = [
  'Customer declined',
  'Customer does their own maintenance',
  'Couldn’t reach the customer',
  'Already scheduled / being serviced',
  'Machine sold / not our customer',
  'Went to another dealer',
  'Other'
];
export function lostReasonsFor(c) { return caseKind(c) === 'service' ? SERVICE_LOST_REASONS : LOST_REASONS; }
export const CLOSE_REASONS = [
  'No action needed',
  'Code cleared on its own',
  'Duplicate of another case',
  'No work order opened',       // after the bumps and escalation ran out
  'Other'
];

// Who a win is sent to: Settings → Telematics → Destinations. Up to four
// people each, To or CC (Sean, discovery call), so Carter — or whoever covers
// for him — only picks the place, never the people.
export const DESTINATION_KINDS = [
  { id: 'field',   label: 'Field Service' },
  { id: 'service', label: 'Shop Service' },
  { id: 'parts',   label: 'Parts' }
];
export const MAX_DESTINATION_RECIPIENTS = 4;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(e) { return EMAIL_RE.test(String(e || '').trim()); }

// The addresses a destination sends to. Valid addresses only, no repeats, CC
// never repeats a To. A destination with no To but a CC sends To the CC
// (Indy North service until its new hire starts).
// KEEP IN STEP with functions/telematicsRules.js.
export function resolveRecipients(dest) {
  const seen = new Set();
  const pick = (list) => (Array.isArray(list) ? list : [])
    .map(r => String((r && r.email) || '').trim())
    .filter(e => {
      const k = e.toLowerCase();
      if (!isEmail(e) || seen.has(k)) return false;
      seen.add(k); return true;
    });
  let to = pick(dest && dest.to);
  let cc = pick(dest && dest.cc);
  let promotedCc = false;
  if (!to.length && cc.length) { to = cc; cc = []; promotedCc = true; }
  return { to, cc, promotedCc };
}

export function destinationsForTier(tierId, destinations = []) {
  const t = winTier(tierId);
  return t ? destinations.filter(d => d && d.kind === t.destKind) : [];
}

// Pre-selects the case's own branch, else the first of that kind.
export function suggestedDestination(tierId, branch, destinations = []) {
  const list = destinationsForTier(tierId, destinations);
  return list.find(d => branch && d.branch === branch) || list[0] || null;
}

// Problems with the destinations list, for Settings and before a send.
export function destinationProblems(dest) {
  const out = [];
  const all = [...((dest && dest.to) || []), ...((dest && dest.cc) || [])];
  if (!String((dest && dest.name) || '').trim()) out.push('Needs a name');
  if (all.length > MAX_DESTINATION_RECIPIENTS) out.push(`At most ${MAX_DESTINATION_RECIPIENTS} people`);
  all.forEach(r => { if (r && r.email && !isEmail(r.email)) out.push(`“${r.email}” isn’t an email address`); });
  if (!resolveRecipients(dest).to.length) out.push('No one to send to');
  return out;
}

export const assetUrl = (serial) => serial
  ? `https://dealer.bobcat.com/dmiq/AssetDetails/${encodeURIComponent(String(serial).trim().toLowerCase())}`
  : '';
// KEEP IN STEP with functions/telematicsRules.js.
export function mapsUrl(lat, lng) {
  const a = Number(lat), b = Number(lng);
  if (lat === '' || lng === '' || lat == null || lng == null || !isFinite(a) || !isFinite(b)) return '';
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return '';
  return `https://www.google.com/maps/search/?api=1&query=${a},${b}`;
}

// --- Status changes. Each returns { patch, event } — the fields to write and
// the history entry to append (written with arrayUnion).
const ev = (type, userId, now, extra = {}) => ({ id: `h_${now}_${Math.random().toString(36).slice(2, 7)}`, type, at: now, by: userId || '', ...extra });

export function startWorkingChange(userId, now = new Date().toISOString()) {
  return { patch: { status: 'working', statusChangedAt: now, statusChangedBy: userId || '', updatedAt: now }, event: ev('status', userId, now, { to: 'working' }) };
}

export function winChange({ tierId, destination, message = '' }, userId, now = new Date().toISOString()) {
  const tier = winTier(tierId);
  if (!tier) throw new Error('Unknown win tier');
  if (!destination || destination.kind !== tier.destKind) throw new Error('Pick where it goes');
  const status = tier.needsWorkOrder ? 'sent' : 'completed';
  return {
    patch: {
      status, statusChangedAt: now, statusChangedBy: userId || '', updatedAt: now,
      outcome: {
        result: 'won', tier: tier.id, destinationId: destination.id, destinationName: destination.name,
        message: String(message || '').trim().slice(0, 4000),
        sentAt: now, sentBy: userId || '',
        email: { status: 'pending' }
      },
      ...(tier.needsWorkOrder ? {} : { completedAt: now })
    },
    event: ev('won', userId, now, { tier: tier.id, destination: destination.name })
  };
}

export function loseChange({ reason, note = '' }, userId, now = new Date().toISOString()) {
  if (!LOST_REASONS.includes(reason) && !SERVICE_LOST_REASONS.includes(reason)) throw new Error('Pick a reason');
  if (reason === 'Other' && !String(note).trim()) throw new Error('Say why');
  return {
    patch: { status: 'lost', statusChangedAt: now, statusChangedBy: userId || '', updatedAt: now,
      outcome: { result: 'lost', reason, note: String(note).trim().slice(0, 2000), at: now, by: userId || '' } },
    event: ev('lost', userId, now, { reason })
  };
}

export function closeChange({ reason, note = '' }, userId, now = new Date().toISOString()) {
  if (!CLOSE_REASONS.includes(reason)) throw new Error('Pick a reason');
  if (reason === 'Other' && !String(note).trim()) throw new Error('Say why');
  return {
    patch: { status: 'closed', statusChangedAt: now, statusChangedBy: userId || '', updatedAt: now,
      closure: { reason, note: String(note).trim().slice(0, 2000), at: now, by: userId || '' } },
    event: ev('closed', userId, now, { reason })
  };
}

// Until the WIP match (step 4) does it automatically, a person can confirm
// that service opened a work order.
export function confirmWorkOrderChange({ workOrder = '' } = {}, userId, now = new Date().toISOString()) {
  return {
    patch: { status: 'completed', statusChangedAt: now, statusChangedBy: userId || '', updatedAt: now, completedAt: now,
      workOrder: { number: String(workOrder || '').trim().slice(0, 40), confirmedAt: now, confirmedBy: userId || '', source: 'manual' } },
    event: ev('work_order', userId, now, { number: String(workOrder || '').trim().slice(0, 40), source: 'manual' })
  };
}

// Back to Working from any closed state; the earlier outcome stays in history.
export function reopenChange(userId, now = new Date().toISOString()) {
  return { patch: { status: 'working', statusChangedAt: now, statusChangedBy: userId || '', updatedAt: now }, event: ev('reopened', userId, now) };
}

export function noteEntry(text, userId, now = new Date().toISOString()) {
  const t = String(text || '').trim();
  if (!t) return null;
  return { id: `n_${now}_${Math.random().toString(36).slice(2, 7)}`, text: t.slice(0, 4000), at: now, by: userId || '' };
}

// The hand-entered case (step 3 adds the email intake). Returns { errors, doc }.
// f.kind 'service' → a Service Due case (interval, kit number) instead of a fault.
export function buildManualCase(f, userId, now = new Date().toISOString()) {
  const errors = [];
  const isService = f.kind === 'service';
  const serial = String(f.serial || '').trim().toUpperCase();
  const code = isService ? '' : normalizeCode(f.code);
  const interval = String(f.interval || '').trim();
  if (!String(f.customerName || '').trim()) errors.push('Customer name is required.');
  if (!/^[A-Z0-9]{5,20}$/.test(serial)) errors.push('Serial number looks wrong — letters and numbers, e.g. AT6330022.');
  if (code && !isValidCode(code)) errors.push('Fault code looks wrong — e.g. M0217.');
  if (isService && !/^\d{2,6}$/.test(interval)) errors.push('Service interval is required — hours, e.g. 1500.');
  if (f.lat !== '' && f.lat != null && !mapsUrl(f.lat, f.lng)) errors.push('Latitude / longitude don’t look right.');
  const num = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
  const doc = {
    source: 'manual', status: 'new',
    serial, model: String(f.model || '').trim(), hours: num(f.hours),
    customer: { name: String(f.customerName || '').trim(), phone: String(f.phone || '').trim(), address: String(f.address || '').trim() },
    location: { city: String(f.city || '').trim(), lat: num(f.lat), lng: num(f.lng) },
    ...(isService
      ? { kind: 'service', service: { interval: Number(interval), dueAt: f.dueAt || now, kitNumber: String(f.kitNumber || '').trim().slice(0, 40) } }
      : { kind: 'fault', fault: { code, summary: String(f.summary || '').trim(), severity: code ? 'CRITICAL' : '', startAt: f.startAt || now, otherCodes: [] } }),
    branch: String(f.branch || '').trim(),
    notes: [], history: [ev('created', userId, now, { source: 'manual' })],
    createdAt: now, createdBy: userId || '', updatedAt: now
  };
  return { errors, doc };
}

export function caseMatchesQuery(c, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const digits = String((c.customer && c.customer.phone) || '').replace(/\D/g, '');
  const hay = [c.serial, c.model, c.customer && c.customer.name, c.customer && c.customer.address,
    c.fault && c.fault.code, c.fault && c.fault.summary, c.location && c.location.city, c.branch,
    c.outcome && c.outcome.destinationName,
    c.service && c.service.interval ? `${c.service.interval} hr` : '', c.service && c.service.kitNumber].join(' ').toLowerCase();
  return words.every(w => hay.includes(w) || (/^\d{3,}$/.test(w) && digits.includes(w)));
}

export function caseCounts(cases = []) {
  const out = Object.fromEntries(CASE_TABS.map(t => [t.id, 0]));
  cases.forEach(c => { out[caseTab(c)]++; });
  return out;
}

// When Bobcat raised it: the fault's start, or the service-due date.
export function caseRaisedAt(c) {
  return (c && ((c.fault && c.fault.startAt) || (c.service && c.service.dueAt) || c.createdAt)) || '';
}
// Newest first.
export function sortCases(cases = []) {
  const t = caseRaisedAt;
  return [...cases].sort((a, b) => String(t(b)).localeCompare(String(t(a))));
}

/* ===================== STEP 4: FOLLOW-UPS ===================== */
// The daily WIP report completes a "Sent On" case when a work order
// opens on its serial; until then the hourly telematicsFollowUps function
// bumps the destination + Carter, then escalates. These two are copies of
// functions/telematicsWipRules.js (a test compares them) so the board can
// show what's due.
export const FOLLOW_UP_DEFAULTS = { fieldHours: 48, shopHours: 168, bumpEveryHours: 24, maxBumps: 3, wipStaleHours: 36 };
export function followUpSettings(settings) {
  const f = (settings && settings.followUps) || {};
  const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
  return {
    fieldHours: num(f.fieldHours, FOLLOW_UP_DEFAULTS.fieldHours, 1, 24 * 60),
    shopHours: num(f.shopHours, FOLLOW_UP_DEFAULTS.shopHours, 1, 24 * 60),
    bumpEveryHours: num(f.bumpEveryHours, FOLLOW_UP_DEFAULTS.bumpEveryHours, 1, 24 * 30),
    maxBumps: Math.round(num(f.maxBumps, FOLLOW_UP_DEFAULTS.maxBumps, 0, 10)),
    wipStaleHours: num(f.wipStaleHours, FOLLOW_UP_DEFAULTS.wipStaleHours, 1, 24 * 14)
  };
}
export function followUpState(c, settings, { wipReceivedAt = '', now = Date.now() } = {}) {
  const o = (c && c.outcome) || {};
  if (!c || c.status !== 'sent' || o.result !== 'won' || !['field', 'shop'].includes(o.tier) || !o.sentAt) return { action: 'none' };
  const cfg = followUpSettings(settings);
  const fu = c.followUp || {};
  if (fu.escalatedAt) return { action: 'none', escalated: true };
  const n = Number(fu.bumps) || 0;
  const H = 3600e3;
  const first = new Date(o.sentAt).getTime() + (o.tier === 'field' ? cfg.fieldHours : cfg.shopHours) * H;
  // Never sooner than one interval after the last reminder, so a case that
  // was already overdue (a late WIP, or go-live day) doesn't get them all at once.
  const sinceLast = fu.lastBumpAt ? new Date(fu.lastBumpAt).getTime() + cfg.bumpEveryHours * H : 0;
  const dueMs = Math.max(first + Math.min(n, cfg.maxBumps) * cfg.bumpEveryHours * H, n ? sinceLast : 0);
  const dueAt = new Date(dueMs).toISOString();
  const next = n < cfg.maxBumps ? { action: 'bump', n: n + 1 } : { action: 'escalate', n };
  if (now < dueMs) return { action: 'wait', dueAt, n };
  if (!wipReceivedAt || new Date(wipReceivedAt).getTime() < dueMs) return { action: 'waiting-for-wip', dueAt, n };
  return { ...next, dueAt };
}

// One line for the board / case page: "Work order due Nov 14", "Bumped 2×",
// "Escalated", "Overdue — waiting for today's WIP".
export function followUpLabel(c, settings, opts = {}) {
  const fu = (c && c.followUp) || {};
  const st = followUpState(c, settings, opts);
  if (st.escalated) return { tone: 'rose', text: 'Escalated — no work order' };
  if (st.action === 'none') return null;
  const bumped = Number(fu.bumps) || 0;
  const when = new Date(st.dueAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (st.action === 'wait') return bumped
    ? { tone: 'amber', text: `Bumped ${bumped}× · next ${when}` }
    : { tone: 'stone', text: `Work order due ${when}` };
  const pre = bumped ? `Bumped ${bumped}× · ` : '';
  if (st.action === 'bump') return { tone: 'amber', text: `${pre}Overdue — reminder ${st.n} going out` };
  if (st.action === 'escalate') return { tone: 'rose', text: `${pre}Overdue — escalating` };
  return { tone: 'amber', text: `${pre}Overdue — checking the next WIP` };
}
