const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const MAX_LNURL_LENGTH = 2048;

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < BECH32_GENERATOR.length; i += 1) {
      if ((top >> i) & 1) chk ^= BECH32_GENERATOR[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const out: number[] = [];
  for (let p = 0; p < 6; p += 1) out.push((mod >> (5 * (5 - p))) & 31);
  return out;
}

function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod([...hrpExpand(hrp), ...data]) === 1;
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  const out: number[] = [];
  for (const value of data) {
    if (value < 0 || value >> fromBits) return null;
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    return null;
  }
  return out;
}

export function lud16ToLnurlPayEndpoint(lud16: string): string | null {
  const [name, domain, ...extra] = lud16.trim().split('@');
  if (!name || !domain || extra.length) return null;
  return `https://${domain.toLowerCase()}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

export function encodeLnurl(url: string): string {
  const bytes = [...new TextEncoder().encode(url)];
  const data = convertBits(bytes, 8, 5, true);
  if (!data) throw new Error('Could not encode LNURL.');
  return `lnurl1${[...data, ...createChecksum('lnurl', data)].map((value) => BECH32_CHARSET[value]).join('')}`;
}

export function decodeLnurl(lnurl: string): string | null {
  const value = lnurl.trim();
  if (!value || value.length > MAX_LNURL_LENGTH) return null;
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return null;
  const lower = value.toLowerCase();
  const separator = lower.lastIndexOf('1');
  if (separator <= 0 || separator + 7 > lower.length) return null;
  const hrp = lower.slice(0, separator);
  if (hrp !== 'lnurl') return null;
  const data = [...lower.slice(separator + 1)].map((char) => BECH32_CHARSET.indexOf(char));
  if (data.some((item) => item < 0) || !verifyChecksum(hrp, data)) return null;
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  if (!bytes) return null;
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
