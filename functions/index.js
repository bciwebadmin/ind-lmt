// functions/index.js
// Cloud Functions for Bobcat of Indy LMT.
//
// Currently provides:
//   - intake:                  HTTP endpoint for Zapier (or any other webhook source) to push new leads
//   - onLeadAssignmentChange:  Firestore trigger that emails a rep when a lead is assigned to them
//   - health:                  Simple uptime check
//
// To add later:
//   - approveAccessRequest:    Creates Firebase Auth users when admins approve a request
//   - assignByZip:             Triggered on lead create; auto-assigns based on ZIP→branch mapping

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { Resend } = require('resend');
const { nearestBranchForZip } = require('./branchRouting');

admin.initializeApp();
const db = admin.firestore();

// Shared secret for Zapier authorization. Set via:
//   firebase functions:secrets:set INTAKE_SECRET
const INTAKE_SECRET   = defineSecret('INTAKE_SECRET');

// Resend API key for sending email notifications. Set via:
//   firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY  = defineSecret('RESEND_API_KEY');

// Configurable sender + CRM URL. These can be overridden without redeploying:
//   firebase functions:config:set ...      (legacy)
// Or just edit and redeploy. For now they're set with sensible defaults that you can
// change in Firebase Console under Functions -> Configuration after first deploy.
const EMAIL_FROM = defineString('EMAIL_FROM', {
  default: 'Bobcat of Indy LMT <leads@ind-lmt.web.app>',
  description: 'The "From" address for assignment-notification emails. Must be a verified Resend sender. Set the real value in functions/.env.ind-lmt.'
});

const CRM_URL = defineString('CRM_URL', {
  default: 'https://ind-lmt.web.app',
  description: 'Base URL of the deployed LMT (used in email "View Lead" links). Set the real value in functions/.env.ind-lmt.'
});

/* ===================== HELPERS ===================== */

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeEmail(e) {
  return (e || '').trim().toLowerCase();
}

