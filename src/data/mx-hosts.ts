import type { Provider, GatewayName } from '../types.js';

/**
 * MX hostname suffixes mapped to the mailbox provider behind them.
 *
 * Order matters: the first matching suffix wins, so more specific patterns
 * must precede more general ones. Matching is on suffix rather than exact
 * hostname because providers mint per-tenant names
 * (`acme-com.mail.protection.outlook.com`).
 */
export const PROVIDER_SUFFIXES: ReadonlyArray<readonly [string, Provider]> = [
  ['.mail.protection.outlook.com', 'microsoft'],
  ['.outlook.com', 'microsoft'],
  ['.office365.com', 'microsoft'],
  ['.hotmail.com', 'microsoft'],
  ['.google.com', 'google'],
  ['.googlemail.com', 'google'],
  ['.zoho.com', 'zoho'],
  ['.zoho.eu', 'zoho'],
  ['.yandex.net', 'yandex'],
  ['.yandex.ru', 'yandex'],
  ['.protonmail.ch', 'proton'],
  ['.proton.me', 'proton'],
  ['.protonmail.com', 'proton'],
  ['.secureserver.net', 'secureserver'],
  ['.ovh.net', 'ovh'],
  ['.emailsrvr.com', 'rackspace'],
  ['.mailtrust.com', 'rackspace'],
  ['.amazonaws.com', 'amazon-ses'],
  ['.messagingengine.com', 'fastmail'],
  ['.fastmail.com', 'fastmail'],
  ['.pobox.com', 'fastmail'],
];

/**
 * MX hostname suffixes belonging to secure email gateways.
 *
 * These domains still accept mail, so they are never a bounce. They are worth
 * reporting separately because a gateway filters aggressively before a human
 * sees anything, which depresses reply rate without showing up as a bounce.
 */
export const GATEWAY_SUFFIXES: ReadonlyArray<readonly [string, GatewayName]> = [
  ['.pphosted.com', 'proofpoint'],
  ['.ppsmtp.com', 'proofpoint'],
  ['.proofpoint.com', 'proofpoint'],
  ['.mimecast.com', 'mimecast'],
  ['.mimecast.co.za', 'mimecast'],
  ['.barracudanetworks.com', 'barracuda'],
  ['.barracuda.com', 'barracuda'],
  ['.iphmx.com', 'ironport'],
  ['.cisco.com', 'ironport'],
  ['.mailcontrol.com', 'forcepoint'],
  ['.messagelabs.com', 'messagelabs'],
  ['.trendmicro.com', 'trendmicro'],
  ['.tmes.trendmicro.com', 'trendmicro'],
  ['.sophos.com', 'sophos'],
  ['.fortimail.com', 'fortinet'],
  ['.fortinet.com', 'fortinet'],
];

/**
 * IP addresses and ranges that mean "this name resolves, but nothing is here".
 *
 * The RFC 5737 documentation ranges show up in the wild as deliberate black
 * holes on parked domains — a registrar or a mistaken template pointing a name
 * at an address reserved for examples.
 */
export const PARKED_PREFIXES: readonly string[] = [
  '192.0.2.', // RFC 5737 TEST-NET-1
  '198.51.100.', // RFC 5737 TEST-NET-2
  '203.0.113.', // RFC 5737 TEST-NET-3
  '127.', // loopback
  '10.', // RFC 1918, not routable from the public internet
  '169.254.', // link-local
];

export const PARKED_EXACT: ReadonlySet<string> = new Set(['0.0.0.0', '255.255.255.255']);
