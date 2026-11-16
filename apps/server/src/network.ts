// Finds the laptop's address on the local network and draws a QR code for phones.
import { networkInterfaces } from 'node:os';

/**
 * The address at which phones on the same network will see the server.
 * Returns null when the laptop is attached to nothing — then only the laptop
 * itself works, through localhost, and that has to be said in plain words.
 */
export function localAddress(): string | null {
  const candidates: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      // Virtual adapters (WSL, Docker, VirtualBox) hand out addresses where a phone
      // would see nothing. We push them to the back rather than drop them: on someone
      // else's laptop the real network may be named unexpectedly.
      const virtual = /vEthernet|VirtualBox|VMware|docker|WSL|Hyper-V/i.test(name);
      if (virtual) candidates.push(i.address);
      else candidates.unshift(i.address);
    }
  }
  return candidates[0] ?? null;
}

/** QR code for the terminal. A player scans it and lands straight on their sheet. */
export async function qrForTerminal(address: string): Promise<string> {
  const { toString } = await import('qrcode');
  return toString(address, { type: 'terminal', small: true });
}
