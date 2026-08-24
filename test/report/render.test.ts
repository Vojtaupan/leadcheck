import { describe, it, expect } from 'vitest';
import { renderTable } from '../../src/report/table.js';
import { renderJson } from '../../src/report/json.js';
import { renderCleaned, renderRejects } from '../../src/report/csv-out.js';
import { parseCsv } from '../../src/input/csv.js';
import { buildReport } from '../../src/analyze/report.js';
import type { Row, DomainVerdict, AddressFlag } from '../../src/types.js';

const row = (n: number, email: string): Row => ({ lineNumber: n, raw: { email, name: `n${n}` }, email });
const live = (d: string): DomainVerdict => ({ domain: d, status: 'live', risks: [], provider: 'google', mx: [] });
const dead = (d: string): DomainVerdict => ({ domain: d, status: 'nxdomain', risks: [], provider: 'unknown', mx: [] });

const sample = () =>
  buildReport(
    [row(2, 'a@good.com'), row(3, 'b@gone.com'), row(4, 'info@good.com')],
    new Map<number, AddressFlag[]>([[4, ['role_inbox']]]),
    new Map([['good.com', live('good.com')], ['gone.com', dead('gone.com')]]),
  );

describe('renderTable', () => {
  it('matches the golden output', () => {
    expect(renderTable(sample(), { color: false, maxBounce: 2 })).toMatchSnapshot();
  });

  it('emits no ANSI escapes when color is off', () => {
    // eslint-disable-next-line no-control-regex
    expect(renderTable(sample(), { color: false, maxBounce: 2 })).not.toMatch(/\u001b\[/);
  });

  it('emits ANSI escapes when color is on', () => {
    // eslint-disable-next-line no-control-regex
    expect(renderTable(sample(), { color: true, maxBounce: 2 })).toMatch(/\u001b\[/);
  });

  it('shows the bounce floor, its causes and a FAIL marker over the limit', () => {
    const out = renderTable(sample(), { color: false, maxBounce: 2 });
    expect(out).toMatch(/33\.3%/);
    expect(out).toMatch(/nxdomain/);
    expect(out).toMatch(/FAIL/);
  });

  it('shows PASS when the floor is within the limit', () => {
    const out = renderTable(sample(), { color: false, maxBounce: 90 });
    expect(out).toMatch(/PASS/);
    expect(out).not.toMatch(/FAIL/);
  });

  it('is ASCII only, so Windows terminals render it', () => {
    expect(renderTable(sample(), { color: false, maxBounce: 2 })).toMatch(/^[\x00-\x7F]*$/);
  });

  it('names the unknown bucket explicitly when it is non-zero', () => {
    const v: DomainVerdict = { domain: 'x.com', status: 'unknown', risks: [], provider: 'unknown', mx: [] };
    const r = buildReport([row(2, 'a@x.com')], new Map(), new Map([['x.com', v]]));
    const out = renderTable(r, { color: false, maxBounce: 2 });
    expect(out).toMatch(/UNKNOWN/);
    expect(out).toMatch(/not counted/i);
  });

  it('renders an empty list without crashing', () => {
    expect(() => renderTable(buildReport([], new Map(), new Map()), { color: false, maxBounce: 2 })).not.toThrow();
  });
});

describe('renderJson', () => {
  it('is stable, parseable and carries a schema version', () => {
    const parsed = JSON.parse(renderJson(sample()));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.bounce.rows).toBe(1);
  });

  it('omits the per-row results, which belong in the CSV outputs', () => {
    expect(JSON.parse(renderJson(sample())).results).toBeUndefined();
  });

  it('ends with a newline', () => {
    expect(renderJson(sample()).endsWith('\n')).toBe(true);
  });
});

describe('csv output', () => {
  it('cleaned keeps originals, adds a reason column and omits dropped rows', () => {
    const out = parseCsv(renderCleaned(sample(), ['email', 'name']));
    expect(out.headers).toEqual(['email', 'name', 'leadcheck_reason']);
    expect(out.rows.map((r) => r.email)).toEqual(['a@good.com', 'info@good.com']);
    expect(out.rows[1]!.leadcheck_reason).toBe('role_inbox');
  });

  it('rejects holds exactly the dropped rows with their reason', () => {
    const out = parseCsv(renderRejects(sample(), ['email', 'name']));
    expect(out.rows.map((r) => r.email)).toEqual(['b@gone.com']);
    expect(out.rows[0]!.leadcheck_reason).toBe('nxdomain');
  });

  it('cleaned plus rejects reconstructs every input row', () => {
    const r = sample();
    const kept = parseCsv(renderCleaned(r, ['email', 'name'])).rows.length;
    const dropped = parseCsv(renderRejects(r, ['email', 'name'])).rows.length;
    expect(kept + dropped).toBe(r.totalRows);
  });

  it('does not add a second reason column when the input already has one', () => {
    const out = parseCsv(renderCleaned(sample(), ['email', 'leadcheck_reason']));
    expect(out.headers.filter((h) => h === 'leadcheck_reason')).toHaveLength(1);
  });

  it('writes a header-only file when everything is dropped', () => {
    const r = buildReport([row(2, 'b@gone.com')], new Map(), new Map([['gone.com', dead('gone.com')]]));
    expect(renderCleaned(r, ['email'])).toBe('email,leadcheck_reason\n');
  });
});
