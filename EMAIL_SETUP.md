# AURIS360 Email Setup

Queued app emails are sent by `api/send-emails.js`.

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

After fixing the sender, failed queue rows can be retried with:

```sql
update notification_queue
set status = 'pending',
    error_msg = null,
    retry_count = 0
where status = 'failed'
  and error_msg ilike '%API key is invalid%';
```
