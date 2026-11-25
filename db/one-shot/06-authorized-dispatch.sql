
-- Isolated candidate, applied after owner-entry authorization and combined store.
ALTER FUNCTION private.test_dispatch_once(uuid,text) RENAME TO test_dispatch_before_authorization;
CREATE FUNCTION private.test_dispatch_once(i uuid,h text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE o private.switch_test_hold;g private.switch_test_authorization;
BEGIN
 SELECT * INTO o FROM private.switch_test_hold WHERE request_id=i;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM private.test_lock_binding(o.binding_id);
 SELECT * INTO g FROM private.switch_test_authorization WHERE singleton FOR UPDATE;
 IF NOT FOUND OR g.revoked OR g.request_id<>o.request_id OR g.family_id<>o.family_id
 OR g.binding_id<>o.binding_id OR g.device_id<>o.device_id OR g.console_id<>o.console_id
 OR g.seconds<>600 OR clock_timestamp()<g.not_before OR clock_timestamp()>=g.expires_at
 OR g.expires_at IS DISTINCT FROM o.authorized_until
 OR NOT EXISTS(SELECT 1 FROM public.families WHERE id=g.family_id AND owner_id=g.owner_id)
 THEN RETURN false;END IF;
 RETURN private.test_dispatch_before_authorization(i,h);
END $$;
REVOKE ALL ON FUNCTION private.test_dispatch_once(uuid,text),private.test_dispatch_before_authorization(uuid,text) FROM PUBLIC;
