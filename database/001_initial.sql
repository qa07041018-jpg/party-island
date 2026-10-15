CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uid bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 email text UNIQUE, password_hash text, nickname varchar(24) NOT NULL,
 avatar_color varchar(7) NOT NULL DEFAULT '#9c8cff', is_guest boolean NOT NULL DEFAULT false,
 role text NOT NULL DEFAULT 'player' CHECK(role IN ('player','moderator','admin')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
 experience integer NOT NULL DEFAULT 0 CHECK(experience>=0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(is_guest OR (email IS NOT NULL AND password_hash IS NOT NULL))
);
CREATE TABLE refresh_sessions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), family uuid NOT NULL,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz, used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_user_idx ON refresh_sessions(user_id);
CREATE TABLE wallets(user_id uuid PRIMARY KEY REFERENCES users(id), coins bigint NOT NULL DEFAULT 0 CHECK(coins>=0), diamonds bigint NOT NULL DEFAULT 0 CHECK(diamonds>=0));
CREATE TABLE wallet_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),currency text NOT NULL CHECK(currency IN ('coins','diamonds')),amount bigint NOT NULL,idempotency_key text NOT NULL UNIQUE,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rooms(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(48) NOT NULL,
 owner_id uuid NOT NULL REFERENCES users(id), visibility text NOT NULL CHECK(visibility IN ('public','private')),
 password_hash text, capacity integer NOT NULL CHECK(capacity BETWEEN 2 AND 12),
 game text NOT NULL CHECK(game IN ('social','undercover','drawing','werewolf')),
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','playing','closed')),
 notice varchar(300) NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE room_members(
 room_id uuid NOT NULL REFERENCES rooms(id),user_id uuid NOT NULL REFERENCES users(id),
 seat integer NOT NULL CHECK(seat BETWEEN 1 AND 12),joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(room_id,user_id), UNIQUE(room_id,seat), UNIQUE(user_id)
);
CREATE TABLE room_bans(room_id uuid NOT NULL REFERENCES rooms(id),user_id uuid NOT NULL REFERENCES users(id),PRIMARY KEY(room_id,user_id));
CREATE TABLE room_messages(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,room_id uuid NOT NULL REFERENCES rooms(id),user_id uuid NOT NULL REFERENCES users(id),body varchar(500) NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX room_messages_history_idx ON room_messages(room_id,id DESC);
CREATE TABLE audit_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,target_id uuid,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE announcements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title varchar(80) NOT NULL,body varchar(2000) NOT NULL,published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reporter_id uuid NOT NULL REFERENCES users(id),target_id uuid NOT NULL REFERENCES users(id),reason varchar(1000) NOT NULL,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limits(key text PRIMARY KEY,hits integer NOT NULL,reset_at timestamptz NOT NULL);
