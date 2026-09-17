export const BOOTHS = [
  {
    id: "1",
    icon: "🎃",
    name: "Pumpkin Gate",
    short: "Booth 01",
    code: "PG",
    place: "Gate 1 / Dover approach",
    map: { x: 16, y: 58, side: "w", r: 32 },
    summary: "A carving station near Dover Gate.",
    about:
      "Students decorate mini pumpkins and pick up the night’s route. Staff stamp this booth when you finish the carving or photo challenge. Visit booths in any order.",
  },
  {
    id: "2",
    icon: "🦇",
    name: "Bat Colony",
    short: "Booth 02",
    code: "BAT",
    place: "Aerohub / T18A edge",
    map: { x: 32, y: 18, side: "n", r: 28 },
    summary: "A reflex game under hanging silhouettes.",
    about:
      "Tap glowing bats before they vanish. Complete a round without dropping below the staff score line to earn this stamp.",
  },
  {
    id: "3",
    icon: "👻",
    name: "Plaza Ghost",
    short: "Booth 03",
    code: "GH3",
    place: "Campus plaza",
    map: { x: 50, y: 48, side: "n", r: 34 },
    summary: "A short ghost-story quiz at the fountain.",
    about:
      "Listen to a plaza tale, then answer three questions. Staff stamp when your group gets the haunt facts right.",
  },
  {
    id: "4",
    icon: "🕸️",
    name: "Web Lab",
    short: "Booth 04",
    code: "WEB",
    place: "T11 labs",
    map: { x: 76, y: 20, side: "n", r: 28 },
    summary: "A hands-on web of string, UV paint, and puzzles.",
    about:
      "Follow the lab safety brief, then solve the web maze. This stamp marks a completed puzzle, not a scare-house walkthrough.",
  },
  {
    id: "5",
    icon: "🍬",
    name: "Candy Court",
    short: "Booth 05",
    code: "CND",
    place: "Food court",
    map: { x: 50, y: 84, side: "s", r: 28 },
    summary: "Treats, trivia, and a share-a-sweet challenge.",
    about:
      "Trade a fact about campus safety for candy, or complete the tasting card. Staff stamp once per student number.",
  },
  {
    id: "6",
    icon: "💀",
    name: "Crypt Keep",
    short: "Booth 06",
    code: "CRY",
    place: "WSA / warehouse edge",
    map: { x: 84, y: 64, side: "w", r: 30 },
    summary: "A keepers’ riddle and a group photo at the warehouse.",
    about:
      "A short keepers’ riddle and a group photo. Collect stamps from any six booths, in any order, to unlock Fast Pass.",
  },
];

export function boothById(id) {
  return BOOTHS.find((b) => String(b.id) === String(id));
}
