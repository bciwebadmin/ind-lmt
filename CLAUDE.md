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

**Firestore rules are not deployed by CI.** After changing `firestore.rules`,
run `firebase deploy --only firestore:rules` by hand.

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

## The four-step pipeline (Indy only)

Indy works leads through four steps, each its own dashboard, with a picker
(`home` view) as the landing screen:

  **Incoming** (New) → **Working** (Working, Prospect, Pending, Want) →
  **Sales Request** (Sales Request) → **Completed** (Completed, Lost,
  Unqualified, Dead, Cancelled)

Indy calls a finished sale **Completed** (other forks: Won). `WON_STATUS` holds
`'Completed'` so shared report code still reads the same. Choosing Completed on
a lead still being worked means "sale made": it opens the **Sales Submittal**
(`SalesRequestModal`) and lands the lead in Sales Request
(`completesViaSalesRequest`). Only an admin — the back office — can then mark it
Completed (`canCloseSalesRequest`, enforced in the menus and in `updateLead`).
Lost asks for a reason and competitor (`LostDealModal`).

Field lists all live in `pipeline.js`, taken from Indy's Smartsheet exports:
`DEAL_FIELDS` (lead.deal — one section on every lead, the tracker's columns do
not vary by status), `LOST_FIELDS`, `SALES_REQUEST_FIELDS` (the rep's half of the
submittal, `showIf` for conditional questions, `pruneHiddenAnswers` on save) and
`BACK_OFFICE_FIELDS` (lead.salesRequest.backOffice, admin-only).

- `src/lib/pipeline.js` is the single source of truth for which status is in
  which step, which moves each step allows, and who sees what. It is pure, so
  `scripts/test-helpers.mjs` imports it directly. Change the mapping there.
- A lead's step is **derived from its status**, never stored. That is what
  guarantees a lead is in exactly one step; do not add a `stage` field.
- `ensurePipelineStatuses()` heals a stored `config/app` that predates the
  pipeline (stored config replaces defaults — see below). Pipeline statuses
  cannot be removed in Settings; they come back on the next read.
- Guards live in `updateLead`, so every path (row, bulk, panel) obeys them:
  entering Working needs an assigned rep, and Sales Request can only be
  entered through `SalesRequestModal`, which supplies `lead.salesRequest`.
- Visibility: admins see every lead; reps see leads where they are primary or
  secondary, plus unassigned leads in Incoming only.
- Submitting a sales request calls the `sendSalesRequestEmail` callable with
  just the lead id. The server re-reads the lead and emails
  `notifications.salesRequestEmails` (Settings → Sales Requests), cc and
  reply-to the rep. The form's field list is copied in `functions/index.js`
  (`SALES_REQUEST_FIELDS`); a test fails if the two drift.
- The old Leads / My Open / My Closed / All Closed views are gone. Those view
  ids redirect to the picker.

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
  ratings. A sales manager (admin) sets value + approval (`manager`).
  Sidebar → Trade-Ins.
- **Finance**: Indy's Sales Tracker. A financed Sales Submittal creates one
  automatically (`financeFromSubmittal`); finance (admins) works `admin.*`
  (Deal Status, lender, dates). `financeAudit` reproduces the sheet's 3-day
  audit formulas. Sales Request dashboard → Finance tab.

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

- **Open:** New, Working, Prospect, Pending, Want, Sales Request
- **Closed:** Completed, Lost, Unqualified, Dead, Cancelled → the Completed step
- **Junk:** its own tab, excluded from every dashboard and all report metrics

"Working" was renamed from "Qualified"; `LEGACY_WORKING_STATUS` still maps the
old stored value. A Working lead carries an absolute `workingUntil` deadline that
overrides the normal activity-based staleness clock.

Two field names are deliberately stale, kept so the forks stay diffable. Do not
"fix" them — it would require a Firestore migration:

- `config.scoringRules.tiers.hot` backs the label **Urgent**
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
is the single source of truth. `lead-routing` is deliberately *not* admin-only:
every signed-in user can open it, and reps get a read-only overview.

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
