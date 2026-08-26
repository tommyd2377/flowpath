import { z } from "zod";

import { getWorldRepository } from "./world-db";
import type { GenerationTemplateRecord } from "./world-repository";

type CachedRecord = GenerationTemplateRecord<unknown>;

const cacheGlobal = globalThis as typeof globalThis & {
  __possibilityAtlasRawGenerationCache?: Map<string, CachedRecord>;
};

const cache =
  cacheGlobal.__possibilityAtlasRawGenerationCache ??
  (cacheGlobal.__possibilityAtlasRawGenerationCache = new Map());

export async function getRawGenerationTemplate<T>(
  key: string,
  schema: z.ZodType<T>,
) {
  const local = cache.get(key);
  if (local) {
    const parsed = schema.safeParse(local.payload);
    if (parsed.success) {
      return { payload: parsed.data, createdAt: local.createdAt };
    }
    cache.delete(key);
  }

  try {
    const repository = getWorldRepository();
    await repository.initialize();
    const stored = await repository.getGenerationTemplate(key, schema);
    if (stored) {
      cache.set(key, {
        key,
        kind: "start",
        model: "raw-cache-read",
        promptVersion: "raw-cache-read",
        sourceFingerprint: key,
        ...stored,
      });
    }
    return stored;
  } catch {
    // Raw-headline analysis predates the world catalog. A catalog/database
    // failure must never make that existing flow unavailable.
    return null;
  }
}

export async function putRawGenerationTemplate<T>(
  record: GenerationTemplateRecord<T>,
  schema: z.ZodType<T>,
) {
  const payload = schema.parse(record.payload);
  const prior = cache.get(record.key);
  if (prior) {
    const parsed = schema.safeParse(prior.payload);
    if (parsed.success) {
      return { payload: parsed.data, createdAt: prior.createdAt };
    }
  }
  cache.set(record.key, { ...record, payload });

  try {
    const repository = getWorldRepository();
    await repository.initialize();
    const stored = await repository.putGenerationTemplate(record, schema);
    cache.set(record.key, { ...record, ...stored });
    return stored;
  } catch {
    return { payload, createdAt: record.createdAt };
  }
}

export function resetRawGenerationCacheForTests() {
  cache.clear();
}
