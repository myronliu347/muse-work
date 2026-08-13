const adjectives = [
  "gentle",
  "swift",
  "calm",
  "bold",
  "bright",
  "cool",
  "warm",
  "quiet",
  "fast",
  "brave",
  "wild",
  "smart",
  "clever",
  "kind",
  "wise",
];

const nouns = [
  "breeze",
  "river",
  "mountain",
  "forest",
  "ocean",
  "valley",
  "peak",
  "stream",
  "cloud",
  "storm",
  "eagle",
  "wolf",
  "fox",
  "deer",
  "pike",
];

/** Random adjective-noun-number slug, matching Wave's worktree naming style. */
export function generateRandomName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]!;
  const noun = nouns[Math.floor(Math.random() * nouns.length)]!;
  const n = Math.floor(Math.random() * 900) + 100;
  return `${adj}-${noun}-${n}`;
}
