import { describe, it, expect } from 'vitest';
import { loadLedger, markDuplicates } from '../../src/analyze/dedupe.js';
import type { Row, AddressFlag } from '../../src/types.js';

const row = (n: number, email: string): Row => ({ lineNumber: n, raw: { email }, email });

describe('loadLedger', () => {
  it('reads a bare newline list', () => {
    const s = loadLedger('a@x.com\nb@y.com\n');
    expect(s.has('a@x.com')).toBe(true);
    expect(s.size).toBe(2);
  });

  it('reads a CSV with an email column', () => {
    const s = loadLedger('name,email\nAnn,a@x.com\n');
    expect(s.has('a@x.com')).toBe(true);
    expect(s.size).toBe(1);
  });

  it('normalizes entries so tagged variants match', () => {
    const s = loadLedger('A.N.N+tag@gmail.com\n');
    expect(s.has('ann@gmail.com')).toBe(true);
  });

  it('ignores blank lines', () => {
    expect(loadLedger('a@x.com\n\n\nb@x.com\n').size).toBe(2);
  });

  it('returns an empty set for empty input', () => {
    expect(loadLedger('').size).toBe(0);
  });

  it('does not treat the first address of a headerless list as a header', () => {
    const s = loadLedger('a@x.com\nb@x.com\n');
    expect(s.has('a@x.com')).toBe(true);
  });
});

describe('markDuplicates', () => {
  it('leaves the first occurrence unflagged and flags later ones', () => {
    const m = markDuplicates([row(2, 'a@x.com'), row(3, 'a@x.com')], new Set());
    expect(m.get(2) ?? []).toEqual([]);
    expect(m.get(3)).toEqual(['duplicate_in_list']);
  });

  it('matches duplicates through gmail normalization', () => {
    const m = markDuplicates([row(2, 'a.n@gmail.com'), row(3, 'an@gmail.com')], new Set());
    expect(m.get(3)).toEqual(['duplicate_in_list']);
  });

  it('flags ledger hits on every occurrence including the first', () => {
    const m = markDuplicates([row(2, 'a@x.com')], loadLedger('a@x.com\n'));
    expect(m.get(2)).toEqual(['already_contacted']);
  });

  it('reports both flags when a row is a dup and already contacted', () => {
    const m = markDuplicates([row(2, 'a@x.com'), row(3, 'a@x.com')], loadLedger('a@x.com\n'));
    expect((m.get(3) as AddressFlag[]).slice().sort()).toEqual(['already_contacted', 'duplicate_in_list']);
  });

  it('does not treat two empty email cells as duplicates of each other', () => {
    const m = markDuplicates([row(2, ''), row(3, '')], new Set());
    expect(m.get(3) ?? []).toEqual([]);
  });
});
