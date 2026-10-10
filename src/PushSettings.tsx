import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Smartphone } from "lucide-react";
import { api } from "./api";

let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;
export function registerPushWorker() {
  registrationPromise ??= navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
    .then(async registration => {
      if (registration.active) return registration;
      return navigator.serviceWorker.ready;
    }).catch(error => { registrationPromise = undefined; throw error; });
  return registrationPromise;
}

function applicationKey(value: string) {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

type DevicePreference = "enabled" | "disabled";
const remembered = new Map<string, DevicePreference>();
function devicePreference(userId: string) {
  try {
    const value = localStorage.getItem(`garda.push-device.v1:${userId}`);
    if (value === "enabled" || value === "disabled") return value;
  } catch { /* Storage may be restricted by the browser. */ }
  return remembered.get(userId) ?? null;
}
function rememberPreference(userId: string, value: DevicePreference) {
  remembered.set(userId, value);
  try { localStorage.setItem(`garda.push-device.v1:${userId}`, value); } catch { /* Keep the choice for this session. */ }
}

type DeviceState = { worker: ServiceWorkerRegistration; publicKey: string; enabled: boolean };
const synchronizing = new Map<string, Promise<DeviceState>>();
function syncDevice(userId: string): Promise<DeviceState> {
  const pending = synchronizing.get(userId);
  if (pending) return pending;
  const promise = (async () => {
    const [worker, config] = await Promise.all([registerPushWorker(), api("push-config")]);
    if (!config.publicKey) throw new Error("Notificările nu sunt disponibile momentan.");
    let subscription = await worker.pushManager.getSubscription();
    const preference = devicePreference(userId);
    // Migrate an existing browser permission; a recorded refusal always wins.
    const wanted = preference === "enabled" || preference === null && Notification.permission === "granted";
    if (wanted && Notification.permission === "granted") {
      subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(config.publicKey) });
      const status = await api("push-status", { endpoint: subscription.endpoint });
      if (!status.subscribed) await api("push-subscribe", { subscription: subscription.toJSON() });
      if (preference === null) rememberPreference(userId, "enabled");
      return { worker, publicKey: config.publicKey, enabled: true };
    }
    if (preference === "disabled" && subscription) {
      await api("push-unsubscribe", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    return { worker, publicKey: config.publicKey, enabled: false };
  })();
  synchronizing.set(userId, promise);
  void promise.finally(() => { if (synchronizing.get(userId) === promise) synchronizing.delete(userId); }).catch(() => {});
  return promise;
}

export function PushSettings({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const standalone = matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
  const needsInstall = ios && !standalone;
  const supported = !needsInstall && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  const [enabled, setEnabled] = useState(() => devicePreference(userId) === "enabled"), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [checking, setChecking] = useState(supported), [message, setMessage] = useState(""), [error, setError] = useState("");
  const registration = useRef<ServiceWorkerRegistration | null>(null), publicKey = useRef("");
  useEffect(() => {
    if (!supported) return;
    let active = true;
    const refresh = async () => {
      try {
        const state = await syncDevice(userId);
        if (active) { registration.current = state.worker; publicKey.current = state.publicKey; setEnabled(state.enabled); setReady(true); setError(""); }
      } catch (cause) { if (active) setError((cause as Error).message); }
      finally { if (active) setChecking(false); }
    };
    const storage = (event: StorageEvent) => { if (event.key === `garda.push-device.v1:${userId}`) void refresh(); };
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh(); window.addEventListener("garda-push-changed", refresh); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.removeEventListener("garda-push-changed", refresh); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visible); };
  }, [userId, supported]);
  const enable = async () => {
    if (!registration.current || !publicKey.current) return;
    // Permission must be requested directly from this tap, never automatically.
    const permission = Notification.permission === "granted" ? Promise.resolve("granted" as NotificationPermission) : Notification.requestPermission();
    setBusy(true); setError(""); setMessage("");
    try {
      if (await permission !== "granted") { rememberPreference(userId, "disabled"); setEnabled(false); throw new Error("Notificările sunt oprite. Le poți permite din setările browserului."); }
      const worker = registration.current;
      const subscription = await worker.pushManager.getSubscription() ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(publicKey.current) });
      await api("push-subscribe", { subscription: subscription.toJSON() });
      rememberPreference(userId, "enabled");
      setEnabled(true); setMessage("Notificările sunt activate pe acest dispozitiv."); window.dispatchEvent(new Event("garda-push-changed"));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true); setError("");
    try {
      const subscription = await registration.current?.pushManager.getSubscription();
      if (subscription) { await api("push-unsubscribe", { endpoint: subscription.endpoint }); await subscription.unsubscribe(); }
      rememberPreference(userId, "disabled");
      setEnabled(false); setMessage("Notificările sunt dezactivate pe acest dispozitiv."); window.dispatchEvent(new Event("garda-push-changed"));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setError("");
    try {
      const subscription = await registration.current?.pushManager.getSubscription();
      if (!subscription) throw new Error("Reactivează notificările pe acest dispozitiv.");
      await api("push-test", { endpoint: subscription.endpoint });
      setMessage("Notificarea de probă este în curs de trimitere. Verifică notificările telefonului.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  // Keep device synchronization mounted without adding a banner to every page.
  if (compact) return null;
  return <section className={`push-settings ${compact ? "compact" : ""}`}>
    <div className="push-intro"><Smartphone size={21}/><div><strong>Notificări pe acest dispozitiv</strong><p>{needsInstall ? "Pe iPhone: Safari → Partajare → Adaugă pe ecranul principal, apoi deschide aplicația din pictogramă." : !supported ? "Acest browser nu acceptă notificări push." : checking ? "Se încarcă setarea…" : enabled ? "Activate pe acest dispozitiv." : "Dezactivate pe acest dispozitiv."}</p></div></div>
    {supported && !checking && <div className="push-actions">{enabled ? <><button className="btn secondary small-btn" disabled={busy || !ready} onClick={()=>void test()}><Bell size={16}/>Trimite o probă</button><button className="btn ghost small-btn" disabled={busy} onClick={()=>void disable()}><BellOff size={16}/>Dezactivează</button></> : <button className="btn primary small-btn" disabled={busy || !ready} onClick={()=>void enable()}><Bell size={16}/>{busy ? "Se activează…" : "Activează notificările"}</button>}</div>}
    {error && <p className="push-error" role="alert">{error}</p>}{message && !compact && <p className="push-message" role="status">{message}</p>}
  </section>;
}
