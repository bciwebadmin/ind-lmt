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
  check('legacy Wants -> working', st('Wants') === 'working');
  check('legacy Won -> completed', st('Won') === 'completed');
  check('legacy No Decision -> completed', st('No Decision') === 'completed');
  check('Indy calls a finished sale Completed', P.WON_STATUS === 'Completed');
  check('custom closed status -> completed', st('Sold Elsewhere', [...P.PIPELINE_CLOSED_STATUSES, 'Sold Elsewhere']) === 'completed');
  check('unknown open status -> incoming', st('On Hold') === 'incoming');
  check('a missing status -> incoming', st(undefined) === 'incoming');

  // The flow only goes forward through the dropdowns.
  const inc = opts('New'), wrk = opts('Prospect'), sr = opts('Sales Request'), done = opts('Completed');
  check('Incoming cannot jump to Sales Request or Completed', !inc.includes('Sales Request') && !inc.includes('Completed'), inc.join(','));
  check('Incoming can reach Working and fall through', ['Working', 'Prospect', 'Pending', 'Want', 'Lost', 'Unqualified'].every(s => inc.includes(s)), inc.join(','));
  check('Working offers exactly Erin\'s list (+ Working, Dead, Junk)',
    JSON.stringify(wrk) === JSON.stringify(['Working', 'Prospect', 'Pending', 'Want', 'Completed', 'Lost', 'Unqualified', 'Dead', 'Junk']), wrk.join(','));
  check('Working does not go back to New', !wrk.includes('New'), wrk.join(','));
  check('Completed from Working goes via the Sales Submittal', P.completesViaSalesRequest('Pending', 'Completed'));
  check('Completed from Sales Request is the back office closing it', !P.completesViaSalesRequest('Sales Request', 'Completed'));
  check('Lost from Working is not a sale', !P.completesViaSalesRequest('Working', 'Lost'));
  check('a rep cannot close a submittal from the menu',
    JSON.stringify(opts('Sales Request', undefined, undefined, { isAdmin: false })) === JSON.stringify(['Sales Request', 'Working', 'Cancelled']));
  check('a rep cannot close a submittal via a direct write', !P.canCloseSalesRequest('Sales Request', 'Completed', false));
  check('an admin can close a submittal', P.canCloseSalesRequest('Sales Request', 'Completed', true));
  check('a rep bulk menu on Sales Request has no Completed', !bulk('sales-request', undefined, undefined, { isAdmin: false }).includes('Completed'));
  check('Sales Request offers exactly Completed / Working / Cancelled',
    JSON.stringify(sr) === JSON.stringify(['Sales Request', 'Completed', 'Working', 'Cancelled']), sr.join(','));
  check('Completed can reopen to Working, not Sales Request', done.includes('Working') && !done.includes('Sales Request'), done.join(','));
  check('current status always offered', opts('On Hold').includes('On Hold'));
  check('custom statuses stay reachable', opts('New', [...P.PIPELINE_STATUSES, 'On Hold']).includes('On Hold'));
  for (const s of P.PIPELINE_STAGES) {
    check(`bulk menu for ${s.id} never offers Sales Request`, !bulk(s.id).includes('Sales Request'), bulk(s.id).join(','));
  }
  check('bulk menu for working cannot complete a sale', !bulk('working').includes('Completed'), bulk('working').join(','));
  check('bulk menu for completed can still set Completed', bulk('completed').includes('Completed'), bulk('completed').join(','));

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
  check('heal: Cancelled counts as closed', healed.closedStatuses.includes('Cancelled'));
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
  check('Dead is a Completed-step status', st('Dead') === 'completed');
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

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
