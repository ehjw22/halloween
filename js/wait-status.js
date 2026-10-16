// One source for wait bands. The server (api/_lib/server-auth.js statusForWait) and the
// database (scream_wait_status) use the same numbers; keep all three in step.

export const WAIT_OPEN = 6;
export const WAIT_BUSY = 21;
export const WAIT_LONG = 40;
export const WAIT_MAX = 120;

export function statusFor(minutes, closed = false) {
  if (closed) return "closed";
  if (minutes === null || minutes === undefined || minutes === "") return "open";
  const wait = Math.max(0, Number(minutes) || 0);
  if (wait >= WAIT_LONG) return "long";
  if (wait >= WAIT_BUSY) return "busy";
  if (wait >= WAIT_OPEN) return "open";
  return "gonow";
}

const NAMES = { gonow: "Go now", open: "Open", busy: "Busy", long: "Long", closed: "Closed" };

export function statusName(id) {
  return NAMES[id] || id;
}

/** "Busy 21–39" style label used next to the minutes. */
export function statusRange(id) {
  if (id === "gonow") return `<${WAIT_OPEN} min`;
  if (id === "open") return `${WAIT_OPEN}–${WAIT_BUSY - 1} min`;
  if (id === "busy") return `${WAIT_BUSY}–${WAIT_LONG - 1} min`;
  if (id === "long") return `${WAIT_LONG}+ min`;
  return "";
}

export function statusChipLabel(id) {
  const range = statusRange(id);
  return range ? `${statusName(id)} (${range})` : statusName(id);
}
