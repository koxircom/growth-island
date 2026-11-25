-- Isolated trusted selector. No UI/request parameter decides which job to execute.
CREATE FUNCTION private.test_select_request(p_session text) RETURNS uuid LANGUAGE sql AS $$
 SELECT request_id FROM private.switch_test_hold
 WHERE phase<>'resolved' OR request_id::text=p_session
 ORDER BY (phase<>'resolved') DESC,sequence DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.test_select_request(text) FROM PUBLIC;
