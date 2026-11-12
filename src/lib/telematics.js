// Telematics module — pure rules, no Firebase imports (tested in
// scripts/test-helpers.mjs). See CLAUDE.md → "Telematics".
//
// Step 1 (Nov 2026): the critical code master list. Bobcat labels every
// fault email CRITICAL; this list is where Tanner decides which codes really
// are, so Carter only calls on the ones that matter.

// What the board does with a code. Order = display order.
export const CODE_LEVELS = [
  { id: 'critical',    label: 'Critical',     hint: 'On Carter’s board' },
  { id: 'noncritical', label: 'Non-critical', hint: 'Logged, kept off the main board' },
  { id: 'ignore',      label: 'Ignore',       hint: 'Logged only' }
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
