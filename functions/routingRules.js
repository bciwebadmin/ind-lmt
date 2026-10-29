// Pure lead-routing rules for Bobcat of Indy (Oct 2026 meeting). No Firebase
// imports, so scripts/test-helpers.mjs can load this file directly. index.js
// does the Firestore reads (is that user real? on leave? their email?).
//
// Per branch + department (config.leadRouting["Branch::Dept"]):
//   primaryUserId   the department person the lead is assigned to
//   backupUserId    a second department person, set as secondary
//   zipSplits       [{ userId, zips }] — "By Zip": the first split whose ZIP
//                   list matches the lead's ZIP replaces the primary
//   cc1..cc3        extra addresses copied on the alert
// Per branch (config.branchManagers[branch]): the branch manager, copied on
// every alert for that branch.
// Shared areas (config.sharedAreas): [{ name, zips, department, branches }] —
// a lead in one of those ZIPs for that department goes to the routed rep of
// EVERY listed branch (Marion County: Indy and Indy North sales).

// "46201, 46107\n462" -> ['46201', '46107', '462']. 3-4 digit entries are
// prefixes; 5-digit entries are exact.
function parseZipList(list) {
  if (Array.isArray(list)) list = list.join(',');
  return String(list || '').split(/[\s,;]+/).map(z => z.replace(/\D/g, '')).filter(z => z.length >= 3 && z.length <= 5);
}

function zipMatches(zip, list) {
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  if (z.length !== 5) return false;
  return parseZipList(list).some(p => (p.length === 5 ? z === p : z.startsWith(p)));
}

function routingKey(branch, department) {
  return `${branch}::${department}`;
}

// Exact key first, then case-insensitive, so "service" still finds "Service".
function findEntry(table, branch, department) {
  if (!table || !branch || !department) return null;
  const exact = table[routingKey(branch, department)];
  if (exact) return exact;
  const wanted = routingKey(branch, department).toLowerCase();
  const hit = Object.keys(table).find(k => k.toLowerCase() === wanted);
  return hit ? table[hit] : null;
}

// Who an entry assigns a lead to: the matching ZIP split, else the primary.
function entryAssignee(entry, zip) {
  if (!entry) return { userId: '', via: 'none' };
  const splits = Array.isArray(entry.zipSplits) ? entry.zipSplits : [];
  for (const s of splits) {
    if (s && s.userId && zipMatches(zip, s.zips)) return { userId: s.userId, via: 'zip' };
  }
  return { userId: (entry.primaryUserId || '').trim(), via: 'primary' };
}

// A lead with no branch but a ZIP that one branch's split (for this
// department) claims belongs to that branch. First match in branch order.
function branchFromZip(config, department, zip) {
  const table = (config && config.leadRouting) || {};
  for (const branch of (config && config.branches) || []) {
    const entry = findEntry(table, branch, department);
    const splits = entry && Array.isArray(entry.zipSplits) ? entry.zipSplits : [];
    if (splits.some(s => s && s.userId && zipMatches(zip, s.zips))) return branch;
  }
  return '';
}

// Shared areas this lead falls in: the OTHER branches whose rep also gets it.
function sharedPartnerBranches(config, branch, department, zip) {
  const areas = (config && Array.isArray(config.sharedAreas)) ? config.sharedAreas : [];
  const out = [];
  for (const a of areas) {
    if (!a || !Array.isArray(a.branches) || !a.branches.includes(branch)) continue;
    if (a.department && String(a.department).toLowerCase() !== String(department || '').toLowerCase()) continue;
    if (!zipMatches(zip, a.zips)) continue;
    for (const b of a.branches) if (b !== branch && !out.includes(b)) out.push(b);
  }
  return out;
}

/**
 * The whole routing decision, before any user lookups.
 * Returns { matched, reason, branch, assigneeId, via, backupId, partnerIds,
 *           branchManagerId, ccEmails }.
 */
function planRouting(config, { branch, department, zip }) {
  const table = (config && config.leadRouting) || {};
  let b = branch || '';
  if (!b && department && zip) b = branchFromZip(config, department, zip);
  const base = { matched: false, branch: b, assigneeId: '', via: 'none', backupId: '', partnerIds: [], branchManagerId: '', ccEmails: [] };
  if (!b) return { ...base, reason: 'no-branch' };
  if (!department) return { ...base, reason: 'no-department' };
  const managers = (config && config.branchManagers) || {};
  base.branchManagerId = (managers[b] || '').trim();
  const entry = findEntry(table, b, department);
  if (!entry) return { ...base, reason: 'no-routing-entry' };
  const { userId, via } = entryAssignee(entry, zip);
  if (!userId) return { ...base, reason: 'no-primary-set' };
  const partnerIds = sharedPartnerBranches(config, b, department, zip)
    .map(pb => entryAssignee(findEntry(table, pb, department), zip).userId)
    .filter(id => id && id !== userId);
  const ccEmails = [entry.cc1, entry.cc2, entry.cc3].map(e => String(e || '').trim()).filter(e => e.includes('@'));
  const backupId = (entry.backupUserId || '').trim();
  return {
    matched: true, reason: 'routed', branch: b, assigneeId: userId, via,
    backupId: backupId && backupId !== userId ? backupId : '',
    partnerIds: [...new Set(partnerIds)],
    branchManagerId: base.branchManagerId,
    ccEmails
  };
}

// Marion County, Indiana (zip-codes.com, data updated March 2025): the street
// ZIPs plus PO-box / single-business ones. Offered as the default shared area.
const MARION_COUNTY_ZIPS = [
  '46107', '46183', '46201', '46202', '46203', '46204', '46205', '46206', '46207', '46208', '46209',
  '46213', '46214', '46216', '46217', '46218', '46219', '46220', '46221', '46222', '46224', '46225',
  '46226', '46227', '46228', '46229', '46230', '46231', '46234', '46235', '46236', '46237', '46239',
  '46240', '46241', '46242', '46244', '46247', '46249', '46250', '46251', '46253', '46254', '46255',
  '46256', '46259', '46260', '46262', '46268', '46277', '46278', '46282', '46283', '46285', '46288', '46298'
];

module.exports = {
  parseZipList, zipMatches, routingKey, findEntry, entryAssignee, branchFromZip,
  sharedPartnerBranches, planRouting, MARION_COUNTY_ZIPS
};
