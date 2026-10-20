// Pure rules for the Zapier intake endpoint. No Firebase imports, so
// scripts/test-helpers.mjs can load this file directly.

// Statuses that take a lead out of play. A new inquiry that matches one of
// these is a new sale to work, not a repeat of an open one. Union of the
// stored config (which may predate the Indy pipeline) and the pipeline's own.
const CLOSED_STATUSES = ['Completed', 'Lost', 'Unqualified', 'Dead', 'Cancelled', 'Won', 'No Decision'];

const squash = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// Return the configured spelling of `value` when it matches ignoring case,
// spaces and punctuation ("indy north" -> "Indy North"); otherwise the value
// as sent, trimmed. Never invents a value.
function canonical(value, list) {
  const v = String(value == null ? '' : value).trim();
  if (!v || !Array.isArray(list)) return v;
  const key = squash(v);
  const hit = list.find(x => squash(x) === key);
  return hit || v;
}

// Leads from a web form are never pre-worked: Working needs a rep, Sales
// Request needs a submittal, Completed needs the back office. Always New.
function intakeStatus() {
  return 'New';
}

const DEFAULT_SOURCE = 'Internet';
function intakeSource(sent, sources) {
  const v = String(sent == null ? '' : sent).trim();
  return v ? canonical(v, sources) : DEFAULT_SOURCE;
}

function closedStatusesFrom(config) {
  const stored = config && Array.isArray(config.closedStatuses) ? config.closedStatuses : [];
  return Array.from(new Set([...stored, ...CLOSED_STATUSES]));
}

// Only open leads absorb a repeat submission. Junk still does, so repeat spam
// stays in Junk instead of reappearing in Incoming.
function canLinkResubmission(existing, closedStatuses) {
  if (!existing) return false;
  return !closedStatuses.includes(existing.status);
}

module.exports = { canonical, intakeStatus, intakeSource, closedStatusesFrom, canLinkResubmission, CLOSED_STATUSES, DEFAULT_SOURCE };
