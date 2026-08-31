"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const iteration_budget_1 = require("../core/iteration-budget");
(0, vitest_1.describe)("IterationBudget", () => {
    (0, vitest_1.it)("allows consumption up to max", () => {
        const b = new iteration_budget_1.IterationBudget(3);
        (0, vitest_1.expect)(b.consume()).toBe(true);
        (0, vitest_1.expect)(b.consume()).toBe(true);
        (0, vitest_1.expect)(b.consume()).toBe(true);
        (0, vitest_1.expect)(b.consume()).toBe(false);
        (0, vitest_1.expect)(b.isExhausted).toBe(true);
    });
    (0, vitest_1.it)("refund increases remaining", () => {
        const b = new iteration_budget_1.IterationBudget(2);
        b.consume();
        b.consume();
        (0, vitest_1.expect)(b.isExhausted).toBe(true);
        b.refund();
        (0, vitest_1.expect)(b.remaining).toBe(1);
        (0, vitest_1.expect)(b.consume()).toBe(true);
    });
    (0, vitest_1.it)("toEvent returns correct n and max", () => {
        const b = new iteration_budget_1.IterationBudget(10);
        b.consume();
        b.consume();
        (0, vitest_1.expect)(b.toEvent()).toEqual({ n: 2, max: 10 });
    });
    (0, vitest_1.it)("refund does not go below 0 used", () => {
        const b = new iteration_budget_1.IterationBudget(5);
        b.refund(); // no-op
        (0, vitest_1.expect)(b.remaining).toBe(5);
    });
});
//# sourceMappingURL=iteration-budget.test.js.map