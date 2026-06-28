-- AURIS360 Legal Compliance RLS repair
-- Run this once in Supabase SQL Editor after legal_schema.sql.
-- It enables company-isolated access for the Legal Compliance tables.

alter table public.legal_requirements enable row level security;
alter table public.legal_changes enable row level security;
alter table public.compliance_assessments enable row level security;
alter table public.compliance_gaps enable row level security;
alter table public.compliance_calendar enable row level security;

drop policy if exists "legal_requirements_select_company" on public.legal_requirements;
create policy "legal_requirements_select_company"
on public.legal_requirements
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = legal_requirements.company_id)
  )
);

drop policy if exists "legal_requirements_insert_company" on public.legal_requirements;
create policy "legal_requirements_insert_company"
on public.legal_requirements
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = legal_requirements.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "legal_requirements_update_company" on public.legal_requirements;
create policy "legal_requirements_update_company"
on public.legal_requirements
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = legal_requirements.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = legal_requirements.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "legal_requirements_delete_company" on public.legal_requirements;
create policy "legal_requirements_delete_company"
on public.legal_requirements
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = legal_requirements.company_id
          and p.role in ('company_admin','hse_manager','admin')
        )
      )
  )
);

drop policy if exists "legal_changes_select_company" on public.legal_changes;
create policy "legal_changes_select_company"
on public.legal_changes
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = legal_changes.company_id)
  )
);

drop policy if exists "legal_changes_insert_company" on public.legal_changes;
create policy "legal_changes_insert_company"
on public.legal_changes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = legal_changes.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "legal_changes_update_company" on public.legal_changes;
create policy "legal_changes_update_company"
on public.legal_changes
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = legal_changes.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = legal_changes.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "legal_changes_delete_company" on public.legal_changes;
create policy "legal_changes_delete_company"
on public.legal_changes
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = legal_changes.company_id
          and p.role in ('company_admin','hse_manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_assessments_select_company" on public.compliance_assessments;
create policy "compliance_assessments_select_company"
on public.compliance_assessments
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = compliance_assessments.company_id)
  )
);

drop policy if exists "compliance_assessments_insert_company" on public.compliance_assessments;
create policy "compliance_assessments_insert_company"
on public.compliance_assessments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_assessments.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_assessments_update_company" on public.compliance_assessments;
create policy "compliance_assessments_update_company"
on public.compliance_assessments
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_assessments.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_assessments.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_assessments_delete_company" on public.compliance_assessments;
create policy "compliance_assessments_delete_company"
on public.compliance_assessments
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_assessments.company_id
          and p.role in ('company_admin','hse_manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_gaps_select_company" on public.compliance_gaps;
create policy "compliance_gaps_select_company"
on public.compliance_gaps
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = compliance_gaps.company_id)
  )
);

drop policy if exists "compliance_gaps_insert_company" on public.compliance_gaps;
create policy "compliance_gaps_insert_company"
on public.compliance_gaps
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_gaps.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_gaps_update_company" on public.compliance_gaps;
create policy "compliance_gaps_update_company"
on public.compliance_gaps
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_gaps.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_gaps.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_gaps_delete_company" on public.compliance_gaps;
create policy "compliance_gaps_delete_company"
on public.compliance_gaps
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_gaps.company_id
          and p.role in ('company_admin','hse_manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_calendar_select_company" on public.compliance_calendar;
create policy "compliance_calendar_select_company"
on public.compliance_calendar
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'sephs_admin' or p.company_id = compliance_calendar.company_id)
  )
);

drop policy if exists "compliance_calendar_insert_company" on public.compliance_calendar;
create policy "compliance_calendar_insert_company"
on public.compliance_calendar
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_calendar.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_calendar_update_company" on public.compliance_calendar;
create policy "compliance_calendar_update_company"
on public.compliance_calendar
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_calendar.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_calendar.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "compliance_calendar_delete_company" on public.compliance_calendar;
create policy "compliance_calendar_delete_company"
on public.compliance_calendar
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'sephs_admin'
        or (
          p.company_id = compliance_calendar.company_id
          and p.role in ('company_admin','hse_manager','admin')
        )
      )
  )
);

notify pgrst, 'reload schema';
