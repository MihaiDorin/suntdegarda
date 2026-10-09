import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import { z } from "zod";
import { ADMIN_EMAIL } from "@/lib/team";
import { db, digest, fail, now, uuid, type User } from "@/lib/server";
import { monthTitle } from "@/lib/calendar";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22,24}={0,2}$/),
  }),
});

function validEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  const host = url.hostname;
  const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.services.mozilla.com") || host === "web.push.apple.com" ||
    host.endsWith(".web.push.apple.com") || host.endsWith(".notify.windows.com");
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (url.port && url.port !== "443") || !allowed) fail("Serviciul de notificări al browserului nu este recunoscut.");
}

// Generated once in D1. The private key is never returned to the browser or stored in GitHub.
async function vapidKeys(): Promise<VapidKeys> {
  const existing = await db().prepare("SELECT value FROM settings WHERE key='webpush_vapid_v1'").first<{ value: string }>();
  if (existing) return JSON.parse(existing.value) as VapidKeys;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const keys: VapidKeys = {
    publicKey: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url"),
    privateKey: privateKey.d!,
    subject: `mailto:${ADMIN_EMAIL}`,
  };
  await db().prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('webpush_vapid_v1',?)").bind(JSON.stringify(keys)).run();
  const saved = await db().prepare("SELECT value FROM settings WHERE key='webpush_vapid_v1'").first<{ value: string }>();
  return JSON.parse(saved!.value) as VapidKeys;
}

export async function pushAction(action: string, body: Record<string, unknown>, user: User) {
  if (action === "push-config") return { publicKey: (await vapidKeys()).publicKey };
  if (action === "push-subscribe") {
    const subscription = subscriptionSchema.parse(body.subscription);
    validEndpoint(subscription.endpoint);
    const publicKey = Buffer.from(subscription.keys.p256dh, "base64url");
    const auth = Buffer.from(subscription.keys.auth, "base64url");
    if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) fail("Abonamentul de notificări este invalid.");
    try { await crypto.subtle.importKey("raw", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []); }
    catch { fail("Cheia de notificări este invalidă."); }
    const id = await digest(subscription.endpoint);
    const count = await db().prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=? AND id<>?").bind(user.id, id).first<{ n: number }>();
    if (count && count.n >= 10) fail("Ai deja notificările activate pe 10 dispozitive.");
    await vapidKeys();
    await db().batch([
      // A shared browser must never deliver the previous doctor's queued messages.
      db().prepare("DELETE FROM push_deliveries WHERE subscription_id=? AND EXISTS(SELECT 1 FROM push_subscriptions WHERE id=? AND user_id<>?)").bind(id, id, user.id),
      db().prepare("INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth").bind(id, user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now()),
    ]);
    return { ok: true };
  }
  const endpoint = z.string().url().max(2048).parse(body.endpoint);
  const id = await digest(endpoint);
  if (action === "push-unsubscribe") {
    await removePushDevice(user.id, endpoint);
    return { ok: true };
  }
  const subscription = await db().prepare("SELECT id FROM push_subscriptions WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (action === "push-status") return { subscribed: !!subscription };
  if (action === "push-test") {
    if (!subscription) fail("Activează notificările pe acest dispozitiv înainte de probă.");
    const notificationId = uuid();
    await db().batch([
      db().prepare("INSERT INTO notifications(id,user_id,message,read,created) VALUES(?,?,?,0,?)").bind(notificationId, user.id, "Notificările push sunt active. Vei primi anunțurile despre înscrieri, program și schimburi.", now()),
      // The notification trigger creates jobs for all devices; the test targets only this one.
      db().prepare("DELETE FROM push_deliveries WHERE notification_id=? AND subscription_id<>?").bind(notificationId, id),
    ]);
    return { ok: true, queued: true };
  }
  fail("Acțiune de notificare necunoscută.");
}

export async function removePushDevice(userId: string, endpoint: string) {
  await db().prepare("DELETE FROM push_subscriptions WHERE id=? AND user_id=?").bind(await digest(endpoint), userId).run();
}

