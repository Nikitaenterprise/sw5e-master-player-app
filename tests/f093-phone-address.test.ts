// Test for F-093. The address printed for phones is the Wi-Fi one, not a VPN tunnel's.
//
// Found by the MVP readiness check (27.11.2026): on a Mac with a VPN switched on the
// server printed the address and QR of `utun6` (10.8.0.17), while Wi-Fi was `en0`
// (192.168.68.53). A phone sees nothing at a tunnel's address. Virtual machines were
// already pushed back; tunnels were taken as the real network. The table of a machine's
// networks is passed in, so the Mac, Windows and Linux cases all run anywhere.
import { describe, it, expect } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { localAddress } from '../apps/server/src/network.js';

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24`,
});
const table = (rows: Record<string, string>): Record<string, NetworkInterfaceInfo[]> =>
  Object.fromEntries([['lo0', [v4('127.0.0.1', true)]], ...Object.entries(rows).map(([n, a]) => [n, [v4(a)]])]);

describe('F-093 · адреса для телефонів: wifi, а не VPN', () => {
  it('Mac з VPN: utun6 першим у списку — а телефонам однаково адреса en0', () => {
    expect(localAddress(table({ utun6: '10.8.0.17', en0: '192.168.68.53' }))).toBe('192.168.68.53');
  });

  it('Windows: OpenVPN, WireGuard, NordLynx, Tailscale — позаду Wi-Fi', () => {
    expect(localAddress(table({ 'OpenVPN TAP-Windows6': '10.8.0.2', 'Wi-Fi': '192.168.1.20' }))).toBe('192.168.1.20');
    expect(localAddress(table({ 'WireGuard Tunnel': '10.2.0.2', NordLynx: '10.5.0.2', Ethernet: '192.168.0.14' }))).toBe('192.168.0.14');
    expect(localAddress(table({ Tailscale: '100.101.102.103', 'Бездротова мережа': '192.168.31.7' }))).toBe('192.168.31.7');
  });

  it('Linux: tun0, ppp0, wg0 — позаду wlan0', () => {
    expect(localAddress(table({ tun0: '10.9.0.6', ppp0: '10.64.0.1', wg0: '10.7.0.2', wlan0: '192.168.88.40' }))).toBe('192.168.88.40');
  });

  it('VPN позаду навіть віртуальних машин; і краще VPN, ніж нічого', () => {
    expect(localAddress(table({ utun3: '10.8.0.17', 'vEthernet (WSL)': '172.20.0.1' }))).toBe('172.20.0.1');
    expect(localAddress(table({ utun3: '10.8.0.17' }))).toBe('10.8.0.17');
  });

  it('без мережі — null, як і було', () => {
    expect(localAddress(table({}))).toBeNull();
  });
});
