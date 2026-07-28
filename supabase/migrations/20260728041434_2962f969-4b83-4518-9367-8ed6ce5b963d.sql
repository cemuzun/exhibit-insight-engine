-- Fix SECURITY DEFINER function: revoke public EXECUTE (trigger runs as owner regardless)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;