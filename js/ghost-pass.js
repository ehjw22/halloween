const PALETTES = [
  { hue: 28, sat: 92, name: "ember" },
  { hue: 132, sat: 48, name: "ectoplasm" },
  { hue: 272, sat: 58, name: "hex" },
  { hue: 186, sat: 42, name: "mist" },
];

const TITLES = ["Wisp", "Shade", "Keeper", "Specter", "Haunt", "Spark"];

function titleCase(value) {
  return String(value || "")
    .replace(/^\w/, (ch) => ch.toUpperCase());
}

function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value || "scream");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function ghostTraits(seed) {
  const hash = hashSeed(seed);
  const palette = PALETTES[hash % PALETTES.length];
  const title = TITLES[(hash >>> 11) % TITLES.length];
  return {
    palette,
    eyes: 2,
    body: ["round", "tall", "wide"][(hash >>> 5) % 3],
    tilt: ((hash >>> 8) % 9) - 4,
    name: `${titleCase(palette.name)} ${title}`,
  };
}

export function applyGhostPass(root, { seed, raised, redeemed, lit = [], complete = false } = {}) {
  if (!root) return;
  const traits = ghostTraits(seed);
  const { hue, sat } = traits.palette;
  const litIds = new Set(lit.map((id) => String(id)));
  root.style.setProperty("--ghost-h", String(hue));
  root.style.setProperty("--ghost-s", `${sat}%`);
  root.style.setProperty("--ghost-tilt", `${traits.tilt}deg`);
  root.dataset.body = traits.body;
  root.dataset.eyes = String(traits.eyes);
  root.dataset.runes = String(litIds.size);
  root.classList.toggle("is-complete", Boolean(complete));
  root.classList.toggle("is-raised", Boolean(raised) && complete && !redeemed);
  root.classList.toggle("is-redeemed", Boolean(redeemed));
  const nameEl = root.querySelector("[data-spirit-name]");
  if (nameEl) nameEl.textContent = traits.name;
  root.querySelectorAll(".lantern__rune").forEach((btn) => {
    const on = litIds.has(String(btn.dataset.stamp));
    btn.classList.toggle("is-lit", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const raiseBtn = root.querySelector("[data-raise-spirit]");
  if (raiseBtn) {
    raiseBtn.disabled = Boolean(redeemed) || !complete;
    raiseBtn.setAttribute("aria-expanded", (raised || root.classList.contains("is-roaming")) && complete && !redeemed ? "true" : "false");
  }
}
