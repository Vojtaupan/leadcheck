import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from '../../src/input/csv.js';

describe('parseCsv', () => {
  it('parses a simple file', () => {
    const r = parseCsv('email,name\na@b.com,Ann\n');
    expect(r.headers).toEqual(['email', 'name']);
    expect(r.rows).toEqual([{ email: 'a@b.com', name: 'Ann' }]);
  });

  it('handles quoted commas', () => {
    const r = parseCsv('a,b\n"x,y",z\n');
    expect(r.rows[0]).toEqual({ a: 'x,y', b: 'z' });
  });

  it('handles escaped quotes', () => {
    const r = parseCsv('a\n"he said ""hi"""\n');
    expect(r.rows[0]!.a).toBe('he said "hi"');
  });

  it('handles embedded newlines inside quotes', () => {
    const r = parseCsv('a,b\n"line1\nline2",z\n');
    expect(r.rows[0]!.a).toBe('line1\nline2');
    expect(r.rows).toHaveLength(1);
  });

  it('handles CRLF', () => {
    const r = parseCsv('a,b\r\n1,2\r\n');
    expect(r.rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('strips a UTF-8 BOM', () => {
    const r = parseCsv('\uFEFFemail\na@b.com\n');
    expect(r.headers).toEqual(['email']);
  });

  it('pads ragged short rows and keeps overflow out', () => {
    const r = parseCsv('a,b,c\n1,2\n');
    expect(r.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('disambiguates duplicate headers', () => {
    const r = parseCsv('a,a\n1,2\n');
    expect(r.headers).toEqual(['a', 'a_2']);
    expect(r.rows[0]).toEqual({ a: '1', a_2: '2' });
  });

  it('ignores a trailing newline without emitting an empty row', () => {
    const r = parseCsv('a\n1\n\n');
    expect(r.rows).toHaveLength(1);
  });

  it('records 1-based line numbers', () => {
    const r = parseCsv('a\n1\n2\n');
    expect(r.lineNumbers).toEqual([2, 3]);
  });

  it('counts an embedded newline toward later line numbers', () => {
    const r = parseCsv('a,b\n"x\ny",1\nz,2\n');
    expect(r.lineNumbers).toEqual([2, 4]);
  });

  it('returns no rows for an empty input', () => {
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv('').headers).toEqual([]);
  });

  it('trims whitespace around header names', () => {
    const r = parseCsv(' email , name \na@b.com,Ann\n');
    expect(r.headers).toEqual(['email', 'name']);
  });
});

describe('toCsv', () => {
  it('round-trips values needing quotes', () => {
    const out = toCsv(['a'], [{ a: 'x,y"z' }]);
    expect(parseCsv(out).rows[0]!.a).toBe('x,y"z');
  });

  it('round-trips embedded newlines', () => {
    const out = toCsv(['a'], [{ a: 'l1\nl2' }]);
    expect(parseCsv(out).rows[0]!.a).toBe('l1\nl2');
  });

  it('writes a header even with no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\n');
  });

  it('emits an empty field for a missing key', () => {
    expect(toCsv(['a', 'b'], [{ a: '1' }])).toBe('a,b\n1,\n');
  });
});
