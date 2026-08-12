# AURIS360 Email Setup

Queued app emails are sent by `api/send-emails.js`.

## Reliability migration

Run `notification_delivery_reliability_upgrade.sql` in Supabase before enabling
the reliability gate. It adds atomic queue leasing, retry scheduling, provider
message identifiers and delivery timestamps. The worker remains compatible with
the legacy queue during rollout, but automatic retry and duplicate-worker
protection only become active after this migration is applied.

The worker prefers SMTP. Add these variables in Vercel:

- `SMTP_HOST`
- `SMTP_PORT` usually `587`, or `465` for SSL
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE` set to `true` only when using port `465`
- `EMAIL_FROM` for example `AURIS360 <notifications@yourdomain.com>`

These can use the same SMTP provider details configured in Supabase Auth for password reset emails, but they still need to be copied into Vercel because Supabase does not expose its Auth SMTP settings to the Vercel app.

Fallback option:

- `RESEND_API_KEY`
- `EMAIL_FROM`

For Resend delivery evidence, also add:

- `RESEND_WEBHOOK_SECRET`

Then register this endpoint in the Resend dashboard:

`https://auris-360.vercel.app/api/resend-webhook`

Subscribe it to `email.delivered`, `email.delivery_delayed`, `email.bounced`
and `email.complained`. A request without valid Svix signature headers must be
rejected with HTTP 401.

## Processing frequency — Vercel Pro

The production deployment uses Vercel Pro cron every five minutes
(`*/5 * * * *`) for email, escalation evaluation, browser push, WhatsApp and
acknowledgement SLA processing. The overdue digest remains once daily at 08:55
UTC; the next email worker cycle sends the queued digest within five minutes.

Add a strong `CRON_SECRET` in **Vercel → Project → Settings → Environment
Variables** for Production, Preview and Development. Vercel automatically sends
it as `Authorization: Bearer <CRON_SECRET>` to cron invocations. Every worker
rejects calls without that exact secret. Also set
`NOTIFICATION_SCHEDULE_MODE=vercel_pro` so Notification Settings reports the
deployed cadence correctly. Redeploy after adding or changing variables.

Cron expressions use UTC. After deployment, open **Vercel → Project → Settings
→ Cron Jobs** and confirm all six jobs are enabled. Use each job's **View Logs**
link to verify HTTP 200 responses; do not expose the secret in logs or URLs.

## Automatic action escalation

Run `action_notification_escalation_upgrade.sql` after the Master Action Plan,
notification relationship and delivery reliability migrations. It provides:

- one due-soon notification within the configured reminder window;
- Level 1 escalation at 7 overdue days;
- Level 2 escalation at 21 overdue days;
- Level 3 escalation at 45 overdue days;
- idempotency per action, target date, event and recipient;
- automatic stop when an action is closed, completed, cancelled or voided.

Thresholds can be changed per company in `notification_escalation_settings`.
Configure the actual hierarchy in `notification_escalation_recipients`; when a
level has no deliverable explicit recipient, the engine selects one controlled
company-role fallback for that level.

Example recipient configuration:

```sql
insert into notification_escalation_recipients(
  company_id, escalation_level, profile_id
)
values
  ('<company-uuid>', 1, '<supervisor-profile-uuid>'),
  ('<company-uuid>', 2, '<manager-profile-uuid>'),
  ('<company-uuid>', 3, '<director-profile-uuid>');
```

Do not leave the fallback roles as the permanent reporting hierarchy when the
company has multiple supervisors or managers. Explicit recipients prevent
unnecessary disclosure and ensure the correct accountability chain.

Apply `notification_escalation_admin_upgrade.sql` to maintain this hierarchy
without routine SQL edits. Company Admins and HSE Managers can then use
**Settings → Notification Settings → Action escalation hierarchy** to enable or
disable automatic escalation, validate the ordered reminder thresholds and
assign one or more explicit AURIS360 users or controlled external recipients to
each level. Saving is atomic: invalid or cross-company recipients leave the
previous hierarchy unchanged. When no explicit recipient exists, the screen
shows the role fallback used by the escalation engine.

## Daily overdue digest and terminal-state suppression

Run `action_notification_digest_upgrade.sql` after the escalation, personal
inbox, browser push, WhatsApp and recipient-preference migrations. The daily
builder queues at most one consolidated overdue-action email per recipient and
company. Every row in the summary links to the exact Master Action record. It
does not replace immediate due-soon or Level 1-3 escalation notifications.

The digest is built from live open actions only. A closed, completed, cancelled
or voided action is excluded from future summaries. The same terminal-state
transition also skips still-pending individual email, browser-push and WhatsApp
jobs for that action and dismisses its unresolved personal-inbox alert. Sent
messages remain immutable delivery history.

The daily cron builds the digest at 08:55 UTC and the next five-minute email
worker cycle delivers it. Recipient email enablement, overdue-event preference, quiet
hours and rate limits still apply. For a controlled manual run, call
`/api/process-digests` with `Authorization: Bearer <CRON_SECRET>`; the daily
run ledger prevents a duplicate digest for the same recipient and date.

## Personal in-app notification centre

Run `in_app_notification_centre_upgrade.sql` after the notification relationship
and reliability migrations. It adds the private desktop/mobile inbox, unread
state, exact-record links and audited acknowledgements. Recent queue records are
backfilled for the last 90 days when their recipient can be resolved to a
company profile.

The inbox is useful even when a user has a login-only `.local` address: queue
records can resolve that login profile and appear in-app although email delivery
is skipped. Users can only select and update their own notifications. They cannot
create inbox rows, change another recipient's inbox, undo read state or rewrite
an acknowledgement.

