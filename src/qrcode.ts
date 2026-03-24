// Minimal QR Code generator (Mode: Byte, ECC: L, Version 2-4 auto)
// Generates SVG string from a URL

// Galois field tables for QR error correction
const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 128 ? 0x11d : 0);
  }
  EXP[255] = EXP[0];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255];
}

function polyMul(a: number[], b: number[]): number[] {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      r[i + j] ^= gfMul(a[i], b[j]);
  return r;
}

function ecBytes(data: number[], ecLen: number): number[] {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) gen = polyMul(gen, [1, EXP[i]]);
  const msg = [...data, ...new Array(ecLen).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
  }
  return msg.slice(data.length);
}

// QR version parameters (ECC level L)
const VERSIONS: { ver: number; size: number; totalCodewords: number; ecPerBlock: number; blocks: number; dataCw: number; cap: number }[] = [
  { ver: 2, size: 25, totalCodewords: 44, ecPerBlock: 10, blocks: 1, dataCw: 34, cap: 32 },
  { ver: 3, size: 29, totalCodewords: 70, ecPerBlock: 15, blocks: 1, dataCw: 55, cap: 53 },
  { ver: 4, size: 33, totalCodewords: 100, ecPerBlock: 20, blocks: 1, dataCw: 80, cap: 78 },
  { ver: 5, size: 37, totalCodewords: 134, ecPerBlock: 26, blocks: 1, dataCw: 108, cap: 106 },
  { ver: 6, size: 41, totalCodewords: 172, ecPerBlock: 18, blocks: 2, dataCw: 136, cap: 134 },
];

// Alignment pattern centers
const ALIGN: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

// Format info for ECC level L (mask 0-7)
const FORMAT_BITS: number[] = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

function getBit(val: number, bit: number): boolean {
  return ((val >> bit) & 1) === 1;
}

