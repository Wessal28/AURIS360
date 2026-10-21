// Service-only daily follow-up. The notification queue enforces idempotency.
const PAGE_SIZE = 400;
const MANAGER_ROLES = new Set(['sephs_admin', 'admin', 'manager', 'hse_manager', 'site_manager']);

module.exports = async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  if (!['GET', 'POST'].includes(String(req.method || 'GET').toUpperCase()))
    return res.status(405).json({ error: 'GET or POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
    return res.status(500).json({ error: 'Permit follow-up service is not configured' });
  try { return res.status(200).json(await processFollowups()); }
  catch (error) { return res.status(500).json({ error: String(error.message || error).slice(0, 200) }); }
};

async function processFollowups(options = {}) {
  const context = contextFor(options), now = options.now || new Date(), day = now.toISOString().slice(0, 10);
  let lastId = '', scanned = 0, queued = 0;
  const companyCache = new Map();
  for (;;) {
    const rows = await read(context, '/permits?select=id,company_id,permit_number,status,planned_end,created_by,permit_issuer_id,permit_receiver,approval_level_required,approval_l1_status,approval_l2_status,approval_l3_status,approval_l1_at,approval_l2_at,approval_l3_at,risk_assessment_id,method_statement_id,linked_reference_snapshot&status=in.(pending_approval,approved,active)&order=id.asc&limit=' + PAGE_SIZE + (lastId ? '&id=gt.' + encodeURIComponent(lastId) : ''));
    if (!rows.length) break;
    scanned += rows.length;
    for (const [companyId, permits] of groupByCompany(rows)) {
      let company = companyCache.get(companyId);
      if (!company) { company = await loadCompany(context, companyId); companyCache.set(companyId, company); }
      const references = await loadReferences(context, companyId, permits);
      for (const permit of permits) {
        for (let event of planEvents(permit, references, now)) {
          let recipients = event.kind === 'permit_approval_reminder'
            ? approvalRecipients(permit, company)
            : followupRecipients(permit, company.profiles);
          if (event.kind === 'permit_approval_reminder' && !recipients.length) {
            event = { kind: 'permit_approval_route_missing', title: 'Approval level ' + event.level + ' has no configured contact', level: event.level };
            recipients = managerRecipients(company.profiles);
          }
          for (const recipient of recipients) {
            const notification = notificationFor(permit, event, recipient, day, now);
            if (await queue(context, notification)) queued++;
          }
        }
      }
    }
    if (rows.length < PAGE_SIZE) break;
    lastId = rows[rows.length - 1].id;
  }
  return { ok: true, run_date: day, permits_scanned: scanned, notifications_queued: queued };
}

function groupByCompany(rows) {
  const groups = new Map();
  for (const row of rows) if (row && row.id && row.company_id) {
    if (!groups.has(row.company_id)) groups.set(row.company_id, []);
    groups.get(row.company_id).push(row);
  }
  return groups;
}

async function loadCompany(context, companyId) {
  const id = encodeURIComponent(companyId);
  const [profiles, settings, workflows] = await Promise.all([
    read(context, '/profiles?select=id,company_id,full_name,email,real_email,role,status&company_id=eq.' + id + '&status=eq.active&limit=1000'),
    read(context, '/notification_settings?select=event_recipients&company_id=eq.' + id + '&limit=1'),
    read(context, '/approval_workflows?select=id&company_id=eq.' + id + '&module_name=eq.permit&is_active=eq.true&order=created_at.desc&limit=1')
  ]);
  const steps = workflows[0] ? await read(context, '/approval_workflow_steps?select=step_no,approver_email,approver_name&workflow_id=eq.' + encodeURIComponent(workflows[0].id) + '&order=step_no.asc') : [];
  const rules = settings[0] && settings[0].event_recipients;
  let recipients = rules || {};
  if (typeof rules === 'string') { try { recipients = JSON.parse(rules); } catch (_) { recipients = {}; } }
  return { profiles, steps, fallback: recipients.permit_approvers || {} };
}

async function loadReferences(context, companyId, permits) {
  const result = { risks: new Map(), documents: new Map() };
  for (const [field, table, select, target] of [
    ['risk_assessment_id', 'risk_assessments', 'id,company_id,status,revision,updated_at', result.risks],
    ['method_statement_id', 'documents', 'id,company_id,status,is_latest,current_revision_id,version_major,version_minor,updated_at', result.documents]
  ]) {
    const ids = [...new Set(permits.map(row => row[field]).filter(value => /^[0-9a-f-]{36}$/i.test(String(value))))];
    for (let start = 0; start < ids.length; start += 50) {
      const batch = ids.slice(start, start + 50);
      const rows = await read(context, '/' + table + '?select=' + select + '&company_id=eq.' + encodeURIComponent(companyId) + '&id=in.(' + batch.join(',') + ')&limit=50');
      for (const row of rows) if (row.company_id === companyId && batch.includes(row.id)) target.set(row.id, row);
    }
  }
  return result;
}

function approvalStage(permit) {
  const levels = Math.max(1, Math.min(3, Number(permit.approval_level_required) || 3));
  for (let level = 1; level <= levels; level++) if (permit['approval_l' + level + '_status'] !== 'approved') return level;
  return null;
}

function documentIssue(permit, references) {
  const snapshot = permit.linked_reference_snapshot || {};
  const approvedAt = Math.max(Date.parse(snapshot.approved_at || '') || 0, ...[1, 2, 3].map(level => Date.parse(permit['approval_l' + level + '_at'] || '') || 0));
  const completeSnapshot = Boolean(snapshot.approved_at);
  if ((completeSnapshot || snapshot.risk_assessment_id) && (snapshot.risk_assessment_id || null) !== (permit.risk_assessment_id || null)) return 'Linked Risk Assessment changed after permit approval';
  if ((completeSnapshot || snapshot.method_statement_id) && (snapshot.method_statement_id || null) !== (permit.method_statement_id || null)) return 'Linked method statement changed after permit approval';
  const ra = permit.risk_assessment_id && references.risks.get(permit.risk_assessment_id);
  if (permit.risk_assessment_id && !ra) return 'Linked Risk Assessment is unavailable';
  if (ra && !['approved', 'active', 'current', 'completed'].includes(String(ra.status || '').toLowerCase())) return 'Linked Risk Assessment is no longer approved/current';
  if (ra && snapshot.risk_assessment_id === ra.id && snapshot.risk_assessment_revision != null && Number(snapshot.risk_assessment_revision) !== Number(ra.revision)) return 'Linked Risk Assessment revision changed after permit approval';
  if (ra && approvedAt && Date.parse(ra.updated_at || '') > approvedAt) return 'Linked Risk Assessment changed after permit approval';
  const document = permit.method_statement_id && references.documents.get(permit.method_statement_id);
  if (permit.method_statement_id && !document) return 'Linked method statement is unavailable';
  if (document && (document.is_latest === false || !['approved', 'current', 'active', 'effective', 'published'].includes(String(document.status || '').toLowerCase()))) return 'Linked method statement is no longer current';
  if (document && snapshot.method_statement_id === document.id && (
    (Object.hasOwn(snapshot, 'method_statement_revision_id') && snapshot.method_statement_revision_id !== document.current_revision_id) ||
    (Object.hasOwn(snapshot, 'method_statement_version_major') && Number(snapshot.method_statement_version_major) !== Number(document.version_major)) ||
    (Object.hasOwn(snapshot, 'method_statement_version_minor') && Number(snapshot.method_statement_version_minor) !== Number(document.version_minor)))) return 'Linked method statement revision changed after permit approval';
  if (document && approvedAt && Date.parse(document.updated_at || '') > approvedAt) return 'Linked method statement changed after permit approval';
  return null;
}

function planEvents(permit, references, now) {
  const events = [], end = Date.parse(permit.planned_end || ''), remaining = end - now.getTime();
  if (permit.status === 'pending_approval' && approvalStage(permit)) events.push({ kind: 'permit_approval_reminder', title: 'Approval decision pending', level: approvalStage(permit) });
  if (['approved', 'active'].includes(permit.status)) {
    if (Number.isFinite(end) && remaining >= 0 && remaining <= 24 * 60 * 60 * 1000)
      events.push({ kind: 'permit_expiry_warning', title: 'Permit planned end is within 24 hours' });
    if (Number.isFinite(end) && remaining < 0)
      events.push(permit.status === 'active' ? { kind: 'permit_closure_followup', title: 'Permit end passed — close-out checks required' } : { kind: 'permit_expired_unstarted', title: 'Permit expired before activation' });
    const issue = documentIssue(permit, references);
    if (issue) events.push({ kind: 'permit_document_review', title: issue });
  }
  return events;
}

function bestEmail(profile) {
  return [profile && profile.real_email, profile && profile.email].map(value => String(value || '').trim().toLowerCase())
    .find(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !value.endsWith('.local')) || null;
}

function approvalRecipients(permit, company) {
  const level = approvalStage(permit);
  if (!level) return [];
  const step = company.steps.find(row => Number(row.step_no) === level);
  const email = String(step && step.approver_email || company.fallback['level' + level + '_email'] || '').trim().toLowerCase();
  if (!bestEmail({ email })) return [];
  const profile = company.profiles.find(row => bestEmail(row) === email);
  return [{ profile_id: profile && profile.id || null, email, name: profile && profile.full_name || step && step.approver_name || email }];
}

function followupRecipients(permit, profiles) {
  const ids = [permit.permit_issuer_id, permit.permit_receiver, permit.created_by];
  const owners = profiles.filter(profile => ids.includes(profile.id) && bestEmail(profile));
  const selected = owners.length ? owners : profiles.filter(profile => MANAGER_ROLES.has(profile.role) && bestEmail(profile));
  return [...new Map(selected.map(profile => [profile.id, { profile_id: profile.id, email: bestEmail(profile), name: profile.full_name || bestEmail(profile) }])).values()];
}

function managerRecipients(profiles) {
  return profiles.filter(profile => MANAGER_ROLES.has(profile.role) && bestEmail(profile))
    .map(profile => ({ profile_id: profile.id, email: bestEmail(profile), name: profile.full_name || bestEmail(profile) }));
}

function notificationFor(permit, event, recipient, day, now) {
  const ref = permit.permit_number || permit.id;
  const url = 'https://auris360.app/?goto=permit';
  const key = ['permit-followup', event.kind, permit.id, event.level || '-', recipient.profile_id || recipient.email, day].join('/');
  return {
    company_id: permit.company_id, recipient_profile_id: recipient.profile_id, type: event.kind,
    subject: '[AURIS360] ' + event.title + ': ' + ref,
    body_html: '<p>' + escapeHtml(event.title) + ' for permit <strong>' + escapeHtml(ref) + '</strong>.</p><p>Review the permit and record the required decision or confirmation in AURIS360.</p>',
    to_email: recipient.email, to_name: recipient.name, status: 'pending', channel: recipient.profile_id ? 'in_app' : 'email',
    priority: ['permit_closure_followup', 'permit_expired_unstarted', 'permit_document_review', 'permit_approval_route_missing'].includes(event.kind) ? 'high' : 'normal',
    related_id: permit.id, related_table: 'permits', related_module: 'permit', related_ref: ref,
    record_url: url, metadata: { event: event.kind, approval_level: event.level || null, planned_end: permit.planned_end || null,
      relationship: { module: 'permit', table: 'permits', id: permit.id, ref, company_id: permit.company_id, url } },
    idempotency_key: key, next_attempt_at: now.toISOString()
  };
}

function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function contextFor(options) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { fetchImpl: options.fetchImpl || fetch, base: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''), headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' } };
}
async function read(context, path) {
  const response = await context.fetchImpl(context.base + '/rest/v1' + path, { headers: context.headers });
  if (!response.ok) throw new Error('Permit follow-up read failed: ' + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Permit follow-up read returned invalid data');
  return rows;
}
async function queue(context, body) {
  const response = await context.fetchImpl(context.base + '/rest/v1/notification_queue', {
    method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(body)
  });
  if (response.ok) return true;
  if (response.status === 409) {
    const detail = await response.json().catch(() => ({}));
    if (detail.code === '23505' && String(detail.message || detail.details || '').includes('notification_queue_idempotency')) return false;
  }
  throw new Error('Permit follow-up queue failed: ' + response.status);
}

module.exports._test = { processFollowups, approvalStage, documentIssue, planEvents, approvalRecipients, followupRecipients, notificationFor, bestEmail };
