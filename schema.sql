-- Table: alert_thresholds
CREATE TABLE alert_thresholds (
  id integer NOT NULL,
  station_id character varying NOT NULL,
  tag_key character varying NOT NULL,
  min_value double precision,
  max_value double precision,
  enabled integer,
  last_alerted_ts timestamp with time zone
);

-- Table: logger_latest
CREATE TABLE logger_latest (
  logger_id character varying NOT NULL,
  tag_key character varying NOT NULL,
  data_ts timestamp with time zone NOT NULL,
  value double precision,
  current_ts timestamp with time zone
);

-- Table: logger_readings
CREATE TABLE logger_readings (
  id bigint NOT NULL,
  logger_id character varying NOT NULL,
  tag_key character varying NOT NULL,
  data_ts timestamp with time zone NOT NULL,
  data_save timestamp with time zone,
  value double precision
);

-- Table: logger_stations
CREATE TABLE logger_stations (
  station_id character varying NOT NULL,
  display_name character varying NOT NULL,
  lat double precision,
  lng double precision,
  description text,
  offline_timeout_secs integer,
  last_known_status character varying,
  status_changed_ts timestamp with time zone,
  last_alerted_ts timestamp with time zone,
  repeat_alert_interval_mins integer
);

-- Table: logger_tag_mappings
CREATE TABLE logger_tag_mappings (
  id integer NOT NULL,
  source character varying NOT NULL,
  source_logger_id character varying NOT NULL,
  source_tag_key character varying NOT NULL,
  target_station_id character varying NOT NULL
);

-- Table: telegram_configs
CREATE TABLE telegram_configs (
  id integer NOT NULL,
  bot_token text,
  chat_id text,
  enabled integer,
  alert_interval_minutes integer,
  global_offline_timeout_mins integer
);

-- Table: users
CREATE TABLE users (
  id integer NOT NULL,
  username character varying NOT NULL,
  password_hash text NOT NULL,
  full_name character varying,
  role character varying,
  created_ts timestamp with time zone
);