function normalizePhone(p) {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function getMatchedOn(existing, candidate) {
  const matches = [];
  const cEmail = normalizeEmail(candidate.contactEmail);
  const eEmail = normalizeEmail(existing.contactEmail);
  if (cEmail && cEmail === eEmail) matches.push('email');
  const cPhone = normalizePhone(candidate.phone);
  const ePhone = normalizePhone(existing.phone);
  if (cPhone && cPhone.length >= 7 && cPhone === ePhone) matches.push('phone');
  return matches;
}

async function findDuplicate(candidate, withinDays = 90) {
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();
  const snap = await db.collection('leads')
    .where('createdDate', '>=', cutoff)
    .get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const matchedOn = getMatchedOn(data, candidate);
    if (matchedOn.length > 0) {
      return { id: doc.id, data, matchedOn };
    }
  }
  return null;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

/* ===================== INTAKE ENDPOINT ===================== */

exports.intake = onRequest(
  { secrets: [INTAKE_SECRET], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    const auth = req.headers.authorization || '';
    const expected = `Bearer ${INTAKE_SECRET.value()}`;
    if (auth !== expected) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const body = req.body || {};
    const hasContact = !!(body.contactEmail || body.phone);
    const hasCompany = !!(body.companyName || body.company || body.businessName || body.organization);
    if (!body.customerName && !hasCompany && !hasContact) {
      return res.status(400).json({
        ok: false,
        error: 'Lead must include at least customerName/companyName or contactEmail/phone'
      });
    }

    const now = new Date().toISOString();
    const sourceLabel = body.leadSource || 'Google Sheet';

    const candidate = {
      customerName: (body.customerName || '').toString().trim(),
      // Zapier form fields aren't consistently named across sites — accept the
      // usual spellings so a mis-mapped Zap doesn't silently drop the company.
      companyName:  (body.companyName || body.company || body.businessName || body.organization || '').toString().trim(),
      contactEmail: (body.contactEmail || '').toString().trim(),
      phone:        (body.phone        || '').toString().trim(),
      comment:      (body.comment      || '').toString(),
      branch:       (body.branch       || '').toString().trim(),
      department:   (body.department   || '').toString().trim(),
      zip:          (body.zip          || '').toString().trim(),
      formTitle:    (body.formTitle    || '').toString().trim(),
      dateSubmitted: body.dateSubmitted || now,
      createdDate:   now,
      leadSource:    sourceLabel,
      status:        body.status || 'New',
      statusChangedAt: now,   // when the current status was set; see getStatusChangedAt() in App.jsx
      assignedTo:    'u_1',
      dateAssigned:  null,
      internalComments: [],
      history: [{
        id: uid('h'),
        type: 'created',
        timestamp: now,
        actor: null,
        source: sourceLabel,
        viaIntake: true
      }]
    };

    // Safety guard: if no branch was provided but we have a ZIP, infer the closest one.
    // If the caller explicitly sent a branch, respect it (don't override).
    if (!candidate.branch && candidate.zip) {
      // Constrain to the branches that actually exist in Settings. Without this
      // the router can return a branch name from its own tables that this
      // deployment has never heard of — the lead is then stored with a branch
      // no routing entry matches, and it silently falls through to Unassigned.
      // App.jsx has always passed config.branches here; intake did not.
      const appConfig = await getAppConfig();
      const availableBranches = Array.isArray(appConfig.branches) ? appConfig.branches : [];
      // Empty list means "no branch is valid here", NOT "anything goes". On a
      // fresh project config/app does not exist until Settings is first saved,
      // and passing null there would let the router answer unconstrained.
      const routed = availableBranches.length
        ? nearestBranchForZip(candidate.zip, availableBranches)
        : null;
      if (routed) {
        candidate.branch = routed.branch;
        // Record the auto-routing in history for traceability
        candidate.history[0].autoBranchRouted = {
          fromZip: candidate.zip,
          toBranch: routed.branch,
          approxDistanceMiles: routed.distanceMiles
        };
        console.log(`[intake] Auto-routed ZIP ${candidate.zip} → ${routed.branch} (~${routed.distanceMiles} mi)`);
      } else {
        console.log(`[intake] No branch suggestion for ZIP ${candidate.zip} — leaving blank`);
      }
    }

    // Lead Routing: location + department decides the owner. Only assigns when
    // routing resolves to a real available user; otherwise the lead stays with
    // u_1 and onLeadCreate falls back to the Settings "New Leads" list.
    try {
      const routing = await resolveLeadRouting({
        branch: candidate.branch,
        department: candidate.department
      });
      if (routing.matched) {
        candidate.assignedTo = routing.assigneeId;
        candidate.dateAssigned = now;
        // Optional. Shows the lead in this person's My Open too, without making
        // them the owner — Reports still counts it against the primary.
        candidate.secondaryAssignedTo = routing.secondaryId || '';
        candidate.history[0].autoAssigned = {
          via: 'lead-routing',
          branch: candidate.branch,
          department: candidate.department,
          assigneeId: routing.assigneeId,
          secondaryId: routing.secondaryId || null
        };
        console.log(`[intake] Routed ${candidate.branch}/${candidate.department} -> ${routing.assigneeId}`);
      } else {
        candidate.history[0].routingFallback = routing.reason;
        console.log(`[intake] No routing match (${routing.reason}) — leaving unassigned`);
      }
    } catch (routeErr) {
      // Routing must never block intake. A lead that lands unassigned is
      // recoverable; a lead that never lands is not.
      console.error('[intake] Routing lookup failed — leaving unassigned:', routeErr);
    }

    try {
      const dup = await findDuplicate(candidate, 90);

      if (dup) {
        const event = {
          id: uid('h'),
          type: 'resubmission',
          timestamp: now,
          actor: null,
          source: sourceLabel,
          formTitle: candidate.formTitle,
          newComment: candidate.comment,
          matchedOn: dup.matchedOn
        };

        // System-generated internal note so reps see the resubmission in the notes
        // timeline without having to scroll through the history events.
        const noteLines = [];
        noteLines.push(`Customer resubmitted via ${sourceLabel}${candidate.formTitle ? ` (${candidate.formTitle})` : ''}.`);
        noteLines.push(`Matched on: ${dup.matchedOn.join(', ')}`);
        if (candidate.comment) {
          noteLines.push('');
          noteLines.push('New comment:');
          noteLines.push(candidate.comment);
        }
        const systemNote = {
          id: uid('n'),
          author: 'system',
          authorName: 'Resubmission',
          text: noteLines.join('\n'),
          timestamp: now,
          isSystem: true
        };

        await db.collection('leads').doc(dup.id).update({
          dateSubmitted: now,
          history: admin.firestore.FieldValue.arrayUnion(event),
          internalComments: admin.firestore.FieldValue.arrayUnion(systemNote)
        });

        // Best-effort: notify the assigned rep that the customer reached out again
        try {
          const assignee = dup.data?.assignedTo;
          if (assignee && assignee !== 'u_1') {
            const repDoc = await db.collection('users').doc(assignee).get();
            if (repDoc.exists && repDoc.data().email) {
              const rep = repDoc.data();
              const leadUrl = `${CRM_URL.value()}?lead=${encodeURIComponent(dup.id)}`;
              const html = buildResubmissionEmailHtml({
                rep,
                lead: dup.data,
                newComment: candidate.comment,
                sourceLabel,
                formTitle: candidate.formTitle,
                matchedOn: dup.matchedOn,
                leadUrl
              });
              const subject = `Lead resubmission: ${dup.data.customerName || 'Unnamed'}`;
              const resend = new Resend(RESEND_API_KEY.value());
              const result = await resend.emails.send({
                from: EMAIL_FROM.value(),
                to: rep.email,
                subject,
                html
              });
              if (result.error) {
                console.error(`[intake/resubmission] Resend error for ${rep.email}:`, result.error);
              } else {
                console.log(`[intake/resubmission] Email sent to ${rep.email} for lead ${dup.id}`);
              }
            }
          } else {
            console.log(`[intake/resubmission] Lead ${dup.id} is unassigned — no email`);
          }
        } catch (mailErr) {
          // Don't fail the whole intake request just because email failed
          console.error('[intake/resubmission] Email step failed:', mailErr);
        }

        return res.json({
          ok: true, action: 'linked',
          leadId: dup.id, matchedOn: dup.matchedOn
        });
      }

      const newRef = await db.collection('leads').add(candidate);
      return res.json({ ok: true, action: 'created', leadId: newRef.id });

    } catch (err) {
      console.error('intake error:', err);
      return res.status(500).json({ ok: false, error: 'Internal error' });
    }
  }
);

/* ===================== ASSIGNMENT EMAIL ===================== */

/**
 * Build the HTML body for the assignment-notification email.
 * Uses inline styles since most email clients ignore <style> blocks.
 */
function buildAssignmentEmailHtml({ rep, lead, leadUrl, score }) {
  const safeName    = escapeHtml(lead.customerName || 'Unnamed Lead');
  const safeCompany = escapeHtml(lead.companyName || '');
  const safeEmail   = escapeHtml(lead.contactEmail || '');
  const safePhone   = escapeHtml(lead.phone || '');
  const safeBranch  = escapeHtml(lead.branch || '');
  const safeZip     = escapeHtml(lead.zip || '');
  const safeSource  = escapeHtml(lead.leadSource || '');
  const safeComment = escapeHtml(lead.comment || '');
  const safeStatus  = escapeHtml(lead.status || 'New');
  const submittedAt = escapeHtml(fmtDateTime(lead.dateSubmitted));
  const repName     = escapeHtml(rep.name || 'there');

  // Heat tier color
  const tierColors = {
    Urgent: { bg: '#ffece5', text: '#851a00' },
    Warm: { bg: '#fef3c7', text: '#92400e' },
    Cool: { bg: '#dbeafe', text: '#1e40af' },
    Cold: { bg: '#f1f5f9', text: '#475569' }
  };
  const heat = tierColors[score?.tier] || tierColors.Cool;

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background-color: #1c1917; padding: 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 12px;">
                  <div style="width: 36px; height: 36px; background-color: #ff3300; display: inline-block; text-align: center; line-height: 36px; font-size: 22px; font-weight: 800; color: #ffffff; border-radius: 4px;">B</div>
                </td>
                <td>
                  <div style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.5px;">BOBCAT OF INDY</div>
                  <div style="color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 1px;">LMT Notification</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding: 28px 28px 12px;">
            <div style="font-size: 22px; font-weight: 700; color: #1c1917;">A new lead is yours</div>
            <div style="font-size: 14px; color: #57534e; margin-top: 4px;">Hi ${repName}, you've been assigned a lead. Here are the details:</div>
          </td>
        </tr>

        <!-- Lead summary card -->
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;">
              <tr>
                <td style="padding: 18px 20px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td style="font-size: 18px; font-weight: 700; color: #1c1917;">${safeName}${safeCompany ? `<div style="font-size: 13px; font-weight: 500; color: #57534e; margin-top: 2px;">${safeCompany}</div>` : ''}</td>
                      ${score ? `<td align="right">
                        <span style="display: inline-block; background-color: ${heat.bg}; color: ${heat.text}; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px;">🚨 ${escapeHtml(score.tier)} · ${score.total}</span>
                      </td>` : ''}
                    </tr>
                  </table>

                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 14px;">
                    ${safeEmail ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Email</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;"><a href="mailto:${safeEmail}" style="color: #1c1917; text-decoration: none;">${safeEmail}</a></td>
                    </tr>` : ''}
                    ${safePhone ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Phone</td>
                      <td style="font-size: 14px; color: #1c1917; font-family: 'SF Mono', Menlo, monospace; padding: 3px 0;"><a href="tel:${safePhone}" style="color: #1c1917; text-decoration: none;">${safePhone}</a></td>
                    </tr>` : ''}
                    ${safeBranch ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Branch</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${safeBranch}${safeZip ? ` <span style="color: #78716c; font-family: 'SF Mono', Menlo, monospace;">· ZIP ${safeZip}</span>` : ''}</td>
                    </tr>` : ''}
                    ${safeSource ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Source</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${safeSource}</td>
                    </tr>` : ''}
                    <tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Status</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${safeStatus}</td>
                    </tr>
                    ${submittedAt ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Submitted</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${submittedAt}</td>
                    </tr>` : ''}
                  </table>

                  ${safeComment ? `<div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e7e5e4;">
                    <div style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Customer Comment</div>
                    <div style="font-size: 14px; color: #1c1917; line-height: 1.5; white-space: pre-wrap;">${safeComment}</div>
                  </div>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${leadUrl}" style="display: inline-block; background-color: #d62b00; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;">View Lead in LMT →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 20px 28px 28px; text-align: center; color: #a8a29e; font-size: 11px;">
            You received this email because a lead was assigned to you in the Bobcat of Indy LMT.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Read a notification recipient list out of config/app.
 * Returns [] when unset or malformed — callers treat empty as "feature off",
 * so a missing config can never cause a send to the wrong place.
 */
/* ===================== LEAD ROUTING ===================== */
// Mirrors routingKey() in App.jsx. The UI writes these keys; this reads them.
// If one side changes, change both — there is no shared module between them.
const routingKey = (branch, department) => `${branch}::${department}`;

async function getAppConfig() {
  try {
    const doc = await db.collection('config').doc('app').get();
    return doc.exists ? (doc.data() || {}) : {};
  } catch (err) {
    console.error('[routing] Failed to read config/app:', err);
    return {};
  }
}

/**
 * Work out who a lead belongs to, from the Lead Routing tab.
 *
 * Routing only "matches" when it can produce a real assignee. A configured CC
 * list with no primary is not enough — the lead would sit unowned while people
 * were told it had been handled. In that case we fall back, which is noisier but
 * honest.
 *
 * Returns { matched, assigneeId, secondaryId, ccEmails, reason }.
 */
async function resolveLeadRouting({ branch, department }) {
  const no = (reason) => ({ matched: false, assigneeId: null, secondaryId: null, ccEmails: [], reason });

  if (!branch)     return no('no-branch');
  if (!department) return no('no-department');

  const config = await getAppConfig();
  const table = config.leadRouting || {};

  // Exact key first; fall back to a case-insensitive department match so a form
  // sending "service" instead of "Service" still routes.
  let entry = table[routingKey(branch, department)];
  if (!entry) {
    const wanted = routingKey(branch, department).toLowerCase();
    const hit = Object.keys(table).find(k => k.toLowerCase() === wanted);
    if (hit) entry = table[hit];
  }
  if (!entry) return no('no-routing-entry');

  const primaryId = (entry.primaryUserId || '').trim();
  if (!primaryId) return no('no-primary-set');

  // The primary must still be a real, available user. Someone deleted or put on
  // leave after being configured here would otherwise silently own the lead.
  let userDoc;
  try {
    userDoc = await db.collection('users').doc(primaryId).get();
  } catch (err) {
    console.error('[routing] Failed to load primary user', primaryId, err);
    return no('primary-lookup-failed');
  }
  if (!userDoc.exists) return no('primary-user-missing');
  const user = userDoc.data() || {};
  if (user.onLeaveOfAbsence) return no('primary-on-leave');

  // Local Backup is a user now, not an email. They get the lead in their My Open
  // and are CC'd — but only if the account still resolves. An unavailable backup
  // is dropped rather than blocking the whole route, since the primary is the one
  // who actually owns the lead.
  let secondaryId = null;
  let secondaryEmail = null;
  const backupId = (entry.backupUserId || '').trim();
  if (backupId && backupId !== primaryId) {
    try {
      const backupDoc = await db.collection('users').doc(backupId).get();
      if (backupDoc.exists) {
        const backup = backupDoc.data() || {};
        if (!backup.onLeaveOfAbsence) {
          secondaryId = backupId;
          if (backup.email) secondaryEmail = backup.email;
        } else {
          console.log(`[routing] Backup ${backupId} is on leave — skipping secondary`);
        }
      }
    } catch (err) {
      console.error('[routing] Failed to load backup user', backupId, err);
    }
  }

  const ccEmails = [secondaryEmail, entry.cc1, entry.cc2, entry.cc3]
    .map(e => (e || '').trim())
    .filter(e => e && e.includes('@'));

  return { matched: true, assigneeId: primaryId, secondaryId, ccEmails, reason: 'routed' };
}

async function getNotificationRecipients(key) {
  try {
    const configDoc = await db.collection('config').doc('app').get();
    const list = configDoc.exists ? configDoc.data()?.notifications?.[key] : null;
    if (!Array.isArray(list)) return [];
    return list
      .filter(e => typeof e === 'string' && e.includes('@'))
      .map(e => e.trim())
      .filter(Boolean);
  } catch (err) {
    console.error(`[notify] Failed to read config/app.notifications.${key}:`, err);
    return [];
  }
}

/**
 * Is the new-lead alert switched on? Defaults to ON when the flag is absent, so
 * adding recipients is enough to start receiving them.
 */
async function newLeadAlertsEnabled() {
  try {
    const configDoc = await db.collection('config').doc('app').get();
    const v = configDoc.exists ? configDoc.data()?.notifications?.newLeadAlertsEnabled : undefined;
    return v !== false;
  } catch {
    return true;
  }
}

/**
 * Digest email for a CSV import. Same shell as the other templates, but a tally
 * rather than a single lead.
 */
function buildImportSummaryEmailHtml({ total, unassignedCount, importerName, rowsHtml, crmUrl }) {
  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background-color: #1c1917; padding: 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 12px;">
                  <div style="width: 36px; height: 36px; background-color: #ff3300; display: inline-block; text-align: center; line-height: 36px; font-size: 22px; font-weight: 800; color: #ffffff; border-radius: 4px;">B</div>
                </td>
                <td>
                  <div style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.5px;">BOBCAT OF INDY</div>
                  <div style="color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 1px;">LMT Notification</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding: 28px 28px 12px;">
            <div style="font-size: 22px; font-weight: 700; color: #1c1917;">${total} lead${total === 1 ? '' : 's'} imported</div>
            <div style="font-size: 14px; color: #57534e; margin-top: 4px;">${importerName} imported a CSV into the LMT. ${unassignedCount} of them ${unassignedCount === 1 ? 'is' : 'are'} unassigned and ${unassignedCount === 1 ? 'needs' : 'need'} an owner.</div>
          </td>
        </tr>

        <!-- Branch tally -->
        ${rowsHtml ? `<tr>
          <td style="padding: 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;">
              <tr>
                <td style="padding: 18px 20px;">
                  <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #78716c; font-weight: 700; padding-bottom: 8px;">By branch</div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${rowsHtml}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ''}

        <!-- CTA -->
        <tr>
          <td style="padding: 24px 28px 28px; text-align: center;">
            <a href="${crmUrl}" style="display: inline-block; background-color: #d62b00; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;">Open the LMT &rarr;</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 0 28px 28px; text-align: center; color: #a8a29e; font-size: 11px;">
            You received this email because you are on the new-lead notification list for the Bobcat of Indy LMT. To change recipients, sign in and visit Settings.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildNewLeadEmailHtml({ lead, leadUrl, score }) {
  const safeName    = escapeHtml(lead.customerName || 'Unnamed Lead');
  const safeCompany = escapeHtml(lead.companyName || '');
  const safeEmail   = escapeHtml(lead.contactEmail || '');
  const safePhone   = escapeHtml(lead.phone || '');
  const safeBranch  = escapeHtml(lead.branch || '');
  const safeZip     = escapeHtml(lead.zip || '');
  const safeSource  = escapeHtml(lead.leadSource || '');
  const safeComment = escapeHtml(lead.comment || '');
  const safeStatus  = escapeHtml(lead.status || 'New');
  const submittedAt = escapeHtml(fmtDateTime(lead.dateSubmitted));

  // Heat tier color
  const tierColors = {
    Urgent: { bg: '#ffece5', text: '#851a00' },
    Warm: { bg: '#fef3c7', text: '#92400e' },
    Cool: { bg: '#dbeafe', text: '#1e40af' },
    Cold: { bg: '#f1f5f9', text: '#475569' }
  };
  const heat = tierColors[score?.tier] || tierColors.Cool;

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background-color: #1c1917; padding: 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 12px;">
                  <div style="width: 36px; height: 36px; background-color: #ff3300; display: inline-block; text-align: center; line-height: 36px; font-size: 22px; font-weight: 800; color: #ffffff; border-radius: 4px;">B</div>
                </td>
                <td>
                  <div style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.5px;">BOBCAT OF INDY</div>
                  <div style="color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 1px;">LMT Notification</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding: 28px 28px 12px;">
            <div style="font-size: 22px; font-weight: 700; color: #1c1917;">New lead needs assigning</div>
            <div style="font-size: 14px; color: #57534e; margin-top: 4px;">A lead just came into the LMT and has not been assigned to anyone yet.</div>
          </td>
        </tr>

        <!-- Lead summary card -->
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;">
              <tr>
                <td style="padding: 18px 20px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td style="font-size: 18px; font-weight: 700; color: #1c1917;">${safeName}${safeCompany ? `<div style="font-size: 13px; font-weight: 500; color: #57534e; margin-top: 2px;">${safeCompany}</div>` : ''}</td>
                      ${score ? `<td align="right">
                        <span style="display: inline-block; background-color: ${heat.bg}; color: ${heat.text}; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px;">🚨 ${escapeHtml(score.tier)} · ${score.total}</span>
                      </td>` : ''}
                    </tr>
                  </table>

                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 14px;">
                    ${safeEmail ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Email</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;"><a href="mailto:${safeEmail}" style="color: #1c1917; text-decoration: none;">${safeEmail}</a></td>
                    </tr>` : ''}
                    ${safePhone ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Phone</td>
                      <td style="font-size: 14px; color: #1c1917; font-family: 'SF Mono', Menlo, monospace; padding: 3px 0;"><a href="tel:${safePhone}" style="color: #1c1917; text-decoration: none;">${safePhone}</a></td>
                    </tr>` : ''}
                    ${safeBranch ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Branch</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${safeBranch}${safeZip ? ` <span style="color: #78716c; font-family: 'SF Mono', Menlo, monospace;">· ZIP ${safeZip}</span>` : ''}</td>
                    </tr>` : ''}
                    ${safeSource ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Source</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${safeSource}</td>
                    </tr>` : ''}
                    <tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Status</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${safeStatus}</td>
                    </tr>
                    ${submittedAt ? `<tr>
                      <td width="80" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Submitted</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${submittedAt}</td>
                    </tr>` : ''}
                  </table>

                  ${safeComment ? `<div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e7e5e4;">
                    <div style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Customer Comment</div>
                    <div style="font-size: 14px; color: #1c1917; line-height: 1.5; white-space: pre-wrap;">${safeComment}</div>
                  </div>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${leadUrl}" style="display: inline-block; background-color: #d62b00; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;">Assign this lead →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 20px 28px 28px; text-align: center; color: #a8a29e; font-size: 11px;">
            You received this email because you are on the new-lead notification list for the Bobcat of Indy LMT. To change recipients, sign in and visit Settings.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Service-area scoring rules, read from config/app.
 *
 * Stored config REPLACES the client defaults rather than merging, so every
 * field needs a fallback here — see CLAUDE.md. The field name
 * `texasPrefixes` is deliberately stale and holds Indiana
 * prefixes; renaming it would need a Firestore migration.
 */
const FALLBACK_SERVICE_AREA = {
  primaryPrefixes:  ['46', '47'],
  adjacentPrefixes: ['60', '61', '62', '43', '44', '45', '40', '41', '42', '48', '49'],
  primaryPoints: 25,
  adjacentPoints: 12,
  otherPoints: 5
};

async function getServiceAreaRules() {
  try {
    const doc = await db.collection('config').doc('app').get();
    const sa = (doc.exists && doc.data().scoringRules && doc.data().scoringRules.serviceArea) || {};
    const list = (v, fb) => (Array.isArray(v) && v.length ? v.map(String) : fb);
    const num  = (v, fb) => (typeof v === 'number' ? v : fb);
    return {
      primaryPrefixes:  list(sa.texasPrefixes,    FALLBACK_SERVICE_AREA.primaryPrefixes),
      adjacentPrefixes: list(sa.adjacentPrefixes, FALLBACK_SERVICE_AREA.adjacentPrefixes),
      primaryPoints:    num(sa.texasPoints,       FALLBACK_SERVICE_AREA.primaryPoints),
      adjacentPoints:   num(sa.adjacentPoints,    FALLBACK_SERVICE_AREA.adjacentPoints),
      otherPoints:      num(sa.otherPoints,       FALLBACK_SERVICE_AREA.otherPoints)
    };
  } catch (err) {
    console.error('[score] Failed to read config/app.scoringRules.serviceArea:', err);
    return FALLBACK_SERVICE_AREA;
  }
}

/**
 * Simple lead-scoring helper for the email — replicates the client's basic Urgent/Warm/Cool/Cold tiering.
 * We pass through the lead's existing score data if we want to, but for now we compute a coarse tier
 * from comment length + service area to keep this function self-contained.
 *
 * For a more accurate score, store the lead's score in Firestore when it's computed client-side
 * and read it here.
 */
async function quickScore(lead) {
  let total = 0;
  // Service area — read from config/app so the email agrees with the app.
  // Previously this hardcoded a ZIP regex, which silently disagreed with
  // Settings whenever the territory changed.
  const sa = await getServiceAreaRules();
  const zip = lead.zip ? String(lead.zip).trim().replace(/[^0-9]/g, '') : '';
  if (zip.length >= 5) {
    const prefix = zip.slice(0, 2);
    if (sa.primaryPrefixes.includes(prefix))       total += sa.primaryPoints;
    else if (sa.adjacentPrefixes.includes(prefix)) total += sa.adjacentPoints;
    else                                            total += sa.otherPoints;
  }
  // Comment quality
  if (lead.comment) {
    const len = lead.comment.length;
    if (len > 100) total += 25;
    else if (len > 30) total += 15;
    else if (len > 0) total += 5;
  }
  // Has contact
  if (lead.contactEmail) total += 10;
  if (lead.phone) total += 10;
  // Branch
  if (lead.branch) total += 10;

  const tier = total >= 70 ? 'Urgent' : total >= 50 ? 'Warm' : total >= 30 ? 'Cool' : 'Cold';
  return { total, tier };
}

/**
 * Shared helper: look up assignee, score lead, send assignment email via Resend.
 * Used by both onLeadAssignmentChange (reassignment) and onLeadCreate (new-with-assignment).
 */
async function sendAssignmentNotification({ lead, leadId, assigneeId, logTag, ccEmails = [] }) {
  // Look up the rep's profile
  let repDoc;
  try {
    repDoc = await db.collection('users').doc(assigneeId).get();
  } catch (err) {
    console.error(`[${logTag}] Failed to fetch user ${assigneeId}:`, err);
    return;
  }
  if (!repDoc.exists) {
    console.log(`[${logTag}] No user profile for ${assigneeId} — skipping email`);
    return;
  }
  const rep = repDoc.data();
  if (!rep.email) {
    console.log(`[${logTag}] User ${assigneeId} has no email — skipping`);
    return;
  }

  // Compose
  const score = await quickScore(lead);
  const leadUrl = `${CRM_URL.value()}?lead=${encodeURIComponent(leadId)}`;
  const html = buildAssignmentEmailHtml({ rep, lead, leadUrl, score });
  const subject = `New lead assigned: ${lead.customerName || 'Unnamed'}`;

  // Send via Resend
  try {
    const resend = new Resend(RESEND_API_KEY.value());
    const result = await resend.emails.send({
      from: EMAIL_FROM.value(),
      to: rep.email,
      // Local Backup and CC1-3 from the Lead Routing tab. Real CC, not BCC — the
      // team should be able to see who else is on it and reply-all.
      ...(ccEmails.length > 0 ? { cc: ccEmails.filter(e => e !== rep.email) } : {}),
      subject,
      html
    });
    if (result.error) {
      console.error(`[${logTag}] Resend error for ${rep.email}:`, result.error);
    } else {
      console.log(`[${logTag}] Email sent to ${rep.email}${ccEmails.length ? ` (cc ${ccEmails.length})` : ''} for lead ${leadId}`);
    }
  } catch (err) {
    console.error(`[${logTag}] Failed to send email to ${rep.email}:`, err);
  }
}

/**
 * Firestore trigger: fires whenever a lead document is updated.
 * Sends an email to the new assignee when:
 *   - assignedTo changed
 *   - new assignee is a real user (not u_1 / Unassigned)
 *   - this isn't part of a bulk reassignment (bulkReassignment flag in history)
 *   - assignee != actor (the user who made the change) — skip self-assignment
 *   - assignee has an email on their Firestore profile
 */
exports.onLeadAssignmentChange = onDocumentUpdated(
  {
    document: 'leads/{leadId}',
    secrets: [RESEND_API_KEY],
    region: 'us-south1'
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    const leadId = event.params.leadId;
    if (!before || !after) return;

    // Did assignedTo change?
    if (before.assignedTo === after.assignedTo) {
      return;
    }

    // Is the new assignee a real user?
    if (!after.assignedTo || after.assignedTo === 'u_1') {
      console.log(`[assignment] Lead ${leadId} unassigned — skipping email`);
      return;
    }

    // Find the actor (whoever made the change) via the most recent assignment_change event
    const history = after.history || [];
    const lastAssignmentChange = [...history]
      .reverse()
      .find(h => h.type === 'assignment_change');
    const actorId = lastAssignmentChange?.actor || null;

    // Skip if this was a bulk reassignment (e.g. user deletion) — a separate summary email is sent
    if (lastAssignmentChange?.bulkReassignment) {
      console.log(`[assignment] Lead ${leadId} was bulk-reassigned — skipping per-lead email (summary sent separately)`);
      return;
    }

    // Skip self-assignment
    if (actorId && actorId === after.assignedTo) {
      console.log(`[assignment] Lead ${leadId} self-assigned by ${actorId} — skipping email`);
      return;
    }

    await sendAssignmentNotification({
      lead: after,
      leadId,
      assigneeId: after.assignedTo,
      logTag: 'assignment'
    });
  }
);

/**
 * Firestore trigger: fires when a new lead is created.
 * Sends an assignment email when the lead is created with a real user already assigned
 * (e.g. admin manually adds a lead and picks an assignee on the form).
 *
 * Skipped when:
 *   - assignedTo is empty or 'u_1' (Unassigned)
 *   - the lead came in via the intake endpoint (Zapier) — those auto-assign to u_1 anyway
 *   - this lead is part of a bulk import (bulkImport flag in history)
 *   - the creator assigned the lead to themselves
 */
/**
 * "A new lead is in the tool and needs assigning" — distinct from the assignment
 * email, which goes to one rep after somebody has been chosen. This one goes to a
 * configured list the moment an UNASSIGNED lead lands, which is every lead that
 * arrives via the Zapier intake webhook.
 */
async function sendNewLeadAlert({ lead, leadId, logTag }) {
  if (!(await newLeadAlertsEnabled())) {
    console.log(`[${logTag}] New-lead alerts disabled in Settings — skipping`);
    return;
  }
  const recipients = await getNotificationRecipients('newLeadEmails');
  if (recipients.length === 0) {
    console.log(`[${logTag}] No new-lead recipients configured — skipping`);
    return;
  }

  const score = await quickScore(lead);
  const leadUrl = `${CRM_URL.value()}?lead=${encodeURIComponent(leadId)}`;
  const html = buildNewLeadEmailHtml({ lead, leadUrl, score });
  const subject = `New lead to assign: ${lead.customerName || 'Unnamed'}`;

  try {
    const resend = new Resend(RESEND_API_KEY.value());
    const result = await resend.emails.send({
      from: EMAIL_FROM.value(),
      to: recipients,
      subject,
      html
    });
    if (result.error) {
      console.error(`[${logTag}] Resend error for new-lead alert:`, result.error);
    } else {
      console.log(`[${logTag}] New-lead alert sent to ${recipients.length} recipient(s) for lead ${leadId}`);
    }
  } catch (err) {
    console.error(`[${logTag}] Failed to send new-lead alert:`, err);
  }
}

exports.onLeadCreate = onDocumentCreated(
  {
    document: 'leads/{leadId}',
    secrets: [RESEND_API_KEY],
    region: 'us-south1'
  },
  async (event) => {
    const lead = event.data?.data();
    const leadId = event.params.leadId;
    if (!lead) return;

    const history = lead.history || [];
    const createdEvent = history.find(h => h.type === 'created');

    // Unassigned lead — nobody to send an assignment email to. This is where the
    // "needs assigning" alert goes instead. Bulk imports are excluded; the client
    // sends a single summary email for those (see sendImportSummaryEmail).
    if (!lead.assignedTo || lead.assignedTo === 'u_1') {
      if (createdEvent?.viaImport) {
        console.log(`[create] Lead ${leadId} unassigned via bulk import — summary email covers it`);
        return;
      }
      console.log(`[create] Lead ${leadId} created unassigned — sending new-lead alert`);
      await sendNewLeadAlert({ lead, leadId, logTag: 'create' });
      return;
    }

    // NOTE: intake leads are no longer skipped here. Before Lead Routing they
    // always arrived as u_1 and were caught by the unassigned branch above; now
    // intake can assign an owner, and that owner needs telling.

    // Skip if this is part of a bulk CSV import — prevents email floods on imports
    if (createdEvent?.viaImport) {
      console.log(`[create] Lead ${leadId} created via bulk import — skipping email`);
      return;
    }

    // Skip self-assignment at creation time — someone who just keyed in a lead and
    // put their own name on it does not need an email about it. Routing-assigned
    // leads have no actor, so this never suppresses them.
    const actorId = createdEvent?.actor || null;
    if (actorId && actorId === lead.assignedTo) {
      console.log(`[create] Lead ${leadId} self-assigned at creation by ${actorId} — skipping email`);
      return;
    }

    // Pull the Local Backup and CCs for this location+department so the wider team
    // is copied, not just the assignee. Routing failing here must not stop the
    // assignee being told, so an empty cc list is a fine outcome.
    let ccEmails = [];
    try {
      const routing = await resolveLeadRouting({
        branch: lead.branch,
        department: lead.department
      });
      if (routing.matched) ccEmails = routing.ccEmails;
    } catch (err) {
      console.error(`[create] Could not resolve routing CCs for ${leadId}:`, err);
    }

    await sendAssignmentNotification({
      lead,
      leadId,
      assigneeId: lead.assignedTo,
      logTag: 'create',
      ccEmails
    });
  }
);

/* ===================== ACCESS REQUEST NOTIFICATIONS ===================== */

// Hardcoded fallback if Firestore config has no notification recipients set.
// Admins can override this through the Settings → Notifications panel.
const DEFAULT_ACCESS_REQUEST_EMAILS = ['webadmin@berrycompaniesinc.com'];

/**
 * Build the HTML body for the access request notification email.
 */
function buildAccessRequestEmailHtml({ request, crmUrl }) {
  const safeName    = escapeHtml(request.name || 'Unknown');
  const safeEmail   = escapeHtml(request.email || '');
  const safeReason  = escapeHtml(request.reason || '');
  const requestedAt = escapeHtml(fmtDateTime(request.requestedAt));
  const reviewUrl   = `${crmUrl}?view=users`;

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background-color: #1c1917; padding: 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 12px;">
                  <div style="width: 36px; height: 36px; background-color: #ff3300; display: inline-block; text-align: center; line-height: 36px; font-size: 22px; font-weight: 800; color: #ffffff; border-radius: 4px;">B</div>
                </td>
                <td>
                  <div style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.5px;">BOBCAT OF INDY</div>
                  <div style="color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 1px;">LMT Access Request</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding: 28px 28px 12px;">
            <div style="font-size: 22px; font-weight: 700; color: #1c1917;">New access request</div>
            <div style="font-size: 14px; color: #57534e; margin-top: 4px;">${safeName} has requested access to the LMT. Review and approve or deny below.</div>
          </td>
        </tr>

        <!-- Request summary card -->
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;">
              <tr>
                <td style="padding: 18px 20px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="90" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Name</td>
                      <td style="font-size: 15px; color: #1c1917; font-weight: 600; padding: 3px 0;">${safeName}</td>
                    </tr>
                    <tr>
                      <td width="90" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Email</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;"><a href="mailto:${safeEmail}" style="color: #1c1917; text-decoration: none;">${safeEmail}</a></td>
                    </tr>
                    ${requestedAt ? `<tr>
                      <td width="90" style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; padding: 3px 0;">Requested</td>
                      <td style="font-size: 14px; color: #1c1917; padding: 3px 0;">${requestedAt}</td>
                    </tr>` : ''}
                  </table>

                  ${safeReason ? `<div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e7e5e4;">
                    <div style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Reason given</div>
                    <div style="font-size: 14px; color: #1c1917; line-height: 1.5; white-space: pre-wrap;">${safeReason}</div>
                  </div>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${reviewUrl}" style="display: inline-block; background-color: #d62b00; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;">Review Request in LMT →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 20px 28px 28px; text-align: center; color: #a8a29e; font-size: 11px;">
            You're receiving this because you're configured to receive access request notifications. To change recipients, sign in to the LMT and visit Settings → Notifications.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Firestore trigger: fires when a new accessRequest document is created.
 * Reads the recipient list from config/app.notifications.accessRequestEmails
 * (falls back to DEFAULT_ACCESS_REQUEST_EMAILS) and sends the notification.
 */
exports.onAccessRequestCreate = onDocumentCreated(
  {
    document: 'accessRequests/{requestId}',
    secrets: [RESEND_API_KEY],
    region: 'us-south1'
  },
  async (event) => {
    const request = event.data?.data();
    const requestId = event.params.requestId;
    if (!request) return;

    // Look up recipients from config
    let recipients = DEFAULT_ACCESS_REQUEST_EMAILS;
    try {
      const configDoc = await db.collection('config').doc('app').get();
      const cfg = configDoc.exists ? configDoc.data() : {};
      const configured = cfg?.notifications?.accessRequestEmails;
      if (Array.isArray(configured) && configured.length > 0) {
        recipients = configured.filter(e => typeof e === 'string' && e.includes('@'));
      }
    } catch (err) {
      console.warn(`[access-request] Could not read config — using defaults:`, err);
    }

    if (recipients.length === 0) {
      console.log(`[access-request] No recipients configured — skipping notification for ${requestId}`);
      return;
    }

    const html = buildAccessRequestEmailHtml({ request, crmUrl: CRM_URL.value() });
    const subject = `New LMT access request from ${request.name || request.email || 'unknown'}`;

    try {
      const resend = new Resend(RESEND_API_KEY.value());
      const result = await resend.emails.send({
        from: EMAIL_FROM.value(),
        to: recipients,
        subject,
        html
      });
      if (result.error) {
        console.error(`[access-request] Resend error:`, result.error);
      } else {
        console.log(`[access-request] Notification sent to ${recipients.join(', ')} for request ${requestId}`);
      }
    } catch (err) {
      console.error(`[access-request] Failed to send notification:`, err);
    }
  }
);

/* ===================== WELCOME EMAIL ===================== */

/**
 * Build the HTML body for the welcome email to a newly-created user.
 */
function buildWelcomeEmailHtml({ name, email, password, crmUrl }) {
  const safeName     = escapeHtml(name || 'there');
  const safeEmail    = escapeHtml(email);
  const safePassword = escapeHtml(password);

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background-color: #1c1917; padding: 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 12px;">
                  <div style="width: 36px; height: 36px; background-color: #ff3300; display: inline-block; text-align: center; line-height: 36px; font-size: 22px; font-weight: 800; color: #ffffff; border-radius: 4px;">B</div>
                </td>
                <td>
                  <div style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.5px;">BOBCAT OF INDY</div>
                  <div style="color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 1px;">LMT · Welcome</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding: 28px 28px 12px;">
            <div style="font-size: 22px; font-weight: 700; color: #1c1917;">Welcome, ${safeName}</div>
            <div style="font-size: 14px; color: #57534e; margin-top: 4px; line-height: 1.5;">An administrator has created a Bobcat of Indy LMT account for you. Use the credentials below to sign in.</div>
          </td>
        </tr>

        <!-- Credentials card -->
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;">
              <tr>
                <td style="padding: 18px 20px;">
                  <div style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Sign-in email</div>
                  <div style="font-size: 15px; color: #1c1917; font-weight: 600; font-family: 'SF Mono', Menlo, Consolas, monospace; padding: 6px 10px; background-color: #ffffff; border: 1px solid #e7e5e4; border-radius: 4px; margin-bottom: 14px;">${safeEmail}</div>

                  <div style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Temporary password</div>
                  <div style="font-size: 15px; color: #1c1917; font-weight: 600; font-family: 'SF Mono', Menlo, Consolas, monospace; padding: 6px 10px; background-color: #ffffff; border: 1px solid #e7e5e4; border-radius: 4px; word-break: break-all;">${safePassword}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Security note -->
        <tr>
          <td style="padding: 16px 28px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 6px;">
              <tr>
                <td style="padding: 12px 14px;">
                  <div style="font-size: 12px; color: #92400e; line-height: 1.5;">
                    <strong>Security tip:</strong> After your first sign-in, click the menu in the top-right and use "Forgot password?" on the sign-in screen to set a password only you know.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${crmUrl}" style="display: inline-block; background-color: #d62b00; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;">Sign in to the LMT →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 20px 28px 28px; text-align: center; color: #a8a29e; font-size: 11px;">
            You received this email because an administrator created an account for you in the Bobcat of Indy LMT. If this looks like a mistake, contact your administrator.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * HTTPS Callable: sends a welcome email with login credentials to a new user.
 * Verifies the caller is signed in and is an admin before sending.
 *
 * Called from the client immediately after createUserOnSecondaryApp + saveUserDoc.
 */
/**
 * One email per CSV import instead of one per lead. Called by the client after a
 * successful import — the client is what knows the batch boundary; a Firestore
 * trigger only ever sees individual documents.
 *
 * Any signed-in user may call this: importing is already gated by the Import tab
 * being admin-only, and the payload is just a count plus a branch tally. There is
 * no way to address the mail elsewhere — recipients come from config, never from
 * the caller.
 */
exports.sendImportSummaryEmail = onCall(
  {
    secrets: [RESEND_API_KEY],
    region: 'us-south1'
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const { imported, unassigned, branches } = request.data || {};
    const total = Number(imported);
    if (!Number.isFinite(total) || total <= 0) {
      throw new HttpsError('invalid-argument', 'imported must be a positive number.');
    }
    const unassignedCount = Number.isFinite(Number(unassigned)) ? Number(unassigned) : total;

    if (!(await newLeadAlertsEnabled())) {
      return { sent: false, reason: 'disabled' };
    }
    const recipients = await getNotificationRecipients('newLeadEmails');
    if (recipients.length === 0) {
      return { sent: false, reason: 'no-recipients' };
    }

    // Who ran the import, for the body text
    let importerName = 'Someone';
    try {
      const callerDoc = await db.collection('users').doc(request.auth.uid).get();
      if (callerDoc.exists) importerName = callerDoc.data().name || importerName;
    } catch { /* name is cosmetic — proceed without it */ }

    // Branch tally, sanitised. Cap the rows so a malformed payload cannot
    // generate an unbounded email.
    const rows = (branches && typeof branches === 'object' ? Object.entries(branches) : [])
      .filter(([, n]) => Number.isFinite(Number(n)) && Number(n) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 25)
      .map(([name, n]) => `<tr>
        <td style="padding: 4px 0; font-size: 14px; color: #1c1917;">${escapeHtml(String(name) || '— No branch —')}</td>
        <td style="padding: 4px 0; font-size: 14px; color: #1c1917; text-align: right; font-weight: 600;">${escapeHtml(String(Number(n)))}</td>
      </tr>`).join('');

    const html = buildImportSummaryEmailHtml({
      total,
      unassignedCount,
      importerName: escapeHtml(importerName),
      rowsHtml: rows,
      crmUrl: CRM_URL.value()
    });

    try {
      const resend = new Resend(RESEND_API_KEY.value());
      const result = await resend.emails.send({
        from: EMAIL_FROM.value(),
        to: recipients,
        subject: `${total} lead${total === 1 ? '' : 's'} imported into the LMT`,
        html
      });
      if (result.error) {
        console.error('[import-summary] Resend error:', result.error);
        return { sent: false, reason: 'send-failed' };
      }
      console.log(`[import-summary] Sent to ${recipients.length} recipient(s) for ${total} leads`);
      return { sent: true, recipients: recipients.length };
    } catch (err) {
      console.error('[import-summary] Failed to send:', err);
      return { sent: false, reason: 'send-failed' };
    }
  }
);

exports.sendWelcomeEmail = onCall(
  {
    secrets: [RESEND_API_KEY],
    region: 'us-south1'
  },
  async (request) => {
    // Caller must be signed in
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in to send welcome emails.');
    }

    // Caller must be an admin
    try {
      const callerDoc = await db.collection('users').doc(request.auth.uid).get();
      if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
        throw new HttpsError('permission-denied', 'Only admins can send welcome emails.');
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'Failed to verify caller permissions.');
    }

    // Validate inputs
    const { email, name, password } = request.data || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'A valid email is required.');
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new HttpsError('invalid-argument', 'A password of at least 6 characters is required.');
    }

    // Send email
    const html = buildWelcomeEmailHtml({
      name: name || '',
      email,
      password,
      crmUrl: CRM_URL.value()
    });
    const subject = `Welcome to the Bobcat of Indy LMT`;

    try {
      const resend = new Resend(RESEND_API_KEY.value());
      const result = await resend.emails.send({
        from: EMAIL_FROM.value(),
        to: email,
        subject,
        html
      });
      if (result.error) {
        console.error(`[welcome] Resend error for ${email}:`, result.error);
        throw new HttpsError('internal', `Email failed: ${result.error.message || 'unknown error'}`);
      }
      console.log(`[welcome] Welcome email sent to ${email}`);
      return { ok: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error(`[welcome] Failed to send welcome email to ${email}:`, err);
      throw new HttpsError('internal', 'Could not send welcome email. The user account was created successfully — you can share credentials manually or use Forgot Password.');
    }
  }
);

/**
 * Build the HTML for the password-reset email. Same visual style as the
 * welcome email so users recognize it as coming from the LMT.
 */
function buildPasswordResetEmailHtml({ name, email, password, crmUrl, adminName }) {
  const safeName      = escapeHtml(name || 'there');
  const safeEmail     = escapeHtml(email);
  const safePassword  = escapeHtml(password);
  const safeAdmin     = escapeHtml(adminName || 'An administrator');

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background-color: #1c1917; padding: 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 12px;">
                  <div style="width: 36px; height: 36px; background-color: #ff3300; display: inline-block; text-align: center; line-height: 36px; font-size: 22px; font-weight: 800; color: #ffffff; border-radius: 4px;">B</div>
                </td>
                <td>
                  <div style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.5px;">BOBCAT OF INDY</div>
                  <div style="color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 1px;">LMT · Password reset</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding: 28px 28px 12px;">
            <div style="font-size: 22px; font-weight: 700; color: #1c1917;">Your password was reset</div>
            <div style="font-size: 14px; color: #57534e; margin-top: 4px; line-height: 1.5;">Hi ${safeName}, ${safeAdmin} has reset your Bobcat of Indy LMT password. Use the new credentials below to sign in.</div>
          </td>
        </tr>

        <!-- Credentials card -->
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;">
              <tr>
                <td style="padding: 18px 20px;">
                  <div style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Sign-in email</div>
                  <div style="font-size: 15px; color: #1c1917; font-weight: 600; font-family: 'SF Mono', Menlo, Consolas, monospace; padding: 6px 10px; background-color: #ffffff; border: 1px solid #e7e5e4; border-radius: 4px; margin-bottom: 14px;">${safeEmail}</div>

                  <div style="font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">New temporary password</div>
                  <div style="font-size: 15px; color: #1c1917; font-weight: 600; font-family: 'SF Mono', Menlo, Consolas, monospace; padding: 6px 10px; background-color: #ffffff; border: 1px solid #e7e5e4; border-radius: 4px; word-break: break-all;">${safePassword}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Security note -->
        <tr>
          <td style="padding: 16px 28px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 6px;">
              <tr>
                <td style="padding: 12px 14px;">
                  <div style="font-size: 12px; color: #92400e; line-height: 1.5;">
                    <strong>Security tip:</strong> Your previous password no longer works. After signing in with this temporary password, use "Forgot password?" on the sign-in screen to set a new one only you know.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Did-not-request note -->
        <tr>
          <td style="padding: 12px 28px 0;">
            <div style="font-size: 12px; color: #78716c; line-height: 1.5;">
              <strong>Didn't request this?</strong> If you didn't ask for a password reset, contact your administrator right away — someone may have access they shouldn't.
            </div>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${crmUrl}" style="display: inline-block; background-color: #d62b00; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;">Sign in to the LMT →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 20px 28px 28px; text-align: center; color: #a8a29e; font-size: 11px;">
            You received this email because an administrator reset your password in the Bobcat of Indy LMT.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Generate a strong random password. 12 characters mixing letters, digits,
 * and a couple of symbols — meets the 6-char Firebase minimum with room to
 * spare, but stays easy enough to type once from an email.
 *
 * Uses crypto.randomInt for uniformity (no modulo bias) instead of Math.random.
 */
function generateRandomPassword() {
  const crypto = require('crypto');
  // Deliberately exclude visually confusing characters (0/O, 1/l/I) so users
  // typing from an email don't fumble the reset.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[crypto.randomInt(chars.length)];
  }
  return out;
}

/**
 * HTTPS Callable: admin-triggered password reset for another user.
 *
 * Flow:
 *   1. Verify caller is a signed-in admin
 *   2. Verify target user exists and isn't a system user
 *   3. Generate a fresh random password
 *   4. Update the target's Firebase Auth password via Admin SDK
 *   5. Email the target with the new password
 *   6. Return { ok: true } on success
 *
 * The admin never sees the new password — it's sent directly to the target's
 * inbox. This avoids the "admin knows every user's password" anti-pattern.
 */
exports.adminResetUserPassword = onCall(
  {
    secrets: [RESEND_API_KEY],
    region: 'us-south1'
  },
  async (request) => {
    // 1. Caller must be signed in
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in to reset passwords.');
    }
    const callerUid = request.auth.uid;

    // 2. Caller must be an admin
    let callerName = 'An administrator';
    try {
      const callerDoc = await db.collection('users').doc(callerUid).get();
      if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
        throw new HttpsError('permission-denied', 'Only admins can reset other users\' passwords.');
      }
      callerName = callerDoc.data().name || callerDoc.data().email || 'An administrator';
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'Failed to verify caller permissions.');
    }

    // 3. Validate inputs
    const { targetUid } = request.data || {};
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'A target user ID is required.');
    }
    if (targetUid === callerUid) {
      throw new HttpsError('failed-precondition', 'To change your own password, sign out and use "Forgot password?" on the sign-in screen.');
    }

    // 4. Look up target user
    let targetDoc;
    try {
      targetDoc = await db.collection('users').doc(targetUid).get();
    } catch (err) {
      throw new HttpsError('internal', 'Failed to look up target user.');
    }
    if (!targetDoc.exists) {
      throw new HttpsError('not-found', 'That user no longer exists.');
    }
    const targetData = targetDoc.data();

    if (targetData.isSystem) {
      throw new HttpsError('failed-precondition', 'System users cannot have their password reset.');
    }
    if (!targetData.email) {
      throw new HttpsError('failed-precondition', 'Target user has no email on file — cannot send new password.');
    }

    // 5. Generate a new password and update Firebase Auth
    const newPassword = generateRandomPassword();
    try {
      await admin.auth().updateUser(targetUid, { password: newPassword });
    } catch (err) {
      console.error(`[reset-pw] Failed to update Auth password for ${targetUid}:`, err);
      throw new HttpsError('internal', 'Failed to update the user\'s password in Firebase Auth. The password was NOT changed.');
    }

    // 6. Send the notification email. If email fails, we still return an error
    //    (with the new password in the body) so the admin can share it manually.
    //    The Firebase Auth password IS already changed at this point — no rolling back.
    const html = buildPasswordResetEmailHtml({
      name: targetData.name || '',
      email: targetData.email,
      password: newPassword,
      crmUrl: CRM_URL.value(),
      adminName: callerName
    });

    try {
      const resend = new Resend(RESEND_API_KEY.value());
      const result = await resend.emails.send({
        from: EMAIL_FROM.value(),
        to: targetData.email,
        subject: 'Your Bobcat of Indy LMT password has been reset',
        html
      });
      if (result.error) {
        console.error(`[reset-pw] Resend error for ${targetData.email}:`, result.error);
        // Password IS reset — surface it so admin can share manually
        throw new HttpsError('internal',
          `Password was reset, but the email could not be sent. Share this new password with ${targetData.name || targetData.email} manually: ${newPassword}`
        );
      }
      console.log(`[reset-pw] Password reset for ${targetData.email} (initiated by ${callerName})`);
      return { ok: true, emailSentTo: targetData.email };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error(`[reset-pw] Failed to send reset email to ${targetData.email}:`, err);
      throw new HttpsError('internal',
        `Password was reset, but the email could not be sent. Share this new password with the user manually: ${newPassword}`
      );
    }
  }
);

/* ===================== BULK REASSIGNMENT (USER DELETION) ===================== */

/**
 * Build the HTML body for the bulk-reassignment summary email.
 * Sent to a single rep when many leads are reassigned to them at once (e.g. user deletion).
 */
function buildBulkReassignmentEmailHtml({ rep, leads, deletedUserName, crmUrl }) {
  const repName = escapeHtml(rep.name || 'there');
  const fromName = escapeHtml(deletedUserName || 'A user');
  const count = leads.length;
  const countLabel = count === 1 ? 'lead' : 'leads';
  const myLeadsUrl = `${crmUrl}?view=my-open`;

  // Build a compact rows table (cap at 10 visible leads)
  const visibleLeads = leads.slice(0, 10);
  const overflow = count - visibleLeads.length;

  const leadRows = visibleLeads.map(l => {
    const name   = escapeHtml(l.customerName || 'Unnamed');
    const status = escapeHtml(l.status || 'New');
    const branch = escapeHtml(l.branch || '—');
    const company = escapeHtml(l.companyName || '');
    return `<tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #1c1917; font-weight: 600;">${name}${company ? `<div style="font-size: 11px; font-weight: 400; color: #78716c;">${company}</div>` : ''}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #57534e;">${status}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #57534e;">${branch}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background-color: #1c1917; padding: 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 12px;">
                  <div style="width: 36px; height: 36px; background-color: #ff3300; display: inline-block; text-align: center; line-height: 36px; font-size: 22px; font-weight: 800; color: #ffffff; border-radius: 4px;">B</div>
                </td>
                <td>
                  <div style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.5px;">BOBCAT OF INDY</div>
                  <div style="color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 1px;">LMT · Leads reassigned</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding: 28px 28px 12px;">
            <div style="font-size: 22px; font-weight: 700; color: #1c1917;">${count} ${countLabel} reassigned to you</div>
            <div style="font-size: 14px; color: #57534e; margin-top: 4px; line-height: 1.5;">Hi ${repName}, ${fromName} was removed from the LMT, and their ${count} ${countLabel} ${count === 1 ? 'has' : 'have'} been reassigned to you.</div>
          </td>
        </tr>

        <!-- Leads table -->
        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; overflow: hidden;">
              <thead>
                <tr style="background-color: #f5f5f4;">
                  <th align="left" style="padding: 10px 12px; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Customer</th>
                  <th align="left" style="padding: 10px 12px; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Status</th>
                  <th align="left" style="padding: 10px 12px; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Branch</th>
                </tr>
              </thead>
              <tbody>
                ${leadRows}
              </tbody>
            </table>
            ${overflow > 0 ? `<div style="text-align: center; font-size: 12px; color: #78716c; padding: 10px 0;">… and ${overflow} more</div>` : ''}
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${myLeadsUrl}" style="display: inline-block; background-color: #d62b00; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;">View My Leads →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 20px 28px 28px; text-align: center; color: #a8a29e; font-size: 11px;">
            You received this email because an administrator reassigned leads to you in the Bobcat of Indy LMT.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * HTTPS Callable: bulk-reassign all of one user's leads to another user.
 * Called when an admin deletes a user who has assigned leads.
 *
 * Inputs:
 *   fromUserId       — the user being removed
 *   toUserId         — who inherits the leads ('u_1' for Unassigned, or a real user UID)
 *   deletedUserName  — display name of the deleted user (for the email body)
 *
 * Returns: { ok: true, reassigned: number }
 *
 * Side effects:
 *   - All leads where assignedTo === fromUserId are updated atomically (in batches of 400).
 *   - A "bulkReassignment: true" marker is added to each lead's history so the per-lead
 *     assignment trigger skips its email.
 *   - A SINGLE summary email is sent to the inheriting rep (unless toUserId is u_1).
 */
exports.reassignUserLeads = onCall(
  {
    secrets: [RESEND_API_KEY],
    region: 'us-south1'
  },
  async (request) => {
    // Caller must be signed in
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    // Caller must be an admin or department manager
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admins can reassign leads.');
    }

    // Validate input
    const { fromUserId, toUserId, deletedUserName, mode = 'delete' } = request.data || {};
    if (!fromUserId || typeof fromUserId !== 'string') {
      throw new HttpsError('invalid-argument', 'fromUserId is required.');
    }
    if (!toUserId || typeof toUserId !== 'string') {
      throw new HttpsError('invalid-argument', 'toUserId is required.');
    }
    if (fromUserId === toUserId) {
      throw new HttpsError('invalid-argument', 'Cannot reassign leads to the same user.');
    }

    // Find all leads currently assigned to the user being removed
    const snap = await db.collection('leads').where('assignedTo', '==', fromUserId).get();
    if (snap.empty) {
      return { ok: true, reassigned: 0 };
    }

    const now = new Date().toISOString();
    const reasonText = mode === 'loa'
      ? `${deletedUserName || 'User'} on Leave of Absence`
      : `${deletedUserName || 'User'} was removed from the LMT`;

    const reassignmentEvent = {
      id: uid('h'),
      type: 'assignment_change',
      timestamp: now,
      actor: request.auth.uid,
      fromUser: fromUserId,
      toUser: toUserId,
      bulkReassignment: true,
      mode,  // 'delete' or 'loa' — used by the LOA-return flow to find restorable leads
      reason: reasonText
    };

    // Process in chunks of 400 to stay safely under Firestore's 500-document batch limit
    const CHUNK_SIZE = 400;
    const docs = snap.docs;
    const reassignedLeads = [];

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      chunk.forEach(doc => {
        const data = doc.data();
        batch.update(doc.ref, {
          assignedTo: toUserId,
          dateAssigned: now,
          history: admin.firestore.FieldValue.arrayUnion(reassignmentEvent)
        });
        reassignedLeads.push({ id: doc.id, ...data });
      });
      await batch.commit();
    }

    console.log(`[bulk-reassign] Moved ${reassignedLeads.length} leads from ${fromUserId} to ${toUserId}`);

    // Send summary email — unless reassigning to the Unassigned pseudo-user
    if (toUserId !== 'u_1') {
      try {
        const toUserDoc = await db.collection('users').doc(toUserId).get();
        if (toUserDoc.exists) {
          const toUser = toUserDoc.data();
          if (toUser.email) {
            const html = buildBulkReassignmentEmailHtml({
              rep: toUser,
              leads: reassignedLeads,
              deletedUserName,
              crmUrl: CRM_URL.value()
            });
            const count = reassignedLeads.length;
            const subject = `${count} lead${count === 1 ? '' : 's'} reassigned to you`;

            const resend = new Resend(RESEND_API_KEY.value());
            const result = await resend.emails.send({
              from: EMAIL_FROM.value(),
              to: toUser.email,
              subject,
              html
            });
            if (result.error) {
              console.error(`[bulk-reassign] Resend error for ${toUser.email}:`, result.error);
            } else {
              console.log(`[bulk-reassign] Summary email sent to ${toUser.email} for ${count} leads`);
            }
          } else {
            console.log(`[bulk-reassign] User ${toUserId} has no email — skipping summary`);
          }
        } else {
          console.log(`[bulk-reassign] No user profile for ${toUserId} — skipping summary`);
        }
      } catch (err) {
        // Email failure doesn't roll back the reassignment — leads were already moved
        console.error(`[bulk-reassign] Failed to send summary email:`, err);
      }
    }

    return { ok: true, reassigned: reassignedLeads.length };
  }
);

/* ===================== LOA RETURN — restore leads to a user coming back ===================== */

/**
 * Build the HTML body for the "welcome back from LOA" email — sent to a returning user
 * when an admin elects to reassign their pre-leave leads back to them.
 */
function buildLoaReturnEmailHtml({ rep, leads, crmUrl }) {
  const repName = escapeHtml(rep.name || 'there');
  const count = leads.length;
  const countLabel = count === 1 ? 'lead' : 'leads';
  const myLeadsUrl = `${crmUrl}?view=my-open`;

  const visibleLeads = leads.slice(0, 10);
  const overflow = count - visibleLeads.length;

  const leadRows = visibleLeads.map(l => {
    const name   = escapeHtml(l.customerName || 'Unnamed');
    const status = escapeHtml(l.status || 'New');
    const branch = escapeHtml(l.branch || '—');
    const company = escapeHtml(l.companyName || '');
    return `<tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #1c1917; font-weight: 600;">${name}${company ? `<div style="font-size: 11px; font-weight: 400; color: #78716c;">${company}</div>` : ''}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #57534e;">${status}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #57534e;">${branch}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f4; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
        <tr>
          <td style="background-color: #1c1917; padding: 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right: 12px;">
                  <div style="width: 36px; height: 36px; background-color: #ff3300; display: inline-block; text-align: center; line-height: 36px; font-size: 22px; font-weight: 800; color: #ffffff; border-radius: 4px;">B</div>
                </td>
                <td>
                  <div style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.5px;">BOBCAT OF INDY</div>
                  <div style="color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 1px;">LMT · Welcome back</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding: 28px 28px 12px;">
            <div style="font-size: 22px; font-weight: 700; color: #1c1917;">Welcome back, ${repName}</div>
            <div style="font-size: 14px; color: #57534e; margin-top: 4px; line-height: 1.5;">Your ${count} pre-leave ${countLabel} ${count === 1 ? 'has' : 'have'} been restored to you. You're back in the lead assignment rotation as of now.</div>
          </td>
        </tr>

        <tr>
          <td style="padding: 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; overflow: hidden;">
              <thead>
                <tr style="background-color: #f5f5f4;">
                  <th align="left" style="padding: 10px 12px; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Customer</th>
                  <th align="left" style="padding: 10px 12px; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Status</th>
                  <th align="left" style="padding: 10px 12px; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Branch</th>
                </tr>
              </thead>
              <tbody>${leadRows}</tbody>
            </table>
            ${overflow > 0 ? `<div style="text-align: center; font-size: 12px; color: #78716c; padding: 10px 0;">… and ${overflow} more</div>` : ''}
          </td>
        </tr>

        <tr>
          <td align="center" style="padding: 24px 28px 8px;">
            <a href="${myLeadsUrl}" style="display: inline-block; background-color: #d62b00; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 700; letter-spacing: 0.3px;">View My Leads →</a>
          </td>
        </tr>

        <tr>
          <td style="padding: 20px 28px 28px; text-align: center; color: #a8a29e; font-size: 11px;">
            You received this email because you were returned from Leave of Absence in the Bobcat of Indy LMT.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * HTTPS Callable: when a user returns from LOA, this function finds the leads that
 * were bulk-reassigned away from them (mode='loa') AND are still assigned to the
 * interim assignee from that LOA event, then moves them all back to the returning user.
 *
 * Leads that have been intentionally moved elsewhere since the LOA started are NOT
 * pulled back — admins or other reps may have made deliberate reassignments that
 * shouldn't be undone.
 */
exports.restoreLoaLeadsForUser = onCall(
  {
    secrets: [RESEND_API_KEY],
    region: 'us-south1'
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admins can restore LOA leads.');
    }

    const { userId } = request.data || {};
    if (!userId || typeof userId !== 'string') {
      throw new HttpsError('invalid-argument', 'userId is required.');
    }

    // Scan all leads — Firestore can't query nested array fields, so we filter in memory.
    // For small/medium CRMs this is fine (sub-second on a few thousand leads).
    const snap = await db.collection('leads').get();
    const matches = [];
    snap.docs.forEach(doc => {
      const lead = doc.data();
      const history = lead.history || [];
      // Find the most recent LOA-mode bulk reassignment from this user
      const loaEvent = [...history].reverse().find(h =>
        h.type === 'assignment_change' &&
        h.bulkReassignment &&
        h.fromUser === userId &&
        h.mode === 'loa'
      );
      if (!loaEvent) return;
      // Only restore if the lead is STILL with the interim assignee from that LOA event.
      // If it's been moved since (intentional reassignment), leave it alone.
      if (lead.assignedTo !== loaEvent.toUser) return;
      matches.push({ id: doc.id, data: lead });
    });

    if (matches.length === 0) {
      return { ok: true, restored: 0 };
    }

    const now = new Date().toISOString();
    const restoreEvent = {
      id: uid('h'),
      type: 'assignment_change',
      timestamp: now,
      actor: request.auth.uid,
      toUser: userId,
      bulkReassignment: true,
      mode: 'loa_return',
      reason: 'Returned from Leave of Absence'
    };

    // Batch updates (chunks of 400 to stay under Firestore's 500 limit)
    const CHUNK_SIZE = 400;
    for (let i = 0; i < matches.length; i += CHUNK_SIZE) {
      const chunk = matches.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      chunk.forEach(({ id }) => {
        batch.update(db.collection('leads').doc(id), {
          assignedTo: userId,
          dateAssigned: now,
          history: admin.firestore.FieldValue.arrayUnion(restoreEvent)
        });
      });
      await batch.commit();
    }

    console.log(`[loa-return] Restored ${matches.length} leads to user ${userId}`);

    // Welcome-back email to the returning user
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        const user = userDoc.data();
        if (user.email) {
          const html = buildLoaReturnEmailHtml({
            rep: user,
            leads: matches.map(m => m.data),
            crmUrl: CRM_URL.value()
          });
          const count = matches.length;
          const subject = `Welcome back — ${count} lead${count === 1 ? '' : 's'} restored to you`;
          const resend = new Resend(RESEND_API_KEY.value());
          const result = await resend.emails.send({
            from: EMAIL_FROM.value(),
            to: user.email,
            subject,
            html
          });
          if (result.error) {
            console.error(`[loa-return] Resend error for ${user.email}:`, result.error);
          } else {
            console.log(`[loa-return] Welcome-back email sent to ${user.email}`);
          }
        }
      }
    } catch (err) {
      console.error('[loa-return] Email step failed (leads were still restored):', err);
    }

    return { ok: true, restored: matches.length };
  }
);

/* ===================== HEALTH CHECK ===================== */

exports.health = onRequest({ region: 'us-central1' }, (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});
// CI permissions check