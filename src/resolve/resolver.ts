import { Resolver as DnsResolver } from 'node:dns/promises';
import type { Resolver, MxAnswer, AAnswer } from '../types.js';

/** DNS error codes meaning "the name does not exist". */
const NXDOMAIN_CODES = new Set(['ENOTFOUND', 'EBADNAME']);
/** DNS error codes meaning "the name exists but has no record of this type". */
const NODATA_CODES = new Set(['ENODATA']);

function codeOf(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : 'EUNKNOWN';
}

class TimeoutError extends Error {
  constructor() {
    super('ETIMEOUT');
  }
}

/**
 * Race a lookup against a timer.
 *
 * node:dns has no per-query deadline that covers a resolver which accepts the
 * connection and then stalls, so the timer is the only reliable bound. The
 * timer is always cleared, otherwise a fast lookup would hold the event loop
 * open for the full timeout and the CLI would appear to hang after printing.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface NodeDnsResolverOptions {
  timeoutMs: number;
  servers?: string[];
}

/**
 * The only component in leadcheck that touches the network.
 *
 * Every failure that is not a definitive NXDOMAIN or NODATA becomes
 * `{ kind: 'error' }`, which downstream becomes `unknown` and is excluded from
 * the bounce floor. A resolver problem must never look like a dead domain.
 */
export class NodeDnsResolver implements Resolver {
  private readonly dns: DnsResolver;
  private readonly timeoutMs: number;

  constructor(options: NodeDnsResolverOptions) {
    this.timeoutMs = options.timeoutMs;
    this.dns = new DnsResolver({ timeout: options.timeoutMs, tries: 2 });
    if (options.servers && options.servers.length > 0) this.dns.setServers(options.servers);
  }

  async mx(domain: string): Promise<MxAnswer> {
    try {
      const records = await withTimeout(this.dns.resolveMx(domain), this.timeoutMs);
      if (records.length === 0) return { kind: 'none' };
      return {
        kind: 'ok',
        records: records.map((r) => ({ exchange: r.exchange, priority: r.priority })),
      };
    } catch (err) {
      const code = codeOf(err);
      if (NXDOMAIN_CODES.has(code)) return { kind: 'nxdomain' };
      if (NODATA_CODES.has(code)) return { kind: 'none' };
      return { kind: 'error', reason: code };
    }
  }

  async a(domain: string): Promise<AAnswer> {
    try {
      const addresses = await withTimeout(this.dns.resolve4(domain), this.timeoutMs);
      return addresses.length === 0 ? { kind: 'none' } : { kind: 'ok', addresses };
    } catch (err) {
      const code = codeOf(err);
      if (NXDOMAIN_CODES.has(code)) return { kind: 'nxdomain' };
      if (NODATA_CODES.has(code)) return { kind: 'none' };
      return { kind: 'error', reason: code };
    }
  }
}
