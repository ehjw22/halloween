export const BOOTHS = [
  {
    id: "1",
    icon: "web",
    name: "Trick-or-Ink",
    short: "Booth 01",
    code: "INK",
    place: "Eleven Square",
    map: { x: 22, y: 26, side: "n", r: 22 },
    summary: "Temporary tattoos, up to three designs each.",
    about:
      "Spice up your look with a temporary tattoo, free. Each person can take up to three designs.",
  },
  {
    id: "2",
    icon: "pumpkin",
    name: "Hat Trick",
    short: "Booth 02",
    code: "HAT",
    place: "Eleven Square",
    map: { x: 30, y: 52, side: "w", r: 22 },
    summary: "Ring toss. Five throws.",
    about:
      "A carnival ring toss with Halloween targets: witch hats, bottles painted for the night, and graveyard stands. You get five throws.",
  },
  {
    id: "3",
    icon: "ghost",
    name: "Ghoulish Glam",
    short: "Booth 03",
    code: "GLAM",
    place: "Eleven Square",
    map: { x: 78, y: 26, side: "n", r: 22 },
    summary: "Halloween face paint.",
    about:
      "Get into the night with Halloween face paint. Pick a design and wear it through the houses.",
  },
  {
    id: "4",
    icon: "crypt",
    name: "Make a Monster",
    short: "Booth 04",
    code: "SKEL",
    place: "Eleven Square",
    map: { x: 50, y: 24, side: "n", r: 22 },
    summary: "Build a skeleton before the time runs out.",
    about:
      "A race for observation, memory, and teamwork. Assemble the skeleton correctly before the clock runs out.",
  },
  {
    id: "5",
    icon: "moon",
    name: "Tarot Reading",
    short: "Booth 05",
    code: "TAROT",
    place: "Eleven Square",
    map: { x: 28, y: 76, side: "s", r: 22 },
    summary: "A reading for the night.",
    about:
      "Sit for a tarot reading. A short, personal look at the supernatural side of the night.",
  },
  {
    id: "6",
    icon: "spark",
    name: "Drawn Alive",
    short: "Booth 06",
    code: "DRAW",
    place: "Eleven Square",
    map: { x: 70, y: 52, side: "e", r: 22 },
    summary: "A polaroid portrait to keep.",
    about:
      "Leave with a personalised drawing in polaroid form. It is yours to keep.",
  },
  {
    id: "7",
    icon: "fang",
    name: "Screamometer",
    short: "Booth 07",
    code: "SCREAM",
    place: "Eleven Square",
    map: { x: 72, y: 76, side: "s", r: 22 },
    summary: "One voice. Clear 85 decibels.",
    about:
      "Scream into the meter. One voice has to push the reading above 85 decibels.",
  },
];

/** Food stalls. They show in the booths list and do not take a stamp. */
export const FOOD_BOOTHS = [
  {
    id: "food-1",
    icon: "candy",
    name: "Food booth",
    short: "Food",
    place: "Eleven Square",
    summary: "Add the stall name and what it serves.",
    about: "Replace this with the stall's name and menu.",
    food: true,
  },
  {
    id: "food-2",
    icon: "candy",
    name: "Food booth",
    short: "Food",
    place: "Eleven Square",
    summary: "Add the stall name and what it serves.",
    about: "Replace this with the stall's name and menu.",
    food: true,
  },
  {
    id: "food-3",
    icon: "candy",
    name: "Food booth",
    short: "Food",
    place: "Eleven Square",
    summary: "Add the stall name and what it serves.",
    about: "Replace this with the stall's name and menu.",
    food: true,
  },
];

export function boothById(id) {
  const key = String(id);
  return BOOTHS.find((b) => String(b.id) === key) || FOOD_BOOTHS.find((b) => String(b.id) === key);
}
