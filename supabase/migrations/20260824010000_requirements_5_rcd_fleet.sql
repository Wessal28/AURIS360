-- Requirements 5: keep RCD make and distribution-board reference as distinct data.
-- auris360: allow-data-migration
alter table public.tools_register
  add column if not exists distribution_board_reference text;

comment on column public.tools_register.distribution_board_reference is
  'Distribution board reference for an RCD device; brand remains the manufacturer/make.';

-- Preserve existing RCD register data that previously stored the DB reference in brand.
update public.tools_register
set distribution_board_reference = brand,
    brand = null
where distribution_board_reference is null
  and category = 'electrical'
  and (
    statutory_type ilike '%RCD%'
    or name ilike '%RCD%'
    or name ilike '%residual current%'
    or name ilike '%distribution board%'
  )
  and concat_ws(' ', name, model, notes, statutory_type) !~* '(rcd[[:space:]]*(tester|test[[:space:]]*instrument)|test[[:space:]]*instrument|megger|portable[[:space:]]*appliance[[:space:]]*tester)';
