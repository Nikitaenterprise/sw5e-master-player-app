// Opens the page in the owner's browser once the server has started.
// Needed so ЗАПУСТИТИ.bat really is "double-click and play": without it the
// owner would have to copy the address out of the terminal.
import { exec } from 'node:child_process';

export function openInBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  // If it fails, do not crash: the address is printed in the terminal anyway
  exec(command, () => undefined);
}
