"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IterationBudget = void 0;
class IterationBudget {
    constructor(max) {
        this._used = 0;
        this.max = max;
    }
    consume() {
        if (this._used >= this.max)
            return false;
        this._used++;
        return true;
    }
    refund() {
        if (this._used > 0)
            this._used--;
    }
    get remaining() { return Math.max(0, this.max - this._used); }
    get isExhausted() { return this._used >= this.max; }
    toEvent() {
        return { n: this._used, max: this.max };
    }
}
exports.IterationBudget = IterationBudget;
//# sourceMappingURL=iteration-budget.js.map