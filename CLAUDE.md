# Working on this codebase

Conventions for the Bobcat of Indy LMT. Read before making changes.

This is a fork of the Bobcat of Atlanta LMT, which came from Berry Material
Handling, which came from Bobcat of Houston. Brand-agnostic fixes should be
ported between forks by diffing `src/App.jsx`. See `indy-fork-brief.md` in the
Claude project and the table at the end of `SETUP.md` for the deliberate
differences.

## Deploying

Push to `main`. GitHub Actions builds, verifies and deploys — hosting always,
functions only when `functions/` changed. Don't tell the user to run
`firebase deploy` for a normal change; tell them to commit and push.

Before ending any turn that edited code:

```bash
npm run build                      # must succeed
node --check functions/index.js    # if the backend was touched
node scripts/verify-invariants.mjs # palette, contrast, icons, stale branding
node scripts/test-helpers.mjs      # model regex, service area, router
```

**Firestore and Storage rules are not deployed by CI.** After changing
`firestore.rules` run `firebase deploy --only firestore:rules`; after changing
`storage.rules` run `firebase deploy --only storage`. Both by hand.

`functions/.env.ind-lmt` holds `EMAIL_FROM` and `CRM_URL`. Both are read at
**deploy time** — editing the file changes nothing until functions redeploy.

## A green build proves almost nothing

Vite does **not** error on undefined identifiers. It builds clean and crashes at
runtime. This has bitten every fork: an unimported `lucide-react` icon, a helper
referenced before it existed, a prop a component never declared.

`scripts/verify-invariants.mjs` checks every JSX component in `App.jsx` is
imported or defined. Run it; don't rely on the build.

## Verify logic outside the build

Pure helpers — scoring, routing, staleness, status resolution, date arithmetic —
can be extracted and run under plain `node`. `scripts/test-helpers.mjs` does this
for `MODEL_REGEX`, the service-area prefixes, and the guarantee that
`nearestBranchForZip` never returns a branch outside `config.branches`. It also
asserts **every branch ZIP scores as primary**, which catches a prefix list that
misses a branch.

For interactive components, drive them in a real browser (Chromium + Playwright)
against a scratch harness. The leads table sits inside `overflow-hidden`, so
anything opening a panel needs a portal to escape it — only a browser tells you
that.

**Verify external facts against the outside world, not the repo.** Every
internal check passed while the Atlanta fork's domain was wrong in every file,
because it was consistently wrong. `nslookup` a domain before writing it down.

## App.jsx is one file on purpose

~11,900 lines. Components, memos, helpers and Firestore subscriptions all inline.
This repo values greppability over modularity. **Do not split it up** unless
explicitly asked.

Edit with unique-string anchors, not regex sweeps. When a string appears more
than once, disambiguate with surrounding context — **five** logo marks and
**eight** email templates are near-identical, and a careless replace-all hits
them all. Count matches before and after any bulk replacement.

Blanket find-and-replace on the company name is specifically dangerous: it
corrupted the XLSX report title in one fork and the fork **comparison tables**
in `README.md` and `SETUP.md` in another, where the old company's values were
the correct side of the table.

## Branding lives in more places than you expect

A branding pass is not done when `App.jsx` is clean. The Atlanta fork "finished"
three times before it actually was:

- `index.html` — favicon (inline SVG, colour **and** glyph) and `<title>`
- **Eight** email wordmarks in `functions/index.js`, in **ALL CAPS**
- **Five** export filenames (`ind-lmt-report`, `ind-lmt-archived`, `ind-leads`,
  `ind-lmt-import-template`, `ind-routing-overview`)
- The temp-password prefix in the access-request approval flow (`IND-`)
- The password-strength blocklist
- `functions/package.json` description
- Fork comparison tables in `README.md` and `SETUP.md`

Start with a case-insensitive, no-extension-filter sweep of the whole tree, then
write targeted checks:

```bash
grep -rIn -i "bmh\|atlanta\|atl-\|georgia" . | grep -v node_modules | grep -v dist
```

(`berry` also matches the legitimate `berrycompaniesinc.com` addresses — Indy is
a Berry Companies dealer too.)

`verify-invariants.mjs` matches case-insensitively and checks for both BMH and
Atlanta strings. It did not originally, and eight capitalised wordmarks reached
customers' inboxes as a result.

## The brand colour

`#ff3300` Bobcat orange, defined in `tailwind.config.js` **and** in an inline
`<style>` fallback in `App.jsx` (search `Brand palette derived from`). The inline
block paints before Tailwind loads, so drift makes the UI flash the wrong colour.
`verify-invariants.mjs` compares every shade across the two.

**Measured contrast, not assumed:**

| fill | vs white | vs `#1c1917` |
|---|---|---|
| `#ff3300` brand-500 | 3.67:1 | 4.77:1 |
| `#d62b00` brand-600 | **4.99:1** | 3.50:1 |

White on `#ff3300` is **below** the 4.5:1 AA threshold for normal text — it only
clears AA Large (3:1). The Houston fork ships it anyway; this one does not.

- **Text-bearing brand surfaces use `bg-brand-600` with `text-white`**, hovering
  to `brand-700`. Buttons, badges, email CTAs.
- **`brand-500` is a non-text fill** — logo marks, accent bars, borders, tier
  dots, chart bars. The logo glyph is the exception: at `text-2xl` bold it
  qualifies as large text, so white on `brand-500` is fine there.
- `brand-700` (`#ad2300`) is the text shade for light backgrounds.
- `brand-300` (`#ff7444`) was **derived** by interpolation, not taken from
  Houston. Replace if Houston's real value turns up.

`verify-invariants.mjs` computes the actual WCAG ratio for each brand-filled
surface against the text colour and size it uses, so it fails on a bad pairing
rather than on a banned class name.

**The Berry Material Handling fork inverts all of this** — its amber `#feb703`
is 1.75:1 against white, so every brand fill there carries `text-stone-900`.
Watch the direction when porting. Note that in BMH only ~19 of its 97
`text-stone-900` occurrences are on brand fills; the rest are ordinary dark text
on white. A blind swap in either direction breaks the UI and still builds.

## Lead management (Indy only — reworked Oct 2026)

