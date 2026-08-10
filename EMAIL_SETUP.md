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

The repository currently schedules `/api/send-emails` once daily because that
frequency is compatible with a Vercel Hobby deployment. This is not suitable
for urgent HSE alerts. For production, use one of the following:

- Vercel Pro cron every five minutes: `*/5 * * * *`; or
- an external trusted scheduler calling `/api/send-emails` with
  `Authorization: Bearer <CRON_SECRET>` every five minutes.

Keep the daily job only for low-priority digests. Immediate and escalation
messages must use the five-minute worker schedule.

## Controlled verification

After deploying the worker and applying the migration:

1. Queue one `test_email` to a controlled real mailbox.
2. Invoke the worker with the cron secret instead of waiting for the daily job.
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
