export async function api(action: string, values: Record<string, unknown> = {}) {
  let logoutSubscription: PushSubscription | null = null;
  if (action === "logout" && "serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) { logoutSubscription = subscription; values = { ...values, endpoint: subscription.endpoint }; }
  }
  const response = await fetch("/api/garda", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Garda-Request": "1" },
    body: JSON.stringify({ action, ...values }),
  });
  const result = await response.json() as { error?: string; message?: string; link?: string; id?: string; ok?: boolean; publicKey?: string; subscribed?: boolean; queued?: boolean };
  if (!response.ok) throw new Error(result.error || "Operația nu a putut fi finalizată.");
  if (logoutSubscription) await logoutSubscription.unsubscribe().catch(() => false);
  return result;
}
