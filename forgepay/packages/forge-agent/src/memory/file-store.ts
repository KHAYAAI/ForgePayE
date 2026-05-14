import { promises as fs } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { MemoryStore, MemoryEntry, SessionSummary } from "./store";

interface StorageFile {
  entries:   MemoryEntry[];
  summaries: SessionSummary[];
}

const MAX_SUMMARIES = 20;
const RECENT_SUMMARIES_IN_RECALL = 3;

export class FileStore implements MemoryStore {
  private baseDir: string;
  // In-memory cache keyed by merchantId → StorageFile
  // Populated lazily on first access, written through on every mutation
  private cache = new Map<string, StorageFile>();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".forgepay", "agent");
  }

  private merchantFilePath(merchantId: string): string {
    // Sanitize merchantId for use as filename (replace non-alphanumeric with _)
    const safe = merchantId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.baseDir, `${safe}.json`);
  }

  private async loadMerchant(merchantId: string): Promise<StorageFile> {
    if (this.cache.has(merchantId)) return this.cache.get(merchantId)!;

    const path = this.merchantFilePath(merchantId);
    try {
      const raw = await fs.readFile(path, "utf-8");
      const data = JSON.parse(raw) as StorageFile;
      this.cache.set(merchantId, data);
      return data;
    } catch {
      // File doesn't exist yet — start fresh
      const empty: StorageFile = { entries: [], summaries: [] };
      this.cache.set(merchantId, empty);
      return empty;
    }
  }

  private async saveMerchant(merchantId: string, data: StorageFile): Promise<void> {
    const path = this.merchantFilePath(merchantId);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(data, null, 2), "utf-8");
    this.cache.set(merchantId, data);
  }

  async recall(merchantId: string): Promise<string> {
    const data = await this.loadMerchant(merchantId);
    const lines: string[] = [];

    // Format key-value entries
    if (data.entries.length > 0) {
      lines.push("Stored merchant context:");
      for (const e of data.entries) {
        lines.push(`  ${e.key}: ${e.value}`);
      }
    }

    // Format last N session summaries (most recent first)
    const recent = [...data.summaries].reverse().slice(0, RECENT_SUMMARIES_IN_RECALL);
    if (recent.length > 0) {
      lines.push("Recent session history:");
      for (const s of recent) {
        lines.push(`  [${s.createdAt.slice(0, 10)}] ${s.summary}`);
      }
    }

    return lines.join("\n");
  }

  async store(merchantId: string, key: string, value: string): Promise<void> {
    const data = await this.loadMerchant(merchantId);
    const now = new Date().toISOString();
    const existing = data.entries.find(e => e.key === key);
    if (existing) {
      existing.value = value;
      existing.updatedAt = now;
    } else {
      data.entries.push({
        id: randomUUID(),
        merchantId,
        key,
        value,
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.saveMerchant(merchantId, data);
  }

  async getEntry(merchantId: string, key: string): Promise<string | undefined> {
    const data = await this.loadMerchant(merchantId);
    return data.entries.find(e => e.key === key)?.value;
  }

  async appendSessionSummary(merchantId: string, summary: string): Promise<void> {
    const data = await this.loadMerchant(merchantId);
    data.summaries.push({
      id: randomUUID(),
      merchantId,
      summary,
      createdAt: new Date().toISOString(),
    });
    // Keep last MAX_SUMMARIES summaries
    if (data.summaries.length > MAX_SUMMARIES) {
      data.summaries = data.summaries.slice(-MAX_SUMMARIES);
    }
    await this.saveMerchant(merchantId, data);
  }

  async getRecentSummaries(merchantId: string, n: number): Promise<SessionSummary[]> {
    const data = await this.loadMerchant(merchantId);
    return [...data.summaries].reverse().slice(0, n);
  }

  close(): void {
    this.cache.clear();
  }
}
