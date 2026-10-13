-- A new plan is not operational until reviewed and explicitly activated.
ALTER TABLE public.emergency_plans ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.bcp_records ALTER COLUMN status SET DEFAULT 'draft';

-- A drill is not assessed by merely scheduling it. Existing recorded ratings
-- are preserved; only future inserts without a rating remain unassessed.
ALTER TABLE public.emergency_drills ALTER COLUMN overall_rating DROP DEFAULT;

ALTER TABLE public.emergency_drills ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.emergency_plans(id) ON DELETE SET NULL;
ALTER TABLE public.emergency_drills ADD COLUMN IF NOT EXISTS plan_version text;
ALTER TABLE public.emergency_activations ADD COLUMN IF NOT EXISTS plan_version text;
CREATE INDEX IF NOT EXISTS emergency_drills_plan_id_idx ON public.emergency_drills(plan_id);
ALTER TABLE public.muster_points ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS muster_points_site_id_idx ON public.muster_points(site_id);
