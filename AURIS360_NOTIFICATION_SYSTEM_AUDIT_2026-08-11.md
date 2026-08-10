# AURIS 360 Notification System Audit

**Audit date:** 11 August 2026  
**Scope:** Email, WhatsApp, browser/desktop/mobile notifications, in-app notifications, routing, escalation levels, queue processing, delivery evidence, retries and user preferences.

## Executive result

The notification system is **partially implemented**. Email is the only channel with a real server-side delivery worker, but its current once-daily schedule, incomplete preference enforcement and lack of automatic retry prevent it from being treated as reliable for urgent HSE alerts. WhatsApp is represented in contact and preference data only; no WhatsApp provider or dispatcher exists. Browser push has a working service-worker display handler, but there is no subscription or server-delivery path, so desktop/mobile push is dormant. Automatic Level 1-3 escalation is described in the interface but is not implemented by a scheduler.

No live notification was sent and no production setting was changed during this audit. The deployed email endpoint is present and protected, but actual provider credentials and end-to-end delivery cannot be proven without a controlled test. The deployed Resend webhook endpoint returns 404, so delivery/bounce callbacks are not operational.

## Channel status

| Channel | Current status | Evidence | Main gap |
|---|---|---|---|
| Email | **Partially operational** | `notification_queue` producer and `/api/send-emails` worker exist; deployed endpoint returns authenticated 401 when called without its secret | Cron runs once daily; no automatic retry/locking; event preferences are not consistently enforced; provider delivery needs a controlled test |
| WhatsApp | **Not operational** | Contact fields and preferred-channel values exist | No Meta/Twilio provider, templates, dispatcher, consent log, webhook or delivery tracking |
| Browser desktop push | **Not operational** | Deployed `sw.js` contains `push` and `notificationclick` handlers | No permission flow, PushManager subscription, VAPID keys, subscription table or push sender |
| Mobile web push | **Not operational** | Same dormant service-worker handler | No subscription/sender; iOS also requires an installed PWA and explicit permission |
| In-app | **Incomplete** | Administrators can view recent queue records | No personal notification inbox, unread state, acknowledgement, recipient-specific feed or bell workflow |
| SMS | **Not operational** | `preferred_notification_channel` permits `sms` | No SMS provider or worker |

## Current notification flow

1. Module code calls `queueNotification(...)`.
2. The function checks the source relationship, builds a record URL and inserts a `pending` row in `notification_queue`.
3. A Vercel cron calls `/api/send-emails` at `0 9 * * *` (09:00 UTC / 13:00 Dubai).
4. The worker processes at most 50 pending rows and sends through configured SMTP, or Resend as fallback.
5. The queue row becomes `sent` or `failed`.

Important consequences:

- An urgent notification may wait almost 24 hours before processing.
- Failed rows remain failed until manually reset; they are not retried with backoff.
- The worker reads only `pending` rows and does not atomically claim them, so overlapping runs could send duplicates.
- Queue status `sent` proves provider acceptance, not recipient delivery.
- Delivery/bounce tracking is currently broken because `/api/resend-webhook` is not deployed.

## Email findings

### What is working

- The application queues notifications from incident, investigation, permit, risk, document, training, action-plan and system workflows.
- Workflow notifications can retain a related module, record reference and exact record URL.
- Invalid/login-only `.local` addresses are rejected or skipped.
- The sender supports SMTP and Resend.
- The deployed sender endpoint is protected by cron/secret authentication.
- Queue lifecycle events can be audited in `notification_events`.

### Defects and risks

1. **Urgency is incompatible with the cron schedule.** Once-daily processing is insufficient for incidents, emergency escalation, permit changes and critical overdue actions.
2. **No dependable retry policy.** A temporary provider/network error permanently changes the row to `failed`.
3. **No atomic queue claim.** Two workers can select the same pending row.
4. **Preference enforcement is inconsistent.** The worker respects global `email_enabled`, but does not consistently apply event toggles such as incident, permit, audit, investigation and overdue for every producer.
5. **Contact selection is inconsistent.** Some workflows use `real_email`/`notification_email`; incident personnel loading currently selects only the login `email`, so a valid notification address may be ignored.
6. **The test-email button tests queuing, not immediate delivery.** A user can see success even though the provider has not processed the message.
7. **No deployed provider webhook.** The webhook source is outside the Vercel `api` directory and the production `/api/resend-webhook` route returns 404.
8. **Duplicate worker files create drift risk.** The canonical deployed worker should be explicitly identified and duplicate legacy workers retired.
9. **No queue health dashboard.** Administrators cannot readily see age of oldest pending row, retry count, bounce rate or provider failure reason.

## WhatsApp findings

The system currently stores WhatsApp phone numbers and can label a user as WhatsApp-ready, but it does not send WhatsApp messages. Selecting WhatsApp as a preferred channel therefore gives a misleading impression.

Required components:

- Meta WhatsApp Cloud API or Twilio WhatsApp account and verified business/number.
- Approved proactive-message templates for assignment, reminder, escalation and critical alerts.
- Explicit opt-in/consent record, opt-out handling and E.164 number normalization.
- Channel-aware queue rows and a WhatsApp dispatch worker.
- Delivery/read/failure webhook with event audit.
- Retry/backoff, rate-limit handling and fallback to email/in-app.
- Tenant-safe secrets and routing.

Until these exist, hide or label WhatsApp/SMS choices as **Not configured** rather than allowing users to believe they are active.

