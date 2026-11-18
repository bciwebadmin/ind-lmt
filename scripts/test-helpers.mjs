#!/usr/bin/env node
// Pure-helper tests. Run: node scripts/test-helpers.mjs
// These exist because a passing Vite build says nothing about branching logic.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; }
  else { fail++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/* ---------- MODEL_REGEX, lifted from App.jsx ---------- */
const src = app.match(/const MODEL_REGEX = (\/.*\/[a-z]*);/)[1];
const MODEL_REGEX = eval(src);

const shouldMatch = [
  'S64','S66','S70','S76','S86','T64','T66','T76','T86',
  'MT55','MT85','MT100','E10','E20','E26','E32','E35','E42','E50','E60','E88',
  'V519','V723','TL519','TL723','UW56','UV34','CT1021','CT2025','CT2535','CT4045',
  'ZT2000','ZT3500','ZT6000','L23','L28','L65','L85',
  'looking for a T-76 with a grapple','quote on s70 please','need an E 35 next week'
];
for (const s of shouldMatch) check(`matches "${s}"`, MODEL_REGEX.test(s));

const shouldNotMatch = [
  'Please call me back',
  'I have a 2019 model',
  'Need pricing on a bucket',
  'available 9-5 weekdays',
  'my budget is 45000',
  'call 770 555 0134',
  'lot 5 building T 3',
  'V 8 engine',
  'shipment 1 of 3',
  'off US-78 near Covington',
  'take I-285 to exit 12',
  'located on GA-85 south',
  'we are at 5190 Hwy 278 NE',
  'net 30 terms',
  'PO 88231',
  'take I-465 to exit 4',
  'on SR-37 south of Martinsville',
  'we are at 2935 Bluff Rd',
  'off US-31 in Columbus'
];
for (const s of shouldNotMatch) {
  const m = s.match(MODEL_REGEX);
  check(`does not match "${s}"`, !m, m ? `matched "${m[0]}"` : '');
}

/* ---------- service-area scoring, mirroring App.jsx ---------- */
const primary  = JSON.parse(app.match(/const DEFAULT_TEXAS_PREFIXES = (\[[^\]]*\]);/)[1].replace(/'/g,'"'));
const adjacent = JSON.parse(app.match(/const DEFAULT_ADJACENT_PREFIXES = (\[[^\]]*\]);/)[1].replace(/'/g,'"'));

const areaFor = (zip) => {
  if (!/^\d{5}/.test(zip)) return 'none';
  const p = zip.slice(0, 2);
  if (primary.includes(p)) return 'primary';
  if (adjacent.includes(p)) return 'adjacent';
  return 'other';
};

// Every branch ZIP must land in the primary service area. This is the
// assertion that catches a prefix list that misses one of the branches.
const branchZips = {
  Anderson: '46017', Columbus: '47203', Ellettsville: '47429',
  Indy: '46225', 'Indy North': '46075'
};
for (const [b, z] of Object.entries(branchZips)) {
  check(`${b} (${z}) scores as primary`, areaFor(z) === 'primary', `got "${areaFor(z)}"`);
}

const areaCases = [
  ['46204', 'primary',  'downtown Indianapolis'],
  ['47708', 'primary',  'Evansville IN'],
  ['46802', 'primary',  'Fort Wayne IN'],
  ['46601', 'primary',  'South Bend IN'],
  ['60601', 'adjacent', 'Chicago IL'],
  ['62701', 'adjacent', 'Springfield IL'],
  ['45202', 'adjacent', 'Cincinnati OH'],
  ['43215', 'adjacent', 'Columbus OH — not the Columbus branch'],
  ['40202', 'adjacent', 'Louisville KY'],
  ['42101', 'adjacent', 'Bowling Green KY'],
  ['49503', 'adjacent', 'Grand Rapids MI'],
  ['48226', 'adjacent', 'Detroit MI'],
  ['30303', 'other',    'Atlanta GA — Atlanta fork territory, must NOT be primary here'],
  ['35756', 'other',    'Madison AL — Atlanta fork Huntsville branch'],
  ['90210', 'other',    'Beverly Hills CA'],
  ['67202', 'other',    'Wichita KS — BMH territory, must NOT be primary here'],
  ['75201', 'other',    'Dallas TX — Houston fork territory']
];
for (const [zip, want, label] of areaCases) {
  check(`${zip} (${label}) -> ${want}`, areaFor(zip) === want, `got "${areaFor(zip)}"`);
}

/* ---------- prefix lists must not overlap ---------- */
const overlap = primary.filter(p => adjacent.includes(p));
check('primary and adjacent prefixes do not overlap', overlap.length === 0, overlap.join(', '));

/* ---------- branch inference is deliberately disabled ---------- */
// Branch is assigned manually for now, so nearestBranchForZip must return null
// for EVERY input, including with no branch whitelist. The Kansas data this file
// inherited resolved Kansas/Missouri/Oklahoma ZIPs to branches that do not exist
// in this deployment; those leads matched no routing entry and silently fell
// through to Unassigned. If someone repopulates the tables, this block fails and
// the territory assertions below it need writing.
{
  const { nearestBranchForZip } = await import('../src/lib/branchRouting.js');
  const configured = Object.keys(branchZips);
  const probes = ['46204','46225','46075','46017','47203','47429','60601','45202','40202','30303','67202','90210','02134','99501'];

  const leaks = [];
  for (const z of probes) {
    const r = nearestBranchForZip(z, configured);
    if (r && !configured.includes(r.branch)) leaks.push(`${z} -> ${r.branch} (whitelisted)`);
    // The dangerous path: no whitelist, which is what a missing config/app used to produce.
    const u = nearestBranchForZip(z, null);
    if (u && !configured.includes(u.branch)) leaks.push(`${z} -> ${u.branch} (unconstrained)`);
  }
  check('no ZIP resolves to a branch outside the configured list', leaks.length === 0, leaks.join(', '));

  const suggested = probes.filter(z => nearestBranchForZip(z, configured) !== null);
  check('branch inference is disabled (all ZIPs return null)', suggested.length === 0,
    `still suggesting for: ${suggested.join(', ')}`);
}

/* ---------- branches and routing departments ---------- */
const branches = JSON.parse(app.match(/branches: (\[[^\]]*\]),/)[1].replace(/'/g,'"'));
const depts    = JSON.parse(app.match(/routingDepartments: (\[[^\]]*\]),/)[1].replace(/'/g,'"'));
check('5 branches configured', branches.length === 5, `got ${branches.length}`);
check('branch list matches the ZIP test fixtures',
  branches.every(b => b in branchZips) && Object.keys(branchZips).every(b => branches.includes(b)),
  `config=[${branches}]`);
check('5 routing departments', depts.length === 5, `got ${depts.length}`);
console.log(`  routing grid: ${branches.length} branches x ${depts.length} departments = ${branches.length * depts.length} entries`);

/* ---------- Indy's four-step pipeline (src/lib/pipeline.js) ---------- */
{
  const P = await import('../src/lib/pipeline.js');
  const { stageOfStatus: st, statusOptionsFor: opts, bulkStatusOptionsFor: bulk } = P;

  // Every pipeline status sits in exactly one step.
  const seen = {};
  for (const s of P.PIPELINE_STAGES) for (const x of s.statuses) seen[x] = (seen[x] || 0) + 1;
  check('each status belongs to exactly one step', Object.values(seen).every(n => n === 1), JSON.stringify(seen));
  for (const s of P.PIPELINE_STAGES) for (const x of s.statuses) {
    check(`"${x}" -> ${s.id}`, st(x) === s.id, `got ${st(x)}`);
  }
  check('Junk is not a step', st('Junk') === P.STAGE_JUNK);
  check('legacy Contacted -> incoming', st('Contacted') === 'incoming');
  check('legacy Quoted -> working', st('Quoted') === 'working');
  check('legacy Qualified -> working', st('Qualified') === 'working');
  check('legacy Want/Wants -> wanted', st('Want') === 'wanted' && st('Wants') === 'wanted');
  check('legacy Won -> completed', st('Won') === 'completed');
  check('legacy No Decision -> prospect', st('No Decision') === 'prospect');
  check('old Sales Submittal leads -> completed', st('Sales Submittal') === 'completed' && st('Sales Request') === 'completed');
  check('legacy Cancelled -> prospect', st('Cancelled') === 'prospect');
  check('Indy calls a finished sale Completed', P.WON_STATUS === 'Completed');
  check('custom closed status -> completed', st('Sold Elsewhere', [...P.PIPELINE_CLOSED_STATUSES, 'Sold Elsewhere']) === 'completed');
  check('unknown open status -> new', st('On Hold') === 'incoming');
  check('a missing status -> new', st(undefined) === 'incoming');

  // Oct 2026 layout: New, Working (+Pending), Prospect (+Dead, Unqualified, Lost), Wanted, Completed.
  check('tabs are New, Working, Prospect, Wanted, Completed', JSON.stringify(P.PIPELINE_STAGES.map(s => s.label)) === JSON.stringify(['New', 'Working', 'Prospect', 'Wanted', 'Completed']));
  check('Working holds Pending', st('Pending') === 'working');
  check('Prospect holds Dead, Unqualified and Lost', ['Prospect', 'Dead', 'Unqualified', 'Lost'].every(x => st(x) === 'prospect'));
  check('Completed is only done deals', JSON.stringify(P.getStage('completed').statuses) === JSON.stringify(['Completed']));
  check('Prospect type buttons: Prospect first (default), then Dead, Unqualified, Lost', JSON.stringify(P.PROSPECT_TYPES.map(t => t.label)) === JSON.stringify(['Prospect', 'Dead', 'Unqualified', 'Lost']));
  check('only done deals and junk are closed', JSON.stringify(P.PIPELINE_CLOSED_STATUSES) === JSON.stringify(['Completed', 'Junk']));

  // Moves are free between tabs; Completed goes through the Sales Submittal.
  const inc = opts('New'), done = opts('Completed');
  check('any tab is reachable from New', ['Working', 'Pending', 'Prospect', 'Wanted', 'Dead', 'Lost', 'Unqualified', 'Completed', 'Junk'].every(x => inc.includes(x)), inc.join(','));
  check('a done deal can reopen', done.includes('Working') && done.includes('Prospect'), done.join(','));
  check('Completed from any open status opens the Sales Submittal', ['New', 'Working', 'Pending', 'Prospect', 'Lost', 'Wanted'].every(x => P.completesViaSalesRequest(x, 'Completed')));
  check('Completed to Completed is not a new sale', !P.completesViaSalesRequest('Completed', 'Completed'));
  check('Lost is not a sale', !P.completesViaSalesRequest('Working', 'Lost'));
  check('moving into Prospect group asks for keywords', P.entersProspectGroup('Working', 'Dead') && P.entersProspectGroup('New', 'Prospect'));
  check('moving within the Prospect group does not re-ask', !P.entersProspectGroup('Dead', 'Lost'));
  check('current status always offered', opts('On Hold').includes('On Hold'));
  check('custom statuses stay reachable', opts('New', [...P.PIPELINE_STATUSES, 'On Hold']).includes('On Hold'));
  for (const s of P.PIPELINE_STAGES) {
    check(`bulk menu for ${s.id} never completes a deal`, !bulk(s.id).includes('Completed'), bulk(s.id).join(','));
  }
  check('retired Sales Submittal status is never offered', !inc.includes('Sales Submittal') && !inc.includes('Cancelled'));

  // Submittals are their own queue.
  check('submittal: none on a lead without one', P.submittalStatus({ status: 'Working' }) === null);
  check('submittal: explicit status wins', P.submittalStatus({ status: 'Completed', salesRequest: { status: 'Open' } }) === 'Open');
  check('submittal: pre-Oct lead already Completed reads Complete', P.submittalStatus({ status: 'Completed', salesRequest: {} }) === 'Complete');
  check('submittal: lead migrated from Sales Submittal reads Open', P.submittalStatus({ status: 'Completed', _migratedFrom: 'Sales Submittal', salesRequest: {} }) === 'Open');

  // Temperature replaces the heat score.
  check('temperature: Hot/Warm/Cold', JSON.stringify(P.TEMPERATURES) === JSON.stringify(['Hot', 'Warm', 'Cold']));
  check('temperature: reads lead.temperature', P.leadTemperature({ temperature: 'Hot' }) === 'Hot');
  check('temperature: falls back to the old deal field', P.leadTemperature({ deal: { temperature: 'Cold' } }) === 'Cold');
  check('temperature: new field wins over old', P.leadTemperature({ temperature: 'Warm', deal: { temperature: 'Cold' } }) === 'Warm');
  check('temperature: junk value ignored', P.leadTemperature({ temperature: 'Urgent' }) === '');
  check('temperature: no longer a deal field', !P.DEAL_FIELDS.some(f => f.key === 'temperature'));
  check('keywords: split on commas', JSON.stringify(P.prospectKeywordList({ prospectKeywords: 'Cat, CTL;  trailer ,' })) === JSON.stringify(['Cat', 'CTL', 'trailer']));

  // A config saved before the pipeline existed (Atlanta's status list) heals.
  const old = {
    statuses: ['New', 'Contacted', 'Working', 'Quoted', 'Wants', 'Won', 'Lost', 'Unqualified', 'No Decision', 'On Hold', 'Junk'],
    closedStatuses: ['Won', 'Lost', 'Unqualified', 'No Decision', 'Junk', 'Working'],
    staleness: { enabled: true, thresholds: { New: 24, Pending: 999 } }
  };
  const healed = P.ensurePipelineStatuses(old, { Pending: 168, Prospect: 336 });
  check('heal: adds the pipeline statuses', P.PIPELINE_STATUSES.every(s => healed.statuses.includes(s)), healed.statuses.join(','));
  check('heal: drops the legacy names', ['Contacted', 'Quoted', 'Wants', 'Won', 'No Decision'].every(s => !healed.statuses.includes(s)), healed.statuses.join(','));
  check('heal: keeps a custom status', healed.statuses.includes('On Hold'));
  check('heal: Junk stays last', healed.statuses[healed.statuses.length - 1] === 'Junk');
  check('heal: Completed counts as closed', healed.closedStatuses.includes('Completed'));
  check('heal: Lost is no longer closed (it lives in Prospect)', !healed.closedStatuses.includes('Lost'));
  check('heal: Working can never be closed', !healed.closedStatuses.includes('Working'));
  check('heal: never overwrites an admin threshold', healed.staleness.thresholds.Pending === 999);
  check('heal: adds a missing threshold', healed.staleness.thresholds.Prospect === 336);

  // Who sees what.
  const admin = { id: 'a1', role: 'admin' }, rep = { id: 'r1', role: 'user' };
  const mine = { assignedTo: 'r1' }, second = { assignedTo: 'r2', secondaryAssignedTo: 'r1' };
  const other = { assignedTo: 'r2' }, nobody = { assignedTo: 'u_1' };
  check('admin sees everything', P.isLeadVisibleInStage(other, 'working', admin));
  check('rep sees own lead', P.isLeadVisibleInStage(mine, 'working', rep));
  check('rep sees lead where secondary', P.isLeadVisibleInStage(second, 'completed', rep));
  check('rep does not see another rep\'s lead', !P.isLeadVisibleInStage(other, 'incoming', rep));
  check('rep sees unassigned leads in Incoming', P.isLeadVisibleInStage(nobody, 'incoming', rep));
  check('rep does not see unassigned leads elsewhere', !P.isLeadVisibleInStage(nobody, 'completed', rep));

  // The Sales Submittal.
  const bare = P.validateSalesRequest({});
  check('submittal requires model, value, customer, payment',
    ['model', 'estimatedValue', 'customerName', 'payment'].every(k => k in bare), Object.keys(bare).join(','));
  const cash = { model: 'T66', estimatedValue: '63000', customerName: 'Andrew Doub', payment: 'Cash' };
  check('a cash deal with no trade is valid', Object.keys(P.validateSalesRequest(cash)).length === 0);
  check('trade hours must be a number', 'tradeHours' in P.validateSalesRequest({ ...cash, trade: 'Yes', tradeHours: 'lots' }));
  const byKey = Object.fromEntries(P.SALES_REQUEST_FIELDS.map(f => [f.key, f]));
  check('lender only asked for a loan', P.isFieldShown(byKey.loanLender, { payment: 'Loan' }) && !P.isFieldShown(byKey.loanLender, { payment: 'Cash' }));
  check('payoff fields hidden without a trade', !P.isFieldShown(byKey.payoffNeeded, { trade: 'No' }));
  const pruned = P.pruneHiddenAnswers(P.SALES_REQUEST_FIELDS,
    { ...cash, loanLender: 'Wells Fargo', trade: 'No', payoffNeeded: 'Yes', payoffAmount: '5000' });
  check('switching to Cash drops the lender', pruned.loanLender === '');
  check('no trade drops the payoff chain two levels deep', pruned.payoffNeeded === '' && pruned.payoffAmount === '');
  check('pruning keeps real answers', pruned.model === 'T66' && pruned.payment === 'Cash');
  check('every submittal field has a known section',
    P.SALES_REQUEST_FIELDS.every(f => P.SALES_REQUEST_SECTIONS.includes(f.section)));
  const srKeys = new Set(P.SALES_REQUEST_FIELDS.map(f => f.key));
  check('every showIf points at a real question',
    [...P.SALES_REQUEST_FIELDS, ...P.BACK_OFFICE_FIELDS].every(f => !f.showIf || Object.keys(f.showIf).every(k =>
      srKeys.has(k) || P.BACK_OFFICE_FIELDS.some(b => b.key === k))));
  check('rep and back-office fields do not share keys',
    P.BACK_OFFICE_FIELDS.every(f => !srKeys.has(f.key)));
  check('deal fields offer the tracker\'s machine list', P.DEAL_FIELDS[0].options.length === 8);

  // App.jsx seeds its config from the module rather than a copied list.
  check('DEFAULT_CONFIG.statuses comes from pipeline.js', /statuses: PIPELINE_STATUSES,/.test(app));

  // The email's field list is a hand copy (no shared build) — keys must match.
  const fnSrc = readFileSync(join(root, 'functions/index.js'), 'utf8');
  const block = fnSrc.match(/const SALES_REQUEST_FIELDS = \[([\s\S]*?)\];/);
  const serverKeys = block ? [...block[1].matchAll(/key: '([^']+)'/g)].map(m => m[1]) : [];
  const clientKeys = P.SALES_REQUEST_FIELDS.map(f => f.key);
  check('email and form list the same sales request fields',
    JSON.stringify(serverKeys) === JSON.stringify(clientKeys), `server=[${serverKeys}] client=[${clientKeys}]`);

  // Operations requests (the Smartsheet "Sales Request" form, fields rebuilt
  // from the 3,496-row "Sales Request Completed" export).
  const blankReq = P.validateRequest({});
  check('request requires date, sales person, type, from, date needed',
    ['requestDate', 'salesPerson', 'requestTypes', 'fromLocation', 'dateNeeded'].every(k => k in blankReq), Object.keys(blankReq).join(','));
  const internal = { requestDate: '2026-09-25', salesPerson: 'r1', requestTypes: ['Delivery'], fromLocation: 'M1 (Indy)', toLocation: 'M3 (Indy North)', dateNeeded: '2026-09-30' };
  check('a store-to-store move needs no customer', Object.keys(P.validateRequest(internal)).length === 0);
  const toCust = P.validateRequest({ ...internal, toLocation: 'External Customer' });
  check('a delivery to a customer needs name and address', 'customerName' in toCust && 'customerAddress' in toCust);
  const fromCust = P.validateRequest({ ...internal, fromLocation: 'External Customer', toLocation: 'M1 (Indy)' });
  check('a pick-up from a customer needs a name but not an address', 'customerName' in fromCust && !('customerAddress' in fromCust));
  check('needed-by cannot be before the request date', 'dateNeeded' in P.validateRequest({ ...internal, dateNeeded: '2026-09-01' }));
  const rf = Object.fromEntries(P.REQUEST_FIELDS.map(f => [f.key, f]));
  check('service box shows for Service and Get Ready', P.isRequestFieldShown(rf.serviceRequest, { requestTypes: ['"Get Ready"'] }) && !P.isRequestFieldShown(rf.serviceRequest, { requestTypes: ['Delivery'] }));
  check('parts box shows only for Parts', P.isRequestFieldShown(rf.partsRequest, { requestTypes: ['Parts'] }) && !P.isRequestFieldShown(rf.partsRequest, { requestTypes: ['Delivery'] }));
  check('pruning drops a customer address on an internal move', P.pruneRequest({ ...internal, customerAddress: '1 Main St' }).customerAddress === '');
  check('every branch has a location code', ['Indy', 'Anderson', 'Indy North', 'Ellettsville', 'Columbus'].every(b => P.fromLocationForBranch(b)));
  check('location codes match the form', P.fromLocationForBranch('Columbus') === 'M6 (Columbus)' && P.fromLocationForBranch('Indy North') === 'M3 (Indy North)');
  // Department check-offs.
  check('delivery + service needs rental and service', JSON.stringify(P.departmentsFor(['Delivery', 'Service'])) === JSON.stringify(['rental', 'service']));
  check('get ready is a service job', JSON.stringify(P.departmentsFor(['"Get Ready"'])) === JSON.stringify(['service']));
  check('no check-offs = Open', P.requestStatusFromDone(['Delivery'], {}, 'Open') === 'Open');
  check('some check-offs = In Progress', P.requestStatusFromDone(['Delivery', 'Parts'], { rental: true }, 'Open') === 'In Progress');
  check('all needed check-offs = Completed', P.requestStatusFromDone(['Delivery', 'Parts'], { rental: true, parts: true }, 'In Progress') === 'Completed');
  check('an unneeded department alone does not complete it', P.requestStatusFromDone(['Parts'], { rental: true }, 'Open') === 'In Progress');
  check('unticking reopens a completed request', P.requestStatusFromDone(['Delivery'], { rental: false }, 'Completed') === 'Open');
  check('cancelled stays cancelled', P.requestStatusFromDone(['Delivery'], { rental: true }, 'Cancelled') === 'Cancelled');
  check('rep sees own request', P.isOwnRecordVisible({ salesPerson: 'r1' }, rep) && P.isOwnRecordVisible({ createdBy: 'r1', salesPerson: 'r2' }, rep));
  check('rep does not see others\' records', !P.isOwnRecordVisible({ salesPerson: 'r2', createdBy: 'a1' }, rep));
  check('admin sees all records', P.isOwnRecordVisible({ salesPerson: 'r2' }, admin));
  check('a rep can only cancel an open request', JSON.stringify(P.requestStatusOptionsFor('Open', false)) === JSON.stringify(['Open', 'Cancelled']));
  check('a rep cannot reopen a completed request', JSON.stringify(P.requestStatusOptionsFor('Completed', false)) === JSON.stringify(['Completed']));

  // Dead (Indy's Prospect sheet).
  check('Dead lives under Prospect', st('Dead') === 'prospect');
  check('Working can mark a lead Dead', opts('Prospect').includes('Dead'));

  // Trade-in evaluation.
  const tiBlank = P.validateFields(P.TRADE_IN_FIELDS, {});
  check('trade-in needs make/model/year/serial/hours and all 9 ratings',
    ['make', 'model', 'year', 'serial', 'hours', 'attachmentsIncluded'].every(k => k in tiBlank) && P.TRADE_CONDITIONS.every(c => c.key in tiBlank));
  const tf = Object.fromEntries(P.TRADE_IN_FIELDS.map(f => [f.key, f]));
  check('picking Miscellaneous (multi-select) shows its explain box',
    P.isFieldShown(tf.miscOptions, { machineOptions: ['Cab', 'Miscellaneous'] }) && !P.isFieldShown(tf.miscOptions, { machineOptions: ['Cab'] }));
  check('trade-in hours must be a number', 'hours' in P.validateFields(P.TRADE_IN_FIELDS, { hours: 'lots' }));
  check('ratings are 1-5 or N/A', JSON.stringify(P.RATING_OPTIONS) === JSON.stringify(['1', '2', '3', '4', '5', 'N/A']));
  check('trade-in awaits approval until a manager decides', P.tradeInStatus({}) === 'Awaiting Approval'
    && P.tradeInStatus({ manager: { approved: 'Yes' } }) === 'Approved' && P.tradeInStatus({ manager: { approved: 'No' } }) === 'Declined');

  // Finance (Sales Tracker).
  check('a financed submittal needs a finance deal', P.submittalNeedsFinance({ payment: 'Loan' }) && !P.submittalNeedsFinance({ payment: 'Cash' }));
  const fin = P.financeFromSubmittal({ payment: 'RP', model: 'T66', estimatedValue: '63000', customerName: 'Doub', otherFinancing: 'X' }, null);
  check('finance pre-fills from the submittal', fin.assetToFinance === 'T66' && fin.amount === '63000' && fin.dealType === 'RP Conversion Request');
  check('pre-filled finance deal passes validation', Object.keys(P.validateFields(P.FINANCE_REP_FIELDS, fin)).length === 0);
  check('3-day audit flags Ready to Invoice', P.financeAudit({ admin: { dealStatus: 'Ready to Invoice' }, dealStatusChangedAt: '2026-09-20T10:00:00Z' }, '2026-09-25').length === 1);
  check('3-day audit passes a fresh Ready to Invoice', P.financeAudit({ admin: { dealStatus: 'Ready to Invoice' }, dealStatusChangedAt: '2026-09-24T10:00:00Z' }, '2026-09-25').length === 0);
  check('audit flags docs not sent to lender', P.financeAudit({ admin: { invoicingDate: '2026-09-18' } }, '2026-09-25').length === 1);
  check('funded and declined are closed', ['Invoice-Funded', 'Declined'].every(s => P.FINANCE_CLOSED_STATUSES.includes(s)));

  // The server's copies of the field lists (no shared build) must match.
  for (const [kind, list] of [['requests', P.REQUEST_FIELDS], ['tradeIns', P.TRADE_IN_FIELDS], ['finance', P.FINANCE_REP_FIELDS]]) {
    const m = fnSrc.match(new RegExp(`  ${kind}: \\[([\\s\\S]*?)\\n  \\]`));
    const serverKeys = m ? [...m[1].matchAll(/key: '([^']+)'/g)].map(x => x[1]) : [];
    check(`${kind} email and form list the same fields`, JSON.stringify(serverKeys) === JSON.stringify(list.map(f => f.key)), `server=[${serverKeys}]`);
  }

  // Every email builder functions/index.js calls must exist. One didn't
  // (buildResubmissionEmailHtml) and the try/catch around it hid the error.
  const called  = new Set([...fnSrc.matchAll(/\b(build\w+EmailHtml)\(/g)].map(m => m[1]));
  const defined = new Set([...fnSrc.matchAll(/function (build\w+EmailHtml)\(/g)].map(m => m[1]));
  const missing = [...called].filter(n => !defined.has(n));
  check('every email builder that is called is defined', missing.length === 0, missing.join(', '));
}

// ---- Attachments ------------------------------------------------------------
{
  const P = await import('../src/lib/pipeline.js');
  const f = (name, type, size = 1000) => ({ name, type, size });
  check('pdf accepted',               P.checkAttachment(f('quote.pdf', 'application/pdf')) === null);
  check('photo accepted',             P.checkAttachment(f('IMG_1.HEIC', 'image/heic')) === null);
  check('xlsx with no browser type falls back to extension', P.attachmentContentType(f('deal.xlsx', '')) === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  check('xlsx with no type accepted', P.checkAttachment(f('deal.xlsx', '')) === null);
  check('exe rejected',               P.checkAttachment(f('setup.exe', 'application/x-msdownload')) !== null);
  check('empty file rejected',        P.checkAttachment(f('a.pdf', 'application/pdf', 0)) !== null);
  check('over 25 MB rejected',        P.checkAttachment(f('big.pdf', 'application/pdf', P.ATTACHMENT_MAX_BYTES + 1)) !== null);
  check('safeFileName strips path and odd characters', !/[\/\\#?%]/.test(P.safeFileName('..\\a/b#c?d%e.pdf')) && P.safeFileName('..\\a/b#c?d%e.pdf').endsWith('.pdf'));
  check('safeFileName never empty',   P.safeFileName('').length > 0);
  check('formatBytes',                P.formatBytes(2048) === '2 KB' || P.formatBytes(2048) === '2.0 KB');

  // storage.rules must accept the same types the client lets through.
  const rules = readFileSync(join(root, 'storage.rules'), 'utf8');
  const m = rules.match(/contentType\.matches\('([^']+)'\)/);
  check('storage.rules has a content-type check', !!m);
  if (m) {
    const re = new RegExp(m[1]);
    const types = ['application/pdf', 'image/jpeg', 'image/heic', 'text/csv', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    const drift = types.filter(t => P.ATTACHMENT_TYPE_PATTERN.test(t) !== re.test(t));
    check('storage.rules and client agree on file types', drift.length === 0, drift.join(', '));
    check('storage.rules rejects executables', !re.test('application/x-msdownload'));
  }
  check('storage.rules size cap matches client', rules.includes(String(P.ATTACHMENT_MAX_BYTES)) || rules.includes('25 * 1024 * 1024'));
  const fb = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
  check('firebase.json points at storage.rules', fb.storage?.rules === 'storage.rules');
  // `attachments` holds uploaded files on every record; a form field with that
  // key gets overwritten by the first upload (it happened on trade-ins).
  const lists = { SALES_REQUEST_FIELDS: P.SALES_REQUEST_FIELDS, BACK_OFFICE_FIELDS: P.BACK_OFFICE_FIELDS, DEAL_FIELDS: P.DEAL_FIELDS,
    REQUEST_FIELDS: P.REQUEST_FIELDS, TRADE_IN_FIELDS: P.TRADE_IN_FIELDS, TRADE_IN_MANAGER_FIELDS: P.TRADE_IN_MANAGER_FIELDS,
    FINANCE_REP_FIELDS: P.FINANCE_REP_FIELDS, FINANCE_ADMIN_FIELDS: P.FINANCE_ADMIN_FIELDS };
  const clash = Object.entries(lists).filter(([, l]) => (l || []).some(f => f.key === 'attachments')).map(([n]) => n);
  check('no form field is keyed `attachments`', clash.length === 0, clash.join(', '));
}

// ---- Status renames ---------------------------------------------------------
{
  const P = await import('../src/lib/pipeline.js');
  check('rename: Want -> Wanted', P.renamedStatus('Want') === 'Wanted');
  check('rename: old submittal statuses -> Completed', P.renamedStatus('Sales Request') === 'Completed' && P.renamedStatus('Sales Submittal') === 'Completed');
  check('rename: Cancelled -> Lost', P.renamedStatus('Cancelled') === 'Lost');
  check('rename: Qualified -> Working; others unchanged', P.renamedStatus('Qualified') === 'Working' && P.renamedStatus('Working') === 'Working');
  const healed = P.ensurePipelineStatuses({ statuses: ['New', 'Want', 'Sales Submittal', 'Custom'], closedStatuses: [], staleness: { thresholds: { Want: 200, 'Sales Submittal': 48 } } });
  check('rename: Settings drops old names, keeps custom ones', !healed.statuses.includes('Want') && !healed.statuses.includes('Sales Submittal') && healed.statuses.includes('Wanted') && healed.statuses.includes('Custom'), healed.statuses.join(','));
  check('rename: a threshold set under the old name carries over', healed.staleness.thresholds.Wanted === 200 && !('Want' in healed.staleness.thresholds));
  check('rename: a renamed-to-closed threshold is dropped (Completed is never stale)', !('Completed' in healed.staleness.thresholds) && !('Sales Submittal' in healed.staleness.thresholds));
}

// ---- Global search ---------------------------------------------------------
{
  const G = await import('../src/lib/search.js');
  const leads = [
    { id: '1', customerName: 'Dana Miller', companyName: 'Miller Excavating', phone: '(317) 555-0104', contactEmail: 'dana@miller.com', zip: '46225', createdDate: '2026-09-01' },
    { id: '2', customerName: 'Sam Danaher', companyName: '', phone: '317-555-0199', contactEmail: 'sam@ex.com', zip: '47401', createdDate: '2026-09-20' },
    { id: '3', customerName: 'José Ortega', companyName: 'Ortega Lawn', phone: '', contactEmail: '', zip: '46075', createdDate: '2026-08-01' },
  ];
  const ids = (xs) => xs.map(x => x.id).join(',');
  check('search: name prefix ranks first', ids(G.searchLeads(leads, 'dana')) === '1,2', ids(G.searchLeads(leads, 'dana')));
  check('search: phone digits ignore formatting', ids(G.searchLeads(leads, '3175550104')) === '1');
  check('search: partial phone', ids(G.searchLeads(leads, '555-0199')) === '2');
  check('search: every word must match', ids(G.searchLeads(leads, 'miller excav')) === '1' && G.searchLeads(leads, 'miller ortega').length === 0);
  check('search: accents ignored', ids(G.searchLeads(leads, 'jose')) === '3');
  check('search: zip', ids(G.searchLeads(leads, '47401')) === '2');
  check('search: empty query finds nothing', G.searchLeads(leads, '   ').length === 0);
  check('search: trade-in by serial', G.searchTradeIns([{ id: 't', serial: 'B7E811386', make: 'Bobcat' }], 'b7e811').length === 1);
  check('search: request by customer', G.searchRequests([{ id: 'r', customerName: 'Greenfield Street Dept', requestTypes: ['Delivery'] }], 'greenfield').length === 1);
  check('search: finance by lender', G.searchFinance([{ id: 'f', customerName: 'X', admin: { lenderName: 'Wells Fargo' } }], 'wells').length === 1);
  check('search: caps results', G.searchLeads(Array.from({ length: 20 }, (_, i) => ({ id: String(i), customerName: 'Pat ' + i })), 'pat').length === 8);
}

// ---- Zapier intake rules ---------------------------------------------------
{
  const { createRequire } = await import('node:module');
  const R = createRequire(import.meta.url)('../functions/intakeRules.js');
  const branches = ['Anderson', 'Columbus', 'Ellettsville', 'Indy', 'Indy North'];
  check('intake: branch matched ignoring case/space', R.canonical('indy  north', branches) === 'Indy North' && R.canonical('INDY', branches) === 'Indy');
  check('intake: "Indy" does not become "Indy North"', R.canonical('Indy', branches) === 'Indy');
  check('intake: unknown branch kept as sent', R.canonical(' Fishers ', branches) === 'Fishers');
  check('intake: empty stays empty', R.canonical(undefined, branches) === '');
  check('intake: status is always New', R.intakeStatus() === 'New');
  check('intake: missing source files as Internet', R.intakeSource('', ['Internet']) === 'Internet' && R.intakeSource(undefined, []) === 'Internet');
  check('intake: source matched to Settings spelling', R.intakeSource('gravity forms', ['Gravity Forms']) === 'Gravity Forms');
  check('intake: default source is one of the app defaults', ['Internet'].every(x => R.DEFAULT_SOURCE === x));
  const closed = R.closedStatusesFrom({ closedStatuses: ['Lost'] });
  check('intake: closed list covers the pipeline even with old Settings', ['Completed', 'Lost', 'Dead', 'Unqualified', 'Cancelled'].every(x => closed.includes(x)));
  check('intake: repeat joins an open lead', R.canLinkResubmission({ status: 'Working' }, closed) && R.canLinkResubmission({ status: 'Wanted' }, closed));
  check('intake: a prospect reaching out again gets a fresh lead', !R.canLinkResubmission({ status: 'Prospect' }, closed));
  check('intake: repeat never joins a closed lead', !R.canLinkResubmission({ status: 'Completed' }, closed) && !R.canLinkResubmission({ status: 'Dead' }, closed));
  check('intake: repeat spam stays in Junk', R.canLinkResubmission({ status: 'Junk' }, closed));
  check('intake: every pipeline closed status is covered', ['Completed', 'Lost', 'Unqualified', 'Dead', 'Cancelled'].every(x => R.CLOSED_STATUSES.includes(x)));
  const fnSrc = readFileSync(join(root, 'functions/index.js'), 'utf8');
  check('intake: the endpoint uses the rules', /intakeStatus\(\)/.test(fnSrc) && /closedStatusesFrom\(appConfig\)/.test(fnSrc) && !/'Google Sheet'/.test(fnSrc));
}

// ---- Lead routing (Oct 2026: branch manager, ZIP splits, shared areas) ----
{
  const { createRequire } = await import('node:module');
  const R = createRequire(import.meta.url)('../functions/routingRules.js');
  const cfg = {
    branches: ['Anderson', 'Columbus', 'Ellettsville', 'Indy', 'Indy North'],
    branchManagers: { Anderson: 'jack', Indy: 'rob', 'Indy North': 'nate' },
    leadRouting: {
      'Anderson::Parts': { primaryUserId: 'melvin', backupUserId: 'gary', cc1: 'x@ex.com' },
      'Anderson::Sales': { primaryUserId: 'michel', zipSplits: [{ userId: 'michel', zips: '46011, 46012' }, { userId: 'max', zips: '460' }] },
      'Indy::Sales': { primaryUserId: 'drew' },
      'Indy North::Sales': { primaryUserId: 'todd', zipSplits: [{ userId: 'chris', zips: '46077, 46250' }] }
    },
    sharedAreas: [{ name: 'Marion County', branches: ['Indy', 'Indy North'], zips: R.MARION_COUNTY_ZIPS.join(', ') }]
  };
  const plan = (o) => R.planRouting(cfg, o);
  check('zip: exact and prefix', R.zipMatches('46011', '46011') && R.zipMatches('46099', '460') && !R.zipMatches('46199', '460'));
  check('zip: ZIP+4 and junk handled', R.zipMatches('46011-1234', '46011') && !R.zipMatches('', '460') && !R.zipMatches('abc', '460'));
  let p = plan({ branch: 'Anderson', department: 'Parts', zip: '46011' });
  check('routing: dept person assigned, backup second', p.matched && p.assigneeId === 'melvin' && p.backupId === 'gary');
  check('routing: branch manager copied', p.branchManagerId === 'jack' && p.ccEmails.includes('x@ex.com'));
  p = plan({ branch: 'Anderson', department: 'Sales', zip: '46011' });
  check('routing: first matching ZIP split wins', p.assigneeId === 'michel' && p.via === 'zip');
  p = plan({ branch: 'Anderson', department: 'Sales', zip: '46040' });
  check('routing: prefix split', p.assigneeId === 'max' && p.via === 'zip');
  p = plan({ branch: 'Anderson', department: 'Sales', zip: '47401' });
  check('routing: no split match falls back to primary', p.assigneeId === 'michel' && p.via === 'primary');
  p = plan({ branch: '', department: 'Sales', zip: '46040' });
  check('routing: no branch, ZIP split supplies it', p.matched && p.branch === 'Anderson' && p.assigneeId === 'max');
  check('routing: no branch and no claiming split = unrouted', plan({ branch: '', department: 'Sales', zip: '47401' }).reason === 'no-branch');
  p = plan({ branch: 'Indy', department: 'Sales', zip: '46250' });
  check('routing: Marion County Indy sales lead also goes to the Indy North ZIP rep', p.assigneeId === 'drew' && JSON.stringify(p.partnerIds) === JSON.stringify(['chris']));
  p = plan({ branch: 'Indy North', department: 'Sales', zip: '46201' });
  check('routing: Marion County Indy North lead also goes to Indy', p.assigneeId === 'todd' && JSON.stringify(p.partnerIds) === JSON.stringify(['drew']));
  check('routing: outside Marion County, no partner', plan({ branch: 'Indy', department: 'Sales', zip: '46143' }).partnerIds.length === 0);
  check('routing: shared area is sales only', plan({ branch: 'Indy', department: 'Parts', zip: '46201' }).partnerIds.length === 0);
  const withPartsSplit = { ...cfg, leadRouting: { ...cfg.leadRouting, 'Anderson::Parts': { primaryUserId: 'melvin', zipSplits: [{ userId: 'zed', zips: '460' }] } } };
  check('routing: ZIP splits ignored for non-sales departments', R.planRouting(withPartsSplit, { branch: 'Anderson', department: 'Parts', zip: '46011' }).assigneeId === 'melvin');
  check('routing: no branch + parts lead is not placed by ZIP', R.planRouting(withPartsSplit, { branch: '', department: 'Parts', zip: '46011' }).reason === 'no-branch');
  check('routing: "sales" in any case counts as Sales', R.planRouting(cfg, { branch: 'Anderson', department: 'SALES', zip: '46040' }).assigneeId === 'max');
  check('routing: case-insensitive department', plan({ branch: 'Anderson', department: 'parts', zip: '' }).assigneeId === 'melvin');
  const unrouted = plan({ branch: 'Indy', department: 'Service', zip: '' });
  check('routing: unrouted lead still names its branch manager', !unrouted.matched && unrouted.reason === 'no-routing-entry' && unrouted.branchManagerId === 'rob');
  check('routing: Marion County list has 56 ZIPs incl. Beech Grove', R.MARION_COUNTY_ZIPS.length === 56 && R.MARION_COUNTY_ZIPS.includes('46107'));
  const appSrc = readFileSync(join(root, 'src/App.jsx'), 'utf8');
  const m = appSrc.match(/const MARION_COUNTY_ZIPS = '([^']+)'/);
  check('routing: Settings and server Marion County lists match', !!m && m[1].split(/,\s*/).join(',') === R.MARION_COUNTY_ZIPS.join(','));
}

// ---- Daily reminders ---------------------------------------------------------
{
  const { createRequire } = await import('node:module');
  const M = createRequire(import.meta.url)('../functions/reminderRules.js');
  const now = Date.parse('2026-10-29T13:00:00Z');
  const ago = (d) => new Date(now - d * 86400e3).toISOString();
  check('contact: assigned New lead from yesterday', M.needsContactReminder({ status: 'New', assignedTo: 'r1', dateAssigned: ago(1) }, now));
  check('contact: not the day it was assigned', !M.needsContactReminder({ status: 'New', assignedTo: 'r1', dateAssigned: ago(0.2) }, now));
  check('contact: not unassigned', !M.needsContactReminder({ status: 'New', assignedTo: 'u_1', dateAssigned: ago(3) }, now));
  check('contact: stops once it leaves New', !M.needsContactReminder({ status: 'Working', assignedTo: 'r1', dateAssigned: ago(3) }, now));
  check('follow-up: 30 days after completion', M.needsFollowUpReminder({ status: 'Completed', assignedTo: 'r1', completedAt: ago(30.2) }, now));
  check('follow-up: not at 29 days', !M.needsFollowUpReminder({ status: 'Completed', assignedTo: 'r1', completedAt: ago(29) }, now));
  check('follow-up: not old deals (45+ days)', !M.needsFollowUpReminder({ status: 'Completed', assignedTo: 'r1', completedAt: ago(200) }, now));
  check('follow-up: only once', !M.needsFollowUpReminder({ status: 'Completed', assignedTo: 'r1', completedAt: ago(31), followUpReminderSentAt: ago(1) }, now));
  check('follow-up: falls back to statusChangedAt', M.needsFollowUpReminder({ status: 'Completed', assignedTo: 'r1', statusChangedAt: ago(32) }, now));
  const g = M.groupByAssignee([{ id: 'a', assignedTo: 'r1' }, { id: 'b', assignedTo: 'r2' }, { id: 'c', assignedTo: 'r1' }]);
  check('reminders: one email per rep', g.r1.length === 2 && g.r2.length === 1);
  const fn = readFileSync(join(root, 'functions/index.js'), 'utf8');
  check('reminders: scheduled weekdays 8am Indianapolis', /schedule: '0 8 \* \* 1-5'/.test(fn) && /timeZone: 'America\/Indiana\/Indianapolis'/.test(fn));
}

// ---- Prospect tags -------------------------------------------------------------
{
  const P = await import('../src/lib/pipeline.js');
  const G = await import('../src/lib/search.js');
  const l = { prospectKeywords: 'ctl, cat, needs trailer', deal: { machines: ['Compact Track Loader', 'Mini Excavator', 'Other'] } };
  check('tags: typed + Deal machines, deduped, standard spelling', JSON.stringify(P.prospectTags(l)) === JSON.stringify(['CTL', 'Cat', 'needs trailer', 'Mini Ex']), JSON.stringify(P.prospectTags(l)));
  check('tags: a Deal machine alone files under its tag', JSON.stringify(P.prospectTags({ deal: { machines: ['Skid Steer Loader'] } })) === JSON.stringify(['SSL']));
  check('tags: filter needs every selected tag, any case', P.hasAllTags(l, ['ctl', 'MINI EX']) && !P.hasAllTags(l, ['CTL', 'SSL']) && P.hasAllTags(l, []));
  check('tags: suggestion chip toggles on and off', P.toggleKeyword('Cat', 'CTL') === 'Cat, CTL' && P.toggleKeyword('Cat, ctl', 'CTL') === 'Cat');
  check('tags: search finds a prospect by machine tag', G.searchLeads([{ id: 'x', customerName: 'Zed', deal: { machines: ['Compact Track Loader'] } }], 'ctl').length === 1);
}

// ---- To Do hub ------------------------------------------------------------------
{
  const T = await import('../src/lib/todo.js');
  const today = '2026-10-29', now = Date.parse('2026-10-29T14:00:00');
  const ago = (d) => new Date(now - d * 86400e3).toISOString();
  const sr = (o = {}) => ({ model: 'T76', payment: 'Cash', submittedAt: ago(2), status: 'Open', ...o });
  const leads = [
    { id: 'f1', status: 'Working', assignedTo: 'r1', customerName: 'Due Today', followUp: { date: today, note: 'call back' } },
    { id: 'f2', status: 'Prospect', assignedTo: 'r1', customerName: 'Overdue', followUp: { date: '2026-10-20' } },
    { id: 'f3', status: 'Working', assignedTo: 'r1', customerName: 'Future', followUp: { date: '2026-11-05' } },
    { id: 'c1', status: 'New', assignedTo: 'r1', customerName: 'Uncontacted', dateAssigned: ago(2) },
    { id: 'c2', status: 'New', assignedTo: 'r1', customerName: 'Just assigned', dateAssigned: ago(0.1) },
    { id: 'w1', status: 'Working', assignedTo: 'r1', customerName: 'Past deadline', workingUntil: ago(1) },
    { id: 'p1', status: 'Completed', assignedTo: 'r1', customerName: 'Cash deal', salesRequest: sr(), attachments: [{ docType: 'purchaseAgreement', name: 'pa.pdf' }] },
    { id: 'p2', status: 'Completed', assignedTo: 'r1', customerName: 'Loan deal', salesRequest: sr({ payment: 'Loan', docs: { customerId: { receivedAt: ago(1) } } }) },
    { id: 'p3', status: 'Completed', assignedTo: 'r1', customerName: 'Done paperwork', salesRequest: sr({ status: 'Complete' }) },
    { id: 's1', status: 'Completed', assignedTo: 'r1', customerName: 'Month ago', completedAt: ago(35) },
    { id: 's2', status: 'Completed', assignedTo: 'r1', customerName: 'Checked in', completedAt: ago(35), postSaleFollowUpDoneAt: ago(1) },
    { id: 'o1', status: 'New', assignedTo: 'r2', customerName: 'Other rep', dateAssigned: ago(3) },
    { id: 'j1', status: 'Junk', assignedTo: 'r1', customerName: 'Junk', followUp: { date: today } }
  ];
  const records = {
    tradeIns: [{ id: 't1', make: 'Kubota', salesPerson: 'r1' }, { id: 't2', make: 'Cat', manager: { approved: 'Yes' } }],
    requests: [{ id: 'q1', status: 'Open', dateNeeded: '2026-10-28', requestTypes: ['Delivery'] }, { id: 'q2', status: 'Open', dateNeeded: '2026-11-10' }, { id: 'q3', status: 'Completed', dateNeeded: '2026-10-01' }],
    finance: [{ id: 'fn1', admin: { dealStatus: 'Ready to Invoice' }, dealStatusChangedAt: ago(6) }]
  };
  const mine = T.buildTodos({ leads, records, repId: 'r1', backOffice: false, today, now });
  const ids = (sec) => mine.filter(i => i.section === sec).map(i => i.leadId || i.recordId).join(',');
  check('todo: follow-ups due today and overdue, not future or junk', ids('followup') === 'f2,f1', ids('followup'));
  check('todo: overdue follow-up is flagged', mine.find(i => i.id === 'followup:f2').overdue && !mine.find(i => i.id === 'followup:f1').overdue);
  check('todo: make contact skips the day of assignment', ids('contact') === 'c1', ids('contact'));
  check('todo: working deadline passed', ids('deadline') === 'w1');
  check('todo: missing paperwork on open submittals only', ids('paperwork') === 'p1,p2' || ids('paperwork') === 'p2,p1', ids('paperwork'));
  const p1 = mine.find(i => i.id === 'paperwork:p1'), p2 = mine.find(i => i.id === 'paperwork:p2');
  check('todo: cash deal needs no credit app; uploaded doc counts', JSON.stringify(p1.missing) === JSON.stringify(['customerId', 'delivery']), JSON.stringify(p1.missing));
  check('todo: financed deal needs credit app; paper tick counts', JSON.stringify(p2.missing) === JSON.stringify(['purchaseAgreement', 'creditApp', 'delivery']), JSON.stringify(p2.missing));
  check('todo: 30-day check-in until marked done', ids('postsale') === 's1');
  check('todo: a rep never sees back office or other reps', !mine.some(i => ['submittal', 'tradein', 'request', 'finance'].includes(i.section)) && !mine.some(i => i.leadId === 'o1'));
  const admin = T.buildTodos({ leads, records, repId: 'admin', backOffice: true, today, now });
  const aids = (sec) => admin.filter(i => i.section === sec).map(i => i.leadId || i.recordId).sort().join(',');
  check('todo: back office open submittals', aids('submittal') === 'p1,p2', aids('submittal'));
  check('todo: trade-ins awaiting approval', aids('tradein') === 't1');
  check('todo: requests due or overdue, open only', aids('request') === 'q1');
  check('todo: finance audit flags', aids('finance') === 'fn1');
  const every = T.buildTodos({ leads, records, repId: '*', today, now });
  check('todo: every rep includes others', every.some(i => i.leadId === 'o1'));
  check('todo: sections in order', JSON.stringify([...new Set(mine.map(i => i.section))]) === JSON.stringify(['followup', 'contact', 'paperwork', 'deadline', 'postsale']));
  check('todo: due labels', T.dueLabel(today, today) === 'Today' && T.dueLabel('2026-10-28', today) === 'Yesterday' && T.dueLabel('2026-10-26', today) === '3 days overdue' && T.dueLabel('2026-10-30', today) === 'Tomorrow');
  const { createRequire } = await import('node:module');
  const M = createRequire(import.meta.url)('../functions/reminderRules.js');
  check('email: follow-up date due today or earlier', M.followUpDateDue({ status: 'Working', assignedTo: 'r1', followUp: { date: '2026-10-29' } }, '2026-10-29') && !M.followUpDateDue({ status: 'Working', assignedTo: 'r1', followUp: { date: '2026-10-30' } }, '2026-10-29'));
  check('email: Indianapolis date', M.indyToday(Date.parse('2026-10-30T02:00:00Z')) === '2026-10-29');
}

/* ---------- self-repair loop (functions/selfRepairRules.js) ---------- */
{
  const { createRequire } = await import('node:module');
  const S = createRequire(import.meta.url)('../functions/selfRepairRules.js');
  const fnSrc = readFileSync(join(root, 'functions/index.js'), 'utf8');

  // Triage
  check('repair: offline blips are noise', S.isNoise('TypeError: Failed to fetch') && S.isNoise('FirebaseError: client is offline'));
  check('repair: extension errors are noise', S.isNoise('x is undefined', 'at foo (chrome-extension://abc/content.js:1:1)'));
  check('repair: real errors are not noise', !S.isNoise("Cannot read properties of undefined (reading 'status')", 'at LeadsView (App.jsx:10:2)'));
  check('repair: ids, numbers and quotes normalised', S.normalizeMessage('Lead "abc" 123 not found for bob@x.com at https://a.b/c') === 'Lead <str> <n> not found for <email> at <url>', S.normalizeMessage('Lead "abc" 123 not found for bob@x.com at https://a.b/c'));
  const a = S.fingerprint({ source: 'server', tag: 'intake', message: 'Lead q9w8e7r6t5y4u3i2 failed (3 tries)', stack: 'Error\n    at resolveLeadRouting (/workspace/index.js:612:11)' });
  const b = S.fingerprint({ source: 'server', tag: 'intake', message: 'Lead zz9988776655443322 failed (5 tries)', stack: 'Error\n    at resolveLeadRouting (/workspace/index.js:640:3)' });
  const c = S.fingerprint({ source: 'server', tag: 'reminders', message: 'Lead q9w8e7r6t5y4u3i2 failed (3 tries)', stack: '' });
  check('repair: same bug, same fingerprint', a === b, `${a} ${b}`);
  check('repair: different tag, different fingerprint', a !== c);
  check('repair: client fingerprint survives a redeploy',
    S.fingerprint({ source: 'client', message: 'x is undefined', stack: 'at Xe (https://h/assets/index-B1x9Qa7c.js:41:2318)' }) ===
    S.fingerprint({ source: 'client', message: 'x is undefined', stack: 'at Qr (https://h/assets/index-Zz88Kq1d.js:44:10)' }));
  check('repair: tag from "[tag]" prefix', S.tagOf('[intake] Routing lookup failed') === 'intake' && S.tagOf('plain') === '');
  check('repair: fingerprint is a safe doc id', /^[a-z]+-[a-z0-9]+$/.test(a), a);

  // Hand-off decisions
  const today = '2026-10-29';
  check('repair: one-off error waits', S.issueDecision({ kind: 'code', count: 1 }, {}, today).file === false);
  check('repair: repeat error goes to the agent', JSON.stringify(S.issueDecision({ kind: 'code', count: 2 }, {}, today)) === JSON.stringify({ file: true, ai: true, reason: 'code-error' }));
  check('repair: daily cap files without the agent', JSON.stringify(S.issueDecision({ kind: 'code', count: 5 }, { day: today, aiIssuesFiled: 3 }, today)) === JSON.stringify({ file: true, ai: false, reason: 'daily-ai-cap' }));
  check('repair: cap resets the next day', S.issueDecision({ kind: 'code', count: 5 }, { day: '2026-10-28', aiIssuesFiled: 3 }, today).ai === true);
  check('repair: config problems never go to the agent', JSON.stringify(S.issueDecision({ kind: 'config', count: 1 }, {}, today)) === JSON.stringify({ file: true, ai: false, reason: 'config-needs-human' }));
  check('repair: not filed twice', S.issueDecision({ kind: 'code', count: 9, issueNumber: 4, status: 'open' }, {}, today).file === false);
  const now = Date.parse('2026-10-29T12:00:00Z');
  check('repair: quiet a week resolves', S.shouldResolve({ status: 'open', lastSeen: '2026-10-21T12:00:00Z' }, now) && !S.shouldResolve({ status: 'open', lastSeen: '2026-10-25T12:00:00Z' }, now));
  const act = (inc, opts) => S.incidentAction(inc, {}, today, now, opts).action;
  check('repair: muted incidents are left alone', act({ status: 'muted', kind: 'code', count: 9 }) === 'mute');
  check('repair: recurrence reopens the issue', act({ status: 'open', kind: 'code', count: 9, issueNumber: 7, reopened: true, lastSeen: '2026-10-29T11:00:00Z' }) === 'reopen');
  check('repair: health incident resolves when the check stops failing',
    act({ status: 'open', source: 'health', checkId: 'fn-intake', kind: 'config', issueNumber: 3 }, { failingHealthIds: [] }) === 'resolve' &&
    act({ status: 'open', source: 'health', checkId: 'fn-intake', kind: 'config', issueNumber: 3 }, { failingHealthIds: ['fn-intake'] }) === 'none');
  check('repair: new health problem is filed', act({ status: 'open', source: 'health', checkId: 'x', kind: 'config', count: 1 }, { failingHealthIds: ['x'] }) === 'file');

  // Probes — the Oct 2026 welcome-email outage looked like this.
  const googleHtml = '<html><head><title>401 Unauthorized</title></head><body>Your client does not have permission</body></html>';
  check('repair: running callable = ok', S.callableProbeResult(401, 'application/json', '{"error":{"message":"Sign in first.","status":"UNAUTHENTICATED"}}').ok);
  check('repair: missing invoker permission detected', S.callableProbeResult(403, 'text/html', googleHtml).problem === 'not-invokable' && S.callableProbeResult(401, 'text/html', googleHtml).problem === 'not-invokable');
  check('repair: undeployed callable detected', S.callableProbeResult(404, 'text/html', 'Not Found').problem === 'not-deployed');
  check('repair: intake answering 401 JSON = ok', S.httpProbeResult(401, 'application/json; charset=utf-8', '{"ok":false,"error":"Unauthorized"}').ok);
  check('repair: intake blocked by Google detected', S.httpProbeResult(403, 'text/html', googleHtml).problem === 'not-invokable');
  check('repair: invoker fix names the service in lower case', S.FIX_FOR['not-invokable']('sendWelcomeEmail', 'us-south1').includes('gcloud run services add-iam-policy-binding sendwelcomeemail --region=us-south1'));
  const exported = [...fnSrc.matchAll(/^exports\.(\w+) = (onRequest|onCall)\(/gm)].map(m => m[1]).sort();
  const probed = S.PROBES.map(p => p.name).sort();
  check('repair: every HTTP function is probed', JSON.stringify(exported) === JSON.stringify(probed), `exported ${exported} vs probed ${probed}`);
  for (const p of S.PROBES) {
    const m = fnSrc.match(new RegExp(`exports\\.${p.name} = on\\w+\\(\\s*\\{[^]*?region: '([\\w-]+)'`));
    check(`repair: probe region for ${p.name}`, m && m[1] === p.region, m ? m[1] : 'no region');
  }
  check('repair: status is the worst failing check', S.healthStatus([{ ok: true }]) === 'ok' && S.healthStatus([{ ok: false, severity: 'warning' }]) === 'warning' && S.healthStatus([{ ok: false, severity: 'warning' }, { ok: false, severity: 'error' }]) === 'error');
  check('repair: alert only when the failing set changes', S.alertKey([{ id: 'b', ok: false }, { id: 'a', ok: false }, { id: 'c', ok: true }]) === 'a,b');

  // Config checks
  const users = [{ id: 'u_1' }, { id: 'drew', name: 'Drew' }, { id: 'todd', name: 'Todd', onLeaveOfAbsence: true }];
  const good = { notifications: { newLeadEmails: ['a@b.com'], salesRequestEmails: ['c@d.com'] }, leadRouting: { 'Indy::Sales': { primaryUserId: 'drew' } }, branchManagers: { Indy: 'drew' } };
  check('repair: complete config passes', S.configChecks(good, users).length === 0, JSON.stringify(S.configChecks(good, users)));
  check('repair: unsaved settings caught', S.configChecks({}, users)[0].id === 'config-missing');
  const bad = { notifications: {}, leadRouting: { 'Indy::Sales': { primaryUserId: 'gone', zipSplits: [{ userId: 'todd', zips: '462' }] } }, branchManagers: { Columbus: 'nobody' } };
  const ids = S.configChecks(bad, [{ id: 'drew' }, users[2]]).map(x => x.id);
  check('repair: config problems found', ['u1-missing', 'no-new-lead-recipients', 'no-submittal-recipients', 'routing-missing-Indy::Sales-Local Primary', 'routing-leave-Indy::Sales-ZIP split rep', 'manager-missing-Columbus'].every(i => ids.includes(i)), ids.join(' '));
  check('repair: switched-off new lead alerts need no list', !S.configChecks({ ...good, notifications: { newLeadAlertsEnabled: false, salesRequestEmails: ['c@d.com'] } }, users).length);

  // New-error alert emails
  check('repair: alert once when an error first gets an issue', S.errorAlertKind({ source: 'server', kind: 'code', count: 2 }, 'file') === 'new' && S.errorAlertKind({ source: 'server', count: 2, alertedAt: 'x' }, 'file') === '');
  check('repair: alert when an error comes back', S.errorAlertKind({ source: 'client', issueNumber: 4, reopened: true }, 'reopen') === 'back' && S.errorAlertKind({ source: 'client', resolvedAt: 'x', count: 3 }, 'file') === 'back');
  check('repair: health problems use their own alert', S.errorAlertKind({ source: 'health', kind: 'config' }, 'file') === '');
  check('repair: no alert for waiting or resolving', S.errorAlertKind({ source: 'server', count: 1 }, 'none') === '' && S.errorAlertKind({ source: 'server' }, 'resolve') === '');
  check('repair: alert subjects', S.errorAlertSubject([{ alertKind: 'new' }]) === 'LMT: 1 new error found' && S.errorAlertSubject([{ alertKind: 'new' }, { alertKind: 'back' }]) === 'LMT: 2 new errors found (1 came back)' && S.errorAlertSubject([{ alertKind: 'back' }]) === 'LMT: an error came back');

  // Issue text
  const inc = { id: 'client-abc', source: 'client', kind: 'code', message: "Cannot read properties of undefined (reading 'status')", stack: 'at Xe (index.js:1:2)', count: 3, firstSeen: 'f', lastSeen: 'l', build: 'abc123', view: 'stage-incoming' };
  check('repair: title says where', S.issueTitle(inc).startsWith('[auto] App: Cannot read'));
  const body = S.issueBody(inc, { ai: true });
  check('repair: agent body carries the guard rails', body.includes('Never edit `.github/`') && body.includes('Fixes #') && body.includes('`abc123`') && body.includes('scripts/map-stack.mjs'));
  check('repair: capped body explains how to start the agent', S.issueBody(inc, { ai: false }).includes('Add the `auto-repair` label'));
  check('repair: config body is not for the agent', S.issueBody({ ...inc, kind: 'config', source: 'health' }, { ai: false }).includes('not sent to the repair agent'));
}

/* ---------- Module access: Lead Management vs Telematics (Nov 2026) ---------- */
{
  const A = await import('../src/lib/access.js');
  const admin = { id: 'a', role: 'admin', leadAccess: false, telematicsAccess: false };
  const rep = { id: 'r', role: 'user' };                                   // an account from before the switches
  const both = { id: 'b', role: 'user', telematicsAccess: true };
  const tele = { id: 't', role: 'user', leadAccess: false, telematicsAccess: true };
  const none = { id: 'n', role: 'user', leadAccess: false };
  const sys = { id: 'u_1', isSystem: true };
  const ADMIN_ONLY = ['reports', 'users', 'settings'];

  check('access: admins always have both modules', A.hasLeadAccess(admin) && A.hasTelematicsAccess(admin));
  check('access: existing accounts keep lead access, no telematics', A.hasLeadAccess(rep) && !A.hasTelematicsAccess(rep));
  check('access: telematics-only has no lead access', !A.hasLeadAccess(tele) && A.hasTelematicsAccess(tele));
  check('access: nobody signed in / system user has nothing', !A.hasLeadAccess(null) && !A.hasTelematicsAccess(null) && !A.hasLeadAccess(sys) && !A.hasTelematicsAccess(sys));
  check('access: telematics-only cannot open a lead view', !A.canOpenView('stage-incoming', tele, ADMIN_ONLY) && !A.canOpenView('todo', tele, ADMIN_ONLY) && !A.canOpenView('submittals', tele, ADMIN_ONLY));
  check('access: telematics-only opens the code list', A.canOpenView(A.TELEMATICS_CODES_VIEW, tele, ADMIN_ONLY));
  check('access: a rep cannot open telematics unless switched on', !A.canOpenView(A.TELEMATICS_CODES_VIEW, rep, ADMIN_ONLY) && A.canOpenView(A.TELEMATICS_CODES_VIEW, both, ADMIN_ONLY));
  check('access: admin-only views stay admin-only', !A.canOpenView('settings', both, ADMIN_ONLY) && A.canOpenView('settings', admin, ADMIN_ONLY));
  check('access: landing view follows access', A.defaultViewFor(rep, 'stage-incoming') === 'stage-incoming'
    && A.defaultViewFor(tele, 'stage-incoming') === A.TELEMATICS_DEFAULT_VIEW
    && A.defaultViewFor(none, 'stage-incoming') === A.NO_ACCESS_VIEW);
  check('access: every telematics view is reachable by telematics users', A.TELEMATICS_VIEWS.every(v => A.canOpenView(v, tele, ADMIN_ONLY)));
  check('access: presets write both fields', A.ACCESS_PRESETS.every(p => typeof p.fields.leadAccess === 'boolean' && typeof p.fields.telematicsAccess === 'boolean'));
  check('access: labels', A.accessLabel(admin) === 'Admin' && A.accessLabel(rep) === 'Sales Rep' && A.accessLabel(tele) === 'Telematics' && A.accessLabel(both) === 'Sales Rep + Telematics');

  // The rules must gate every lead-side collection on canUseLeads and the
  // telematics collections on canUseTelematics — the UI alone is not enough.
  const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
  const block = (name) => { const m = rules.match(new RegExp(`match /${name}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`)); return m ? m[1] : ''; };
  check('rules: leads read needs lead access', /allow read:\s+if canUseLeads\(\)/.test(block('leads')));
  for (const c of ['requests', 'tradeIns', 'finance']) check(`rules: ${c} read needs lead access`, /allow read: if canUseLeads\(\)/.test(block(c)));
  check('rules: record writes need lead access', /function recordCreateOk\(\) \{\s*return canUseLeads\(\)/.test(rules) && /function recordUpdateOk\(\) \{\s*return canUseLeads\(\)/.test(rules));
  check('rules: telematics codes need telematics access', /allow read:\s+if canUseTelematics\(\)/.test(block('telematicsCodes')));
  check('rules: leadAccess defaults on, telematicsAccess off (same as access.js)', rules.includes("get('leadAccess', true) != false") && rules.includes("get('telematicsAccess', false) == true"));
  // A user may never grant themselves a module.
  check('rules: self-update is still name only', /isSelf\(userId\) && changed\(\)\.hasOnly\(\['name'\]\)/.test(rules));

  // Lead pickers must not offer telematics-only accounts.
  check('app: config.users is filtered to lead users', /const leadUsers = useMemo\(\(\) => users\.filter\(u => u\.isSystem \|\| hasLeadAccess\(u\)\)/.test(app) && app.includes('users: leadUsers'));
  check('app: leads subscribe only with lead access', /useEffect\(\(\) => \{\s*if \(!leadAccess\) \{[\s\S]{0,200}?return;\s*\}\s*const unsubLeads = subscribeToLeads/.test(app));
}

/* ---------- Telematics: critical code list (Nov 2026) ---------- */
{
  const T = await import('../src/lib/telematics.js');
  const { TELEMATICS_SEED_CODES: seed, TELEMATICS_SEED_SOURCE: src } = await import('../src/lib/telematicsSeed.js');

  check('codes: parses "CRITICAL - M0217"', JSON.stringify(T.parsePrimaryCode('CRITICAL - M0217')) === JSON.stringify({ severity: 'CRITICAL', code: 'M0217' }));
  check('codes: parses dashed codes and other severities', T.parsePrimaryCode('WARNING - E00009714').code === 'E00009714' && T.parsePrimaryCode('INFORMATION - P113B-7B').code === 'P113B-7B' && T.parsePrimaryCode('critical - c1047-00').code === 'C1047-00');
  check('codes: bare code parses, junk does not', T.parsePrimaryCode(' m0217 ').code === 'M0217' && T.parsePrimaryCode('') === null && T.parsePrimaryCode('<html><head>') === null && T.parsePrimaryCode('CRITICAL -') === null);
  check('codes: valid ids only', T.isValidCode('M0217') && T.isValidCode('p1061-97') && !T.isValidCode('M/0217') && !T.isValidCode('') && !T.isValidCode('-M1') && !T.isValidCode('M 0217'));

  const byId = { M0217: { code: 'M0217', level: 'ignore', reviewed: true }, C1047: { code: 'C1047', level: 'noncritical' }, X1: { code: 'X1', level: 'bogus' } };
  check('codes: unknown code is critical and flagged', JSON.stringify(T.classifyCode('zz99', byId)) === JSON.stringify({ code: 'ZZ99', level: 'critical', known: false, reviewed: false }));
  check('codes: reviewed level is used', T.classifyCode('m0217', byId).level === 'ignore' && T.classifyCode('M0217', byId).reviewed === true);
  check('codes: unreviewed keeps its level but says so', T.classifyCode('C1047', byId).level === 'noncritical' && T.classifyCode('C1047', byId).reviewed === false);
  check('codes: a bad stored level falls back to critical', T.classifyCode('X1', byId).level === 'critical');

  const rp = T.reviewPatch('noncritical', 'tanner', 'NOW');
  check('codes: review stamps who and when', rp.level === 'noncritical' && rp.reviewed === true && rp.reviewedBy === 'tanner' && rp.reviewedAt === 'NOW');
  check('codes: review rejects unknown levels', T.reviewPatch('urgent', 'x').level === 'critical');

  const d = T.newCodeDoc({ code: ' m0217 ', summary: ' Filter ', seenCount: '7', topModels: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'u', 'T');
  check('codes: new code starts critical and not reviewed', d.code === 'M0217' && d.level === 'critical' && d.reviewed === false && d.summary === 'Filter' && d.seenCount === 7 && d.topModels.length === 5 && d.createdBy === 'u');

  const docs = [{ code: 'A', level: 'critical', reviewed: true, seenCount: 5 }, { code: 'B', level: 'ignore', seenCount: 50 }, { code: 'C', level: 'noncritical', reviewed: true, seenCount: 9, topModels: ['T770 T4'] }, { code: 'D', seenCount: 1 }];
  const c = T.codeCounts(docs);
  check('codes: counts', c.all === 4 && c.unreviewed === 2 && c.critical === 2 && c.ignore === 1 && c.noncritical === 1);
  check('codes: filters', docs.filter(x => T.codeMatchesFilter(x, 'unreviewed')).map(x => x.code).join() === 'B,D' && docs.filter(x => T.codeMatchesFilter(x, 'critical')).map(x => x.code).join() === 'A,D');
  check('codes: search matches code, summary and model', T.codeMatchesQuery(docs[2], 't770') && T.codeMatchesQuery({ code: 'M0217', summary: 'Hydraulic Filter Plugged' }, 'filter m02') && !T.codeMatchesQuery(docs[0], 'zzz'));
  check('codes: not reviewed first, then most seen', T.sortCodes(docs).map(x => x.code).join() === 'B,D,C,A');

  // The starter list
  check('seed: 115 codes from the log', seed.length === 115 && src.rows === 5019);
  check('seed: every code is a valid, unique id', seed.every(r => T.isValidCode(r.code) && r.code === T.normalizeCode(r.code)) && new Set(seed.map(r => r.code)).size === seed.length);
  check('seed: every code has a summary and a count', seed.every(r => r.summary && r.seenCount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.lastSeen)));
  check('seed: counts add up to the log', seed.reduce((n, r) => n + r.seenCount, 0) === src.rows);
  const seededDocs = seed.map(r => T.newCodeDoc(r, 'u', 'T'));
  check('seed: loads as critical, not reviewed', seededDocs.every(x => x.level === 'critical' && x.reviewed === false));
  check('seed: the levels the rules accept match CODE_LEVELS', (() => {
    const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
    const m = rules.match(/request\.resource\.data\.level in \[([^\]]+)\]/);
    return m && JSON.stringify(m[1].split(',').map(x => x.trim().replace(/'/g, ''))) === JSON.stringify(T.CODE_LEVEL_IDS);
  })());
}

/* ---------- Telematics step 2: cases, wins, destinations, hand-off ---------- */
{
  const T = await import('../src/lib/telematics.js');
  const { TELEMATICS_SEED_DESTINATIONS: dests } = await import('../src/lib/telematicsSeed.js');
  const { createRequire } = await import('node:module');
  const R = createRequire(import.meta.url)('../functions/telematicsRules.js');
  const A = await import('../src/lib/access.js');

  // Tabs derive from status
  check('cases: every status has exactly one tab', T.CASE_STATUS_IDS.every(s => T.CASE_TABS.filter(t => t.statuses.includes(s)).length === 1));
  check('cases: tab of a case', T.caseTab({ status: 'sent' }) === 'sent' && T.caseTab({ status: 'lost' }) === 'archive' && T.caseTab({}) === 'new');
  check('cases: telematics-only users land on the board', A.TELEMATICS_DEFAULT_VIEW === A.TELEMATICS_BOARD_VIEW && A.TELEMATICS_VIEWS.includes(A.TELEMATICS_SETTINGS_VIEW));

  // Client and server copies agree
  check('drift: WIN_TIERS match the server', JSON.stringify(T.WIN_TIERS) === JSON.stringify(R.WIN_TIERS));
  const recFixtures = [
    { to: [{ email: 'a@x.com' }, { email: 'A@x.com' }, { email: 'bad' }], cc: [{ email: 'a@x.com' }, { email: 'c@x.com' }] },
    { to: [], cc: [{ email: 'nate@x.com' }] },
    { to: [], cc: [] }, null, { to: [{ email: ' b@y.com ' }] }
  ];
  check('drift: resolveRecipients matches the server', recFixtures.every(f => JSON.stringify(T.resolveRecipients(f)) === JSON.stringify(R.resolveRecipients(f))));
  check('drift: mapsUrl / assetUrl match the server', [[40.13, -86.22], ['', ''], [null, 1], [91, 0], ['x', 'y']].every(([a, b]) => T.mapsUrl(a, b) === R.mapsUrl(a, b)) && T.assetUrl('AT6330022') === R.assetUrl('AT6330022'));
  const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
  const sm = rules.match(/request\.resource\.data\.status in \[([^\]]+)\]/);
  check('drift: rules case statuses match CASE_STATUSES', sm && JSON.stringify(sm[1].split(',').map(x => x.trim().replace(/'/g, ''))) === JSON.stringify(T.CASE_STATUS_IDS));
  check('rules: cases and settings need telematics access', /match \/telematicsCases\/\{caseId\} \{\s*allow read:\s+if canUseTelematics\(\)/.test(rules) && /match \/telematicsConfig\/\{docId\} \{\s*allow read:\s+if canUseTelematics\(\)/.test(rules));

  // Recipients
  const r1 = T.resolveRecipients(recFixtures[0]);
  check('recipients: valid, de-duplicated, CC never repeats a To', JSON.stringify(r1) === JSON.stringify({ to: ['a@x.com'], cc: ['c@x.com'], promotedCc: false }));
  const r2 = T.resolveRecipients(recFixtures[1]);
  check('recipients: only a CC → sent To the CC (Indy North)', r2.to[0] === 'nate@x.com' && r2.cc.length === 0 && r2.promotedCc);
  check('recipients: none → nothing', T.resolveRecipients({}).to.length === 0);

  // Destinations from the contact sheet
  check('seed dests: unique ids, known kinds', new Set(dests.map(d => d.id)).size === dests.length && dests.every(d => T.DESTINATION_KINDS.some(k => k.id === d.kind)));
  check('seed dests: every address valid, none misspelled', dests.every(d => [...d.to, ...d.cc].every(p => T.isEmail(p.email) && !/bobctofindy/i.test(p.email))));
  check('seed dests: at most 4 people each', dests.every(d => d.to.length + d.cc.length <= T.MAX_DESTINATION_RECIPIENTS));
  check('seed dests: Service and Parts for every branch', ['Anderson', 'Columbus', 'Ellettsville', 'Indy', 'Indy North'].every(b => ['service', 'parts'].every(k => dests.some(d => d.branch === b && d.kind === k))));
  check('seed dests: Field Service is there, flagged empty', T.destinationProblems(dests.find(d => d.kind === 'field')).includes('No one to send to'));
  check('seed dests: Indy North service sends to Nate Baxter until the hire', T.resolveRecipients(dests.find(d => d.id === 'indy-north-service')).to[0] === 'nbaxter@bobcatofindy.com');
  check('dests: problems', T.destinationProblems({ name: '', to: [{ email: 'x' }] }).length === 3 && T.destinationProblems(dests[1]).length === 0
    && T.destinationProblems({ name: 'n', to: [1, 2, 3, 4, 5].map(i => ({ email: `p${i}@x.com` })) }).includes('At most 4 people'));
  check('dests: suggested by branch, else first of the kind', T.suggestedDestination('shop', 'Anderson', dests).id === 'anderson-service'
    && T.suggestedDestination('parts', 'Nowhere', dests).kind === 'parts' && T.suggestedDestination('field', 'Indy', dests).id === 'field-service'
    && T.suggestedDestination('bogus', 'Indy', dests) === null);

  // Status changes
  const field = dests.find(d => d.kind === 'field'), shop = dests.find(d => d.id === 'indy-service'), parts = dests.find(d => d.id === 'indy-parts');
  const w = T.winChange({ tierId: 'field', destination: field, message: ' hi ' }, 'carter', 'NOW');
  check('win: field → Sent to service, email pending', w.patch.status === 'sent' && w.patch.outcome.result === 'won' && w.patch.outcome.destinationId === 'field-service'
    && w.patch.outcome.message === 'hi' && w.patch.outcome.email.status === 'pending' && !w.patch.completedAt && w.event.type === 'won');
  check('win: shop → Sent to service', T.winChange({ tierId: 'shop', destination: shop }, 'c', 'NOW').patch.status === 'sent');
  check('win: parts → Completed (no work order to wait for)', (() => { const x = T.winChange({ tierId: 'parts', destination: parts }, 'c', 'NOW'); return x.patch.status === 'completed' && x.patch.completedAt === 'NOW'; })());
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  check('win: destination must match the tier', throws(() => T.winChange({ tierId: 'field', destination: parts }, 'c')) && throws(() => T.winChange({ tierId: 'x', destination: field }, 'c')) && throws(() => T.winChange({ tierId: 'shop' }, 'c')));
  check('lost: needs a known reason, Other needs a note', throws(() => T.loseChange({ reason: 'meh' }, 'c')) && throws(() => T.loseChange({ reason: 'Other' }, 'c'))
    && T.loseChange({ reason: 'Customer declined' }, 'c', 'N').patch.status === 'lost');
  check('close: archive with a reason', T.closeChange({ reason: 'No action needed' }, 'c', 'N').patch.closure.reason === 'No action needed' && throws(() => T.closeChange({ reason: '' }, 'c')));
  check('work order: completes the case', (() => { const x = T.confirmWorkOrderChange({ workOrder: ' M1 ' }, 'c', 'N'); return x.patch.status === 'completed' && x.patch.workOrder.number === 'M1' && x.patch.workOrder.source === 'manual'; })());
  check('reopen: back to Working', T.reopenChange('c', 'N').patch.status === 'working');
  check('every change writes a status the rules accept', [w, T.startWorkingChange('c'), T.reopenChange('c'), T.closeChange({ reason: 'No action needed' }, 'c'), T.loseChange({ reason: 'Customer declined' }, 'c'), T.confirmWorkOrderChange({}, 'c')].every(x => T.CASE_STATUS_IDS.includes(x.patch.status)));
  check('note: empty note is nothing', T.noteEntry('  ', 'c') === null && T.noteEntry(' x ', 'c', 'N').text === 'x');

  // Manual case
  const ok = T.buildManualCase({ customerName: 'Foxy', serial: 'at6330022', code: 'm0217', lat: '40.1', lng: '-86.2', hours: '1702.3', branch: 'Indy North' }, 'u', 'N');
  check('manual case: valid one builds', ok.errors.length === 0 && ok.doc.serial === 'AT6330022' && ok.doc.fault.code === 'M0217' && ok.doc.status === 'new'
    && ok.doc.hours === 1702.3 && ok.doc.location.lat === 40.1 && ok.doc.createdBy === 'u' && ok.doc.history[0].type === 'created');
  check('manual case: required fields and bad input', T.buildManualCase({}, 'u').errors.length === 2 && T.buildManualCase({ customerName: 'x', serial: 'AT6330022', code: 'M/1' }, 'u').errors.length === 1
    && T.buildManualCase({ customerName: 'x', serial: 'AT6330022', lat: '200', lng: '0' }, 'u').errors.length === 1);
  check('search: serial, code, phone digits', T.caseMatchesQuery(ok.doc, 'at633') && T.caseMatchesQuery(ok.doc, 'm0217 foxy')
    && T.caseMatchesQuery({ customer: { phone: '+1 317 647 2102' } }, '3176472102') && !T.caseMatchesQuery(ok.doc, 'zzz'));
  check('counts and sort', T.caseCounts([{ status: 'new' }, { status: 'lost' }, { status: 'closed' }]).archive === 2
    && T.sortCases([{ id: 'a', fault: { startAt: '2026-01-01' } }, { id: 'b', fault: { startAt: '2026-02-01' } }])[0].id === 'b');

  // Server-side guards
  check('server: only telematics users send', R.canUseTelematics({ role: 'admin' }) && R.canUseTelematics({ telematicsAccess: true }) && !R.canUseTelematics({ role: 'user' }) && !R.canUseTelematics(null));
  check('server: only a won case with a destination is sent', R.handoffError(null) !== '' && R.handoffError({ outcome: { result: 'lost' } }) !== ''
    && R.handoffError({ outcome: { result: 'won', destinationId: 'x', tier: 'nope' } }) !== '' && R.handoffError({ outcome: { result: 'won', destinationId: 'x', tier: 'field' } }) === '');
  check('server: subject', R.handoffSubject({ model: 'T770 T4', serial: 'AT6330022', customer: { name: 'FOXY LNDSCP LLC' }, fault: { code: 'M0217', summary: 'Hydraulic/Hydrostatic Filter Plugged' }, outcome: { tier: 'field' } })
    === 'Telematics: Field Service — FOXY LNDSCP LLC — T770 T4 AT6330022 — M0217 Hydraulic/Hydrostatic Filter Plugged');
}

/* ---------- Telematics step 3: reading Bobcat's fault emails ---------- */
{
  const { createRequire } = await import('node:module');
  const I = createRequire(import.meta.url)('../functions/telematicsIntakeRules.js');
  const T = await import('../src/lib/telematics.js');
  const BR = ['Anderson', 'Columbus', 'Ellettsville', 'Indy', 'Indy North'];
  // Made-up copies of real emails: real layout, invented customer data.
  const fx1 = readFileSync(join(root, 'scripts/fixtures/telematics-fault-email-1.html'), 'utf8');
  const fx2 = readFileSync(join(root, 'scripts/fixtures/telematics-fault-email-2.html'), 'utf8');

  const p1 = I.parseFaultEmail({ subject: 'Critical Fault Code - ACME DIRT WORKS LLC - Hydraulic/Hydrostatic Filter Plugged - T770 T4', html: fx1 }, BR);
  const a1 = p1.alert || {};
  check('email: reads the machine', p1.ok && a1.serial === 'AT6399999' && a1.model === 'T770 T4' && a1.hours === 1702.3 && a1.inventoryStatus === 'Retailed Inventory');
  check('email: reads the customer', a1.customer && a1.customer.name === 'ACME DIRT WORKS LLC' && a1.customer.phone === '+1 317 555 0100' && a1.customer.address === '100 MAIN ST, SHERIDAN, 46069, US');
  check('email: reads location and coordinates', a1.location && a1.location.city === 'Sheridan, Indiana' && a1.location.lat === 40.1 && a1.location.lng === -86.2);
  check('email: reads the fault', a1.fault && a1.fault.severity === 'CRITICAL' && a1.fault.code === 'M0217' && a1.fault.summary === 'Hydraulic/Hydrostatic Filter Plugged');
  check('email: start time in the right zone (4:35 PM CST)', a1.fault && a1.fault.startAt === '2026-11-11T22:35:00.000Z', a1.fault && a1.fault.startAt);
  check('email: description and possible causes', a1.fault && /Gateway Controller detects/.test(a1.fault.description) && /^Hydraulic Implement Filter\./.test(a1.fault.possibleCause) && !/Conditions for/.test(a1.fault.possibleCause));
  check('email: "Invalid date" PM fields are blank', a1.planned && a1.planned.endDate === '' && a1.planned.endHours === '');
  check('email: branch from the dealer name (Indy North, not Indy)', a1.branch === 'Indy North' && a1.dealer.ar === '2000008174');
  const a2 = (I.parseFaultEmail({ subject: 'x Fault Code', html: fx2 }, BR).alert) || {};
  check('email: other active codes', a2.fault && JSON.stringify(a2.fault.otherCodes) === JSON.stringify([{ severity: 'INFORMATION', code: 'P113B-7B', summary: 'Fuel Level Low' }, { severity: 'WARNING', code: 'E00009714', summary: 'Water in Fuel Detected' }]));
  check('email: dashed customer name kept whole, Anderson branch', a2.customer && a2.customer.name === 'EXAMPLE RENTALS - EAST' && a2.branch === 'Anderson');

  // Plain text works too, and the Owner Account block
  const txt = ['An asset serviced by your dealership has reported a critical fault code.', 'Asset Information', 'Serial Number: b4sb11111', 'Model: T66', 'Hours: 12',
    'Location: Franklin, Indiana US (39.4, -85.9)', 'Customer Information', 'Retail Customer: Pat Example', 'Address: 1 A ST, FRANKLIN, 46131, US',
    'Owner Account', 'Owner Account: Example Lawn Care', 'Pat Example', 'pat@example.com', 'Fault Information', 'Start Date: Nov 12, 2026 06:19 AM (CST)',
    'Primary Code: CRITICAL - P1061-97', 'Summary: Air Filter Plugged', 'Other Active Fault Codes:', 'CRITICAL - P1061-97 - Air Filter Plugged',
    'Service Information', 'Planned Maintenance:', 'End Date: Invalid date', 'End Hours: undefined', 'Servicing Dealer Information', 'AR Number: 2000007726',
    'Name: BRIGHT EQUIPMENT INC. BOBCAT OF INDY'].join('\n');
  const a3 = (I.parseFaultEmail({ subject: 'Critical Fault Code - Pat Example - Air Filter Plugged - T66', text: txt }, BR).alert) || {};
  check('email: plain-text body works, serial upper-cased', a3.serial === 'B4SB11111' && a3.branch === 'Indy');
  check('email: owner account, contact and email', a3.customer && a3.customer.ownerAccount === 'Example Lawn Care' && a3.customer.ownerContact === 'Pat Example' && a3.customer.ownerEmail === 'pat@example.com');
  check('email: the primary code is not repeated as an "other" code', a3.fault && a3.fault.otherCodes.length === 0);
  check('email: missing phone is blank, not "undefined"', a3.customer && a3.customer.phone === '');

  // What isn't a fault email, and what can't be read
  check('email: other mail is skipped', I.parseFaultEmail({ subject: 'Lunch?', text: 'See you at noon' }, BR).reason === 'not-a-fault-email');
  check('email: a fault email without a serial is unreadable', I.parseFaultEmail({ subject: 'Critical Fault Code - X - Y - Z', text: 'Fault Information\nPrimary Code: CRITICAL - M0217' }, BR).reason === 'unreadable');
  check('email: a fault email without a code is unreadable', I.parseFaultEmail({ subject: 'Critical Fault Code', text: 'Asset Information\nSerial Number: AT6399999' }, BR).reason === 'unreadable');

  // Helpers
  check('dates: CST/CDT/EST and 12 AM / 12 PM', I.parseBobcatDate('Nov 11, 2026 04:35 PM (CST)') === '2026-11-11T22:35:00.000Z' && I.parseBobcatDate('Jul 4, 2026 12:05 AM (CDT)') === '2026-07-04T05:05:00.000Z'
    && I.parseBobcatDate('Jan 2, 2026 12:00 PM (EST)') === '2026-01-02T17:00:00.000Z' && I.parseBobcatDate('Invalid date') === '');
  check('html: entities, breaks, styles', I.htmlToText('<style>p{x}</style><p>A&nbsp;&amp;&#176;B</p><br>C&#x2019;').trim() === 'A &°B\n\nC’');
  check('branch: dealer name, then known AR, else blank', I.branchFromDealer({ name: 'BOBCAT OF COLUMBUS' }, BR) === 'Columbus' && I.branchFromDealer({ name: 'odd', ar: '2000008159' }, BR) === 'Anderson'
    && I.branchFromDealer({ name: 'BOBCAT OF ELLETTSVILLE' }, BR) === 'Ellettsville' && I.branchFromDealer({ name: 'somewhere' }, BR) === '');

  // Which case an alert joins
  const al = { serial: 'AT6399999', fault: { code: 'M0217' } };
  const cs = [
    { id: 'old', serial: 'AT6399999', status: 'completed', createdAt: '2026-01-01' },
    { id: 'open', serial: 'AT6399999', status: 'working', createdAt: '2026-02-01' },
    { id: 'other', serial: 'B4SB00000', status: 'new', createdAt: '2026-03-01' }
  ];
  check('repeat: joins the machine\'s open case', I.caseForAlert(cs, al).id === 'open');
  check('repeat: a closed or completed case starts a new one', I.caseForAlert([cs[0]], al) === null);
  check('repeat: a non-critical code keeps logging on its auto-closed case', I.caseForAlert([{ id: 'nc', serial: 'AT6399999', status: 'closed', closure: { auto: true }, fault: { code: 'M0217' } }], al).id === 'nc'
    && I.caseForAlert([{ id: 'nc', serial: 'AT6399999', status: 'closed', closure: { auto: true }, fault: { code: 'X1' } }], al) === null);
  check('repeat: same email twice is a duplicate', I.isDuplicateMessage([{ intake: { messageId: 'm1' } }], 'm1') && I.isDuplicateMessage([{ alerts: [{ messageId: 'm2' }] }], 'm2') && !I.isDuplicateMessage([{ intake: { messageId: 'm1' } }], '') && !I.isDuplicateMessage([], 'm3'));

  // New cases
  const n1 = I.newCaseFromAlert(a1, { level: 'critical', now: 'N', messageId: 'm' });
  check('new case: critical → New, with intake details', n1.status === 'new' && n1.source === 'email' && n1.createdBy === 'intake' && n1.alertCount === 1 && n1.alerts[0].messageId === 'm' && n1.branch === 'Indy North' && n1.history[0].type === 'created');
  const n2 = I.newCaseFromAlert(a1, { level: 'noncritical', now: 'N' });
  check('new case: non-critical / ignored → Archive, auto-closed', n2.status === 'closed' && n2.closure.auto === true && n2.closure.reason === 'Non-critical code' && I.newCaseFromAlert(a1, { level: 'ignore' }).closure.reason === 'Ignored code');
  check('new case: statuses the rules accept, tab derived', [n1, n2].every(c => T.CASE_STATUS_IDS.includes(c.status)) && T.caseTab(n2) === 'archive');
  check('new case: the hand-off can read it', (() => { const R = createRequire(import.meta.url)('../functions/telematicsRules.js'); return R.handoffSubject({ ...n1, outcome: { tier: 'shop' } }).includes('AT6399999'); })());
  check('fixtures carry no real customer data', ![fx1, fx2].some(f => /FOXY|RUNYON|SUNBELT|AT6330022|B4SB33825|stanage|awstrack/i.test(f)));
}

/* ---------- Telematics step 4: WIP report, matching, follow-ups ---------- */
{
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const W = req('../functions/telematicsWipRules.js');
  const T = await import('../src/lib/telematics.js');
  const crypto = await import('node:crypto');

  // Resend (Svix) signatures — sign a body the way Resend does, then verify.
  const key = crypto.randomBytes(24); const secret = 'whsec_' + key.toString('base64');
  const body = '{"type":"email.received","data":{"email_id":"e1"}}';
  const now = 1794500000000, ts = String(Math.floor(now / 1000));
  const sig = 'v1,' + crypto.createHmac('sha256', key).update(`msg_1.${ts}.${body}`).digest('base64');
  check('webhook: a correct Resend signature passes', W.verifyResendSignature({ id: 'msg_1', timestamp: ts, signature: sig, body, secret, now }));
  check('webhook: one of several signatures may match', W.verifyResendSignature({ id: 'msg_1', timestamp: ts, signature: `v1,AAAA ${sig}`, body: Buffer.from(body), secret, now }));
  check('webhook: a changed body fails', !W.verifyResendSignature({ id: 'msg_1', timestamp: ts, signature: sig, body: body + ' ', secret, now }));
  check('webhook: wrong secret / missing headers fail', !W.verifyResendSignature({ id: 'msg_1', timestamp: ts, signature: sig, body, secret: 'whsec_' + crypto.randomBytes(24).toString('base64'), now })
    && !W.verifyResendSignature({ id: '', timestamp: ts, signature: sig, body, secret, now }) && !W.verifyResendSignature({ id: 'msg_1', timestamp: ts, signature: sig, body, secret: '', now }));
  check('webhook: an old timestamp (replay) fails', !W.verifyResendSignature({ id: 'msg_1', timestamp: ts, signature: sig, body, secret, now: now + 6 * 60e3 }));

  // CSV and the WIP layout (made-up rows, real column names)
  check('csv: quotes, doubled quotes, commas and newlines', JSON.stringify(W.parseCsv('a,"b,c","d ""e""",\n"x\ny",2\r\n\n')) === JSON.stringify([['a', 'b,c', 'd "e"', ''], ['x\ny', '2']]));
  const wipCsv = ['"Order#","Ord Date","Customer","Job","Description","EIN","Model Num","Serial #","Tech","Last Dt","Ptype","Assigned","Contact","P","Total Charge","Nochrg Total","Bill_hrs","Actual Hrs","Parts Total","Labor Total",',
    '"M3000001","11/10/26","EXAMPLE CO","A","HYD FILTER","1","T770-R","at6399999","M01","11/11/26","M1020","","","A",,1.00,1,1,,1.00,',
    '"M3000001","11/10/26","EXAMPLE CO","B","DRIVE TIME","1","T770-R","AT6399999","M01","11/11/26","M5005","","","A",,1.00,1,1,,1.00,',
    '"T2000002","11/12/26","OTHER","A","CALL","2","T66-R","B4SB99999","M02","","M5005","","","A",,1.00,1,1,,1.00,',
    '"M1000003","10/30/26","PRELUDE INTERNAL INDY","A","NOVEMBER SALES","","","","","","M1207","","","A",,1.00,,,,,'].join('\n');
  const wp = W.parseWip(wipCsv);
  check('wip: one entry per work order + serial, internal rows dropped', wp.ok && wp.rows === 4 && wp.workOrders.length === 2);
  check('wip: fields kept, nothing else', JSON.stringify(wp.workOrders[0]) === JSON.stringify({ order: 'M3000001', serial: 'AT6399999', openedOn: '2026-11-10', model: 'T770-R', kind: 'shop', branch: 'Indy North' })
    && !JSON.stringify(wp.workOrders).includes('EXAMPLE'));
  check('wip: T prefix is field', wp.workOrders[1].kind === 'field' && wp.workOrders[1].branch === '');
  check('wip: missing columns / empty', W.parseWip('a,b\n1,2').reason === 'missing-columns' && W.parseWip('').reason === 'empty');
  check('wip: dates', W.usDate('11/2/26') === '2026-11-02' && W.usDate('01/15/2027') === '2027-01-15' && W.usDate('soon') === '');
  check('indy date: evening UTC is still the same Indy day', W.indyDate('2026-11-12T03:30:00Z') === '2026-11-11' && W.indyDate('2026-11-12T15:00:00Z') === '2026-11-12');

  // Matching
  const sent = (o = {}) => ({ status: 'sent', serial: 'AT6399999', outcome: { result: 'won', tier: 'shop', sentAt: '2026-11-10T14:00:00Z', ...o } });
  check('match: same serial, opened the day it was sent', W.matchWorkOrder(sent(), wp.workOrders).order === 'M3000001');
  check('match: a work order opened before the send does not count', W.matchWorkOrder(sent({ sentAt: '2026-11-11T14:00:00Z' }), wp.workOrders) === null);
  check('match: only Sent-to-service Field / Shop wins', W.matchWorkOrder({ ...sent(), status: 'working' }, wp.workOrders) === null && W.matchWorkOrder(sent({ tier: 'parts' }), wp.workOrders) === null);
  check('match: earliest work order wins', W.matchWorkOrder(sent(), [{ order: 'M9', serial: 'AT6399999', openedOn: '2026-11-12' }, { order: 'M8', serial: 'AT6399999', openedOn: '2026-11-11' }]).order === 'M8');

  // Follow-ups
  const H = 3600e3, sentAt = '2026-11-10T14:00:00Z', t0 = new Date(sentAt).getTime();
  const fc = (fu, tier = 'field') => ({ status: 'sent', outcome: { result: 'won', tier, sentAt }, followUp: fu });
  const at = (h) => ({ now: t0 + h * H, wipReceivedAt: new Date(t0 + h * H).toISOString() });
  check('follow-up: waits until 48 h for Field', W.followUpState(fc(), {}, at(47)).action === 'wait' && W.followUpState(fc(), {}, at(48)).action === 'bump' && W.followUpState(fc(), {}, at(48)).n === 1);
  check('follow-up: Shop waits 7 days', W.followUpState(fc(undefined, 'shop'), {}, at(167)).action === 'wait' && W.followUpState(fc(undefined, 'shop'), {}, at(168)).action === 'bump');
  check('follow-up: then every 24 h, 3 reminders, then escalate', W.followUpState(fc({ bumps: 1 }), {}, at(71)).action === 'wait' && W.followUpState(fc({ bumps: 1 }), {}, at(72)).n === 2
    && W.followUpState(fc({ bumps: 2 }), {}, at(96)).n === 3 && W.followUpState(fc({ bumps: 3 }), {}, at(119)).action === 'wait' && W.followUpState(fc({ bumps: 3 }), {}, at(120)).action === 'escalate');
  check('follow-up: reminders stay an interval apart even when overdue', W.followUpState(fc({ bumps: 1, lastBumpAt: new Date(t0 + 100 * H).toISOString() }), {}, at(110)).action === 'wait'
    && W.followUpState(fc({ bumps: 1, lastBumpAt: new Date(t0 + 100 * H).toISOString() }), {}, at(124)).n === 2
    && W.followUpState(fc({ bumps: 3, lastBumpAt: new Date(t0 + 130 * H).toISOString() }), {}, at(140)).action === 'wait');
  check('follow-up: nothing after the escalation', W.followUpState(fc({ bumps: 3, escalatedAt: 'x' }), {}, at(500)).action === 'none');
  check('follow-up: waits for a WIP report from after the deadline', W.followUpState(fc(), {}, { now: t0 + 50 * H, wipReceivedAt: new Date(t0 + 47 * H).toISOString() }).action === 'waiting-for-wip'
    && W.followUpState(fc(), {}, { now: t0 + 50 * H, wipReceivedAt: '' }).action === 'waiting-for-wip');
  check('follow-up: Parts and non-sent cases never bump', W.followUpState(fc(undefined, 'parts'), {}, at(500)).action === 'none' && W.followUpState({ ...fc(), status: 'completed' }, {}, at(500)).action === 'none');
  check('follow-up: settings change the timers, bad values fall back', W.followUpState(fc(), { followUps: { fieldHours: 24 } }, at(24)).action === 'bump'
    && JSON.stringify(W.followUpSettings({ followUps: { fieldHours: 'x', maxBumps: -1, shopHours: 0 } })) === JSON.stringify(W.FOLLOW_UP_DEFAULTS)
    && W.followUpState(fc(), { followUps: { maxBumps: 0 } }, at(48)).action === 'escalate');
  // Client copy agrees (the board shows what the server will do)
  const fixtures = [[fc(), {}, at(10)], [fc(), {}, at(48)], [fc({ bumps: 2 }), { followUps: { bumpEveryHours: 12 } }, at(80)], [fc({ bumps: 3 }), {}, at(130)],
    [fc(undefined, 'shop'), {}, { now: t0 + 200 * H, wipReceivedAt: '' }], [fc({ escalatedAt: 'x' }), {}, at(1)], [fc(undefined, 'parts'), {}, at(99)],
    [fc({ bumps: 2, lastBumpAt: new Date(t0 + 150 * H).toISOString() }), {}, at(160)], [fc({ bumps: 3, lastBumpAt: new Date(t0 + 150 * H).toISOString() }), {}, at(175)]];
  check('drift: followUpState matches the server', fixtures.every(([c, st, o]) => JSON.stringify(T.followUpState(c, st, o)) === JSON.stringify(W.followUpState(c, st, o))));
  check('drift: follow-up defaults match', JSON.stringify(T.FOLLOW_UP_DEFAULTS) === JSON.stringify(W.FOLLOW_UP_DEFAULTS) && JSON.stringify(T.followUpSettings({ followUps: { fieldHours: 30 } })) === JSON.stringify(W.followUpSettings({ followUps: { fieldHours: 30 } })));
  check('labels: due / bumped / overdue / escalated', /^Work order due/.test(T.followUpLabel(fc(), {}, at(1)).text) && /^Bumped 1×/.test(T.followUpLabel(fc({ bumps: 1 }), {}, at(50)).text)
    && /Overdue/.test(T.followUpLabel(fc(), {}, { now: t0 + 50 * H }).text) && /Escalated/.test(T.followUpLabel(fc({ escalatedAt: 'x' }), {}, at(1)).text) && T.followUpLabel({ status: 'new' }, {}, at(1)) === null);
  check('close reasons include "No work order opened"', T.CLOSE_REASONS.includes('No work order opened'));
  const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
  check('rules: WIP docs are read-only to the app', /match \/telematicsWip\/\{docId\} \{\s*allow read:\s+if canUseTelematics\(\);\s*allow write: if false;/.test(rules));
}

/* ---------- Dashboards: switcher and landing screen (Nov 2026) ---------- */
{
  const A = await import('../src/lib/access.js');
  const admin = { role: 'admin' }, rep = { role: 'user' }, both = { role: 'user', telematicsAccess: true }, tele = { role: 'user', leadAccess: false, telematicsAccess: true };
  check('dashboards: who gets which', JSON.stringify(A.workspacesFor(admin)) === '["leads","backoffice","telematics"]' && JSON.stringify(A.workspacesFor(rep)) === '["leads","backoffice"]'
    && JSON.stringify(A.workspacesFor(both)) === '["leads","backoffice","telematics"]' && JSON.stringify(A.workspacesFor(tele)) === '["telematics"]' && A.workspacesFor(null).length === 0);
  check('dashboards: admins land on the picker', A.landingView(admin, 'stage-incoming') === A.WORKSPACE_PICKER_VIEW);
  check('dashboards: reps land on New, telematics-only on the board', A.landingView(rep, 'stage-incoming') === 'stage-incoming' && A.landingView(both, 'stage-incoming') === 'stage-incoming'
    && A.landingView(tele, 'stage-incoming') === A.TELEMATICS_BOARD_VIEW);
  check('dashboards: a refresh returns to the remembered dashboard', A.landingView(admin, 'stage-incoming', 'telematics') === A.TELEMATICS_BOARD_VIEW
    && A.landingView(admin, 'stage-incoming', 'backoffice') === 'submittals' && A.landingView(rep, 'stage-incoming', 'telematics') === 'stage-incoming');
  check('dashboards: every view belongs to the right one', A.workspaceOfView('stage-working') === 'leads' && A.workspaceOfView('todo') === 'leads' && A.workspaceOfView('reports') === 'leads'
    && A.BACK_OFFICE_VIEWS.every(v => A.workspaceOfView(v) === 'backoffice') && A.TELEMATICS_VIEWS.every(v => A.workspaceOfView(v) === 'telematics')
    && ['users', 'settings', A.WORKSPACE_PICKER_VIEW].every(v => A.workspaceOfView(v) === null));
  check('dashboards: each opens on a view its users can open', A.WORKSPACES.every(w => [admin].every(u => A.canOpenView(A.workspaceHomeView(w.id, 'stage-incoming'), u, ['reports', 'users', 'settings'])))
    && A.canOpenView(A.workspaceHomeView('backoffice', 'stage-incoming'), rep, []) && A.canOpenView(A.workspaceHomeView('telematics', 'stage-incoming'), tele, []));
  check('dashboards: the picker only with a choice to make', A.canOpenView(A.WORKSPACE_PICKER_VIEW, admin, []) && A.canOpenView(A.WORKSPACE_PICKER_VIEW, rep, []) && !A.canOpenView(A.WORKSPACE_PICKER_VIEW, tele, []));
  check('app: the sidebar groups are tagged with a dashboard', /\{ ws: 'telematics', title: 'Telematics'/.test(app) && /\{ ws: 'backoffice', title: 'Back Office'/.test(app) && /\{ ws: '\*', title: 'Admin'/.test(app));
}

/* ---------- Telematics dashboard: the numbers (Nov 2026) ---------- */
{
  const X = await import('../src/lib/telematicsStats.js');
  const A = await import('../src/lib/access.js');
  const NOW = Date.parse('2026-11-18T18:00:00Z'), H = 3600e3, D = 864e5;
  const iso = (ms) => new Date(ms).toISOString();
  const mk = (id, o = {}) => ({ id, status: 'new', createdAt: iso(NOW - 5 * D), serial: 'AT6300001', model: 'T770 T4', branch: 'Indy', fault: { code: 'M0217', summary: 'Filter' }, history: [], notes: [], ...o });
  const won = (tier, extra = {}) => ({ status: tier === 'parts' ? 'completed' : 'sent', outcome: { result: 'won', tier, destinationName: tier === 'field' ? 'Field Service' : tier === 'shop' ? 'Indy South Service' : 'Indy South Parts', sentAt: iso(NOW - 4 * D) }, ...extra });
  const cases = [
    mk('a', { ...won('field'), workOrder: { number: 'T2', openedOn: new Date(NOW - 2 * D).toISOString().slice(0, 10), source: 'wip' },
      history: [{ type: 'created', at: iso(NOW - 5 * D), by: '' }, { type: 'status', at: iso(NOW - 5 * D + 2 * H), by: 'carter' }] }),
    mk('b', { ...won('shop', { followUp: { bumps: 3, escalatedAt: iso(NOW - D) } }), serial: 'AT6300002', fault: { code: 'E00009818', summary: 'Oil' },
      notes: [{ at: iso(NOW - 5 * D + 4 * H), by: 'carter', text: 'x' }] }),
    mk('c', { ...won('parts'), model: 'T66', serial: 'B4SB10001', branch: 'Anderson' }),
    mk('d', { status: 'lost', outcome: { result: 'lost', reason: 'Customer declined' }, model: 'T66', serial: 'B4SB10002', branch: 'Anderson',
      history: [{ type: 'lost', at: iso(NOW - 5 * D + 6 * H), by: 'carter' }] }),
    mk('e', { status: 'closed', closure: { reason: 'Non-critical code', auto: true }, fault: { code: 'C1047-00' }, alertCount: 4, branch: '' }),
    mk('f', { createdAt: iso(NOW - 200 * D) }),   // outside 90 days
    mk('g', { status: 'working', outcome: { result: 'lost' } })   // reopened after a loss: not lost now
  ];
  const codes = { 'C1047-00': { code: 'C1047-00', level: 'ignore', reviewed: true }, E00009818: { code: 'E00009818', level: 'noncritical', reviewed: true } };
  const in90 = cases.filter(c => X.inPeriod(c, '90', NOW));
  check('dash: period filter', in90.length === 6 && cases.filter(c => X.inPeriod(c, 'all', NOW)).length === 7 && !X.inPeriod({}, '30', NOW));
  const s = X.summary(in90);
  check('dash: win rate = won / (won + lost); closed and reopened don\'t count', s.won === 3 && s.lost === 1 && s.closed === 1 && Math.abs(s.winRate - 0.75) < 1e-9);
  check('dash: work-order rate over field + shop wins', s.fieldShopWins === 2 && s.workOrders === 1 && s.workOrderRate === 0.5);
  check('dash: first response median (2 h, 4 h, 6 h → 4 h)', s.medianFirstResponseHours === 4 && s.firstResponseCount === 3);
  check('dash: win → work order in days (sent 4 days ago, opened 2 days ago)', s.medianDaysToWorkOrder === 2 && s.workOrderTimingCount === 1);
  check('dash: waiting, reminders, escalations', s.waitingOnService === 2 && s.reminders === 3 && s.escalated === 1 && s.open === 1);
  check('dash: empty is safe', (() => { const e = X.summary([]); return e.winRate === null && e.workOrderRate === null && e.medianFirstResponseHours === null && e.cases === 0; })());
  const ob = X.outcomeBreakdown(in90);
  check('dash: outcomes by tier', JSON.stringify(ob.map(o => o.count)) === '[1,1,1,1,1]' && ob[0].label === 'Won · Field Service');
  const tc = X.topCodes(in90, codes);
  check('dash: top codes with today\'s level, alerts counted', tc[0].code === 'M0217' && tc[0].cases === 4 && tc[0].level === 'critical'
    && tc.find(c => c.code === 'C1047-00').level === 'ignore' && tc.find(c => c.code === 'C1047-00').alerts === 4 && tc.find(c => c.code === 'E00009818').level === 'noncritical');
  check('dash: level counts', JSON.stringify(X.levelCounts(in90, codes)) === JSON.stringify({ critical: 4, noncritical: 1, ignore: 1 }));
  const tm = X.topMachines(in90);
  check('dash: machines by model, with wins / work orders / top code', tm[0].model === 'T770 T4' && tm[0].cases === 4 && tm[0].won === 2 && tm[0].workOrders === 1 && tm[0].topCode === 'M0217' && tm[1].model === 'T66' && tm[1].cases === 2);
  const sb = X.serialBreaks(in90);
  check('dash: serial breaks count machines and cases', sb[0].model === 'T770 T4' && sb[0].prefix === 'AT63' && sb[0].machines === 2 && sb[0].cases === 4 && sb.find(r => r.prefix === 'B4SB').machines === 2);
  const br = X.byBranch(in90, ['Indy', 'Anderson', 'Columbus']);
  check('dash: by branch, empty branches dropped, no-branch row', br[0].branch === 'Indy' && br[0].cases === 3 && br.find(b => b.branch === 'Anderson').winRate === 0.5 && !br.some(b => b.branch === 'Columbus') && br.some(b => b.branch === 'No branch'));
  const ds = X.byDestination(in90);
  check('dash: who follows through', ds.find(d => d.destination === 'Field Service').workOrderRate === 1 && ds.find(d => d.destination === 'Indy South Service').escalated === 1
    && ds.find(d => d.destination === 'Indy South Service').workOrderRate === 0 && ds.find(d => d.destination === 'Indy South Parts').fieldShop === 0);
  check('dash: lost reasons', JSON.stringify(X.lostReasons(in90)) === JSON.stringify([{ reason: 'Customer declined', count: 1 }]));
  const wk = X.weekly(cases, 12, NOW);
  check('dash: 12 weeks, cases and wins land in their week', wk.length === 12 && wk.reduce((n, w) => n + w.cases, 0) === 6 && wk.reduce((n, w) => n + w.won, 0) === 3);
  check('dash: formatting', X.formatHours(0.5) === '30 min' && X.formatHours(4) === '4 h' && X.formatHours(72) === '3 days' && X.formatHours(null) === '—'
    && X.formatDays(0.2) === 'same day' && X.formatDays(1) === '1 day' && X.formatDays(2.5) === '2.5 days' && X.formatPct(0.756) === '76%' && X.formatPct(null) === '—');
  check('dash: median', X.median([3, 1, 2]) === 2 && X.median([4, 1, 2, 3]) === 2.5 && X.median([]) === null);
  check('dash: a Telematics view, open to telematics users only', A.TELEMATICS_VIEWS.includes(A.TELEMATICS_DASHBOARD_VIEW) && A.workspaceOfView(A.TELEMATICS_DASHBOARD_VIEW) === 'telematics'
    && A.canOpenView(A.TELEMATICS_DASHBOARD_VIEW, { role: 'user', leadAccess: false, telematicsAccess: true }, []) && !A.canOpenView(A.TELEMATICS_DASHBOARD_VIEW, { role: 'user' }, []));
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
