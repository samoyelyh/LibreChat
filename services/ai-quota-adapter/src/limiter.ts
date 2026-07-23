import { Redis } from 'ioredis';
import type { RequestLimiter } from './contracts.js';
import { AdapterError } from './errors.js';

export class RedisRequestLimiter implements RequestLimiter {
  private readonly redis: Redis;

  constructor(
    redisUrl: string,
    private readonly requestsPerMinute: number,
    private readonly maxConcurrentRequests: number,
  ) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async ping(): Promise<void> {
    await this.redis.ping();
  }

  async acquire(userId: string): Promise<() => Promise<void>> {
    const minute = Math.floor(Date.now() / 60000);
    const rpmKey = `ai-adapter:rpm:${userId}:${minute}`;
    const rpm = await this.redis.incr(rpmKey);
    if (rpm === 1) await this.redis.expire(rpmKey, 120);
    if (rpm > this.requestsPerMinute) {
      throw new AdapterError(429, 'request_rate_exceeded', 'AI request rate limit exceeded');
    }

    const concurrentKey = `ai-adapter:concurrent:${userId}`;
    const concurrent = await this.redis.incr(concurrentKey);
    if (concurrent === 1) await this.redis.expire(concurrentKey, 300);
    if (concurrent > this.maxConcurrentRequests) {
      await this.redis.decr(concurrentKey);
      throw new AdapterError(429, 'concurrency_exceeded', 'Too many concurrent AI requests');
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await this.redis.eval(
        "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; if tonumber(v)<=1 then return redis.call('DEL',KEYS[1]) else return redis.call('DECR',KEYS[1]) end",
        1,
        concurrentKey,
      );
    };
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
