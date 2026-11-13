import { describe, expect, it } from 'vitest';
import { isLocalOrPrivateHost, isUnencryptedOffNetworkUrl } from './networkLocality';

describe('isLocalOrPrivateHost', () => {
    it.each([
        'http://localhost:11434/v1',
        'http://LOCALHOST./v1',
        'http://ollama.localhost:11434',
        'http://studio.local:1234/v1',
        'http://127.0.0.1:11434',
        'http://127.255.10.3',
        'http://0.0.0.0:11434',
        'http://10.0.0.5:8080',
        'http://172.16.0.1',
        'http://172.31.255.254',
        'http://192.168.1.20:1234/v1',
        'http://169.254.10.10',
        'http://[::1]:11434/v1',
        'http://[0:0:0:0:0:0:0:1]',
        'http://[fc00::1]',
        'http://[fd12:3456:789a::1]:8080',
        'http://[fe80::1]',
        'http://[febf::1]',
        'http://[::ffff:192.168.0.2]',
        'http://[::ffff:7f00:1]',
    ])('treats %s as local', (url) => {
        expect(isLocalOrPrivateHost(url)).toBe(true);
    });

    it.each([
        'http://example.com/v1',
        'http://my-gpu-box.example.org:11434',
        'http://localhost.example.com',
        'http://notlocal',
        'http://8.8.8.8',
        'http://172.15.0.1',
        'http://172.32.0.1',
        'http://192.169.0.1',
        'http://169.253.1.1',
        'http://11.0.0.1',
        'http://[2001:db8::1]',
        'http://[fec0::1]',
        'http://[::ffff:8.8.8.8]',
        'not a url',
        '',
    ])('treats %s as off-network', (url) => {
        expect(isLocalOrPrivateHost(url)).toBe(false);
    });
});

describe('isUnencryptedOffNetworkUrl', () => {
    it('flags plain http to an internet address', () => {
        expect(isUnencryptedOffNetworkUrl('http://llm.example.com/v1')).toBe(true);
        expect(isUnencryptedOffNetworkUrl('  http://203.0.113.9:11434/v1  ')).toBe(true);
    });

    it('does not flag https, local addresses or text that is not a URL', () => {
        expect(isUnencryptedOffNetworkUrl('https://llm.example.com/v1')).toBe(false);
        expect(isUnencryptedOffNetworkUrl('http://localhost:11434/v1')).toBe(false);
        expect(isUnencryptedOffNetworkUrl('http://192.168.1.4:1234/v1')).toBe(false);
        expect(isUnencryptedOffNetworkUrl('localhost:11434')).toBe(false);
        expect(isUnencryptedOffNetworkUrl('')).toBe(false);
    });
});
