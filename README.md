# Bobcat of Indy — Lead Management Tool (LMT)

Firebase-based CRM for Bobcat of Indy. Leads arrive from web forms via
Zapier, get scored, and are assigned to a branch and worked to close.

- **Live:** https://lmt.bobcatofindy.com
- **Firebase project:** `ind-lmt`
- **Branches served:** Anderson · Columbus · Ellettsville · Indy · Indy North

This is a fork of the Bobcat of Atlanta LMT (`atl-lmt`), which came from Berry
Material Handling (`bmh-crm`), which came from Bobcat of Houston (`hou-crm`). All
four share a codebase; see *Relationship to the other forks* at the bottom before
porting anything.

---

## First-time setup

```bash
npm install
npm install --prefix functions
npm run build
```

Requires Node 20+, and the Firebase CLI (`npm i -g firebase-tools`) for manual deploys.

---

## Day-to-day

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production bundle into `dist/` |
| `node --check functions/index.js` | Syntax-check the backend before pushing |

**Deploys are automatic.** Push to `main` and GitHub Actions builds, verifies and
deploys. You should not normally need to run `firebase deploy` by hand.

```bash
git add -A
git commit -m "Describe the change"
git push
```

Hosting deploys on every push to `main`. Functions deploy **only when something
under `functions/` changed**, so a frontend tweak doesn't wait on a 3–5 minute
backend deploy. Watch it run under the repo's **Actions** tab.

Manual deploy, if you ever need to bypass CI:

```bash
npm run build
firebase deploy --only hosting            # ~30 seconds
firebase deploy --only functions          # 2-5 minutes
```

---

## Deploy credentials (one-time)

Let the Firebase CLI do it. From the project folder, once the repo has a remote:

```bash
firebase login
firebase init hosting:github
```

It creates a deploy service account, stores the JSON as the repo secret
`FIREBASE_SERVICE_ACCOUNT_IND_LMT`, and wires up GitHub auth for you. When it
offers to overwrite `.github/workflows/`, **say no** — it writes a hosting-only
workflow and would replace the one in this repo.

### One extra step, because this repo also deploys functions

The service account the CLI creates has Hosting permissions only. In
**Google Cloud Console → IAM** (project `ind-lmt`), find the new
`github-action-...` account and add:

- Cloud Functions Admin
- Cloud Run Admin *(functions v2 run on Cloud Run underneath)*
- Service Account User
- Artifact Registry Writer
- Secret Manager Secret Accessor *(the functions read `INTAKE_SECRET` and `RESEND_API_KEY`)*

Skip this and hosting will deploy fine while every functions deploy fails on
permissions. The error names the permission it wanted.

### Doing it by hand instead

Create a service account with the roles above plus Firebase Hosting Admin,
download a JSON key, and paste it into
**GitHub → repo → Settings → Secrets and variables → Actions** as
`FIREBASE_SERVICE_ACCOUNT_IND_LMT`. Then delete the downloaded file — it is a live
credential, and `.gitignore` keeps it out of the repo but not out of your Downloads
folder.

## What is and isn't in this repo

**Committed:** all source, `firebase.json`, `firestore.rules`, and
`functions/.env.ind-lmt` — which holds only `EMAIL_FROM` and `CRM_URL`, no secrets.
Firebase auto-loads that file by project id at deploy time, so CI needs it present.

**Never committed:** `node_modules/`, `dist/`, `.firebase/`, and service account
keys. The workflow fails the build if a key ever gets tracked.

**Real secrets live in Google Secret Manager**, not here:

```bash
firebase functions:secrets:set INTAKE_SECRET
firebase functions:secrets:set RESEND_API_KEY
```

`src/firebase.js` contains the Firebase **web** API key. That one is safe in a
repo — it identifies the project to the browser and is protected by Firestore
security rules, not by being hidden.

---

## Layout

```
├── .github/workflows/deploy.yml   Build, verify, deploy on push to main
├── firebase.json                  Hosting rewrites, function regions, Firestore config
├── firestore.rules                Security rules
├── src/
│   ├── App.jsx                    All the UI. One file on purpose — see CLAUDE.md
│   ├── firebase.js                Client SDK init (ind-lmt)
│   └── lib/
│       ├── firestoreData.js       Firestore CRUD helpers
│       ├── firestoreAuth.js       Auth + callable wrappers
│       └── branchRouting.js       ZIP -> branch router (disabled)
└── functions/
    ├── index.js                   All Cloud Functions
    ├── branchRouting.js           Server copy of the ZIP router — keep in sync
    └── .env.ind-lmt               Non-secret env vars
```

`branchRouting.js` exists twice, in `src/lib/` and `functions/`, because the client
and the backend both need it and there is no shared build step. The two files are
identical apart from the export style. **Change one, change the other.**

---

## Region split (deliberate)

`intake` and `health` deploy to **us-central1**; everything else is in
**us-south1**, alongside Firestore. The split originally preserved Houston's legacy
Zapier URLs. Indy has none to protect, but keeps it so the forks stay diffable.
Don't "fix" it in one fork only.

Intake endpoint: `https://us-central1-ind-lmt.cloudfunctions.net/intake`
Health check: `https://us-central1-ind-lmt.cloudfunctions.net/health`

---

## Relationship to the other forks

| Fork | Firebase project | Brand colour |
|---|---|---|
| Bobcat of Houston | `hou-crm` | `#ff3300` orange |
| Berry Material Handling | `bmh-crm` | `#feb703` amber |
| Bobcat of Atlanta (parent) | `atl-lmt` | `#ff3300` orange |
| **Bobcat of Indy** | `ind-lmt` | `#ff3300` orange |

Brand-agnostic fixes should be ported between them by diffing `src/App.jsx`. The
deliberate differences from Atlanta are listed in `SETUP.md`.

**Watch the colour rules when porting.** White on `#ff3300` measures 3.67:1, below
the 4.5:1 AA threshold for normal text, so **text-bearing surfaces here use
`bg-brand-600` (`#d62b00`, 4.99:1) with `text-white`**, and `brand-500` is reserved
for fills with no small text on them. Atlanta does the same; Houston puts white
directly on `brand-500`; BMH's amber is the opposite and carries `text-stone-900`
on every brand fill. Run `node scripts/verify-invariants.mjs` after any palette
change.
