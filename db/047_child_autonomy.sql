-- Children in the authorized household can operate their own pages without a password.
-- The parent capability, approval rules, ownership and accounting remain separate.
CREATE OR REPLACE FUNCTION private.child_spending_guard(f uuid,c uuid,p_parent text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF f IS DISTINCT FROM private.owned_family() OR c IS NULL OR NOT EXISTS
   (SELECT 1 FROM public.children WHERE id=c AND family_id=f)
 THEN RAISE EXCEPTION 'child_not_found'; END IF;
END $$;
