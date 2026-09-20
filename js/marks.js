const MARK_V = "r6";

export const MARK_IDS = [
  "pumpkin",
  "bat",
  "ghost",
  "web",
  "candy",
  "crypt",
  "moon",
  "flask",
  "owl",
  "fang",
  "key",
  "lantern",
  "spark",
  "hazard",
  "bite",
  "relay",
];

const PNG_MARKS = new Set(["pumpkin", "bat", "ghost", "web", "candy", "crypt", "bite", "relay"]);

export function markUrl(id) {
  const ext = PNG_MARKS.has(id) ? "png" : "svg";
  return `img/marks/${id}.${ext}?v=${MARK_V}`;
}

export function markImg(id, className = "mark") {
  if (!id) return "";
  return `<img class="${className}" src="${markUrl(id)}" alt="" width="32" height="32" draggable="false">`;
}

export function preloadMarks(ids = MARK_IDS) {
  return ids.map((id) => {
    const img = new Image();
    img.src = markUrl(id);
    return img;
  });
}
