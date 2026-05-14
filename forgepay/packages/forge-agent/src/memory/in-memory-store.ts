import { randomUUID } from "crypto";
import type { MemoryStore, MemoryEntry, SessionSummary } from "./store";

const MAX_SUMMARIES = 10;
const RECENT_SUMMARIES_IN_RECALL = 3;

export class InMemoryStore implements MemoryStore {
  private entries  = new Map<string, MemoryEntry[]>();
  private summaries = new Map<string, SessionSummary[]>();

  async recall(merchantId: string): Promise<string> {
    const parts: string[] = [];

    const merchantEntries = this.entries.get(merchantId) ?? [];
    for (const entry of merchantEntries) {
      parts.push(`${entry.key}: ${entry.value}`);
    }

    const recentSummaries = await this.getRecentSummaries(
      merchantId,
      RECENT_SUMMARIES_IN_RECALL
    );
    for (const s of recentSummaries) {
      parts.push(`Previous session: ${s.summary}`);
    }

    return parts.join("\n");
  }

  async store(merchantId: string, key: string, value: string): Promise<void> {
    const now = new Date().toISOString();
    const merchantEntries = this.entries.get(merchantId) ?? [];

    const existingIndex = merchantEntries.findIndex(e => e.key === key);
    if (existingIndex !== -1) {
      merchantEntries[existingIndex] = {
        ...merchantEntries[existingIndex],
        value,
        updatedAt: now,
      };
    } else {
      merchantEntries.push({
        id:         randomUUID(),
        merchantId,
        key,
        value,
        createdAt:  now,
        updatedAt:  now,
      });
    }

    this.entries.set(merchantId, merchantEntries);
  }

  async getEntry(merchantId: string, key: string): Promise<string | undefined> {
    return this.entries.get(merchantId)?.find(e => e.key === key)?.value;
  }

  async appendSessionSummary(
    merchantId: string,
    summary: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.summaries.get(merchantId) ?? [];

    existing.push({
      id:         randomUUID(),
      merchantId,
      summary,
      createdAt:  now,
    });

    // Keep only the most recent MAX_SUMMARIES entries
    if (existing.length > MAX_SUMMARIES) {
      existing.splice(0, existing.length - MAX_SUMMARIES);
    }

    this.summaries.set(merchantId, existing);
  }

  async getRecentSummaries(
    merchantId: string,
    n: number
  ): Promise<SessionSummary[]> {
    const all = this.summaries.get(merchantId) ?? [];
    // Return the last n items in reverse-chronological order (most recent first)
    return all.slice(-n).reverse();
  }

  close(): void {
    // No-op for in-memory implementation
  }
}
