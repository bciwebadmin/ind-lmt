# Bobcat of Indy LMT — Spin-up guide

This is the Bobcat of Indy fork of the Bobcat of Atlanta LMT. Same codebase,
separate Firebase project (`ind-lmt`) and domain (`lmt.bobcatofindy.com`).

Everything in the app already works. What's below is the one-time setup to get
this folder deployed and taking leads. The Claude project's `setup-runbook.md`
has the same sequence with more detail on each trap.

---

## 0. Prerequisites

- Node 20+ and npm
- Firebase CLI: `npm install -g firebase-tools`, then `firebase login`
- `gcloud` CLI, authenticated
- Access to the `ind-lmt` Firebase project
- A Resend account with `lmt.bobcatofindy.com` verified as a sending domain

---

## 1. Install and confirm it builds

Keep the repo **out of `Downloads`** — in the Atlanta fork, files there silently
reverted to earlier content after successful writes.

```powershell
cd C:\Users\ECharboneau\Projects\indy-lmt
npm ci
npm ci --prefix functions
npm run build
node scripts/verify-invariants.mjs
node scripts/test-helpers.mjs
```

All four must pass before any edit.

---

## 2. Firebase Console — one-time project setup

In the `ind-lmt` project:

1. **Build → Firestore Database** → Create database → **production mode** →
   region **`us-south1`**. This must match `firebase.json`; it cannot be changed later.
2. **Build → Authentication** → Get started → enable **Email/Password**.
   Leave "Email link (passwordless)" off.
3. **Build → Storage** → Get started → production mode → same region. File
   uploads (lead files, request paperwork, trade-in photos) need it.
4. **Project Settings → General** → confirm the web app config matches
   `src/firebase.js`. It's already filled in for `ind-lmt`.

---

## 3. Set the function secrets

```powershell
firebase functions:secrets:set INTAKE_SECRET
firebase functions:secrets:set RESEND_API_KEY
```

- `INTAKE_SECRET` — any long random string. Zapier sends it back in the
  `Authorization: Bearer <secret>` header, so keep a copy.
- `RESEND_API_KEY` — from the Resend dashboard. If the key is restricted to one
  domain, that domain must be `lmt.bobcatofindy.com`.

Non-secret values live in `functions/.env.ind-lmt`, which Firebase loads
automatically because the project ID is `ind-lmt`:

```
EMAIL_FROM=leads@lmt.bobcatofindy.com
CRM_URL=https://lmt.bobcatofindy.com/
```

The filename must be exact — Notepad will append `.txt` unless you choose
"All Files". Both values are read at **deploy time**.

---

## 4. First deploy

```powershell
npm run build
firebase deploy
```

Expect `onLeadCreate`, `onLeadAssignmentChange` and `onAccessRequestCreate` to
fail on the very first deploy with *Permission denied while using the Eventarc
Service Agent*. Wait ~5 minutes and run `firebase deploy --only functions`.

Then confirm hosting actually released (look for `release complete`; if not,
`firebase deploy --only hosting`) and that
`https://us-central1-ind-lmt.cloudfunctions.net/health` returns `{ok: true}`.

---

## 4b. Cloud Scheduler (daily reminder emails)

`dailyLeadReminders` runs on a schedule, which needs Cloud Scheduler. Once:

```powershell
gcloud services enable cloudscheduler.googleapis.com --project=ind-lmt
gcloud projects add-iam-policy-binding ind-lmt --member="serviceAccount:github-deploy@ind-lmt.iam.gserviceaccount.com" --role=roles/cloudscheduler.admin --condition=None
```

Without the role, the GitHub deploy of functions fails on that one function.
The hourly `systemHealthCheck` (self-repair loop, below) needs the same.

## 4c. Self-repair loop

The LMT checks itself every hour and files GitHub issues; code bugs go to an
AI repair agent that proposes a fix for a person to review. How it works:
CLAUDE.md → "Self-repair loop". Set-up, once, in this order:

