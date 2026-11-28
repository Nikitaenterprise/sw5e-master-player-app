// Finds the laptop's address on the local network and draws a QR code for phones.
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/**
 * VPN tunnels (F-093): macOS `utun`, Linux `tun`/`tap`/`ppp`/`wg`, and the adapters that
 * VPN programs add on Windows. A phone on the Wi-Fi sees nothing at a tunnel's address.
 */
const TUNNEL = /^(utun|tun|tap|ppp|ipsec|wg|gpd)\d*|vpn|wireguard|nordlynx|tailscale|zerotier|openvpn|tap-windows|proton|cisco|anyconnect|fortinet|forticlient|globalprotect/i;

/** Virtual machines' adapters (WSL, Docker, VirtualBox): a phone sees nothing there either. */
const VIRTUAL = /vEthernet|VirtualBox|VMware|docker|WSL|Hyper-V|bridge|vboxnet|vmnet|virbr/i;

/** What a real network is usually called: Wi-Fi and cable, on the three systems. */
const REAL = /^(en|eth|wlan|wlp|wl|enp|eno)\d|wi-?fi|ethernet|wlan|wireless|бездротов|беспроводн|мережа|сеть/i;

/** Tailscale and other carrier-grade NAT addresses, 100.64.0.0/10: never a home Wi-Fi. */
const isCarrierNat = (address: string): boolean => {
  const [a, b] = address.split('.').map(Number);
  return a === 100 && b !== undefined && b >= 64 && b <= 127;
};

/** Lower is better: the real network, then unknown names, then virtual machines, then VPNs. */
function rank(name: string, address: string): number {
  if (TUNNEL.test(name) || isCarrierNat(address)) return 3;
  if (VIRTUAL.test(name)) return 2;
  if (REAL.test(name)) return 0;
  return 1;
}

/**
 * The address at which phones on the same network will see the server.
 * Returns null when the laptop is attached to nothing — then only the laptop
 * itself works, through localhost, and that has to be said in plain words.
 *
 * Nothing is dropped, only ordered: on someone else's laptop the real network may be
 * named unexpectedly, and a tunnel's address is still better than none.
 */
export function localAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string | null {
  const candidates: { address: string; rank: number; order: number }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      candidates.push({ address: i.address, rank: rank(name, i.address), order: candidates.length });
    }
  }
  candidates.sort((x, y) => x.rank - y.rank || x.order - y.order);
  return candidates[0]?.address ?? null;
}

/** QR code for the terminal. A player scans it and lands straight on their sheet. */
export async function qrForTerminal(address: string): Promise<string> {
  const { toString } = await import('qrcode');
  return toString(address, { type: 'terminal', small: true });
}
