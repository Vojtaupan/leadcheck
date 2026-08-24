import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { VERSION } from '../src/version.js';

describe('VERSION', () => {
  it('is a semver string matching package.json', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(VERSION).toBe(pkg.version);
  });
});
