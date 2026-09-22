const BOOTHS = [
  { id: "1", name: "Trick-or-Ink", code: "INK" },
  { id: "2", name: "Hat Trick", code: "HAT" },
  { id: "3", name: "Ghoulish Glam", code: "GLAM" },
  { id: "4", name: "Make a Monster", code: "SKEL" },
  { id: "5", name: "Tarot Reading", code: "TAROT" },
  { id: "6", name: "Drawn Alive", code: "DRAW" },
  { id: "7", name: "Screamometer", code: "SCREAM" },
];

const HOUSE_IDS = [
  "three-doors",
  "marionette",
  "caligari",
  "clowns",
  "illusionist",
  "last-laugh",
  "cursed-cavern",
  "no-one-leaves",
  "prisoner",
  "whispering-woods",
  "slenderman",
  "he-who-watches",
  "abandoned-asylum",
  "forever-patients",
  "living-dead",
];

function isBoothId(id) {
  return BOOTHS.some((b) => b.id === String(id));
}

function isHouseId(id) {
  return HOUSE_IDS.includes(String(id));
}

function boothIdFromCode(value) {
  const code = String(value || "").trim().toUpperCase();
  const row = BOOTHS.find((b) => b.code === code || b.id === String(value || "").trim());
  return row ? row.id : "";
}

module.exports = { BOOTHS, HOUSE_IDS, isBoothId, isHouseId, boothIdFromCode };
