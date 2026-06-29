export interface CircuitBreakerConfig {
  readonly failureThreshold?: number;
  readonly resetMs?: number;
}

export type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = 'closed';
  private openedAt = 0;
  readonly failureThreshold: number;
  readonly resetMs: number;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetMs = config.resetMs ?? 60_000;
  }

  getState(): CircuitState {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.resetMs) {
      this.state = 'half_open';
    }
    return this.state;
  }

  isOpen(): boolean {
    return this.getState() === 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}

/** Simple per-server concurrency limiter. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.max <= 0) return;
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release(): void {
    if (this.max <= 0) return;
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next !== undefined) next();
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
