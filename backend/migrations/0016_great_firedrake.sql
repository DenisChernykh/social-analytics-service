ALTER TABLE `accounts` ADD `collection_jobs_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `activity_periods_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `comment_media_state` ADD `unique_saved` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `instagram_api_state` ADD `object_freshness_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `collection_status_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `account_insights_running` ON `account_insights` (`account_id`) WHERE json_extract("account_insights"."payload_json",'$.status')='running';--> statement-breakpoint
CREATE INDEX `collection_account_page` ON `collection_jobs` (`account_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `collection_running_account` ON `collection_jobs` (`account_id`) WHERE "collection_jobs"."status"='running';--> statement-breakpoint
CREATE INDEX `comment_collections_running` ON `comment_collections` (`media_id`) WHERE json_extract("comment_collections"."result_json",'$.status')='running';
--> statement-breakpoint
CREATE INDEX `collection_terminal_leases` ON `collection_jobs` (`account_id`,`lease_expires_at`) WHERE "collection_jobs"."status"!='running' AND "collection_jobs"."lease_expires_at" IS NOT NULL;
--> statement-breakpoint
-- Materialized collection status v1
CREATE VIEW collection_snapshot_facts AS SELECT s.id,s.rowid sequence,s.media_id,s.observed_at,s.operation_id,
  s.provenance_json IS NULL legacy,CASE WHEN json_extract(s.metrics_json,'$.views.value') IS NOT NULL
 OR json_extract(s.metrics_json,'$.reach.value') IS NOT NULL
 OR json_extract(s.metrics_json,'$.likes.value') IS NOT NULL
 OR json_extract(s.metrics_json,'$.comments.value') IS NOT NULL
 OR json_extract(s.story_insights_json,'$.navigationTotal.value') IS NOT NULL THEN s.observed_at WHEN EXISTS (SELECT 1 FROM json_each(s.metrics_json) v WHERE json_extract(v.value,'$.value') IS NOT NULL)
 OR EXISTS (SELECT 1 FROM json_each(s.story_insights_json,'$.navigation') v WHERE json_extract(v.value,'$.value') IS NOT NULL) THEN s.observed_at END useful_at,
  CASE WHEN json_extract(s.metrics_json,'$.views.reason')='request_deferred' OR json_extract(s.metrics_json,'$.reach.reason')='request_deferred' OR json_extract(s.metrics_json,'$.likes.reason')='request_deferred' OR json_extract(s.metrics_json,'$.comments.reason')='request_deferred' OR json_extract(s.metrics_json,'$.saves.reason')='request_deferred' OR json_extract(s.metrics_json,'$.shares.reason')='request_deferred' OR json_extract(s.metrics_json,'$.totalInteractions.reason')='request_deferred' OR json_extract(s.metrics_json,'$.totalWatchTimeMs.reason')='request_deferred' OR json_extract(s.metrics_json,'$.averageWatchTimeMs.reason')='request_deferred' OR json_extract(s.metrics_json,'$.skipRate.reason')='request_deferred' OR json_extract(s.metrics_json,'$.reposts.reason')='request_deferred' OR json_extract(s.metrics_json,'$.facebookViews.reason')='request_deferred' OR json_extract(s.metrics_json,'$.crosspostedViews.reason')='request_deferred' OR json_extract(s.metrics_json,'$.follows.reason')='request_deferred' OR json_extract(s.metrics_json,'$.profileVisits.reason')='request_deferred' THEN 1
  WHEN instr(s.metrics_json,'request_deferred')>0 OR instr(s.metrics_json,char(92))>0
  THEN EXISTS (SELECT 1 FROM json_each(s.metrics_json) v WHERE json_extract(v.value,'$.reason')='request_deferred') ELSE 0 END deferred,
  CASE WHEN json_extract(s.metrics_json,'$.reach.value') IS NOT NULL AND s.observed_at BETWEEN m.published_at+1800000 AND m.published_at+5400000 THEN s.observed_at END reach_1,
  CASE WHEN json_extract(s.metrics_json,'$.reach.value') IS NOT NULL AND s.observed_at BETWEEN m.published_at+18000000 AND m.published_at+25200000 THEN s.observed_at END reach_6,
  CASE WHEN json_extract(s.metrics_json,'$.reach.value') IS NOT NULL AND s.observed_at BETWEEN m.published_at+64800000 AND m.published_at+108000000 THEN s.observed_at END reach_24,
  CASE WHEN json_extract(s.metrics_json,'$.reach.value') IS NOT NULL AND s.observed_at BETWEEN m.published_at+237600000 AND m.published_at+280800000 THEN s.observed_at END reach_72,
  CASE WHEN json_extract(s.metrics_json,'$.reach.value') IS NOT NULL AND s.observed_at BETWEEN m.published_at+561600000 AND m.published_at+648000000 THEN s.observed_at END reach_168,
  CASE WHEN json_extract(s.metrics_json,'$.reach.value') IS NOT NULL AND s.observed_at BETWEEN m.published_at+1166400000 AND m.published_at+1252800000 THEN s.observed_at END reach_336,
  CASE WHEN json_extract(s.metrics_json,'$.reach.value') IS NOT NULL AND s.observed_at BETWEEN m.published_at+2505600000 AND m.published_at+2678400000 THEN s.observed_at END reach_720
FROM media_snapshots s JOIN media m ON m.id=s.media_id;
--> statement-breakpoint
CREATE TRIGGER collection_snapshot_insert AFTER INSERT ON media_snapshots BEGIN
 UPDATE media SET collection_status_json=(SELECT json_set(media.collection_status_json,
  '$.lastSuccess',CASE WHEN json_extract(media.collection_status_json,'$.lastSuccess') IS NULL THEN f.observed_at WHEN f.observed_at IS NULL THEN json_extract(media.collection_status_json,'$.lastSuccess') ELSE MAX(json_extract(media.collection_status_json,'$.lastSuccess'),f.observed_at) END,
  '$.lastUseful',CASE WHEN json_extract(media.collection_status_json,'$.lastUseful') IS NULL THEN f.useful_at WHEN f.useful_at IS NULL THEN json_extract(media.collection_status_json,'$.lastUseful') ELSE MAX(json_extract(media.collection_status_json,'$.lastUseful'),f.useful_at) END,
  '$.legacy',COALESCE(json_extract(media.collection_status_json,'$.legacy'),0)+f.legacy,
  '$.latest',json(CASE WHEN json_extract(media.collection_status_json,'$.latest.at') IS NULL OR f.observed_at>json_extract(media.collection_status_json,'$.latest.at') OR (f.observed_at=json_extract(media.collection_status_json,'$.latest.at') AND f.sequence>json_extract(media.collection_status_json,'$.latest.sequence')) THEN json_object('id',f.id,'sequence',f.sequence,'at',f.observed_at,'operationId',f.operation_id,'deferred',f.deferred) ELSE json_extract(media.collection_status_json,'$.latest') END),
  '$.reachWindows',json_object('1',CASE WHEN json_extract(media.collection_status_json,'$.reachWindows."1"') IS NULL THEN f.reach_1 WHEN f.reach_1 IS NULL THEN json_extract(media.collection_status_json,'$.reachWindows."1"') ELSE MIN(json_extract(media.collection_status_json,'$.reachWindows."1"'),f.reach_1) END,'6',CASE WHEN json_extract(media.collection_status_json,'$.reachWindows."6"') IS NULL THEN f.reach_6 WHEN f.reach_6 IS NULL THEN json_extract(media.collection_status_json,'$.reachWindows."6"') ELSE MIN(json_extract(media.collection_status_json,'$.reachWindows."6"'),f.reach_6) END,'24',CASE WHEN json_extract(media.collection_status_json,'$.reachWindows."24"') IS NULL THEN f.reach_24 WHEN f.reach_24 IS NULL THEN json_extract(media.collection_status_json,'$.reachWindows."24"') ELSE MIN(json_extract(media.collection_status_json,'$.reachWindows."24"'),f.reach_24) END,'72',CASE WHEN json_extract(media.collection_status_json,'$.reachWindows."72"') IS NULL THEN f.reach_72 WHEN f.reach_72 IS NULL THEN json_extract(media.collection_status_json,'$.reachWindows."72"') ELSE MIN(json_extract(media.collection_status_json,'$.reachWindows."72"'),f.reach_72) END,'168',CASE WHEN json_extract(media.collection_status_json,'$.reachWindows."168"') IS NULL THEN f.reach_168 WHEN f.reach_168 IS NULL THEN json_extract(media.collection_status_json,'$.reachWindows."168"') ELSE MIN(json_extract(media.collection_status_json,'$.reachWindows."168"'),f.reach_168) END,'336',CASE WHEN json_extract(media.collection_status_json,'$.reachWindows."336"') IS NULL THEN f.reach_336 WHEN f.reach_336 IS NULL THEN json_extract(media.collection_status_json,'$.reachWindows."336"') ELSE MIN(json_extract(media.collection_status_json,'$.reachWindows."336"'),f.reach_336) END,'720',CASE WHEN json_extract(media.collection_status_json,'$.reachWindows."720"') IS NULL THEN f.reach_720 WHEN f.reach_720 IS NULL THEN json_extract(media.collection_status_json,'$.reachWindows."720"') ELSE MIN(json_extract(media.collection_status_json,'$.reachWindows."720"'),f.reach_720) END))
  FROM collection_snapshot_facts f WHERE f.id=NEW.id) WHERE id=NEW.media_id;
END;
--> statement-breakpoint
CREATE TRIGGER collection_snapshot_delete AFTER DELETE ON media_snapshots BEGIN
 UPDATE media SET collection_status_json=(SELECT json_object('lastSuccess',MAX(f.observed_at),'lastUseful',MAX(f.useful_at),'legacy',COALESCE(SUM(f.legacy),0),
  'latest',json((SELECT json_object('id',f.id,'sequence',f.sequence,'at',f.observed_at,'operationId',f.operation_id,'deferred',f.deferred) FROM collection_snapshot_facts f WHERE f.media_id=media.id ORDER BY f.observed_at DESC,f.sequence DESC LIMIT 1)),
  'reachWindows',json_object('1',MIN(f.reach_1),'6',MIN(f.reach_6),'24',MIN(f.reach_24),'72',MIN(f.reach_72),'168',MIN(f.reach_168),'336',MIN(f.reach_336),'720',MIN(f.reach_720)))
  FROM collection_snapshot_facts f WHERE f.media_id=media.id) WHERE id=OLD.media_id;
END;
--> statement-breakpoint
CREATE TRIGGER collection_snapshot_update AFTER UPDATE ON media_snapshots BEGIN
 UPDATE media SET collection_status_json=(SELECT json_object('lastSuccess',MAX(f.observed_at),'lastUseful',MAX(f.useful_at),'legacy',COALESCE(SUM(f.legacy),0),
  'latest',json((SELECT json_object('id',f.id,'sequence',f.sequence,'at',f.observed_at,'operationId',f.operation_id,'deferred',f.deferred) FROM collection_snapshot_facts f WHERE f.media_id=media.id ORDER BY f.observed_at DESC,f.sequence DESC LIMIT 1)),
  'reachWindows',json_object('1',MIN(f.reach_1),'6',MIN(f.reach_6),'24',MIN(f.reach_24),'72',MIN(f.reach_72),'168',MIN(f.reach_168),'336',MIN(f.reach_336),'720',MIN(f.reach_720)))
  FROM collection_snapshot_facts f WHERE f.media_id=media.id) WHERE id=OLD.media_id OR id=NEW.media_id;
END;
--> statement-breakpoint
CREATE TRIGGER collection_media_retime AFTER UPDATE OF published_at ON media WHEN OLD.published_at!=NEW.published_at BEGIN
 UPDATE media SET collection_status_json=(SELECT json_object('lastSuccess',MAX(f.observed_at),'lastUseful',MAX(f.useful_at),'legacy',COALESCE(SUM(f.legacy),0),
  'latest',json((SELECT json_object('id',f.id,'sequence',f.sequence,'at',f.observed_at,'operationId',f.operation_id,'deferred',f.deferred) FROM collection_snapshot_facts f WHERE f.media_id=media.id ORDER BY f.observed_at DESC,f.sequence DESC LIMIT 1)),
  'reachWindows',json_object('1',MIN(f.reach_1),'6',MIN(f.reach_6),'24',MIN(f.reach_24),'72',MIN(f.reach_72),'168',MIN(f.reach_168),'336',MIN(f.reach_336),'720',MIN(f.reach_720)))
  FROM collection_snapshot_facts f WHERE f.media_id=media.id) WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE VIEW collection_activity_facts AS SELECT a.id,a.account_id,a.observed_at,json_extract(a.payload_json,'$.apiVersion')||'|'||json_extract(a.payload_json,'$.input.timeZone')||'|'||json_extract(a.payload_json,'$.input.from')||'|'||json_extract(a.payload_json,'$.input.to') period_key FROM account_insights a WHERE json_extract(a.payload_json,'$.status')='completed'
 AND json_extract(a.payload_json,'$.input.kind')='activity' AND json_extract(a.payload_json,'$.input.metricType')='total_value'
 AND json_extract(a.payload_json,'$.apiVersion') IS NOT NULL AND json_extract(a.payload_json,'$.input.timeZone') IS NOT NULL
 AND json_extract(a.payload_json,'$.input.from') IS NOT NULL AND json_extract(a.payload_json,'$.input.to') IS NOT NULL
 AND json_extract(a.payload_json,'$.input.breakdown') IS NULL
 AND NOT EXISTS (SELECT 1 FROM json_each(a.payload_json,'$.values') v WHERE json_extract(v.value,'$.reason')='request_deferred')
 AND (SELECT COUNT(DISTINCT saved.value) FROM json_each(a.payload_json,'$.input.metrics') saved WHERE saved.value IN ('views','reach','accounts_engaged','total_interactions','likes','comments','saves','shares','replies','profile_links_taps','follows_and_unfollows','reposts'))=12;
--> statement-breakpoint
CREATE TRIGGER collection_activity_insert AFTER INSERT ON account_insights BEGIN UPDATE accounts SET activity_periods_json=json_set(activity_periods_json,'$.'||json_quote(f.period_key),
 CASE WHEN json_extract(activity_periods_json,'$.'||json_quote(f.period_key)) IS NULL THEN f.observed_at WHEN f.observed_at IS NULL THEN json_extract(activity_periods_json,'$.'||json_quote(f.period_key)) ELSE MAX(json_extract(activity_periods_json,'$.'||json_quote(f.period_key)),f.observed_at) END)
 FROM collection_activity_facts f WHERE f.id=NEW.id AND accounts.id=f.account_id; END;
--> statement-breakpoint
CREATE TRIGGER collection_activity_update AFTER UPDATE ON account_insights BEGIN UPDATE accounts SET activity_periods_json=CASE WHEN (SELECT MAX(observed_at) FROM collection_activity_facts f WHERE f.account_id=OLD.account_id AND f.period_key=json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to')) IS NULL
 THEN json_remove(activity_periods_json,'$.'||json_quote(json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to')))
 ELSE json_set(activity_periods_json,'$.'||json_quote(json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to')), (SELECT MAX(observed_at) FROM collection_activity_facts f WHERE f.account_id=OLD.account_id AND f.period_key=json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to'))) END
 WHERE id=OLD.account_id AND json_extract(OLD.payload_json,'$.status')='completed'
 AND json_extract(OLD.payload_json,'$.input.kind')='activity' AND json_extract(OLD.payload_json,'$.input.metricType')='total_value'
 AND json_extract(OLD.payload_json,'$.apiVersion') IS NOT NULL AND json_extract(OLD.payload_json,'$.input.timeZone') IS NOT NULL
 AND json_extract(OLD.payload_json,'$.input.from') IS NOT NULL AND json_extract(OLD.payload_json,'$.input.to') IS NOT NULL
 AND json_extract(OLD.payload_json,'$.input.breakdown') IS NULL
 AND NOT EXISTS (SELECT 1 FROM json_each(OLD.payload_json,'$.values') v WHERE json_extract(v.value,'$.reason')='request_deferred')
 AND (SELECT COUNT(DISTINCT saved.value) FROM json_each(OLD.payload_json,'$.input.metrics') saved WHERE saved.value IN ('views','reach','accounts_engaged','total_interactions','likes','comments','saves','shares','replies','profile_links_taps','follows_and_unfollows','reposts'))=12 AND json_extract(activity_periods_json,'$.'||json_quote(json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to')))=OLD.observed_at; UPDATE accounts SET activity_periods_json=json_set(activity_periods_json,'$.'||json_quote(f.period_key),
 CASE WHEN json_extract(activity_periods_json,'$.'||json_quote(f.period_key)) IS NULL THEN f.observed_at WHEN f.observed_at IS NULL THEN json_extract(activity_periods_json,'$.'||json_quote(f.period_key)) ELSE MAX(json_extract(activity_periods_json,'$.'||json_quote(f.period_key)),f.observed_at) END)
 FROM collection_activity_facts f WHERE f.id=NEW.id AND accounts.id=f.account_id; END;
--> statement-breakpoint
CREATE TRIGGER collection_activity_delete AFTER DELETE ON account_insights BEGIN UPDATE accounts SET activity_periods_json=CASE WHEN (SELECT MAX(observed_at) FROM collection_activity_facts f WHERE f.account_id=OLD.account_id AND f.period_key=json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to')) IS NULL
 THEN json_remove(activity_periods_json,'$.'||json_quote(json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to')))
 ELSE json_set(activity_periods_json,'$.'||json_quote(json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to')), (SELECT MAX(observed_at) FROM collection_activity_facts f WHERE f.account_id=OLD.account_id AND f.period_key=json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to'))) END
 WHERE id=OLD.account_id AND json_extract(OLD.payload_json,'$.status')='completed'
 AND json_extract(OLD.payload_json,'$.input.kind')='activity' AND json_extract(OLD.payload_json,'$.input.metricType')='total_value'
 AND json_extract(OLD.payload_json,'$.apiVersion') IS NOT NULL AND json_extract(OLD.payload_json,'$.input.timeZone') IS NOT NULL
 AND json_extract(OLD.payload_json,'$.input.from') IS NOT NULL AND json_extract(OLD.payload_json,'$.input.to') IS NOT NULL
 AND json_extract(OLD.payload_json,'$.input.breakdown') IS NULL
 AND NOT EXISTS (SELECT 1 FROM json_each(OLD.payload_json,'$.values') v WHERE json_extract(v.value,'$.reason')='request_deferred')
 AND (SELECT COUNT(DISTINCT saved.value) FROM json_each(OLD.payload_json,'$.input.metrics') saved WHERE saved.value IN ('views','reach','accounts_engaged','total_interactions','likes','comments','saves','shares','replies','profile_links_taps','follows_and_unfollows','reposts'))=12 AND json_extract(activity_periods_json,'$.'||json_quote(json_extract(OLD.payload_json,'$.apiVersion')||'|'||json_extract(OLD.payload_json,'$.input.timeZone')||'|'||json_extract(OLD.payload_json,'$.input.from')||'|'||json_extract(OLD.payload_json,'$.input.to')))=OLD.observed_at; END;
--> statement-breakpoint
CREATE TRIGGER collection_job_insert AFTER INSERT ON collection_jobs WHEN NEW.status!='running' BEGIN UPDATE accounts SET collection_jobs_json=json_set(collection_jobs_json,'$.'||json_quote(CAST(NEW.started_at/86400000 AS INTEGER)||'|'||NEW.origin||'|'||NEW.status),json((SELECT json_object('day',CAST(NEW.started_at/86400000 AS INTEGER),'origin',NEW.origin,'status',NEW.status,
 'count',COUNT(*),'maxStartedAt',MAX(started_at),'lastAttempt',MAX(last_attempt_at),'lastSuccess',MAX(last_success_at),'lastUsefulObservation',MAX(last_useful_observation_at),'lastCompletedAt',MAX(completed_at),
 'pendingParents',COALESCE(SUM(CASE WHEN origin IN ('comments','comments_refresh') AND status='failed' THEN json_array_length(cursor,'$.parents') ELSE 0 END),0))
 FROM collection_jobs WHERE account_id=NEW.account_id AND origin=NEW.origin AND status=NEW.status
 AND started_at>=CAST(NEW.started_at/86400000 AS INTEGER)*86400000 AND started_at<(CAST(NEW.started_at/86400000 AS INTEGER)+1)*86400000))) WHERE id=NEW.account_id AND NEW.status!='running' AND (1); END;
--> statement-breakpoint
CREATE TRIGGER collection_job_delete AFTER DELETE ON collection_jobs WHEN OLD.status!='running' BEGIN UPDATE accounts SET collection_jobs_json=json_set(collection_jobs_json,'$.'||json_quote(CAST(OLD.started_at/86400000 AS INTEGER)||'|'||OLD.origin||'|'||OLD.status),json((SELECT json_object('day',CAST(OLD.started_at/86400000 AS INTEGER),'origin',OLD.origin,'status',OLD.status,
 'count',COUNT(*),'maxStartedAt',MAX(started_at),'lastAttempt',MAX(last_attempt_at),'lastSuccess',MAX(last_success_at),'lastUsefulObservation',MAX(last_useful_observation_at),'lastCompletedAt',MAX(completed_at),
 'pendingParents',COALESCE(SUM(CASE WHEN origin IN ('comments','comments_refresh') AND status='failed' THEN json_array_length(cursor,'$.parents') ELSE 0 END),0))
 FROM collection_jobs WHERE account_id=OLD.account_id AND origin=OLD.origin AND status=OLD.status
 AND started_at>=CAST(OLD.started_at/86400000 AS INTEGER)*86400000 AND started_at<(CAST(OLD.started_at/86400000 AS INTEGER)+1)*86400000))) WHERE id=OLD.account_id AND OLD.status!='running' AND (1); END;
--> statement-breakpoint
CREATE TRIGGER collection_job_update AFTER UPDATE OF account_id,origin,status,started_at,last_attempt_at,last_success_at,last_useful_observation_at,completed_at,cursor ON collection_jobs
 WHEN OLD.status!='running' OR NEW.status!='running' BEGIN
 UPDATE accounts SET collection_jobs_json=json_set(collection_jobs_json,'$.'||json_quote(CAST(OLD.started_at/86400000 AS INTEGER)||'|'||OLD.origin||'|'||OLD.status),json((SELECT json_object('day',CAST(OLD.started_at/86400000 AS INTEGER),'origin',OLD.origin,'status',OLD.status,
 'count',COUNT(*),'maxStartedAt',MAX(started_at),'lastAttempt',MAX(last_attempt_at),'lastSuccess',MAX(last_success_at),'lastUsefulObservation',MAX(last_useful_observation_at),'lastCompletedAt',MAX(completed_at),
 'pendingParents',COALESCE(SUM(CASE WHEN origin IN ('comments','comments_refresh') AND status='failed' THEN json_array_length(cursor,'$.parents') ELSE 0 END),0))
 FROM collection_jobs WHERE account_id=OLD.account_id AND origin=OLD.origin AND status=OLD.status
 AND started_at>=CAST(OLD.started_at/86400000 AS INTEGER)*86400000 AND started_at<(CAST(OLD.started_at/86400000 AS INTEGER)+1)*86400000))) WHERE id=OLD.account_id AND OLD.status!='running' AND (NEW.status='running' OR OLD.account_id!=NEW.account_id OR (CAST(OLD.started_at/86400000 AS INTEGER)||'|'||OLD.origin||'|'||OLD.status)!=(CAST(NEW.started_at/86400000 AS INTEGER)||'|'||NEW.origin||'|'||NEW.status));
 UPDATE accounts SET collection_jobs_json=json_set(collection_jobs_json,'$.'||json_quote(CAST(NEW.started_at/86400000 AS INTEGER)||'|'||NEW.origin||'|'||NEW.status),json((SELECT json_object('day',CAST(NEW.started_at/86400000 AS INTEGER),'origin',NEW.origin,'status',NEW.status,
 'count',COUNT(*),'maxStartedAt',MAX(started_at),'lastAttempt',MAX(last_attempt_at),'lastSuccess',MAX(last_success_at),'lastUsefulObservation',MAX(last_useful_observation_at),'lastCompletedAt',MAX(completed_at),
 'pendingParents',COALESCE(SUM(CASE WHEN origin IN ('comments','comments_refresh') AND status='failed' THEN json_array_length(cursor,'$.parents') ELSE 0 END),0))
 FROM collection_jobs WHERE account_id=NEW.account_id AND origin=NEW.origin AND status=NEW.status
 AND started_at>=CAST(NEW.started_at/86400000 AS INTEGER)*86400000 AND started_at<(CAST(NEW.started_at/86400000 AS INTEGER)+1)*86400000))) WHERE id=NEW.account_id AND NEW.status!='running' AND (1);
END;
--> statement-breakpoint
CREATE TRIGGER collection_comment_insert AFTER INSERT ON comments BEGIN
 INSERT INTO comment_media_state(media_id,unique_saved) VALUES(NEW.media_id,1) ON CONFLICT(media_id) DO UPDATE SET unique_saved=unique_saved+1;
END;
--> statement-breakpoint
CREATE TRIGGER collection_comment_delete AFTER DELETE ON comments BEGIN UPDATE comment_media_state SET unique_saved=unique_saved-1 WHERE media_id=OLD.media_id; END;
--> statement-breakpoint
CREATE TRIGGER collection_comment_move AFTER UPDATE OF media_id ON comments WHEN OLD.media_id!=NEW.media_id BEGIN
 UPDATE comment_media_state SET unique_saved=unique_saved-1 WHERE media_id=OLD.media_id;
 INSERT INTO comment_media_state(media_id,unique_saved) VALUES(NEW.media_id,1) ON CONFLICT(media_id) DO UPDATE SET unique_saved=unique_saved+1;
END;
--> statement-breakpoint
UPDATE media SET collection_status_json=(SELECT json_object('lastSuccess',MAX(f.observed_at),'lastUseful',MAX(f.useful_at),'legacy',COALESCE(SUM(f.legacy),0),
  'latest',json((SELECT json_object('id',f.id,'sequence',f.sequence,'at',f.observed_at,'operationId',f.operation_id,'deferred',f.deferred) FROM collection_snapshot_facts f WHERE f.media_id=media.id ORDER BY f.observed_at DESC,f.sequence DESC LIMIT 1)),
  'reachWindows',json_object('1',MIN(f.reach_1),'6',MIN(f.reach_6),'24',MIN(f.reach_24),'72',MIN(f.reach_72),'168',MIN(f.reach_168),'336',MIN(f.reach_336),'720',MIN(f.reach_720)))
  FROM collection_snapshot_facts f WHERE f.media_id=media.id);
--> statement-breakpoint
UPDATE accounts SET activity_periods_json=COALESCE((SELECT json_group_object(period_key,observed_at) FROM
 (SELECT period_key,MAX(observed_at) observed_at FROM collection_activity_facts WHERE account_id=accounts.id GROUP BY period_key)),'{}');
--> statement-breakpoint
UPDATE accounts SET collection_jobs_json=COALESCE((SELECT json_group_object(bucket_key,json(payload)) FROM (SELECT CAST(started_at/86400000 AS INTEGER)||'|'||origin||'|'||status bucket_key,
 json_object('day',CAST(started_at/86400000 AS INTEGER),'origin',origin,'status',status,'count',COUNT(*),'maxStartedAt',MAX(started_at),'lastAttempt',MAX(last_attempt_at),'lastSuccess',MAX(last_success_at),'lastUsefulObservation',MAX(last_useful_observation_at),'lastCompletedAt',MAX(completed_at),
 'pendingParents',COALESCE(SUM(CASE WHEN origin IN ('comments','comments_refresh') AND status='failed' THEN json_array_length(cursor,'$.parents') ELSE 0 END),0)) payload
 FROM collection_jobs WHERE account_id=accounts.id AND status!='running' GROUP BY CAST(started_at/86400000 AS INTEGER),origin,status)),'{}');
--> statement-breakpoint
UPDATE comment_media_state SET unique_saved=(SELECT COUNT(*) FROM comments WHERE comments.media_id=comment_media_state.media_id);
--> statement-breakpoint
INSERT INTO comment_media_state(media_id,unique_saved) SELECT media_id,COUNT(*) FROM comments GROUP BY media_id
 ON CONFLICT(media_id) DO UPDATE SET unique_saved=excluded.unique_saved;
--> statement-breakpoint
UPDATE instagram_api_state SET object_freshness_json=COALESCE((SELECT json_group_object(object_id,json_object('lastAttempt',lastAttempt,'lastCheck',lastCheck)) FROM (
 SELECT object_id,MAX(lastAttempt) lastAttempt,MAX(lastCheck) lastCheck FROM (
  SELECT key object_id,json_extract(value,'$.lastAttempt') lastAttempt,json_extract(value,'$.lastCheck') lastCheck FROM json_each(instagram_api_state.object_freshness_json)
  UNION ALL
  SELECT object_id,MAX(requested_at) lastAttempt,MAX(CASE WHEN json_extract(payload_json,'$.result')='success' THEN received_at END) lastCheck
  FROM instagram_http_attempts WHERE account_id=instagram_api_state.account_id AND object_id IS NOT NULL AND json_extract(payload_json,'$.requestedApiVersion')=instagram_api_state.api_version GROUP BY object_id
 ) GROUP BY object_id
)),'{}');
