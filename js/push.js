import { apiUrl } from "./session.js";

const WANT_KEY = "scream-push-wanted";
const SUB_KEY = "scream-push-endpoint";

function isIos() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function wantsPush() {
  try {
    return localStorage.getItem(WANT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setWantsPush(on) {
  try {
    if (on) localStorage.setItem(WANT_KEY, "1");
    else localStorage.removeItem(WANT_KEY);
  } catch {
    /* ignore */
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function vapidKey() {
  const fromConfig = window.HALLOWEEN_CONFIG && window.HALLOWEEN_CONFIG.vapidPublicKey;
  if (fromConfig) return fromConfig;
  const res = await fetch(apiUrl("push"), { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.vapidPublicKey) return "";
  if (window.HALLOWEEN_CONFIG) window.HALLOWEEN_CONFIG.vapidPublicKey = data.vapidPublicKey;
  return data.vapidPublicKey;
}

export async function registerPushWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

function authHeaders() {
  const token = localStorage.getItem("sp-student-jwt");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function currentSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export function paintPushHint() {
  const hint = document.getElementById("pushInstallHint");
  if (!hint) return;
  const show = wantsPush() && isIos() && !isStandalone();
  hint.hidden = !show;
}

export async function syncPushWatch(watchIds) {
  const sessionOn = Boolean(localStorage.getItem("sp-student-jwt"));
  if (!sessionOn || !wantsPush()) return { ok: false };
  const sub = await currentSubscription();
  if (!sub) return { ok: false };
  try {
    const res = await fetch(apiUrl("push"), {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ subscription: sub.toJSON(), watch: watchIds }),
    });
    if (res.status === 404) return enablePushNotifications(watchIds);
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

export async function enablePushNotifications(watchIds = []) {
  setWantsPush(true);
  paintPushHint();
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  if (isIos() && !isStandalone()) {
    return { ok: false, reason: "ios-install" };
  }
  const key = await vapidKey();
  if (!key) return { ok: false, reason: "no-vapid" };
  const reg = await registerPushWorker();
  if (!reg) return { ok: false, reason: "no-worker" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  try {
    localStorage.setItem(SUB_KEY, sub.endpoint);
  } catch {
    /* ignore */
  }
  const res = await fetch(apiUrl("push"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ subscription: sub.toJSON(), watch: watchIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: data.error || "save-failed" };
  paintPushHint();
  return { ok: true };
}

export async function disablePushNotifications() {
  setWantsPush(false);
  paintPushHint();
  try {
    const sub = await currentSubscription();
    if (sub) {
      await fetch(apiUrl("push"), {
        method: "DELETE",
        headers: authHeaders(),
        body: JSON.stringify({ subscription: sub.toJSON() }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

export async function resumePushIfWanted(watchIds = []) {
  paintPushHint();
  if (!wantsPush()) return;
  if (!localStorage.getItem("sp-student-jwt")) return;
  if (isIos() && !isStandalone()) return;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    await enablePushNotifications(watchIds);
  }
}
