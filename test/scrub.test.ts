import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const exec = promisify(execFile);

describe('publish gate', () => {
  it('the scrub check passes on the current tree', async () => {
    const { stdout } = await exec('bash', ['scripts/scrub-check.sh']);
    expect(stdout).toMatch(/scrub-check: clean/);
  }, 60_000);

  it('declares zero runtime dependencies', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toHaveLength(0);
  });

  it('ships only the built output and docs', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE']);
    expect(pkg.bin.leadcheck).toBe('dist/cli.js');
  });
});
