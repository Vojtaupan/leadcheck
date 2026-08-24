import { describe, it, expect } from 'vitest';
import { FixtureResolver } from '../../src/resolve/fixture.js';
import { resolveAll } from '../../src/resolve/pool.js';

describe('resolveAll', () => {
  it('resolves every domain exactly once', async () => {
    const r = new FixtureResolver({
      'a.com': { mx: { kind: 'ok', records: [{ exchange: 'mx.a.com', priority: 10 }] } },
      'b.com': { mx: { kind: 'nxdomain' } },
    });
    const out = await resolveAll(['a.com', 'b.com', 'a.com'], r, { concurrency: 2 });
    expect(out.size).toBe(2);
    expect(r.calls['a.com']).toBe(1);
  });

  it('never exceeds the concurrency limit', async () => {
    const r = new FixtureResolver({}, { delayMs: 5 });
    const domains = Array.from({ length: 20 }, (_, i) => `d${i}.com`);
    await resolveAll(domains, r, { concurrency: 3 });
    expect(r.maxInFlight).toBeLessThanOrEqual(3);
  });

  it('still resolves everything when concurrency exceeds the work', async () => {
    const r = new FixtureResolver({});
    const out = await resolveAll(['a.com'], r, { concurrency: 50 });
    expect(out.size).toBe(1);
  });

  it('turns a thrown resolver error into an error answer rather than rejecting', async () => {
    const r = new FixtureResolver({ 'boom.com': { throws: 'ETIMEOUT' } });
    const out = await resolveAll(['boom.com'], r, { concurrency: 1 });
    expect(out.get('boom.com')!.mx.kind).toBe('error');
  });

  it('skips the A lookup when MX is present', async () => {
    const r = new FixtureResolver({
      'a.com': { mx: { kind: 'ok', records: [{ exchange: 'mx.a.com', priority: 10 }] } },
    });
    const out = await resolveAll(['a.com'], r, { concurrency: 1 });
    expect(out.get('a.com')!.a.kind).toBe('none');
    expect(r.aCalls['a.com'] ?? 0).toBe(0);
  });

  it('falls back to an A lookup when MX is absent', async () => {
    const r = new FixtureResolver({
      'a.com': { mx: { kind: 'none' }, a: { kind: 'ok', addresses: ['1.2.3.4'] } },
    });
    const out = await resolveAll(['a.com'], r, { concurrency: 1 });
    expect(out.get('a.com')!.a).toEqual({ kind: 'ok', addresses: ['1.2.3.4'] });
  });

  it('does not issue an A lookup for a domain that does not exist', async () => {
    const r = new FixtureResolver({ 'gone.com': { mx: { kind: 'nxdomain' } } });
    await resolveAll(['gone.com'], r, { concurrency: 1 });
    expect(r.aCalls['gone.com'] ?? 0).toBe(0);
  });

  it('handles an empty domain list', async () => {
    const out = await resolveAll([], new FixtureResolver({}), { concurrency: 4 });
    expect(out.size).toBe(0);
  });

  it('reports progress for each completed domain', async () => {
    const seen: number[] = [];
    await resolveAll(['a.com', 'b.com'], new FixtureResolver({}), {
      concurrency: 1,
      onProgress: (done, total) => { seen.push(done); expect(total).toBe(2); },
    });
    expect(seen).toEqual([1, 2]);
  });
});
