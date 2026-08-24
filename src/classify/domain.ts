import type { MxAnswer, AAnswer, DomainVerdict, DomainRisk, Provider, GatewayName } from '../types.js';
import { PROVIDER_SUFFIXES, GATEWAY_SUFFIXES, PARKED_PREFIXES, PARKED_EXACT } from '../data/mx-hosts.js';

/** Lowercase and drop the trailing root dot so suffix matching is uniform. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/** A suffix table matches either an exact host or any subdomain of it. */
function matchSuffix<T>(host: string, table: ReadonlyArray<readonly [string, T]>): T | undefined {
  for (const [suffix, value] of table) {
    if (host.endsWith(suffix) || host === suffix.slice(1)) return value;
  }
  return undefined;
}

function providerOf(host: string): Provider {
  return matchSuffix(host, PROVIDER_SUFFIXES) ?? 'self-hosted';
}

function gatewayOf(host: string): GatewayName | undefined {
  return matchSuffix(host, GATEWAY_SUFFIXES);
}

function isParkedAddress(ip: string): boolean {
  if (PARKED_EXACT.has(ip)) return true;
  return PARKED_PREFIXES.some((prefix) => ip.startsWith(prefix));
}

/**
 * An MX answer is a null MX when it holds exactly one record pointing at the
 * root. RFC 7505 writes that as ".", but node:dns reports it as an empty
 * exchange, so both spellings must be accepted — missing the empty one would
 * silently classify every null-MX domain as deliverable.
 *
 * The single-record requirement matters: a domain listing a real mail host
 * alongside a stray empty record still accepts mail.
 */
function isNullMx(mx: Extract<MxAnswer, { kind: 'ok' }>): boolean {
  if (mx.records.length !== 1) return false;
  const exchange = normalizeHost(mx.records[0]!.exchange);
  return exchange === '' || exchange === '.';
}

/**
 * Turn DNS answers into a verdict about a domain.
 *
 * Decision order is deliberate and asserted by the tests. A resolver error is
 * checked first and short-circuits everything, so a transport failure can never
 * be reported as a dead domain or accrue risk flags — that is the honesty rule,
 * and it is the difference between a gate people trust and one they learn to
 * ignore.
 */
export function classifyDomain(domain: string, mx: MxAnswer, a: AAnswer): DomainVerdict {
  const base = { domain, risks: [] as DomainRisk[], provider: 'unknown' as Provider, mx: [] as string[] };

  if (mx.kind === 'error') {
    return { ...base, status: 'unknown', note: `DNS error: ${mx.reason}` };
  }
  if (mx.kind === 'nxdomain') {
    return { ...base, status: 'nxdomain' };
  }

  if (mx.kind === 'ok') {
    const hosts = mx.records.map((r) => r.exchange);
    if (isNullMx(mx)) {
      return { ...base, status: 'null_mx', mx: hosts };
    }

    // The record a sender would try first decides how the domain is described.
    const primary = [...mx.records].sort((x, y) => x.priority - y.priority)[0]!;
    const host = normalizeHost(primary.exchange);
    const gateway = gatewayOf(host);
    const risks: DomainRisk[] = gateway ? ['gateway'] : [];

    return {
      domain,
      status: 'live',
      risks,
      provider: providerOf(host),
      ...(gateway ? { gateway } : {}),
      mx: hosts,
    };
  }

  // No MX records. RFC 5321 says a domain with an A record still accepts mail
  // at that host, so this is a live domain, not a bounce.
  if (a.kind === 'error') {
    return { ...base, status: 'unknown', note: `DNS error: ${a.reason}` };
  }
  if (a.kind === 'nxdomain') {
    return { ...base, status: 'nxdomain' };
  }
  if (a.kind === 'ok' && a.addresses.length > 0) {
    const parked = a.addresses.some(isParkedAddress);
    return {
      domain,
      status: 'live',
      risks: parked ? ['parked'] : [],
      provider: 'self-hosted',
      mx: [],
      note: 'no MX; accepting via implicit MX (RFC 5321)',
    };
  }

  return { ...base, status: 'no_mx_no_a' };
}
