import type { Resolver, MxAnswer, AAnswer } from '../types.js';

export interface ResolveAllOptions {
  concurrency: number;
  onProgress?: (done: number, total: number) => void;
}

export interface DomainAnswers {
  mx: MxAnswer;
  a: AAnswer;
}

function errorAnswer(err: unknown): { kind: 'error'; reason: string } {
  const reason =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : 'EUNKNOWN';
  return { kind: 'error', reason };
}

/**
 * Look up every distinct domain with a bounded number of queries in flight.
 *
 * The A lookup is conditional: it only runs when MX came back `none`, which is
 * the RFC 5321 implicit-MX case. A domain with MX records, an NXDOMAIN, or a
 * resolver error has nothing to gain from a second query, and lists run to
 * thousands of domains, so the saved half is most of the work.
 *
 * A resolver that throws yields an error answer for that domain. One bad
 * domain must never abort the run.
 */
export async function resolveAll(
  domains: string[],
  resolver: Resolver,
  options: ResolveAllOptions,
): Promise<Map<string, DomainAnswers>> {
  const unique = [...new Set(domains)];
  const results = new Map<string, DomainAnswers>();
  const total = unique.length;
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= total) return;
      const domain = unique[index]!;

      let mx: MxAnswer;
      try {
        mx = await resolver.mx(domain);
      } catch (err) {
        mx = errorAnswer(err);
      }

      let a: AAnswer = { kind: 'none' };
      if (mx.kind === 'none') {
        try {
          a = await resolver.a(domain);
        } catch (err) {
          a = errorAnswer(err);
        }
      }

      results.set(domain, { mx, a });
      done++;
      options.onProgress?.(done, total);
    }
  };

  const size = Math.max(1, Math.min(options.concurrency, total));
  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}
