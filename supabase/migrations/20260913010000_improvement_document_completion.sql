-- Additional document requirements; existing row-level permissions are retained.
begin;
alter table public.toolbox_talks add column if not exists attendance_photo jsonb;
alter table public.risk_assessments add column if not exists risk_matrix_snapshot jsonb;
alter table public.documents add column if not exists template_definition jsonb;
comment on column public.toolbox_talks.attendance_photo is 'Compressed group photo and upload metadata, protected by the toolbox talk row permissions.';
comment on column public.risk_assessments.risk_matrix_snapshot is 'Assessment-specific 5x5 risk matrix. Null preserves the original AURIS matrix.';
comment on column public.documents.template_definition is 'Validated reusable company risk assessment or matrix definition.';
notify pgrst, 'reload schema';
commit;
