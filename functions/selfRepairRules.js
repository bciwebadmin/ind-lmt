// Pure rules for the self-repair loop (Nov 2026). No Firebase imports, so
// scripts/test-helpers.mjs can load this file directly. index.js does the I/O.
//
//   detect   → client crash reports, server console.error, hourly health check
//   triage   → fingerprint + ignore known noise
//   hand off → code errors: GitHub issue labelled `auto-repair` (starts the AI
//              agent, capped per day); config problems: `needs-human` issue
//   verify   → quiet for RESOLVE_AFTER_DAYS closes the issue; recurrence reopens

const RESOLVE_AFTER_DAYS = 7;
const MAX_AI_ISSUES_PER_DAY = 3;
const MIN_OCCURRENCES_FOR_ISSUE = 2;

// Noise that is never a code bug: offline blips, a tab still running the
// previous deploy, browser extensions, benign browser warnings.
const IGNORE_PATTERNS = [
  /ResizeObserver loop/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk \d+ failed/i,
  /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/im,
  /client is offline/i,
  /network-request-failed/i,
  /chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\//i,
  /Script error\.?$/i,
  /QuotaExceededError/i
];

function isNoise(message, stack) {
  const text = `${message || ''}\n${stack || ''}`;
  return IGNORE_PATTERNS.some(re => re.test(text));
}

