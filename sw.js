function safeClientUrl(url) {
  try {
    const parsed = new URL(String(url || "/#map"), self.location.origin);
    if (parsed.origin !== self.location.origin) return "/#map";
    if (!parsed.pathname.startsWith("/")) return "/#map";
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/#map";
  } catch {
    return "/#map";
  }
}

const STATIC_CACHE = "scream-static-v5";

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;
  return true;
}

function cacheKey(req) {
  const url = new URL(req.url);
  return new Request(`${url.pathname}${url.search}`, { method: "GET" });
}

async function putCache(req, res) {
  if (!res || !res.ok || res.type === "opaqueredirect") return;
  const cache = await caches.open(STATIC_CACHE);
  await cache.put(cacheKey(req), res.clone());
}

function withoutStore(res) {
  const headers = new Headers(res.headers);
  headers.delete("cache-control");
  headers.delete("expires");
  headers.delete("pragma");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

async function networkOrCache(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(cacheKey(req));
  try {
    const res = await fetch(req);
    try {
      await putCache(req, res);
    } catch {
      /* a full cache must not hide a page that already loaded */
    }
    if (!res || !res.ok) return cached || res;
    return withoutStore(res);
  } catch {
    if (cached) return cached;
    return fetch(req);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!isCacheable(url)) return;
  event.respondWith(networkOrCache(req));
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
    tag: data.tag || (data.houseId ? `scream-${data.houseId}-${data.level || "wait"}` : "scream-wait"),
    renotify: true,
    requireInteraction: Boolean(data.walkIn),
    vibrate: data.walkIn ? [200, 80, 200] : [120],
    data: { url: safeClientUrl(data.url || "/#map") },
  };
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((client) => client.visibilityState === "visible")) return;
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeClientUrl((event.notification.data && event.notification.data.url) || "/#map");
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
