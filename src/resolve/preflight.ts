import { NodeDnsResolver } from './resolver.js';
import type { Resolver } from '../types.js';

/**
 * Public resolvers tried when the system one cannot answer. Cloudflare first,
 * then Google, then Quad9.
 */
export const FALLBACK_SERVERS: readonly string[] = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];

/**
 * IANA reserves example.com for documentation and testing, so using it as the
 * control query is both guaranteed to exist and polite. It publishes no MX,
 * which is fine: a NODATA answer still proves the resolver is answering.
 */
const CONTROL_DOMAIN = 'example.com';

export interface PreflightResult {
  resolver: Resolver;
  /** Which server answered: 'system' or an explicit address. */
  server: string;
  /** True when the system resolver failed and a public one was substituted. */
  usedFallback: boolean;
}

export class ResolverUnavailableError extends Error {
  constructor(readonly tried: string[]) {
    super(
      `No DNS resolver could answer a control query for ${CONTROL_DOMAIN}.\n` +
        `Tried: ${tried.join(', ')}.\n` +
        `Your system resolver may be unreachable, or outbound DNS (port 53) may be blocked.\n` +
        `Pass --dns-server <ip> to choose one explicitly.`,
    );
    this.name = 'ResolverUnavailableError';
  }
}

async function answers(resolver: Resolver): Promise<boolean> {
  // Any definitive answer proves the resolver works. Only a transport-level
  // failure — which surfaces as kind 'error' — means it does not.
  const result = await resolver.mx(CONTROL_DOMAIN);
  return result.kind !== 'error';
}

/**
 * Choose a working resolver before doing any real work.
 *
 * Without this, a machine whose resolver is unreachable would classify every
 * domain in the list as `unknown` — technically honest, operationally useless,
 * and easy to mistake for a clean result. Failing loudly up front is better
 * than a report nobody can act on.
 *
 * An explicit `--dns-server` is never second-guessed: if the user named a
 * server and it does not answer, that is an error rather than a cue to
 * silently use somebody else's.
 */
export async function selectResolver(options: {
  timeoutMs: number;
  servers?: string[] | undefined;
}): Promise<PreflightResult> {
  const { timeoutMs, servers } = options;

  if (servers && servers.length > 0) {
    const resolver = new NodeDnsResolver({ timeoutMs, servers });
    if (await answers(resolver)) {
      return { resolver, server: servers.join(','), usedFallback: false };
    }
    throw new ResolverUnavailableError(servers);
  }

  const system = new NodeDnsResolver({ timeoutMs });
  if (await answers(system)) {
    return { resolver: system, server: 'system', usedFallback: false };
  }

  const tried = ['system'];
  for (const server of FALLBACK_SERVERS) {
    const resolver = new NodeDnsResolver({ timeoutMs, servers: [server] });
    if (await answers(resolver)) {
      return { resolver, server, usedFallback: true };
    }
    tried.push(server);
  }

  throw new ResolverUnavailableError(tried);
}
