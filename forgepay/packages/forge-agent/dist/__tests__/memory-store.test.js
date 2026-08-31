"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const in_memory_store_1 = require("../memory/in-memory-store");
(0, vitest_1.describe)("InMemoryStore", () => {
    (0, vitest_1.it)("starts with empty recall", async () => {
        const store = new in_memory_store_1.InMemoryStore();
        const result = await store.recall("merchant_1");
        (0, vitest_1.expect)(result).toBe("");
    });
    (0, vitest_1.it)("stores and recalls key-value entries", async () => {
        const store = new in_memory_store_1.InMemoryStore();
        await store.store("merchant_1", "preferred_currency", "USD");
        await store.store("merchant_1", "timezone", "America/New_York");
        const result = await store.recall("merchant_1");
        (0, vitest_1.expect)(result).toContain("preferred_currency");
        (0, vitest_1.expect)(result).toContain("USD");
        (0, vitest_1.expect)(result).toContain("timezone");
    });
    (0, vitest_1.it)("upserts existing key", async () => {
        const store = new in_memory_store_1.InMemoryStore();
        await store.store("m1", "key", "old_value");
        await store.store("m1", "key", "new_value");
        const result = await store.recall("m1");
        (0, vitest_1.expect)(result).toContain("new_value");
        (0, vitest_1.expect)(result).not.toContain("old_value");
    });
    (0, vitest_1.it)("stores session summaries", async () => {
        const store = new in_memory_store_1.InMemoryStore();
        await store.appendSessionSummary("m1", "Merchant prefers monthly invoices.");
        const summaries = await store.getRecentSummaries("m1", 3);
        (0, vitest_1.expect)(summaries).toHaveLength(1);
        (0, vitest_1.expect)(summaries[0].summary).toBe("Merchant prefers monthly invoices.");
    });
    (0, vitest_1.it)("returns most recent summaries first", async () => {
        const store = new in_memory_store_1.InMemoryStore();
        await store.appendSessionSummary("m1", "First session");
        await store.appendSessionSummary("m1", "Second session");
        const summaries = await store.getRecentSummaries("m1", 2);
        (0, vitest_1.expect)(summaries[0].summary).toBe("Second session");
    });
    (0, vitest_1.it)("isolates between merchants", async () => {
        const store = new in_memory_store_1.InMemoryStore();
        await store.store("m1", "key", "value1");
        await store.store("m2", "key", "value2");
        const r1 = await store.recall("m1");
        const r2 = await store.recall("m2");
        (0, vitest_1.expect)(r1).toContain("value1");
        (0, vitest_1.expect)(r1).not.toContain("value2");
        (0, vitest_1.expect)(r2).toContain("value2");
    });
});
//# sourceMappingURL=memory-store.test.js.map