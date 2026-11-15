// Знаходить адресу ноутбука в локальній мережі й малює QR для телефонів.
import { networkInterfaces } from 'node:os';

/**
 * Адреса, за якою телефони в тій самій мережі побачать сервер.
 * Повертає null, якщо ноутбук ні до чого не підключений — тоді працює лише
 * сам ноутбук через localhost, і про це треба сказати словами.
 */
export function локальнаАдреса(): string | null {
  const кандидати: string[] = [];
  for (const [імя, список] of Object.entries(networkInterfaces())) {
    for (const і of список ?? []) {
      if (і.family !== 'IPv4' || і.internal) continue;
      // Віртуальні адаптери (WSL, Docker, VirtualBox) дають адреси, за якими
      // телефон нічого не побачить. Відсуваємо їх у кінець, а не викидаємо:
      // на чиємусь ноутбуці справжня мережа може називатись несподівано.
      const віртуальний = /vEthernet|VirtualBox|VMware|docker|WSL|Hyper-V/i.test(імя);
      if (віртуальний) кандидати.push(і.address);
      else кандидати.unshift(і.address);
    }
  }
  return кандидати[0] ?? null;
}

/** QR-код для терміналу. Гравець сканує його телефоном і одразу потрапляє на свій лист. */
export async function qrДляТерміналу(адреса: string): Promise<string> {
  const { toString } = await import('qrcode');
  return toString(адреса, { type: 'terminal', small: true });
}
