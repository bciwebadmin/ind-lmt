// Fault Codes / Service Due → Excel or CSV (Erin, Nov 20). Pure — tested in
// scripts/test-helpers.mjs; App.jsx only turns the result into a file.
// Rows are positional: `headers` and every row have the same length.
import { CASE_TABS, caseTab, caseStatusLabel, caseKind, caseLevel, codeLevelLabel, winTier, sortCases, sortFaultCases } from './telematics.js';

const iso = (v) => (v ? String(v) : '');
// "2026-11-20 10:05" in Indianapolis time — readable in Excel and stable in tests.
export function exportDateTime(v) {
  if (!v) return '';
  const t = new Date(v);
  if (isNaN(t)) return String(v);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Indiana/Indianapolis', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(t).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function outcomeText(c) {
  const o = c.outcome || {};
  if (o.result === 'won') return 'Won';
  if (o.result === 'lost') return 'Lost';
  if (c.closure) return 'Closed';
  return '';
}
function reasonText(c) {
  const o = c.outcome || {};
  if (o.result === 'lost') return [o.reason, o.note].filter(Boolean).join(' — ');
  if (c.closure) return [c.closure.reason, c.closure.note].filter(Boolean).join(' — ');
  return '';
}
const lastCall = (c) => ((c.notes || []).filter(n => n && n.call).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]) || null;

// [header, (case, ctx) => value]. ctx = { codesById, userName, caseUrl }.
const COMMON_START = [
  ['Tab', (c) => (CASE_TABS.find(t => t.id === caseTab(c)) || {}).label || ''],
  ['Status', (c) => caseStatusLabel(c.status || 'new')],
  ['Customer', (c) => (c.customer && c.customer.name) || ''],
  ['Phone', (c) => (c.customer && c.customer.phone) || ''],
  ['Customer address', (c) => (c.customer && c.customer.address) || ''],
  ['Owner account', (c) => (c.customer && c.customer.ownerAccount) || ''],
  ['Owner contact', (c) => (c.customer && c.customer.ownerContact) || ''],
  ['Owner email', (c) => (c.customer && c.customer.ownerEmail) || ''],
  ['Model', (c) => c.model || ''],
  ['Serial', (c) => c.serial || ''],
  ['Hours', (c) => (c.hours != null ? c.hours : '')],
  ['Branch', (c) => c.branch || '']
];
const FAULT_COLS = [
  ['Fault started', (c) => exportDateTime(c.fault && c.fault.startAt)],
  ['Code', (c) => (c.fault && c.fault.code) || ''],
  ['Level', (c, x) => codeLevelLabel(caseLevel(c, x.codesById) || 'critical')],
  ['Repeat', (c) => (c.repeatCritical ? `Sent ${c.repeatCritical.seen} times in ${c.repeatCritical.days} days (${codeLevelLabel(c.repeatCritical.level)} on the Code List)` : '')],
  ['Summary', (c) => (c.fault && c.fault.summary) || ''],
  ['Other active codes', (c) => ((c.fault && c.fault.otherCodes) || []).map(o => [o.code, o.summary].filter(Boolean).join(' ')).join('; ')]
];
const SERVICE_COLS = [
  ['Came due', (c) => exportDateTime(c.service && c.service.dueAt)],
  ['Interval (hrs)', (c) => (c.service && c.service.interval) || ''],
  ['Kit number', (c) => (c.service && c.service.kitNumber) || '']
];
const COMMON_END = [
  ['Times Bobcat sent it', (c) => Number(c.alertCount) || 1],
  ['Machine near', (c) => (c.location && c.location.city) || ''],
  ['Machine address', (c) => (c.location && c.location.address) || ''],
  ['Latitude', (c) => (c.location && c.location.lat != null ? c.location.lat : '')],
  ['Longitude', (c) => (c.location && c.location.lng != null ? c.location.lng : '')],
  ['Calls', (c) => ((c.notes || []).filter(n => n && n.call).length)],
  ['Last call', (c) => (lastCall(c) ? lastCall(c).call.result : '')],
  ['Last call at', (c) => (lastCall(c) ? exportDateTime(lastCall(c).at) : '')],
  ['Outcome', (c) => outcomeText(c)],
  ['Won to', (c) => { const o = c.outcome || {}; if (o.result !== 'won') return ''; const t = winTier(o.tier); return [t && t.label, o.destinationName].filter((v, i, a) => v && a.indexOf(v) === i).join(' → '); }],
  ['Sent at', (c) => (c.outcome && c.outcome.result === 'won' ? exportDateTime(c.outcome.sentAt) : '')],
  ['Sent by', (c, x) => (c.outcome && c.outcome.result === 'won' ? x.userName(c.outcome.sentBy) : '')],
  ['Lost / closed reason', (c) => reasonText(c)],
  ['Work order', (c) => (c.workOrder && c.workOrder.number) || ''],
  ['Work order opened', (c) => (c.workOrder ? iso(c.workOrder.openedOn) || exportDateTime(c.workOrder.confirmedAt) : '')],
  ['Reminders sent', (c) => Number(c.followUp && c.followUp.bumps) || 0],
  ['Escalated', (c) => (c.followUp && c.followUp.escalatedAt ? exportDateTime(c.followUp.escalatedAt) : '')],
  ['Created', (c) => exportDateTime(c.createdAt)],
  ['Came in by', (c) => (c.source === 'manual' ? 'Added by hand' : 'Bobcat email')],
  ['Link', (c, x) => (x.caseUrl ? x.caseUrl(c.id) : '')]
];

export function exportColumns(kind) {
  return [...COMMON_START, ...(kind === 'service' ? SERVICE_COLS : FAULT_COLS), ...COMMON_END];
}

// → { headers, rows } for one board's cases, in the board's order.
export function caseExportTable(cases = [], kind = 'fault', { codesById = {}, userName = () => '', caseUrl = null } = {}) {
  const cols = exportColumns(kind);
  const mine = cases.filter(c => caseKind(c) === kind);
  const ordered = kind === 'service' ? sortCases(mine) : sortFaultCases(mine, codesById);
  const ctx = { codesById, userName, caseUrl };
  return { headers: cols.map(c => c[0]), rows: ordered.map(c => cols.map(([, f]) => { const v = f(c, ctx); return v == null ? '' : v; })) };
}

// The whole board as Excel sheets: "All", then one per tab (empty tabs skipped).
export function caseExportSheets(cases = [], kind = 'fault', opts = {}) {
  const mine = cases.filter(c => caseKind(c) === kind);
  const sheets = [{ name: 'All', ...caseExportTable(mine, kind, opts) }];
  for (const t of CASE_TABS) {
    const inTab = mine.filter(c => caseTab(c) === t.id);
    if (inTab.length) sheets.push({ name: t.label, ...caseExportTable(inTab, kind, opts) });
  }
  return sheets;
}

// ind-fault-codes-new-2026-11-20.xlsx / ind-service-due-all-2026-11-20.csv
export function exportFileName(kind, scope, ext, date = new Date()) {
  const board = kind === 'service' ? 'service-due' : 'fault-codes';
  const s = String(scope || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
  const d = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
  return `ind-${board}-${s}-${d}.${ext === 'csv' ? 'csv' : 'xlsx'}`;
}
