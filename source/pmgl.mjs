// PMGL v1: the secure-link file format (SecureLink/README.md, "The file format").
// Shared by the AME viewer (inlined into the page at build time, with the `export` keywords stripped) and the tests.
// The app writes the same bytes with CryptoKit. Pure WebCrypto: runs in browsers and Node 20+.

const PMGL_MAGIC = [0x50, 0x4d, 0x47, 0x4c]; // "PMGL"
const PMGL_VERSION = 1;
const PMGL_CHUNK = 4 * 1024 * 1024;          // plaintext bytes per non-final chunk
const PMGL_TAG = 16;                          // AES-GCM tag
const PMGL_HEADER = 16;                       // magic(4) version(1) zero(3) noncePrefix(8)

function pmglU32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}
function pmglCat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}
const pmglNonce = (prefix, i) => pmglCat(prefix, pmglU32(i));
const pmglAAD = (header, i, isFinal) => pmglCat(header, pmglU32(i), new Uint8Array([isFinal ? 1 : 0]));

export function pmglHeader(prefix) {
  const h = new Uint8Array(PMGL_HEADER);
  h.set(PMGL_MAGIC, 0);
  h[4] = PMGL_VERSION;
  h.set(prefix, 8);
  return h;
}

export async function pmglImportKey(raw) {
  if (raw.length !== 32) throw new Error("format");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/// Reference encryptor (tests; the app does the same in CryptoKit). A full-size chunk is never final, so a plaintext
/// that is an exact multiple of PMGL_CHUNK (including empty) ends with an empty final chunk.
export async function pmglEncrypt(rawKey, plaintext, prefix = crypto.getRandomValues(new Uint8Array(8))) {
  const key = await pmglImportKey(rawKey);
  const header = pmglHeader(prefix);
  const parts = [header];
  for (let i = 0, off = 0; ; i++) {
    const end = Math.min(off + PMGL_CHUNK, plaintext.length);
    const isFinal = end - off < PMGL_CHUNK;
    parts.push(new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: pmglNonce(prefix, i), additionalData: pmglAAD(header, i, isFinal), tagLength: 128 },
      key, plaintext.subarray(off, end))));
    off = end;
    if (isFinal) break;
  }
  return pmglCat(...parts);
}

/// Streaming decryptor: push() network pieces as they arrive (returns finished plaintext chunks), then finish().
/// Holds at most one chunk plus one network piece, so an 80 MB file never needs two full copies in memory.
export class PmglDecryptor {
  #key; #pending = []; #len = 0; #header = null; #prefix = null; #i = 0;
  constructor(key) { this.#key = key; }

  #take(n) {
    const out = new Uint8Array(n);
    let k = 0;
    while (k < n) {
      const p = this.#pending[0];
      const use = Math.min(p.length, n - k);
      out.set(p.subarray(0, use), k);
      k += use;
      if (use === p.length) this.#pending.shift(); else this.#pending[0] = p.subarray(use);
    }
    this.#len -= n;
    return out;
  }

  async #open(c, isFinal) {
    const p = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: pmglNonce(this.#prefix, this.#i), additionalData: pmglAAD(this.#header, this.#i, isFinal), tagLength: 128 },
      this.#key, c));
    this.#i++;
    return p;
  }

  async push(bytes) {
    if (bytes && bytes.length) { this.#pending.push(bytes); this.#len += bytes.length; }
    const out = [];
    if (!this.#header) {
      if (this.#len < PMGL_HEADER) return out;
      const h = this.#take(PMGL_HEADER);
      const ok = PMGL_MAGIC.every((x, j) => h[j] === x) && h[4] === PMGL_VERSION && h[5] === 0 && h[6] === 0 && h[7] === 0;
      if (!ok) throw new Error("format");
      this.#header = h;
      this.#prefix = h.slice(8, 16);
    }
    while (this.#len > PMGL_CHUNK + PMGL_TAG) out.push(await this.#open(this.#take(PMGL_CHUNK + PMGL_TAG), false));
    return out;
  }

  async finish() {
    if (!this.#header) throw new Error("format");
    if (this.#len < PMGL_TAG || this.#len >= PMGL_CHUNK + PMGL_TAG) throw new Error("format");
    return this.#open(this.#take(this.#len), true);
  }
}

export { PMGL_CHUNK, PMGL_TAG, PMGL_HEADER };
