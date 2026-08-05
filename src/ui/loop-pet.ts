export const LOOP_PET_TIMING = {
  thresholdMs: 45_000,
  minDelayMs: 15_000,
  maxDelayMs: 60_000,
  minVisibleMs: 4_000,
  maxVisibleMs: 7_000,
  cooldownMs: 10 * 60_000,
  frameMs: 520,
} as const;

export const LOOP_PETS = [
  [' /\\_/\\\\\n( o.o )\n > ^ <', ' /\\_/\\\\\n( -.- )\n > ^ <'],
  ['  __\n<(o )___\n ( ._> /', '  __\n<(o )___\n (  _> /'],
  ['  ___\n /o o\\\\\n|  ^  |', '  ___\n /- -\\\\\n|  ^  |', '  ___\n /o o\\\\\n|  -  |'],
] as const;

export interface LoopPetPlan {
  delayMs: number;
  visibleMs: number;
  petIndex: number;
}

export function sampleLoopPetPlan(random: () => number = Math.random): LoopPetPlan {
  return {
    delayMs: sampleRange(LOOP_PET_TIMING.minDelayMs, LOOP_PET_TIMING.maxDelayMs, random()),
    visibleMs: sampleRange(LOOP_PET_TIMING.minVisibleMs, LOOP_PET_TIMING.maxVisibleMs, random()),
    petIndex: Math.min(LOOP_PETS.length - 1, Math.floor(clampUnit(random()) * LOOP_PETS.length)),
  };
}

function sampleRange(minimum: number, maximum: number, sample: number): number {
  return Math.round(minimum + (maximum - minimum) * clampUnit(sample));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 0.999999);
}
