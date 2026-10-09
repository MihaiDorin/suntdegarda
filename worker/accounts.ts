import { db, digest, equal, now, randomToken, runtime, type User } from "@/lib/server";
import { ADMIN_EMAIL, INITIAL_DOCTORS, normalizeDoctorName, unclaimedEmail } from "@/lib/team";

const TEAM_VERSION = "named-doctors-v2";

// Profiles retain their IDs so existing schedules and scores keep their owners.
// Credentials are reset only by the administrator's explicit reset action.
export async function initializeTeam() {
  const columns = (await db().prepare("PRAGMA table_info(users)").all()).results;
  if (!columns.some(c => c.name === "listed")) {
    try { await db().prepare("ALTER TABLE users ADD COLUMN listed INTEGER NOT NULL DEFAULT 1").run(); }
    catch (error) {
      const current = (await db().prepare("PRAGMA table_info(users)").all()).results;
      if (!current.some(c => c.name === "listed")) throw error;
    }
  }
  if (await db().prepare("SELECT value FROM settings WHERE key=?").bind(TEAM_VERSION).first()) return;
  const existing = (await db().prepare("SELECT * FROM users ORDER BY created,id").all()).results as User[];
  const used = new Set<string>();
  const profiles = INITIAL_DOCTORS.map(doctor => {
    const found = doctor.administrator
      ? existing.find(u => u.email.toLowerCase() === ADMIN_EMAIL)
      : existing.find(u => !used.has(u.id) && u.email.toLowerCase() !== ADMIN_EMAIL && normalizeDoctorName(u.name) === normalizeDoctorName(doctor.name));
    const id = found?.id ?? doctor.id;
    used.add(id);
    return { ...doctor, id, email: doctor.administrator ? ADMIN_EMAIL : found?.email ?? unclaimedEmail(id) };
  });
  const guard = "NOT EXISTS(SELECT 1 FROM settings WHERE key='named-doctors-v2')";
  await db().batch([
    db().prepare(`UPDATE users SET listed=0,active=0,role='doctor' WHERE ${guard}`),
    ...profiles.map(p => db().prepare(`INSERT INTO users(id,name,email,password,role,active,base_points,created,listed) SELECT ?,?,?,'',?,1,0,?,1 WHERE ${guard} ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,role=excluded.role,listed=1,active=1`).bind(p.id,p.name,p.email,p.administrator?"admin":"doctor",now())),
    db().prepare(`DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE listed=0) AND ${guard}`),
    db().prepare(`INSERT INTO settings(key,value) SELECT ?,? WHERE ${guard}`).bind(TEAM_VERSION,now()),
  ]);
}

export async function setupComplete() {
  return !!await db().prepare("SELECT id FROM users WHERE email=? AND role='admin' AND listed=1 AND password<>''").bind(ADMIN_EMAIL).first();
}

export async function publicDoctors() {
  return (await db().prepare("SELECT id,name,CASE WHEN password<>'' THEN 1 ELSE 0 END AS registered,CASE WHEN role='admin' AND email=? THEN 1 ELSE 0 END AS administrator FROM users WHERE listed=1 AND active=1 ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,name COLLATE NOCASE").bind(ADMIN_EMAIL).all()).results;
}

export async function validSetupToken(token: string) {
  const configured = runtime("BOOTSTRAP_TOKEN");
  if (configured && equal(token, configured)) return true;
  const temporary = await db().prepare("SELECT value FROM settings WHERE key='owner_setup_token'").first<{value:string}>();
  if (!temporary) return false;
  const value = JSON.parse(temporary.value) as { hash: string; expires: number };
  return value.expires > Date.now() && equal(await digest(token), value.hash);
}

export async function resetAccounts() {
  const token = randomToken();
  await db().batch([
    db().prepare("DELETE FROM sessions"),
    db().prepare("DELETE FROM resets"),
    db().prepare("DELETE FROM limits"),
    db().prepare("UPDATE users SET email=CASE WHEN role='admin' AND listed=1 THEN ? ELSE 'unclaimed-'||id||'@garda.invalid' END,password=''").bind(ADMIN_EMAIL),
    db().prepare("DELETE FROM settings WHERE key='bootstrap_done'"),
    db().prepare("INSERT INTO settings(key,value) VALUES('owner_setup_token',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({hash:await digest(token),expires:Date.now()+3600000})),
    db().prepare("INSERT INTO settings(key,value) VALUES('accounts_reset_v2',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(now()),
  ]);
  return token;
}
