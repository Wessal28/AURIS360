-- AURIS360 Chemical Control RLS repair
-- Run this in Supabase SQL Editor if Chemical records can be created but cannot be updated or deleted.

drop policy if exists "chemical_register_update_company" on public.chemical_register;
create policy "chemical_register_update_company"
on public.chemical_register
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
          p.company_id = chemical_register.company_id
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
          p.company_id = chemical_register.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

drop policy if exists "chemical_register_delete_company" on public.chemical_register;
create policy "chemical_register_delete_company"
on public.chemical_register
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
          p.company_id = chemical_register.company_id
          and p.role in ('company_admin','hse_manager','site_manager','supervisor','manager','admin')
        )
      )
  )
);

-- Cleanup the temporary diagnostic record created during troubleshooting.
delete from public.chemical_register
where product_name like 'CODEx DELETE TEST %';

notify pgrst, 'reload schema';
