-- ISOLATED continuation candidate, requires verified terminal journal.
CREATE OR REPLACE FUNCTION private.switch_assert_command_ready(
 p_family uuid,p_binding uuid,p_console text,p_action text,
 p_usage_id uuid,p_sequence bigint,p_boot_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b private.switch_binding%rowtype; state text; session_id_text text; snapshot_sequence bigint;
BEGIN
 PERFORM private.switch_assert_send_ready(p_family,p_binding,p_console);
 SELECT * INTO b FROM private.switch_binding WHERE singleton;
 state:=b.status_snapshot->>'session_state';
 session_id_text:=coalesce(b.status_snapshot->>'session_id','');
 snapshot_sequence:=(b.status_snapshot->>'sequence')::bigint;
 IF b.status_snapshot->>'boot_id' IS DISTINCT FROM p_boot_id
  OR snapshot_sequence IS DISTINCT FROM p_sequence-1
  OR (p_action='start' AND NOT (
    (state='none' AND session_id_text='') OR
    (state='ended' AND EXISTS(SELECT 1 FROM private.switch_sessions previous
      WHERE previous.id::text=session_id_text AND previous.family_id=p_family
       AND previous.device_id=b.device_id AND previous.state='ended'))
    OR (state IN ('ended','exhausted') AND EXISTS(
     SELECT 1 FROM private.switch_test_hold t
     WHERE t.request_id::text=session_id_text AND t.family_id=p_family
      AND t.device_id=b.device_id AND t.binding_id=p_binding AND t.console_id=p_console
      AND t.phase='resolved' AND t.terminal_wire IS NOT NULL
      AND t.sequence=snapshot_sequence
      AND t.terminal_state->>'session_state' IN ('ended','exhausted')
      AND t.terminal_state->>'session_id'=session_id_text
      AND t.terminal_state->>'boot_id'=p_boot_id
      AND (t.terminal_state->>'sample_sequence')::bigint <= (b.status_snapshot->>'sample_sequence')::bigint
    ))
  ))
  OR (p_action IN ('extend','stop') AND (
    state IS NULL OR state NOT IN ('playing','exhausted','ended')
    OR session_id_text IS DISTINCT FROM p_usage_id::text
  )) THEN
  RAISE EXCEPTION 'switch_not_ready';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.switch_assert_command_ready(uuid,uuid,text,text,uuid,bigint,text) FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;

