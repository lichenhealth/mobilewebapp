-- PRIVACY FIX (founder architecture audit, 2026-08-09): mycelium's SELECT
-- policy was `USING (true)` — any authenticated member could read the whole
-- platform's trust graph directly, not just their own edges. The 2-hop
-- "trusted by someone I trust" feature (Marketplace's trust lens, search,
-- post trust-lines) is the reason it was this open: computing reachability
-- needs to see OTHER people's edges too. Locking the policy down to
-- `truster_id = auth.uid()` and adding a SECURITY DEFINER RPC that computes
-- the same reachability server-side, scoped to only the specific targets a
-- caller already has in view (a search result, a listing's seller) — never
-- a whole-graph read, same posture as is_chat_member()/is_event_attendee().

CREATE OR REPLACE FUNCTION public.trust_edges_for_targets(p_targets jsonb)
RETURNS TABLE(target_type text, target_id uuid, truster_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.target_type, m.target_id, m.truster_id
  FROM public.mycelium m
  JOIN (
    SELECT (t->>'type')::text AS target_type, (t->>'id')::uuid AS target_id
    FROM jsonb_array_elements(p_targets) AS t
  ) tg ON tg.target_type = m.target_type AND tg.target_id = m.target_id
  WHERE m.vouched = true;
$$;

ALTER FUNCTION public.trust_edges_for_targets(jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.trust_edges_for_targets(jsonb) TO authenticated;

DROP POLICY "mycelium: read" ON public.mycelium;
CREATE POLICY "mycelium: read own" ON public.mycelium FOR SELECT
  USING (truster_id = auth.uid());
