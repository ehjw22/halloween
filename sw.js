self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SP Scream Fest";
  const options = {
    body: data.body || "A scare house wait time changed.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.walkIn ? "scream-walk-in" : "scream-wait",
    renotify: true,
    requireInteraction: Boolean(data.walkIn),
    vibrate: data.walkIn ? [200, 80, 200] : [120],
    data: { url: data.url || "/#map" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/#map";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});
