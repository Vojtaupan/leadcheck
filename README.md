# leadcheck

**A pre-flight gate for cold-email lead lists.** Point it at a CSV and it tells
you what fraction of the list cannot be delivered — before you upload it and
find out from your bounce rate.

DNS only. No SMTP probing, no API key, no account, no data leaves your machine
except DNS queries.

```
$ leadcheck leads.csv

leadcheck  2000 rows, 1404 domains

  BOUNCE FLOOR        3.4%      68  FAIL  over the 2% limit
      nxdomain                    61
      null_mx                      5
      no_mx_no_a                   2

  RISK               12.1%     242
      gateway                    149
      role_inbox                  62
      parked                      18
      disposable                  13

  OTHER
      duplicate_in_list          355
      already_contacted          460
      free_provider              117

  PROVIDER MIX (deliverable rows)
      google                    1021    71.5%
      microsoft                  168    11.8%
      self-hosted                149    10.4%
      ...

$ echo $?
1
```

Exit code 1 means "this list is over your threshold." That is the point: it
drops into a script or a CI job and stops a bad upload automatically.

## Why this exists

Hard bounce rate is the number mailbox providers weigh most heavily when
deciding whether your sending domain is trustworthy. A list carrying a 3%
dead-domain floor damages your sender reputation before anybody reads a word of
your copy — and the damage lands on the domain, not the list.

The tooling that exists does not catch this:

| Tool category | What it checks | What it misses |
|---|---|---|
| Domain auditors (`mail-audit`, `credmail`, `@propgate/cli`) | **your** sending domain: SPF, DKIM, DMARC, MX, TLS | the list you are sending to |
| Address validators (`@devmehq/email-validator-js`, `@visulima/email-verifier`) | one address at a time, as a library | the list as a whole, and no verdict |
| Paid verification services | per-address, at a price | in practice they still pass rows whose domain does not resolve |

`leadcheck` is the missing one: it takes the list as a unit and returns an
operational verdict. It complements the tools above rather than replacing them
— check your sending domain with one of those, and your list with this.

In one real 2,000-row list that had already been through a paid verification
service, 3.4% of rows pointed at domains that no longer resolved at all. That
was a guaranteed hard-bounce floor, sitting above the 2% line, invisible until
send day.

## Install

```bash
npx leadcheck leads.csv          # no install
npm install -g leadcheck         # or install it
```

Requires Node 20 or newer. Zero runtime dependencies.

## Usage

```
leadcheck <file.csv> [options]
leadcheck -            [options]   read the CSV from stdin

  --email-column <name>  use this column instead of auto-detecting
  --sent-ledger <file>   CSV or newline list of already-contacted addresses
  --max-bounce <pct>     exit 1 above this predicted floor (default 2)
  --out <file.csv>       write the cleaned list, with a reason column
  --rejects <file.csv>   write only the dropped rows
  --json                 print the summary as JSON instead of a table
  --concurrency <n>      DNS lookups in flight (default 20)
  --timeout <ms>         per-lookup timeout (default 5000)
  --dns-server <ip>      resolve against this server instead of the system one
  --no-color, --quiet, --help, --version
```

The email column is detected automatically from the header (`email`,
`Work Email`, `e-mail address`, …) or, failing that, from which column actually
contains addresses.

## What it checks

### Guaranteed bounces

These make up the bounce floor. Every one of them means mail cannot be
delivered, so the row is dropped from `--out`.

| Check | Meaning |
|---|---|
| `nxdomain` | the domain does not exist |
| `null_mx` | the domain publishes a null MX (RFC 7505): it explicitly accepts no mail |
| `no_mx_no_a` | no MX record and no A record to fall back to |
| `syntax_invalid` | not a parseable address; costs no DNS query |

`leadcheck` honors RFC 5321 implicit MX: a domain with no MX record but a valid
A record still accepts mail, and is **not** counted as a bounce. Tools that
check MX alone report false bounces on small self-hosted domains.

### Risk

These domains accept mail. They are reported because they change what you should
expect, and they are **kept** in the cleaned list — whether to mail them is your
call, not the tool's.

