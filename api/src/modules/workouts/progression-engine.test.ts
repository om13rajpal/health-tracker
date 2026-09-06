import { describe, it, expect } from "vitest";
import {
  applyBodyweightSession,
  applyBarbellSession,
  type BodyweightProgressionState,
  type BarbellProgressionState,
} from "./progression-engine.js";

function freshBodyweightState(overrides: Partial<BodyweightProgressionState> = {}): BodyweightProgressionState {
  return {
    phase: "bodyweight",
    level: 0,
    repRangeLow: 8,
    repRangeHigh: 15,
    consecutiveTopOfRange: 0,
    consecutiveBelowRange: 0,
    ...overrides,
  };
}

describe("applyBodyweightSession", () => {
  it("does nothing on a single session that hits the top of the range", () => {
    const state = freshBodyweightState();
    const result = applyBodyweightSession(state, [15, 15, 15], 2);
    expect(result.advanced).toBe(false);
    expect(result.nextState.consecutiveTopOfRange).toBe(1);
    expect(result.nextState.level).toBe(0);
  });

  it("advances one level after 2 consecutive top-of-range sessions at RIR <= 3", () => {
    const state = freshBodyweightState({ consecutiveTopOfRange: 1 });
    const result = applyBodyweightSession(state, [15, 15, 15], 2);
    expect(result.advanced).toBe(true);
    expect(result.nextState.level).toBe(1);
    expect(result.nextState.consecutiveTopOfRange).toBe(0);
  });

  it("does not count a top-of-range session toward advancing if RIR is above 3", () => {
    const state = freshBodyweightState();
    const result = applyBodyweightSession(state, [15, 15, 15], 5);
    expect(result.nextState.consecutiveTopOfRange).toBe(0);
  });

  it("does not regress after a single below-range session", () => {
    const state = freshBodyweightState();
    const result = applyBodyweightSession(state, [5, 5, 5], 3);
    expect(result.regressed).toBe(false);
    expect(result.nextState.consecutiveBelowRange).toBe(1);
  });

  it("regresses one level after 3 consecutive below-range sessions", () => {
    const state = freshBodyweightState({ level: 2, consecutiveBelowRange: 2 });
    const result = applyBodyweightSession(state, [5, 5, 5], 3);
    expect(result.regressed).toBe(true);
    expect(result.nextState.level).toBe(1);
    expect(result.nextState.consecutiveBelowRange).toBe(0);
  });

  it("resets both counters on a mid-range session that neither hits top nor falls below", () => {
    const state = freshBodyweightState({ consecutiveTopOfRange: 1, consecutiveBelowRange: 1 });
    const result = applyBodyweightSession(state, [10, 10, 10], 3);
    expect(result.nextState.consecutiveTopOfRange).toBe(0);
    expect(result.nextState.consecutiveBelowRange).toBe(0);
    expect(result.advanced).toBe(false);
    expect(result.regressed).toBe(false);
  });
});

describe("applyBarbellSession", () => {
  function freshBarbellState(overrides: Partial<BarbellProgressionState> = {}): BarbellProgressionState {
    return {
      phase: "barbell",
      loadKg: 40,
      increment: 2.5,
      consecutiveMisses: 0,
      ...overrides,
    };
  }

  it("adds the increment after all prescribed reps are hit", () => {
    const state = freshBarbellState();
    const result = applyBarbellSession(state, [5, 5, 5], 5);
    expect(result.loadIncreased).toBe(true);
    expect(result.nextState.loadKg).toBe(42.5);
    expect(result.nextState.consecutiveMisses).toBe(0);
  });

  it("keeps the same load and increments the miss counter after a missed rep", () => {
    const state = freshBarbellState();
    const result = applyBarbellSession(state, [5, 5, 3], 5);
    expect(result.loadIncreased).toBe(false);
    expect(result.nextState.loadKg).toBe(40);
    expect(result.nextState.consecutiveMisses).toBe(1);
  });

  it("deloads 10% after 3 consecutive misses and resets the miss counter", () => {
    const state = freshBarbellState({ consecutiveMisses: 2 });
    const result = applyBarbellSession(state, [5, 5, 3], 5);
    expect(result.deloaded).toBe(true);
    expect(result.nextState.loadKg).toBe(36);
    expect(result.nextState.consecutiveMisses).toBe(0);
  });
});
