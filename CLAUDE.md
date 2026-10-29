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

~8,300 lines. Components, memos, helpers and Firestore subscriptions all inline.
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
three separate processes that can be tied together.** Leads live in five tabs:

  **New** (New) · **Working** (Working, Pending) · **Prospect** (Prospect, Dead,
  Unqualified, Lost) · **Wanted** (Wanted) · **Completed** (Completed only)

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
  that group asks for **keywords** (`lead.prospectKeywords`, `LostDealModal`,
  which also asks Lost's reason). Keywords are searchable in the tab and in
  global search.
- Only Completed and Junk are "closed" (`PIPELINE_CLOSED_STATUSES`): archived
  after 30 days, never stale. Dead / Unqualified / Lost stay live in Prospect.
- Status moves are free between tabs (`statusOptionsFor`); entering Working
  still needs an assigned rep (guard in `updateLead`).
- **Temperature** (Hot / Warm / Cold) is set by hand: `lead.temperature`,
  read with `leadTemperature()` (falls back to the old `lead.deal.temperature`).
  Quick-link chips above every tab, a column with inline select, a filter, a
  picker on the lead page, and the Reports chart. The computed heat score and
  Settings → Scoring were removed (`scoreLead` is still defined, unused).
- + New offers Lead, **Prospect** and **Want** (Add Lead preset to that
  status, owned by whoever adds it), Sales Submittal, Sales Request, Trade-In,
  Finance Deal.
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

## To Do hub (Oct 2026)

`src/lib/todo.js` (pure, tested) builds the list; `TodoView` shows it, first
item in the sidebar with a count. A rep sees items on leads they own (primary):
**follow-ups due** (`lead.followUp = { date, note }`, set on the lead page —
Done clears it, Tomorrow / Next week snooze it), **make contact** (in New,
assigned 12h+), **missing paperwork** (open submittals), **working deadline
passed**, **30-day check-in** (Completed 30–90 days, until
`postSaleFollowUpDoneAt`). Admins add a **Back Office** section (open
submittals, trade-ins awaiting approval, requests due/overdue, finance audit
flags) and a rep filter (me / every rep / one rep).

Sales deal paperwork: `SUBMITTAL_DOCS` — signed purchase agreement, credit
application (financed deals only), customer ID / tax exemption, delivery /
warranty forms. Received = a lead attachment with that `docType` (uploaded from
the checklist on the Sales Submittal tab) or a paper-copy tick
(`salesRequest.docs[key].receivedAt`).

The morning email (`dailyLeadReminders`) also lists follow-up dates due
(toggle `notifications.followUpDateRemindersEnabled`).

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

## Navigation

Sidebar (`Sidebar`): **+ New** menu (`NEW_MENU`: lead, sales request, trade-in,
walk-in sales submittal, finance deal → `handleNew`), then **Pipeline**
(Dashboards + the four steps), **Back Office** (Sales Requests, Finance,
Trade-Ins — badges are open counts), Reports, **Admin** (Users, Settings).

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
the export style. Change one, change the other.

## Region split (deliberate)

`intake` and `health` deploy to **us-central1**; everything else to
**us-south1** alongside Firestore. Originally to preserve legacy Zapier URLs;
kept so the forks stay diffable. Don't "fix" it in one fork only.

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
