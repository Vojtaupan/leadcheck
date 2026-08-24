import type { Resolver, MxAnswer, AAnswer } from '../types.js';

export interface FixtureEntry {
  mx?: MxAnswer;
  a?: AAnswer;
  /** Make the lookup throw, to exercise error handling in the pool. */
  throws?: string;
}

export interface FixtureOptions {
  /** Artificial latency, used to observe concurrency. */
  delayMs?: number;
}

/**
 * A Resolver backed by a static map, so the whole suite runs offline and
 * deterministically. It also records call counts and peak concurrency, which is
 * how the pool's guarantees are tested.
 *
 * Unknown domains answer `{ kind: 'none' }` rather than throwing: an
 * unconfigured domain in a test should be uninteresting, not fatal.
 */
export class FixtureResolver implements Resolver {
  readonly calls: Record<string, number> = {};
  readonly aCalls: Record<string, number> = {};
  maxInFlight = 0;
  private inFlight = 0;

  constructor(
    private readonly entries: Record<string, FixtureEntry>,
    private readonly options: FixtureOptions = {},
  ) {}

  private async enter<T>(produce: () => T): Promise<T> {
    this.inFlight++;
    if (this.inFlight > this.maxInFlight) this.maxInFlight = this.inFlight;
    try {
      if (this.options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
      }
      return produce();
    } finally {
      this.inFlight--;
    }
  }

  async mx(domain: string): Promise<MxAnswer> {
    this.calls[domain] = (this.calls[domain] ?? 0) + 1;
    return this.enter(() => {
      const entry = this.entries[domain];
      if (entry?.throws) throw Object.assign(new Error(entry.throws), { code: entry.throws });
      return entry?.mx ?? { kind: 'none' };
    });
  }

  async a(domain: string): Promise<AAnswer> {
    this.aCalls[domain] = (this.aCalls[domain] ?? 0) + 1;
    return this.enter(() => {
      const entry = this.entries[domain];
      if (entry?.throws) throw Object.assign(new Error(entry.throws), { code: entry.throws });
      return entry?.a ?? { kind: 'none' };
    });
  }
}