## Acknowledgement SLA and missed-response escalation

Run `notification_acknowledgement_control_upgrade.sql` after the personal inbox
and escalation administration migrations. Under **Settings → Notification
Settings → Acknowledgement control**, Company Admins and HSE Managers configure
separate high/urgent response deadlines, reminder frequency, a bounded reminder
count and the point at which a missed response enters the action hierarchy.
High alerts route to Level 2 and urgent alerts to Level 3. Each reminder and
hierarchy notice is idempotent and preserves the exact source-record link.

The committed `/api/process-acknowledgements` cron runs every five minutes on
Vercel Pro. Acknowledging the
original alert, or closing/cancelling its action source, stops still-pending
follow-ups without altering sent delivery history.

## Browser and mobile PWA push

Run `browser_push_notifications_upgrade.sql` after the personal inbox migration.
Generate one VAPID key pair and add these server environment variables:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`, for example `mailto:support@yourdomain.com`

The public key is intentionally returned by `/api/push-config`; the private key
must remain only in Vercel. Do not put either the private key or Supabase service
key in browser code.

The user enables push from the personal notification centre. The application
never requests browser permission automatically. One person may register several
devices, and disabling one device does not disable the others. Only high/urgent
or acknowledgement-required inbox alerts are queued for push.

Desktop Chrome/Edge and Android require notification permission. On iPhone/iPad,
the user must first install AURIS360 with **Share > Add to Home Screen**, open the
installed PWA and then enable push. An ordinary Safari tab is not an installed
iOS notification app.

The repository runs `/api/send-push` every five minutes on Vercel Pro using the
protected `Authorization: Bearer <CRON_SECRET>` invocation.
Expired browser subscriptions are disabled automatically after HTTP 404/410.

## WhatsApp Cloud API activation

WhatsApp remains disabled until the company approves the channel and each
recipient personally opts in from **Users & Roles → Profile → Notifications**.
Run `whatsapp_notifications_upgrade.sql`, then add these Vercel variables:

```text
WHATSAPP_ACCESS_TOKEN=<permanent Meta system-user token>
WHATSAPP_APP_SECRET=<Meta app secret used to verify webhook signatures>
WHATSAPP_VERIFY_TOKEN=<a private value you choose for webhook verification>
WHATSAPP_GRAPH_VERSION=v23.0
```

In Meta WhatsApp Manager, create and approve a utility template named
`auris360_alert` with four body variables in this exact order: severity, title,
record reference and exact AURIS360 URL. Register
`https://auris-360.vercel.app/api/whatsapp-webhook` as the webhook and subscribe
to message-status events. Never commit or expose the access token or app secret.

Finally insert or update the tenant's `whatsapp_channel_settings` row with
`enabled=true`, the Meta `phone_number_id`, approved template name and language.
The default rule sends WhatsApp only at escalation Level 2 or 3, or for a
high/urgent notification when the opted-in user selected WhatsApp as preferred.
Email and in-app remain governed fallbacks. The WhatsApp worker runs every five
minutes on Vercel Pro for urgent use.

## Controlled verification

Administrators and HSE notification owners can review **Settings → Notification
Settings → Notification delivery health**. The server endpoint reports only
configured/not-configured states plus tenant-scoped seven-day delivery counts;
it never returns SMTP passwords, VAPID private keys, Meta tokens or app secrets.
Use the readiness matrix and Vercel runtime logs to confirm that the committed
five-minute schedules are running successfully.

## Recipient preferences and quiet hours

Run `notification_user_preferences_upgrade.sql` after the in-app, push and
WhatsApp migrations. Users manage their own external channel preferences,
timezone, quiet hours and hourly burst limit under **Users & Roles → Profile →
Notifications**. In-app notifications remain available even when an external
channel is disabled.

Non-urgent external alerts received during quiet hours are deferred to the end
of the quiet period. Only an urgent, acknowledgement-required alert may override
quiet hours when the user permits it; the override is recorded as
`mandatory_alert_override` in `notification_events`. Non-urgent bursts exceeding
the user's hourly ceiling are delayed rather than deleted. The workers remain
backward-compatible while the migration is being rolled out.

After deploying the worker and applying the migration:

### Signed record-link evidence

Run `notification_link_evidence_upgrade.sql` and add a randomly generated
`NOTIFICATION_LINK_SECRET` in Vercel. Optionally set `APP_BASE_URL`; production
defaults to `https://auris-360.vercel.app`. The email worker then signs only
same-origin AURIS360 links for 30 days. Opening the link records the first use
and an aggregate repeat-use count before redirecting to the exact record.

This is explicit link evidence, not invisible open-pixel tracking. It stores no
recipient address, IP address, user agent or raw destination URL. If the secret
is absent, messages retain their direct links and no click evidence is claimed.
If evidence storage is temporarily unavailable, a valid signed link still opens
the requested AURIS360 record. Notification delivery health shows unique record
opens and a bounded delivered-to-opened conversion indicator.

1. Queue one `test_email` to a controlled real mailbox.
2. Invoke the worker with the cron secret instead of waiting for the cron job.
3. Confirm the row advances `pending -> sent -> delivered`.
4. Confirm `provider_message_id`, `sent_at` and `delivered_at` are populated.
5. Test one temporary provider failure and confirm `next_attempt_at` is set.
6. Test an invalid address and confirm the row becomes `skipped` or `bounced`.

After fixing the sender, failed queue rows can be retried with:

```sql
update notification_queue
set status = 'pending',
    error_msg = null,
    retry_count = 0,
    attempt_count = 0,
    next_attempt_at = now(),
    locked_at = null,
    locked_by = null
where status = 'failed'
  and error_msg ilike '%API key is invalid%';
```
