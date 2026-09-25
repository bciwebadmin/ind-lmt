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

```
POST https://us-central1-ind-lmt.cloudfunctions.net/intake
Authorization: Bearer <the INTAKE_SECRET from step 3>
Content-Type: application/json
```

**Not** `X-Intake-Secret` — that returns a bare 401 with nothing in the logs.

Payload fields the function reads:

```
customerName, companyName, contactEmail, phone, zip, comment,
department, formTitle, leadSource, dateSubmitted, branch, status
```

- Always send `leadSource` explicitly — it otherwise defaults to `"Google Sheet"`,
  which is not in `config.sources`.
- `department` must match the configured list exactly.
- `branch` stays empty unless sent — ZIP inference is disabled.
- `companyName` also accepts `company`, `businessName` or `organization`.

---

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
- [ ] Node runtime: Node 20 is decommissioned 30 October 2026 — bump
      `engines.node` and both workflows' `node-version:` before then

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
| Lead views | Four-step pipeline — Incoming, Working, Sales Request, Completed — behind a dashboard picker (`src/lib/pipeline.js`) | Leads / My Open / My Closed / All Closed |
| Statuses | New · Working, Prospect, Pending, Want · Sales Request · Completed, Lost, Unqualified, Cancelled · Junk | New, Contacted, Working, Quoted, Won, Lost, Unqualified, No Decision, Junk |
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
