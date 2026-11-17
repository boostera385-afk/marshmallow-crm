CREATE OR REPLACE FUNCTION public.get_users_totp_status()
RETURNS TABLE (user_id UUID, has_totp BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role) 
    OR public.has_role(auth.uid(), 'cs_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT 
    p.id AS user_id, 
    COALESCE(bool_or(f.status = 'verified'), false) AS has_totp
  FROM public.profiles p
  LEFT JOIN auth.mfa_factors f ON f.user_id = p.id AND f.factor_type = 'totp'
  GROUP BY p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_users_totp_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_users_totp_status() TO authenticated, service_role;