## Desktop and mobile findings

The service worker can display a push payload and open its record URL, and the production `sw.js` is deployed. However, no code was found to request notification permission, subscribe through `PushManager`, store subscriptions, maintain VAPID keys or send web-push payloads. The handler is therefore dormant.

Required components:

- A clear user opt-in and permission workflow.
- `PushManager.subscribe(...)` registration and renewal.
- VAPID public/private keys stored securely.
- A tenant/user/device subscription table with row-level security.
- A server-side push dispatcher and expired-token cleanup.
- Delivery events, notification click/acknowledgement logging and preference/quiet-hour enforcement.
- Desktop Chrome/Edge, Android PWA and installed iOS PWA acceptance tests.

The application also needs a real in-app inbox containing recipient-specific notifications, unread count, read/acknowledged state, exact source link and history. The existing recent-queue view is an administrative queue, not an end-user notification centre.

## Escalation levels: promised versus implemented

The Master Action Plan interface describes the following hierarchy:

| Level | Intended trigger | Intended recipients | Current reality |
|---|---|---|---|
| 0 - Assigned person | On assignment and 7 days before due date | Assignee | Assignment messages may be queued; no due-soon scheduler was found |
| 1 - Supervisor | 7 days overdue | Assignee + supervisor | UI text only; no automatic job or hierarchy resolver found |
| 2 - Manager | 21 days overdue | Assignee + supervisor + manager/HSE manager | Manual escalation exists; automatic trigger not implemented |
| 3 - Director/Executive | 45 days overdue or critical condition | Executive recipients | UI text only; no automatic trigger, acknowledgement or stop rule found |

The “Daily digest of overdue actions” preference also has no digest-building scheduler. It should not be shown as operational until implemented.

### Recommended governed notification levels

| Level | Meaning | Examples | Default delivery |
|---|---|---|---|
| L0 - Information | Awareness; no immediate response | Assignment, status change, upcoming due date | In-app; optional email digest |
| L1 - Attention | Action required soon/first overdue threshold | 7 days overdue, returned approval, missing evidence | In-app + email to assignee and supervisor |
| L2 - Urgent | Material compliance or control exposure | 21 days overdue, critical investigation action, failed control | In-app + email + push; manager/HSE manager; acknowledgement required |
| L3 - Critical | Immediate executive/emergency attention | Fatality, major emergency, 45 days overdue critical action | In-app + push + email + WhatsApp when configured; executive recipients; acknowledgement and repeat escalation |

Every alert should carry `severity`, `event_type`, `recipient_user_id`, `company_id`, source module/record, due time, channel policy, acknowledgement requirement and deduplication key. Closing, cancelling or acknowledging the source must stop future escalation.

## Remedy plan

### P0 - Make email and escalation trustworthy

1. Deploy the webhook at `/api/resend-webhook` with raw-body signature verification; configure its provider secret; verify delivered, bounced and complained events.
2. Replace once-daily polling with processing every 1-5 minutes for immediate events and a separate scheduled digest job.
3. Add atomic queue claiming, `attempt_count`, `next_attempt_at`, exponential backoff, dead-letter state and idempotency key.
4. Centralize recipient resolution and always prefer verified `real_email`/`notification_email` over login aliases.
5. Centralize event preferences and channel policy so every producer obeys the same rules.
6. Implement a scheduled escalation engine for due-soon, 7, 21 and 45 days, using the organisational reporting hierarchy.
7. Add acknowledgement and escalation-stop rules; prevent duplicate notices for unchanged records.
8. Run a controlled email test to a real test mailbox and confirm queued, sent, delivered, opened/linked-record and bounce paths.

### P1 - Complete in-app and browser/mobile push

1. Build the personal notification inbox and unread/acknowledged state.
2. Add browser permission/subscription management and VAPID-backed delivery.
3. Route L2/L3 alerts to push and test desktop, Android PWA and installed iOS PWA behaviour.
4. Add quiet hours, digest choice and mandatory-alert override with clear user explanations.

### P2 - Add WhatsApp safely

1. Select Meta Cloud API or Twilio and complete business/number verification.
2. Implement consent, templates, dispatcher, webhook, audit and fallback.
3. Enable WhatsApp only for tenants/users with verified configuration and opt-in.
4. Use WhatsApp primarily for L2/L3 alerts or explicit user preference, not as the sole channel.

## Acceptance criteria

- 95% of immediate email jobs begin processing within five minutes.
- Temporary failures retry automatically; permanent failures expose a clear administrator action.
- The same event/recipient/channel combination is not sent twice.
- Every message opens the correct tenant-safe source record.
- Event-specific settings demonstrably suppress allowed optional messages.
- Due-soon and 7/21/45-day escalation tests select the correct hierarchy recipients and stop after closure/acknowledgement.
- Email provider callbacks update delivered/bounced/complained status.
- Browser push works after opt-in on supported desktop and mobile PWA environments.
- WhatsApp cannot be selected unless provider setup and recipient consent are valid.
- Administrators can see channel health, queue age, failure/retry counts and delivery outcomes.

## Recommended implementation sequence

Start with **email reliability and the escalation engine**, then the **personal in-app inbox**, then **browser/mobile push**, and finally **WhatsApp**. This produces a dependable notification foundation before adding more delivery channels and prevents the same routing, retry and audit defects from being duplicated across providers.