// Strip the parts that change between occurrences of the same bug: ids, numbers,
// emails, quoted values, URLs. "Lead abc123XYZ not found" == "Lead q9w8 not found".
function normalizeMessage(msg) {
  return String(msg || '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/(["'`]).*?\1/g, '<str>')
    .replace(/\b[A-Za-z0-9_-]{16,}\b/g, '<id>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// The first stack frame inside our own code ("at LeadsView (App.jsx:4120)"
// → "LeadsView@App.jsx"), so the same bug from two builds matches.
function topFrame(stack) {
  const lines = String(stack || '').split('\n').map(s => s.trim()).filter(s => /^at |@/.test(s));
  for (const l of lines) {
    if (/node_modules|chrome-extension|<anonymous>/.test(l)) continue;
    const m = l.match(/(?:at\s+)?([\w$.<>]+)?\s*\(?([^()\s]*?([\w.-]+\.(?:jsx?|mjs|cjs)))(?::\d+)*\)?/);
    // Built files carry a content hash ("index-B1x9Qa.js") that changes every
    // deploy — drop it so the same bug matches across builds.
    if (m) return `${m[1] && !/^https?:/.test(m[1]) ? m[1] : '?'}@${m[3].replace(/-[\w]{6,}(\.m?js)$/, '$1')}`;
  }
  return '';
}

// Short stable id for Firestore doc names and GitHub issue titles.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function fingerprint({ source, tag, message, stack }) {
  // Browser bundles are minified: function names change whenever the code
  // does, so client errors match on the file alone.
  const frame = source === 'client' ? topFrame(stack).replace(/^.*@/, '') : topFrame(stack);
  const key = [source || 'server', tag || '', normalizeMessage(message), frame].join('|');
  return `${source || 'server'}-${hash(key)}`;
}

// "[intake] Routing lookup failed — leaving unassigned:" → tag "intake".
function tagOf(firstArg) {
  const m = String(firstArg || '').match(/^\[([\w/-]+)\]/);
  return m ? m[1] : '';
}

/**
 * Should this incident get a GitHub issue now?
 *   incident: { kind: 'code'|'config', count, issueNumber, status }
 *   state:    { day: 'YYYY-MM-DD', aiIssuesFiled }
 * Returns { file: boolean, ai: boolean, reason }.
 */
function issueDecision(incident, state, today) {
  if (!incident) return { file: false, ai: false, reason: 'none' };
  if (incident.issueNumber && incident.status !== 'resolved') return { file: false, ai: false, reason: 'already-filed' };
  if (incident.kind === 'config') return { file: true, ai: false, reason: 'config-needs-human' };
  if ((incident.count || 0) < MIN_OCCURRENCES_FOR_ISSUE) return { file: false, ai: false, reason: 'below-threshold' };
  const filedToday = state && state.day === today ? (state.aiIssuesFiled || 0) : 0;
  if (filedToday >= MAX_AI_ISSUES_PER_DAY) return { file: true, ai: false, reason: 'daily-ai-cap' };
  return { file: true, ai: true, reason: 'code-error' };
}

// An incident with an open issue that has been quiet long enough is resolved.
function shouldResolve(incident, now = Date.now()) {
  if (!incident || incident.status === 'resolved') return false;
  const last = Date.parse(incident.lastSeen || '');
  return Number.isFinite(last) && now - last >= RESOLVE_AFTER_DAYS * 86400e3;
}

/**
 * What an unauthenticated POST to a callable tells us. A running callable
 * answers 401/403 with JSON {"error":{"status":"UNAUTHENTICATED"…}} from our own
 * code; a call Google turns away before the function runs (missing invoker
 * permission — the Oct 2026 welcome-email outage) answers 401/403 with HTML.
 */
function callableProbeResult(status, contentType, body) {
  const text = String(body || '');
  const isJson = /json/i.test(contentType || '') || /^\s*\{/.test(text);
  if (isJson && /"status"\s*:\s*"(UNAUTHENTICATED|PERMISSION_DENIED|INVALID_ARGUMENT|FAILED_PRECONDITION)"/.test(text)) return { ok: true, problem: '' };
  if (status === 404) return { ok: false, problem: 'not-deployed' };
  if (status === 401 || status === 403) return { ok: false, problem: 'not-invokable' };
  if (status >= 500) return { ok: false, problem: 'server-error' };
  return { ok: isJson && status < 500, problem: isJson ? '' : 'unexpected-response' };
}

const FIX_FOR = {
  'not-invokable': (name, region) => `The app is blocked from calling \`${name}\`: its Cloud Run service is missing the public invoker permission (the function still checks sign-in itself). Fix:\n\n\`\`\`powershell\ngcloud run services add-iam-policy-binding ${name.toLowerCase()} --region=${region} --project=ind-lmt --member=allUsers --role=roles/run.invoker\n\`\`\``,
  'not-deployed': (name) => `\`${name}\` is not deployed. Re-run the GitHub deploy (Actions → Deploy to Firebase → Run workflow) or \`firebase deploy --only functions:${name}\`.`,
  'server-error': (name) => `\`${name}\` answered with a server error. Check \`firebase functions:log --only ${name}\`.`,
  'unexpected-response': (name) => `\`${name}\` answered in an unexpected way. Check \`firebase functions:log --only ${name}\`.`
};

/**
 * Settings and routing sanity, from config/app and the users list.
 * Returns [{ id, severity: 'error'|'warning', title, detail }].
 */
function configChecks(config, users) {
  const out = [];
  const byId = Object.fromEntries((users || []).map(u => [u.id, u]));
  const notif = (config && config.notifications) || {};
  const list = (k) => (Array.isArray(notif[k]) ? notif[k].filter(e => String(e).includes('@')) : []);
  if (!config || !Object.keys(config).length) {
    out.push({ id: 'config-missing', severity: 'error', title: 'Settings have never been saved', detail: 'Open Settings and save once — the server can\'t read any settings until then.' });
    return out;
  }
  if (!byId.u_1) out.push({ id: 'u1-missing', severity: 'error', title: 'The "Unassigned" system user (u_1) is missing', detail: 'Every unassigned lead points at it. Recreate it per SETUP.md step 5.' });
  if (notif.newLeadAlertsEnabled !== false && !list('newLeadEmails').length) {
    out.push({ id: 'no-new-lead-recipients', severity: 'error', title: 'No one gets New Lead alerts', detail: 'Settings → Notifications → New Leads is empty, so unrouted leads arrive silently.' });
  }
  if (!list('salesRequestEmails').length) out.push({ id: 'no-submittal-recipients', severity: 'warning', title: 'No back-office recipients for Sales Submittals', detail: 'Settings → Notifications → Sales Submittals is empty; submittals only reach the rep.' });
  const who = (id) => byId[id];
  for (const [key, e] of Object.entries((config && config.leadRouting) || {})) {
    const ids = [['Local Primary', e.primaryUserId], ['Local Backup', e.backupUserId], ...((e.zipSplits || []).map(s => ['ZIP split rep', s.userId]))];
    for (const [slot, id] of ids) {
      if (!id) continue;
      const u = who(id);
      if (!u) out.push({ id: `routing-missing-${key}-${slot}`, severity: 'error', title: `Routing ${key.replace('::', ' / ')}: ${slot} no longer exists`, detail: 'Pick someone else in Settings → Lead Routing.' });
      else if (u.onLeaveOfAbsence && slot !== 'Local Backup') out.push({ id: `routing-leave-${key}-${slot}`, severity: 'warning', title: `Routing ${key.replace('::', ' / ')}: ${slot} ${u.name} is on leave`, detail: 'Leads routed there fall back to the New Leads list until they return.' });
    }
  }
  for (const [branch, id] of Object.entries((config && config.branchManagers) || {})) {
    if (id && !who(id)) out.push({ id: `manager-missing-${branch}`, severity: 'warning', title: `${branch} branch manager no longer exists`, detail: 'Pick a branch manager in Settings → Lead Routing.' });
  }
  return out;
}

// Plain HTTP functions (intake, health) answer every request with JSON from our
// own code — even a 401 for a missing secret. HTML means Google turned the
// request away before the function ran.
function httpProbeResult(status, contentType, body) {
  const text = String(body || '');
  const isJson = /json/i.test(contentType || '') || /^\s*[{[]/.test(text);
  if (status === 404 && !isJson) return { ok: false, problem: 'not-deployed' };
  if (status >= 500) return { ok: false, problem: 'server-error' };
  if (isJson) return { ok: true, problem: '' };
  if (status === 401 || status === 403) return { ok: false, problem: 'not-invokable' };
  return { ok: false, problem: 'unexpected-response' };
}

// Every function the app or Zapier calls over HTTP. kind 'callable' = onCall
// (the app), 'http' = onRequest. Keep in step with the exports in index.js —
// scripts/test-helpers.mjs checks that.
const PROBES = [
  { name: 'intake', region: 'us-central1', kind: 'http', method: 'POST' },
  { name: 'health', region: 'us-central1', kind: 'http', method: 'GET' },
  { name: 'sendImportSummaryEmail', region: 'us-south1', kind: 'callable' },
  { name: 'sendSalesRequestEmail', region: 'us-south1', kind: 'callable' },
  { name: 'sendRecordEmail', region: 'us-south1', kind: 'callable' },
  { name: 'sendWelcomeEmail', region: 'us-south1', kind: 'callable' },
  { name: 'adminResetUserPassword', region: 'us-south1', kind: 'callable' },
  { name: 'reassignUserLeads', region: 'us-south1', kind: 'callable' },
  { name: 'restoreLoaLeadsForUser', region: 'us-south1', kind: 'callable' },
  { name: 'runHealthCheckNow', region: 'us-south1', kind: 'callable' }
];

function probeUrl(probe, projectId) {
  return `https://${probe.region}-${projectId}.cloudfunctions.net/${probe.name}`;
}

// Overall status of a health run: the worst failing check.
function healthStatus(checks) {
  const failing = (checks || []).filter(c => !c.ok);
  if (failing.some(c => c.severity === 'error')) return 'error';
  if (failing.length) return 'warning';
  return 'ok';
}

// The alert email goes out only when this changes — not every hour while
// something stays broken.
function alertKey(checks) {
  return (checks || []).filter(c => !c.ok).map(c => c.id).sort().join(',');
}

/**
 * What the hourly run does with one incident.
 *   'mute'    — an admin muted it: nothing
 *   'resolve' — open with no recurrence for RESOLVE_AFTER_DAYS (health
 *               incidents: as soon as the check stops failing)
 *   'reopen'  — came back after its issue was closed
 *   'file'    — needs a new issue (decision.ai says whether the agent starts)
 *   'none'
 */
function incidentAction(incident, state, today, now = Date.now(), { failingHealthIds = [] } = {}) {
  if (!incident || incident.status === 'muted') return { action: incident ? 'mute' : 'none' };
  if (incident.status === 'resolved') return { action: 'none' };
  if (incident.source === 'health' && !failingHealthIds.includes(incident.checkId)) return { action: 'resolve' };
  if (incident.source !== 'health' && shouldResolve(incident, now)) return { action: 'resolve' };
  if (incident.issueNumber && incident.reopened) return { action: 'reopen' };
  const d = issueDecision(incident, state, today);
  return d.file ? { action: 'file', ai: d.ai, reason: d.reason } : { action: 'none', reason: d.reason };
}

function issueTitle(incident) {
  const where = incident.source === 'client' ? 'App' : incident.source === 'health' ? 'Health check' : `Server${incident.tag ? ` [${incident.tag}]` : ''}`;
  return `[auto] ${where}: ${String(incident.message || incident.title || 'error').slice(0, 90)}`;
}

function issueBody(incident, { ai }) {
  const lines = [];
  lines.push(`Filed automatically by the LMT self-repair loop. Fingerprint \`${incident.id}\`.`, '');
  lines.push('| | |', '|---|---|');
  lines.push(`| Where | ${incident.source === 'client' ? 'Browser (app)' : incident.source === 'health' ? 'Hourly health check' : 'Cloud Function'}${incident.tag ? ` — \`${incident.tag}\`` : ''} |`);
  lines.push(`| Occurrences | ${incident.count || 1} |`, `| First seen | ${incident.firstSeen || ''} |`, `| Last seen | ${incident.lastSeen || ''} |`);
  if (incident.build) lines.push(`| Build | \`${incident.build}\` |`);
  if (incident.view) lines.push(`| Screen | \`${incident.view}\` |`);
  lines.push('', '**Error**', '', '```', String(incident.message || '').slice(0, 2000), '```');
  if (incident.stack) lines.push('', '**Stack**', '', '```', String(incident.stack).slice(0, 4000), '```');
  if (incident.fix) lines.push('', '**Suggested fix**', '', incident.fix);
  lines.push('');
  if (ai) {
    lines.push(
      '**Instructions for the repair agent** (see CLAUDE.md → "Self-repair loop"):',
      '1. Find the root cause. If it is configuration, permissions or data rather than code, do NOT change code — comment the diagnosis and the exact fix for a human, and stop.',
      ...(incident.source === 'client' ? ['   The stack above is from the minified build: map it to `src/` lines with `scripts/map-stack.mjs` (instructions at the top of that file; the build id is the commit).'] : []),
      '2. Reproduce it with a failing check in `scripts/test-helpers.mjs` (extract a pure helper if needed).',
      '3. Make the smallest fix that makes it pass.',
      '4. Run `npm run build`, `node scripts/test-helpers.mjs`, `node scripts/verify-invariants.mjs` and `node --check functions/index.js`; all must pass.',
      '5. Never edit `.github/`, `firestore.rules`, `storage.rules`, `firebase.json`, `.firebaserc` or `functions/.env*`.',
      '6. Commit to your branch and finish with a short plain-English comment: cause, fix, how you tested it. A person reviews it and opens the pull request, which must say "Fixes #<this issue>".'
    );
  } else if (incident.kind === 'config') {
    lines.push('This is a configuration problem, not a code bug, so it is not sent to the repair agent.');
  } else {
    lines.push('Not sent to the repair agent automatically (daily cap reached). Add the `auto-repair` label to start it.');
  }
  return lines.join('\n');
}

module.exports = {
  RESOLVE_AFTER_DAYS, MAX_AI_ISSUES_PER_DAY, MIN_OCCURRENCES_FOR_ISSUE,
  isNoise, normalizeMessage, topFrame, fingerprint, tagOf, issueDecision, shouldResolve,
  callableProbeResult, httpProbeResult, PROBES, probeUrl, healthStatus, alertKey, incidentAction,
  FIX_FOR, configChecks, issueTitle, issueBody
};
