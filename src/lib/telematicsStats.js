// Telematics → Dashboard: the numbers behind it. Pure — no Firebase, no
// React — so scripts/test-helpers.mjs checks every figure. See CLAUDE.md →
// "Telematics" (phase 2: the "how are we doing" view Tanner asked for).
//
// Definitions (keep the dashboard's wording in step with these):
//   Won     a case currently Sent On or Completed with outcome won.
//   Lost    a case currently Lost.
//   Win rate          won / (won + lost). Closed cases (no action, duplicates,
//                     codes filed automatically) are left out — Carter never
//                     had a sale to win or lose.
//   Work-order rate   Field + Shop wins with a work order (WIP match or
//                     confirmed by hand) / all Field + Shop wins.
//   First response    case created → the first thing a person did on it
//                     (a note, Start working, Won, Lost, Close).
//   Win → work order  the day Carter sent it → the day the work order opened.
import { classifyCode, winTier } from './telematics.js';

const H = 3600e3, D = 864e5;
const t = (iso) => { const n = new Date(iso).getTime(); return Number.isFinite(n) ? n : NaN; };

export const PERIODS = [
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
  { id: 'all', label: 'All time', days: 0 }
];

export function inPeriod(c, periodId, now = Date.now()) {
  const p = PERIODS.find(x => x.id === periodId);
  if (!p || !p.days) return true;
  const at = t(c && c.createdAt);
  return Number.isFinite(at) && at >= now - p.days * D;
}

export function median(nums) {
  const v = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const isWon = (c) => !!c && (c.status === 'sent' || c.status === 'completed') && c.outcome && c.outcome.result === 'won';
export const isLost = (c) => !!c && c.status === 'lost';
export const isClosed = (c) => !!c && c.status === 'closed';
const isFieldShopWin = (c) => isWon(c) && ['field', 'shop'].includes(c.outcome.tier);
const hasWorkOrder = (c) => !!(c && c.workOrder && (c.workOrder.number || c.workOrder.confirmedAt || c.workOrder.matchedAt));

// When a person first touched the case (system entries have no `by`).
const PERSON_EVENTS = ['status', 'won', 'lost', 'closed'];
export function firstResponseAt(c) {
  const times = [
    ...((c && c.history) || []).filter(e => e && e.by && PERSON_EVENTS.includes(e.type)).map(e => t(e.at)),
    ...((c && c.notes) || []).filter(n => n && n.by).map(n => t(n.at))
  ].filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}

// Days from the Indy day it was sent to the day the work order opened.
export function daysToWorkOrder(c) {
  if (!isFieldShopWin(c) || !hasWorkOrder(c)) return null;
  const sent = t(c.outcome.sentAt);
  if (!Number.isFinite(sent)) return null;
  const wo = c.workOrder;
  if (wo.openedOn && /^\d{4}-\d{2}-\d{2}$/.test(wo.openedOn)) {
    const sentDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Indiana/Indianapolis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sent));
    return Math.max(0, Math.round((Date.parse(wo.openedOn) - Date.parse(sentDay)) / D));
  }
  const at = t(wo.confirmedAt || wo.matchedAt);
  return Number.isFinite(at) ? Math.max(0, (at - sent) / D) : null;
}

const pct = (n, d) => (d ? n / d : null);

// The headline numbers.
export function summary(cases = []) {
  const won = cases.filter(isWon), lost = cases.filter(isLost);
  const fs = cases.filter(isFieldShopWin);
  const wo = fs.filter(hasWorkOrder);
  const firsts = cases.map(c => { const f = firstResponseAt(c); return f == null ? NaN : (f - t(c.createdAt)) / H; }).filter(h => h >= 0);
  const toWin = won.map(c => (t(c.outcome.sentAt) - t(c.createdAt)) / H).filter(h => h >= 0);
  const toWo = fs.map(daysToWorkOrder).filter(d => d != null);
  return {
    cases: cases.length,
    open: cases.filter(c => ['new', 'working'].includes(c.status || 'new')).length,
    won: won.length, lost: lost.length, closed: cases.filter(isClosed).length,
    winRate: pct(won.length, won.length + lost.length),
    fieldShopWins: fs.length, workOrders: wo.length,
    workOrderRate: pct(wo.length, fs.length),
    waitingOnService: cases.filter(c => c.status === 'sent').length,
    escalated: cases.filter(c => c.followUp && c.followUp.escalatedAt).length,
    reminders: cases.reduce((n, c) => n + (Number(c.followUp && c.followUp.bumps) || 0), 0),
    medianFirstResponseHours: median(firsts), firstResponseCount: firsts.length,
    medianHoursToWin: median(toWin),
    medianDaysToWorkOrder: median(toWo), workOrderTimingCount: toWo.length
  };
}

// Won, by how (Field / Shop / Parts), then Lost and Closed.
export function outcomeBreakdown(cases = []) {
  const won = cases.filter(isWon);
  return [
    ...['field', 'shop', 'parts'].map(id => ({ id, label: `Won · ${winTier(id).label}`, count: won.filter(c => c.outcome.tier === id).length })),
    { id: 'lost', label: 'Lost', count: cases.filter(isLost).length },
    { id: 'closed', label: 'Closed', count: cases.filter(isClosed).length }
  ];
}

// The codes that come up most, with the level the Code List gives them now.
export function topCodes(cases = [], codesById = {}, limit = 10) {
  const m = new Map();
  for (const c of cases) {
    const code = c.fault && c.fault.code;
    if (!code) continue;
    const r = m.get(code) || { code, summary: (c.fault && c.fault.summary) || '', level: classifyCode(code, codesById).level, cases: 0, alerts: 0, won: 0 };
    r.cases++;
    r.alerts += Number(c.alertCount) || 1;
    if (isWon(c)) r.won++;
    m.set(code, r);
  }
  return [...m.values()].sort((a, b) => b.cases - a.cases || b.alerts - a.alerts || a.code.localeCompare(b.code)).slice(0, limit);
}

