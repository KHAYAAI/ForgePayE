export declare class IterationBudget {
    readonly max: number;
    private _used;
    constructor(max: number);
    consume(): boolean;
    refund(): void;
    get remaining(): number;
    get isExhausted(): boolean;
    toEvent(): {
        n: number;
        max: number;
    };
}
//# sourceMappingURL=iteration-budget.d.ts.map