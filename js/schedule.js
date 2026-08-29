/** Night-of programme. Times are 24h, Singapore. */
export const EVENT_DATE_LABEL = "31 Oct 2026";
export const EVENT_TZ = "Asia/Singapore";
export const EVENT_ISO_DATE = "2026-10-31";

export const SCHEDULE = [
  { start: "17:30", end: "18:00", title: "Gates open", place: "Gate 1 / Dover", kind: "ops", note: "Stamp cards and safety brief at Pumpkin Gate." },
  { start: "18:00", end: "18:25", title: "Opening act", place: "Plaza", kind: "performance", note: "Host intro and opening dance." },
  { start: "18:00", end: "22:30", title: "Scare houses open", place: "Campus haunts", kind: "ops", note: "Last entry 22:00. Watch wait times on the map." },
  { start: "18:30", end: "18:55", title: "Vocal set", place: "Plaza stage", kind: "performance", note: "Student singers." },
  { start: "19:00", end: "19:35", title: "Dance crew", place: "Sports Arena", kind: "performance", note: "CCA showcase." },
  { start: "19:45", end: "20:20", title: "Band set", place: "Plaza stage", kind: "performance", note: "Live band." },
  { start: "20:30", end: "20:50", title: "Cosplay walk", place: "Plaza", kind: "performance", note: "Costume parade loop." },
  { start: "21:00", end: "21:25", title: "Guest / finale prep", place: "Arena", kind: "performance", note: "Hold for stage reset." },
  { start: "21:30", end: "22:00", title: "Finale performance", place: "Sports Arena", kind: "performance", note: "Closing number." },
  { start: "22:00", end: "22:30", title: "Last entry / wrap", place: "All houses", kind: "ops", note: "No new queues after 22:00. Fast Pass desk closes with houses." },
];

function minutesNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

export function scheduleStatus(item, date = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  if (day < EVENT_ISO_DATE) return "upcoming";
  if (day > EVENT_ISO_DATE) return "done";
  const now = minutesNow(date);
  const start = toMinutes(item.start);
  const end = toMinutes(item.end);
  if (now < start) return "upcoming";
  if (now >= end) return "done";
  return "live";
}
