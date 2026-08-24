# leadcheck — design

_Date: 2026-08-24_

## Problem

Cold-email operators upload lead lists containing rows that cannot possibly be
delivered. Some fraction of any scraped or purchased list points at domains that
no longer resolve, publish a null MX, or park on a black-hole address. Those
rows are guaranteed hard bounces.

Hard bounce rate is the metric mailbox providers weigh most heavily when
deciding whether a sending domain is trustworthy, so a list carrying a 3%
dead-domain floor damages the sender before a human reads a word of the copy.

Existing tooling does not catch this before the upload:

- **Domain auditors** (`mail-audit`, `credmail`, `@propgate/cli`,
  `email-domain-check`) check the *sender's* domain — SPF, DKIM, DMARC, MX, TLS.
  They say nothing about the list being sent to.
- **Address validators** (`@devmehq/email-validator-js`,
  `@visulima/email-verifier`) are per-address libraries designed to be embedded,
  not run as a gate over a whole file.
- **Commercial verification services** operate per-address at a price, and in
  practice still pass rows whose domain does not resolve.

Nothing takes a list as a whole and returns an operational verdict.

## What leadcheck does

`leadcheck` reads a CSV of leads and answers one question: **what fraction of
this list is guaranteed to fail, and what will the rest do to sender
reputation?** It exits non-zero when the predicted hard-bounce floor exceeds a
threshold, so it can gate an upload from a script or a CI job.

It is DNS-only. It performs no SMTP conversation.

## Non-goals

Explicitly out of scope for v1, and stated as such in the README:

- **SMTP probing / catch-all detection.** Connecting to recipient mail servers
  to test addresses risks the user's IP reputation, is widely rate-limited, and
  cannot honestly resolve catch-all domains. A tool that reports "valid" from a
  catch-all `250 OK` is lying.
- **DNSBL / blacklist lookups.** Blacklists describe senders. Whether a
  *recipient* domain is listed answers no useful question.
- **SPF / DKIM / DMARC auditing of the sending domain.** This is the crowded
  commodity space. The README names alternatives rather than competing.
- Enrichment, web UI, API server, address correction.

Narrowness is the positioning, not a limitation to be fixed later.

## The honesty rule

DNS lookups fail for reasons that are not evidence about the domain: timeouts,
SERVFAIL, local resolver problems, rate limiting. Every such result is recorded
as `unknown`, reported in its own bucket, and never folded into either
"deliverable" or "dead". `unknown` never counts toward the bounce floor.

This is load-bearing. A pre-flight tool that guesses on ambiguous evidence is
worse than no tool, because it converts an unknown into false confidence.

## Architecture

Seven units. The load-bearing property is that exactly one of them touches the
network; everything else is pure and testable offline.

| Unit | Responsibility | I/O |
|---|---|---|
| `src/input/` | RFC 4180 CSV parsing, email-column detection, row model | file |
| `src/classify/address.ts` | syntax, role inbox, free provider, disposable, dedupe keys | pure |
| `src/resolve/resolver.ts` | the only DNS caller: `Resolver` interface, concurrency, timeout, cache | network |
| `src/classify/domain.ts` | verdict from resolver results: liveness, provider, gateway, parked | pure |
| `src/analyze/report.ts` | rows + verdicts → report object | pure |
| `src/report/` | human table, JSON, cleaned CSV, rejects CSV | file |
| `src/cli.ts` | argument parsing, wiring, exit codes | — |

`Resolver` is an interface with two methods, `mx` and `a`. No v1 check reads TXT
records, so the interface does not expose them. The production implementation
wraps `node:dns/promises`. Tests inject a `FixtureResolver`
backed by a static map, so the entire suite is deterministic and runs with no
network. A separate live suite is opt-in behind `LEADCHECK_LIVE=1`.

### Data flow

```
CSV file
  → parseCsv            (input/csv.ts)
  → detectEmailColumn   (input/columns.ts)
  → Row[]               { raw, email, lineNumber }
  → classifyAddress     (pure, per row)
  → unique domain set
  → Resolver.mx/a       (network, bounded concurrency, cached)
  → classifyDomain      (pure, per domain)
  → buildReport         (pure, rows + domain verdicts)
  → render              (table | json | csv | rejects)
  → exit code
```

## Checks

### Per address (pure, no DNS)

| Code | Meaning |
|---|---|
| `syntax_invalid` | no `@`, empty local or domain part, illegal label, whitespace |
| `role_inbox` | shared mailbox: `info`, `sales`, `admin`, `office`, `contact`, `support`, `billing`, `hello`, `team`, `help`, `careers`, `jobs`, `hr`, `marketing`, `accounts`, `service`, `enquiries`, `noreply`, `no-reply`, `postmaster`, `abuse`, `webmaster` |
| `free_provider` | gmail, yahoo, hotmail, outlook, aol, icloud, proton, gmx, mail.ru, yandex |
| `disposable` | bundled static list, dated in the file header |
| `duplicate_in_list` | second and later occurrences, case-insensitive |
| `already_contacted` | present in `--sent-ledger` |

