
-- Isolated worker-journal adapter; all permissions remain private/no public grants.
ALTER TABLE private.switch_test_hold ADD COLUMN receipt_wire text;
CREATE FUNCTION private.test_current(i uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('request_id',request_id,'usage_id',request_id,'binding_id',binding_id,
 'console_id',console_id,'sequence',sequence,'authorized_until',floor(extract(epoch FROM authorized_until)),
 'action','start','total_seconds',seconds,'phase',CASE phase WHEN 'active' THEN 'applied' WHEN 'resolved' THEN 'closed' ELSE phase END,
 'command',command,'command_hash',hash) FROM private.switch_test_hold WHERE request_id=i;
$$;
CREATE FUNCTION private.test_unknown(i uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b uuid;
BEGIN
 SELECT binding_id INTO b FROM private.switch_test_hold WHERE request_id=i;
 PERFORM private.test_lock_binding(b);
 UPDATE private.switch_test_hold SET phase='unknown' WHERE request_id=i AND phase='dispatching';
END $$;
CREATE FUNCTION private.test_receipt(i uuid,h text,wire text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o private.switch_test_hold;
BEGIN
 SELECT * INTO o FROM private.switch_test_hold WHERE request_id=i;
 PERFORM private.test_lock_binding(o.binding_id);
 SELECT * INTO o FROM private.switch_test_hold WHERE request_id=i FOR UPDATE;
 IF o.hash IS DISTINCT FROM h OR o.phase NOT IN ('dispatching','unknown','active','resolved')
 THEN RAISE EXCEPTION 'receipt_conflict';END IF;
 IF o.receipt_wire IS NOT NULL AND o.receipt_wire<>wire THEN RAISE EXCEPTION 'receipt_changed';END IF;
 -- Receipt alone never releases hold. Only verified fresh terminal state can.
 UPDATE private.switch_test_hold SET receipt_wire=wire WHERE request_id=i;
END $$;
REVOKE ALL ON FUNCTION private.test_current(uuid),private.test_unknown(uuid),private.test_receipt(uuid,text,text) FROM PUBLIC;
