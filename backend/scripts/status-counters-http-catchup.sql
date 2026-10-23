UPDATE instagram_api_state SET object_freshness_json=COALESCE((SELECT json_group_object(object_id,json_object('lastAttempt',lastAttempt,'lastCheck',lastCheck)) FROM (
 SELECT object_id,MAX(lastAttempt) lastAttempt,MAX(lastCheck) lastCheck FROM (
  SELECT key object_id,json_extract(value,'$.lastAttempt') lastAttempt,json_extract(value,'$.lastCheck') lastCheck FROM json_each(instagram_api_state.object_freshness_json)
  UNION ALL
  SELECT object_id,MAX(requested_at) lastAttempt,MAX(CASE WHEN json_extract(payload_json,'$.result')='success' THEN received_at END) lastCheck
  FROM instagram_http_attempts WHERE account_id=instagram_api_state.account_id AND object_id IS NOT NULL AND json_extract(payload_json,'$.requestedApiVersion')=instagram_api_state.api_version GROUP BY object_id
 ) GROUP BY object_id
)),'{}');
