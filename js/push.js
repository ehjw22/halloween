import { apiUrl, apiFetch } from "./session.js?v=310bcfcfa1";

const WANT_KEY = "scream-push-wanted";

function isIos() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent || "");
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function wantsPush() {
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
  const res = await apiFetch(apiUrl("push"), { cache: "no-store", skipAuth: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.vapidPublicKey) return "";
  if (window.HALLOWEEN_CONFIG) window.HALLOWEEN_CONFIG.vapidPublicKey = data.vapidPublicKey;
  return data.vapidPublicKey;
}

export async function registerPushWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js?v=310bcfcfa1", { scope: "/" });
  } catch {
    return null;
  }
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

async function currentSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** True only when this browser holds a live push subscription and permission is granted. */
export async function pushIsLive() {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    return Boolean(await currentSubscription());
  } catch {
    return false;
  }
}

const HINT_DISMISS_KEY = "scream-push-hint-dismiss";

function hintDismissed() {
  try {
    return sessionStorage.getItem(HINT_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissPushHint() {
  try {
    sessionStorage.setItem(HINT_DISMISS_KEY, "1");
  } catch {
    /* private mode */
  }
  paintPushHint();
}

export function paintPushHint() {
  const hint = document.getElementById("pushInstallHint");
  if (!hint) return;
  const show = wantsPush() && isIos() && !isStandalone() && !hintDismissed();
  hint.hidden = !show;
}

export async function syncPushWatch(watchIds) {
  if (!wantsPush()) return { ok: false };
  const sub = await currentSubscription();
  if (!sub) return { ok: false };
  try {
    const res = await apiFetch(apiUrl("push"), {
      method: "PATCH",
      headers: jsonHeaders(),
      asRole: "student",
      body: JSON.stringify({ subscription: sub.toJSON(), watch: watchIds }),
    });
    if (res.status === 404) return enablePushNotifications(watchIds);
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/** Device-aware wording: desktop browsers, Android, and iPhone/iPad all fix this differently. */
export function describePushBlock(reason) {
  const ios = isIos();
  const android = isAndroid();
  if (reason === "signin") {
    return "Sign in first, so we know whose phone to haunt. Then tap Notify again.";
  }
  if (reason === "ios-install" || (ios && reason === "unsupported" && !isStandalone())) {
    return "On iPhone and iPad, add this site to your Home Screen first: tap Share, then Add to Home Screen. Open Scream Fest from that icon, tap Notify, and choose Allow.";
  }
  if (reason === "denied") {
    if (ios) return "Notifications are off for Scream Fest. Open Settings, then Notifications, then Scream Fest, and turn on Allow Notifications.";
    if (android) return "Notifications are blocked. Allow them for this site in your browser (tap the icon next to the address, then Permissions) or in your phone's Settings, then tap Notify again.";
    return "Notifications are blocked for this site. Click the icon next to the address bar, open Site settings, set Notifications to Allow, then click Notify again.";
  }
  if (reason === "unsupported") {
    return "This browser can't do push alerts. Try Chrome, Edge, Firefox or Safari, or just keep this page open.";
  }
  return "The alert didn't stick. Nothing is being watched. Check your connection and try again.";
}

export async function enablePushNotifications(watchIds = []) {
  if (isIos() && !isStandalone()) {
    setWantsPush(true);
    paintPushHint();
    return { ok: false, reason: "ios-install" };
  }
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  if (Notification.permission === "denied") {
    return { ok: false, reason: "denied" };
  }
  try {
    const key = await vapidKey();
    if (!key) return { ok: false, reason: "no-vapid" };
    const reg = await registerPushWorker();
    if (!reg) return { ok: false, reason: "no-worker" };
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    const res = await apiFetch(apiUrl("push"), {
      method: "POST",
      headers: jsonHeaders(),
      asRole: "student",
      body: JSON.stringify({ subscription: sub.toJSON(), watch: watchIds }),
    });
    if (res.status === 401) return { ok: false, reason: "signin" };
    if (!res.ok) return { ok: false, reason: "save-failed" };
    setWantsPush(true);
    paintPushHint();
    return { ok: true };
  } catch {
    return { ok: false, reason: "save-failed" };
  }
}

export async function disablePushNotifications() {
  setWantsPush(false);
  paintPushHint();
  try {
    const sub = await currentSubscription();
    if (sub) {
      await apiFetch(apiUrl("push"), {
        method: "DELETE",
        headers: jsonHeaders(),
        asRole: "student",
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
  if (isIos() && !isStandalone()) return;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    await enablePushNotifications(watchIds);
  }
}