export function generateQRSvg(text: string, moduleSize = 4, margin = 2): string {
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;

  // Pick smallest version
  const vInfo = VERSIONS.find(v => v.cap >= len);
  if (!vInfo) throw new Error("Text too long for QR");

  const { ver, size, ecPerBlock, blocks, dataCw } = vInfo;

  // Build data codewords: mode(0100) + length(8bit) + data + terminator + padding
  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(len, ver >= 10 ? 16 : 8);
  for (const b of bytes) pushBits(b, 8);
  pushBits(0, Math.min(4, dataCw * 8 - bits.length)); // Terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((a, b, j) => a | (b << (7 - j)), 0));

  // Pad to dataCw
  let padToggle = false;
  while (data.length < dataCw) {
    data.push(padToggle ? 17 : 236);
    padToggle = !padToggle;
  }

  // Error correction
  const cwPerBlock = Math.floor(dataCw / blocks);
  const allData: number[] = [];
  const allEc: number[] = [];
  for (let b = 0; b < blocks; b++) {
    const blockData = data.slice(b * cwPerBlock, (b + 1) * cwPerBlock);
    allData.push(...blockData);
    allEc.push(...ecBytes(blockData, ecPerBlock));
  }

  // Interleave (single block = no interleave needed for our versions)
  const finalData = [...allData, ...allEc];

  // Build matrix
  const grid: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

  // Place finder patterns
  const placeFinder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++)
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        if (dr === -1 || dr === 7 || dc === -1 || dc === 7) {
          grid[rr][cc] = false; // separator
        } else if ((dr === 0 || dr === 6) || (dc === 0 || dc === 6) || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)) {
          grid[rr][cc] = true;
        } else {
          grid[rr][cc] = false;
        }
      }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (grid[6][i] === null) grid[6][i] = i % 2 === 0;
    if (grid[i][6] === null) grid[i][6] = i % 2 === 0;
  }

  // Alignment patterns
  const centers = ALIGN[ver];
  if (centers) {
    for (const r of centers)
      for (const c of centers) {
        if (grid[r][c] !== null) continue; // skip if overlaps finder
        for (let dr = -2; dr <= 2; dr++)
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
            grid[r + dr][c + dc] = dark;
          }
      }
  }

  // Dark module
  grid[size - 8][8] = true;

  // Reserve format info areas
  const reserveFormat = () => {
    for (let i = 0; i < 15; i++) {
      // Around top-left finder
      if (i < 6) { if (grid[8][i] === null) grid[8][i] = false; }
      else if (i === 6) { if (grid[8][7] === null) grid[8][7] = false; }
      else if (i === 7) { if (grid[8][8] === null) grid[8][8] = false; }
      else { if (grid[8][14 - i] === null) grid[8][14 - i] = false; }

      if (i < 6) { if (grid[i][8] === null) grid[i][8] = false; }
      else if (i === 6) { if (grid[7][8] === null) grid[7][8] = false; }
      else if (i === 7) { if (grid[8][8] === null) grid[8][8] = false; }
      else { if (grid[14 - i][8] === null) grid[14 - i][8] = false; }

      // Other copies
      if (i < 8) {
        if (grid[size - 1 - i][8] === null) grid[size - 1 - i][8] = false;
      } else {
        if (grid[8][size - 15 + i] === null) grid[8][size - 15 + i] = false;
      }
    }
  };
  reserveFormat();

  // Place data bits
  const dataBits: number[] = [];
  for (const b of finalData)
    for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);

  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5; // Skip timing column
    const rows = upward ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
    for (const row of rows) {
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (c < 0 || c >= size) continue;
        if (grid[row][c] !== null) continue;
        grid[row][c] = bitIdx < dataBits.length ? dataBits[bitIdx++] === 1 : false;
      }
    }
    upward = !upward;
  }

  // Apply mask (mask 0: (row + col) % 2 === 0) and find best
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestGrid: boolean[][] = [];

  for (let mask = 0; mask < 8; mask++) {
    const masked = grid.map(row => row.map(cell => cell ?? false));

    // Apply mask to data area only
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        // Check if it's a data module (not function pattern)
        // Simple check: see if original grid had null before data placement
        // We'll use a simpler approach - just mask everything that's not in function patterns
        let isFunction = false;
        // Finder + separator
        if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) isFunction = true;
        // Timing
        if (r === 6 || c === 6) isFunction = true;
        // Alignment
        if (centers) {
          for (const ar of centers)
            for (const ac of centers) {
              if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2 && !(r < 9 && c < 9)) isFunction = true;
            }
        }
        // Dark module
        if (r === size - 8 && c === 8) isFunction = true;

        if (isFunction) continue;

        let flip = false;
        switch (mask) {
          case 0: flip = (r + c) % 2 === 0; break;
          case 1: flip = r % 2 === 0; break;
          case 2: flip = c % 3 === 0; break;
          case 3: flip = (r + c) % 3 === 0; break;
          case 4: flip = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
          case 5: flip = (r * c) % 2 + (r * c) % 3 === 0; break;
          case 6: flip = ((r * c) % 2 + (r * c) % 3) % 2 === 0; break;
          case 7: flip = ((r + c) % 2 + (r * c) % 3) % 2 === 0; break;
        }
        if (flip) masked[r][c] = !masked[r][c];
      }

    // Write format info
    const fmtBits = FORMAT_BITS[mask];
    for (let i = 0; i < 15; i++) {
      const bit = getBit(fmtBits, 14 - i);
      // Around top-left
      if (i < 6) masked[8][i] = bit;
      else if (i === 6) masked[8][7] = bit;
      else if (i === 7) masked[8][8] = bit;
      else masked[8][14 - i] = bit;

      if (i < 6) masked[i][8] = bit;
      else if (i === 6) masked[7][8] = bit;
      else if (i === 7) masked[8][8] = bit;
      else masked[14 - i][8] = bit;

      // Other copies
      if (i < 8) masked[size - 1 - i][8] = bit;
      else masked[8][size - 15 + i] = bit;
    }

    // Simple penalty: count consecutive same-color runs
    let penalty = 0;
    for (let r = 0; r < size; r++) {
      let count = 1;
      for (let c = 1; c < size; c++) {
        if (masked[r][c] === masked[r][c - 1]) count++;
        else { if (count >= 5) penalty += count - 2; count = 1; }
      }
      if (count >= 5) penalty += count - 2;
    }

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestGrid = masked;
    }
  }

  // Generate SVG
  const totalSize = (size + margin * 2) * moduleSize;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">`;
  svg += `<rect width="${totalSize}" height="${totalSize}" fill="#fff"/>`;

  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (bestGrid[r][c])
        svg += `<rect x="${(c + margin) * moduleSize}" y="${(r + margin) * moduleSize}" width="${moduleSize}" height="${moduleSize}" fill="#000"/>`;

  svg += "</svg>";
  return svg;
}
