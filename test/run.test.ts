import { describe, it, expect } from 'vitest';
import { parseArgs, type Options } from '../src/args.js';
import { run } from '../src/run.js';
import { FixtureResolver } from '../src/resolve/fixture.js';

const FILES = new Map<string, string>([
  ['clean.csv', 'email\na@good.com\nb@good.com\n'],
  ['dirty.csv', 'email\na@good.com\nb@gone.com\n'],
  ['nocol.csv', 'x,y\n1,2\n'],
  ['empty.csv', ''],
  ['named.csv', 'Full Name,Work Email\nAnn,a@good.com\n'],
  ['ledger.csv', 'email\na@good.com\n'],
  ['bad-syntax.csv', 'email\nnot-an-email\n'],
]);

function deps() {
  const written = new Map<string, string>();
  let out = '';
  let errText = '';
  return {
    written,
    get out() {
      return out;
    },
    get err() {
      return errText;
    },
    resolver: new FixtureResolver({
      'good.com': { mx: { kind: 'ok', records: [{ exchange: 'aspmx.l.google.com', priority: 1 }] } },
      'gone.com': { mx: { kind: 'nxdomain' } },
    }),
    readFile: async (p: string) => {
      const v = FILES.get(p);
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return v;
    },
    writeFile: async (p: string, c: string) => {
      written.set(p, c);
    },
    stdout: (s: string) => {
      out += s;
    },
    stderr: (s: string) => {
      errText += s;
    },
  };
}

const opts = (argv: string[]) => parseArgs(argv) as Options;

describe('run', () => {
  it('exits 0 when the list is under the threshold', async () => {
    expect(await run(opts(['clean.csv']), deps())).toBe(0);
  });

  it('exits 1 when the bounce floor is over the threshold', async () => {
    expect(await run(opts(['dirty.csv']), deps())).toBe(1);
  });

  it('exits 0 on the same list when the threshold is raised', async () => {
    expect(await run(opts(['dirty.csv', '--max-bounce', '60']), deps())).toBe(0);
  });

  it('exits 2 when the file is missing', async () => {
    const d = deps();
    expect(await run(opts(['nope.csv']), d)).toBe(2);
    expect(d.err).toMatch(/cannot read/);
  });

  it('exits 2 on an empty file', async () => {
    expect(await run(opts(['empty.csv']), deps())).toBe(2);
  });

  it('exits 2 and names the headers when no email column is found', async () => {
    const d = deps();
    expect(await run(opts(['nocol.csv']), d)).toBe(2);
    expect(d.err).toMatch(/x, y/);
  });

  it('exits 2 when the named email column is not present', async () => {
    const d = deps();
    expect(await run(opts(['clean.csv', '--email-column', 'nope']), d)).toBe(2);
    expect(d.err).toMatch(/not in/);
  });

  it('auto-detects a differently named email column', async () => {
    expect(await run(opts(['named.csv']), deps())).toBe(0);
  });

  it('exits 2 when the ledger cannot be read', async () => {
    const d = deps();
    expect(await run(opts(['clean.csv', '--sent-ledger', 'nope.csv']), d)).toBe(2);
    expect(d.err).toMatch(/ledger/);
  });

  it('drops ledger hits from the cleaned list', async () => {
    const d = deps();
    await run(opts(['clean.csv', '--sent-ledger', 'ledger.csv', '--out', 'c.csv']), d);
    expect(d.written.get('c.csv')).not.toMatch(/a@good\.com/);
    expect(d.written.get('c.csv')).toMatch(/b@good\.com/);
  });

  it('writes cleaned and rejects files when asked', async () => {
    const d = deps();
    await run(opts(['dirty.csv', '--out', 'c.csv', '--rejects', 'r.csv']), d);
    expect(d.written.get('c.csv')).toMatch(/a@good\.com/);
    expect(d.written.get('r.csv')).toMatch(/b@gone\.com/);
  });

  it('prints valid JSON under the json flag', async () => {
    const d = deps();
    await run(opts(['dirty.csv', '--json']), d);
    expect(() => JSON.parse(d.out)).not.toThrow();
  });

  it('prints a single verdict line when quiet', async () => {
    const d = deps();
    await run(opts(['dirty.csv', '--quiet']), d);
    expect(d.out.trim().split('\n')).toHaveLength(1);
    expect(d.out.startsWith('FAIL ')).toBe(true);
  });

  it('spends no DNS query on a syntactically invalid address', async () => {
    const d = deps();
    await run(opts(['bad-syntax.csv']), d);
    expect(Object.keys(d.resolver.calls)).toHaveLength(0);
  });

  it('still prints the report when an output file cannot be written', async () => {
    const d = deps();
    const failing = {
      ...d,
      writeFile: async () => {
        throw new Error('EACCES');
      },
    };
    const code = await run(opts(['dirty.csv', '--out', 'nope/c.csv']), failing);
    expect(code).toBe(2);
    expect(d.out).toMatch(/BOUNCE FLOOR/);
  });

  it('prints help and exits 0', async () => {
    const d = deps();
    expect(await run(opts(['--help']), d)).toBe(0);
    expect(d.out).toMatch(/USAGE/);
  });

  it('prints the version and exits 0', async () => {
    const d = deps();
    expect(await run(opts(['-v']), d)).toBe(0);
    expect(d.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('sends a fallback-DNS notice to stderr, keeping stdout clean', async () => {
    const d = deps();
    await run(opts(['clean.csv']), { ...d, notice: 'using 1.1.1.1' });
    expect(d.err).toMatch(/1\.1\.1\.1/);
    expect(d.out).not.toMatch(/1\.1\.1\.1/);
  });
});
