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

export function PushSettings({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const standalone = matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
  const needsInstall = ios && !standalone;
  const supported = !needsInstall && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const registration = useRef<ServiceWorkerRegistration | null>(null), publicKey = useRef("");
  useEffect(() => {
    if (!supported) return;
    let active = true;
    const refresh = async () => {
      try {
        const [worker, config] = await Promise.all([registerPushWorker(), api("push-config")]);
        const subscription = await worker.pushManager.getSubscription();
        const status = subscription ? await api("push-status", { endpoint: subscription.endpoint }) : null;
        if (active) { registration.current = worker; publicKey.current = config.publicKey ?? ""; setEnabled(!!status?.subscribed && Notification.permission === "granted"); setReady(!!config.publicKey); setError(""); }
      } catch (cause) { if (active) setError((cause as Error).message); }
    };
    void refresh(); window.addEventListener("garda-push-changed", refresh);
    return () => { active = false; window.removeEventListener("garda-push-changed", refresh); };
  }, [userId, supported]);
  const enable = async () => {
    if (!registration.current || !publicKey.current) return;
    // Permission must be requested directly from this tap, never automatically.
    const permission = Notification.permission === "granted" ? Promise.resolve("granted" as NotificationPermission) : Notification.requestPermission();
    setBusy(true); setError(""); setMessage("");
    try {
      if (await permission !== "granted") throw new Error("Permite notificările din setările browserului pentru această adresă, apoi încearcă din nou.");
      const worker = registration.current;
      const subscription = await worker.pushManager.getSubscription() ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(publicKey.current) });
      await api("push-subscribe", { subscription: subscription.toJSON() });
      setEnabled(true); setMessage("Notificările sunt activate pe acest dispozitiv."); window.dispatchEvent(new Event("garda-push-changed"));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true); setError("");
    try {
      const subscription = await registration.current?.pushManager.getSubscription();
      if (subscription) { await api("push-unsubscribe", { endpoint: subscription.endpoint }); await subscription.unsubscribe(); }
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
  if (compact && enabled) return null;
  return <section className={`push-settings ${compact ? "compact" : ""}`}>
    <div className="push-intro"><Smartphone size={21}/><div><strong>Notificări pe acest dispozitiv</strong><p>{needsInstall ? "Pe iPhone: Safari → Partajare → Adaugă pe ecranul principal. Deschide Garda din pictograma nouă, apoi activează notificările (iOS 16.4 sau mai nou)." : !supported ? "Acest browser nu acceptă notificări push. Folosește o versiune recentă de Chrome, Edge, Firefox sau Safari." : enabled ? "Active pentru înscrieri, program și schimburi, inclusiv când aplicația este închisă." : "Primește anunțurile despre înscrieri, program și schimburi chiar când aplicația este închisă."}</p></div></div>
    {supported && <div className="push-actions">{enabled ? <><button className="btn secondary small-btn" disabled={busy} onClick={()=>void test()}><Bell size={16}/>Trimite o probă</button><button className="btn ghost small-btn" disabled={busy} onClick={()=>void disable()}><BellOff size={16}/>Dezactivează</button></> : <button className="btn primary small-btn" disabled={busy || !ready} onClick={()=>void enable()}><Bell size={16}/>{busy ? "Se activează…" : "Activează notificările"}</button>}</div>}
    {error && <p className="push-error" role="alert">{error}</p>}{message && !compact && <p className="push-message" role="status">{message}</p>}
  </section>;
}
