-- AURIS 360 Video-to-SOP controlled-workflow upgrade
-- Rerunnable and additive. Existing public.sop_documents records are preserved.
-- No sample projects, transcripts, approvals or evidence are inserted.

begin;
create extension if not exists pgcrypto;

create table if not exists public.sop_video_projects (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  sop_document_id text,
  reference text,
  title text not null,
  site_name text,
  business_unit text,
  language_code text not null default 'en',
  template_code text not null default 'standard',
  privacy_level text not null default 'internal',
  consent_confirmed boolean not null default false,
  source_file_name text,
  source_media_type text,
  source_size_bytes bigint,
  source_checksum text,
  source_storage_path text,
  processing_status text not null default 'draft' check (processing_status in ('draft','uploaded','processing','processing_failed','ready_for_review','in_review','changes_requested','awaiting_approval','approved','published','superseded','withdrawn')),
  processing_stage text not null default 'capture',
  processing_detail jsonb not null default '{}'::jsonb,
  owner_id uuid,
  owner_name text,
  reviewer_id uuid,
  approver_id uuid,
  due_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sop_video_projects_queue on public.sop_video_projects(company_id,processing_status,due_at,created_at desc);

create table if not exists public.sop_video_evidence (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id text not null references public.sop_video_projects(id) on delete cascade,
  sequence_no integer not null,
  evidence_type text not null default 'procedure_step' check (evidence_type in ('transcript','scene','procedure_step','warning','quality_check','abnormal_condition')),
  source_label text not null check (source_label in ('observed','spoken','template_required','policy_legal','ai_inferred','reviewer_added')),
  source_start_seconds numeric,
  source_end_seconds numeric,
  confidence numeric check (confidence is null or (confidence>=0 and confidence<=100)),
  transcript_text text,
  instruction_text text,
  safety_notes text,
  quality_notes text,
  abnormal_condition text,
  image_reference text,
  safety_critical boolean not null default false,
  reviewer_disposition text not null default 'pending' check (reviewer_disposition in ('pending','accepted','amended','rejected','not_required')),
  reviewer_comment text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,evidence_type,sequence_no)
);
create index if not exists sop_video_evidence_project on public.sop_video_evidence(company_id,project_id,sequence_no);

create table if not exists public.sop_video_relationships (
  id text primary key default gen_random_uuid()::text,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id text not null references public.sop_video_projects(id) on delete cascade,
  related_module text not null,
  related_record_id text not null,
  relationship_type text not null default 'related_to',
  revision_code text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(company_id,project_id,related_module,related_record_id,relationship_type)
);
create index if not exists sop_video_relationships_source on public.sop_video_relationships(company_id,related_module,related_record_id);

do $$
declare t text;
begin
  foreach t in array array['sop_video_projects','sop_video_evidence','sop_video_relationships'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_read',t);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or p.company_id=%I.company_id)))',t||'_tenant_read',t,t);
    execute format('drop policy if exists %I on public.%I',t||'_tenant_write',t);
    execute format('create policy %I on public.%I for all using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''document_controller''))))) with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role=''sephs_admin'' or (p.company_id=%I.company_id and p.role in (''admin'',''hse_manager'',''hse_officer'',''manager'',''site_manager'',''supervisor'',''document_controller'')))))',t||'_tenant_write',t,t,t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
