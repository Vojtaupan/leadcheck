import type { Row, AddressFlag, DomainStatus, DomainVerdict, Report, RowResult } from '../types.js';
import { domainOf } from '../classify/address.js';

/** Statuses that mean mail to this domain cannot be delivered. */
export const DEAD_STATUSES: readonly DomainStatus[] = ['nxdomain', 'null_mx', 'no_mx_no_a'];

/**
 * Flags that remove a row from the cleaned list.
 *
 * Role inboxes, free providers, gateways and parked domains are deliberately
 * absent: those are judgment calls about targeting, not deliverability facts,
 * and the tool reports them rather than deciding for the operator.
 */
export const DROP_FLAGS: readonly AddressFlag[] = [
  'syntax_invalid',
  'duplicate_in_list',
  'already_contacted',
  'disposable',
];

/** Flags that belong in the risk bucket. free_provider is counted separately. */
const RISK_FLAGS: readonly AddressFlag[] = ['role_inbox', 'disposable'];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : round1((part / total) * 100);
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * Fold rows, address flags and domain verdicts into the report.
 *
 * The bounce floor counts rows, not domains: one dead domain appearing on
 * forty rows costs forty bounces. Percentages are over total rows, so the
 * headline number answers "what fraction of this upload fails immediately".
 *
 * `unknown` is excluded from every verdict bucket and reported on its own.
 */
export function buildReport(
  rows: Row[],
  flagsByLine: Map<number, AddressFlag[]>,
  verdictsByDomain: Map<string, DomainVerdict>,
): Report {
  const results: RowResult[] = [];
  const bounceCauses: Record<string, number> = {};
  const riskCauses: Record<string, number> = {};
  const providerMix: Record<string, number> = {};
  const unknownDomains = new Set<string>();

  let bounceRows = 0;
  let riskRows = 0;
  let unknownRows = 0;
  let freeProvider = 0;
  let duplicateInList = 0;
  let alreadyContacted = 0;

  for (const row of rows) {
    const flags = flagsByLine.get(row.lineNumber) ?? [];
    const domain = domainOf(row.email);
    const verdict = domain ? verdictsByDomain.get(domain) : undefined;

    const deadStatus =
      verdict && DEAD_STATUSES.includes(verdict.status) ? verdict.status : undefined;
    const isSyntaxInvalid = flags.includes('syntax_invalid');

    // Bounce accounting.
    if (isSyntaxInvalid) {
      bounceRows++;
      bump(bounceCauses, 'syntax_invalid');
    } else if (deadStatus) {
      bounceRows++;
      bump(bounceCauses, deadStatus);
    }

    // Risk accounting: a row counts once, each of its causes counts once.
    const rowRisks: string[] = [];
    for (const flag of flags) if (RISK_FLAGS.includes(flag)) rowRisks.push(flag);
    if (verdict && verdict.status !== 'unknown') for (const risk of verdict.risks) rowRisks.push(risk);
    if (rowRisks.length > 0) {
      riskRows++;
      for (const cause of rowRisks) bump(riskCauses, cause);
    }

    if (flags.includes('free_provider')) freeProvider++;
    if (flags.includes('duplicate_in_list')) duplicateInList++;
    if (flags.includes('already_contacted')) alreadyContacted++;

    if (!isSyntaxInvalid && verdict?.status === 'unknown') {
      unknownRows++;
      unknownDomains.add(verdict.domain);
    }

    if (verdict?.status === 'live') {
      bump(providerMix, verdict.provider);
    }

    const drop = isSyntaxInvalid || deadStatus !== undefined || flags.some((f) => DROP_FLAGS.includes(f));
    // The dead status leads the reason: it is the fact, the flags are context.
    const reasonParts = [
      ...(deadStatus ? [deadStatus] : []),
      ...flags.filter((f) => !(f === 'syntax_invalid' && deadStatus)),
    ];

    results.push({
      row,
      flags,
      ...(verdict ? { verdict } : {}),
      drop,
      reason: reasonParts.join('+'),
    });
  }

  const total = rows.length;
  return {
    schemaVersion: 1,
    totalRows: total,
    uniqueDomains: verdictsByDomain.size,
    bounce: { rows: bounceRows, pct: pct(bounceRows, total), causes: bounceCauses },
    risk: { rows: riskRows, pct: pct(riskRows, total), causes: riskCauses },
    duplicates: { duplicateInList, alreadyContacted },
    freeProvider,
    providerMix,
    unknown: { rows: unknownRows, domains: unknownDomains.size },
    results,
  };
}
