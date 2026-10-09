/* Notifications only: authenticated pages and API responses are never cached. */
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* Always display a visible notification. */ }
  event.waitUntil(self.registration.showNotification(data.title || "Sunt de gardă", {
    body: data.body || "Ai o notificare nouă în aplicație.",
    icon: "/icon-192.png",
    badge: "/favicon.svg",
    tag: data.tag || "garda-update",
    data: { url: data.url || "/?notifications=1" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    let target = new URL(event.notification.data?.url || "/", self.location.origin);
    if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === target.origin) { await client.navigate(target.href); return client.focus(); }
    }
    return self.clients.openWindow(target.href);
  })());
});
