const BOOTHS = [
  { id: "1", name: "Trick-or-Ink", code: "INK" },
  { id: "2", name: "Hat Trick", code: "HAT" },
  { id: "8", name: "Cursed Eyeballs", code: "EYE" },
  { id: "9", name: "Jagua Tattoo", code: "JAGUA" },
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

const STAMP_BOOTH_IDS = ["1", "2", "8", "4", "7"];

/** Walk-in houses that publish a wait. Screening LT17A has no wait, so it has no staff scope. */
const STAFF_HOUSES = [
  { id: "three-doors", code: "THREE_DOORS" },
  { id: "marionette", code: "MARIONETTE" },
  { id: "caligari", code: "CALIGARI" },
  { id: "clowns", code: "CLOWNS" },
  { id: "illusionist", code: "ILLUSIONIST" },
  { id: "cursed-cavern", code: "CURSED_CAVERN" },
  { id: "no-one-leaves", code: "NO_ONE_LEAVES" },
  { id: "prisoner", code: "PRISONER" },
  { id: "whispering-woods", code: "WHISPERING_WOODS" },
  { id: "slenderman", code: "SLENDERMAN" },
  { id: "abandoned-asylum", code: "ABANDONED_ASYLUM" },
  { id: "forever-patients", code: "FOREVER_PATIENTS" },
];

function isBoothId(id) {
  return BOOTHS.some((b) => b.id === String(id));
}

function isStampBoothId(id) {
  return STAMP_BOOTH_IDS.includes(String(id));
}

function isHouseId(id) {
  return HOUSE_IDS.includes(String(id));
}

function isStaffHouseId(id) {
  return STAFF_HOUSES.some((house) => house.id === String(id));
}

function boothIdFromCode(value) {
  const code = String(value || "").trim().toUpperCase();
  const row = BOOTHS.find((b) => b.code === code || b.id === String(value || "").trim());
  return row ? row.id : "";
}

module.exports = {
  BOOTHS,
  STAMP_BOOTH_IDS,
  HOUSE_IDS,
  STAFF_HOUSES,
  isBoothId,
  isStampBoothId,
  isHouseId,
  isStaffHouseId,
  boothIdFromCode,
};