type Delivery = { id: string; subscription_id: string; notification_id: string; endpoint: string; p256dh: string; auth: string; message: string; attempts: number };
export async function flushPush() {
  const claim = uuid(), time = Date.now();
  // Atomic leases prevent concurrent requests/cron from sending the same job together.
  await db().prepare("UPDATE push_deliveries SET claim=?,attempts=attempts+1,retry_at=? WHERE id IN (SELECT d.id FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id JOIN users u ON u.id=s.user_id WHERE d.done=0 AND d.retry_at<=? AND d.attempts<5 AND u.active=1 AND u.listed=1 AND u.password<>'' ORDER BY d.created LIMIT 10)").bind(claim, time + 60000, time).run();
  const deliveries = (await db().prepare("SELECT d.id,d.subscription_id,d.notification_id,d.attempts,s.endpoint,s.p256dh,s.auth,n.message FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id JOIN notifications n ON n.id=d.notification_id AND n.user_id=s.user_id WHERE d.claim=? AND d.done=0").bind(claim).all()).results as Delivery[];
  if (!deliveries.length) return;
  const keys = await vapidKeys();
  await Promise.all(deliveries.map(async delivery => {
    let status = 0;
    try {
      validEndpoint(delivery.endpoint);
      const payload = await buildPushPayload({
        data: JSON.stringify({ title: "Sunt de gardă", body: delivery.message, tag: `garda-${delivery.notification_id}`, url: "/?notifications=1" }),
        options: { ttl: 86400 },
      }, { endpoint: delivery.endpoint, expirationTime: null, keys: { p256dh: delivery.p256dh, auth: delivery.auth } }, keys);
      const response = await fetch(delivery.endpoint, { ...payload, redirect: "manual", signal: AbortSignal.timeout(7000) });
      status = response.status;
      await response.body?.cancel();
    } catch { /* Retry transient network failures without logging subscription secrets. */ }
    if (status === 404 || status === 410) {
      await db().prepare("DELETE FROM push_subscriptions WHERE id=?").bind(delivery.subscription_id).run();
      return;
    }
    const sent = status >= 200 && status < 300;
    const permanent = status >= 300 && status < 500 && status !== 429;
    await db().prepare("UPDATE push_deliveries SET done=?,retry_at=?,claim=NULL WHERE id=? AND claim=?")
      .bind(sent ? 1 : permanent || delivery.attempts >= 5 ? -1 : 0, Date.now() + 60000 * 2 ** delivery.attempts, delivery.id, claim).run();
  }));
}

export async function closeExpiredEnrollments() {
  const expired = (await db().prepare("SELECT id FROM months WHERE status='open' AND deadline IS NOT NULL AND deadline<=?").bind(now()).all()).results as { id: string }[];
  for (const month of expired) {
    const op = uuid(), created = now();
    await db().batch([
      db().prepare("UPDATE months SET status='closed',version=version+1,mutation=? WHERE id=? AND status='open' AND deadline<=?").bind(op, month.id, created),
      db().prepare("INSERT INTO notifications(id,user_id,message,read,created) SELECT lower(hex(randomblob(16))),u.id,?,0,? FROM users u WHERE u.active=1 AND u.listed=1 AND u.password<>'' AND EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(`S-au închis înscrierile pentru ${monthTitle(month.id)}.`, created, month.id, op),
      db().prepare("INSERT INTO audit(id,user_id,action,created) SELECT ?,u.id,?,? FROM users u WHERE u.email=? AND u.role='admin' AND EXISTS(SELECT 1 FROM months WHERE id=? AND mutation=?)").bind(uuid(), `Înscrieri închise automat: ${month.id}`, created, ADMIN_EMAIL, month.id, op),
    ]);
  }
  await db().prepare("DELETE FROM push_deliveries WHERE created<?").bind(new Date(Date.now() - 7 * 86400000).toISOString()).run();
}