1. **GitHub token for filing issues.** On a person's GitHub account (not a
   bot — the agent ignores bot-made issues): Settings → Developer settings →
   Fine-grained tokens → Generate. Repository access: only
   `bciwebadmin/ind-lmt`. Permissions: **Issues: Read and write**. Then:

   ```powershell
   firebase functions:secrets:set GITHUB_ISSUES_TOKEN
   ```

   Paste the token, then let the functions read it (the GitHub deploy account
   isn't allowed to grant this itself — true for any new secret):

   ```powershell
   gcloud secrets add-iam-policy-binding GITHUB_ISSUES_TOKEN --project=ind-lmt --member="serviceAccount:9450023146-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
   ```

   **Do both before pushing** — otherwise the deploy fails with
   `secretmanager.secrets.setIamPolicy denied`. Not ready for GitHub yet? Enter `none`: the health
   checks and System Health tab still work, nothing is filed. Fine-grained
   tokens expire; System Health shows a failing check if filing stops.
2. **Labels.** In the repo: Issues → Labels → New label: `auto-repair`,
   `needs-human`, `auto-error`.
3. **The repair agent.** Install the Claude GitHub App on the repo
   (https://github.com/apps/claude), then repo Settings → Secrets and
   variables → Actions → New repository secret `ANTHROPIC_API_KEY` (from
   console.anthropic.com → API keys; set a monthly spend limit there).
4. **Workflows.** Copy `auto-repair.yml` and `auto-repair-check.yml` into
   `.github/workflows/`.
5. **Rules.** The new collections need the updated rules:

   ```powershell
   firebase deploy --only firestore:rules
   ```
6. **Branch protection (recommended).** Repo Settings → Branches → add a rule
   for `main`: require a pull request, and require the `build-and-test` check.
7. **Alert recipients.** In the LMT: Settings → Notifications → System Alerts.
8. **Check it.** Settings → System Health → Run health check now. Every line
   should be green; anything red shows its fix.

Cost: the agent only runs on a new issue (≤3 a day) or an `@claude` comment;
each run is billed to the API key.

## 5. Bootstrap the first admin and `u_1`

1. **Firebase Console → Authentication → Users → Add user**
   Email `echarboneau@berrycompaniesinc.com`, pick any password.
   Copy the generated **UID**.
2. **Firestore → Start collection** `users` → document ID = that UID:

   | Field      | Type    | Value                              |
   |------------|---------|------------------------------------|
   | `name`     | string  | Erin Charboneau                    |
   | `email`    | string  | echarboneau@berrycompaniesinc.com  |
   | `role`     | string  | `admin`                            |
   | `isSystem` | boolean | `false`                            |

3. Create the **Unassigned** system user — collection `users`, document ID
   exactly `u_1`:

   | Field      | Type    | Value        |
   |------------|---------|--------------|
   | `name`     | string  | Unassigned   |
   | `email`    | string  | *(empty)*    |
   | `role`     | string  | `user`       |
   | `isSystem` | boolean | `true`       |

   Every lead without an assignee points at `u_1`. The app misbehaves without it.

---

## 6. Save Settings once, and set New Leads recipients

Sign in, open **Settings**, and save. `config/app` does not exist until you do,
and nothing server-side can read the config before then.

While there, set the **New Leads** notification recipients. Routing is manual, so
**this list is the only thing that tells anyone a lead exists.** An empty list
means leads arrive and nobody hears about it — no error anywhere in the app.

---

## 7. Resend

Add `lmt.bobcatofindy.com` as a sending domain and add its DNS records. Verifying
`bobcatofindy.com` does **not** cover the `lmt.` subdomain. A rejected send never
appears in Resend's dashboard — only in:

```powershell
firebase functions:log --only onLeadCreate
```

---

## 8. Custom domain

**Hosting → Add custom domain** → `lmt.bobcatofindy.com` → add the records
Firebase gives you. SSL provisioning takes up to 24 hours. Once it serves the
app, confirm `CRM_URL` matches and redeploy functions.

---

## 9. Zapier intake webhook

One Zap per website form. **Trigger:** the form tool's "new submission".
**Action:** Webhooks by Zapier → **POST**.

```
URL:           https://us-central1-ind-lmt.cloudfunctions.net/intake
Payload Type:  json
Header:        Authorization = Bearer <the INTAKE_SECRET from step 3>
```

**Not** `X-Intake-Secret` — that returns a bare 401 with nothing in the logs.
Lost the secret? `firebase functions:secrets:access INTAKE_SECRET`.

| Key | From the form | Notes |
|---|---|---|
| `customerName` | Name (first + last) | |
| `companyName` | Company | also accepts `company`, `businessName`, `organization` |
| `contactEmail` | Email | |
| `phone` | Phone | any format |
| `zip` | ZIP | |
| `comment` | Message / comments | |
| `department` | Typed per form (`Sales`, `Rental`, `Parts`, `Service`, `Supplies`) or a form dropdown | matched to Settings ignoring case |
| `branch` | A location dropdown, if the form has one; otherwise leave out | matched to Settings ignoring case |
| `formTitle` | The form's name, typed | shows on the lead |
| `leadSource` | Typed: `Gravity Forms` (or whatever Settings → Lead Sources calls it) | missing → `Internet` |
| `dateSubmitted` | Entry date (optional) | defaults to now |

What the endpoint does:

- Needs a customer name, company, email or phone, or it answers 400.
- Every lead starts **New** in Incoming, unassigned — a `status` field is
  ignored. The Settings **New Leads** list is emailed.
- Branch, department and source are matched to Settings ignoring case and
  spacing. An unknown value is kept as sent and logged
  (`firebase functions:log --only intake`), and won't match a filter.
- **Repeat submissions** (same email, or same last 10 phone digits, within 90
  days) join the customer's **open** lead with a note instead of making a
  second one. If their last lead is closed (Completed, Lost, Dead…), a fresh
  lead is created in Incoming with a note pointing back to the old one.
- Answers `{"ok":true,"action":"created"|"linked","leadId":…}`.

## 9b. Telematics (Nov 2026)

A separate module (CLAUDE.md → "Telematics"). Only admins and users with the
**Telematics** switch on (Users page) can open it.

### One-time, before the first push that includes email intake

The intake function needs two **new** secrets. A deploy fails if a secret it
uses doesn't exist, and the CI deploy account can't grant access to a new
secret — so create both and grant them *first*:

```powershell
# 1. A long random value for the Zap to send. Copy it — Zapier needs it too.
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
firebase functions:secrets:set TELEMATICS_INTAKE_SECRET     # paste it

# 2. The Google Maps key (below), or type none to start without address lookups.
firebase functions:secrets:set GOOGLE_MAPS_KEY

# 3. Let the functions read both.
gcloud secrets add-iam-policy-binding TELEMATICS_INTAKE_SECRET --project=ind-lmt --member="serviceAccount:9450023146-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding GOOGLE_MAPS_KEY --project=ind-lmt --member="serviceAccount:9450023146-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
```

After the deploy, the hand-off callable needs the usual invoker binding
(System Health flags it if missing):

```powershell
gcloud run services add-iam-policy-binding sendtelematicshandoff --region=us-south1 --project=ind-lmt --member=allUsers --role=roles/run.invoker
```

### Google Maps key (machine address lookups)

Google Cloud console → project **ind-lmt** → APIs & Services → **Library** →
enable **Geocoding API** → **Credentials** → Create credentials → API key →
**Edit** the key → API restrictions → *Restrict key* → **Geocoding API** only →
Save. One lookup per new case (≈1,000 a month at most), inside Google's free
monthly allowance. To change it later, `firebase functions:secrets:set
GOOGLE_MAPS_KEY` again and redeploy functions. `none` turns lookups off; the
case still gets the city and a map link from Bobcat's coordinates.

### The Zap: web admin inbox → LMT

Bobcat's critical fault code emails go to the web admin inbox (DealerNet
profile — Sean). One Zap:

1. **Trigger:** Microsoft Outlook → **New Email** — signed in as the web admin
   mailbox, folder = the one the Bobcat emails land in (an Outlook rule can file
   mail from `no-reply@bobcat.com` with "Critical Fault Code" in the subject
   there). Zapier's *New Email Matching Search* with
   `from:no-reply@bobcat.com subject:"Critical Fault Code"` works too.
2. **Action:** Webhooks by Zapier → **POST**

```
URL:           https://us-south1-ind-lmt.cloudfunctions.net/telematicsIntake
Payload Type:  json
Header:        Authorization = Bearer <the TELEMATICS_INTAKE_SECRET>
```

| Key | Map to (Outlook trigger field) |
|---|---|
| `subject` | Subject |
| `html` | Body Content (the HTML body) |
| `messageId` | Internet Message ID (or ID) — lets a Zapier retry be ignored |
| `receivedAt` | Received Date Time (optional) |

Send the **whole** body — don't pull fields out in Zapier. The LMT reads the
email itself (`functions/telematicsIntakeRules.js`), so a change in Bobcat's
layout shows up as an error in System Health instead of blank cases. A plain
text body also works (send it as `text`).

What the endpoint does:

- Answers `{"ok":true,"action":"created"|"attached"|"duplicate"|"skipped"}`.
  Wrong secret → 401. An email that isn't a fault code → `skipped`. A fault
  email it can't read → 422, logged as an error (self-repair alert).
- **Repeat codes** on a machine with an open case join that case (×N on the
  board, "Bobcat sent the code again" in its activity) instead of making a
  second one.
- The **Code List** decides where a new case goes: Critical (or not reviewed
  yet) → **New**; Non-critical / Ignore → straight to the **Archive**. Every
  code is counted on the Code List, and one it has never seen is added there,
  critical and not reviewed.
- The branch comes from the servicing dealer on the email ("… BOBCAT OF INDY
  NORTH" → Indy North).
- The machine's street address is looked up once (Google), so it can differ
  from the customer's billing address.

**Test it:** in the Zap editor, *Test* the webhook step with a real Bobcat
email — the answer should be `"action":"created"` and the case appears on the
board. Logs: `firebase functions:log --only telematicsIntake`.

### The daily WIP report (work order matching and reminders)

The WIP export is **emailed** to a private Resend receiving address. It
never sits on the website. (The old public `…/shopifyupdates/boi_wip.csv`
should be removed: it exposed open work orders to anyone with the link.)

1. **Receiving address.** Resend → Emails → **Receiving** → ⋯ → *Receiving
   address* shows your `<id>.resend.app` domain. Pick an address nobody would
   guess, e.g. `wip-` plus 10 random characters:
   `wip-7hq2kx9wpd@<id>.resend.app`. Any name on that domain works without
   setup.
2. **LMT:** Telematics Settings → **WIP report** → paste the address, and the
   address the report is sent **from** under *Only accept it from*. Save.
3. **Webhook.** Resend → **Webhooks** → Add webhook →
   URL `https://us-south1-ind-lmt.cloudfunctions.net/telematicsWipInbound`,
   event **email.received** → Add. Open it and copy the **signing secret**
   (`whsec_…`).
4. **API key.** Resend → **API Keys** → Create → name *LMT inbound*,
   permission **Full access** (a sending-only key can't download
   attachments).
5. **Secrets, before the push that includes this:**

```powershell
firebase functions:secrets:set RESEND_WEBHOOK_SECRET   # the whsec_… value
firebase functions:secrets:set RESEND_INBOUND_KEY      # the new re_… key
gcloud secrets add-iam-policy-binding RESEND_WEBHOOK_SECRET --project=ind-lmt --member="serviceAccount:9450023146-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding RESEND_INBOUND_KEY --project=ind-lmt --member="serviceAccount:9450023146-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
```

6. **The export.** Have the daily WIP job email the CSV, **as an
   attachment**, to the receiving address, from the sender you entered in
   step 2. Same columns as today (`Order#`, `Ord Date`, `Serial #` are the
   ones that matter).
7. **Test:** email a WIP CSV to the address from that sender. Within a
   minute Telematics Settings → WIP report shows *Last report … N work
   orders*. Logs: `firebase functions:log --only telematicsWipInbound`.

What happens with each report:

- Resend's signature is checked, then the address and sender. Anything
  else is ignored (or noted as *refused* in Settings).
- Only order number, open date, serial number and order type are kept
  (`telematicsWip/latest`). No customer names, contacts or amounts.
- A **Sent to Service** Field or Shop case whose serial has a work order
  opened **on or after the day it was sent** is completed ("Work order
  M6020231 found in the WIP report").
- **Reminders** (`telematicsFollowUps`, hourly, and right after each
  report): if a Field win still has no work order after **48 h** (Shop:
  **7 days**), the destination's people are emailed, cc whoever sent it.
  Again every **24 h**, **3** reminders, then the **escalation list** gets
  it (Tanner). All of these are set in Telematics Settings → Follow-ups. A
  reminder only goes out once a report received *after* its deadline still
  shows no work order, so a late or broken report pauses reminders instead
  of nagging service.
- System Health warns when no report has arrived for **36 h** (Settings).

## 10. Post-launch checklist

- [ ] All five branches appear under Settings
- [ ] Test lead through Zapier → appears in Leads, alert email received
- [ ] `firebase functions:log --only onLeadCreate` shows `sent`, no Resend error
- [ ] Email wordmark, footer and CTA all say Bobcat of Indy
- [ ] Favicon and browser tab title are right
- [ ] Reports XLSX filename starts `ind-lmt-report`, title row says Bobcat of Indy
- [ ] CSV import template is `ind-lmt-import-template.csv` (Settings → Import CSV)
- [ ] Attach a file to a lead and open it again — proves Storage and its rules
- [ ] Approve a test access request — temp password starts `IND-`
- [ ] Settings → System Health: Run health check now — all green
- [x] Node runtime: functions run on Node 22 (`engines.node`); set
      `node-version: 22` in `deploy.yml` too (Node 20 is decommissioned
      30 October 2026)

---

## What differs from the Atlanta fork

Port bug fixes both ways by diffing `src/App.jsx`. These are the only intentional
divergences from Bobcat of Atlanta, which this repo was taken from:

| Area | Bobcat of Indy | Bobcat of Atlanta (parent fork) |
|---|---|---|
| Firebase project | `ind-lmt` | `atl-lmt` |
| Domain | `lmt.bobcatofindy.com` | `lmt.bobcatofatlanta.com` |
| Root component | `BobcatIndyCRM` | `BobcatAtlantaCRM` |
| Branches | 5 — Anderson, Columbus, Ellettsville, Indy, Indy North | 8 — Huntsville (AL) plus seven in Georgia |
| Scoring service area | `46,47` (IN) primary; `60,61,62` (IL), `43,44,45` (OH), `40,41,42` (KY), `48,49` (MI) adjacent | `30,31,35` primary; `36,37,38,29,28,27,32,39` adjacent |
| Export filenames | `ind-lmt-report`, `ind-lmt-archived`, `ind-leads`, `ind-lmt-import-template`, `ind-routing-overview` | `atl-` equivalents |
| Temp password prefix | `IND-` | `ATL-` |
| Lead views | Tabs New, Working (+Pending), Prospect (+Dead, Unqualified, Lost), Wanted, Completed, plus a dashboard (`src/lib/pipeline.js`) | Leads / My Open / My Closed / All Closed |
| Statuses | New · Working, Pending · Prospect, Dead, Unqualified, Lost · Wanted · Completed · Junk | New, Contacted, Working, Quoted, Won, Lost, Unqualified, No Decision, Junk |
| Sales Submittal | Rep form on the lead + back-office fields (admins) + `sendSalesRequestEmail` to Settings → Sales Submittals | — |
| Deal details | `lead.deal` — machine, model, new/used, temperature, quoted date, location, competitor, lost reason | — |
| Sales Requests | `requests` collection — delivery / get ready / demo / parts / pick up / service, per-department check-offs | — |
| Trade-In Evaluations | `tradeIns` collection — condition ratings, manager value + approval | — |
| Finance tracker | `finance` collection — funding pipeline, auto-created from financed submittals | — |
| Firestore rules | Extra rules for `requests`, `tradeIns`, `finance` — **deploy by hand**: `firebase deploy --only firestore:rules` | — |
| File uploads | Firebase Storage, `storage.rules` — **deploy by hand**: `firebase deploy --only storage` | — |
| Navigation | + New menu; Pipeline / Back Office / Admin groups; Junk, Archived, Import, Scoring, Lead Routing moved into tabs; My Created → "Created by me" toggle | Flat sidebar |

Brand-agnostic fixes made here that Atlanta still needs:
`buildResubmissionEmailHtml` was called but never defined in `functions/index.js`,
so the "customer reached out again" email never sent; and email timestamps used
`America/Chicago`.

Everything else — the `#ff3300` palette and its contrast rules, departments,
lead sources, equipment keywords, `MODEL_REGEX`, the disabled ZIP router, both
verification scripts — is identical.

`serviceArea.texasPrefixes` holds the Indiana prefixes and
`scoringRules.tiers.hot` backs the label **Urgent**. Both names are deliberately
stale so the forks stay diffable; renaming either needs a Firestore migration.
