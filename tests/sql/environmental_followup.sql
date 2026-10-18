-- Disposable replay fixtures only. No production notifications or records are created.
begin;
create or replace function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')
$$;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id) values ('e1800000-0000-4000-8000-000000000001'),('e1800000-0000-4000-8000-000000000002');
insert into public.companies(id,name) values ('e1800000-0000-4000-8000-000000000010','ESG replay A'),('e1800000-0000-4000-8000-000000000020','ESG replay B');
insert into public.profiles(id,company_id,full_name,role,status,email) values
 ('e1800000-0000-4000-8000-000000000001','e1800000-0000-4000-8000-000000000010','ESG manager A','admin','active','fixture-a@example.invalid'),
 ('e1800000-0000-4000-8000-000000000002','e1800000-0000-4000-8000-000000000020','ESG manager B','admin','active','fixture-b@example.invalid');
do $$ declare asset uuid; fuel uuid; waste uuid; queued integer; begin
 insert into public.tools_register(company_id,name,category) values ('e1800000-0000-4000-8000-000000000020','Foreign asset','equipment') returning id into asset;
 begin
   insert into public.fuel_consumption(company_id,record_date,fuel_type,quantity,unit,equipment_id)
   values ('e1800000-0000-4000-8000-000000000010','2026-10-18','diesel',100,'litres',asset);
   raise exception 'foreign asset link accepted';
 exception when raise_exception then if sqlerrm not like 'Linked vehicle/equipment must belong%' then raise; end if; end;
 begin
   insert into public.fuel_consumption(company_id,record_date,fuel_type,quantity,unit,carbon_kg)
   values ('e1800000-0000-4000-8000-000000000010','2026-10-18','diesel',100,'litres',268);
   raise exception 'unsourced estimate accepted';
 exception when raise_exception then if sqlerrm not like 'An emissions estimate requires%' then raise; end if; end;
 insert into public.fuel_consumption(company_id,record_date,fuel_type,quantity,unit,carbon_kg,factor_value,factor_unit,factor_source,factor_version,factor_source_url,factor_scope,factor_confirmed)
 values ('e1800000-0000-4000-8000-000000000010','2026-10-18','diesel',100,'litres',266.16,2.66155,'kg CO2e/litres','UK DESNZ 2026; Diesel (100% mineral diesel); 1_101_1012_8_1','2026 July','https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026','Scope 1 combustion',true) returning id into fuel;
 begin
   update public.fuel_consumption set carbon_kg=1 where id=fuel;
   raise exception 'incorrect arithmetic accepted';
 exception when raise_exception then if sqlerrm not like 'Emissions estimate must equal%' then raise; end if; end;
 -- Represent a historic unsourced row, then prove unchanged edits retain it.
 alter table public.fuel_consumption disable trigger esg_fuel_assurance_guard;
 update public.fuel_consumption set carbon_kg=268,factor_value=null,factor_unit=null,factor_source=null,
   factor_version=null,factor_source_url=null,factor_scope=null,factor_confirmed=false where id=fuel;
 alter table public.fuel_consumption enable trigger esg_fuel_assurance_guard;
 update public.fuel_consumption set notes='Historic evidence retained' where id=fuel;
 if (select carbon_kg from public.fuel_consumption where id=fuel)<>268 then raise exception 'legacy estimate was rewritten'; end if;
 begin
   update public.fuel_consumption set quantity=101 where id=fuel;
   raise exception 'legacy estimate recomputed without a source';
 exception when raise_exception then if sqlerrm not like 'An emissions estimate requires%' then raise; end if; end;
 insert into public.hazardous_waste(company_id,waste_name,generation_date,status,planned_collection_date,planned_disposal_date,responsible_profile_id)
 values ('e1800000-0000-4000-8000-000000000010','ESG test waste','2026-10-17','stored','2026-10-20','2026-10-22','e1800000-0000-4000-8000-000000000001') returning id into waste;
 perform public.process_environmental_due_reminders('2026-10-18');
 select count(*) into queued from public.notification_queue where related_id=waste;
 if queued<>2 then raise exception 'expected two planned milestone reminders, got %',queued; end if;
 perform public.process_environmental_due_reminders('2026-10-18');
 if (select count(*) from public.notification_queue where related_id=waste)<>2 then raise exception 'reminders duplicated'; end if;
 if exists(select 1 from public.notification_queue where related_id=waste and (channel<>'in_app' or recipient_profile_id<>'e1800000-0000-4000-8000-000000000001')) then raise exception 'reminder recipient scope failed'; end if;
 update public.hazardous_waste set collection_date='2026-10-19' where id=waste;
 if exists(select 1 from public.notification_queue where related_id=waste and metadata->>'kind'='collection' and status='pending') then raise exception 'completed collection reminder remains pending'; end if;
 update public.hazardous_waste set status='disposed',disposal_date='2026-10-21' where id=waste;
 perform public.process_environmental_due_reminders('2026-10-23');
 if exists(select 1 from public.notification_queue where related_id=waste and status='pending') then raise exception 'disposed waste still has a pending reminder'; end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
   perform public.process_environmental_due_reminders('2026-10-18');raise exception 'non-service reminder execution accepted';
 exception when raise_exception then if sqlerrm<>'Service role required' then raise; end if; end;
end $$;
rollback;
