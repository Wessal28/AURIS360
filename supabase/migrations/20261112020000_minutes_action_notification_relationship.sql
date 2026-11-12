-- Meeting minutes save assigned actions in the same transaction. The legacy
-- notification helper omits relationship fields required by the queue check.
begin;

create or replace function public.notify_action_assigned() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  responsible_value text := nullif(btrim(new.responsible), '');
  recipient_email text;
  recipient_name text;
  email_enabled boolean;
  action_ref text;
  action_url text;
  action_description text := coalesce(new.description, 'New action');
  email_body text;
begin
  if responsible_value is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and lower(responsible_value) is not distinct from lower(btrim(old.responsible)) then
    return new;
  end if;

  select settings.email_enabled into email_enabled
  from public.notification_settings settings
  where settings.company_id = new.company_id;
  if email_enabled is false then
    return new;
  end if;

  -- An ambiguous legacy name must not route a notification to an arbitrary person.
  select max(profile.email), max(profile.full_name) into recipient_email, recipient_name
  from public.profiles profile
  where profile.company_id = new.company_id
    and (lower(profile.full_name) = lower(responsible_value) or lower(profile.email) = lower(responsible_value))
  having count(*) = 1;
  if nullif(btrim(recipient_email), '') is null then
    return new;
  end if;

  action_ref := coalesce(nullif(btrim(new.action_ref), ''), new.id::text);
  action_url := 'https://auris360.app/?goto=actions&record=' || new.id::text ||
    '&table=action_tracker&company=' || new.company_id::text;
  email_body := '<!doctype html><html><body><h2>AURIS360 action assigned to you</h2>' ||
    '<p><strong>Action:</strong> ' || replace(replace(replace(action_description, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' ||
    '<p><strong>Priority:</strong> ' || upper(coalesce(new.priority, 'normal')) || '</p>' ||
    '<p><strong>Due date:</strong> ' || coalesce(to_char(coalesce(new.target_date, new.due_date), 'DD Mon YYYY'), 'Not set') || '</p>' ||
    '<p><a href="' || replace(action_url, '&', '&amp;') || '">Open assigned action</a></p></body></html>';

  insert into public.notification_queue (
    company_id, type, subject, body_html, to_email, to_name,
    related_module, related_table, related_id, related_ref, record_url, metadata
  ) values (
    new.company_id, 'action', '[AURIS360] Action Assigned: ' || left(action_description, 60),
    email_body, recipient_email, recipient_name,
    'actions', 'action_tracker', new.id, action_ref, action_url,
    jsonb_build_object('relationship', jsonb_build_object(
      'company_id', new.company_id, 'module', 'actions', 'table', 'action_tracker',
      'id', new.id, 'ref', action_ref, 'url', action_url
    ))
  );
  return new;
end;
$$;

commit;
