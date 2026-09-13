const PALETTES = [
  { hue: 28, sat: 92, name: "ember" },
  { hue: 132, sat: 48, name: "ectoplasm" },
  { hue: 272, sat: 58, name: "hex" },
  { hue: 186, sat: 42, name: "mist" },
];

export function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value || "scream");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function ghostTraits(seed) {
  const hash = hashSeed(seed);
  return {
    palette: PALETTES[hash % PALETTES.length],
    eyes: (hash >>> 3) % 5 === 0 ? 3 : 2,
    body: ["round", "tall", "wide"][(hash >>> 5) % 3],
    tilt: ((hash >>> 8) % 9) - 4,
  };
}

export function applyGhostPass(root, { seed, raised, redeemed } = {}) {
  if (!root) return;
  const traits = ghostTraits(seed);
  const { hue, sat } = traits.palette;
  root.style.setProperty("--ghost-h", String(hue));
  root.style.setProperty("--ghost-s", `${sat}%`);
  root.style.setProperty("--ghost-tilt", `${traits.tilt}deg`);
  root.dataset.body = traits.body;
  root.dataset.eyes = String(traits.eyes);
  root.classList.toggle("is-raised", Boolean(raised) && !redeemed);
  root.classList.toggle("is-redeemed", Boolean(redeemed));
  const raiseBtn = root.querySelector("[data-raise-spirit]");
  if (raiseBtn) {
    raiseBtn.disabled = Boolean(redeemed);
    raiseBtn.setAttribute("aria-expanded", raised && !redeemed ? "true" : "false");
  }
}
