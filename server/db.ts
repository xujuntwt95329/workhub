import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir } from "node:fs/promises";
export interface Sql {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
const migration = `
CREATE TABLE IF NOT EXISTS schema_migrations(version integer primary key);
CREATE TABLE IF NOT EXISTS records(
 id text PRIMARY KEY, key text NOT NULL, kind text NOT NULL, task_id text REFERENCES records(id), project_id text REFERENCES records(id),
 title text NOT NULL, body text NOT NULL DEFAULT '', status text NOT NULL, data jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1, approved_version integer, sequence bigserial UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_task_idx ON records(task_id,kind);
CREATE INDEX IF NOT EXISTS records_kind_idx ON records(kind,status);
ALTER TABLE records ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS revisions(id bigserial primary key, record_id text NOT NULL REFERENCES records(id), version integer NOT NULL, snapshot jsonb NOT NULL, actor_id text NOT NULL, UNIQUE(record_id,version));
CREATE TABLE IF NOT EXISTS events(id bigserial primary key, task_id text, actor_id text NOT NULL, action text NOT NULL, record_id text, title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reviews(id text primary key, task_id text, record_id text NOT NULL REFERENCES records(id), version integer NOT NULL, status text NOT NULL DEFAULT 'pending', comment text NOT NULL DEFAULT '', actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users(id text primary key, name text NOT NULL, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash text primary key, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS tokens(id text primary key, hash text UNIQUE NOT NULL, name text NOT NULL, task_ids jsonb NOT NULL, permissions jsonb NOT NULL, expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS settings(key text primary key,value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(key text primary key, request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reports(id text primary key,task_id text NOT NULL REFERENCES records(id), data jsonb NOT NULL, kind text NOT NULL DEFAULT 'snapshot',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS assistant_runs(id text primary key,task_id text,question text NOT NULL,status text NOT NULL,answer text, sources jsonb NOT NULL DEFAULT '[]', fingerprint text, error text, usage jsonb, generation integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, next_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE TABLE IF NOT EXISTS oauth_clients(id text primary key,name text NOT NULL,redirect_uris jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_codes(hash text primary key,client_id text NOT NULL,redirect_uri text NOT NULL,challenge text NOT NULL,resource text NOT NULL,expires_at timestamptz NOT NULL,used boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS oauth_refresh(hash text primary key,client_id text NOT NULL,token_id text NOT NULL REFERENCES tokens(id),expires_at timestamptz NOT NULL,used boolean NOT NULL DEFAULT false);
ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'workhub:read workhub:write';
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
export async function openDatabase(
  url?: string,
  dir?: string,
): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    await pool.query(migration);
    return {
      query: async <T>(sql: string, p?: unknown[]) => ({
        rows: (await pool.query(sql, p)).rows as T[],
      }),
      transaction: async <T>(fn: (tx: Sql) => Promise<T>) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const value = await fn({
            query: async <R>(sql: string, p?: unknown[]) => ({
              rows: (await c.query(sql, p)).rows as R[],
            }),
          });
          await c.query("COMMIT");
          return value;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (dir) await mkdir(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.exec(migration);
  return {
    query: <T>(sql: string, p?: unknown[]) => db.query<T>(sql, p),
    transaction: <T>(fn: (tx: Sql) => Promise<T>) =>
      db.transaction((tx) =>
        fn({ query: <R>(sql: string, p?: unknown[]) => tx.query<R>(sql, p) }),
      ),
    close: () => db.close(),
  };
}
