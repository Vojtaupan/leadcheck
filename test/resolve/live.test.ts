import { describe, it, expect } from 'vitest';
import { NodeDnsResolver } from '../../src/resolve/resolver.js';
import { selectResolver, ResolverUnavailableError } from '../../src/resolve/preflight.js';

const live = process.env.LEADCHECK_LIVE === '1';

describe.skipIf(!live)('live DNS', () => {
  it('preflight finds a resolver that answers', async () => {
    const { resolver, server } = await selectResolver({ timeoutMs: 8000 });
    expect(resolver).toBeDefined();
    expect(server).toBeTruthy();
  });

  it('resolves MX for a domain that certainly has one', async () => {
    const { resolver } = await selectResolver({ timeoutMs: 8000 });
    expect((await resolver.mx('gmail.com')).kind).toBe('ok');
  });

  it('reports nxdomain for a reserved non-existent name', async () => {
    const { resolver } = await selectResolver({ timeoutMs: 8000 });
    expect((await resolver.mx('this-domain-does-not-exist.invalid')).kind).toBe('nxdomain');
  });

  it('surfaces a real RFC 7505 null MX as an empty exchange', async () => {
    // example.com publishes a null MX. Node reports that as exchange "",
    // not "." — the classifier must accept both spellings.
    const { resolver } = await selectResolver({ timeoutMs: 8000 });
    const out = await resolver.mx('example.com');
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.records).toHaveLength(1);
      expect(['', '.']).toContain(out.records[0]!.exchange);
    }
  });

  it('reports ok for a domain with ordinary MX records', async () => {
    const { resolver } = await selectResolver({ timeoutMs: 8000 });
    const out = await resolver.mx('iana.org');
    expect(out.kind).toBe('ok');
  });

  it('resolves A records for the implicit-MX fallback path', async () => {
    const { resolver } = await selectResolver({ timeoutMs: 8000 });
    const a = await resolver.a('example.com');
    expect(a.kind).toBe('ok');
  });

  it('rejects an explicitly named server that cannot answer', async () => {
    await expect(
      selectResolver({ timeoutMs: 1500, servers: ['127.0.0.9'] }),
    ).rejects.toBeInstanceOf(ResolverUnavailableError);
  });

  it('maps an unreachable resolver to error, never to a dead domain', async () => {
    const broken = new NodeDnsResolver({ timeoutMs: 1500, servers: ['127.0.0.9'] });
    const out = await broken.mx('gmail.com');
    expect(out.kind).toBe('error');
  });
});
