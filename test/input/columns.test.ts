import { describe, it, expect } from 'vitest';
import { detectEmailColumn, buildRows } from '../../src/input/columns.js';
import { parseCsv } from '../../src/input/csv.js';

describe('detectEmailColumn', () => {
  it('prefers an exactly named email column', () => {
    expect(detectEmailColumn(['name', 'email'], [])).toBe('email');
  });

  it.each(['Email', 'EMAIL', 'email_address', 'Email Address', 'work email', 'e-mail'])(
    'matches the header variant %s',
    (h) => {
      expect(detectEmailColumn(['x', h], [])).toBe(h);
    },
  );

  it('falls back to the column with the most @-shaped values', () => {
    const rows = [
      { a: 'Ann', b: 'ann@x.com' },
      { a: 'Bo', b: 'bo@y.com' },
    ];
    expect(detectEmailColumn(['a', 'b'], rows)).toBe('b');
  });

  it('returns null when nothing looks like email', () => {
    expect(detectEmailColumn(['a', 'b'], [{ a: '1', b: '2' }])).toBeNull();
  });

  it('does not pick a name column that happens to hold one address', () => {
    const rows = [
      { name: 'Ann', contact: 'ann@x.com' },
      { name: 'bo@y.com', contact: 'bo@y.com' },
      { name: 'Cy', contact: 'cy@z.com' },
    ];
    expect(detectEmailColumn(['name', 'contact'], rows)).toBe('contact');
  });

  it('ignores empty cells when scoring a column', () => {
    const rows = [{ a: 'x@y.com' }, { a: '' }, { a: 'z@y.com' }];
    expect(detectEmailColumn(['a'], rows)).toBe('a');
  });

  it('prefers a named header over a higher-scoring unnamed column', () => {
    const rows = [{ email: 'a@x.com', cc: 'b@x.com' }];
    expect(detectEmailColumn(['email', 'cc'], rows)).toBe('email');
  });
});

describe('buildRows', () => {
  it('trims, lowercases and carries the line number', () => {
    const parsed = parseCsv('email\n  Ann@Example.COM \n');
    const rows = buildRows(parsed, 'email');
    expect(rows[0]!.email).toBe('ann@example.com');
    expect(rows[0]!.lineNumber).toBe(2);
    expect(rows[0]!.raw.email).toBe('  Ann@Example.COM ');
  });

  it('keeps rows whose email cell is empty', () => {
    const rows = buildRows(parseCsv('email,name\n,Ann\n'), 'email');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('');
  });
});
