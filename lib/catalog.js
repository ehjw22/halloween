const BOOTHS = [
  { id: "1", name: "Pumpkin Gate" },
  { id: "2", name: "Bat Colony" },
  { id: "3", name: "Plaza Ghost" },
  { id: "4", name: "Web Lab" },
  { id: "5", name: "Candy Court" },
  { id: "6", name: "Crypt Keep" },
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

module.exports = { BOOTHS, HOUSE_IDS, isBoothId, isHouseId };
