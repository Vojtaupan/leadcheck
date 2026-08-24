export type AddressFlag =
  | 'syntax_invalid'
  | 'role_inbox'
  | 'free_provider'
  | 'disposable'
  | 'duplicate_in_list'
  | 'already_contacted';

export type DomainStatus = 'live' | 'nxdomain' | 'null_mx' | 'no_mx_no_a' | 'unknown';

export type DomainRisk = 'parked' | 'gateway';

export type Provider =
  | 'google'
  | 'microsoft'
  | 'zoho'
  | 'yandex'
  | 'proton'
  | 'secureserver'
  | 'ovh'
  | 'rackspace'
  | 'amazon-ses'
  | 'fastmail'
  | 'self-hosted'
  | 'unknown';

export type GatewayName =
  | 'proofpoint'
  | 'mimecast'
  | 'barracuda'
  | 'ironport'
  | 'forcepoint'
  | 'messagelabs'
  | 'trendmicro'
  | 'sophos'
  | 'fortinet';

export interface Row {
  lineNumber: number;
  raw: Record<string, string>;
  email: string;
}

export interface DomainVerdict {
  domain: string;
  status: DomainStatus;
  risks: DomainRisk[];
  provider: Provider;
  gateway?: GatewayName;
  mx: string[];
  note?: string;
}

export type MxAnswer =
  | { kind: 'ok'; records: { exchange: string; priority: number }[] }
  | { kind: 'nxdomain' }
  | { kind: 'none' }
  | { kind: 'error'; reason: string };

export type AAnswer =
  | { kind: 'ok'; addresses: string[] }
  | { kind: 'nxdomain' }
  | { kind: 'none' }
  | { kind: 'error'; reason: string };

export interface Resolver {
  mx(domain: string): Promise<MxAnswer>;
  a(domain: string): Promise<AAnswer>;
}

export interface RowResult {
  row: Row;
  flags: AddressFlag[];
  verdict?: DomainVerdict;
  drop: boolean;
  reason: string;
}

export interface Report {
  schemaVersion: 1;
  totalRows: number;
  uniqueDomains: number;
  bounce: { rows: number; pct: number; causes: Record<string, number> };
  risk: { rows: number; pct: number; causes: Record<string, number> };
  duplicates: { duplicateInList: number; alreadyContacted: number };
  providerMix: Record<string, number>;
  unknown: { rows: number; domains: number };
  results: RowResult[];
}
