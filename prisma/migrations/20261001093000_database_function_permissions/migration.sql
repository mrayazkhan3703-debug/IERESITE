-- Application access uses the private Prisma connection, never direct browser RPC.
-- Preserve extension placement and ownership; constrain exposed API roles only.
CREATE OR REPLACE FUNCTION public.iere_sync_point_geography()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW."lat" IS NULL OR NEW."lng" IS NULL THEN
    NEW."geo" := NULL;
  ELSE
    NEW."geo" := public.ST_SetSRID(public.ST_MakePoint(NEW."lng", NEW."lat"), 4326)::public.geography;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE target_role text; target_function regprocedure;
BEGIN
  FOR target_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.spatial_ref_sys FROM %I', target_role);
  END LOOP;
  REVOKE ALL PRIVILEGES ON TABLE public.spatial_ref_sys FROM PUBLIC;
  FOR target_function IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname = 'iere_sync_point_geography' OR (p.prosecdef AND p.proname IN ('rls_auto_enable', 'st_estimatedextent')))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', target_function);
    FOR target_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', target_function, target_role);
    END LOOP;
  END LOOP;
END;
$$;