Duplicate detection normalizes Gmail dots and `+tags` **for matching only**. The
original address is always what gets written to output.

### Per domain (DNS)

| Code | Meaning | Counts as |
|---|---|---|
| `nxdomain` | domain does not exist | dead |
| `null_mx` | single MX of `.` (RFC 7505): explicitly accepts no mail | dead |
| `no_mx_no_a` | no MX and no A/AAAA fallback | dead |
| `parked` | A record in RFC 5737 ranges, `0.0.0.0`, or a known parking IP | risk |
| `gateway` | MX belongs to a secure email gateway | risk |
| `live` | MX present, or A fallback per RFC 5321 implicit MX | deliverable |
| `unknown` | timeout, SERVFAIL, or refused | unknown |

**RFC 5321 implicit MX is deliberately honored.** A domain with no MX record but
a valid A record still accepts mail at that address. Treating missing-MX alone
as a bounce would produce false positives on small self-hosted domains.

Provider classification maps MX hostnames to: `google`, `microsoft`, `zoho`,
`yandex`, `proton`, `secureserver` (GoDaddy), `ovh`, `rackspace`, `amazon-ses`,
`fastmail`, `self-hosted`, `unknown`.

Gateway detection matches Proofpoint (`pphosted`, `ppsmtp`), Mimecast, Barracuda
(`barracudanetworks`), Cisco IronPort (`iphmx`), Forcepoint (`mailcontrol`),
Symantec/MessageLabs, Trend Micro, Sophos, Fortinet. Gateway domains are
deliverable but filtered; they are reported separately because they depress
reply rates without bouncing.

## CLI surface

```
leadcheck <file.csv> [options]
leadcheck - [options]              # read from stdin

--email-column <name>   override auto-detection
--sent-ledger <file>    CSV or newline list of already-contacted addresses
--max-bounce <pct>      exit 1 above this predicted floor (default 2)
--out <file.csv>        write cleaned list with a leadcheck_reason column
--rejects <file.csv>    write only the dropped rows
--json                  machine-readable report on stdout
--concurrency <n>       DNS lookups in flight (default 20)
--timeout <ms>          per-lookup timeout (default 5000)
--cache <file>          persist domain results between runs
--no-color / --quiet / --verbose
--version / --help
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | predicted bounce floor at or under `--max-bounce` |
| 1 | predicted bounce floor above `--max-bounce` |
| 2 | usage error, unreadable input, no email column found |

Exit code 1 is a verdict, not a crash. That is what makes the tool a gate.

### What `--out` drops

The cleaned list drops exactly the rows that cannot be delivered or must not be
sent again: `syntax_invalid`, `nxdomain`, `null_mx`, `no_mx_no_a`,
`duplicate_in_list`, `already_contacted`, and `disposable`.

It **keeps** rows flagged only as `role_inbox`, `free_provider`, `gateway`,
`parked`, or `unknown`, carrying the flag in the `leadcheck_reason` column.
Those are judgment calls about targeting, not deliverability facts, and the tool
does not make them on the operator's behalf. A row kept with a reason is still
reported in the risk buckets.

Every dropped row appears in `--rejects` with the same reason column, so the two
outputs always reconstruct the input exactly.

## Report shape

Human output is a grouped table: bounce floor with its causes, risk with its
causes, duplicates, provider mix over deliverable rows, and an unknown bucket.
`--json` emits the same data as a stable object carrying a `schemaVersion`.

## Error handling

- Unreadable or missing input file → exit 2 with the path in the message.
- No email column detected → exit 2, listing the headers that were considered.
- A row with an unparseable address is counted under `syntax_invalid`, never
  dropped silently.
- DNS failures degrade to `unknown` per domain; a failing resolver never aborts
  the run.
- An unwritable `--out` or `--rejects` path → exit 2, but only after the report
  has printed, so the analysis is not lost.

## Testing

Vitest. The suite runs offline and deterministically.

- Unit tests per pure module: address classification, domain classification,
  report arithmetic, CSV parsing.
- CSV edge cases: quoted commas, embedded newlines, CRLF, BOM, ragged rows,
  duplicate headers.
- `FixtureResolver` drives domain classification against recorded DNS shapes.
- Golden-file tests on the rendered human report and the JSON report.
- Exit-code tests covering 0, 1 and 2.
- Opt-in live suite behind `LEADCHECK_LIVE=1` against domains with stable,
  externally verifiable DNS.

CI: GitHub Actions, Linux and Windows, Node 20 and 22.

## Distribution

Published to npm as `leadcheck`, runnable via `npx leadcheck`. TypeScript
compiled to ES modules. Zero runtime dependencies: CSV parsing, argument parsing
and table rendering are implemented in-repo against Node built-ins.

## Publish safety

The repository is built clean-room, outside any other working tree. No file is
ever copied in from elsewhere. The README presents statistics without
attribution and contains no prospect names, customer domains, or campaign
identifiers. `scripts/scrub-check.sh` greps the tree for disclosure patterns
that must never appear, and is a required gate before publishing.
