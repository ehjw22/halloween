/* Poster-theme station stamps (html[data-art="poster"]). Hand-drawn, flat, thick ink lines.
   The classic PNG marks in img/marks stay untouched; ?theme=classic shows those instead. */

const INK = "#1a0f0c";

const ART = {
  // Trick-or-Ink: a squat ink pot with a skull label and a drip.
  1: `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path class="st-wobble" d="M22 14h20l-1 7c7 3 11 9 11 17 0 11-9 18-20 18S12 49 12 38c0-8 4-14 11-17z" fill="#5b3fd1" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M21 9h22v6H21z" fill="#f2d27a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M24 33c0-5 4-8 8-8s8 3 8 8c0 3-2 5-4 6v3h-8v-3c-2-1-4-3-4-6z" fill="#f6ecd8" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="29" cy="33" r="2" fill="${INK}"/><circle cx="35" cy="33" r="2" fill="${INK}"/>
    <path d="M30 42v-2M34 42v-2" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <path class="st-drip" d="M46 22c3 4 4 7 2 10-2 2-5 0-4-3z" fill="#5b3fd1" stroke="${INK}" stroke-width="2"/>
  </svg>`,
  // Hat Trick: a crooked witch hat with a toss ring around it.
  2: `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path class="st-wobble" d="M34 6c-6 9-11 22-13 36h24c-2-8-3-17 1-25-4 0-8-4-12-11z" fill="#2d2a4a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M8 44c6-4 42-4 48 0 1 4-6 7-24 7S7 48 8 44z" fill="#2d2a4a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M21 40h24l-1 4H22z" fill="#ff7a18" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <ellipse class="st-ring" cx="33" cy="30" rx="17" ry="6" fill="none" stroke="#f2d27a" stroke-width="4"/>
    <ellipse cx="33" cy="30" rx="17" ry="6" fill="none" stroke="${INK}" stroke-width="1.4" stroke-dasharray="3 4"/>
  </svg>`,
  // Cursed Eyeballs: a cup with an eyeball rolling over the rim.
  8: `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path class="st-wobble" d="M12 26h40l-5 28c-1 3-3 4-6 4H23c-3 0-5-1-6-4z" fill="#e2463a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M14 34h36" stroke="#f6ecd8" stroke-width="3" stroke-dasharray="5 4"/>
    <g class="st-roll">
      <circle cx="34" cy="20" r="12" fill="#f6ecd8" stroke="${INK}" stroke-width="3"/>
      <path d="M24 16c3 1 5 0 7-2M41 11c1 3 3 4 5 4" stroke="#c4302b" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <circle cx="37" cy="21" r="5.5" fill="#3fb7a5" stroke="${INK}" stroke-width="2"/>
      <circle cx="38" cy="21" r="2.4" fill="${INK}"/>
      <circle cx="36" cy="19" r="1" fill="#fff"/>
    </g>
  </svg>`,
  // Make a Monster: a stitched skull with a bolt, built from spare bones.
  4: `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M10 52l44-8M10 44l44 8" stroke="#f6ecd8" stroke-width="6" stroke-linecap="round"/>
    <path d="M10 52l44-8M10 44l44 8" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
    <path class="st-wobble" d="M32 6c-12 0-20 8-20 19 0 6 3 10 7 13v7h26v-7c4-3 7-7 7-13 0-11-8-19-20-19z" fill="#9ccf6e" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M18 17h28" stroke="${INK}" stroke-width="2.4"/>
    <path d="M22 14v6M28 14v6M34 14v6M40 14v6" stroke="${INK}" stroke-width="1.8"/>
    <ellipse cx="25" cy="28" rx="4.5" ry="5" fill="${INK}"/><ellipse cx="39" cy="28" rx="4.5" ry="5" fill="${INK}"/>
    <path d="M32 33l-3 4h6z" fill="${INK}"/>
    <path d="M24 41v4M29 41v4M35 41v4M40 41v4" stroke="${INK}" stroke-width="2"/>
    <path class="st-bolt" d="M6 26h6M52 26h6" stroke="#f2d27a" stroke-width="5" stroke-linecap="round"/>
  </svg>`,
  // Screamometer: a gauge pinned in the red with a screaming mouth.
  7: `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path class="st-wobble" d="M6 44a26 26 0 0 1 52 0z" fill="#f6ecd8" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M12 42a20 20 0 0 1 9-16" stroke="#3fb7a5" stroke-width="6" fill="none"/>
    <path d="M22 25a20 20 0 0 1 20 0" stroke="#f2d27a" stroke-width="6" fill="none"/>
    <path d="M43 26a20 20 0 0 1 9 16" stroke="#e2463a" stroke-width="6" fill="none"/>
    <g class="st-needle"><path d="M32 44l17-15" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/></g>
    <circle cx="32" cy="44" r="4" fill="${INK}"/>
    <ellipse cx="32" cy="55" rx="7" ry="5" fill="#2a0d10" stroke="${INK}" stroke-width="2.4"/>
    <path d="M27 53h10" stroke="#f6ecd8" stroke-width="2"/>
  </svg>`,
};

export function stationSvg(boothId) {
  return ART[String(boothId)] || "";
}
