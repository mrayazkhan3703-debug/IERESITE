-- Application access uses the private Prisma connection, never direct browser RPC.
-- Preserve vendor-owned extensions. Deny schema access to exposed API roles;
-- this also blocks extension RPC/table access when extension ACLs are vendor-owned.
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
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
    EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', target_role);
  END LOOP;
  FOR target_function IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND pg_has_role(current_user, p.proowner, 'MEMBER')
      AND (p.proname = 'iere_sync_point_geography' OR (p.prosecdef AND p.proname IN ('rls_auto_enable', 'st_estimatedextent')))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', target_function);
    FOR target_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', target_function, target_role);
    END LOOP;
  END LOOP;
END;
$$;
