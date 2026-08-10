export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt?: number;
  tags?: string[];
}

export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ttlMs?: number; tags?: string[] }): Promise<void>;
  delete(key: string): Promise<void>;
  invalidateByTag(tag: string): Promise<void>;
}

export interface CachePolicy {
  namespace: string;
  ttlMs: number;
  staleWhileRevalidateMs?: number;
  writeThrough?: boolean;
}
