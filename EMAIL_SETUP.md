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

## Processing frequency

The repository includes Hobby-compatible daily safety schedules for
`/api/send-emails` and `/api/process-escalations`. The escalation thresholds
are day-based, so daily escalation evaluation is safe. Daily email delivery is
not suitable for urgent HSE alerts. For production, use one of the following:

- Vercel Pro cron every five minutes: `*/5 * * * *`; or
- an external trusted scheduler calling both endpoints with
  `Authorization: Bearer <CRON_SECRET>` every five minutes.

On a Vercel Pro deployment, replace the daily email cron with `*/5 * * * *`.
Alternatively, keep the deployable daily safety jobs and let the external
scheduler invoke both endpoints every five minutes. Do not commit a frequent
Vercel cron until the project plan supports it because Vercel rejects the whole
deployment when an unsupported cron cadence is present.

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

The repository retains a Hobby-compatible daily `/api/send-push` safety cron.
Urgent production push requires Vercel Pro or an external scheduler calling the
protected endpoint every five minutes with `Authorization: Bearer <CRON_SECRET>`.
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
Email and in-app remain governed fallbacks. The included daily cron is a safety
run; use a five-minute external or Vercel Pro schedule for urgent use.

## Controlled verification

After deploying the worker and applying the migration:

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
