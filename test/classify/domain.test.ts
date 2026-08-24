import { describe, it, expect } from 'vitest';
import { classifyDomain } from '../../src/classify/domain.js';
import type { MxAnswer, AAnswer } from '../../src/types.js';

const mxOk = (...hosts: string[]): MxAnswer => ({
  kind: 'ok',
  records: hosts.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 })),
});
const noA: AAnswer = { kind: 'none' };

describe('classifyDomain', () => {
  it('marks a domain with MX as live', () => {
    expect(classifyDomain('x.com', mxOk('mail.x.com'), noA).status).toBe('live');
  });

  it('marks NXDOMAIN as dead', () => {
    expect(classifyDomain('x.com', { kind: 'nxdomain' }, noA).status).toBe('nxdomain');
  });

  it('detects RFC 7505 null MX written as a dot', () => {
    expect(classifyDomain('x.com', mxOk('.'), noA).status).toBe('null_mx');
  });

  it('detects RFC 7505 null MX written as an empty exchange', () => {
    // This is how node:dns actually reports it. Missing this spelling would
    // silently classify every null-MX domain as deliverable.
    expect(classifyDomain('x.com', mxOk(''), noA).status).toBe('null_mx');
  });

  it('does not treat a domain with a real MX plus another record as null MX', () => {
    expect(classifyDomain('x.com', mxOk('', 'mail.x.com'), noA).status).toBe('live');
  });

  it('honors RFC 5321 implicit MX: no MX but an A record is live', () => {
    const v = classifyDomain('x.com', { kind: 'none' }, { kind: 'ok', addresses: ['93.184.216.34'] });
    expect(v.status).toBe('live');
    expect(v.note).toMatch(/implicit MX/i);
  });

  it('marks no MX and no A as dead', () => {
    expect(classifyDomain('x.com', { kind: 'none' }, noA).status).toBe('no_mx_no_a');
  });

  it('maps a DNS error to unknown, not to dead', () => {
    expect(classifyDomain('x.com', { kind: 'error', reason: 'ETIMEOUT' }, noA).status).toBe('unknown');
  });

  it('maps an A-lookup error to unknown when MX was absent', () => {
    const v = classifyDomain('x.com', { kind: 'none' }, { kind: 'error', reason: 'ETIMEOUT' });
    expect(v.status).toBe('unknown');
  });

  it('does not mark unknown as parked even on a black-hole A record', () => {
    const v = classifyDomain('x.com', { kind: 'error', reason: 'ETIMEOUT' }, { kind: 'ok', addresses: ['192.0.2.1'] });
    expect(v.status).toBe('unknown');
    expect(v.risks).not.toContain('parked');
  });

  it.each([
    ['aspmx.l.google.com', 'google'],
    ['acme-com.mail.protection.outlook.com', 'microsoft'],
    ['mx.zoho.com', 'zoho'],
    ['mx.yandex.net', 'yandex'],
    ['mail.protonmail.ch', 'proton'],
    ['smtp.secureserver.net', 'secureserver'],
    ['mx1.ovh.net', 'ovh'],
    ['mx.emailsrvr.com', 'rackspace'],
    ['inbound-smtp.us-east-1.amazonaws.com', 'amazon-ses'],
    ['in1-smtp.messagingengine.com', 'fastmail'],
    ['mail.acme-corp.com', 'self-hosted'],
  ])('classifies %s as %s', (host, provider) => {
    expect(classifyDomain('acme-corp.com', mxOk(host), noA).provider).toBe(provider);
  });

  it.each([
    ['mx1.acme.com.pphosted.com', 'proofpoint'],
    ['us-smtp-inbound-1.mimecast.com', 'mimecast'],
    ['mx.acme.com.barracudanetworks.com', 'barracuda'],
    ['mx1.hc1234-56.iphmx.com', 'ironport'],
    ['mx1.acme.com.mailcontrol.com', 'forcepoint'],
    ['mail.messagelabs.com', 'messagelabs'],
  ])('detects %s as the %s gateway', (host, gateway) => {
    const v = classifyDomain('acme.com', mxOk(host), noA);
    expect(v.gateway).toBe(gateway);
    expect(v.risks).toContain('gateway');
    expect(v.status).toBe('live');
  });

  it('flags RFC 5737 and black-hole A records as parked', () => {
    for (const ip of ['192.0.2.1', '198.51.100.7', '203.0.113.9', '0.0.0.0']) {
      const v = classifyDomain('x.com', { kind: 'none' }, { kind: 'ok', addresses: [ip] });
      expect(v.risks, ip).toContain('parked');
    }
  });

  it('does not flag an ordinary A record as parked', () => {
    const v = classifyDomain('x.com', { kind: 'none' }, { kind: 'ok', addresses: ['93.184.216.34'] });
    expect(v.risks).not.toContain('parked');
  });

  it('uses the lowest-priority MX to pick the provider', () => {
    const mx: MxAnswer = {
      kind: 'ok',
      records: [
        { exchange: 'backup.self-hosted.com', priority: 50 },
        { exchange: 'aspmx.l.google.com', priority: 1 },
      ],
    };
    expect(classifyDomain('x.com', mx, noA).provider).toBe('google');
  });

  it('records the MX hostnames it saw', () => {
    expect(classifyDomain('x.com', mxOk('a.mx.com', 'b.mx.com'), noA).mx).toEqual(['a.mx.com', 'b.mx.com']);
  });

  it('matches provider hosts case-insensitively and with a trailing dot', () => {
    expect(classifyDomain('x.com', mxOk('ASPMX.L.GOOGLE.COM.'), noA).provider).toBe('google');
  });

  it('detects a gateway even when the provider is unknown', () => {
    const v = classifyDomain('x.com', mxOk('cluster.mimecast.com'), noA);
    expect(v.risks).toContain('gateway');
  });
});
