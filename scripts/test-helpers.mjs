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
  check('custom closed status -> completed', st('Sold Elsewhere', [...P.PIPELINE_CLOSED_STATUSES, 'Sold Elsewhere']) === 'completed');
  check('unknown open status -> incoming', st('On Hold') === 'incoming');
  check('a missing status -> incoming', st(undefined) === 'incoming');

  // The flow only goes forward through the dropdowns.
  const inc = opts('New'), wrk = opts('Working'), sr = opts('Sales Request'), done = opts('Won');
  check('Incoming cannot jump to Sales Request or Won', !inc.includes('Sales Request') && !inc.includes('Won'), inc.join(','));
  check('Incoming can reach Working and fall through', ['Working', 'Pending', 'Prospect', 'Wants', 'Lost', 'Unqualified'].every(s => inc.includes(s)), inc.join(','));
  check('Working reaches Sales Request, not Won', wrk.includes('Sales Request') && !wrk.includes('Won'), wrk.join(','));
  check('Working does not go back to New', !wrk.includes('New'), wrk.join(','));
  check('Sales Request offers exactly Won / Working / Cancelled',
    JSON.stringify(sr) === JSON.stringify(['Sales Request', 'Won', 'Working', 'Cancelled']), sr.join(','));
  check('Completed can reopen to Working, not Sales Request', done.includes('Working') && !done.includes('Sales Request'), done.join(','));
  check('current status always offered', opts('On Hold').includes('On Hold'));
  check('custom statuses stay reachable', opts('New', [...P.PIPELINE_STATUSES, 'On Hold']).includes('On Hold'));
  for (const s of P.PIPELINE_STAGES) {
    check(`bulk menu for ${s.id} never offers Sales Request`, !bulk(s.id).includes('Sales Request'), bulk(s.id).join(','));
  }

  // A config saved before the pipeline existed (Atlanta's status list) heals.
  const old = {
    statuses: ['New', 'Contacted', 'Working', 'Quoted', 'Won', 'Lost', 'Unqualified', 'No Decision', 'On Hold', 'Junk'],
    closedStatuses: ['Won', 'Lost', 'Unqualified', 'No Decision', 'Junk', 'Working'],
    staleness: { enabled: true, thresholds: { New: 24, Pending: 999 } }
  };
  const healed = P.ensurePipelineStatuses(old, { Pending: 168, Prospect: 336 });
  check('heal: adds the pipeline statuses', P.PIPELINE_STATUSES.every(s => healed.statuses.includes(s)), healed.statuses.join(','));
  check('heal: drops Contacted and Quoted', !healed.statuses.includes('Contacted') && !healed.statuses.includes('Quoted'));
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

  // The sales request form.
  check('sales request needs equipment', 'equipment' in P.validateSalesRequest({}));
  check('sales request rejects quantity 0', 'quantity' in P.validateSalesRequest({ equipment: 'S66', quantity: '0' }));
  check('sales request accepts a valid form', Object.keys(P.validateSalesRequest({ equipment: 'S66', quantity: '2' })).length === 0);

  // App.jsx seeds its config from the module rather than a copied list.
  check('DEFAULT_CONFIG.statuses comes from pipeline.js', /statuses: PIPELINE_STATUSES,/.test(app));

  // The email's field list is a hand copy (no shared build) — keys must match.
  const fnSrc = readFileSync(join(root, 'functions/index.js'), 'utf8');
  const block = fnSrc.match(/const SALES_REQUEST_FIELDS = \[([\s\S]*?)\];/);
  const serverKeys = block ? [...block[1].matchAll(/key: '([^']+)'/g)].map(m => m[1]) : [];
  const clientKeys = P.SALES_REQUEST_FIELDS.map(f => f.key);
  check('email and form list the same sales request fields',
    JSON.stringify(serverKeys) === JSON.stringify(clientKeys), `server=[${serverKeys}] client=[${clientKeys}]`);

  // Every email builder functions/index.js calls must exist. One didn't
  // (buildResubmissionEmailHtml) and the try/catch around it hid the error.
  const called  = new Set([...fnSrc.matchAll(/\b(build\w+EmailHtml)\(/g)].map(m => m[1]));
  const defined = new Set([...fnSrc.matchAll(/function (build\w+EmailHtml)\(/g)].map(m => m[1]));
  const missing = [...called].filter(n => !defined.has(n));
  check('every email builder that is called is defined', missing.length === 0, missing.join(', '));
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
