const BOOTHS = [
  { id: "1", name: "Pumpkin Gate", code: "PG" },
  { id: "2", name: "Bat Colony", code: "BAT" },
  { id: "3", name: "Plaza Ghost", code: "GH3" },
  { id: "4", name: "Web Lab", code: "WEB" },
  { id: "5", name: "Candy Court", code: "CND" },
  { id: "6", name: "Crypt Keep", code: "CRY" },
];

const HOUSE_IDS = [
  "dover-gate",
  "aerohub",
  "innovillage",
  "sports-complex",
  "mp-field",
  "atrium",
  "witch-labs",
  "library",
  "admin",
  "plaza",
  "arena",
  "moberly",
  "west-wing",
  "food-court",
  "wsa",
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
