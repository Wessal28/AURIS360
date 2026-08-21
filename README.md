# AURIS360
HSE management software  

## Professional foundation scripts

Run `professional_foundations.sql` in Supabase SQL Editor to enable the shared professional backbone:

- chronological audit trail for create/update/delete actions
- generic approval workflow tables
- email, in-app, WhatsApp and SMS notification channel fields
- training requirement matrix
- QR code registry
- company settings for future custom subdomains and tenant defaults

The script is designed to be re-run safely.

## Deployment readiness notes

- AI runs through `/api/ai`; keep provider keys only in Vercel environment variables.
- Use `AI_PROVIDER=openai` with `OPENAI_API_KEY` and `OPENAI_MODEL`, or `AI_PROVIDER=anthropic`/`claude` with the matching Anthropic variables.
- Email notifications are queued in Supabase and sent by `/api/send-emails`.
- On Vercel Hobby, cron schedules are daily only; for near-real-time email notifications use a Pro plan, an external scheduler, or a separate worker.
- The PWA manifest uses relative URLs so the same deployment can support future custom domains.
- After each deploy, manually check login, dashboard load, one print preview, one notification queue item, and mobile/PWA install behaviour.
- After production promotion, require the `Production smoke` workflow to confirm the canonical domain is serving the intended commit and approved production runtime before sign-off.

## Password resets

- Real email users can use the normal password reset email.
- Generated login-only users such as `name@company.local` cannot receive reset emails.
- For login-only users, an admin should open Users & Roles, edit the user, and use Set temporary password.
- The temporary password must be shared directly with the user; the app flags the account so the user must change it on next login.
 
