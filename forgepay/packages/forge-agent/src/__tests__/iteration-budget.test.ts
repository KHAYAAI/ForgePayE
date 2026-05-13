import { describe, it, expect } from "vitest";
import { IterationBudget } from "../core/iteration-budget";

describe("IterationBudget", () => {
  it("allows consumption up to max", () => {
    const b = new IterationBudget(3);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false);
    expect(b.isExhausted).toBe(true);
  });

  it("refund increases remaining", () => {
    const b = new IterationBudget(2);
    b.consume();
    b.consume();
    expect(b.isExhausted).toBe(true);
    b.refund();
    expect(b.remaining).toBe(1);
    expect(b.consume()).toBe(true);
  });

  it("toEvent returns correct n and max", () => {
    const b = new IterationBudget(10);
    b.consume();
    b.consume();
    expect(b.toEvent()).toEqual({ n: 2, max: 10 });
  });

  it("refund does not go below 0 used", () => {
    const b = new IterationBudget(5);
    b.refund(); // no-op
    expect(b.remaining).toBe(5);
  });
});
