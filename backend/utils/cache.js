const cacheStore = new Map();

function stableStringify(value) {
  if (!value || typeof value !== "object") return String(value ?? "");
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return Object.keys(value)
    .sort()
    .map((key) => `${key}:${stableStringify(value[key])}`)
    .join("|");
}

function makeCacheKey(namespace, parts = {}) {
  return `${namespace}:${stableStringify(parts)}`;
}

async function getOrSetCache(key, ttlMs, producer) {
  const now = Date.now();
  const cached = cacheStore.get(key);
  if (cached && cached.expiresAt > now) {
    return { value: cached.value, hit: true };
  }

  const value = await producer();
  cacheStore.set(key, {
    value,
    expiresAt: now + ttlMs,
  });
  return { value, hit: false };
}

function clearCacheByPrefix(prefix) {
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) cacheStore.delete(key);
  }
}

function clearCachePrefixes(prefixes = []) {
  prefixes.forEach(clearCacheByPrefix);
}

function sendCachedJson(res, result) {
  res.set("X-Cache", result.hit ? "HIT" : "MISS");
  res.json(result.value);
}

module.exports = {
  clearCacheByPrefix,
  clearCachePrefixes,
  getOrSetCache,
  makeCacheKey,
  sendCachedJson,
};
