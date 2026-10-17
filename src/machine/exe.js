// MZ executable parsing and identification of the supported original files.
// The original files are supplied by the user at runtime and are never bundled.

export const KNOWN_FILES = {
  '4979c8867826e08881d1d4bec95c95d6bc1ac70fd21050ccdb4f733a50d7bfdd': {
    id: 'cat-ibm',
    name: 'CAT.EXE',
    size: 55067,
    description: 'Alley Cat (IBM PC, CGA), 1984',
    supported: true,
  },
  '13bc456aa15ce54456fba0618192ecaffc10536109488e5ff9366123844da321': {
    id: 'cat-tandy',
    name: 'TANDYCAT.EXE',
    description: 'Alley Cat (Tandy 1000)',
    supported: false,
  },
};

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseMZ(bytes) {
  if (bytes.length < 0x1c || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error('not an MZ executable');
  }
  const u16 = (o) => bytes[o] | (bytes[o + 1] << 8);
  const lastPage = u16(2);
  const pages = u16(4);
  const fileSize = lastPage ? (pages - 1) * 512 + lastPage : pages * 512;
  const headerSize = u16(8) * 16;
  const relocCount = u16(6);
  const relocOff = u16(0x18);
  const relocs = [];
  for (let i = 0; i < relocCount; i++) {
    relocs.push({ off: u16(relocOff + 4 * i), seg: u16(relocOff + 4 * i + 2) });
  }
  return {
    headerSize,
    fileSize,
    relocs,
    ss: u16(0x0e),
    sp: u16(0x10),
    ip: u16(0x14),
    cs: u16(0x16),
    image: bytes.subarray(headerSize, fileSize),
  };
}

// Identify and validate a user-supplied file. Throws with a user-facing message.
export async function identify(bytes) {
  const hash = await sha256Hex(bytes);
  const known = KNOWN_FILES[hash];
  if (!known) {
    throw new Error(`unrecognised file (sha256 ${hash}); expected the original CAT.EXE`);
  }
  if (!known.supported) {
    throw new Error(`${known.name} (${known.description}) is not supported yet; please supply CAT.EXE`);
  }
  return { hash, ...known, mz: parseMZ(bytes) };
}