| Check | Meaning |
|---|---|
| `gateway` | a secure email gateway sits in front (Proofpoint, Mimecast, Barracuda, IronPort, Forcepoint, MessageLabs, Trend Micro, Sophos, Fortinet). Mail is filtered hard before a human sees it — this depresses reply rate without ever bouncing |
| `parked` | the domain resolves to a black-hole address (RFC 5737 documentation ranges, `0.0.0.0`, loopback, RFC 1918) |
| `role_inbox` | a shared mailbox (`info@`, `sales@`, `office@`, …) rather than a person |
| `disposable` | a known throwaway-inbox service |

### Waste

| Check | Meaning |
|---|---|
| `duplicate_in_list` | the same mailbox appears more than once. Gmail dots and `+tags` are normalized, so `a.n.n+promo@gmail.com` and `ann@gmail.com` collapse |
| `already_contacted` | present in the `--sent-ledger` file you pass |
| `free_provider` | a consumer mailbox. Reported, never treated as a risk |

`--sent-ledger` is worth wiring up. A stale "already sent" flag in a CRM is an
easy way to email several hundred people a second time.

### Provider mix

The split of your deliverable rows across Google, Microsoft, Zoho, self-hosted
and the rest. Useful when your sending infrastructure is concentrated on one
provider: some sending tools quietly deprioritize leads that do not match their
own mailbox provider, so a list that is 30% Microsoft against an all-Google
sending fleet will not send the way you expect.

## The honesty rule

DNS lookups fail for reasons that say nothing about the domain — timeouts,
SERVFAIL, rate limiting, a resolver that is having a bad day.

Every one of those is reported as `unknown`, in its own bucket. **`unknown` is
never counted toward the bounce floor and never merged into "deliverable".**

A pre-flight tool that guesses on ambiguous evidence is worse than no tool,
because it converts an unknown into false confidence.

For the same reason, `leadcheck` refuses to run when it cannot reach a working
DNS resolver at all, rather than reporting your entire list as `unknown` and
letting that read as a clean result. If your system resolver does not answer, it
falls back to a public resolver and says so on stderr; if nothing answers, it
exits 2 and tells you to pass `--dns-server`.

## Output files

`--out` writes the list you should actually upload: originals preserved, plus a
`leadcheck_reason` column. `--rejects` writes only the dropped rows with the
same column. Together they reconstruct your input exactly — nothing is silently
discarded.

Dropped: `syntax_invalid`, `nxdomain`, `null_mx`, `no_mx_no_a`,
`duplicate_in_list`, `already_contacted`, `disposable`.
Kept, flagged: `role_inbox`, `free_provider`, `gateway`, `parked`, `unknown`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | bounce floor is within `--max-bounce` |
| `1` | bounce floor is above `--max-bounce` |
| `2` | usage error, unreadable input, no email column, or no usable DNS resolver |

## In CI

```yaml
- name: Gate the lead list
  run: npx leadcheck leads/latest.csv --max-bounce 2 --out leads/clean.csv
```

Or as a pre-upload hook:

```bash
leadcheck "$LIST" --max-bounce 2 --out clean.csv --rejects dropped.csv \
  || { echo "list is over the bounce threshold; not uploading"; exit 1; }
```

## What it deliberately does not do

- **SMTP probing / catch-all detection.** Connecting to recipient mail servers
  to test individual addresses risks your IP's reputation, is widely rate
  limited, and cannot honestly resolve catch-all domains — a catch-all `250 OK`
  means nothing, and reporting it as "valid" would be a lie. If you need
  per-address verification, use a paid service, and run `leadcheck` first so you
  are not paying to verify addresses at domains that do not exist.
- **Blacklist / DNSBL lookups.** Blacklists describe senders. Whether a
  *recipient* domain is listed answers no useful question.
- **Auditing your own sending domain** (SPF, DKIM, DMARC). That is a different
  job with good tools already: `mail-audit`, `credmail`, `@propgate/cli`.

Being narrow is the design, not a gap to be filled later.

## Programmatic use

Every piece is exported and the DNS layer is an injectable interface, so you can
drive it from your own code and test against fixtures with no network:

```ts
import { classifyDomain, buildReport, FixtureResolver, resolveAll } from 'leadcheck';
```

## Development

```bash
npm install
npm test              # offline, deterministic
npm run typecheck
npm run build

LEADCHECK_LIVE=1 npm test   # also runs the live-DNS suite
```

The test suite runs entirely offline: DNS is an injected interface backed by a
fixture resolver. The live suite is opt-in, and exists because fixtures cannot
catch a broken production resolver — it caught exactly that during development.

## License

MIT
