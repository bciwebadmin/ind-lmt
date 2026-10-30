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

  // Issue text
  const inc = { id: 'client-abc', source: 'client', kind: 'code', message: "Cannot read properties of undefined (reading 'status')", stack: 'at Xe (index.js:1:2)', count: 3, firstSeen: 'f', lastSeen: 'l', build: 'abc123', view: 'stage-incoming' };
  check('repair: title says where', S.issueTitle(inc).startsWith('[auto] App: Cannot read'));
  const body = S.issueBody(inc, { ai: true });
  check('repair: agent body carries the guard rails', body.includes('Never edit `.github/`') && body.includes('Fixes #') && body.includes('`abc123`') && body.includes('scripts/map-stack.mjs'));
  check('repair: capped body explains how to start the agent', S.issueBody(inc, { ai: false }).includes('Add the `auto-repair` label'));
  check('repair: config body is not for the agent', S.issueBody({ ...inc, kind: 'config', source: 'health' }, { ai: false }).includes('not sent to the repair agent'));
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
