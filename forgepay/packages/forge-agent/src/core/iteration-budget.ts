export class IterationBudget {
  readonly max: number;
  private _used = 0;

  constructor(max: number) { this.max = max; }

  consume(): boolean {
    if (this._used >= this.max) return false;
    this._used++;
    return true;
  }

  refund(): void {
    if (this._used > 0) this._used--;
  }

  get remaining(): number { return Math.max(0, this.max - this._used); }
  get isExhausted(): boolean { return this._used >= this.max; }

  toEvent(): { n: number; max: number } {
    return { n: this._used, max: this.max };
  }
}
