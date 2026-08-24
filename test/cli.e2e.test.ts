import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const CLI = 'dist/cli.js';

/** execFile rejects on a non-zero exit; normalize both outcomes. */
async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Live DNS is needed for anything that actually resolves a domain. */
const online = process.env.LEADCHECK_OFFLINE !== '1';

describe('cli end to end', () => {
  let dir: string;

  beforeAll(async () => {
    await exec('npm', ['run', 'build'], { shell: true });
    dir = await mkdtemp(join(tmpdir(), 'leadcheck-'));
  }, 120_000);

  it('prints help and exits 0', async () => {
    const r = await cli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/USAGE/);
    expect(r.stdout).toMatch(/EXIT CODES/);
  });

  it('prints the version and exits 0', async () => {
    const r = await cli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exits 2 on an unknown flag, before touching the network', async () => {
    const r = await cli(['x.csv', '--definitely-not-a-flag']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unknown option/);
  });

  it.runIf(online)('exits 2 on a missing file', async () => {
    const r = await cli(['no-such-file.csv']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/cannot read/);
  });

  it.runIf(online)(
    'reports a syntactically invalid row as a bounce and exits 1',
    async () => {
      const f = join(dir, 'bad.csv');
      await writeFile(f, 'email\nnot-an-email\n');
      const r = await cli([f, '--no-color']);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/syntax_invalid/);
    },
    30_000,
  );

  it.runIf(online)(
    'runs a real list against live DNS and writes both output files',
    async () => {
      const f = join(dir, 'live.csv');
      const cleaned = join(dir, 'clean.csv');
      const rejects = join(dir, 'rejects.csv');
      // iana.org has ordinary MX. example.com publishes a null MX (RFC 7505),
      // so it is a guaranteed bounce. The .invalid TLD can never resolve.
      await writeFile(
        f,
        'email,name\nsomebody@iana.org,A\nsomebody@example.com,B\nx@nonexistent.invalid,C\n',
      );
      const r = await cli([f, '--no-color', '--out', cleaned, '--rejects', rejects, '--max-bounce', '90']);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/null_mx/);
      expect(r.stdout).toMatch(/nxdomain/);

      const keptText = await readFile(cleaned, 'utf8');
      const rejectText = await readFile(rejects, 'utf8');
      expect(keptText).toMatch(/iana\.org/);
      expect(keptText).not.toMatch(/example\.com/);
      expect(rejectText).toMatch(/example\.com/);
      expect(rejectText).toMatch(/nonexistent\.invalid/);
    },
    60_000,
  );

  it.runIf(online)(
    'emits parseable JSON with the json flag',
    async () => {
      const f = join(dir, 'json.csv');
      await writeFile(f, 'email\nsomebody@iana.org\n');
      const r = await cli([f, '--json']);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.totalRows).toBe(1);
    },
    30_000,
  );

  it.runIf(online)(
    'reads the list from stdin when the file is a dash',
    async () => {
      const child = exec(process.execPath, [CLI, '-', '--quiet']);
      child.child.stdin?.end('email\nsomebody@iana.org\n');
      const { stdout } = await child;
      expect(stdout).toMatch(/^PASS /);
    },
    30_000,
  );

  it.runIf(online)(
    'fails loudly rather than reporting everything unknown when DNS cannot answer',
    async () => {
      const f = join(dir, 'dns.csv');
      await writeFile(f, 'email\nsomebody@iana.org\n');
      // 127.0.0.9 has no resolver listening.
      const r = await cli([f, '--dns-server', '127.0.0.9', '--timeout', '1200']);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/No DNS resolver could answer/);
    },
    30_000,
  );
});
