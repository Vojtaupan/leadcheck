import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/args.js';

const ok = (argv: string[]) =>
  parseArgs(argv) as Exclude<ReturnType<typeof parseArgs>, { error: string }>;
const err = (argv: string[]) => parseArgs(argv) as { error: string };

describe('parseArgs', () => {
  it('parses a file and applies defaults', () => {
    const o = ok(['leads.csv']);
    expect(o.file).toBe('leads.csv');
    expect(o.maxBounce).toBe(2);
    expect(o.concurrency).toBe(20);
    expect(o.timeoutMs).toBe(5000);
    expect(o.json).toBe(false);
    expect(o.color).toBe(true);
  });

  it('accepts a bare dash as the file, meaning stdin', () => {
    expect(ok(['-']).file).toBe('-');
  });

  it('parses every value flag', () => {
    const o = ok([
      'a.csv',
      '--email-column',
      'Work Email',
      '--sent-ledger',
      'sent.csv',
      '--max-bounce',
      '5.5',
      '--out',
      'c.csv',
      '--rejects',
      'r.csv',
      '--concurrency',
      '4',
      '--timeout',
      '900',
      '--dns-server',
      '1.1.1.1',
    ]);
    expect(o.emailColumn).toBe('Work Email');
    expect(o.sentLedger).toBe('sent.csv');
    expect(o.maxBounce).toBe(5.5);
    expect(o.out).toBe('c.csv');
    expect(o.rejects).toBe('r.csv');
    expect(o.concurrency).toBe(4);
    expect(o.timeoutMs).toBe(900);
    expect(o.dnsServer).toBe('1.1.1.1');
  });

  it('parses boolean flags', () => {
    const o = ok(['a.csv', '--json', '--no-color', '--quiet']);
    expect(o.json).toBe(true);
    expect(o.color).toBe(false);
    expect(o.quiet).toBe(true);
  });

  it('accepts help and version without a file', () => {
    expect(ok(['--help']).help).toBe(true);
    expect(ok(['-v']).version).toBe(true);
  });

  it('rejects an unknown flag', () => {
    expect(err(['a.csv', '--nope']).error).toMatch(/unknown option/i);
  });

  it('rejects a non-numeric max-bounce', () => {
    expect(err(['a.csv', '--max-bounce', 'abc']).error).toMatch(/max-bounce/);
  });

  it('rejects an out-of-range max-bounce', () => {
    expect(err(['a.csv', '--max-bounce', '101']).error).toMatch(/between 0 and 100/);
  });

  it('rejects a concurrency below one', () => {
    expect(err(['a.csv', '--concurrency', '0']).error).toMatch(/at least 1/);
  });

  it('rejects a value flag with no value', () => {
    expect(err(['a.csv', '--out']).error).toMatch(/expects a value/);
    expect(err(['a.csv', '--out', '--json']).error).toMatch(/expects a value/);
  });

  it('rejects a missing file argument', () => {
    expect(err([]).error).toMatch(/required/i);
  });

  it('rejects a second positional argument', () => {
    expect(err(['a.csv', 'b.csv']).error).toMatch(/extra argument/);
  });
});
