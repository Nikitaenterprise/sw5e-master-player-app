// Reads the rules archive straight out of vendor/sw5e-database.tar.gz, in memory.
//
// Why not read the unpacked files: the archive holds 7,885 small JSON documents, and
// opening them one by one takes about a minute on a mounted or network drive, while
// gunzip plus a walk over the tar takes about a tenth of a second. So nothing here
// depends on .cache being unpacked, and a fresh clone works with no extra step.
// tools/unpack-compendium.mjs stays a convenience for a human who wants to look at
// the files themselves.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export interface ArchiveEntry {
  /** Path inside the archive, e.g. sw5e-database/content/species/kel-dor.json */
  path: string;
  text: string;
}

const BLOCK = 512;
const decoder = new TextDecoder();

function field(header: Uint8Array, offset: number, length: number): string {
  return decoder.decode(header.subarray(offset, offset + length)).replace(/\0[\s\S]*$/, '');
}

/**
 * Walks a tar buffer and returns its regular files.
 *
 * Handles the GNU long-name entry (type 'L'), which this archive does use: 14 of its
 * paths do not fit the 100-byte name field, and without this they would come out
 * truncated and silently lose documents.
 */
export function readTar(tar: Uint8Array): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let offset = 0;
  let longName: string | null = null;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;

    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const flag = field(header, 156, 1);
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (flag === 'L') {
      longName = decoder.decode(body).replace(/\0[\s\S]*$/, '');
      continue;
    }
    if (flag === 'x' || flag === 'g') {
      // PAX extended headers. This archive has none; if one ever appears we fall
      // back to the ustar name rather than guessing.
      continue;
    }
    if (flag !== '0' && flag !== '') {
      longName = null;
      continue;
    }

    let path = longName ?? field(header, 0, 100);
    if (longName === null) {
      const prefix = field(header, 345, 155);
      if (prefix !== '') path = `${prefix}/${path}`;
    }
    longName = null;
    out.push({ path, text: decoder.decode(body) });
  }
  return out;
}

/**
 * Reads the archive and checks it against the manifest checksum first. A corrupted
 * or swapped archive must fail loudly here, not as strange numbers on a sheet.
 */
export function readArchive(archivePath: string, manifestPath: string): ArchiveEntry[] {
  let gz: Buffer;
  try {
    gz = readFileSync(archivePath);
  } catch {
    throw new Error(
      `Немає ${archivePath} — репозиторій склоновано неповністю. Відновити: git checkout HEAD -- vendor/`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const expected = manifest['sha256'];
  const actual = createHash('sha256').update(gz).digest('hex');
  if (typeof expected === 'string' && expected !== actual) {
    throw new Error(
      'Контрольна сума архіву правил не збігається з vendor/МАНІФЕСТ.json — '
      + 'архів пошкоджений або підмінений. Відновити: git checkout HEAD -- vendor/',
    );
  }
  return readTar(gunzipSync(gz));
}
