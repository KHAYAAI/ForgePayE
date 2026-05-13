import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../memory/in-memory-store";

describe("InMemoryStore", () => {
  it("starts with empty recall", async () => {
    const store = new InMemoryStore();
    const result = await store.recall("merchant_1");
    expect(result).toBe("");
  });

  it("stores and recalls key-value entries", async () => {
    const store = new InMemoryStore();
    await store.store("merchant_1", "preferred_currency", "USD");
    await store.store("merchant_1", "timezone", "America/New_York");
    const result = await store.recall("merchant_1");
    expect(result).toContain("preferred_currency");
    expect(result).toContain("USD");
    expect(result).toContain("timezone");
  });

  it("upserts existing key", async () => {
    const store = new InMemoryStore();
    await store.store("m1", "key", "old_value");
    await store.store("m1", "key", "new_value");
    const result = await store.recall("m1");
    expect(result).toContain("new_value");
    expect(result).not.toContain("old_value");
  });

  it("stores session summaries", async () => {
    const store = new InMemoryStore();
    await store.appendSessionSummary("m1", "Merchant prefers monthly invoices.");
    const summaries = await store.getRecentSummaries("m1", 3);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].summary).toBe("Merchant prefers monthly invoices.");
  });

  it("returns most recent summaries first", async () => {
    const store = new InMemoryStore();
    await store.appendSessionSummary("m1", "First session");
    await store.appendSessionSummary("m1", "Second session");
    const summaries = await store.getRecentSummaries("m1", 2);
    expect(summaries[0].summary).toBe("Second session");
  });

  it("isolates between merchants", async () => {
    const store = new InMemoryStore();
    await store.store("m1", "key", "value1");
    await store.store("m2", "key", "value2");
    const r1 = await store.recall("m1");
    const r2 = await store.recall("m2");
    expect(r1).toContain("value1");
    expect(r1).not.toContain("value2");
    expect(r2).toContain("value2");
  });
});
