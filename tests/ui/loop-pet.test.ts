import assert from 'node:assert/strict';
import test from 'node:test';

import { LOOP_PETS, LOOP_PET_TIMING, sampleLoopPetPlan } from '../../src/ui/loop-pet';

test('Loop Pet stays within the restrained timing and frame limits', () => {
  const samples = [0, 0.5, 0.999999];
  let index = 0;
  const plan = sampleLoopPetPlan(() => samples[index++]);

  assert.equal(plan.delayMs, LOOP_PET_TIMING.minDelayMs);
  assert.equal(plan.visibleMs, 5_500);
  assert.equal(plan.petIndex, LOOP_PETS.length - 1);
  assert.ok(LOOP_PETS.every(pet => pet.length >= 2 && pet.length <= 3));
  assert.equal(LOOP_PET_TIMING.thresholdMs, 45_000);
  assert.equal(LOOP_PET_TIMING.cooldownMs, 600_000);
});

test('Loop Pet sampling clamps invalid random values safely', () => {
  const plan = sampleLoopPetPlan(() => Number.NaN);
  assert.equal(plan.delayMs, LOOP_PET_TIMING.minDelayMs);
  assert.equal(plan.visibleMs, LOOP_PET_TIMING.minVisibleMs);
  assert.equal(plan.petIndex, 0);
});
