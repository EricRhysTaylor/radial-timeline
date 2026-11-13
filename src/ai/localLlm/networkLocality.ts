/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Whether a Local server address stays on the author's computer or local
 * network.
 *
 * Local servers are reached over plain http on purpose (Ollama and LM Studio
 * serve nothing else), so the transport allows it. That is safe only while the
 * traffic stays off the internet. Settings uses this to warn, never to block,
 * when an http address points anywhere else, since the manuscript text in each
 * request would then cross the internet unencrypted.
 *
 * Local or private: `localhost` and `*.localhost`, `*.local` (mDNS), the
 * unspecified address 0.0.0.0 (which reaches this computer), IPv4 loopback
 * 127.0.0.0/8, private 10/8, 172.16/12, 192.168/16 and link-local 169.254/16,
 * and IPv6 loopback ::1, unique-local fc00::/7 and link-local fe80::/10,
 * including IPv4 addresses written as IPv4-mapped IPv6. Any other name is
 * treated as off-network: a name could resolve anywhere, and this check does
 * no lookups.
 */

function ipv4Octets(host: string): number[] | null {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
    const octets = host.split('.').map(Number);
    return octets.every(octet => octet <= 255) ? octets : null;
}

function isLocalIpv4([a, b]: number[]): boolean {
    return a === 127
        || a === 10
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 169 && b === 254)
        || (a === 0 && b === 0);
}

/** Expands an IPv6 address (no brackets, no zone) to its eight 16-bit groups. */
function ipv6Groups(host: string): number[] | null {
    if (!host.includes(':')) return null;
    let text = host;
    // A trailing dotted IPv4 (`::ffff:10.0.0.1`) becomes its two hex groups.
    const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) {
        const octets = ipv4Octets(dotted[2]);
        if (!octets) return null;
        text = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const parse = (part: string): number[] | null => {
        if (part === '') return [];
        const groups = part.split(':');
        if (!groups.every(group => /^[0-9a-f]{1,4}$/i.test(group))) return null;
        return groups.map(group => parseInt(group, 16));
    };
    const head = parse(halves[0]);
    const tail = halves.length === 2 ? parse(halves[1]) : [];
    if (!head || !tail) return null;
    if (halves.length === 1) return head.length === 8 ? head : null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function isLocalIpv6(groups: number[]): boolean {
    const leadingZero = groups.slice(0, 5).every(group => group === 0);
    if (leadingZero && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return true; // ::1
    if (leadingZero && groups[5] === 0xffff) {
        return isLocalIpv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
    }
    return (groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80;
}

/** True when the URL's host is this computer or a private or link-local network address. */
export function isLocalOrPrivateHost(url: string): boolean {
    let hostname: string;
    try {
        hostname = new URL(url.trim()).hostname.toLowerCase();
    } catch {
        return false;
    }
    const host = hostname.replace(/^\[|\]$/g, '').replace(/%.*$/, '').replace(/\.$/, '');
    if (!host) return false;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    const octets = ipv4Octets(host);
    if (octets) return isLocalIpv4(octets);
    const groups = ipv6Groups(host);
    return groups ? isLocalIpv6(groups) : false;
}

/** True for a plain-http address that leaves the computer and local network. */
export function isUnencryptedOffNetworkUrl(url: string): boolean {
    let protocol: string;
    try {
        protocol = new URL(url.trim()).protocol;
    } catch {
        return false;
    }
    return protocol === 'http:' && !isLocalOrPrivateHost(url);
}
