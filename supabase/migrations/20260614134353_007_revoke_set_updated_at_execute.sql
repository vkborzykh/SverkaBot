-- Revoke EXECUTE on set_updated_at() from public-facing roles.
-- This function is a trigger function and must only fire via trigger mechanism,
-- never be callable directly through PostgREST /rpc/.
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