export function levelCounts(cases = [], codesById = {}) {
  const n = { critical: 0, noncritical: 0, ignore: 0 };
  cases.forEach(c => { if (c.fault && c.fault.code) n[classifyCode(c.fault.code, codesById).level]++; });
  return n;
}

// Machines: by model, and by model + serial prefix (Tanner: "all the T650s
// that are serial break ALJG are having issues with this").
const serialPrefix = (s) => String(s || '').toUpperCase().slice(0, 4);
function topOf(map) { let best = '', n = 0; for (const [k, v] of map) if (v > n) { best = k; n = v; } return best; }
export function topMachines(cases = [], limit = 10) {
  const m = new Map();
  for (const c of cases) {
    const model = String(c.model || '').trim() || 'Unknown';
    const r = m.get(model) || { model, cases: 0, won: 0, workOrders: 0, codes: new Map() };
    r.cases++;
    if (isWon(c)) r.won++;
    if (hasWorkOrder(c)) r.workOrders++;
    if (c.fault && c.fault.code) r.codes.set(c.fault.code, (r.codes.get(c.fault.code) || 0) + 1);
    m.set(model, r);
  }
  return [...m.values()].sort((a, b) => b.cases - a.cases || a.model.localeCompare(b.model)).slice(0, limit)
    .map(({ codes, ...r }) => ({ ...r, topCode: topOf(codes) }));
}
export function serialBreaks(cases = [], limit = 12) {
  const m = new Map();
  for (const c of cases) {
    const prefix = serialPrefix(c.serial);
    if (!prefix) continue;
    const model = String(c.model || '').trim() || 'Unknown';
    const key = `${model}|${prefix}`;
    const r = m.get(key) || { model, prefix, cases: 0, machines: new Set(), codes: new Map() };
    r.cases++;
    r.machines.add(String(c.serial).toUpperCase());
    if (c.fault && c.fault.code) r.codes.set(c.fault.code, (r.codes.get(c.fault.code) || 0) + 1);
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => b.cases - a.cases || a.model.localeCompare(b.model)).slice(0, limit)
    .map(r => ({ model: r.model, prefix: r.prefix, cases: r.cases, machines: r.machines.size, topCode: topOf(r.codes) }));
}

export function byBranch(cases = [], branches = []) {
  const names = [...new Set([...branches, ...cases.map(c => c.branch || '')])].filter(Boolean);
  const rows = names.map(b => {
    const mine = cases.filter(c => (c.branch || '') === b);
    const won = mine.filter(isWon).length, lost = mine.filter(isLost).length;
    return { branch: b, cases: mine.length, won, winRate: pct(won, won + lost) };
  });
  const none = cases.filter(c => !c.branch).length;
  if (none) rows.push({ branch: 'No branch', cases: none, won: cases.filter(c => !c.branch && isWon(c)).length, winRate: null });
  return rows.filter(r => r.cases).sort((a, b) => b.cases - a.cases);
}

export function lostReasons(cases = []) {
  const m = new Map();
  cases.filter(isLost).forEach(c => { const r = (c.outcome && c.outcome.reason) || 'No reason'; m.set(r, (m.get(r) || 0) + 1); });
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

// Who follows through: per destination, Field/Shop wins, work orders, days.
export function byDestination(cases = []) {
  const m = new Map();
  for (const c of cases.filter(isWon)) {
    const name = c.outcome.destinationName || 'Unknown';
    const r = m.get(name) || { destination: name, wins: 0, fieldShop: 0, workOrders: 0, waiting: 0, escalated: 0, days: [] };
    r.wins++;
    if (isFieldShopWin(c)) {
      r.fieldShop++;
      if (hasWorkOrder(c)) r.workOrders++;
      if (c.status === 'sent') r.waiting++;
      if (c.followUp && c.followUp.escalatedAt) r.escalated++;
      const d = daysToWorkOrder(c); if (d != null) r.days.push(d);
    }
    m.set(name, r);
  }
  return [...m.values()].map(({ days, ...r }) => ({ ...r, workOrderRate: pct(r.workOrders, r.fieldShop), medianDays: median(days) }))
    .sort((a, b) => b.wins - a.wins || a.destination.localeCompare(b.destination));
}

// Weekly counts (weeks start Monday): new cases and wins, oldest first.
export function weekly(cases = [], weeks = 12, now = Date.now()) {
  const monday = (ms) => { const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); };
  const end = monday(now);
  const rows = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = end - i * 7 * D;
    rows.push({ start, label: new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), cases: 0, won: 0 });
  }
  const slot = (ms) => { if (!Number.isFinite(ms)) return null; const w = monday(ms); return rows.find(r => r.start === w) || null; };
  for (const c of cases) {
    const a = slot(t(c.createdAt)); if (a) a.cases++;
    if (isWon(c)) { const b = slot(t(c.outcome.sentAt)); if (b) b.won++; }
  }
  return rows.map(({ start, ...r }) => r);
}

// "3.5 h", "2.1 days", "45 min".
export function formatHours(h) {
  if (h == null || !Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${(Math.round(h * 10) / 10).toString()} h`;
  return `${(Math.round(h / 24 * 10) / 10).toString()} days`;
}
export function formatDays(d) {
  if (d == null || !Number.isFinite(d)) return '—';
  if (d < 1) return 'same day';
  const r = Math.round(d * 10) / 10;
  return `${r} day${r === 1 ? '' : 's'}`;
}
export const formatPct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
