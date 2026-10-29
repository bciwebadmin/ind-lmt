// Pure rules for the daily reminder emails (Oct 2026 meeting). No Firebase
// imports, so scripts/test-helpers.mjs can load this file directly.
//
//   Make contact: an assigned lead still in New gets its rep a reminder every
//   weekday morning until it leaves New (Erin: "leaves New" = contact made).
//   The day it was assigned is skipped — the assignment email covers that.
//
//   Follow up: 30 days after a lead is Completed, its rep is reminded once to
//   send the customer a follow-up. Only deals completed 30–45 days ago are
//   picked up, so switching this on never emails about years of old deals.

const HOUR = 3600e3;
const DAY = 24 * HOUR;

function isAssigned(lead) {
  return !!(lead && lead.assignedTo && lead.assignedTo !== 'u_1');
}

function ms(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
}

function needsContactReminder(lead, now = Date.now()) {
  if (!lead || lead.status !== 'New' || !isAssigned(lead)) return false;
  const assigned = ms(lead.dateAssigned) ?? ms(lead.createdDate);
  return assigned !== null && now - assigned >= 12 * HOUR;
}

function completedAtOf(lead) {
  return ms(lead && lead.completedAt) ?? ms(lead && lead.statusChangedAt);
}

function needsFollowUpReminder(lead, now = Date.now()) {
  if (!lead || lead.status !== 'Completed' || !isAssigned(lead) || lead.followUpReminderSentAt) return false;
  const done = completedAtOf(lead);
  if (done === null) return false;
  const age = now - done;
  return age >= 30 * DAY && age < 45 * DAY;
}

function daysSince(iso, now = Date.now()) {
  const t = ms(iso);
  return t === null ? null : Math.floor((now - t) / DAY);
}

// A follow-up date the rep set on a lead (lead.followUp.date, YYYY-MM-DD) is
// due on that day and every day after until they mark it done.
function followUpDateDue(lead, todayYmd) {
  const f = lead && lead.followUp;
  return !!(f && f.date && f.date <= todayYmd && isAssigned(lead) && lead.status !== 'Junk');
}

// Today's date in Indianapolis, as YYYY-MM-DD.
function indyToday(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Indiana/Indianapolis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

// [{id, ...lead}] -> { [assigneeId]: [lead, …] }
function groupByAssignee(leads) {
  const out = {};
  for (const l of leads) (out[l.assignedTo] = out[l.assignedTo] || []).push(l);
  return out;
}

module.exports = { needsContactReminder, needsFollowUpReminder, followUpDateDue, indyToday, completedAtOf, daysSince, groupByAssignee };
