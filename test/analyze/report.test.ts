import { describe, it, expect } from 'vitest';
import { buildReport, DROP_FLAGS, DEAD_STATUSES } from '../../src/analyze/report.js';
import type { Row, DomainVerdict, AddressFlag } from '../../src/types.js';

const row = (n: number, email: string): Row => ({ lineNumber: n, raw: { email }, email });
const live = (d: string): DomainVerdict => ({ domain: d, status: 'live', risks: [], provider: 'google', mx: ['aspmx.l.google.com'] });
const dead = (d: string): DomainVerdict => ({ domain: d, status: 'nxdomain', risks: [], provider: 'unknown', mx: [] });
const flags = (pairs: [number, AddressFlag[]][]) => new Map<number, AddressFlag[]>(pairs);

describe('buildReport', () => {
  it('computes the bounce floor as dead rows over total rows', () => {
    const r = buildReport(
      [row(2, 'a@good.com'), row(3, 'b@gone.com')],
      new Map(),
      new Map([['good.com', live('good.com')], ['gone.com', dead('gone.com')]]),
    );
    expect(r.bounce.rows).toBe(1);
    expect(r.bounce.pct).toBe(50);
    expect(r.bounce.causes.nxdomain).toBe(1);
  });

  it('excludes unknown rows from the bounce floor', () => {
    const v: DomainVerdict = { domain: 'x.com', status: 'unknown', risks: [], provider: 'unknown', mx: [] };
    const r = buildReport([row(2, 'a@x.com')], new Map(), new Map([['x.com', v]]));
    expect(r.bounce.rows).toBe(0);
    expect(r.unknown.rows).toBe(1);
    expect(r.unknown.domains).toBe(1);
  });

  it('counts a syntax-invalid row as a bounce with no DNS lookup', () => {
    const r = buildReport([row(2, 'nonsense')], flags([[2, ['syntax_invalid']]]), new Map());
    expect(r.bounce.rows).toBe(1);
    expect(r.bounce.causes.syntax_invalid).toBe(1);
    expect(r.uniqueDomains).toBe(0);
  });

  it('drops dead and duplicate rows but keeps role inboxes', () => {
    const r = buildReport(
      [row(2, 'info@good.com'), row(3, 'b@gone.com')],
      flags([[2, ['role_inbox']]]),
      new Map([['good.com', live('good.com')], ['gone.com', dead('gone.com')]]),
    );
    const byLine = new Map(r.results.map((x) => [x.row.lineNumber, x]));
    expect(byLine.get(2)!.drop).toBe(false);
    expect(byLine.get(2)!.reason).toBe('role_inbox');
    expect(byLine.get(3)!.drop).toBe(true);
    expect(byLine.get(3)!.reason).toBe('nxdomain');
  });

  it('leads the reason with the dead status when a row is both dead and duplicate', () => {
    const r = buildReport(
      [row(2, 'b@gone.com')],
      flags([[2, ['duplicate_in_list']]]),
      new Map([['gone.com', dead('gone.com')]]),
    );
    expect(r.results[0]!.reason).toBe('nxdomain+duplicate_in_list');
  });

  it('counts each row once even when it carries several risks', () => {
    const v: DomainVerdict = { domain: 'x.com', status: 'live', risks: ['gateway', 'parked'], provider: 'unknown', gateway: 'mimecast', mx: [] };
    const r = buildReport([row(2, 'info@x.com')], flags([[2, ['role_inbox']]]), new Map([['x.com', v]]));
    expect(r.risk.rows).toBe(1);
    expect(r.risk.causes.gateway).toBe(1);
    expect(r.risk.causes.parked).toBe(1);
    expect(r.risk.causes.role_inbox).toBe(1);
  });

  it('does not count a free-provider row as a risk', () => {
    const r = buildReport([row(2, 'a@gmail.com')], flags([[2, ['free_provider']]]), new Map([['gmail.com', live('gmail.com')]]));
    expect(r.risk.rows).toBe(0);
    expect(r.freeProvider).toBe(1);
  });

  it('builds the provider mix over deliverable rows only', () => {
    const r = buildReport(
      [row(2, 'a@g.com'), row(3, 'b@gone.com')],
      new Map(),
      new Map([['g.com', live('g.com')], ['gone.com', dead('gone.com')]]),
    );
    expect(r.providerMix).toEqual({ google: 1 });
  });

  it('counts duplicates and ledger hits separately', () => {
    const r = buildReport(
      [row(2, 'a@g.com'), row(3, 'a@g.com')],
      flags([[3, ['duplicate_in_list', 'already_contacted']]]),
      new Map([['g.com', live('g.com')]]),
    );
    expect(r.duplicates.duplicateInList).toBe(1);
    expect(r.duplicates.alreadyContacted).toBe(1);
  });

  it('reports zero percent on an empty list without dividing by zero', () => {
    const r = buildReport([], new Map(), new Map());
    expect(r.bounce.pct).toBe(0);
    expect(r.risk.pct).toBe(0);
    expect(r.totalRows).toBe(0);
  });

  it('rounds percentages to one decimal', () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(i + 2, i === 0 ? 'a@gone.com' : `u${i}@good.com`));
    const r = buildReport(rows, new Map(), new Map([['good.com', live('good.com')], ['gone.com', dead('gone.com')]]));
    expect(r.bounce.pct).toBe(33.3);
  });

  it('exports the drop policy so the CSV writers and tests agree on it', () => {
    expect(DROP_FLAGS).toContain('syntax_invalid');
    expect(DROP_FLAGS).toContain('already_contacted');
    expect(DROP_FLAGS).not.toContain('role_inbox');
    expect(DEAD_STATUSES).toEqual(['nxdomain', 'null_mx', 'no_mx_no_a']);
  });

  it('treats a row whose email is empty as syntax_invalid rather than crashing', () => {
    const r = buildReport([row(2, '')], flags([[2, ['syntax_invalid']]]), new Map());
    expect(r.bounce.rows).toBe(1);
    expect(r.results[0]!.drop).toBe(true);
  });
});