After Indy's process meeting, **Leads, Sales Submittals and Sales Requests are
three separate processes that can be tied together.** Leads live in six tabs
(Derek's first-phase review, Nov 25 2026):

  **New** (New) · **Working** (Working) · **Pending Deals** (Pending) ·
  **Prospect** (Prospect, Dead, Unqualified, Lost) · **Wanted** (Wanted) ·
  **Completed Deals** (Completed only)

**Derek's first phase (Nov 25 2026)** — he sees the LMT as a quasi-traditional
CRM: enter leads, follow up to the end, then mine completed customers.
- **One menu** (Back Office folded in). Derek's layout (Nov 25): + New ·
  Follow Ups · *line* · **Dashboard** heading: **Lead Management** (expands to
  New, Working, Pending Deals, Prospect, Wanted — open by default, remembered
  in `localStorage['lmt.navLeadsOpen']`, always open while one of those tabs
  shows), Trade-Ins, Sales Requests, Sales Submittals, Completed Deals · *line*
  · **Admin**: Reports, Users, Settings. The old Dashboard overview item is
  gone (the view still answers `?view=home`). The bottom switcher (admins with
  Customer Asset Management) reads **"Switch to…"** over the current area, not
  "Dashboard", and the admin landing screen is titled "Where to?". Sidebar items may carry
  `children` (the expander); groups are separated by a rule. `WORKSPACES` has no
  `backoffice`; a rep has no dashboard switcher (one dashboard).
- **+ New = three big options:** New Lead, New Sales Submittal, New Sales
  Request (`NEW_MENU`; tall on phones). Trade-ins start from a lead; prospects
  and wants from their tabs' Add buttons (`STAGE_ADD_ITEMS`).
- **Finance is hidden** (`FINANCE_ENABLED = false` in App.jsx; `HIDDEN_VIEWS`
  in access.js): no menu, + New, lead tab, Follow Ups item, Dashboard tile, and
  no automatic finance deal from financed submittals. Records are kept; flip
  the flag to bring it back.
- **Process every New lead.** Opening one shows `ProcessLeadModal`: Hot / Warm /
  Cold (→ Working with that temperature; asks for a rep if unassigned),
  Prospect (→ Prospect, with tags), Wanted (→ Wanted, no follow-ups), plus a
  small Junk link. "Back to the list" leaves it in New. `updateLead` stamps
  `processedAt` (first move out of New) and `temperatureSetAt`.
- **Working and Pending Deals need an owner** (`OWNED_STAGES`).
- **The Working deadline is retired** (no 1–4 week prompt; `getWorkingDeadline`
  returns null, so Working uses the normal staleness clock). The Hot / Warm /
  Cold Follow Ups schedule replaced it.

- `src/lib/pipeline.js` is the single source of truth (`PIPELINE_STAGES`). It
  is pure, so `scripts/test-helpers.mjs` imports it directly. A lead's tab is
  **derived from its status**, never stored — do not add a `stage` field.
  Stage ids keep their old names for diffing with Atlanta (`STAGE_INCOMING` is
  labelled New; `STAGE_SALES_REQUEST` is no longer a tab).
- **Completed = a done deal.** Choosing it opens the Sales Submittal
  (`SalesRequestModal`, `completesViaSalesRequest`); on submit the lead is
  Completed (`completedAt` stamped) and the submittal joins the Back Office
  **Sales Submittals** queue with its own status (`lead.salesRequest.status`:
  Open / Complete, `submittalStatus()`). Only admins complete or reopen a
  submittal; that never changes the lead's status.
- **Prospect** holds manual prospects plus leads set to Dead, Unqualified or
  Lost, with type buttons (`PROSPECT_TYPES`, Prospect is default). Moving into
  that group asks for **tags** — what they're interested in
  (`lead.prospectKeywords`, comma-separated; `TagInput` offers
  `TAG_SUGGESTIONS` as one-tap chips; `LostDealModal` also asks Lost's
  reason). `prospectTags()` = typed tags + Deal "Machine to Purchase"
  (`MACHINE_TAGS`: Compact Track Loader → CTL…), case-insensitive, standard
  spelling. The Prospect tab has an **Interested in** tag bar (counts per
  type; selecting tags shows leads carrying all of them) and row tags are
  clickable filters. Global search matches tags too.
- Only Completed and Junk are "closed" (`PIPELINE_CLOSED_STATUSES`): archived
  after 30 days, never stale. Dead / Unqualified / Lost stay live in Prospect.
- Status moves are free between tabs (`statusOptionsFor`); entering Working
  still needs an assigned rep (guard in `updateLead`).
- **Temperature** (Hot / Warm / Cold) is set by hand: `lead.temperature`,
  read with `leadTemperature()` (falls back to the old `lead.deal.temperature`).
  Quick-link chips above every tab, a column with inline select, a filter, a
  picker on the lead page, and the Reports chart. The computed heat score and
  Settings → Scoring were removed (`scoreLead` is still defined, unused).
- + New: see Derek's first phase above (three options).
- Renamed statuses (`LEGACY_STATUS_RENAMES`): Want→Wanted, Sales Request /
  Sales Submittal→Completed (submittal stays Open), Cancelled→Lost,
  Qualified→Working. Leads still storing an old name are shown under the new
  one (`normalizeLeadStatus`) and rewritten once by the first admin to load
  the app; Settings and staleness thresholds heal in `ensurePipelineStatuses`.
- Field lists, from Indy's Smartsheet exports: `DEAL_FIELDS` (lead.deal),
  `LOST_FIELDS`, `SALES_REQUEST_FIELDS` (rep's half of the submittal) and
  `BACK_OFFICE_FIELDS` (admin-only). `sendSalesRequestEmail` re-reads the lead
  and emails `notifications.salesRequestEmails`; its field list is copied in
  `functions/index.js` and a test fails if they drift.
- Visibility: admins see every lead; reps see leads where they are primary or
  secondary, plus unassigned leads in New. A rep also sees leads they entered
  but handed off, watch-only (`watchOnly`). **Created by me** toggle on every tab.
- Lead page tabs: Overview, Sales Submittal (with its status), Sales Requests,
  Trade-Ins, Finance, **Quotes** (the lead's files — renamed from Files),
  Notes & Activity.

## Follow Ups (was "To Do"; renamed Nov 25 2026 for Derek)

`src/lib/todo.js` (pure, tested) builds the list; `TodoView` shows it (view id
still `todo`), first item in the sidebar with a count. **No emails** — this is
where reminders live. A rep sees items on leads they own (primary):
- **New leads to process** — every New lead, from the day it arrives, every
  day until it's processed. Admins (Back office on) also see unassigned ones.
- **Follow-up dates you set** (`lead.followUp = { date, note }` — Done clears
  it and stamps `followUpDoneAt`; Tomorrow / Next week snooze it).
- **Check-ins due** — the schedule (`CADENCE`): Hot the next day then weekly,
  Warm monthly (30 d), Cold every 3 months (91 d), Prospect (status Prospect
  only) every 6 months (182 d); Wanted, New, done and dead leads none. Working /
  Pending Deals with no temperature run Warm. Due = last touch + interval
  (`lastTouchAt`: followUpDoneAt, statusChangedAt, temperatureSetAt,
  processedAt, createdDate, a person's note); Hot's first is the day after it
  became hot. A follow-up date set by hand pauses it. Done stamps
  `followUpDoneAt`. Each kind can be turned off: Settings → Notifications →
  Follow Ups schedule (`notifications.followUpCadence`; absent = on).
- **Missing paperwork**, **30-day check-in** (Completed 30–90 days).
- Admins: Sales Submittals to complete, trade-ins to approve, requests due,
  and a rep filter. (Finance flags are gone with Finance.)
- **Sort by** Type or **Hot → Warm → Cold → Prospect** (`TEMP_GROUPS`,
  remembered per browser).

Sales deal paperwork: `SUBMITTAL_DOCS` — signed purchase agreement, credit
application (financed deals only), customer ID / tax exemption, delivery /
warranty forms. Received = a lead attachment with that `docType` (uploaded from
the checklist on the Sales Submittal tab) or a paper-copy tick
(`salesRequest.docs[key].receivedAt`).

The morning email (`dailyLeadReminders`) is **off unless
`notifications.dailyReminderEmails === true`** (Derek: "no more emails");
Settings → Notifications → Daily Reminder Emails. New-lead alert emails are
separate and unchanged.

## Routing and reminders (Oct 2026)

`functions/routingRules.js` (pure, tested) decides; `resolveLeadRouting` in
index.js checks the users are real and not on leave.

- Per branch + department (`config.leadRouting`): Local Primary (the
  department person) is assigned; Local Backup is secondary; **`zipSplits`**
  ("By Zip": first matching ZIP list picks the rep instead of the primary —
  5-digit exact, 3-digit prefix); CC 1–3.
- **`config.branchManagers[branch]`** is copied on every alert for that branch,
  routed or not.
- **ZIP-based rules are Sales-only** (Erin): `zipSplits`, ZIP → branch, and
  shared areas are ignored for Parts, Rental, Service and Supplies (`isSales`).
- **`config.sharedAreas`** (Marion County: Indy + Indy North): a sales lead in
  those ZIPs is assigned by its own branch and the other branch's routed rep
  becomes secondary and is copied. Settings has a one-click Marion County
  default; the ZIP list is duplicated in App.jsx and routingRules.js and a test
  fails if they drift.
- No branch on the form but a ZIP split claims the ZIP → that branch.
- Equipment leads use the **Sales** department (Erin's call).
- `dailyLeadReminders` (scheduled, weekdays 8:00 Indianapolis, us-central1):
  one email per rep listing their assigned leads still in New (until they leave
  New) and deals completed 30–45 days ago (once each, `followUpReminderSentAt`).
  Rules in `functions/reminderRules.js`. Toggles: Settings → Notifications →
  Daily Reminders. **Needs Cloud Scheduler** — see SETUP.md.
- Alert emails show the rep-set temperature (when set) instead of a heat score.
- Text alerts for sales leads are planned (Twilio) — not built yet.

## Self-repair loop (Oct 2026)

The LMT watches itself and hands code bugs to an AI repair agent. A person
always reviews and merges; nothing the agent writes deploys on its own.
Pure rules (tested) in `functions/selfRepairRules.js`; I/O in index.js.

1. **Detect.**
   - Browser: `src/lib/errorReporter.js` + the `ErrorBoundary` in `main.jsx`
     write `errorReports/` (create-only, own uid, bounded fields — see
     firestore.rules). `onErrorReportCreate` folds each into
     `incidents/{fingerprint}` and deletes it. Reports carry the build id
     (`__BUILD__` = the commit, from vite.config.js) and the screen.
   - Server: index.js wraps `console.error` — every logged error becomes an
     incident (deduped, ≤10 writes/min/instance). **Log real failures with
     `console.error('[tag] …', err)`**; the `[tag]` becomes the incident tag.
     Use `console.warn` for things that are not bugs. `[self-repair]` errors
     are never recorded (no feedback loop).
   - `systemHealthCheck` (hourly at :17, us-central1; `runHealthCheckNow` is
     the admin button): probes every HTTP function unauthenticated (an HTML
     401/403 = the Cloud Run invoker permission is missing — the Oct 2026
     welcome-email outage), checks the Resend domain, and runs
     `configChecks` (unsaved settings, missing `u_1`, empty alert lists,
     routing slots pointing at deleted / on-leave users). Writes
     `health/latest`; emails `notifications.systemAlertEmails` only when the
     set of failing checks changes.
2. **Triage.** `fingerprint()` normalises ids, numbers and build hashes so one
   bug is one incident; `IGNORE_PATTERNS` drops offline blips, extensions and
   stale-chunk errors.
3. **Hand off** (in the hourly run). Code errors seen ≥2 times get a GitHub
   issue labelled **`auto-repair`**, which starts `.github/workflows/auto-repair.yml`
   (claude-code-action) — at most 3 a day (`selfRepair/state`); beyond that
   they're labelled `auto-error` for a person to send on. Health/config
   problems get **`needs-human`** with the exact fix. Issues are filed with the
   `GITHUB_ISSUES_TOKEN` secret (a person's fine-grained PAT — the action
   ignores bot-made issues). Token "none" = record only.
4. **Verify.** No recurrence for 7 days closes the issue; a recurrence reopens
   it. Health issues close as soon as the check stops failing. Admins can mute
   an incident in Settings → System Health.
5. **Tell people.** The same `systemAlertEmails` list gets one "new errors"
   digest per hourly run for code errors that just qualified for an issue or
   came back (`errorAlertKind`, `alertedAt` stamps each once; cleared when a
   resolved incident recurs). Toggle: `notifications.errorAlertsEnabled`.

Rules for the repair agent (also in the issue body and the workflow prompt):
smallest fix with a failing-then-passing check in `scripts/test-helpers.mjs`;
build, invariants, tests and `node --check functions/index.js` must pass;
**never edit `.github/`, `firestore.rules`, `storage.rules`, `firebase.json`,
`.firebaserc` or `functions/.env*`** (`auto-repair-check.yml` fails the PR if
a `claude/` branch does); config/permission/data causes get a written fix,
not code. Browser stacks are minified — `scripts/map-stack.mjs` maps them to
`src/` lines (usage at the top of the file).

Keep `PROBES` in step with the `onCall`/`onRequest` exports — a test fails if
one is added without a probe or with the wrong region.

**Every function must list the secrets it reads** (`secrets: [...]`),
including ones read by the helpers it calls — an undeclared secret is empty
at runtime. `intake` read `RESEND_API_KEY` for the resubmission email without
listing it, so that email failed with "Missing API key" (incident / issue #3,
fixed Nov 23). A test walks each export and the top-level functions it calls.

## Lists show at most 50 rows a page (Nov 2026, Erin)

Every list is paged: Leads (all tabs, Junk), Archived leads, Fault Codes,
Service Due, the Code List, Sales Submittals, Sales Requests, Trade-Ins and
Finance — desktop tables and phone cards alike. Sizes in `src/lib/paging.js`
(pure, tested): 25 or 50, **never more than 50**; an old saved 100 / 200 comes
back as 50. LeadsView keeps its own page state; every other list uses
`usePaged(rows, { resetKey, focusId })` + `{paged.controls}` (page 1 again when
the tab / filter / search in `resetKey` changes; a record opened from search
jumps to its page). The choice is shared (`localStorage['lmt.leadsPageSize']`).
A new list must use `usePaged` — a test counts the pagers. Not paged on
purpose: Reports / Telematics Report tables (top-N summaries), To Do, Users,
the CSV import preview, a lead's own record tabs.

## Easy-read forms on phones (Nov 2026)

Add a lead on a phone was "all white and small" (reps use readers). The
`lmt-easyread` class (CSS in `FontStyles`, `@media (max-width: 767px)` only)
gives darker 14px labels, 17px inputs with real borders (17px also stops iOS
zooming in), a tinted card, bigger help text and a full-width Save
(`lmt-easyread-save`). Desktop is unchanged. Put the class on any other form
that needs the same treatment.

**One text scale for the whole app (Nov 24, Erin — "consistent across the
app").** `FontStyles` raises Tailwind's small sizes everywhere: `text-sm`
15.5px, `text-xs` 13.5px, `text-[11px]` 12.5px, `text-[10px]`/`text-[9px]`
12px; headings (`text-base` and up) unchanged. Use those classes and every
screen matches — don't add per-page size overrides. CSS selectors with `[ ]`
inside that template string need **double** backslashes (`.text-\\[11px\\]`);
a single one is eaten by JS and the rule silently does nothing (it did, once).
The lead page is full width (no `max-w-6xl`).

## Navigation

**Dashboards (Nov 2026).** The left menu shows one dashboard at a time —
**Lead Management** (Follow Ups, Dashboard, the six lead tabs, Trade-Ins,
Sales Requests, Sales Submittals, Reports — Back Office was folded in on
Nov 25 for Derek, so ignore "Back Office" below) or **Customer Asset
Management** (the telematics boards) — switched from the
**Dashboard** button at the bottom of the menu. **Admin** (Users, Settings)
shows under every dashboard. **+ New** (`NEW_MENU` → `handleNew`) shows on
Lead Management and Back Office; top-bar search is hidden on Telematics.
Rules in `src/lib/access.js`: `WORKSPACES`, `workspacesFor(user)` (reps get
Lead Management + Back Office — their own submittals/requests live there;
telematics-only gets Telematics and no switcher), `workspaceOfView` (Users /
Settings / the picker belong to none), `landingView`. Each `Sidebar` group
carries `ws`. The menu follows the view: opening a Back Office record from
To Do or search switches it. **Landing:** admins get **Choose a dashboard**
(`WORKSPACE_PICKER_VIEW`, `WorkspacePickerView`) at sign-in; reps land on
New; telematics-only on the board. A link that asks for something
(`?view` / `?lead` / `?case`) skips the picker, and a refresh returns to
the dashboard the tab was in (`sessionStorage['lmt.workspace']`, cleared on
sign-out). Erin said "Back End"; the menu, emails and docs say Back Office,
so that's the label.

**Search** (`GlobalSearch` in the top bar, Ctrl/Cmd+K or `/`): matching lives
in `src/lib/search.js` (pure, tested) — every word must match; phone digits
match however they're formatted; accents ignored; name-prefix hits rank first.
`searchScope` is exactly what the user may open (admins: every lead incl. junk
and archived; reps: their dashboard leads + archived, and their own records).
A record picked in search opens inside its lead's panel (`focusRecord`) when
that lead is visible, otherwise in its Back Office list (`focusId`). The
shortcut closes an open lead panel first — the panel covers the box.

**Lead page.** Opening a lead shows a full page (`LeadDetailPanel`, name kept
for diffing with Atlanta) in the content area, with tabs: Overview, Sales
Submittal (when there is one), Sales Requests, Trade-Ins, Finance, Files,
Notes & Activity. The list underneath stays mounted but hidden, so Back returns
to it with filters and scroll intact. The URL carries `?lead=<id>`: opening
pushes a history entry (browser Back works), refresh and email links reopen
it, `closeLead` steps back, and sidebar navigation (`goTo`) closes it.

**Record details** (`RequestDetails`, `TradeInDetails`, `FinanceDetails`) are
shared by the Back Office lists and the lead page tabs (`RecordTab`), so a
trade-in can be approved, or a request checked off, from the customer's page.

Old views moved rather than removed — `MOVED_VIEWS` maps them, and `goTo` /
the `?view=` redirect follow the map: Junk → a tab on New, Archived → a
tab on Completed, Import / Scoring / Lead Routing → tabs in Settings
(`SETTINGS_TABS`). Tabs use `SubTabs`.

## Indy records: requests, trade-ins, finance

Three things that hang off a lead but can also stand alone, so each lives in
its own collection (`requests`, `tradeIns`, `finance`) with `leadId` (or null),
`salesPerson`, `createdBy`, `createdAt`, `history[]`. One generic layer:
`subscribeToRecords` / `addRecordDoc` / `updateRecordDoc` in firestoreData.js,
`createRecord` / `updateRecord` in App.jsx, and one callable,
`sendRecordEmail({ kind, id })`, which emails Settings →
`notifications.salesRequestEmails` / `tradeInEmails` / `financeEmails` (cc and
reply-to the rep). The server's `RECORD_FIELDS` copies the client field lists;
a test fails if they drift.

- **Requests**: Indy's "Sales Request" sheet (delivery, get ready, demo,
  parts, pick up, service). Fields rebuilt from the 3,496-row completed export
  — `REQUEST_FIELDS` with `showWhen` predicates (customer name/address only
  when a location is External Customer; service/parts boxes by type). The back
  office checks off Rental / Service / Parts (`departmentsFor`); status follows
  from the check-offs (`requestStatusFromDone`). Admins only.
- **Trade-Ins**: Indy's Trade-In Evaluation form; nine 1–5/N/A condition
  ratings. A sales manager (admin) decides in `TradeInDecisionCard`: value,
  comments, Approve / Decline (`manager` = tradeInValue, approved Yes/No,
  managerComments, decidedBy, decidedAt). Approving needs a value.
  Sidebar → Back Office → Trade-Ins. The typed "Attachments (Please explain)"
  answer is `attachmentsDetail`, never `attachments` (that is the uploaded
  files); `tradeInDisplayValues` reads old records that used the old key.
- **Finance**: Indy's Sales Tracker. A financed Sales Submittal creates one
  automatically (`financeFromSubmittal`); finance (admins) works `admin.*`
  (Deal Status, lender, dates). `financeAudit` reproduces the sheet's 3-day
  audit formulas. Sidebar → Back Office → Finance.

## Attachments

Files go to Firebase Storage under `attachments/<collection>/<id>/`, and the
record gets an `attachments[]` array of `{id, name, path, size, contentType,
uploadedAt, uploadedBy, category?}` (added with `arrayUnion`, removed with
`arrayRemove`, so two people attaching at once don't lose each other's). Lives
on leads (lead panel → Files; the submittal's paperwork carries
`category: 'submittal'`), requests, and trade-ins (Photos).

- Upload / URL / delete: `src/lib/attachments.js`. Record writes:
  `addAttachmentRecords` / `removeAttachmentRecord` in firestoreData.js.
- Allowed types and the 25 MB cap: `ATTACHMENT_TYPE_PATTERN` /
  `ATTACHMENT_MAX_BYTES` in pipeline.js, mirrored in `storage.rules`. A test
  fails if they drift. Forms stage files (`AttachmentStager`) and upload after
  the record is created, before the email goes, so the email lists them.
- Remove is offered to the uploader or an admin; the rules allow any signed-in
  user (Storage rules can't read Firestore cheaply).
- Storage must be enabled once in the console (Build → Storage → Get started).

**`firestore.rules` changed for these collections. CI does not deploy rules —
run `firebase deploy --only firestore:rules` after pushing, or every save of a
request, trade-in or finance deal is refused.**

The full Smartsheet → LMT map is in the Claude project,
`claude/smartsheet-process-map.md`.

## Status model

`config.statuses` drives everything; never hardcode a status list.

```javascript
const closedStatuses = getClosedStatuses(config);   // always use the helper
```

- **Open:** New, Working, Pending, Prospect, Dead, Unqualified, Lost, Wanted
- **Closed:** Completed (done deals) → archived after 30 days
- **Junk:** its own tab, excluded from every dashboard and all report metrics

"Working" was renamed from "Qualified"; `LEGACY_WORKING_STATUS` still maps the
old stored value. A Working lead carries an absolute `workingUntil` deadline that
overrides the normal activity-based staleness clock.

Two field names are deliberately stale, kept so the forks stay diffable. Do not
"fix" them — it would require a Firestore migration:

- `config.scoringRules` is still stored but unused since temperature replaced the heat score
- `serviceArea.texasPrefixes` holds **Indiana** prefixes (`46`, `47`)

## Branches

Five, all in Indiana: Anderson, Columbus, Ellettsville, Indy, Indy North
(Whitestown). Branch is assigned **manually** — `branchRouting.js` is disabled
and returns null for every ZIP. If it is ever re-enabled, note that Indy North
(46075) shares the 460 prefix with Anderson (46017) and sits ~25 miles from
Indy, so the explicit 5-digit map must carry metro Indianapolis and the 460
block; centroid distance cannot separate them.

## Firestore config replaces defaults, it does not merge

`subscribeToConfig` spreads stored data *over* `DEFAULT_CONFIG`. A field you add
to the defaults will be **absent** on the live project until someone edits
Settings. `ensureJunkStatus()` and `ensureWorkingStatus()` exist for this reason.

The config document is **`config/app`**.

Server-side code must not assume the config exists either —
`getServiceAreaRules()` in `functions/index.js` reads `config/app` with a full
fallback, and `quickScore()` uses it instead of the hardcoded ZIP regex and
hardcoded point values the older forks carry.

Note `DEFAULT_CONFIG` has **no `notifications` key at all**, so every
notification setting is absent until Settings is saved once.

## Duplicated by necessity

`branchRouting.js` exists in `src/lib/` and `functions/`, identical apart from
the export style. Change one, change the other. Same for `passwordProblem`
(`src/lib/password.js` ↔ `functions/passwordRules.js`) — a test fails if they drift.

## Region split (deliberate)

`intake` and `health` deploy to **us-central1**; everything else to
**us-south1** alongside Firestore. Originally to preserve legacy Zapier URLs;
kept so the forks stay diffable. Don't "fix" it in one fork only.

## Telematics (Nov 2026 — in progress)

A separate module for Tanner's telematics specialist (Carter): Bobcat critical
fault-code emails become cases; Carter calls the customer, wins it to Field
Service / a branch shop / Parts; the WIP report confirms a work order opened
on that serial, or the case gets bumped. Same app, its own data, its own
access (see Roles → module access). Discovery notes and samples are in the
repo's `telemetry/` folder on Erin's PC (not committed — customer data).

Build order: **1. access + code list (done)** · **2. board, case pages, win
tiers, destinations, hand-off emails (done)** · **3. email intake (done)** ·
**4. WIP report by email, serial matching, reminders, escalation (done)**.

- Pure rules in `src/lib/telematics.js` (tested). Views: `TELEMATICS_VIEWS`
  in `access.js`; sidebar group **Telematics**: Fault Codes · Service Due ·
  Reports · Code List · Telematics Settings.
- **Two boards (Nov 19, Erin)** — `case.kind`: `'fault'` (Bobcat "Critical
  Fault Code" emails → **Fault Codes**, `TELEMATICS_BOARD_VIEW` =
  `telematics-board`, the original board so old links work) or `'service'`
  ("<n> Hr Service Due" emails → **Service Due**, `TELEMATICS_SERVICE_VIEW` =
  `telematics-service`). **No `kind` = fault** (every case before the split);
  always read it with `caseKind(c)`. Same process for both — tabs, win tiers,
  destinations, hand-off, WIP match, reminders. A service case has
  `service { interval, dueAt, kitNumber, pmEndDate, pmEndHours }` instead of
  `fault`, no `codeLevel` (the Code List is faults only), its own lost reasons
  (`SERVICE_LOST_REASONS`), an amber row bar, and "Service due" in the
  hand-off email and subject. Fault and service cases never share: a service
  reminder on a machine with an open fault case gets its own case, and a
  repeat service reminder joins the machine's open *service* case (the
  higher interval wins). One work order on a serial completes every `sent`
  case on it, fault or service. Reports has a Fault codes / Service due /
  both filter and a "Service due by interval" table (`ofKind`, `topIntervals`).
- **Code list** — `telematicsCodes/{code}` (doc id = the code, upper case,
  letters/digits/dashes only — `isValidCode`). `level`: `critical` |
  `noncritical` | `ignore`; `reviewed` + `reviewedBy` / `reviewedAt`.
  Bobcat labels every email CRITICAL, so this list is the real filter.
  **Unknown or unreviewed codes count as critical** (Erin) — `classifyCode`.
  Any telematics user may classify or add a code; only admins delete.
- Starter list: `src/lib/telematicsSeed.js`, generated from Tanner's Critical
  Code Log (5,019 emails, Jun 17 – Nov 12 2026, 115 codes). Loaded once from
  the empty Code List ("Load starter list"); never overwrites existing codes.
  Don't hand-edit it.
- The rule's level list and `CODE_LEVEL_IDS` must match — a test checks.
- **Cases** — `telematicsCases/{id}`. Board tabs derive from `status`
  (`CASE_TABS`; never store a tab): New · Working · Sent On ·
  Completed · Archive (lost, closed — one archive with filters, Tanner).
  Status changes are pure (`winChange`, `loseChange`, `closeChange`,
  `confirmWorkOrderChange`, `reopenChange`, `startWorkingChange`) and return
  `{ patch, event }`; history and notes are appended with `arrayUnion`
  (`updateTelematicsCase`). A note on a New case moves it to Working. The
  rules' status list must match `CASE_STATUS_IDS` — a test checks.
- **Win tiers** (`WIN_TIERS`): Field Service and Shop → *Sent On* (labelled "Sent to service" before Nov 19)
  (wait for a work order on the serial — manual "Work order opened" until
  step 4's WIP match); Parts → *Completed* at once (no serial to match).
- **Destinations** — `telematicsConfig/settings.destinations[]`
  `{ id, kind: field|service|parts, name, branch, to[], cc[] }`, ≤ 4 people,
  plain emails (service managers never log in). Edited in Telematics
  Settings by any telematics user. Starter list from Tanner's contact sheet
  (`TELEMATICS_SEED_DESTINATIONS`; two `bobctofindy.com` typos corrected).
  `resolveRecipients`: valid + de-duplicated; **only CCs → sent To the CC**.
  The win dialog pre-selects the case's branch.
- **Hand-off email** — callable `sendTelematicsHandoff({ caseId })`
  (us-south1, in `PROBES`). It checks telematics access, re-reads the case,
  resolves recipients **server-side** from settings (never from the
  caller), reply-to the sender, and stamps `outcome.email`
  (`sent` / `failed` + reason) and a history entry. The client saves the win
  first, then calls it; "Send again" re-calls it. Pure server rules in
  `functions/telematicsRules.js` — `WIN_TIERS`, `resolveRecipients`,
  `mapsUrl`, `assetUrl` are duplicated from `src/lib/telematics.js` and a
  test fails if they drift. New callable → needs the Cloud Run `allUsers`
  invoker binding (`sendtelematicshandoff`, us-south1) after its first deploy.
- `?case=<id>` opens a case page (for step 4's bump emails).
- **Reports** (Telematics → Reports, page title "Telematics Report"; renamed from Dashboard Nov 19 — the view id is still `TELEMATICS_DASHBOARD_VIEW` / `telematics-dashboard`) — every
  figure from `src/lib/telematicsStats.js` (pure, tested): win rate = won ÷
  (won + lost) with **closed excluded**; work-order rate = Field/Shop wins
  with a work order ÷ Field/Shop wins; first response = created → first
  note / status change *by a person* (system history has no `by`); win →
  work order in Indy days (`openedOn`); top codes coloured by the Code List's
  current level; machines by model and by model + serial prefix (first 4
  chars — Tanner's "serial break"); who follows through per destination;
  by branch; 12-week cases/wins trend. Period + branch filters. Cases are
  all loaded client-side (fine for now; move to aggregates if it reaches
  many thousands). Chart colours: code levels keep red/blue/grey; others use
  the dataviz palette's validated blue (`#2a78d6`) and orange (`#eb6834`).
  Repair-complete time isn't measurable yet — the WIP lists open orders only.
- **Nov 20 updates (Erin)** — the dashboard is shown as **Customer Asset
  Management** (`WORKSPACES` label + sidebar group; the id, views, rules and
  the Users-page "Telematics" access pill are unchanged).
  - **Critical first:** Fault Codes sorts Critical (repeats included) before
    Non-critical before Ignore, newest first within each (`sortFaultCases`).
  - **Repeat codes:** a Non-critical / Ignore code sent for the same serial
    `count` times in `days` days (Settings → Repeat codes, `settings.repeat`,
    default 3 in 3; `repeatSettings` duplicated client/server, a test checks)
    sets `case.repeatCritical { count, days, code, level, seen, at }` at
    intake, adds a red system note (`notes[]`, `system: true`, kept out of the
    hand-off email) saying it's really non-critical and why, and a
    `repeat_critical` history entry (hidden in the timeline — the note tells
    it). Counted across all of that machine's fault cases by alert arrival
    time; machines are never combined, even for one customer. An old
    auto-archived case it lands on goes back to New. `caseLevel(c)` = the
    board's level (repeat → critical).
  - **No Close on Critical:** `canCloseCase` — Critical (incl. repeats) is
    only Won or Lost; **Service Due has no Close at all** (and no "Closed"
    archive filter).
  - **Call log** (its own card on the right, under Outcome): "I called —
    Talked / Voicemail / No answer / Wrong number" + optional note; the last 5
    calls are listed there, and every call also shows in Notes & activity → a note with `call: { result }` (`callEntry`). Moves New
    → Working, counts as first response, shows in the hand-off email.
  - **Export** (both boards, the Export button by Add case): *This view*
    (tab + filters + search, every page) or *All of the board*, as Excel or
    CSV. Excel "All" = an All sheet + one per non-empty tab; CSV = one file
    with a Tab column. Columns and order in `src/lib/telematicsExport.js`
    (pure, tested; fault boards add Code / Level / Repeat / Summary, service
    adds Interval / Kit). Dates in Indy time; a Link column opens the case.
    Files: `ind-fault-codes-<scope>-<date>` / `ind-service-due-<scope>-<date>`.
  - Code summaries from Tanner's log were HTML-escaped (`&quot;`): fixed in
    the seed, and `cleanCodeDoc` cleans saved ones as they're read.
- **Colour coding** — red = Critical, blue = Non-critical, grey = Ignore
  (Erin): `LEVEL_STYLE` (board rows: left bar + tint; chips) and
  `CODE_LEVEL_TONE` (Code List buttons, board filter chips). A case's level is
  the Code List's *current* classification of its code (`classifyCode`), so
  re-classifying a code recolours its cases. Board filters: code level chips
  (with counts in the tab) and branch.
- **How Bobcat's emails arrive (Nov 19)** — **forwarded from Erin's inbox to
  the LMT's Resend receiving address** (the same one as the WIP report).
  Resend's webhook fires for **every** address on the receiving domain
  (`ptn@eakooxena.resend.app` is partstradingnetwork.com's); the LMT only
  touches mail addressed **exactly** to Settings → LMT inbox
  (`wip@eakooxena.resend.app`) — `isAddressedTo` in telematicsWipRules.js
  (to / cc / received_for, "Name <addr>" unwrapped, no substring matching).
  Everything else → 200 `ignored`, nothing stored.
  `telematicsWipInbound` sorts: a CSV attachment → WIP report; no CSV → it
  fetches the body (`GET https://api.resend.com/emails/receiving/{email_id}` —
  webhooks carry metadata only) and hands it to `saveBobcatAlert`, which both
  paths share. Optional sender list `settings.wip.alertSenders` (separate from
  the WIP's `allowedSenders`). Dedupe key = the email's `message_id`, so a
  Resend retry is a duplicate. An unreadable Bobcat email logs
  `[telematics-intake]` and answers **200** (a retry won't help); a failed body
  fetch logs `[telematics-inbox]` and answers **502** (Resend retries).
  `telematicsWip/status.lastAlert` feeds Settings → LMT inbox. Forwarded mail
  carries the forwarder's signature and a From/Sent/To/Subject block above
  Bobcat's text — it lands before the first section heading and is ignored.
- **Email intake** — `telematicsIntake` (onRequest POST, **us-south1**, in
  `PROBES`; `Authorization: Bearer <TELEMATICS_INTAKE_SECRET>` — its own
  secret, not `INTAKE_SECRET`). The original path, still working for both
  kinds: a Zap (web admin Outlook → Webhooks) posts
  `{ subject, html, messageId, receivedAt }`; setup in SETUP.md §9b. The
  email is **read server-side** by `functions/telematicsIntakeRules.js`
  (pure, tested against made-up copies of real emails in
  `scripts/fixtures/` — never commit real ones): sections → labelled
  fields, CST/CDT times, branch from the dealer name (longest first, so
  Indy North isn't Indy; known AR numbers as a fallback). A fault email it
  can't read → 422 + `console.error('[telematics-intake] …')` (self-repair);
  other mail → `skipped`. Repeats on a machine's open case attach to it
  (`alertCount`, `alerts[]`, an `alert` history entry); the same
  `messageId` twice is a duplicate. **Every new fault case starts in New**,
  whatever its Code List level — Carter sorts through them (Erin, Nov 19).
  The level is stored (`codeLevel`) and colours the row; the board's level
  filter hides the rest. (Before Nov 19, noncritical / ignore went straight
  to the Archive as `closed` + `closure.auto`; those old cases still collect
  their repeats — `caseForAlert`.) Every
  code is counted (`seenCount`) and an unseen one is added to the Code List,
  not reviewed. Email cases have `createdBy: 'intake'`.
- **WIP report** — emailed daily (CSV attachment) to a private Resend
  **receiving** address (Telematics Settings → WIP report; SETUP.md §9b).
  Resend posts `email.received` to `telematicsWipInbound` (onRequest POST,
  us-south1, in `PROBES`). It verifies the **Svix signature** on the raw
  body (`RESEND_WEBHOOK_SECRET`, `whsec_…`; 5-min tolerance), checks the
  address and allowed senders, downloads the CSV with `RESEND_INBOUND_KEY`
  (a **full-access** Resend key — sending-only can't read received
  attachments), and keeps only `{ order, openedOn, serial, model, kind,
  branch }` in `telematicsWip/latest` (no customer data); `telematicsWip/status`
  feeds Settings and System Health. Pure rules: `functions/telematicsWipRules.js`.
  It was going to be a public URL; Erin chose email instead (Nov 2026).
- **Matching** — a `sent` Field/Shop case completes when a work order on its
  serial was **opened on or after the Indy day it was sent** (WIP has dates
  only). Earliest wins. `kind` (M* shop, T* field) and the M1–M6 branch are
  informational — unconfirmed, never required.
- **Reminders** — `telematicsFollowUps` (hourly :43, us-central1) and right
  after each report. `followUpState` (duplicated in `src/lib/telematics.js`
  for the board; a test checks): first deadline Field 48 h / Shop 168 h,
  then every 24 h, 3 reminders (to the destination, cc the sender), then the
  escalation list (`settings.escalation.to`, Tanner), cc the sender. Never
  sooner than one interval after the last reminder. **A reminder only fires
  once a WIP report received after its deadline still shows no match** — a
  late or broken feed pauses reminders. Stored on `case.followUp
  { bumps, lastBumpAt, escalatedAt }`. Timers live in
  `settings.followUps` (every key may be absent → defaults).
- System Health: check `telematics-wip` (once a WIP address is set) warns
  when no report for `wipStaleHours` (36).
- **Reverse geocoding** — `GOOGLE_MAPS_KEY` (Geocoding API only; `none`
  = off). Once per new case → `location.address`, `geocodeStatus`. A bad
  key is a `console.warn` (settings problem, not a code bug).
- Known from the samples: the email gives serial, model, hours, nearest city
  **and lat/long**, customer + address, primary code ("CRITICAL - M0217") and
  other active codes, and the servicing dealer's AR number (2000007726 Indy,
  2000008174 Indy North, 2000008159 Anderson, 2000007727 Ellettsville,
  2000007728 Columbus). Service Due emails (Erin's samples, Nov 19): the same
  sections minus Fault Information; Service Information has PM End Date / PM
  End Hours (usually "Invalid date" / "undefined"), Next Maintenance Interval,
  Event Date (CST) and Kit Number (sometimes blank); Customer and Owner
  Account are sometimes missing — the subject then has no customer either
  (`1500 Hr Service Due - b4sb35276 - T66`). The asset link is
  `https://dealer.bobcat.com/dmiq/AssetDetails/<serial lower-case>` — build
  it; don't store Bobcat's expiring tracking links. WIP order prefixes look
  like M1–M6 = branch shop, T* = field truck (to confirm with Tanner).

## Intake rules (Indy)

`functions/intakeRules.js` is pure and tested: web leads are always `New`
(`intakeStatus` — the pipeline needs a rep, a submittal or the back office for
anything later); branch / department / source are matched to Settings ignoring
case (`canonical`); a missing source is `Internet`. `findDuplicate` with
`closedStatuses` only joins a repeat to an **open** lead (Junk counts as open,
so repeat spam stays junk); a match on a closed lead makes a fresh lead with a
"Returning customer" note and `history[0].previousLeadId`.

## Intake auth

`Authorization: Bearer <INTAKE_SECRET>`. **Not** `X-Intake-Secret` — older
handoff docs say that and are wrong; the string appears nowhere in the code. The
wrong header returns a bare 401 with nothing in the logs.

## Exports are positional

The Reports XLSX builds rows as arrays against a separate header array. Adding a
field to the row without the header shifts every subsequent column. The file
still opens; it's just wrong. Assert the two lengths match.

## Roles

Two tiers only — `admin` and `user`. `ADMIN_ONLY_VIEWS` at the top of `App.jsx`
is the single source of truth: reports, users, settings. Lead Routing now
lives inside Settings, so it is admin-only too (it used to give reps a
read-only overview).

**Module access (Nov 2026).** On top of the role, each `users/{uid}` doc has
two switches, set on the Users page (Leads / Telematics pills; the add-user
form has an Access preset). Logic in `src/lib/access.js` (pure, tested):

- `leadAccess` — Lead Management. **Absent = on**, so older accounts need no
  migration. `false` = **telematics only**.
- `telematicsAccess` — the Telematics module. Absent = off.
- Admins always have both.

A telematics-only account is **fully blocked from lead data** (Erin): the rules
(`canUseLeads()`) refuse `leads`, `requests`, `tradeIns`, `finance`; the app
doesn't subscribe to them (that effect is keyed on `leadAccess`, like the
access-request one is keyed on role); + New, search and every lead view are
hidden; `canAccessView(view, user)` (it takes the **user** now, not the role)
bounces deep links. `configWithUsers.users` holds only people with lead access
(`leadUsers`), so no assignment dropdown, routing slot or report offers a
telematics-only account; the Users page gets everyone (`allUsersConfig`).
Storage attachments are still readable by any signed-in user (Storage rules
can't cheaply read Firestore) — paths aren't listed anywhere a telematics user
can see, but it isn't enforced.

## Password resets (Nov 2026)

Three ways, all through Resend from the LMT's own domain. Rules in
`functions/passwordRules.js` / `src/lib/password.js` (tested); new passwords
need 8–128 characters, no leading/trailing space.

- **Forgot password?** (sign-in screen) → `requestPasswordReset` (onCall,
  us-south1, **no sign-in**, in `PROBES`, needs the `allUsers` invoker
  binding). `generatePasswordResetLink` → branded email; the link lands on
  Firebase's hosted reset page. It used to be Firebase's own email from
  `noreply@ind-lmt.firebaseapp.com`, which Outlook quarantined (Erin, Nov 18).
  - Always `{ ok: true }` for a well-formed address — unknown, disabled,
    system or throttled included — so the form can't reveal who has an account.
  - Throttle: 1 a minute, 5 an hour per address in `passwordResets/{sha256}`
    (Admin SDK only — no rule; stores no address).
  - Asks for a Continue link to `CRM_URL`; if that domain isn't on Auth's
    authorized list it falls back to the plain link (`console.warn`, not an incident).
  - If the function throws, `sendResetEmail` falls back to Firebase's own
    email, so a Resend outage or an undeployed function still sends something.
- **Admin → Users → key icon** → `adminResetUserPassword`, two modes:
  - *Email a temporary password* — as before (random, emailed, admin never
    sees it unless the email fails).
  - *Set it myself* — `data.password`; no email, shown once in the modal to
    copy. Works for a user with no email on file.
- Both admin modes set `users/{uid}.mustChangePassword: true`
  (+ `passwordResetAt`, `passwordResetBy`). App shows `ChangePasswordScreen`
  instead of the app until the user re-enters the temporary password
  (`reauthenticateWithCredential`) and picks a new one, then clears the flag.
  firestore.rules lets a user clear it, never set it. A failed clear is logged
  `[must-change-pw]` and doesn't trap them (`pwChangedLocally`).

## Working from the user's local copy

**Always stage her file and diff it against your working copy before editing.**
An earlier fork's `App.jsx` turned out to be a different conversion entirely,
848 lines shorter.

**And diff again after writing.** In the Atlanta fork, four files silently
reverted to earlier content *after* the write reported success — twice for
`App.jsx` and `SETUP.md`, once for `README.md` and `functions/index.js`. One
reversion put wrongly-branded emails in front of customers for two extra days.
The repo was in `Downloads`, which is the likely cause.

Keep the repo out of `Downloads`, re-stage and diff after any batch of writes,
and get changes committed and pushed promptly — committed content survives a
working-tree reversion; uncommitted content does not.
