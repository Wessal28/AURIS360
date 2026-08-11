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

The repository schedules `/api/send-emails` and `/api/process-escalations`
every five minutes. This cadence requires a Vercel plan that supports frequent
cron execution. For production, use one of the following:

- Vercel Pro cron every five minutes: `*/5 * * * *`; or
- an external trusted scheduler calling both endpoints with
  `Authorization: Bearer <CRON_SECRET>` every five minutes.

Keep the daily job only for low-priority digests. Immediate and escalation
messages must use the five-minute worker schedule.

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
