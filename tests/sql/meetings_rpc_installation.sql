-- Schema-only assertions on the disposable migration replay database.
-- Transactional minutes/action behavior is covered by meetings_reliability.sql.
begin;
do $$
declare routine pg_proc; routine_id regprocedure;
begin
 routine_id:=to_regprocedure('public.save_hse_minutes(uuid,jsonb,timestamptz)');
 if routine_id is null then raise exception 'The atomic minutes save RPC is not installed';end if;
 select * into routine from pg_proc where oid=routine_id;
 if routine.proargnames is distinct from array['p_id','p_minutes','p_expected_updated_at']::text[]
  or routine.pronargs<>3 or routine.pronargdefaults<>1
  or routine.prorettype<>'jsonb'::regtype or routine.prokind<>'f'
 then raise exception 'The installed minutes save RPC does not match the frontend named JSON arguments';end if;
 if routine.prosecdef then raise exception 'Minutes save must retain caller table and row policies';end if;
 if not coalesce(routine.proconfig @> array['search_path=public, pg_temp'],false) then raise exception 'Minutes RPC search path is not pinned';end if;
 if has_function_privilege('anon',routine_id,'execute')
  or not has_function_privilege('authenticated',routine_id,'execute') then raise exception 'Minutes save RPC execution grants are incorrect';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.hse_meetings'::regclass and attname='meeting_timezone' and atttypid='text'::regtype and not attisdropped)
  or not exists(select 1 from pg_attribute where attrelid='public.action_tracker'::regclass and attname='meeting_recommendation_key' and atttypid='uuid'::regtype and not attisdropped)
 then raise exception 'Atomic minutes timezone/action identity prerequisites are missing';end if;
 if not exists(select 1 from pg_index where indexrelid='public.meeting_action_identity'::regclass and indisunique)
 then raise exception 'Stable meeting/action identity is not protected';end if;
end $$;
rollback;
