// 記憶體限流：單程序部署下足夠擋住誤按與簡單濫用。

const buckets = new Map();

/**
 * @returns {{ allowed: boolean, retryAfter: number, remaining: number }}
 */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    remaining: Math.max(0, limit - bucket.count),
  };
}

export function resetRateLimit() {
  buckets.clear();
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}, 60_000);
sweeper.unref?.();
