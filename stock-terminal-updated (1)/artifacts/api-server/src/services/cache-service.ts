import type { CacheEntry, CacheProvider } from "@workspace/market-platform";

export class InMemoryCacheProvider implements CacheProvider {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, options?: { ttlMs?: number; tags?: string[] }): Promise<void> {
    const createdAt = Date.now();
    this.entries.set(key, {
      value,
      createdAt,
      expiresAt: options?.ttlMs ? createdAt + options.ttlMs : undefined,
      tags: options?.tags,
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async invalidateByTag(tag: string): Promise<void> {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.tags?.includes(tag)) this.entries.delete(key);
    }
  }
}

export const cacheProvider = new InMemoryCacheProvider();
