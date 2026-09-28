-- SHYGON TAP V5 — EVENT FUNCTION PERMISSIONS
-- The public profile function is the only place that needs the event resolver.

REVOKE EXECUTE ON FUNCTION public.tap_event_theme_for(TIMESTAMPTZ) FROM anon, authenticated;
