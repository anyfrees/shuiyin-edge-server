// @ts-nocheck -- generated from shared provenance-core
// packages/provenance-core/src/verification-status.js
var VERIFICATION_STATUS = Object.freeze({
  EXACT_FILE: "EXACT_FILE",
  SOURCE_VERIFIED: "SOURCE_VERIFIED",
  SOURCE_VERIFIED_REENCODED: "SOURCE_VERIFIED_REENCODED",
  ALBUM_WATERMARKED: "ALBUM_WATERMARKED",
  CONTENT_CHANGED: "CONTENT_CHANGED",
  WATERMARK_CHANGED: "WATERMARK_CHANGED",
  SOFT_MATCH_AMBIGUOUS: "SOFT_MATCH_AMBIGUOUS",
  BLIND_MARKER_MISMATCH: "BLIND_MARKER_MISMATCH",
  UNREGISTERED: "UNREGISTERED",
  PENDING_REGISTRATION: "PENDING_REGISTRATION",
  EXPIRED: "EXPIRED",
  INCONCLUSIVE: "INCONCLUSIVE"
});
var VERIFICATION_STATUSES = Object.freeze(Object.values(VERIFICATION_STATUS));
var ALGORITHM_ID = Object.freeze({
  SHA256: "sha256-v1",
  DHASH256: "dhash256-v2",
  PHASH256: "phash256-v1",
  INTEGRITY_4X4: "grid4x4-dhash256-v2",
  WATERMARK_INTEGRITY_4X3: "grid4x3-dhash256-v2",
  BLIND: "jilu-blind-v2",
  REGIONAL_INTEGRITY_V2: "regional-integrity-v2",
  REGIONAL_INTEGRITY_V3: "regional-integrity-v3",
  WATERMARK_INTEGRITY_V2: "watermark-integrity-v2"
});
var KEY_PURPOSE = Object.freeze({
  CAPTURE_TICKET: "capture-ticket-signing",
  PROVENANCE_RECEIPT: "provenance-receipt-signing"
});
var REGIONAL_CHANGE_ATTRIBUTION = Object.freeze({
  WATERMARK_REGION_ONLY: "WATERMARK_REGION_ONLY",
  OUTSIDE_WATERMARK_REGION: "OUTSIDE_WATERMARK_REGION",
  MIXED: "MIXED",
  UNKNOWN: "UNKNOWN",
  NOT_APPLICABLE: "NOT_APPLICABLE"
});
var evaluateVerificationStatus = (evidence) => {
  if (evidence.pending) return VERIFICATION_STATUS.PENDING_REGISTRATION;
  if (evidence.expired) return VERIFICATION_STATUS.EXPIRED;
  if (evidence.markerMismatch) return VERIFICATION_STATUS.BLIND_MARKER_MISMATCH;
  if (evidence.ambiguous) return VERIFICATION_STATUS.SOFT_MATCH_AMBIGUOUS;
  if (evidence.exactFile) return VERIFICATION_STATUS.EXACT_FILE;
  if (!evidence.registered) return VERIFICATION_STATUS.UNREGISTERED;
  if (evidence.contentChanged && evidence.watermarkChanged && evidence.regionalChangeAttribution === REGIONAL_CHANGE_ATTRIBUTION.WATERMARK_REGION_ONLY) return VERIFICATION_STATUS.WATERMARK_CHANGED;
  if (evidence.contentChanged) return VERIFICATION_STATUS.CONTENT_CHANGED;
  if (evidence.watermarkChanged) return VERIFICATION_STATUS.WATERMARK_CHANGED;
  if (evidence.sourceType === "album-watermarked") return VERIFICATION_STATUS.ALBUM_WATERMARKED;
  if (evidence.sourceLinked && evidence.reencoded) return VERIFICATION_STATUS.SOURCE_VERIFIED_REENCODED;
  if (evidence.sourceLinked) return VERIFICATION_STATUS.SOURCE_VERIFIED;
  return VERIFICATION_STATUS.INCONCLUSIVE;
};

// packages/runtime-compat/src/utf8.js
var utf8Encode = (value) => {
  const text = String(value);
  const bytes = [];
  for (let index = 0; index < text.length; index++) {
    let codePoint = text.charCodeAt(index);
    if (codePoint >= 55296 && codePoint <= 56319) {
      const low = text.charCodeAt(index + 1);
      if (low >= 56320 && low <= 57343) {
        codePoint = 65536 + (codePoint - 55296 << 10) + (low - 56320);
        index++;
      } else codePoint = 65533;
    } else if (codePoint >= 56320 && codePoint <= 57343) codePoint = 65533;
    if (codePoint <= 127) bytes.push(codePoint);
    else if (codePoint <= 2047) bytes.push(192 | codePoint >>> 6, 128 | codePoint & 63);
    else if (codePoint <= 65535) bytes.push(224 | codePoint >>> 12, 128 | codePoint >>> 6 & 63, 128 | codePoint & 63);
    else bytes.push(240 | codePoint >>> 18, 128 | codePoint >>> 12 & 63, 128 | codePoint >>> 6 & 63, 128 | codePoint & 63);
  }
  return Uint8Array.from(bytes);
};

// packages/provenance-core/src/canonical-json.js
var canonicalValue = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("CANONICAL_JSON_NON_FINITE_NUMBER");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => {
    if (item === void 0 || typeof item === "function" || typeof item === "symbol") throw new TypeError("CANONICAL_JSON_UNSUPPORTED_ARRAY_VALUE");
    return canonicalValue(item);
  }).join(",")}]`;
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("CANONICAL_JSON_NON_PLAIN_OBJECT");
    const entries = Object.keys(value).sort().map((key) => {
      const item = value[key];
      if (item === void 0 || typeof item === "function" || typeof item === "symbol") throw new TypeError("CANONICAL_JSON_UNSUPPORTED_OBJECT_VALUE");
      return `${JSON.stringify(key)}:${canonicalValue(item)}`;
    });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError("CANONICAL_JSON_UNSUPPORTED_VALUE");
};
var canonicalJson = (value) => canonicalValue(value);
var utf8Bytes = utf8Encode;
var canonicalUtf8 = (value) => utf8Bytes(canonicalValue(value));

// packages/provenance-core/src/hash-utils.js
var bytesToHex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
var hexToBytes = (hex) => {
  if (!/^(?:[a-f0-9]{2})+$/i.test(String(hex || ""))) throw new TypeError("INVALID_HEX");
  return Uint8Array.from(String(hex).match(/.{2}/g), (value) => parseInt(value, 16));
};
var bitsToHex = (bits) => {
  if (bits.length % 4) throw new TypeError("BIT_LENGTH_NOT_NIBBLE_ALIGNED");
  let output = "";
  for (let index = 0; index < bits.length; index += 4) output += parseInt(bits.slice(index, index + 4).join(""), 2).toString(16);
  return output;
};
var hammingDistance256 = (left, right) => {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return Infinity;
  let distance = 0;
  for (let index = 0; index < 64; index += 1) {
    let value = parseInt(left[index], 16) ^ parseInt(right[index], 16);
    while (value) {
      distance += value & 1;
      value >>>= 1;
    }
  }
  return distance;
};
var rgbaToLuma = (rgba, width, height) => {
  if (!rgba || rgba.length !== width * height * 4) throw new TypeError("INVALID_RGBA");
  const output = new Float64Array(width * height);
  for (let index = 0; index < output.length; index += 1) {
    const offset = index * 4;
    output[index] = rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114;
  }
  return output;
};
var resampleLuma = (source, width, height, targetWidth, targetHeight) => {
  if (!source || source.length !== width * height || width < 1 || height < 1) throw new TypeError("INVALID_LUMA");
  const output = new Float64Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < targetWidth; x += 1) {
    const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / targetWidth));
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / targetHeight));
    output[y * targetWidth + x] = source[sourceY * width + sourceX];
  }
  return output;
};

// packages/provenance-core/src/crypto.js
var subtleCrypto = (injected) => injected || globalThis.crypto && globalThis.crypto.subtle;
var sha256Portable = (bytes) => {
  const k = Uint32Array.from([1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]), bitLength = bytes.length * 8, total = Math.ceil((bytes.length + 9) / 64) * 64, padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(total - 8, Math.floor(bitLength / 4294967296), false);
  view.setUint32(total - 4, bitLength >>> 0, false);
  const h = Uint32Array.from([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]), w = new Uint32Array(64), rotr = (x, n) => x >>> n | x << 32 - n;
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3, s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, q] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = e & f ^ ~e & g, t1 = q + s1 + ch + k[i] + w[i] >>> 0, s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = a & b ^ a & c ^ b & c, t2 = s0 + maj >>> 0;
      q = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + q >>> 0;
  }
  const out = new Uint8Array(32), outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
  return out;
};
var sha256Bytes = async (bytes, subtle) => {
  const provider = subtleCrypto(subtle);
  return bytesToHex(provider ? new Uint8Array(await provider.digest("SHA-256", bytes)) : sha256Portable(bytes));
};
var digestCanonicalJson = (value, subtle) => sha256Bytes(canonicalUtf8(value), subtle);
var secureRandomBytes = (length, provider = globalThis.crypto) => {
  if (!Number.isInteger(length) || length < 1 || length > 65536) throw new TypeError("RANDOM_LENGTH_INVALID");
  if (!provider || typeof provider.getRandomValues !== "function") throw new Error("SECURE_RANDOM_REQUIRED");
  return provider.getRandomValues(new Uint8Array(length));
};
var base64UrlBytes = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(padded, "base64"));
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
var base64UrlEncode = (bytes) => typeof Buffer !== "undefined" ? Buffer.from(bytes).toString("base64url") : btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
var signEd25519 = async ({ payload, privateKey, subtle }) => {
  const provider = subtleCrypto(subtle);
  if (!provider) throw new Error("SUBTLE_CRYPTO_REQUIRED");
  const key = await provider.importKey("pkcs8", base64UrlBytes(privateKey), { name: "Ed25519" }, false, ["sign"]);
  return base64UrlEncode(new Uint8Array(await provider.sign("Ed25519", key, payload)));
};
var verifyEd25519 = async ({ payload, signature, publicKey, subtle }) => {
  const provider = subtleCrypto(subtle);
  if (!provider) throw new Error("SUBTLE_CRYPTO_REQUIRED");
  const key = await provider.importKey("raw", base64UrlBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
  return provider.verify("Ed25519", key, base64UrlBytes(signature), payload);
};
var bytesFromHex = hexToBytes;

// packages/provenance-core/src/dhash-v2.js
var dhash256FromLuma = (luma2, width, height) => {
  const sample2 = resampleLuma(luma2, width, height, 17, 16);
  const bits = [];
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) bits.push(sample2[y * 17 + x] > sample2[y * 17 + x + 1] ? 1 : 0);
  return bitsToHex(bits);
};
var dhash256FromRgba = (rgba, width, height) => dhash256FromLuma(rgbaToLuma(rgba, width, height), width, height);

// packages/provenance-core/src/phash-v1.js
var median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
var phash256FromLuma = (luma2, width, height) => {
  const sample2 = resampleLuma(luma2, width, height, 32, 32);
  const coefficients = [];
  for (let v = 0; v < 16; v += 1) for (let u = 0; u < 16; u += 1) {
    let sum = 0;
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      sum += sample2[y * 32 + x] * Math.cos(Math.PI * (2 * x + 1) * u / 64) * Math.cos(Math.PI * (2 * y + 1) * v / 64);
    }
    coefficients.push(sum);
  }
  const threshold = median(coefficients.slice(1));
  return bitsToHex(coefficients.map((value, index) => index === 0 ? 0 : value > threshold ? 1 : 0));
};
var phash256FromRgba = (rgba, width, height) => phash256FromLuma(rgbaToLuma(rgba, width, height), width, height);

// packages/provenance-core/src/integrity-v2.js
var gridRegions = (columns, rows, region = { x: 0, y: 0, width: 1, height: 1 }) => Array.from({ length: columns * rows }, (_, index) => ({
  x: region.x + index % columns * region.width / columns,
  y: region.y + Math.floor(index / columns) * region.height / rows,
  width: region.width / columns,
  height: region.height / rows
}));
var cropRgba = (rgba, width, height, region) => {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(region.x * width)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(region.y * height)));
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil((region.x + region.width) * width)));
  const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil((region.y + region.height) * height)));
  const output = new Uint8ClampedArray((x1 - x0) * (y1 - y0) * 4);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const source = (y * width + x) * 4, target = ((y - y0) * (x1 - x0) + x - x0) * 4;
    output.set(rgba.subarray(source, source + 4), target);
  }
  return { rgba: output, width: x1 - x0, height: y1 - y0 };
};
var regionalDhash256 = (rgba, width, height, columns, rows, region) => gridRegions(columns, rows, region).map((box) => {
  const crop = cropRgba(rgba, width, height, box);
  return dhash256FromRgba(crop.rgba, crop.width, crop.height);
});
var integrity4x4 = (rgba, width, height) => regionalDhash256(rgba, width, height, 4, 4);
var watermarkIntegrity4x3 = (rgba, width, height, region) => regionalDhash256(rgba, width, height, 4, 3, region);

// packages/provenance-core/src/integrity-descriptor-v2.js
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
var encode = (values) => {
  const bytes = Uint8Array.from(values, (x) => x + 256 & 255);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] || 0) << 8 | (bytes[i + 2] || 0);
    out += B64[n >>> 18 & 63] + B64[n >>> 12 & 63] + (i + 1 < bytes.length ? B64[n >>> 6 & 63] : "") + (i + 2 < bytes.length ? B64[n & 63] : "");
  }
  return out;
};
var decode = (text) => {
  let bits = 0, value = 0, out = [];
  for (const ch of text) {
    const n = B64.indexOf(ch);
    if (n < 0) throw new TypeError("DESCRIPTOR_ENCODING_INVALID");
    value = value << 6 | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push(value >>> bits & 255);
    }
  }
  return out.map((x) => x > 127 ? x - 256 : x);
};
var luma = (rgba, index) => 77 * rgba[index] + 150 * rgba[index + 1] + 29 * rgba[index + 2] + 128 >> 8;
var sample = (rgba, width, height, box) => {
  const values = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const sx = Math.max(0, Math.min(width - 1, Math.floor((box.x + (x + 0.5) * box.width / 8) * width))), sy = Math.max(0, Math.min(height - 1, Math.floor((box.y + (y + 0.5) * box.height / 8) * height)));
    values.push(luma(rgba, (sy * width + sx) * 4));
  }
  const mean = Math.round(values.reduce((a, b) => a + b, 0) / 64), mad = Math.max(8, Math.round(values.reduce((a, b) => a + Math.abs(b - mean), 0) / 64));
  return values.map((v) => Math.max(-127, Math.min(127, Math.round((v - mean) * 32 / mad))));
};
var pooledResidual = (rgba, width, height, box) => {
  const values = [];
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    const x0 = Math.floor((box.x + cx * box.width / 4) * width), x1 = Math.max(x0 + 1, Math.floor((box.x + (cx + 1) * box.width / 4) * width)), y0 = Math.floor((box.y + cy * box.height / 4) * height), y1 = Math.max(y0 + 1, Math.floor((box.y + (cy + 1) * box.height / 4) * height));
    let sum = 0, count = 0;
    for (let y = y0; y < Math.min(height, y1); y++) for (let x = x0; x < Math.min(width, x1); x++) {
      sum += luma(rgba, (y * width + x) * 4);
      count++;
    }
    values.push(sum / count);
  }
  const mean = values.reduce((a, b) => a + b, 0) / 16, mad = Math.max(4, values.reduce((a, b) => a + Math.abs(b - mean), 0) / 16);
  return values.map((v) => Math.max(-127, Math.min(127, Math.round((v - mean) * 16 / mad))));
};
var boxes = (columns, rows, region) => Array.from({ length: columns * rows }, (_, i) => ({ x: region.x + i % columns * region.width / columns, y: region.y + Math.floor(i / columns) * region.height / rows, width: region.width / columns, height: region.height / rows }));
var compute = (rgba, width, height, columns, rows, region, algorithm) => ({ algorithm, grid: { columns, rows }, descriptorFormat: "int8-normalized-patch-8x8-base64url", blocks: boxes(columns, rows, region).map((box, index) => ({ index, descriptor: encode(sample(rgba, width, height, box)) })) });
var INTEGRITY_V2_PROFILE = Object.freeze({ id: "integrity-comparison-v2-profile-v1", regional: { unchangedMax: 4, changedMin: 15 }, watermark: { unchangedMax: 7, changedMin: 30 } });
var computeRegionalIntegrityV2 = (rgba, width, height) => compute(rgba, width, height, 4, 4, { x: 0, y: 0, width: 1, height: 1 }, "regional-integrity-v2");
var INTEGRITY_V3_PROFILE = Object.freeze({ id: "integrity-comparison-v3-profile-v1", regional: { patchUnchangedMax: 4, patchChangedMin: 15, residualUnchangedMax: 2, residualChangedMin: 4 } });
var computeRegionalIntegrityV3 = (rgba, width, height) => ({ algorithm: "regional-integrity-v3", grid: { columns: 4, rows: 4 }, descriptorFormat: "hybrid-normalized-patch-8x8-residual4x4-v1-base64url", blocks: boxes(4, 4, { x: 0, y: 0, width: 1, height: 1 }).map((box, index) => ({ index, descriptor: encode([...sample(rgba, width, height, box), ...pooledResidual(rgba, width, height, box)]) })) });
var computeWatermarkIntegrityV2 = (rgba, width, height, region) => compute(rgba, width, height, 4, 3, region, "watermark-integrity-v2");
var compare = (left, right, policy) => {
  if (left?.algorithm !== right?.algorithm || left?.descriptorFormat !== "int8-normalized-patch-8x8-base64url" || right?.descriptorFormat !== left.descriptorFormat || left.blocks?.length !== right.blocks?.length) throw new TypeError("INTEGRITY_DESCRIPTOR_INCOMPATIBLE");
  const distances = left.blocks.map((block, i) => {
    const a = decode(block.descriptor), b = decode(right.blocks[i].descriptor);
    if (a.length !== 64 || b.length !== 64) throw new TypeError("INTEGRITY_DESCRIPTOR_LENGTH_INVALID");
    return Math.round(a.reduce((n, v, j) => n + Math.abs(v - b[j]), 0) / 64);
  }), maxDistance = Math.max(...distances), classification = maxDistance <= policy.unchangedMax ? "UNCHANGED" : maxDistance >= policy.changedMin ? "CHANGED" : "UNCERTAIN";
  return { classification, distances, maxDistance, meanDistance: Number((distances.reduce((a, b) => a + b, 0) / distances.length).toFixed(2)), changedIndices: distances.map((x, i) => x >= policy.changedMin ? i : -1).filter((x) => x >= 0), profile: INTEGRITY_V2_PROFILE.id };
};
var compareRegionalIntegrityV2 = (left, right, profile = INTEGRITY_V2_PROFILE) => compare(left, right, profile.regional);
var compareWatermarkIntegrityV2 = (left, right, profile = INTEGRITY_V2_PROFILE) => compare(left, right, profile.watermark);
var compareRegionalIntegrityV3 = (left, right, profile = INTEGRITY_V3_PROFILE) => {
  if (left?.algorithm !== "regional-integrity-v3" || right?.algorithm !== left.algorithm || left?.descriptorFormat !== "hybrid-normalized-patch-8x8-residual4x4-v1-base64url" || right?.descriptorFormat !== left.descriptorFormat || left.blocks?.length !== 16 || right.blocks?.length !== 16) throw new TypeError("INTEGRITY_DESCRIPTOR_INCOMPATIBLE");
  const blockMetrics = left.blocks.map((block, i) => {
    const a = decode(block.descriptor), b = decode(right.blocks[i].descriptor);
    if (a.length !== 80 || b.length !== 80) throw new TypeError("INTEGRITY_DESCRIPTOR_LENGTH_INVALID");
    const patch = Math.round(a.slice(0, 64).reduce((n, v, j) => n + Math.abs(v - b[j]), 0) / 64), residual = Math.max(...a.slice(64).map((v, j) => Math.abs(v - b[j + 64])));
    return { index: i, patchDistance: patch, residualPeak: residual };
  }), patchMax = Math.max(...blockMetrics.map((x) => x.patchDistance)), residualMax = Math.max(...blockMetrics.map((x) => x.residualPeak)), changed = patchMax >= profile.regional.patchChangedMin || residualMax >= profile.regional.residualChangedMin, unchanged = patchMax <= profile.regional.patchUnchangedMax && residualMax <= profile.regional.residualUnchangedMax, classification = changed ? "CHANGED" : unchanged ? "UNCHANGED" : "UNCERTAIN";
  return { classification, distances: blockMetrics.map((x) => x.patchDistance), maxDistance: patchMax, residualMax, blockMetrics, changedIndices: blockMetrics.filter((x) => x.patchDistance >= profile.regional.patchChangedMin || x.residualPeak >= profile.regional.residualChangedMin).map((x) => x.index), profile: profile.id };
};

// packages/provenance-core/src/blind-v2.js
var BLIND_V2_MAGIC = Object.freeze([74, 76]);
var BLIND_V2_VERSION = 2;
var BLIND_V2_PAYLOAD_BYTES = 35;
var BLIND_FLAG = Object.freeze({ TRUSTED_TICKET: 1 });
var BLIND_ALLOWED_FLAGS = BLIND_FLAG.TRUSTED_TICKET;
var crc16 = (bytes) => {
  let crc = 65535;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 32768 ? (crc << 1 ^ 4129) & 65535 : crc << 1 & 65535;
  }
  return crc;
};
var secureMarkerId = (randomBytes) => {
  if (typeof randomBytes !== "function") throw new TypeError("CRYPTO_RANDOM_REQUIRED");
  const bytes = randomBytes(16);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw new TypeError("CRYPTO_RANDOM_INVALID");
  return bytesToHex(bytes);
};
var encodeBlindPayloadV2 = ({ markerId, ticketDigest: ticketDigest2, captureSequence, flags = 0 }) => {
  const marker2 = hexToBytes(markerId), digest = hexToBytes(ticketDigest2);
  if (marker2.length !== 16 || digest.length !== 8) throw new TypeError("BLIND_V2_BINDING_INVALID");
  if (!Number.isSafeInteger(captureSequence) || captureSequence < 0 || captureSequence > 4294967295) throw new TypeError("CAPTURE_SEQUENCE_INVALID");
  if (!Number.isInteger(flags) || flags < 0 || flags > 65535 || (flags & ~BLIND_ALLOWED_FLAGS) !== 0) throw new TypeError("BLIND_FLAGS_INVALID");
  const bytes = new Uint8Array(BLIND_V2_PAYLOAD_BYTES);
  bytes.set(BLIND_V2_MAGIC, 0);
  bytes[2] = BLIND_V2_VERSION;
  bytes.set(marker2, 3);
  bytes.set(digest, 19);
  const view = new DataView(bytes.buffer);
  view.setUint32(27, captureSequence, false);
  view.setUint16(31, flags, false);
  view.setUint16(33, crc16(bytes.slice(0, 33)), false);
  return bytes;
};
var decodeBlindPayloadV2 = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length !== BLIND_V2_PAYLOAD_BYTES) return null;
  if (bytes[0] !== BLIND_V2_MAGIC[0] || bytes[1] !== BLIND_V2_MAGIC[1] || bytes[2] !== BLIND_V2_VERSION) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(33, false) !== crc16(bytes.slice(0, 33))) return null;
  if ((view.getUint16(31, false) & ~BLIND_ALLOWED_FLAGS) !== 0) return null;
  return {
    magic: "JL",
    protocolVersion: 2,
    markerId: bytesToHex(bytes.slice(3, 19)),
    ticketDigest: bytesToHex(bytes.slice(19, 27)),
    captureSequence: view.getUint32(27, false),
    flags: view.getUint16(31, false)
  };
};
var blindEmbedResult = (success, details = {}) => Object.freeze({
  success: success === true,
  algorithm: "jilu-blind-v2",
  version: 2,
  markerId: success === true ? details.markerId || null : null,
  embeddedBlocks: success === true && Number.isInteger(details.embeddedBlocks) ? details.embeddedBlocks : 0
});
var buildBlindMarkerEvidence = (embedResult) => ({
  embedded: embedResult?.success === true,
  algorithm: "jilu-blind-v2",
  markerId: embedResult?.success === true ? embedResult.markerId : null,
  embeddedBlocks: embedResult?.success === true ? embedResult.embeddedBlocks : 0
});
var extractBlindMarkerV2 = (bytes, metrics = {}) => {
  const payload = decodeBlindPayloadV2(bytes);
  const attemptedBlocks = Number.isInteger(metrics.attemptedBlocks) && metrics.attemptedBlocks > 0 ? metrics.attemptedBlocks : 1;
  const recoveredBlocks = payload ? Math.max(0, Math.min(attemptedBlocks, Number.isInteger(metrics.recoveredBlocks) ? metrics.recoveredBlocks : 1)) : 0;
  return {
    success: !!payload,
    algorithm: "jilu-blind-v2",
    version: 2,
    payload,
    markerId: payload?.markerId || null,
    ticketDigest: payload?.ticketDigest || null,
    flags: payload?.flags ?? null,
    confidence: recoveredBlocks / attemptedBlocks,
    detection: payload ? "crc-valid" : "invalid-or-not-found",
    recoveredBlocks,
    attemptedBlocks
  };
};

// packages/provenance-core/src/lsh-v2.js
var lshBands256 = (hash2) => {
  if (!/^[a-f0-9]{64}$/i.test(String(hash2 || ""))) throw new TypeError("INVALID_HASH256");
  const normalized = String(hash2).toLowerCase();
  return Array.from({ length: 8 }, (_, bandIndex) => ({ bandIndex, bandValue: normalized.slice(bandIndex * 8, bandIndex * 8 + 8) }));
};
var uniqueness = (bestDistance, secondBestDistance) => ({
  bestDistance,
  secondBestDistance: Number.isFinite(secondBestDistance) ? secondBestDistance : null,
  uniquenessGap: Number.isFinite(secondBestDistance) ? Math.max(0, secondBestDistance - bestDistance) : null
});
var rankVisualCandidates = ({ queryHash, candidates, hamming, ambiguityGap = 8 }) => {
  if (typeof hamming !== "function") throw new TypeError("HAMMING_REQUIRED");
  const ranked = [...new Map((candidates || []).map((item) => [item.recordId, item])).values()].map((item) => ({ ...item, distance: hamming(queryHash, item.hash) })).filter((item) => Number.isFinite(item.distance)).sort((a, b) => a.distance - b.distance || a.recordId.localeCompare(b.recordId));
  const best = ranked[0] || null, second = ranked[1] || null;
  const metrics = best ? uniqueness(best.distance, second?.distance ?? Infinity) : uniqueness(Infinity, Infinity);
  return { ranked, best, second, ...metrics, ambiguous: !!best && !!second && metrics.uniquenessGap < ambiguityGap };
};

// packages/provenance-core/src/schema-v2.js
var hash256 = (value) => /^[a-f0-9]{64}$/.test(String(value || ""));
var issue = (path, code) => ({ path, code });
var rejectUnknown = (issues, value, path, allowed) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue(`${path}/${key}`, "UNKNOWN_FIELD"));
};
var validateProvenanceDraftV2 = (draft) => {
  const issues = [];
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return { valid: false, issues: [issue("", "OBJECT_REQUIRED")] };
  if (draft.schema !== "jilu-provenance") issues.push(issue("/schema", "SCHEMA_INVALID"));
  rejectUnknown(issues, draft, "", ["schema", "protocolVersion", "trustPolicyVersion", "source", "time", "location", "templateContext", "binding", "integrity", "watermarkIntegrity", "rendererVersion", "privacyLevel"]);
  if (draft.protocolVersion !== 2) issues.push(issue("/protocolVersion", "PROTOCOL_VERSION_INVALID"));
  if (draft.source?.captureMode === "TRUSTED" && draft.trustPolicyVersion !== "trusted-capture-v2") issues.push(issue("/trustPolicyVersion", "TRUST_POLICY_VERSION_INVALID"));
  if (!["live-camera", "album-watermarked"].includes(draft.source && draft.source.type)) issues.push(issue("/source/type", "SOURCE_TYPE_INVALID"));
  rejectUnknown(issues, draft.source, "/source", ["type", "captureMode", "platform", "appVersion", "wechatVersion", "sdkVersion"]);
  if (!["NORMAL", "TRUSTED"].includes(draft.source && draft.source.captureMode)) issues.push(issue("/source/captureMode", "CAPTURE_MODE_INVALID"));
  if (!["wechat-ios", "wechat-android", "web", "unknown"].includes(draft.source && draft.source.platform)) issues.push(issue("/source/platform", "PLATFORM_INVALID"));
  for (const name of ["appVersion", "wechatVersion", "sdkVersion"]) if (typeof draft.source?.[name] !== "string" || draft.source[name].length > 32) issues.push(issue(`/source/${name}`, "STRING_INVALID"));
  if (draft.source && draft.source.type === "album-watermarked" && draft.source.captureMode === "TRUSTED") issues.push(issue("/source/captureMode", "ALBUM_CANNOT_BE_TRUSTED"));
  const requested = draft.time && draft.time.captureRequestedAt, completed = draft.time && draft.time.captureCompletedAt;
  rejectUnknown(issues, draft.time, "/time", ["captureRequestedAt", "captureCompletedAt"]);
  if (!Number.isSafeInteger(requested) || !Number.isSafeInteger(completed) || completed < requested) issues.push(issue("/time", "CAPTURE_TIME_INVALID"));
  if ("serverReceivedAt" in (draft.time || {})) issues.push(issue("/time/serverReceivedAt", "SERVER_FIELD_FORBIDDEN"));
  const location = draft.location || {};
  rejectUnknown(issues, location, "/location", ["source", "name", "latitude", "longitude", "accuracyMeters", "altitudeMeters"]);
  if (!["device-gps", "map-selection", "manual", "none"].includes(location.source)) issues.push(issue("/location/source", "LOCATION_SOURCE_INVALID"));
  if (typeof location.name !== "string" || location.name.length > 160) issues.push(issue("/location/name", "LOCATION_NAME_INVALID"));
  if (location.source === "none" && [location.latitude, location.longitude, location.accuracyMeters, location.altitudeMeters].some((value) => value != null)) issues.push(issue("/location", "LOCATION_NONE_HAS_COORDINATES"));
  if (location.latitude != null && (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90)) issues.push(issue("/location/latitude", "LATITUDE_INVALID"));
  if (location.longitude != null && (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180)) issues.push(issue("/location/longitude", "LONGITUDE_INVALID"));
  const template = draft.templateContext;
  if (template !== void 0) {
    rejectUnknown(issues, template, "/templateContext", ["origin", "templateId", "templateVersion", "customTemplateId"]);
    if (!["official", "custom", "none"].includes(template?.origin)) issues.push(issue("/templateContext/origin", "TEMPLATE_ORIGIN_INVALID"));
    if (template?.origin === "official" && (!/^tpl_[A-Za-z0-9_-]{3,80}$/.test(String(template.templateId || "")) || !Number.isInteger(template.templateVersion) || template.templateVersion < 1)) issues.push(issue("/templateContext", "OFFICIAL_TEMPLATE_CONTEXT_INVALID"));
    if (template?.origin === "custom" && !/^custom_[A-Za-z0-9_-]{3,80}$/.test(String(template.customTemplateId || ""))) issues.push(issue("/templateContext/customTemplateId", "CUSTOM_TEMPLATE_CONTEXT_INVALID"));
  }
  const binding = draft.binding || {};
  rejectUnknown(issues, binding, "/binding", ["sha256", "dhash256", "phash256", "blindBinding", "blindMarkerId", "blindWatermarkEmbedded", "blindEvidence", "algorithms", "watermarkRegion"]);
  for (const name of ["sha256", "dhash256", "phash256"]) if (!hash256(binding[name])) issues.push(issue(`/binding/${name}`, "HASH_INVALID"));
  if (binding.blindBinding) {
    const blind = binding.blindBinding;
    rejectUnknown(issues, blind, "/binding/blindBinding", ["status", "carrierProfile", "markerId", "ticketDigest", "flags", "confidence"]);
    if (!["NOT_EMBEDDED", "PRESENT", "UNAVAILABLE", "INVALID"].includes(blind.status)) issues.push(issue("/binding/blindBinding/status", "BLIND_STATUS_INVALID"));
    if (blind.status === "PRESENT" && (!/^[a-f0-9]{32}$/.test(String(blind.markerId || "")) || !/^[a-f0-9]{16}$/.test(String(blind.ticketDigest || "")) || !Number.isInteger(blind.flags) || blind.flags < 0 || blind.flags > 65535 || !Number.isFinite(blind.confidence) || blind.confidence < 0 || blind.confidence > 1 || typeof blind.carrierProfile !== "string" || !blind.carrierProfile)) issues.push(issue("/binding/blindBinding", "BLIND_PRESENT_INVALID"));
    if (blind.status !== "PRESENT" && Object.keys(blind).some((key) => key !== "status")) issues.push(issue("/binding/blindBinding", "BLIND_ABSENT_HAS_EVIDENCE"));
  } else {
    if (!/^[a-f0-9]{32}$/.test(String(binding.blindMarkerId || ""))) issues.push(issue("/binding/blindMarkerId", "MARKER_INVALID"));
    if (typeof binding.blindWatermarkEmbedded !== "boolean") issues.push(issue("/binding/blindWatermarkEmbedded", "BOOLEAN_REQUIRED"));
    const blind = binding.blindEvidence || {};
    rejectUnknown(issues, blind, "/binding/blindEvidence", ["extracted", "markerId", "ticketDigest", "flags", "confidence"]);
    if (typeof blind.extracted !== "boolean" || blind.extracted !== binding.blindWatermarkEmbedded) issues.push(issue("/binding/blindEvidence/extracted", "BLIND_EXTRACTED_INVALID"));
    if (blind.markerId !== binding.blindMarkerId) issues.push(issue("/binding/blindEvidence/markerId", "BLIND_MARKER_MISMATCH"));
    if (!/^[a-f0-9]{16}$/.test(String(blind.ticketDigest || ""))) issues.push(issue("/binding/blindEvidence/ticketDigest", "TICKET_DIGEST_INVALID"));
    if (!Number.isInteger(blind.flags) || blind.flags < 0 || blind.flags > 65535) issues.push(issue("/binding/blindEvidence/flags", "BLIND_FLAGS_INVALID"));
    if (!Number.isFinite(blind.confidence) || blind.confidence < 0 || blind.confidence > 1) issues.push(issue("/binding/blindEvidence/confidence", "BLIND_CONFIDENCE_INVALID"));
  }
  const algorithms = binding.algorithms || {};
  rejectUnknown(issues, algorithms, "/binding/algorithms", ["sha256", "dhash256", "phash256", "blindWatermark"]);
  for (const [name, expected] of [["sha256", ALGORITHM_ID.SHA256], ["dhash256", ALGORITHM_ID.DHASH256], ["phash256", ALGORITHM_ID.PHASH256]]) if (algorithms[name] !== expected) issues.push(issue(`/binding/algorithms/${name}`, "ALGORITHM_INVALID"));
  if (!binding.blindBinding && algorithms.blindWatermark !== ALGORITHM_ID.BLIND) issues.push(issue("/binding/algorithms/blindWatermark", "ALGORITHM_INVALID"));
  const bounds2 = binding.watermarkRegion || {};
  rejectUnknown(issues, bounds2, "/binding/watermarkRegion", ["x", "y", "width", "height"]);
  if (![bounds2.x, bounds2.y, bounds2.width, bounds2.height].every(Number.isFinite) || bounds2.x < 0 || bounds2.y < 0 || bounds2.width <= 0 || bounds2.height <= 0 || bounds2.x + bounds2.width > 1 || bounds2.y + bounds2.height > 1) issues.push(issue("/binding/watermarkRegion", "WATERMARK_BOUNDS_INVALID"));
  const descriptor = (value, algorithm, count, path, format = "int8-normalized-patch-8x8-base64url", length = 86) => {
    rejectUnknown(issues, value, path, ["algorithm", "grid", "descriptorFormat", "blocks"]);
    const canonical = (text) => new RegExp(`^[A-Za-z0-9_-]{${length - 1}}[AEIMQUYcgkosw048]$`).test(String(text || ""));
    if (value?.algorithm !== algorithm || value?.descriptorFormat !== format || value?.grid?.columns !== 4 || value?.grid?.rows !== (count === 16 ? 4 : 3) || !Array.isArray(value?.blocks) || value.blocks.length !== count || !value.blocks.every((x, i) => {
      rejectUnknown(issues, x, `${path}/blocks/${i}`, ["index", "descriptor"]);
      return x?.index === i && canonical(x.descriptor);
    })) issues.push(issue(path, "INTEGRITY_DESCRIPTOR_INVALID"));
  };
  if (draft.integrity?.algorithm === ALGORITHM_ID.REGIONAL_INTEGRITY_V3) descriptor(draft.integrity, ALGORITHM_ID.REGIONAL_INTEGRITY_V3, 16, "/integrity", "hybrid-normalized-patch-8x8-residual4x4-v1-base64url", 107);
  else if (draft.integrity?.algorithm === ALGORITHM_ID.REGIONAL_INTEGRITY_V2) descriptor(draft.integrity, ALGORITHM_ID.REGIONAL_INTEGRITY_V2, 16, "/integrity");
  else {
    rejectUnknown(issues, draft.integrity, "/integrity", ["algorithm", "hashes"]);
    if (draft.integrity?.algorithm !== ALGORITHM_ID.INTEGRITY_4X4 || !Array.isArray(draft.integrity?.hashes) || draft.integrity.hashes.length !== 16 || !draft.integrity.hashes.every(hash256)) issues.push(issue("/integrity", "REJECTED_V1_INTEGRITY"));
  }
  if (draft.watermarkIntegrity?.algorithm === ALGORITHM_ID.WATERMARK_INTEGRITY_V2) descriptor(draft.watermarkIntegrity, ALGORITHM_ID.WATERMARK_INTEGRITY_V2, 12, "/watermarkIntegrity");
  else {
    rejectUnknown(issues, draft.watermarkIntegrity, "/watermarkIntegrity", ["algorithm", "hashes"]);
    if (draft.watermarkIntegrity?.algorithm !== ALGORITHM_ID.WATERMARK_INTEGRITY_4X3 || !Array.isArray(draft.watermarkIntegrity?.hashes) || draft.watermarkIntegrity.hashes.length !== 12 || !draft.watermarkIntegrity.hashes.every(hash256)) issues.push(issue("/watermarkIntegrity", "REJECTED_V1_INTEGRITY"));
  }
  if (!Number.isInteger(draft.rendererVersion) || draft.rendererVersion < 2) issues.push(issue("/rendererVersion", "RENDERER_VERSION_INVALID"));
  if (!["private", "coarse", "public"].includes(draft.privacyLevel)) issues.push(issue("/privacyLevel", "PRIVACY_LEVEL_INVALID"));
  for (const forbidden of ["recordId", "recordDigest", "serverReceivedAt", "verificationCode", "subjectId", "assuranceLevel", "verificationCount", "expiresAt", "receipt", "finalTrustMode"]) if (forbidden in draft) issues.push(issue(`/${forbidden}`, "SERVER_FIELD_FORBIDDEN"));
  return { valid: issues.length === 0, issues };
};
var isVerificationStatus = (value) => VERIFICATION_STATUSES.includes(value);

// packages/provenance-core/src/models-v2.js
var TICKET_STATE = Object.freeze({ UNUSED: "unused", CONSUMED: "consumed", EXPIRED: "expired", REVOKED: "revoked" });
var CAPTURE_TICKET_DEFAULT_TTL_MS = 6e4;
var CAPTURE_TICKET_OFFLINE_MAX_TTL_MS = 24 * 60 * 60 * 1e3;
var captureTicketClaims = (ticket) => ({
  schema: ticket.schema,
  version: ticket.version,
  ticketId: ticket.ticketId,
  subjectId: ticket.subjectId,
  nonce: ticket.nonce,
  markerId: ticket.markerId,
  kind: ticket.kind,
  issuedAt: ticket.issuedAt,
  expiresAt: ticket.expiresAt,
  keyId: ticket.keyId,
  purpose: ticket.purpose
});
var receiptClaims = (receipt) => ({
  schema: receipt.schema,
  version: receipt.version,
  recordId: receipt.recordId,
  protocolVersion: receipt.protocolVersion,
  serverReceivedAt: receipt.serverReceivedAt,
  recordDigest: receipt.recordDigest,
  keyId: receipt.keyId,
  purpose: receipt.purpose
});
var validateCaptureTicket = async ({ ticket, subjectId, markerId, now, keys: keys2, subtle, verify = verifyEd25519 }) => {
  if (!ticket || ticket.schema !== "jilu-capture-ticket" || ticket.version !== 1) return { valid: false, reason: "TICKET_SCHEMA_INVALID" };
  if (ticket.purpose !== KEY_PURPOSE.CAPTURE_TICKET) return { valid: false, reason: "KEY_PURPOSE_MISMATCH" };
  if (ticket.subjectId !== subjectId) return { valid: false, reason: "SUBJECT_MISMATCH" };
  if (ticket.markerId !== markerId) return { valid: false, reason: "MARKER_MISMATCH" };
  if (!Number.isSafeInteger(ticket.issuedAt) || !Number.isSafeInteger(ticket.expiresAt) || ticket.expiresAt <= ticket.issuedAt) return { valid: false, reason: "TTL_INVALID" };
  const maxTtl = ticket.kind === "offline" ? CAPTURE_TICKET_OFFLINE_MAX_TTL_MS : CAPTURE_TICKET_DEFAULT_TTL_MS;
  if (ticket.expiresAt - ticket.issuedAt > maxTtl || now >= ticket.expiresAt) return { valid: false, reason: now >= ticket.expiresAt ? "EXPIRED" : "TTL_INVALID" };
  if (!["online", "offline"].includes(ticket.kind) || !/^tkt_[A-Za-z0-9_-]{16,64}$/.test(String(ticket.ticketId || "")) || !/^[A-Za-z0-9_-]{22,128}$/.test(String(ticket.nonce || "")) || !/^[A-Za-z0-9_-]{86}$/.test(String(ticket.signature || ""))) return { valid: false, reason: "TICKET_SHAPE_INVALID" };
  const key = (keys2 || []).find((item) => item.keyId === ticket.keyId && item.purpose === KEY_PURPOSE.CAPTURE_TICKET && ["ACTIVE", "VERIFY_ONLY"].includes(String(item.status).toUpperCase()));
  if (!key) return { valid: false, reason: "KEY_UNKNOWN" };
  const valid = await verify({ payload: canonicalUtf8(captureTicketClaims(ticket)), signature: ticket.signature, publicKey: key.publicKey, subtle });
  return { valid, reason: valid ? "VALID" : "SIGNATURE_INVALID" };
};
var validateReceipt = async ({ receipt, keys: keys2, subtle, verify = verifyEd25519 }) => {
  if (!receipt || receipt.schema !== "jilu-provenance-receipt" || receipt.version !== 1 || receipt.protocolVersion !== 2) return { valid: false, reason: "RECEIPT_SCHEMA_INVALID" };
  if (receipt.purpose !== KEY_PURPOSE.PROVENANCE_RECEIPT) return { valid: false, reason: "KEY_PURPOSE_MISMATCH" };
  const key = (keys2 || []).find((item) => item.keyId === receipt.keyId && item.purpose === KEY_PURPOSE.PROVENANCE_RECEIPT && ["ACTIVE", "VERIFY_ONLY"].includes(String(item.status).toUpperCase()));
  if (!key) return { valid: false, reason: "KEY_UNKNOWN" };
  const valid = await verify({ payload: canonicalUtf8(receiptClaims(receipt)), signature: receipt.signature, publicKey: key.publicKey, subtle });
  return { valid, reason: valid ? "VALID" : "SIGNATURE_INVALID" };
};
var canonicalRecordDigest = (record, subtle) => {
  const { receipt, recordDigest, ...digestible } = record;
  return digestCanonicalJson(digestible, subtle);
};
var validateStoredRecord = async (record, subtle) => Boolean(record && /^[a-f0-9]{64}$/.test(String(record.recordDigest || "")) && await canonicalRecordDigest(record, subtle) === record.recordDigest);
var ticketDigest = async (ticket, subtle) => (await digestCanonicalJson(captureTicketClaims(ticket), subtle)).slice(0, 16);
var publicProvenanceProjection = (record) => ({
  recordId: record.recordId,
  verificationCode: record.verificationCode,
  assuranceLevel: record.assuranceLevel,
  source: { type: record.source.type, captureMode: record.source.captureMode, platform: record.source.platform },
  time: record.time,
  location: { source: record.location.source, name: record.location.name || "", coarse: true },
  algorithms: Object.values(record.binding.algorithms),
  rendererVersion: record.rendererVersion,
  expiresAt: record.expiresAt
});

// packages/provenance-core/src/repository-v2.js
var MemoryProvenanceRepositoryV2 = class {
  constructor() {
    this.records = /* @__PURE__ */ new Map();
    this.file = /* @__PURE__ */ new Map();
    this.marker = /* @__PURE__ */ new Map();
    this.bands = /* @__PURE__ */ new Map();
    this.tickets = /* @__PURE__ */ new Map();
  }
  async createRecord(record) {
    if (this.records.has(record.recordId)) throw new Error("RECORD_EXISTS");
    this.records.set(record.recordId, structuredClone(record));
    return structuredClone(record);
  }
  async getRecordById(recordId) {
    return structuredClone(this.records.get(recordId) || null);
  }
  async getRecordByFileSha256(sha256) {
    const id2 = this.file.get(sha256);
    return id2 ? this.getRecordById(id2) : null;
  }
  async getRecordByMarkerId(markerId) {
    const id2 = this.marker.get(markerId);
    return id2 ? this.getRecordById(id2) : null;
  }
  async putVisualIndex(record) {
    this.file.set(record.binding.sha256, record.recordId);
    this.marker.set(record.binding.blindMarkerId, record.recordId);
    for (const [algorithm, hash2] of [["dhash256", record.binding.dhash256], ["phash256", record.binding.phash256]]) for (const band of lshBands256(hash2)) {
      const key = `${algorithm}:${band.bandIndex}:${band.bandValue}:${record.recordId}`;
      this.bands.set(key, { recordId: record.recordId, algorithmHash: hash2, algorithm, indexVersion: "soft-retrieval-v2" });
    }
  }
  async findVisualCandidates(hash2, { algorithm = "dhash256" } = {}) {
    const prefixes = new Set(lshBands256(hash2).map((band) => `${algorithm}:${band.bandIndex}:${band.bandValue}:`)), ids = /* @__PURE__ */ new Map();
    for (const [key, value] of this.bands) if ([...prefixes].some((prefix) => key.startsWith(prefix))) ids.set(value.recordId, value);
    return [...ids.values()].map((value) => ({ recordId: value.recordId, hash: value.algorithmHash }));
  }
  async consumeCaptureTicket(ticketId, consumedAt) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.state !== "unused") return false;
    this.tickets.set(ticketId, { ...ticket, state: "consumed", consumedAt });
    return true;
  }
};
var PROVENANCE_REPOSITORY_V2_METHODS = Object.freeze(["createRecord", "getRecordById", "getRecordByFileSha256", "getRecordByMarkerId", "putVisualIndex", "findVisualCandidates", "consumeCaptureTicket"]);

// packages/provenance-core/src/ticket-runtime.js
var fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
var b64 = (bytes) => typeof Buffer !== "undefined" ? Buffer.from(bytes).toString("base64url") : btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var unb64 = (value) => {
  const s = String(value).replace(/-/g, "+").replace(/_/g, "/"), p = s + "=".repeat((4 - s.length % 4) % 4);
  return typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(p, "base64")) : Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
var importPrivate = (value, subtle) => subtle.importKey("pkcs8", unb64(value), { name: "Ed25519" }, false, ["sign"]);
var id = (prefix, bytes) => `${prefix}_${b64(bytes)}`;
var CaptureTicketRuntimeService = class {
  constructor({ keys: keys2 = [], now = () => Date.now(), random = (length) => secureRandomBytes(length), subtle = globalThis.crypto?.subtle }) {
    Object.assign(this, { keys: keys2, now, random, subtle });
  }
  activeKey() {
    const key = this.keys.find((x) => x.purpose === KEY_PURPOSE.CAPTURE_TICKET && x.status === "ACTIVE" && x.privateKey);
    if (!key) throw fail("CAPTURE_TICKET_SIGNING_KEY_UNAVAILABLE", 503);
    return key;
  }
  publicKeys() {
    return this.keys.filter((x) => x.purpose === KEY_PURPOSE.CAPTURE_TICKET && ["ACTIVE", "VERIFY_ONLY"].includes(x.status)).map(({ keyId, purpose, algorithm = "Ed25519", status, publicKey }) => ({ keyId, purpose, algorithm, status, publicKey }));
  }
  async issue(subject, { kind = "online", count = 1 } = {}) {
    if (!subject || subject.status !== "active" || !/^sub_[A-Za-z0-9_-]{3,80}$/.test(String(subject.subjectId || ""))) throw fail("UNAUTHENTICATED", 401);
    if (!["online", "offline"].includes(kind)) throw fail("CAPTURE_TICKET_KIND_INVALID");
    if (!Number.isInteger(count) || count < 1 || count > 20 || kind === "online" && count !== 1) throw fail("CAPTURE_TICKET_COUNT_INVALID");
    const key = this.activeKey(), issuedAt = this.now(), ttl = kind === "online" ? CAPTURE_TICKET_DEFAULT_TTL_MS : CAPTURE_TICKET_OFFLINE_MAX_TTL_MS, tickets = [];
    for (let i = 0; i < count; i += 1) {
      const ticket = { schema: "jilu-capture-ticket", version: 1, ticketId: id("tkt", this.random(18)), subjectId: subject.subjectId, nonce: b64(this.random(24)), markerId: Array.from(this.random(16), (x) => x.toString(16).padStart(2, "0")).join(""), kind, issuedAt, expiresAt: issuedAt + ttl, keyId: key.keyId, purpose: KEY_PURPOSE.CAPTURE_TICKET };
      ticket.signature = b64(new Uint8Array(await this.subtle.sign("Ed25519", await importPrivate(key.privateKey, this.subtle), canonicalUtf8(captureTicketClaims(ticket)))));
      tickets.push(ticket);
    }
    return { serverTime: issuedAt, tickets };
  }
};
var createCaptureTicketHttpHandler = ({ service, authenticate, limits = {}, now = () => Date.now() }) => {
  const rates = /* @__PURE__ */ new Map(), configured = { online: 30, offline: 3, ...limits };
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/v2/capture-ticket" || request.method !== "POST") return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    try {
      const authorization = request.headers.get("authorization") || "";
      if (!/^Bearer\s+\S+/i.test(authorization)) throw fail("UNAUTHENTICATED", 401);
      const subject = await authenticate(request), body = await request.json().catch(() => {
        throw fail("INVALID_JSON");
      }), bucket = body.kind === "offline" ? "offline" : "online", key = `${bucket}:${subject?.subjectId || "unknown"}`, time = now(), state = rates.get(key), limit = configured[bucket];
      if (!state || state.resetAt <= time) rates.set(key, { count: 1, resetAt: time + 6e4 });
      else if (++state.count > limit) return Response.json({ ok: false, code: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.ceil((state.resetAt - time) / 1e3)) } });
      const issued = await service.issue(subject, body);
      return Response.json({ ok: true, ...issued }, { headers: { "Cache-Control": "no-store", "Vary": "Authorization" } });
    } catch (error) {
      return Response.json({ ok: false, code: error.code || "CAPTURE_TICKET_INVALID" }, { status: error.status || 400, headers: { "Cache-Control": "no-store", "Vary": "Authorization" } });
    }
  };
};
var createEdgeCaptureTicketHandler = createCaptureTicketHttpHandler;
var createDockerCaptureTicketHandler = createCaptureTicketHttpHandler;

// packages/provenance-core/src/durable-queue-v2.js
var clone = (value) => JSON.parse(JSON.stringify(value));
var DurableProvenanceQueueV2 = class {
  constructor({ storage, key = "jilu-provenance-queue-v2", limit = 500, now = () => Date.now(), validateTask = null }) {
    if (!storage) throw new Error("QUEUE_STORAGE_REQUIRED");
    this.storage = storage;
    this.key = key;
    this.journalKey = `${key}:journal`;
    this.limit = limit;
    this.now = now;
    this.validateTask = validateTask;
    this.recover();
  }
  read() {
    const value = this.storage.get(this.key);
    return value && value.version === 2 && Array.isArray(value.tasks) ? clone(value) : { version: 2, tasks: [] };
  }
  recover() {
    const journal = this.storage.get(this.journalKey);
    if (!journal || !journal.next) return;
    this.storage.set(this.key, journal.next);
    this.storage.remove(this.journalKey);
  }
  commit(next) {
    const journal = { version: 1, next: clone(next), writtenAt: this.now() };
    this.storage.set(this.journalKey, journal);
    this.storage.set(this.key, next);
    this.storage.remove(this.journalKey);
  }
  list() {
    return this.read().tasks.map((task) => this.validateTask && !this.validateTask(task).valid ? { ...task, status: "QUEUE_TASK_CORRUPT" } : task);
  }
  enqueue(task) {
    const state = this.read();
    if (!task || !task.taskId) throw new Error("PROVENANCE_TASK_INVALID");
    if (this.validateTask && !this.validateTask(task).valid) throw new Error("PROVENANCE_DRAFT_INVALID");
    if (state.tasks.some((item) => item.taskId === task.taskId)) return clone(task);
    if (state.tasks.length >= this.limit) throw new Error("PROVENANCE_QUEUE_FULL");
    const stored = { ...clone(task), status: task.status || "pending", queuedAt: task.queuedAt || this.now() };
    this.commit({ version: 2, tasks: [...state.tasks, stored] });
    return clone(stored);
  }
  update(taskId, patch) {
    const state = this.read();
    const index = state.tasks.findIndex((item) => item.taskId === taskId);
    if (index < 0) throw new Error("PROVENANCE_TASK_NOT_FOUND");
    state.tasks[index] = { ...state.tasks[index], ...clone(patch), updatedAt: this.now() };
    this.commit(state);
    return clone(state.tasks[index]);
  }
  pruneRegistered() {
    const state = this.read();
    const next = { version: 2, tasks: state.tasks.filter((item) => item.status !== "registered") };
    this.commit(next);
    return state.tasks.length - next.tasks.length;
  }
};

// packages/provenance-core/src/capture-pipeline-v2.js
var CAPTURE_RESULT = Object.freeze({
  NORMAL: "NORMAL_CAPTURE_READY",
  TRUSTED_PENDING: "TRUSTED_CAPTURE_PENDING_REGISTRATION",
  TRUSTED_FAILED: "TRUSTED_CAPTURE_FAILED"
});
var CameraCaptureAdapter = class {
  constructor(takePhoto) {
    this.takePhotoImpl = takePhoto;
  }
  takePhoto(options) {
    return this.takePhotoImpl(options);
  }
};
var evaluateTrustedPreconditions = ({ requestedTrustMode, sourceType: sourceType2, locationEvidence, ticket, now }) => {
  if (requestedTrustMode !== "TRUSTED") return { ready: false, mode: "NORMAL" };
  if (sourceType2 !== "live-camera") return { ready: false, reason: "LIVE_CAMERA_REQUIRED" };
  if (!locationEvidence || locationEvidence.source !== "device-gps") return { ready: false, reason: "DEVICE_GPS_REQUIRED" };
  if (!ticket || ticket.state !== "reserved" || now >= ticket.expiresAt) return { ready: false, reason: "VALID_TICKET_REQUIRED" };
  return { ready: true, mode: "TRUSTED" };
};
var captureWithTiming = async ({ adapter, preflight, ticketPool, ticket, clock = () => Date.now(), options = { quality: "high" } }) => {
  await preflight();
  if (ticket && clock() >= ticket.expiresAt) throw new Error("CAPTURE_TICKET_EXPIRED");
  const captureRequestedAt = clock();
  if (ticket) ticketPool.burn(ticket.ticketId);
  try {
    const photo = await adapter.takePhoto(options);
    const captureCompletedAt = clock();
    return { photo, captureRequestedAt, captureCompletedAt };
  } catch (error) {
    error.captureRequestedAt = captureRequestedAt;
    throw error;
  }
};
var finalizeCaptureCandidate = ({ requestedTrustMode, sourceType: sourceType2, locationEvidence, evidenceReady, queued }) => {
  if (requestedTrustMode !== "TRUSTED" || sourceType2 !== "live-camera") return { state: CAPTURE_RESULT.NORMAL, requestedTrustMode: "NORMAL" };
  const ok = locationEvidence?.source === "device-gps" && evidenceReady && queued;
  return { state: ok ? CAPTURE_RESULT.TRUSTED_PENDING : CAPTURE_RESULT.TRUSTED_FAILED, requestedTrustMode: "TRUSTED" };
};

// packages/provenance-core/src/ticket-pool.js
var copy = (value) => JSON.parse(JSON.stringify(value));
var CaptureTicketPool = class {
  constructor({ storage, scope, validate, now = () => Date.now(), key = "jilu-capture-ticket-pool-v1", max = 20, enforceTicketSubjectScope = true }) {
    if (!storage || !scope || !validate) throw new Error("TICKET_POOL_CONFIGURATION_INVALID");
    this.storage = storage;
    this.scope = scope;
    this.validate = validate;
    this.now = now;
    this.max = max;
    this.enforceTicketSubjectScope = enforceTicketSubjectScope;
    this.key = `${key}:${scope}`;
  }
  read() {
    const x = this.storage.get(this.key);
    return Array.isArray(x) ? copy(x) : [];
  }
  write(items) {
    this.storage.set(this.key, items);
    return copy(items);
  }
  list() {
    return this.prune();
  }
  prune() {
    return this.write(this.read().filter((x) => x.state !== "burned" && (!this.enforceTicketSubjectScope || x.subjectId === this.scope) && this.now() < x.expiresAt));
  }
  async add(tickets) {
    const current = this.prune();
    for (const ticket of tickets || []) {
      if (current.length >= this.max) break;
      if (await this.validate(ticket, this.scope) && !current.some((x) => x.ticketId === ticket.ticketId)) current.push({ ...ticket, state: "unused" });
    }
    return this.write(current);
  }
  reserve(kind = "offline", captureOperationId = null) {
    const items = this.prune(), ticket = items.find((x) => x.kind === kind && x.state === "unused");
    if (!ticket) return null;
    ticket.state = "reserved";
    ticket.reservedAt = this.now();
    ticket.captureOperationId = captureOperationId;
    this.write(items);
    return copy(ticket);
  }
  release(ticketId) {
    const items = this.read(), ticket = items.find((x) => x.ticketId === ticketId);
    if (!ticket || ticket.state !== "reserved" || this.now() >= ticket.expiresAt) return false;
    ticket.state = "unused";
    delete ticket.reservedAt;
    delete ticket.captureOperationId;
    this.write(items);
    return true;
  }
  burn(ticketId) {
    const items = this.read(), ticket = items.find((x) => x.ticketId === ticketId);
    if (!ticket || ticket.state !== "reserved") return false;
    ticket.state = "burned";
    ticket.burnedAt = this.now();
    this.write(items);
    return true;
  }
  clear() {
    this.storage.remove(this.key);
  }
};

// packages/provenance-core/src/final-image-evidence.js
var normalizeBounds = (bounds2) => {
  const value = Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, Number(bounds2?.[key])]));
  if (![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0 || value.x + value.width > 1 || value.y + value.height > 1) throw new Error("WATERMARK_BOUNDS_INVALID");
  return value;
};
var buildFinalImageEvidence = async ({ rawBytes, rgba, width, height, watermarkBounds, blindMarker, fileSha256, subtle, onTiming, onStage }) => {
  if (!ArrayBuffer.isView(rawBytes) || !ArrayBuffer.isView(rgba) || rgba.length !== width * height * 4) throw new Error("FINAL_IMAGE_INPUT_INVALID");
  const bounds2 = normalizeBounds(watermarkBounds);
  const now = () => typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(), timing = {}, mark = (name, start) => {
    timing[name] = Number((now() - start).toFixed(2));
  };
  let started = now(), sha256 = fileSha256 || await sha256Bytes(rawBytes, subtle);
  mark("shaMs", started);
  onStage?.("SHA");
  started = now();
  const dhash = dhash256FromRgba(rgba, width, height);
  mark("dhashMs", started);
  onStage?.("DHASH");
  started = now();
  const phash = phash256FromRgba(rgba, width, height);
  mark("phashMs", started);
  onStage?.("PHASH");
  started = now();
  const regional = computeRegionalIntegrityV3(rgba, width, height);
  mark("regionalMs", started);
  onStage?.("REGIONAL");
  started = now();
  const watermark = computeWatermarkIntegrityV2(rgba, width, height, bounds2);
  mark("watermarkMs", started);
  onStage?.("WATERMARK");
  if (onTiming) onTiming(timing);
  return {
    file: { algorithm: ALGORITHM_ID.SHA256, sha256 },
    fingerprints: {
      dhash: { algorithm: ALGORITHM_ID.DHASH256, value: dhash },
      phash: { algorithm: ALGORITHM_ID.PHASH256, value: phash },
      regional,
      watermark: { ...watermark, bounds: bounds2 }
    },
    blindMarker: blindMarker || { success: false, embedded: false }
  };
};
var blindBinding = (marker2) => marker2?.success === true ? {
  status: "PRESENT",
  carrierProfile: String(marker2.carrierProfile || ALGORITHM_ID.BLIND),
  markerId: marker2.markerId,
  ticketDigest: marker2.ticketDigest || "0000000000000000",
  flags: marker2.flags || 0,
  confidence: Number(marker2.confidence || 0)
} : { status: "NOT_EMBEDDED" };
var buildRegistrationDraftV2 = ({ evidence, source, time, location, templateContext = { origin: "none" }, rendererVersion = 2, privacyLevel = "private", trustPolicyVersion = "trusted-capture-v2" }) => ({
  schema: "jilu-provenance",
  protocolVersion: 2,
  trustPolicyVersion,
  source,
  time,
  location,
  templateContext,
  binding: {
    sha256: evidence.file.sha256,
    dhash256: evidence.fingerprints.dhash.value,
    phash256: evidence.fingerprints.phash.value,
    blindBinding: blindBinding(evidence.blindMarker),
    algorithms: { sha256: evidence.file.algorithm, dhash256: evidence.fingerprints.dhash.algorithm, phash256: evidence.fingerprints.phash.algorithm },
    watermarkRegion: evidence.fingerprints.watermark.bounds
  },
  integrity: ["regional-integrity-v2", "regional-integrity-v3"].includes(evidence.fingerprints.regional.algorithm) ? evidence.fingerprints.regional : { algorithm: evidence.fingerprints.regional.algorithm, hashes: evidence.fingerprints.regional.blocks },
  watermarkIntegrity: evidence.fingerprints.watermark.algorithm === "watermark-integrity-v2" ? Object.fromEntries(Object.entries(evidence.fingerprints.watermark).filter(([key]) => key !== "bounds")) : { algorithm: evidence.fingerprints.watermark.algorithm, hashes: evidence.fingerprints.watermark.blocks },
  rendererVersion,
  privacyLevel
});

// packages/provenance-core/src/registration-request-v2.js
var validateRegistrationRequestV2 = (request) => {
  const issues = [];
  if (!request || typeof request !== "object" || Array.isArray(request)) return { valid: false, issues: [{ path: "", code: "OBJECT_REQUIRED" }] };
  for (const key of Object.keys(request)) if (!["clientTaskId", "draft", "ticket"].includes(key)) issues.push({ path: `/${key}`, code: "UNKNOWN_FIELD" });
  if (!/^task_[A-Za-z0-9_-]{12,80}$/.test(String(request.clientTaskId || ""))) issues.push({ path: "/clientTaskId", code: "CLIENT_TASK_ID_INVALID" });
  const draftResult = validateProvenanceDraftV2(request.draft);
  issues.push(...draftResult.issues.map((x) => ({ ...x, path: `/draft${x.path}` })));
  if (request.draft?.source?.captureMode === "TRUSTED" && !request.ticket) issues.push({ path: "/ticket", code: "TRUSTED_TICKET_REQUIRED" });
  if (request.draft?.source?.captureMode === "NORMAL" && request.ticket) issues.push({ path: "/ticket", code: "UNEXPECTED_TICKET" });
  if (request.ticket) {
    const ticket = request.ticket, allowed = ["schema", "version", "ticketId", "subjectId", "nonce", "markerId", "kind", "issuedAt", "expiresAt", "keyId", "purpose", "signature"];
    for (const key of Object.keys(ticket)) if (!allowed.includes(key)) issues.push({ path: `/ticket/${key}`, code: "UNKNOWN_FIELD" });
    if (ticket.schema !== "jilu-capture-ticket" || ticket.version !== 1 || !["online", "offline"].includes(ticket.kind) || ticket.purpose !== "capture-ticket-signing" || !/^tkt_[A-Za-z0-9_-]{16,64}$/.test(String(ticket.ticketId || "")) || !/^sub_[A-Za-z0-9_-]{16,64}$/.test(String(ticket.subjectId || "")) || !/^[A-Za-z0-9_-]{22,128}$/.test(String(ticket.nonce || "")) || !/^[a-f0-9]{32}$/.test(String(ticket.markerId || "")) || !Number.isSafeInteger(ticket.issuedAt) || !Number.isSafeInteger(ticket.expiresAt) || ticket.expiresAt <= ticket.issuedAt || !/^[A-Za-z0-9_-]{86}$/.test(String(ticket.signature || ""))) issues.push({ path: "/ticket", code: "TICKET_SHAPE_INVALID" });
  }
  return { valid: issues.length === 0, issues };
};
var validateRegistrationTicket = validateCaptureTicket;

// packages/provenance-core/src/registration-runtime-v2.js
var fail2 = (code, status = 400, details) => Object.assign(new Error(code), { code, status, details });
var b642 = (bytes) => typeof Buffer !== "undefined" ? Buffer.from(bytes).toString("base64url") : btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var clone2 = (value) => structuredClone(value);
var REGISTRATION_RESULT = Object.freeze({
  CREATED: "CREATED",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
  CONFLICT: "CONFLICT"
});
var SOFT_RETRIEVAL_INDEX_VERSION = "soft-retrieval-v2";
var MemoryProvenanceCommitRepository = class {
  constructor() {
    this.commits = /* @__PURE__ */ new Map();
    this.records = /* @__PURE__ */ new Map();
    this.file = /* @__PURE__ */ new Map();
    this.marker = /* @__PURE__ */ new Map();
    this.bands = /* @__PURE__ */ new Map();
    this.reconciliation = /* @__PURE__ */ new Set();
  }
  scope(commit) {
    return commit.ticketId ? `ticket:${commit.ticketId}` : `normal:${commit.subjectId}:${commit.clientTaskId}`;
  }
  async getRegistration(scope) {
    return clone2(this.commits.get(this.scope(scope)) || null);
  }
  async commitRegistration(commit) {
    const key = this.scope(commit), existing = this.commits.get(key);
    if (existing)
      return existing.registrationRequestDigest === commit.registrationRequestDigest ? {
        result: REGISTRATION_RESULT.IDEMPOTENT_REPLAY,
        commit: clone2(existing)
      } : { result: REGISTRATION_RESULT.CONFLICT, commit: clone2(existing) };
    this.validateRequiredIndexes(commit.record);
    this.commits.set(key, clone2(commit));
    this.records.set(commit.record.recordId, clone2(commit.record));
    await this.indexRecord(commit.record);
    return {
      result: REGISTRATION_RESULT.CREATED,
      commit: clone2(commit),
      indexStatus: "READY"
    };
  }
  validateRequiredIndexes(record) {
    lshBands256(record.binding.dhash256);
    lshBands256(record.binding.phash256);
    const markerId = record.binding.blindBinding?.status === "PRESENT" ? record.binding.blindBinding.markerId : record.binding.blindMarkerId;
    const marker2 = markerId ? this.marker.get(markerId) : null;
    if (marker2 && marker2 !== record.recordId)
      throw fail2("PROVENANCE_MARKER_CONFLICT", 409);
  }
  async indexRecord(record) {
    const add = (map, key, value) => {
      if (!map.has(key)) map.set(key, /* @__PURE__ */ new Map());
      map.get(key).set(record.recordId, value);
    };
    add(this.file, record.binding.sha256, record.recordId);
    const markerId = record.binding.blindBinding?.status === "PRESENT" ? record.binding.blindBinding.markerId : record.binding.blindMarkerId;
    if (markerId) this.marker.set(markerId, record.recordId);
    for (const [algorithm, hash2] of [["dhash256", record.binding.dhash256], ["phash256", record.binding.phash256]].filter(([, value]) => /^[a-f0-9]{64}$/i.test(String(value || ""))))
      for (const band of lshBands256(hash2))
        add(this.bands, `${algorithm}:${band.bandIndex}:${band.bandValue}`, {
          recordId: record.recordId,
          hash: hash2,
          algorithm,
          indexVersion: SOFT_RETRIEVAL_INDEX_VERSION
        });
    this.reconciliation.delete(record.recordId);
  }
  async reconcile(recordId) {
    const record = this.records.get(recordId);
    if (!record) return false;
    await this.indexRecord(record);
    return true;
  }
  async reconcileAll() {
    for (const id2 of [...this.reconciliation]) await this.reconcile(id2);
    return this.reconciliation.size;
  }
  async backfillSoftRetrievalV2() {
    let indexed = 0;
    for (const record of this.records.values()) {
      this.validateRequiredIndexes(record);
      await this.indexRecord(record);
      indexed++;
    }
    return { indexVersion: SOFT_RETRIEVAL_INDEX_VERSION, indexed, remaining: this.reconciliation.size };
  }
  async getRecordById(id2) {
    return clone2(this.records.get(id2) || null);
  }
  async findByFileSha256(hash2, { limit = 64 } = {}) {
    const ids = [...this.file.get(hash2)?.keys() || []].sort();
    return {
      records: ids.slice(0, limit).map((recordId) => ({ recordId })),
      truncated: ids.length > limit
    };
  }
  async findByMarkerId(marker2, { limit = 8 } = {}) {
    const value = this.marker.get(marker2), ids = value instanceof Map ? [...value.keys()] : value ? [value] : [];
    return {
      records: ids.slice(0, limit).map((recordId) => ({ recordId })),
      truncated: ids.length > limit,
      conflict: ids.length > 1
    };
  }
  async getRecordsByFileSha256(hash2) {
    return [...this.file.get(hash2)?.keys() || []].map(
      (id2) => clone2(this.records.get(id2))
    );
  }
  async getRecordByMarkerId(marker2) {
    const id2 = this.marker.get(marker2);
    return id2 ? clone2(this.records.get(id2)) : null;
  }
  async findVisualCandidates(hash2, { algorithm = "dhash256", limit = 100, perBandLimit = 64 } = {}) {
    const found = /* @__PURE__ */ new Map();
    let truncated = false;
    for (const band of lshBands256(hash2)) {
      const rows = [
        ...this.bands.get(`${algorithm}:${band.bandIndex}:${band.bandValue}`)?.values() || []
      ];
      if (rows.length > perBandLimit) truncated = true;
      for (const row of rows.slice(0, perBandLimit)) {
        const prior = found.get(row.recordId);
        found.set(row.recordId, {
          ...clone2(row),
          bandCount: (prior?.bandCount || 0) + 1
        });
        if (found.size >= Math.min(500, limit)) {
          const output2 = [...found.values()];
          output2.truncated = true;
          return output2;
        }
      }
    }
    const output = [...found.values()];
    output.truncated = truncated;
    return output;
  }
  async cleanupExpired({ now = Date.now(), dryRun = true } = {}) {
    const ids = [...this.records.values()].filter((x) => x.expiresAt <= now).map((x) => x.recordId);
    if (!dryRun)
      for (const id2 of ids) {
        this.records.delete(id2);
        for (const map of [this.file, this.bands])
          for (const [key, rows] of map) {
            rows.delete(id2);
            if (!rows.size) map.delete(key);
          }
        for (const [key, value] of this.marker)
          if (value === id2) this.marker.delete(key);
      }
    return { dryRun, count: ids.length, recordIds: ids };
  }
};
var ProvenanceRegistrationServiceV2 = class {
  constructor({
    repository,
    captureKeys = [],
    receiptKeys = [],
    now = () => Date.now(),
    random = (n) => secureRandomBytes(n),
    subtle = globalThis.crypto?.subtle,
    retentionMs = 365 * 864e5,
    clockSkewMs = 3e4,
    maxRegistrationAgeMs = 30 * 864e5,
    requireIntegrityV2 = false
  }) {
    Object.assign(this, {
      repository,
      captureKeys,
      receiptKeys,
      now,
      random,
      subtle,
      retentionMs,
      clockSkewMs,
      maxRegistrationAgeMs,
      requireIntegrityV2
    });
  }
  activeReceiptKey() {
    const key = this.receiptKeys.find(
      (x) => x.purpose === KEY_PURPOSE.PROVENANCE_RECEIPT && String(x.status).toUpperCase() === "ACTIVE" && x.privateKey
    );
    if (!key) throw fail2("PROVENANCE_RECEIPT_SIGNING_UNAVAILABLE", 503);
    return key;
  }
  publicKeys() {
    return this.receiptKeys.filter(
      (x) => x.purpose === KEY_PURPOSE.PROVENANCE_RECEIPT && ["ACTIVE", "VERIFY_ONLY"].includes(String(x.status).toUpperCase())
    ).map(({ keyId, purpose, algorithm = "Ed25519", status, publicKey }) => ({
      keyId,
      purpose,
      algorithm,
      status,
      publicKey
    }));
  }
  async register(subject, request) {
    const validation = validateRegistrationRequestV2(request);
    if (!validation.valid)
      throw fail2("PROVENANCE_REQUEST_INVALID", 400, validation.issues);
    if (!subject || subject.status !== "active")
      throw fail2("SUBJECT_DISABLED", 403);
    const normalized = clone2(request), registrationRequestDigest = await digestCanonicalJson(
      normalized,
      this.subtle
    ), draft = normalized.draft, trusted = draft.source.captureMode === "TRUSTED", received = this.now();
    let ticket = null;
    if (this.requireIntegrityV2 && (draft.integrity.algorithm !== "regional-integrity-v3" || draft.watermarkIntegrity.algorithm !== "watermark-integrity-v2"))
      throw fail2("UNSUPPORTED_INTEGRITY_ALGORITHM", 400);
    if (trusted) {
      if (draft.source.type !== "live-camera" || draft.location.source !== "device-gps")
        throw fail2("TRUSTED_CAPTURE_EVIDENCE_INVALID");
      if (draft.trustPolicyVersion !== "trusted-capture-v2")
        throw fail2("TRUST_POLICY_VERSION_INVALID");
      ticket = normalized.ticket;
      const checked = await validateCaptureTicket({
        ticket,
        subjectId: subject.subjectId,
        markerId: ticket?.markerId,
        now: draft.time.captureCompletedAt,
        keys: this.captureKeys,
        subtle: this.subtle
      });
      if (!checked.valid) {
        const map = {
          SUBJECT_MISMATCH: "CAPTURE_TICKET_SUBJECT_MISMATCH",
          MARKER_MISMATCH: "CAPTURE_TICKET_MARKER_MISMATCH",
          EXPIRED: "CAPTURE_TICKET_EXPIRED"
        };
        throw fail2(
          map[checked.reason] || "CAPTURE_TICKET_INVALID",
          checked.reason === "SUBJECT_MISMATCH" ? 403 : 400
        );
      }
      if (draft.time.captureRequestedAt < ticket.issuedAt - this.clockSkewMs || draft.time.captureCompletedAt > ticket.expiresAt + this.clockSkewMs || draft.time.captureCompletedAt < draft.time.captureRequestedAt || received - draft.time.captureCompletedAt > this.maxRegistrationAgeMs)
        throw fail2("CAPTURE_WINDOW_INVALID");
    }
    const prior = this.repository.preflightIdempotency === false ? null : await this.repository.getRegistration?.({
      subjectId: subject.subjectId,
      clientTaskId: normalized.clientTaskId,
      ticketId: ticket?.ticketId || null
    });
    if (prior) {
      if (prior.registrationRequestDigest !== registrationRequestDigest)
        throw fail2(
          ticket ? "CAPTURE_TICKET_ALREADY_CONSUMED" : "REGISTRATION_IDEMPOTENCY_CONFLICT",
          409
        );
      return this.response(
        REGISTRATION_RESULT.IDEMPOTENT_REPLAY,
        prior,
        "READY"
      );
    }
    const key = this.activeReceiptKey(), recordId = `rec_${b642(this.random(24))}`, record = {
      schema: "jilu-provenance-record",
      protocolVersion: 2,
      recordId,
      subjectId: subject.subjectId,
      clientTaskId: normalized.clientTaskId,
      finalTrustMode: trusted ? "TRUSTED" : "NORMAL",
      trustPolicyVersion: draft.trustPolicyVersion || "legacy-trusted-capture-v1",
      assuranceLevel: trusted ? "trusted" : "registered",
      source: draft.source,
      time: { ...draft.time, serverReceivedAt: received },
      location: draft.location,
      templateContext: draft.templateContext || { origin: "none" },
      binding: draft.binding,
      integrity: draft.integrity,
      watermarkIntegrity: draft.watermarkIntegrity,
      ticket: ticket ? {
        id: ticket.ticketId,
        issuedAt: ticket.issuedAt,
        keyId: ticket.keyId,
        kind: ticket.kind
      } : null,
      rendererVersion: draft.rendererVersion,
      privacyLevel: draft.privacyLevel,
      verificationCount: 0,
      expiresAt: received + this.retentionMs,
      registrationRequestDigest
    }, recordDigest = await canonicalRecordDigest(record, this.subtle), receipt = {
      schema: "jilu-provenance-receipt",
      version: 1,
      recordId,
      protocolVersion: 2,
      serverReceivedAt: received,
      recordDigest,
      keyId: key.keyId,
      purpose: KEY_PURPOSE.PROVENANCE_RECEIPT
    };
    receipt.signature = await signEd25519({
      payload: canonicalUtf8(receiptClaims(receipt)),
      privateKey: key.privateKey,
      subtle: this.subtle
    });
    record.recordDigest = recordDigest;
    record.receipt = receipt;
    const commit = {
      subjectId: subject.subjectId,
      clientTaskId: normalized.clientTaskId,
      ticketId: ticket?.ticketId || null,
      registrationRequestDigest,
      record,
      recordDigest,
      receipt,
      serverReceivedAt: received,
      createdAt: received
    }, result = await this.repository.commitRegistration(commit);
    if (result.result === REGISTRATION_RESULT.CONFLICT)
      throw fail2(
        ticket ? "CAPTURE_TICKET_ALREADY_CONSUMED" : "REGISTRATION_IDEMPOTENCY_CONFLICT",
        409
      );
    return this.response(
      result.result,
      result.commit,
      result.indexStatus || "READY"
    );
  }
  response(result, commit, indexStatus) {
    return {
      ok: true,
      result,
      clientTaskId: commit.clientTaskId,
      recordId: commit.record.recordId,
      protocolVersion: 2,
      finalTrustMode: commit.record.finalTrustMode,
      serverReceivedAt: commit.serverReceivedAt,
      registrationRequestDigest: commit.registrationRequestDigest,
      recordDigest: commit.recordDigest,
      receipt: commit.receipt,
      indexStatus
    };
  }
};
var createProvenanceRegistrationHttpHandler = ({
  service,
  authenticate,
  limits = { perMinute: 20 },
  now = () => Date.now(),
  bodyLimit = 256 * 1024
}) => {
  const rates = /* @__PURE__ */ new Map();
  return async (request) => {
    const headers = { "Cache-Control": "no-store", Vary: "Authorization" };
    if (new URL(request.url).pathname !== "/v2/provenance/register" || request.method !== "POST")
      return Response.json(
        { ok: false, code: "NOT_FOUND" },
        { status: 404, headers }
      );
    try {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > bodyLimit) throw fail2("PAYLOAD_TOO_LARGE", 413);
      const authorization = request.headers.get("authorization") || "";
      if (!/^Bearer\s+\S+/i.test(authorization))
        throw fail2("UNAUTHENTICATED", 401);
      const subject = await authenticate(request), time = now(), state = rates.get(subject.subjectId);
      if (!state || state.resetAt <= time)
        rates.set(subject.subjectId, { count: 1, resetAt: time + 6e4 });
      else if (++state.count > limits.perMinute)
        return Response.json(
          { ok: false, code: "RATE_LIMITED" },
          {
            status: 429,
            headers: {
              ...headers,
              "Retry-After": String(Math.ceil((state.resetAt - time) / 1e3))
            }
          }
        );
      const text = await request.text();
      if (utf8Bytes(text).length > bodyLimit)
        throw fail2("PAYLOAD_TOO_LARGE", 413);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw fail2("PROVENANCE_REQUEST_INVALID");
      }
      return Response.json(await service.register(subject, body), { headers });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code: error.code || "PROVENANCE_COMMIT_FAILED",
          ...error.details ? { details: error.details } : {}
        },
        { status: error.status || 500, headers }
      );
    }
  };
};
var createEdgeProvenanceRegistrationHandler = createProvenanceRegistrationHttpHandler;
var createDockerProvenanceRegistrationHandler = createProvenanceRegistrationHttpHandler;
var createEsaProvenanceRegistrationHandler = () => async () => Response.json(
  { ok: false, code: "AUTHORITATIVE_PROVENANCE_STORAGE_NOT_CONFIGURED" },
  { status: 503, headers: { "Cache-Control": "no-store" } }
);

// packages/provenance-core/src/queue-sync-v2.js
var retryable = /* @__PURE__ */ new Set(["NETWORK_ERROR", "RATE_LIMITED", "PROVENANCE_COMMIT_FAILED", "INDEX_RECONCILIATION_REQUIRED"]);
var ProvenanceQueueSyncServiceV2 = class {
  constructor({ queue, transport, keyProvider, history, subtle = globalThis.crypto?.subtle, verifySignature, now = () => Date.now(), maxPerRun = 10, concurrency = 2 }) {
    Object.assign(this, { queue, transport, keyProvider, history, subtle, verifySignature, now, maxPerRun, concurrency });
  }
  async verify(receipt) {
    const input = { receipt, keys: await this.keyProvider.getKeys({ force: false }), subtle: this.subtle, ...this.verifySignature ? { verify: this.verifySignature } : {} };
    let result = await validateReceipt(input);
    if (!result.valid && result.reason === "KEY_UNKNOWN") {
      input.keys = await this.keyProvider.getKeys({ force: true });
      result = await validateReceipt(input);
    }
    return result;
  }
  async one(task) {
    this.queue.update(task.taskId, { status: "inflight", attempts: (task.attempts || 0) + 1, lastAttemptAt: this.now() });
    let response;
    try {
      response = await this.transport.register(task.request);
    } catch (error) {
      this.queue.update(task.taskId, { status: "pending", lastError: "NETWORK_ERROR", nextAttemptAt: this.now() + Math.min(36e5, 1e3 * 2 ** Math.min(10, task.attempts || 0)) });
      return { taskId: task.taskId, status: "retry" };
    }
    if (!response?.ok) {
      const code = response?.code || "PROVENANCE_COMMIT_FAILED";
      this.queue.update(task.taskId, { status: retryable.has(code) ? "pending" : "registration_failed", lastError: code });
      return { taskId: task.taskId, status: retryable.has(code) ? "retry" : "failed", code };
    }
    const verified = await this.verify(response.receipt), bound = verified.valid && response.clientTaskId === task.taskId && response.receipt.recordId === response.recordId && response.receipt.serverReceivedAt === response.serverReceivedAt && response.receipt.recordDigest === response.recordDigest;
    if (!bound) {
      this.queue.update(task.taskId, { status: "receipt_security_failure", lastError: verified.valid ? "RECEIPT_RESPONSE_BINDING_INVALID" : verified.reason });
      return { taskId: task.taskId, status: "security_failure" };
    }
    const registeredState = response.finalTrustMode === "TRUSTED" ? "TRUSTED_REGISTERED" : "NORMAL_REGISTERED", saved = { recordId: response.recordId, serverReceivedAt: response.serverReceivedAt, recordDigest: response.recordDigest, receipt: response.receipt, finalTrustMode: response.finalTrustMode, registeredState };
    await this.history?.save(task.taskId, saved);
    this.queue.update(task.taskId, { status: "registered", registeredState, ...saved });
    return { taskId: task.taskId, status: "registered", recordId: response.recordId };
  }
  async drain() {
    const tasks = this.queue.list().filter((x) => ["pending", "inflight"].includes(x.status) && (!x.nextAttemptAt || x.nextAttemptAt <= this.now())).slice(0, this.maxPerRun), results = [];
    for (let i = 0; i < tasks.length; i += this.concurrency) results.push(...await Promise.all(tasks.slice(i, i + this.concurrency).map((x) => this.one(x))));
    return results;
  }
};

// packages/provenance-core/src/queue-integrity-migration-v2.js
var rejected = (request) => ["grid4x4-dhash256-v2", "regional-integrity-v2"].includes(request?.draft?.integrity?.algorithm) || request?.draft?.watermarkIntegrity?.algorithm === "grid4x3-dhash256-v2";
var stages = Object.freeze({ beforeRead: "BEFORE_FINAL_FILE_READ", afterRead: "AFTER_FINAL_FILE_READ", afterSha: "AFTER_SHA_VALIDATION", afterDescriptors: "AFTER_DESCRIPTOR_GENERATION", afterDraft: "AFTER_DRAFT_BUILD", afterStaging: "AFTER_STAGING_WRITE", beforeReplace: "AFTER_STAGING_VALIDATION", afterReplace: "AFTER_TASK_REPLACEMENT" });
var INTEGRITY_MIGRATION_V2_STAGES = stages;
var migratePendingIntegrityV1Tasks = async ({ queue, loadFinalImage, subtle = globalThis.crypto?.subtle, onCheckpoint, onAfterBuild }) => {
  const journalKey = `${queue.key}:integrity-migration-v2`, checkpoint = async (taskId, stage, staging) => {
    queue.storage.set(journalKey, { version: 2, taskId, stage, ...staging ? { staging } : {} });
    await onCheckpoint?.(stage, taskId);
  };
  const existingJournal = queue.storage.get(journalKey);
  if (existingJournal) {
    const task = queue.read().tasks.find((x) => x.taskId === existingJournal.taskId);
    if (task?.request?.draft?.integrity?.algorithm === "regional-integrity-v3") queue.storage.remove(journalKey);
    else if (existingJournal.stage === stages.beforeReplace && existingJournal.staging) {
      const candidate = existingJournal.staging;
      if (!queue.validateTask || queue.validateTask(candidate).valid) queue.update(candidate.taskId, candidate);
      queue.storage.remove(journalKey);
    }
  }
  const results = [];
  for (const task of queue.read().tasks) {
    if (!["pending", "inflight"].includes(task.status) || !rejected(task.request)) {
      results.push({ taskId: task.taskId, result: "UNCHANGED" });
      continue;
    }
    const old = task.request?.draft, bounds2 = old?.binding?.watermarkRegion;
    if (!bounds2 || !["x", "y", "width", "height"].every((k) => Number.isFinite(bounds2[k]))) {
      queue.update(task.taskId, { status: "integrity_rebuild_required", lastError: "INTEGRITY_REBUILD_CONTEXT_MISSING" });
      results.push({ taskId: task.taskId, result: "CONTEXT_MISSING" });
      continue;
    }
    await checkpoint(task.taskId, stages.beforeRead);
    let input;
    try {
      input = await loadFinalImage(task);
    } catch {
      input = null;
    }
    if (!input?.rawBytes || !input?.rgba) {
      queue.update(task.taskId, { status: "integrity_rebuild_required", lastError: "INTEGRITY_REBUILD_FILE_MISSING" });
      queue.storage.remove(journalKey);
      results.push({ taskId: task.taskId, result: "FINAL_FILE_MISSING" });
      continue;
    }
    await checkpoint(task.taskId, stages.afterRead);
    const fileSha256 = await sha256Bytes(input.rawBytes, subtle);
    if (fileSha256 !== old.binding.sha256) {
      queue.update(task.taskId, { status: "integrity_rebuild_required", lastError: "INTEGRITY_REBUILD_FILE_MISMATCH" });
      queue.storage.remove(journalKey);
      results.push({ taskId: task.taskId, result: "FILE_MISMATCH" });
      continue;
    }
    await checkpoint(task.taskId, stages.afterSha);
    const claimed = old.binding.blindEvidence, actual = input.blindMarker;
    if (old.source?.captureMode === "TRUSTED" && claimed?.extracted === true && (!actual?.success || actual.markerId !== claimed.markerId || actual.ticketDigest !== claimed.ticketDigest)) {
      queue.update(task.taskId, { status: "integrity_rebuild_required", lastError: "INTEGRITY_REBUILD_BLIND_CONFLICT" });
      queue.storage.remove(journalKey);
      results.push({ taskId: task.taskId, result: "BLIND_CONFLICT" });
      continue;
    }
    const evidence = await buildFinalImageEvidence({ ...input, fileSha256, watermarkBounds: bounds2, blindMarker: input.blindMarker || old.binding.blindEvidence, subtle });
    await checkpoint(task.taskId, stages.afterDescriptors);
    const rebuilt = buildRegistrationDraftV2({ evidence, source: old.source, time: old.time, location: old.location, templateContext: old.templateContext, rendererVersion: old.rendererVersion, privacyLevel: old.privacyLevel });
    await onAfterBuild?.(task, rebuilt);
    await checkpoint(task.taskId, stages.afterDraft);
    if (rebuilt.binding.blindMarkerId !== old.binding.blindMarkerId || ["x", "y", "width", "height"].some((k) => rebuilt.binding.watermarkRegion[k] !== bounds2[k])) {
      queue.update(task.taskId, { status: "integrity_rebuild_required", lastError: "INTEGRITY_REBUILD_CONTEXT_MISSING" });
      queue.storage.remove(journalKey);
      results.push({ taskId: task.taskId, result: "CONTEXT_MISSING" });
      continue;
    }
    const candidate = { ...task, request: { ...task.request, draft: rebuilt }, status: "pending", lastError: null, integrityMigration: "V3_REBUILT" };
    await checkpoint(task.taskId, stages.afterStaging, candidate);
    if (queue.validateTask && !queue.validateTask(candidate).valid) {
      queue.update(task.taskId, { status: "integrity_rebuild_required", lastError: "INTEGRITY_REBUILD_FAILED" });
      queue.storage.remove(journalKey);
      results.push({ taskId: task.taskId, result: "REBUILD_FAILED" });
      continue;
    }
    await checkpoint(task.taskId, stages.beforeReplace, candidate);
    queue.update(task.taskId, candidate);
    await checkpoint(task.taskId, stages.afterReplace);
    queue.storage.remove(journalKey);
    results.push({ taskId: task.taskId, result: "REBUILT" });
  }
  return results;
};

// packages/provenance-core/src/verification-runtime-v2.js
var VERIFICATION_THRESHOLD_PROFILE_V1 = Object.freeze({
  id: "provenance-verification-v2-attribution-v1",
  dhashStrong: 20,
  dhashMaximum: 72,
  phashMaximum: 64,
  regionalBlockDistance: 52,
  regionalChangedMaximum: 2,
  watermarkBlockDistance: 52,
  watermarkChangedMaximum: 1,
  uniquenessGap: 16,
  blindConfidence: 0.2,
  boundsTolerance: 0.03,
  perBandLimit: 64,
  globalCandidateLimit: 256,
  exactLimit: 64,
  markerLimit: 8,
  attribution: { outsideStrongPatchMin: 15, outsideStrongResidualMin: 8 }
});
var issue2 = (path, code) => ({ path, code });
var object = (x) => x && typeof x === "object" && !Array.isArray(x);
var hash = (x) => /^[a-f0-9]{64}$/.test(String(x || ""));
var marker = (x) => /^[a-f0-9]{32}$/.test(String(x || ""));
var unknown = (issues, x, path, allowed) => {
  if (object(x)) {
    for (const key of Object.keys(x))
      if (!allowed.includes(key))
        issues.push(issue2(`${path}/${key}`, "UNKNOWN_FIELD"));
  }
};
var validateVerificationRequestV2 = (request) => {
  const issues = [];
  if (!object(request))
    return { valid: false, issues: [issue2("", "OBJECT_REQUIRED")] };
  unknown(issues, request, "", [
    "protocolVersion",
    "file",
    "fingerprints",
    "blindMarker",
    "recordHint"
  ]);
  if (request.protocolVersion !== 2)
    issues.push(issue2("/protocolVersion", "PROTOCOL_VERSION_INVALID"));
  unknown(issues, request.file, "/file", ["algorithm", "sha256"]);
  if (request.file?.algorithm !== ALGORITHM_ID.SHA256)
    issues.push(issue2("/file/algorithm", "ALGORITHM_INVALID"));
  if (!hash(request.file?.sha256))
    issues.push(issue2("/file/sha256", "HASH_INVALID"));
  const fp = request.fingerprints || {};
  unknown(issues, fp, "/fingerprints", [
    "dhash",
    "phash",
    "regional",
    "watermark"
  ]);
  for (const [name, algorithm] of [
    ["dhash", ALGORITHM_ID.DHASH256],
    ["phash", ALGORITHM_ID.PHASH256]
  ]) {
    const x = fp[name];
    unknown(issues, x, `/fingerprints/${name}`, ["algorithm", "value"]);
    if (x?.algorithm !== algorithm)
      issues.push(
        issue2(`/fingerprints/${name}/algorithm`, "ALGORITHM_INVALID")
      );
    if (!hash(x?.value))
      issues.push(issue2(`/fingerprints/${name}/value`, "HASH_INVALID"));
  }
  for (const [name, v1, v2, count] of [
    [
      "regional",
      ALGORITHM_ID.INTEGRITY_4X4,
      ALGORITHM_ID.REGIONAL_INTEGRITY_V2,
      16
    ],
    [
      "watermark",
      ALGORITHM_ID.WATERMARK_INTEGRITY_4X3,
      ALGORITHM_ID.WATERMARK_INTEGRITY_V2,
      12
    ]
  ]) {
    const x = fp[name], isV3 = name === "regional" && x?.algorithm === ALGORITHM_ID.REGIONAL_INTEGRITY_V3, isV2 = x?.algorithm === v2, isModern = isV2 || isV3;
    unknown(
      issues,
      x,
      `/fingerprints/${name}`,
      isModern ? name === "watermark" ? ["algorithm", "grid", "descriptorFormat", "blocks", "bounds"] : ["algorithm", "grid", "descriptorFormat", "blocks"] : name === "watermark" ? ["algorithm", "hashes", "bounds"] : ["algorithm", "hashes"]
    );
    if (isModern) {
      const format = isV3 ? "hybrid-normalized-patch-8x8-residual4x4-v1-base64url" : "int8-normalized-patch-8x8-base64url", pattern = isV3 ? /^[A-Za-z0-9_-]{107}$/ : /^[A-Za-z0-9_-]{86}$/;
      if (x.descriptorFormat !== format || x.grid?.columns !== 4 || x.grid?.rows !== (count === 16 ? 4 : 3) || !Array.isArray(x.blocks) || x.blocks.length !== count || !x.blocks.every((b, i) => {
        unknown(issues, b, `/fingerprints/${name}/blocks/${i}`, [
          "index",
          "descriptor"
        ]);
        return b?.index === i && pattern.test(String(b.descriptor || ""));
      }))
        issues.push(
          issue2(`/fingerprints/${name}`, "INTEGRITY_DESCRIPTOR_INVALID")
        );
    } else {
      if (x?.algorithm !== v1)
        issues.push(
          issue2(`/fingerprints/${name}/algorithm`, "ALGORITHM_INVALID")
        );
      if (!Array.isArray(x?.hashes) || x.hashes.length !== count || !x.hashes.every(hash))
        issues.push(
          issue2(`/fingerprints/${name}/hashes`, "INTEGRITY_HASHES_INVALID")
        );
    }
  }
  const bounds2 = fp.watermark?.bounds;
  unknown(issues, bounds2, "/fingerprints/watermark/bounds", [
    "x",
    "y",
    "width",
    "height"
  ]);
  if (!object(bounds2) || ![bounds2.x, bounds2.y, bounds2.width, bounds2.height].every(Number.isFinite) || bounds2.x < 0 || bounds2.y < 0 || bounds2.width <= 0 || bounds2.height <= 0 || bounds2.x + bounds2.width > 1 || bounds2.y + bounds2.height > 1)
    issues.push(
      issue2("/fingerprints/watermark/bounds", "WATERMARK_BOUNDS_INVALID")
    );
  const blind = request.blindMarker;
  unknown(issues, blind, "/blindMarker", [
    "algorithm",
    "protocolVersion",
    "extracted",
    "markerId",
    "ticketDigest",
    "flags",
    "crcValid",
    "confidence"
  ]);
  if (blind?.algorithm !== ALGORITHM_ID.BLIND)
    issues.push(issue2("/blindMarker/algorithm", "ALGORITHM_INVALID"));
  if (blind?.protocolVersion !== 2)
    issues.push(
      issue2("/blindMarker/protocolVersion", "PROTOCOL_VERSION_INVALID")
    );
  if (typeof blind?.extracted !== "boolean" || typeof blind?.crcValid !== "boolean")
    issues.push(issue2("/blindMarker", "BLIND_SHAPE_INVALID"));
  if (!marker(blind?.markerId) || !/^[a-f0-9]{16}$/.test(String(blind?.ticketDigest || "")) || !Number.isInteger(blind?.flags) || blind.flags < 0 || blind.flags > 65535 || !Number.isFinite(blind?.confidence) || blind.confidence < 0 || blind.confidence > 1)
    issues.push(issue2("/blindMarker", "BLIND_PAYLOAD_INVALID"));
  if (request.recordHint !== void 0) {
    unknown(issues, request.recordHint, "/recordHint", ["recordId", "receipt"]);
    if (!/^rec_[A-Za-z0-9_-]{20,80}$/.test(
      String(request.recordHint?.recordId || "")
    ) || !object(request.recordHint?.receipt))
      issues.push(issue2("/recordHint", "RECORD_HINT_INVALID"));
  }
  for (const key of [
    "image",
    "imageBase64",
    "photo",
    "photoBytes",
    "fileBytes",
    "fileContent",
    "status",
    "verified",
    "isTrusted",
    "isAuthentic",
    "finalTrustMode",
    "matchedRecordId"
  ])
    if (key in request)
      issues.push(issue2(`/${key}`, "SERVER_OR_BINARY_FIELD_FORBIDDEN"));
  return { valid: issues.length === 0, issues };
};
var compareGrid = (current, stored, threshold) => {
  const distances = current.map((x, i) => hammingDistance256(x, stored[i])), changedIndices = distances.map((x, i) => x > threshold ? i : -1).filter((x) => x >= 0);
  return {
    changedBlocks: changedIndices.length,
    totalBlocks: distances.length,
    changedIndices,
    distances,
    aggregateDistance: distances.reduce((a, b) => a + b, 0)
  };
};
var boundsCompatible = (a, b, t) => a && b && ["x", "y", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= t);
var intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
var blockGeometry = (index) => ({
  x: index % 4 / 4,
  y: Math.floor(index / 4) / 4,
  width: 0.25,
  height: 0.25
});
var attributeRegionalChange = ({
  regional,
  watermarkChanged,
  storedWatermarkBounds,
  policy = VERIFICATION_THRESHOLD_PROFILE_V1.attribution
}) => {
  const changedRegionalBlocks = regional?.changedIndices || [];
  if (regional?.classification !== "CHANGED" || !watermarkChanged)
    return {
      attribution: REGIONAL_CHANGE_ATTRIBUTION.NOT_APPLICABLE,
      changedRegionalBlocks,
      watermarkOverlappingChangedBlocks: [],
      outsideWatermarkChangedBlocks: []
    };
  if (!storedWatermarkBounds || !["x", "y", "width", "height"].every(
    (k) => Number.isFinite(storedWatermarkBounds[k])
  ))
    return {
      attribution: REGIONAL_CHANGE_ATTRIBUTION.UNKNOWN,
      changedRegionalBlocks,
      watermarkOverlappingChangedBlocks: [],
      outsideWatermarkChangedBlocks: changedRegionalBlocks
    };
  const watermarkOverlappingChangedBlocks = changedRegionalBlocks.filter(
    (i) => intersects(blockGeometry(i), storedWatermarkBounds)
  ), outsideWatermarkChangedBlocks = changedRegionalBlocks.filter(
    (i) => !watermarkOverlappingChangedBlocks.includes(i)
  ), metric = (index) => regional.blockMetrics?.find((x) => x.index === index), outsideStrong = outsideWatermarkChangedBlocks.some((index) => {
    const x = metric(index);
    return !x || x.patchDistance >= policy.outsideStrongPatchMin || x.residualPeak >= policy.outsideStrongResidualMin;
  });
  let attribution;
  if (!outsideWatermarkChangedBlocks.length && watermarkOverlappingChangedBlocks.length)
    attribution = REGIONAL_CHANGE_ATTRIBUTION.WATERMARK_REGION_ONLY;
  else if (outsideWatermarkChangedBlocks.length && !watermarkOverlappingChangedBlocks.length)
    attribution = REGIONAL_CHANGE_ATTRIBUTION.OUTSIDE_WATERMARK_REGION;
  else if (outsideWatermarkChangedBlocks.length && watermarkOverlappingChangedBlocks.length)
    attribution = outsideStrong ? REGIONAL_CHANGE_ATTRIBUTION.MIXED : REGIONAL_CHANGE_ATTRIBUTION.UNKNOWN;
  else attribution = REGIONAL_CHANGE_ATTRIBUTION.UNKNOWN;
  return {
    attribution,
    changedRegionalBlocks,
    watermarkOverlappingChangedBlocks,
    outsideWatermarkChangedBlocks
  };
};
var sourceType = (record) => record.source?.type;
var evaluateCandidateEvidence = (request, record, signals, profile = VERIFICATION_THRESHOLD_PROFILE_V1) => {
  const v3 = request.fingerprints.regional.algorithm === ALGORITHM_ID.REGIONAL_INTEGRITY_V3 && record.integrity.algorithm === ALGORITHM_ID.REGIONAL_INTEGRITY_V3, v2 = request.fingerprints.regional.algorithm === ALGORITHM_ID.REGIONAL_INTEGRITY_V2 && record.integrity.algorithm === ALGORITHM_ID.REGIONAL_INTEGRITY_V2, v1 = request.fingerprints.regional.algorithm === ALGORITHM_ID.INTEGRITY_4X4 && record.integrity.algorithm === ALGORITHM_ID.INTEGRITY_4X4, modern = v3 || v2, unsupported = {
    classification: "UNSUPPORTED",
    changedIndices: [],
    distances: []
  }, regional = v3 ? compareRegionalIntegrityV3(
    record.integrity,
    request.fingerprints.regional
  ) : v2 ? compareRegionalIntegrityV2(
    record.integrity,
    request.fingerprints.regional
  ) : v1 ? compareGrid(
    request.fingerprints.regional.hashes,
    record.integrity.hashes,
    profile.regionalBlockDistance
  ) : unsupported, watermark = request.fingerprints.watermark.algorithm === ALGORITHM_ID.WATERMARK_INTEGRITY_V2 && record.watermarkIntegrity.algorithm === ALGORITHM_ID.WATERMARK_INTEGRITY_V2 ? compareWatermarkIntegrityV2(
    record.watermarkIntegrity,
    request.fingerprints.watermark
  ) : request.fingerprints.watermark.algorithm === ALGORITHM_ID.WATERMARK_INTEGRITY_4X3 && record.watermarkIntegrity.algorithm === ALGORITHM_ID.WATERMARK_INTEGRITY_4X3 ? compareGrid(
    request.fingerprints.watermark.hashes,
    record.watermarkIntegrity.hashes,
    profile.watermarkBlockDistance
  ) : unsupported;
  const exactFile = request.file.sha256 === record.binding.sha256, dhashDistance = hammingDistance256(
    request.fingerprints.dhash.value,
    record.binding.dhash256
  ), phashDistance = hammingDistance256(
    request.fingerprints.phash.value,
    record.binding.phash256
  );
  const blind = request.blindMarker, declaredBlind = record.binding.blindBinding, declaredPresent = declaredBlind ? declaredBlind.status === "PRESENT" : record.binding.blindWatermarkEmbedded === true, declaredMarkerId = declaredBlind?.markerId || record.binding.blindMarkerId, declaredTicketDigest = declaredBlind?.ticketDigest || record.binding.blindEvidence?.ticketDigest, markerMatch = declaredPresent && blind.extracted && blind.crcValid && blind.confidence >= profile.blindConfidence && blind.markerId === declaredMarkerId && blind.ticketDigest === declaredTicketDigest;
  const markerMismatch = declaredPresent && blind.extracted && blind.crcValid && !markerMatch;
  const boundsValid = boundsCompatible(
    request.fingerprints.watermark.bounds,
    record.binding.watermarkRegion,
    profile.boundsTolerance
  );
  const contentChanged = modern ? regional.classification === "CHANGED" : regional.changedBlocks > profile.regionalChangedMaximum, watermarkChanged = !boundsValid || (modern ? watermark.classification === "CHANGED" : watermark.changedBlocks > profile.watermarkChangedMaximum), regionalAttribution = attributeRegionalChange({
    regional,
    watermarkChanged,
    storedWatermarkBounds: record.binding.watermarkRegion
  }), localUncertain = modern && (regional.classification === "UNCERTAIN" || watermark.classification === "UNCERTAIN" || regionalAttribution.attribution === REGIONAL_CHANGE_ATTRIBUTION.UNKNOWN), localUnsupported = !v3;
  const visualLinked = dhashDistance <= profile.dhashMaximum && phashDistance <= profile.phashMaximum;
  const regionalCount = regional.changedBlocks ?? regional.changedIndices?.length ?? 0, watermarkCount = watermark.changedBlocks ?? watermark.changedIndices?.length ?? 0, sourceLinked = markerMatch || visualLinked, score = (exactFile ? 1e4 : 0) + (markerMatch ? 5e3 : 0) + (signals.exact ? 1e3 : 0) + (signals.marker ? 500 : 0) + (signals.bandCount || 0) * 20 - Math.min(256, dhashDistance) - Math.min(256, phashDistance) - regionalCount * 50 - watermarkCount * 25;
  return {
    recordId: record.recordId,
    exactFile,
    markerMatch,
    markerMismatch,
    dhashDistance,
    phashDistance,
    regional,
    watermark,
    regionalAttribution,
    boundsValid,
    contentChanged,
    watermarkChanged,
    localUncertain,
    localUnsupported,
    visualLinked,
    sourceLinked,
    reencoded: !exactFile && sourceLinked,
    expired: record.expiresAt <= Date.now(),
    sourceType: sourceType(record),
    score
  };
};
var discoverVerificationCandidatesV2 = async ({
  repository,
  request,
  profile = VERIFICATION_THRESHOLD_PROFILE_V1
}) => {
  const signals = /* @__PURE__ */ new Map(), add = (id2, patch) => {
    if (id2)
      signals.set(id2, {
        ...signals.get(id2) || {
          recordId: id2,
          exact: false,
          marker: false,
          bandCount: 0,
          candidateSources: []
        },
        ...patch,
        candidateSources: [.../* @__PURE__ */ new Set([...signals.get(id2)?.candidateSources || [], ...patch.candidateSources || []])]
      });
  };
  const exact = await repository.findByFileSha256(request.file.sha256, {
    limit: profile.exactLimit
  });
  for (const x of exact.records || exact) add(x.recordId || x, { exact: true, candidateSources: ["EXACT"] });
  let markerResult = { records: [], conflict: false };
  if (request.blindMarker.extracted && request.blindMarker.crcValid) {
    markerResult = await repository.findByMarkerId(
      request.blindMarker.markerId,
      { limit: profile.markerLimit }
    );
    for (const x of markerResult.records || markerResult)
      add(x.recordId || x, { marker: true, candidateSources: ["BLIND"] });
  }
  const lookup = (hash2, algorithm) => repository.findVisualCandidates(hash2, {
    algorithm,
    perBandLimit: profile.perBandLimit,
    limit: profile.globalCandidateLimit
  });
  const indexedCandidateFound = (exact.records?.length || 0) > 0 || (markerResult.records?.length || 0) > 0 || markerResult.conflict;
  const [dhashVisual, phashVisual] = indexedCandidateFound ? [{ records: [], truncated: false, skipped: true }, { records: [], truncated: false, skipped: true }] : await Promise.all([
    lookup(request.fingerprints.dhash.value, "dhash256"),
    lookup(request.fingerprints.phash.value, "phash256")
  ]);
  for (const x of dhashVisual.records || dhashVisual) {
    const id2 = x.recordId || x;
    add(id2, {
      bandCount: Math.max(signals.get(id2)?.bandCount || 0, x.bandCount || 1),
      candidateSources: ["DHASH_LSH"]
    });
  }
  for (const x of phashVisual.records || phashVisual) {
    const id2 = x.recordId || x;
    add(id2, {
      bandCount: Math.max(signals.get(id2)?.bandCount || 0, x.bandCount || 1),
      candidateSources: ["PHASH_LSH"]
    });
  }
  if (request.recordHint?.recordId)
    add(request.recordHint.recordId, { hint: true });
  const truncated = Boolean(
    exact.truncated || markerResult.truncated || dhashVisual.truncated || phashVisual.truncated || signals.size > profile.globalCandidateLimit
  ), ids = [...signals.keys()].sort().slice(0, profile.globalCandidateLimit), retrievalDiagnostic = {
    retrievalVersion: "soft-retrieval-v2",
    exactCandidateCount: exact.records?.length || 0,
    dHashLshCandidateCount: (dhashVisual.records || dhashVisual).length,
    pHashLshCandidateCount: (phashVisual.records || phashVisual).length,
    unionCandidateCount: signals.size,
    dedupedCandidateCount: signals.size,
    candidateCapApplied: signals.size > profile.globalCandidateLimit,
    finalCandidateCount: ids.length,
    retrievalSources: [...new Set([...signals.values()].flatMap((signal) => signal.candidateSources || []))].sort()
  };
  console.info("[verify] CANDIDATE_RETRIEVAL_V2", {
    retrievalVersion: retrievalDiagnostic.retrievalVersion,
    exactCandidateCount: retrievalDiagnostic.exactCandidateCount,
    dHashLshCandidateCount: retrievalDiagnostic.dHashLshCandidateCount,
    pHashLshCandidateCount: retrievalDiagnostic.pHashLshCandidateCount,
    unionCandidateCount: retrievalDiagnostic.unionCandidateCount,
    dedupedCandidateCount: retrievalDiagnostic.dedupedCandidateCount,
    candidateCapApplied: retrievalDiagnostic.candidateCapApplied,
    finalCandidateCount: retrievalDiagnostic.finalCandidateCount
  });
  return { signals, exact, markerResult, visual: dhashVisual, dhashVisual, phashVisual, retrievalDiagnostic, truncated, ids };
};
var publicLocationDisplayLabel = (name) => {
  const value = String(name || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!value || /^[-+]?\d{1,3}(?:\.\d+)?\s*[,，]\s*[-+]?\d{1,3}(?:\.\d+)?$/.test(value)) return "\u4F4D\u7F6E\u540D\u79F0\u4E0D\u53EF\u7528";
  return value;
};
var publicRecord = (record) => record ? {
  recordId: record.recordId,
  recordTrustMode: record.finalTrustMode,
  trustPolicyVersion: record.trustPolicyVersion,
  sourceType: record.source?.type,
  captureTime: record.time?.captureCompletedAt,
  registrationTime: record.time?.serverReceivedAt,
  serverRecordedAt: record.time?.serverReceivedAt,
  expiresAt: record.expiresAt,
  coarsePublicLocation: {
    displayLabel: publicLocationDisplayLabel(record.location?.name),
    locationSource: record.location?.source || "none"
  },
  registrationStatus: "REGISTERED",
  templateContext: record.templateContext?.origin === "official" ? {
    origin: "official",
    templateId: record.templateContext.templateId,
    templateVersion: record.templateContext.templateVersion
  } : { origin: record.templateContext?.origin || "none" }
} : null;
var ProvenanceVerificationServiceV2 = class {
  constructor({
    repository,
    receiptKeys = [],
    now = () => Date.now(),
    subtle = globalThis.crypto?.subtle,
    profile = VERIFICATION_THRESHOLD_PROFILE_V1,
    watermarkEvidenceResolver = null
  }) {
    Object.assign(this, {
      repository,
      receiptKeys,
      now,
      subtle,
      profile,
      watermarkEvidenceResolver
    });
  }
  async verify(request) {
    const checked = validateVerificationRequestV2(request);
    if (!checked.valid) {
      const code = checked.issues.some((x) => x.code === "ALGORITHM_INVALID") ? "PROVENANCE_VERIFY_UNSUPPORTED_ALGORITHM" : "PROVENANCE_VERIFY_REQUEST_INVALID";
      throw Object.assign(new Error(code), {
        code,
        status: 400,
        details: checked.issues
      });
    }
    const { signals, exact, markerResult, truncated, ids } = await discoverVerificationCandidatesV2({
      repository: this.repository,
      request,
      profile: this.profile
    }), valid = [], corrupt = [];
    for (const id2 of ids) {
      const record = await this.repository.getRecordById(id2);
      if (!record) {
        corrupt.push({ recordId: id2, reason: "STALE_INDEX" });
        continue;
      }
      const stored = await validateStoredRecord(record, this.subtle), receipt = stored ? await validateReceipt({
        receipt: record.receipt,
        keys: this.receiptKeys,
        subtle: this.subtle
      }) : { valid: false, reason: "STORAGE_INTEGRITY" };
      if (!stored || !receipt.valid || record.receipt.recordId !== record.recordId || record.receipt.recordDigest !== record.recordDigest) {
        corrupt.push({
          recordId: id2,
          reason: stored ? receipt.reason : "STORAGE_INTEGRITY"
        });
        continue;
      }
      const watermark = this.watermarkEvidenceResolver?.(record);
      valid.push({
        record,
        evidence: evaluateCandidateEvidence(
          watermark ? {
            ...request,
            fingerprints: { ...request.fingerprints, watermark }
          } : request,
          record,
          signals.get(id2),
          this.profile
        )
      });
    }
    valid.sort(
      (a, b) => b.evidence.score - a.evidence.score || a.record.recordId.localeCompare(b.record.recordId)
    );
    const best = valid[0], second = valid[1], ambiguous = Boolean(
      best && second && best.evidence.score - second.evidence.score < this.profile.uniquenessGap && !best.evidence.markerMatch
    ), exactAmbiguous = Boolean(
      best && exact.records?.length > 1 && !best.evidence.markerMatch
    ), inconsistent = Boolean(
      best?.evidence.exactFile && (best.evidence.dhashDistance > this.profile.dhashMaximum || best.evidence.phashDistance > this.profile.phashMaximum || best.evidence.contentChanged || best.evidence.watermarkChanged)
    ), markerConflict = Boolean(
      markerResult.conflict || (markerResult.records?.length || 0) > 1
    );
    const userContentChanged = best?.evidence?.exactFile ? false : Boolean(best?.evidence?.contentChanged), userWatermarkChanged = best?.evidence?.exactFile ? false : Boolean(best?.evidence?.watermarkChanged), status = !best ? corrupt.length || truncated ? VERIFICATION_STATUS.INCONCLUSIVE : VERIFICATION_STATUS.UNREGISTERED : truncated || markerConflict || (best.evidence.localUncertain || best.evidence.localUnsupported) && !best.evidence.exactFile ? VERIFICATION_STATUS.INCONCLUSIVE : evaluateVerificationStatus({
      expired: best.record.expiresAt <= this.now(),
      exactFile: best.evidence.exactFile && !exactAmbiguous,
      markerMismatch: best.evidence.markerMismatch,
      ambiguous: ambiguous || exactAmbiguous,
      registered: true,
      contentChanged: userContentChanged,
      watermarkChanged: userWatermarkChanged,
      regionalChangeAttribution: best.evidence.regionalAttribution.attribution,
      sourceType: best.evidence.sourceType,
      sourceLinked: best.evidence.sourceLinked,
      reencoded: best.evidence.reencoded
    });
    const e = best?.evidence, bestSignals = best ? signals.get(best.record.recordId) : null, indexedMarkerCandidate = Boolean(bestSignals?.marker), nonDecisive = Boolean(
      (ambiguous || exactAmbiguous || truncated || markerConflict || (e?.localUncertain || e?.localUnsupported) && !e?.exactFile) && !e?.markerMatch && !(indexedMarkerCandidate && !exactAmbiguous)
    );
    return {
      ok: true,
      status,
      protocolVersion: 2,
      thresholdProfile: this.profile.id,
      matchedRecord: status === "UNREGISTERED" || !best || nonDecisive ? null : publicRecord(best.record),
      fileIntegrity: {
        exact: Boolean(valid.some((x) => x.evidence.exactFile)),
        consistent: !inconsistent
      },
      sourceProvenance: {
        linked: Boolean(e?.sourceLinked && !nonDecisive),
        relation: e?.markerMatch ? "marker" : e?.visualLinked ? "visual" : "none",
        ambiguous: ambiguous || exactAmbiguous
      },
      contentIntegrity: {
        classification: e?.regional.classification || "UNSUPPORTED",
        changed: userContentChanged,
        changedBlocks: e?.regional.changedIndices?.length ?? 0,
        totalBlocks: 16,
        supported: Boolean(e && !e.localUnsupported),
        rejected: Boolean(e?.localUnsupported),
        regionalChangeAttribution: e?.regionalAttribution?.attribution || REGIONAL_CHANGE_ATTRIBUTION.NOT_APPLICABLE,
        watermarkOverlappingChangedBlocks: e?.regionalAttribution?.watermarkOverlappingChangedBlocks || [],
        outsideWatermarkChangedBlocks: e?.regionalAttribution?.outsideWatermarkChangedBlocks || []
      },
      watermarkIntegrity: {
        classification: e?.watermark.classification || "UNSUPPORTED",
        changed: userWatermarkChanged,
        changedBlocks: e?.watermark.changedIndices?.length ?? 0,
        totalBlocks: 12,
        boundsValid: e?.boundsValid ?? false
      },
      captureEvidence: best?.record.finalTrustMode === "TRUSTED" && best?.record.trustPolicyVersion === "trusted-capture-v2" && best?.record.source?.type === "live-camera" ? {
        trusted: true,
        mode: "trusted",
        chain: "TRUSTED_CAPTURE_CHAIN",
        ticketKind: best.record.ticket?.kind || null,
        serverRecordedAt: best.record.time?.serverReceivedAt
      } : { trusted: false, mode: "normal", chain: null },
      confidence: {
        level: truncated || ambiguous || exactAmbiguous || e?.localUncertain || e?.localUnsupported ? "low" : e?.markerMatch || e?.exactFile ? "high" : e?.visualLinked ? "medium" : "low",
        dhashDistance: e?.dhashDistance ?? null,
        phashDistance: e?.phashDistance ?? null
      },
      candidateSet: { truncated, count: valid.length },
      diagnostics: inconsistent ? { codes: ["INTERNAL_EVIDENCE_INCONSISTENCY"] } : { codes: [] }
    };
  }
};
var createProvenanceVerificationHttpHandler = ({
  service,
  now = () => Date.now(),
  perMinute = 60,
  bodyLimit = 128 * 1024,
  clientKey = (request) => request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "anonymous"
}) => {
  const rates = /* @__PURE__ */ new Map();
  return async (request) => {
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    };
    if (new URL(request.url).pathname !== "/v2/provenance/verify" || request.method !== "POST")
      return Response.json(
        { ok: false, code: "NOT_FOUND" },
        { status: 404, headers }
      );
    try {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > bodyLimit)
        throw Object.assign(new Error(), {
          code: "PAYLOAD_TOO_LARGE",
          status: 413
        });
      const key = clientKey(request), time = now(), rate = rates.get(key);
      if (!rate || rate.resetAt <= time)
        rates.set(key, { count: 1, resetAt: time + 6e4 });
      else if (++rate.count > perMinute)
        return Response.json(
          { ok: false, code: "RATE_LIMITED" },
          {
            status: 429,
            headers: {
              ...headers,
              "Retry-After": String(Math.ceil((rate.resetAt - time) / 1e3))
            }
          }
        );
      const text = await request.text();
      if (utf8Bytes(text).length > bodyLimit)
        throw Object.assign(new Error(), {
          code: "PAYLOAD_TOO_LARGE",
          status: 413
        });
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw Object.assign(new Error(), {
          code: "PROVENANCE_VERIFY_REQUEST_INVALID",
          status: 400
        });
      }
      return Response.json(await service.verify(body), { headers });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code: error.code || "PROVENANCE_VERIFY_INTERNAL_ERROR",
          ...error.details ? { details: error.details } : {}
        },
        { status: error.status || 500, headers }
      );
    }
  };
};
var createEdgeProvenanceVerificationHandler = createProvenanceVerificationHttpHandler;
var createDockerProvenanceVerificationHandler = createProvenanceVerificationHttpHandler;
var createEsaProvenanceVerificationHandler = () => async () => Response.json(
  { ok: false, code: "PROVENANCE_STORAGE_NOT_CONFIGURED" },
  { status: 503, headers: { "Cache-Control": "no-store" } }
);

// packages/provenance-core/src/verification-exchange-v3.js
var VERIFICATION_EXCHANGE_VERSION = 3;
var MAX_PUBLIC_WATERMARK_CONTEXTS = 16;
var VERIFICATION_CONTEXT_PROFILE = Object.freeze({
  id: "public-watermark-context-v3",
  maxContexts: MAX_PUBLIC_WATERMARK_CONTEXTS
});
var fail3 = (code, status = 400, details) => Object.assign(new Error(code), { code, status, details });
var plain = (x) => x && typeof x === "object" && !Array.isArray(x);
var keys = (x, allowed) => plain(x) && Object.keys(x).every((k) => allowed.includes(k));
var bounds = (b) => keys(b, ["x", "y", "width", "height"]) && ["x", "y", "width", "height"].every((k) => Number.isFinite(b[k])) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= 1 && b.y + b.height <= 1;
var dummyWatermark = () => ({
  algorithm: "watermark-integrity-v2",
  grid: { columns: 4, rows: 3 },
  descriptorFormat: "int8-normalized-patch-8x8-base64url",
  blocks: Array.from({ length: 12 }, (_, index) => ({
    index,
    descriptor: "A".repeat(86)
  })),
  bounds: { x: 0, y: 0, width: 1, height: 1 }
});
var validateVerificationPrepareV3 = (request) => {
  if (!keys(request, [
    "verificationExchangeVersion",
    "file",
    "fingerprints",
    "blindMarker"
  ]) || request.verificationExchangeVersion !== 3 || !keys(request.fingerprints, ["dhash", "phash", "regional"]))
    return {
      valid: false,
      issues: [{ path: "", code: "PREPARE_SHAPE_INVALID" }]
    };
  const v2 = {
    protocolVersion: 2,
    file: request.file,
    fingerprints: { ...request.fingerprints, watermark: dummyWatermark() },
    blindMarker: request.blindMarker
  }, checked = validateVerificationRequestV2(v2);
  return checked.valid ? { valid: true, issues: [] } : { valid: false, issues: checked.issues };
};
var publicShape = (b) => ({
  algorithm: "watermark-integrity-v2",
  descriptorFormat: "int8-normalized-patch-8x8-base64url",
  grid: { columns: 4, rows: 3 },
  bounds: { x: b.x, y: b.y, width: b.width, height: b.height }
});
var canonicalContext = (x) => ({
  algorithm: x.algorithm,
  descriptorFormat: x.descriptorFormat,
  grid: x.grid,
  bounds: x.bounds
});
var publicWatermarkContext = async (b, subtle) => {
  const value = publicShape(b), digest = await digestCanonicalJson(value, subtle);
  return { contextId: `ctx_${digest.slice(0, 32)}`, ...value };
};
var contextSetDigest = (contexts, subtle) => digestCanonicalJson(
  {
    verificationExchangeVersion: 3,
    watermarkContexts: contexts.map((c) => ({
      contextId: c.contextId,
      ...canonicalContext(c)
    }))
  },
  subtle
);
var preparedEvidenceDigest = (request, subtle) => digestCanonicalJson(
  {
    verificationExchangeVersion: 3,
    file: request.file,
    fingerprints: request.fingerprints,
    blindMarker: request.blindMarker
  },
  subtle
);
var buildVerificationEvidencePreflightV3 = async ({
  fileBytes,
  rgba,
  width,
  height,
  blindMarker,
  subtle,
  onTiming,
  now = () => globalThis.performance?.now?.() || Date.now()
}) => {
  if (!(fileBytes instanceof Uint8Array) || !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4)
    throw fail3("EVIDENCE_BUILD_FAILED");
  const timed = async (name, work) => {
    const start = now(), value = await work();
    onTiming?.(name, now() - start);
    return value;
  }, sha256 = await timed("sha", () => sha256Bytes(fileBytes, subtle)), dhash = await timed("dhash", () => dhash256FromRgba(rgba, width, height)), phash = await timed("phash", () => phash256FromRgba(rgba, width, height)), regional = await timed(
    "regional",
    () => computeRegionalIntegrityV3(rgba, width, height)
  );
  return {
    verificationExchangeVersion: 3,
    file: { algorithm: "sha256-v1", sha256 },
    fingerprints: {
      dhash: { algorithm: "dhash256-v2", value: dhash },
      phash: { algorithm: "phash256-v1", value: phash },
      regional
    },
    blindMarker: {
      algorithm: blindMarker.algorithm,
      protocolVersion: blindMarker.protocolVersion,
      extracted: Boolean(blindMarker.extracted),
      markerId: blindMarker.markerId,
      ticketDigest: blindMarker.ticketDigest,
      flags: blindMarker.flags,
      crcValid: Boolean(blindMarker.crcValid),
      confidence: blindMarker.confidence
    }
  };
};
var buildWatermarkEvidenceContextsV3 = ({
  watermarkContexts,
  rgba,
  width,
  height
}) => (watermarkContexts || []).map((context) => ({
  ...context,
  fingerprint: {
    ...computeWatermarkIntegrityV2(rgba, width, height, context.bounds),
    bounds: context.bounds
  }
}));
var buildVerificationRequestV3 = async ({
  preparedEvidence,
  prepareResponse,
  watermarkEvidenceContexts,
  subtle
}) => ({
  verificationExchangeVersion: 3,
  preparedEvidence,
  preparedEvidenceDigest: await preparedEvidenceDigest(
    preparedEvidence,
    subtle
  ),
  contextSetDigest: prepareResponse.contextSetDigest,
  watermarkEvidenceContexts
});
var same = (a, b) => canonicalJson(a) === canonicalJson(b);
var contextKey = (x) => canonicalJson(canonicalContext(x));
var ProvenanceVerificationExchangeServiceV3 = class {
  constructor({
    repository,
    receiptKeys = [],
    subtle = globalThis.crypto?.subtle,
    profile = VERIFICATION_THRESHOLD_PROFILE_V1,
    maxContexts = MAX_PUBLIC_WATERMARK_CONTEXTS,
    now = () => Date.now()
  }) {
    Object.assign(this, {
      repository,
      receiptKeys,
      subtle,
      profile,
      maxContexts,
      now
    });
  }
  async authoritative(request) {
    const discovery = await discoverVerificationCandidatesV2({
      repository: this.repository,
      request: { ...request, protocolVersion: 2 },
      profile: this.profile
    });
    if (discovery.truncated) throw fail3("VERIFICATION_CONTEXT_INCOMPLETE", 409);
    const contexts = /* @__PURE__ */ new Map(), validRecords = [];
    for (const id2 of discovery.ids) {
      const record = await this.repository.getRecordById(id2);
      if (!record || !await validateStoredRecord(record, this.subtle))
        continue;
      const receipt = await validateReceipt({
        receipt: record.receipt,
        keys: this.receiptKeys,
        subtle: this.subtle
      });
      if (!receipt.valid || record.receipt.recordId !== record.recordId || record.receipt.recordDigest !== record.recordDigest)
        continue;
      const context = await publicWatermarkContext(
        record.binding.watermarkRegion,
        this.subtle
      );
      contexts.set(contextKey(context), context);
      validRecords.push(record);
    }
    const sorted = [...contexts.values()].sort(
      (a, b) => contextKey(a).localeCompare(contextKey(b))
    );
    if (sorted.length > this.maxContexts)
      throw fail3("VERIFICATION_CONTEXT_TOO_MANY", 409);
    return { discovery, contexts: sorted, validRecords };
  }
  async prepare(request) {
    const checked = validateVerificationPrepareV3(request);
    if (!checked.valid)
      throw fail3(
        "PROVENANCE_VERIFY_PREPARE_REQUEST_INVALID",
        400,
        checked.issues
      );
    const found = await this.authoritative(request), digest = await contextSetDigest(found.contexts, this.subtle);
    return {
      ok: true,
      verificationExchangeVersion: 3,
      state: "CONTEXT_READY",
      watermarkContexts: found.contexts,
      contextSetDigest: digest,
      preparedEvidenceDigest: await preparedEvidenceDigest(
        request,
        this.subtle
      )
    };
  }
  async verify(request) {
    if (!keys(request, [
      "verificationExchangeVersion",
      "preparedEvidence",
      "preparedEvidenceDigest",
      "contextSetDigest",
      "watermarkEvidenceContexts"
    ]) || request.verificationExchangeVersion !== 3 || !Array.isArray(request.watermarkEvidenceContexts) || request.watermarkEvidenceContexts.length > this.maxContexts)
      throw fail3("PROVENANCE_VERIFY_V3_REQUEST_INVALID");
    const checked = validateVerificationPrepareV3(request.preparedEvidence);
    if (!checked.valid)
      throw fail3("PROVENANCE_VERIFY_V3_REQUEST_INVALID", 400, checked.issues);
    if (await preparedEvidenceDigest(request.preparedEvidence, this.subtle) !== request.preparedEvidenceDigest)
      throw fail3("VERIFICATION_CONTEXT_MISMATCH", 409);
    const supplied = [];
    for (const item of request.watermarkEvidenceContexts) {
      if (!keys(item, [
        "contextId",
        "algorithm",
        "descriptorFormat",
        "grid",
        "bounds",
        "fingerprint"
      ]) || !/^ctx_[a-f0-9]{32}$/.test(String(item.contextId || "")) || !bounds(item.bounds))
        throw fail3("PROVENANCE_VERIFY_V3_REQUEST_INVALID");
      const probe = {
        protocolVersion: 2,
        file: request.preparedEvidence.file,
        fingerprints: {
          ...request.preparedEvidence.fingerprints,
          watermark: item.fingerprint
        },
        blindMarker: request.preparedEvidence.blindMarker
      }, valid = validateVerificationRequestV2(probe);
      if (!valid.valid || !same(item.bounds, item.fingerprint.bounds) || item.algorithm !== item.fingerprint.algorithm || item.descriptorFormat !== item.fingerprint.descriptorFormat || !same(item.grid, item.fingerprint.grid))
        throw fail3("PROVENANCE_VERIFY_V3_REQUEST_INVALID", 400, valid.issues);
      supplied.push({
        contextId: item.contextId,
        algorithm: item.algorithm,
        descriptorFormat: item.descriptorFormat,
        grid: item.grid,
        bounds: item.bounds,
        fingerprint: item.fingerprint
      });
    }
    supplied.sort((a, b) => contextKey(a).localeCompare(contextKey(b)));
    const found = await this.authoritative(request.preparedEvidence), authoritativeDigest = await contextSetDigest(found.contexts, this.subtle);
    if (authoritativeDigest !== request.contextSetDigest)
      throw fail3("VERIFICATION_CONTEXT_STALE", 409);
    const suppliedPublic = supplied.map(({ fingerprint, ...x }) => x);
    if (!same(suppliedPublic, found.contexts))
      throw fail3("VERIFICATION_CONTEXT_MISMATCH", 409);
    const byId = new Map(supplied.map((x) => [x.contextId, x.fingerprint])), base = byId.values().next().value || dummyWatermark(), service = new ProvenanceVerificationServiceV2({
      repository: this.repository,
      receiptKeys: this.receiptKeys,
      subtle: this.subtle,
      profile: this.profile,
      now: this.now,
      watermarkEvidenceResolver: (record) => byId.get(
        found.contexts.find(
          (x) => contextKey(x) === contextKey(publicShape(record.binding.watermarkRegion))
        )?.contextId
      )
    });
    return service.verify({
      protocolVersion: 2,
      file: request.preparedEvidence.file,
      fingerprints: {
        ...request.preparedEvidence.fingerprints,
        watermark: base
      },
      blindMarker: request.preparedEvidence.blindMarker
    });
  }
};
var createProvenanceVerificationExchangeHttpHandler = ({
  service,
  now = () => Date.now(),
  perMinute = 60,
  bodyLimit = 128 * 1024,
  clientKey = (r) => r.headers.get("cf-connecting-ip") || r.headers.get("x-forwarded-for")?.split(",")[0] || "anonymous"
}) => {
  const rates = /* @__PURE__ */ new Map();
  return async (request) => {
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }, path = new URL(request.url).pathname;
    if (request.method !== "POST" || !["/v3/provenance/verify/prepare", "/v3/provenance/verify"].includes(path))
      return Response.json(
        { ok: false, code: "NOT_FOUND" },
        { status: 404, headers }
      );
    try {
      const key = clientKey(request), time = now(), rate = rates.get(key);
      if (!rate || rate.resetAt <= time)
        rates.set(key, { count: 1, resetAt: time + 6e4 });
      else if (++rate.count > perMinute)
        return Response.json(
          { ok: false, code: "RATE_LIMITED" },
          {
            status: 429,
            headers: {
              ...headers,
              "Retry-After": String(Math.ceil((rate.resetAt - time) / 1e3))
            }
          }
        );
      const text = await request.text();
      if (utf8Bytes(text).length > bodyLimit)
        throw fail3("PAYLOAD_TOO_LARGE", 413);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw fail3("INVALID_JSON", 400);
      }
      const result = path.endsWith("/prepare") ? await service.prepare(body) : await service.verify(body);
      return Response.json(result, { headers });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code: error.code || "PROVENANCE_VERIFY_INTERNAL_ERROR",
          ...error.details ? { details: error.details } : {}
        },
        { status: error.status || 500, headers }
      );
    }
  };
};

// packages/provenance-core/src/orientation-v3.js
var normalizeExifOrientationRgba = (rgba, width, height, orientation = 1) => {
  if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4 || !Number.isInteger(width) || !Number.isInteger(height) || ![1, 2, 3, 4, 5, 6, 7, 8].includes(orientation)) throw new TypeError("IMAGE_ORIENTATION_INVALID");
  const swap = orientation >= 5, outWidth = swap ? height : width, outHeight = swap ? width : height, out = new Uint8ClampedArray(rgba.length), source = (x, y) => {
    switch (orientation) {
      case 1:
        return [x, y];
      case 2:
        return [width - 1 - x, y];
      case 3:
        return [width - 1 - x, height - 1 - y];
      case 4:
        return [x, height - 1 - y];
      case 5:
        return [y, x];
      case 6:
        return [y, height - 1 - x];
      case 7:
        return [width - 1 - y, height - 1 - x];
      case 8:
        return [width - 1 - y, x];
    }
  };
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const [sx, sy] = source(x, y), si = (sy * width + sx) * 4, di = (y * outWidth + x) * 4;
    out.set(rgba.subarray(si, si + 4), di);
  }
  return { rgba: out, width: outWidth, height: outHeight, orientationApplied: orientation };
};
var readJpegExifOrientation = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 255) break;
    const marker2 = bytes[offset + 1], length = view.getUint16(offset + 2, false);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker2 === 225 && length >= 16 && String.fromCharCode(...bytes.subarray(offset + 4, offset + 10)) === "Exif\0\0") {
      const tiff = offset + 10, little = view.getUint16(tiff, false) === 18761;
      if (!little && view.getUint16(tiff, false) !== 19789) return 1;
      const get16 = (p) => view.getUint16(p, little), get32 = (p) => view.getUint32(p, little), ifd = tiff + get32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const count = get16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) break;
        if (get16(entry) === 274) {
          const value = get16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    if (marker2 === 218 || marker2 === 217) break;
    offset += 2 + length;
  }
  return 1;
};
var readJpegDimensions = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), sof = /* @__PURE__ */ new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 255) return null;
    const marker2 = bytes[offset + 1], length = view.getUint16(offset + 2, false);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (sof.has(marker2) && length >= 7) return { width: view.getUint16(offset + 7, false), height: view.getUint16(offset + 5, false) };
    if (marker2 === 218 || marker2 === 217) return null;
    offset += 2 + length;
  }
  return null;
};

// packages/provenance-core/src/verification-client-v3.js
var VERIFICATION_CLIENT_LIMITS_V1 = Object.freeze({
  maxFileBytes: 25 * 1024 * 1024,
  maxWidth: 12e3,
  maxHeight: 12e3,
  maxDecodedPixels: 4e7,
  maxApproximateMemoryBytes: 192 * 1024 * 1024
});
var VERIFICATION_CLIENT_ERROR = Object.freeze({
  FILE_READ_FAILED: "FILE_READ_FAILED",
  UNSUPPORTED_IMAGE_FORMAT: "UNSUPPORTED_IMAGE_FORMAT",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  IMAGE_DECODE_FAILED: "IMAGE_DECODE_FAILED",
  EVIDENCE_BUILD_FAILED: "EVIDENCE_BUILD_FAILED",
  VERIFY_PREPARE_FAILED: "VERIFY_PREPARE_FAILED",
  CONTEXT_STALE: "VERIFICATION_CONTEXT_STALE",
  CONTEXT_INCOMPLETE: "VERIFICATION_CONTEXT_INCOMPLETE",
  CONTEXT_TOO_MANY: "VERIFICATION_CONTEXT_TOO_MANY",
  CONTEXT_EXPIRED: "VERIFICATION_CONTEXT_EXPIRED",
  CONTEXT_MISMATCH: "VERIFICATION_CONTEXT_MISMATCH",
  NETWORK: "VERIFY_NETWORK_ERROR",
  RATE_LIMITED: "VERIFY_RATE_LIMITED",
  REQUEST_TOO_LARGE: "VERIFY_REQUEST_TOO_LARGE",
  SERVER: "VERIFY_SERVER_ERROR",
  PROTOCOL: "VERIFY_PROTOCOL_ERROR"
});
var protocolCodes = /* @__PURE__ */ new Set([
  "VERIFICATION_CONTEXT_STALE",
  "VERIFICATION_CONTEXT_INCOMPLETE",
  "VERIFICATION_CONTEXT_TOO_MANY",
  "VERIFICATION_CONTEXT_EXPIRED",
  "VERIFICATION_CONTEXT_MISMATCH"
]);
var fail4 = (code, details) => Object.assign(new Error(code), { code, details });
var detectVerificationImageFormat = (bytes) => bytes instanceof Uint8Array && bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : null;
var mapVerificationClientError = (error) => {
  if (error?.clientError) return error;
  const code = String(error?.code || ""), status = Number(error?.status || 0);
  let mapped = protocolCodes.has(code) ? code : status === 413 ? "VERIFY_REQUEST_TOO_LARGE" : status === 429 ? "VERIFY_RATE_LIMITED" : status >= 500 ? "VERIFY_SERVER_ERROR" : error?.network ? "VERIFY_NETWORK_ERROR" : status === 400 || status === 409 ? "VERIFY_PROTOCOL_ERROR" : code || "VERIFY_PROTOCOL_ERROR";
  return Object.assign(new Error(mapped), {
    code: mapped,
    protocolCode: code || null,
    httpStatus: status || null,
    retryable: [
      "VERIFICATION_CONTEXT_STALE",
      "VERIFY_NETWORK_ERROR",
      "VERIFY_RATE_LIMITED",
      "VERIFY_SERVER_ERROR"
    ].includes(mapped),
    clientError: true
  });
};
var VERIFICATION_STATUS_PRESENTATION = Object.freeze({
  EXACT_FILE: {
    tone: "positive",
    overallLabel: "\u6587\u4EF6\u5B8C\u5168\u4E00\u81F4",
    title: "\u6587\u4EF6\u5B8C\u5168\u4E00\u81F4",
    description: "\u5F53\u524D\u6587\u4EF6\u4E0E\u767B\u8BB0\u6587\u4EF6\u5B57\u8282\u4E00\u81F4\uFF0C\u5E76\u5DF2\u5173\u8054\u5BF9\u5E94\u767B\u8BB0\u8BB0\u5F55\u3002"
  },
  SOURCE_VERIFIED: {
    tone: "positive",
    overallLabel: "\u6765\u6E90\u5DF2\u786E\u8BA4",
    title: "\u627E\u5230\u8FF9\u5F55\u6765\u6E90\u8BB0\u5F55",
    description: "\u5F53\u524D\u8BC1\u636E\u4E0E\u4E00\u6761\u8FF9\u5F55\u767B\u8BB0\u8BB0\u5F55\u5173\u8054\u3002"
  },
  SOURCE_VERIFIED_REENCODED: {
    tone: "informational",
    overallLabel: "\u6765\u6E90\u5DF2\u786E\u8BA4",
    title: "\u627E\u5230\u6765\u6E90\u8BB0\u5F55\uFF0C\u6587\u4EF6\u5DF2\u91CD\u7F16\u7801",
    description: "\u627E\u5230\u6765\u6E90\u8BB0\u5F55\uFF1B\u5F53\u524D\u7B97\u6CD5\u672A\u786E\u8BA4\u9700\u8981\u6807\u8BB0\u7684\u5185\u5BB9\u6216\u6C34\u5370\u53D8\u5316\u3002"
  },
  ALBUM_WATERMARKED: {
    tone: "informational",
    overallLabel: "\u6765\u6E90\u5DF2\u786E\u8BA4",
    title: "\u76F8\u518C\u52A0\u6C34\u5370\u6765\u6E90",
    description: "\u8BE5\u6587\u4EF6\u5173\u8054\u5230\u76F8\u518C\u52A0\u6C34\u5370\u767B\u8BB0\uFF0C\u4E0D\u4EE3\u8868\u73B0\u573A\u62CD\u6444\u94FE\u8DEF\u3002"
  },
  CONTENT_CHANGED: {
    tone: "warning",
    overallLabel: "\u68C0\u6D4B\u5230\u5185\u5BB9\u53D8\u5316",
    title: "\u68C0\u6D4B\u5230\u5185\u5BB9\u5B8C\u6574\u6027\u53D8\u5316",
    description: "\u5F53\u524D\u5185\u5BB9\u8BC1\u636E\u4E0E\u767B\u8BB0\u8BB0\u5F55\u4E0D\u4E00\u81F4\u3002"
  },
  WATERMARK_CHANGED: {
    tone: "warning",
    overallLabel: "\u68C0\u6D4B\u5230\u6C34\u5370\u53D8\u5316",
    title: "\u68C0\u6D4B\u5230\u6C34\u5370\u5B8C\u6574\u6027\u53D8\u5316",
    description: "\u5F53\u524D\u6C34\u5370\u533A\u57DF\u8BC1\u636E\u4E0E\u767B\u8BB0\u8BB0\u5F55\u4E0D\u4E00\u81F4\u3002"
  },
  SOFT_MATCH_AMBIGUOUS: {
    tone: "warning",
    overallLabel: "\u8BC1\u636E\u4E0D\u8DB3",
    title: "\u5B58\u5728\u591A\u4E2A\u53EF\u80FD\u6765\u6E90",
    description: "\u5F53\u524D\u8BC1\u636E\u65E0\u6CD5\u552F\u4E00\u5173\u8054\u5230\u4E00\u6761\u767B\u8BB0\u8BB0\u5F55\u3002"
  },
  BLIND_MARKER_MISMATCH: {
    tone: "warning",
    overallLabel: "\u6807\u8BB0\u5173\u7CFB\u5F02\u5E38",
    title: "\u76F2\u6807\u8BB0\u4E0E\u6765\u6E90\u4E0D\u4E00\u81F4",
    description: "\u63D0\u53D6\u7684\u76F2\u6807\u8BB0\u4E0E\u5019\u9009\u767B\u8BB0\u8BB0\u5F55\u4E0D\u4E00\u81F4\u3002"
  },
  UNREGISTERED: {
    tone: "neutral",
    overallLabel: "\u672A\u627E\u5230\u767B\u8BB0\u8BB0\u5F55",
    title: "\u672A\u53D1\u73B0\u53EF\u7528\u767B\u8BB0\u8BB0\u5F55",
    description: "\u670D\u52A1\u7AEF\u5F53\u524D\u672A\u53D1\u73B0\u4E0E\u8BE5\u6587\u4EF6\u8BC1\u636E\u5339\u914D\u7684\u767B\u8BB0\u8BB0\u5F55\u3002"
  },
  EXPIRED: {
    tone: "neutral",
    overallLabel: "\u767B\u8BB0\u8BB0\u5F55\u5DF2\u8FC7\u671F",
    title: "\u767B\u8BB0\u8BB0\u5F55\u5DF2\u8FC7\u671F",
    description: "\u5173\u8054\u767B\u8BB0\u8BB0\u5F55\u5DF2\u8D85\u8FC7\u6709\u6548\u671F\u3002"
  },
  INCONCLUSIVE: {
    tone: "neutral",
    overallLabel: "\u8BC1\u636E\u4E0D\u8DB3",
    title: "\u5F53\u524D\u8BC1\u636E\u4E0D\u8DB3\u4EE5\u5F97\u51FA\u7ED3\u8BBA",
    description: "\u5F53\u524D\u7B97\u6CD5\u65E0\u6CD5\u5F62\u6210\u66F4\u660E\u786E\u7684\u767B\u8BB0\u5173\u7CFB\u6216\u5B8C\u6574\u6027\u7ED3\u8BBA\u3002"
  }
});
var dimension = (state, label, description) => ({ state, label, description });
var dimensionState = (value, positive, negative) => value === true ? positive : value === false ? negative : "UNKNOWN";
var stateLabel = Object.freeze({ EXACT: "\u5B8C\u5168\u4E00\u81F4", NON_EXACT: "\u6587\u4EF6\u5DF2\u53D8\u5316", LINKED: "\u5DF2\u5173\u8054\u8BB0\u5F55", NOT_FOUND: "\u672A\u5173\u8054\u8BB0\u5F55", CHANGED: "\u68C0\u6D4B\u5230\u53D8\u5316", UNCHANGED: "\u672A\u53D1\u73B0\u53D8\u5316", TRUSTED: "\u53EF\u4FE1\u62CD\u6444\u94FE\u8DEF", TRUSTED_LINKED: "\u5173\u8054\u53EF\u4FE1\u62CD\u6444\u8BB0\u5F55", NOT_TRUSTED: "\u666E\u901A\u6765\u6E90\u94FE\u8DEF", UNKNOWN: "\u8BC1\u636E\u4E0D\u8DB3" });
var localTime = (value) => {
  const time = Number(value), date = new Date(time);
  if (!Number.isFinite(time) || Number.isNaN(date.getTime())) return "\u672A\u8BB0\u5F55";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
var locationSourceLabel = (source) => ({ "device-gps": "\u8BBE\u5907\u5B9A\u4F4D", "map-selection": "\u5730\u56FE\u9009\u62E9", manual: "\u624B\u52A8\u586B\u5199", none: "\u672A\u8BB0\u5F55" })[source] || "\u672A\u8BB0\u5F55";
var locationSourceDescription = (source) => ({ "device-gps": "\u4F4D\u7F6E\u6765\u81EA\u62CD\u6444\u8BBE\u5907\u5B9A\u4F4D\u80FD\u529B\u3002", "map-selection": "\u4F4D\u7F6E\u7531\u62CD\u6444\u65F6\u5730\u56FE\u9009\u62E9\u786E\u5B9A\u3002", manual: "\u4F4D\u7F6E\u7531\u62CD\u6444\u8005\u624B\u52A8\u586B\u5199\u3002", none: "\u672C\u6B21\u767B\u8BB0\u6CA1\u6709\u8BB0\u5F55\u4F4D\u7F6E\u6765\u6E90\u3002" })[source] || "\u672C\u6B21\u767B\u8BB0\u6CA1\u6709\u8BB0\u5F55\u4F4D\u7F6E\u6765\u6E90\u3002";
var locationValueDescription = (source) => ({ "device-gps": "\u767B\u8BB0\u62CD\u6444\u65F6\u8BBE\u5907\u5B9A\u4F4D\u89E3\u6790\u5F97\u5230\u7684\u4F4D\u7F6E\u3002", "map-selection": "\u767B\u8BB0\u62CD\u6444\u65F6\u901A\u8FC7\u5730\u56FE\u9009\u62E9\u8BB0\u5F55\u7684\u4F4D\u7F6E\u3002", manual: "\u767B\u8BB0\u62CD\u6444\u65F6\u7531\u62CD\u6444\u8005\u624B\u52A8\u586B\u5199\u7684\u4F4D\u7F6E\u3002", none: "\u672C\u6B21\u767B\u8BB0\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u4F4D\u7F6E\u540D\u79F0\u3002" })[source] || "\u672C\u6B21\u767B\u8BB0\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u4F4D\u7F6E\u540D\u79F0\u3002";
var VERIFICATION_ERROR_PRESENTATION = Object.freeze({
  UNSUPPORTED_IMAGE_FORMAT: { tone: "neutral", title: "\u6682\u4E0D\u652F\u6301\u8FD9\u79CD\u56FE\u7247\u683C\u5F0F", description: "\u5F53\u524D\u7248\u672C\u7167\u7247\u9A8C\u771F\u652F\u6301 JPEG/JPG \u683C\u5F0F\u3002" },
  IMAGE_TOO_LARGE: { tone: "neutral", title: "\u7167\u7247\u5C3A\u5BF8\u8FC7\u5927", description: "\u8BF7\u9009\u62E9\u4E0D\u8D85\u8FC7 25 MiB\u3001\u6700\u957F\u8FB9\u4E0D\u8D85\u8FC7 12000 \u50CF\u7D20\u4E14\u4E0D\u8D85\u8FC7 4000 \u4E07\u50CF\u7D20\u7684 JPEG\u3002" },
  FILE_READ_FAILED: { tone: "warning", title: "\u65E0\u6CD5\u8BFB\u53D6\u7167\u7247", description: "\u8BF7\u91CD\u65B0\u9009\u62E9\u7167\u7247\u5E76\u5141\u8BB8\u5E94\u7528\u8BFB\u53D6\u8BE5\u6587\u4EF6\u3002" },
  IMAGE_DECODE_FAILED: { tone: "warning", title: "\u65E0\u6CD5\u89E3\u6790\u7167\u7247", description: "\u8BE5 JPEG \u53EF\u80FD\u5DF2\u635F\u574F\uFF0C\u8BF7\u5C1D\u8BD5\u539F\u59CB\u6587\u4EF6\u3002" },
  VERIFY_NETWORK_ERROR: { tone: "neutral", title: "\u7F51\u7EDC\u6682\u65F6\u4E0D\u53EF\u7528", description: "\u672C\u5730\u5206\u6790\u53EF\u80FD\u5DF2\u7ECF\u5B8C\u6210\uFF0C\u4F46\u5C1A\u672A\u53D6\u5F97\u670D\u52A1\u5668\u9A8C\u771F\u7ED3\u679C\u3002" },
  VERIFY_RATE_LIMITED: { tone: "neutral", title: "\u8BF7\u6C42\u8F83\u9891\u7E41", description: "\u8BF7\u6C42\u8F83\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002" },
  VERIFY_REQUEST_TOO_LARGE: { tone: "neutral", title: "\u9A8C\u771F\u8BF7\u6C42\u8FC7\u5927", description: "\u5F53\u524D\u6D3E\u751F\u8BC1\u636E\u8D85\u51FA\u670D\u52A1\u9650\u5236\uFF0C\u8BF7\u5C1D\u8BD5\u53E6\u4E00\u5F20\u7167\u7247\u3002" },
  VERIFY_SERVER_ERROR: { tone: "neutral", title: "\u9A8C\u771F\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528", description: "\u8FD9\u4E0D\u4EE3\u8868\u7167\u7247\u5B58\u5728\u95EE\u9898\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002" },
  VERIFICATION_CONTEXT_INCOMPLETE: { tone: "neutral", title: "\u6682\u65F6\u65E0\u6CD5\u53EF\u9760\u5224\u65AD", description: "\u5F53\u524D\u6765\u6E90\u5019\u9009\u8FC7\u591A\u6216\u68C0\u7D22\u72B6\u6001\u4E0D\u8DB3\uFF0C\u6682\u65F6\u65E0\u6CD5\u5B8C\u6210\u53EF\u9760\u5224\u65AD\u3002" },
  VERIFICATION_CONTEXT_TOO_MANY: { tone: "neutral", title: "\u73B0\u6709\u8BC1\u636E\u4E0D\u8DB3", description: "\u5F53\u524D\u6765\u6E90\u5019\u9009\u8FC7\u591A\uFF0C\u6682\u65F6\u65E0\u6CD5\u7ED9\u51FA\u66F4\u660E\u786E\u7684\u5224\u65AD\u3002" },
  VERIFICATION_CONTEXT_STALE: { tone: "neutral", title: "\u9A8C\u771F\u4E0A\u4E0B\u6587\u5DF2\u53D8\u5316", description: "\u9A8C\u771F\u4E0A\u4E0B\u6587\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u7A0D\u540E\u91CD\u65B0\u5C1D\u8BD5\u3002" },
  VERIFICATION_CONTEXT_EXPIRED: { tone: "neutral", title: "\u9A8C\u771F\u4E0A\u4E0B\u6587\u5DF2\u8FC7\u671F", description: "\u8BF7\u91CD\u65B0\u5F00\u59CB\u672C\u6B21\u7167\u7247\u9A8C\u771F\u3002" },
  VERIFICATION_CONTEXT_MISMATCH: { tone: "neutral", title: "\u9A8C\u771F\u4E0A\u4E0B\u6587\u4E0D\u4E00\u81F4", description: "\u5F53\u524D\u65E0\u6CD5\u5B89\u5168\u5B8C\u6210\u5224\u65AD\uFF0C\u8BF7\u91CD\u65B0\u5F00\u59CB\u9A8C\u771F\u3002" },
  EVIDENCE_BUILD_FAILED: { tone: "warning", title: "\u65E0\u6CD5\u751F\u6210\u9A8C\u771F\u8BC1\u636E", description: "\u8BF7\u5C1D\u8BD5\u539F\u59CB JPEG \u6587\u4EF6\u3002" },
  VERIFY_PROTOCOL_ERROR: { tone: "neutral", title: "\u6682\u65F6\u65E0\u6CD5\u5B8C\u6210\u9A8C\u771F", description: "\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u7ED3\u679C\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002" },
  IMMEDIATE_VERIFY_FILE_MISMATCH: { tone: "warning", title: "\u5F53\u524D\u6587\u4EF6\u4E0E\u767B\u8BB0\u6587\u4EF6\u4E0D\u4E00\u81F4", description: "\u65E0\u6CD5\u786E\u8BA4\u5F53\u524D\u6587\u4EF6\u4ECD\u662F\u521A\u521A\u767B\u8BB0\u7684\u6700\u7EC8\u7167\u7247\uFF0C\u8BF7\u8FD4\u56DE\u91CD\u65B0\u62CD\u6444\u3002" }
});
var getVerificationErrorPresentation = (code) => VERIFICATION_ERROR_PRESENTATION[code] || VERIFICATION_ERROR_PRESENTATION.VERIFY_PROTOCOL_ERROR;
var buildVerificationResultModel = (serverResult, { localRegistrationState = null } = {}) => {
  const status = serverResult?.status;
  if (!VERIFICATION_STATUS_PRESENTATION[status])
    throw fail4("VERIFY_PROTOCOL_ERROR");
  const fileIntegrity = serverResult.fileIntegrity || { exact: status === VERIFICATION_STATUS.EXACT_FILE };
  const sourceProvenance = serverResult.sourceProvenance || { linked: ["EXACT_FILE", "SOURCE_VERIFIED", "SOURCE_VERIFIED_REENCODED", "ALBUM_WATERMARKED"].includes(status) };
  const contentIntegrity = serverResult.contentIntegrity || { changed: status === VERIFICATION_STATUS.CONTENT_CHANGED };
  const watermarkIntegrity = serverResult.watermarkIntegrity || { changed: status === VERIFICATION_STATUS.WATERMARK_CHANGED };
  const captureEvidence = serverResult.captureEvidence || { trusted: false };
  const fileState = dimensionState(fileIntegrity.exact, "EXACT", "NON_EXACT");
  const sourceState = dimensionState(sourceProvenance.linked, "LINKED", "NOT_FOUND");
  const contentState = dimensionState(contentIntegrity.changed, "CHANGED", "UNCHANGED");
  const watermarkState = dimensionState(watermarkIntegrity.changed, "CHANGED", "UNCHANGED");
  const captureState = captureEvidence.trusted && fileState === "NON_EXACT" ? "TRUSTED_LINKED" : dimensionState(captureEvidence.trusted, "TRUSTED", "NOT_TRUSTED");
  const matched = serverResult.matchedRecord;
  const trustedRecord = matched?.recordTrustMode === "TRUSTED" && matched?.trustPolicyVersion === "trusted-capture-v2" && matched?.sourceType === "live-camera";
  const locationSource = matched?.coarsePublicLocation?.locationSource || "none";
  const registeredInfo = matched ? {
    captureTime: localTime(matched.captureTime),
    captureTimeDescription: "\u7167\u7247\u5B8C\u6210\u62CD\u6444\u5E76\u751F\u6210\u6700\u7EC8\u6587\u4EF6\u7684\u65F6\u95F4\u3002",
    registrationTime: localTime(matched.registrationTime || matched.serverRecordedAt),
    registrationTimeDescription: "\u8BE5\u7167\u7247\u5B8C\u6210\u8FF9\u5F55\u76F8\u673A\u767B\u8BB0\u7684\u65F6\u95F4\u3002",
    locationLabel: matched.coarsePublicLocation?.displayLabel || "\u4F4D\u7F6E\u540D\u79F0\u4E0D\u53EF\u7528",
    locationDescription: locationValueDescription(locationSource),
    locationSource: locationSourceLabel(locationSource),
    locationSourceDescription: locationSourceDescription(locationSource),
    recordType: trustedRecord ? "\u53EF\u4FE1\u62CD\u6444\u94FE\u8DEF" : "\u666E\u901A\u6765\u6E90\u8BB0\u5F55",
    recordTypeDescription: trustedRecord ? "\u7167\u7247\u7531\u5B9E\u65F6\u62CD\u6444\u53CA\u53EF\u4FE1\u767B\u8BB0\u94FE\u8DEF\u751F\u6210\u3002" : "\u5F53\u524D\u767B\u8BB0\u5C5E\u4E8E\u666E\u901A\u6765\u6E90\u8BB0\u5F55\u3002",
    registrationStatus: matched.registrationStatus === "REGISTERED" ? "\u5DF2\u767B\u8BB0" : "\u672A\u786E\u8BA4",
    registrationStatusDescription: matched.registrationStatus === "REGISTERED" ? "\u5DF2\u627E\u5230\u5BF9\u5E94\u7684\u8FF9\u5F55\u76F8\u673A\u767B\u8BB0\u8BB0\u5F55\u3002" : "\u5F53\u524D\u767B\u8BB0\u72B6\u6001\u5C1A\u672A\u786E\u8BA4\u3002"
  } : null;
  return {
    status,
    presentation: VERIFICATION_STATUS_PRESENTATION[status],
    fileIntegrity,
    sourceProvenance,
    contentIntegrity,
    watermarkIntegrity,
    captureEvidence,
    registeredInfo,
    localRegistrationState,
    dimensions: [
      dimension(stateLabel[fileState], "\u6587\u4EF6\u4E00\u81F4\u6027", fileState === "EXACT" ? "\u5F53\u524D\u6587\u4EF6\u5B57\u8282\u4E0E\u767B\u8BB0\u65F6\u7684\u6700\u7EC8\u6587\u4EF6\u5B8C\u5168\u4E00\u81F4\u3002" : fileState === "NON_EXACT" ? "\u5F53\u524D\u6587\u4EF6\u5B57\u8282\u4E0E\u767B\u8BB0\u6587\u4EF6\u4E0D\u540C\u3002" : "\u73B0\u6709\u8BC1\u636E\u4E0D\u8DB3\u4EE5\u5224\u65AD\u6587\u4EF6\u5B57\u8282\u4E00\u81F4\u6027\u3002"),
      dimension(stateLabel[sourceState], "\u6765\u6E90\u8BB0\u5F55", sourceState === "LINKED" ? "\u5DF2\u627E\u5230\u4E0E\u5F53\u524D\u7167\u7247\u5BF9\u5E94\u7684\u8FF9\u5F55\u76F8\u673A\u767B\u8BB0\u8BB0\u5F55\u3002" : sourceState === "NOT_FOUND" ? "\u5F53\u524D\u672A\u627E\u5230\u53EF\u786E\u8BA4\u5173\u8054\u7684\u767B\u8BB0\u8BB0\u5F55\u3002" : "\u73B0\u6709\u8BC1\u636E\u4E0D\u8DB3\u4EE5\u786E\u8BA4\u6765\u6E90\u8BB0\u5F55\u3002"),
      dimension(stateLabel[contentState], "\u5185\u5BB9\u5B8C\u6574\u6027", contentState === "CHANGED" ? "\u68C0\u6D4B\u5230\u4E3B\u4F53\u5185\u5BB9\u533A\u57DF\u5B58\u5728\u9700\u8981\u5173\u6CE8\u7684\u53D8\u5316\u3002" : contentState === "UNCHANGED" ? "\u672A\u68C0\u6D4B\u5230\u9700\u8981\u6807\u8BB0\u7684\u4E3B\u4F53\u5185\u5BB9\u53D8\u5316\u3002" : "\u73B0\u6709\u8BC1\u636E\u4E0D\u8DB3\u4EE5\u5224\u65AD\u5185\u5BB9\u5B8C\u6574\u6027\u3002"),
      dimension(stateLabel[watermarkState], "\u6C34\u5370\u5B8C\u6574\u6027", watermarkState === "CHANGED" ? "\u68C0\u6D4B\u5230\u53EF\u89C1\u6C34\u5370\u533A\u57DF\u5B58\u5728\u53D8\u5316\u3002" : watermarkState === "UNCHANGED" ? "\u672A\u68C0\u6D4B\u5230\u767B\u8BB0\u6C34\u5370\u533A\u57DF\u53D1\u751F\u9700\u8981\u6807\u8BB0\u7684\u53D8\u5316\u3002" : "\u73B0\u6709\u8BC1\u636E\u4E0D\u8DB3\u4EE5\u5224\u65AD\u6C34\u5370\u5B8C\u6574\u6027\u3002"),
      dimension(stateLabel[captureState], "\u62CD\u6444\u8BC1\u636E", captureState === "TRUSTED" ? "\u8BE5\u767B\u8BB0\u8BB0\u5F55\u7531\u5B9E\u65F6\u62CD\u6444\u53CA\u53EF\u4FE1\u767B\u8BB0\u94FE\u8DEF\u751F\u6210\u3002" : captureState === "TRUSTED_LINKED" ? "\u5F53\u524D\u6587\u4EF6\u5173\u8054\u7684\u767B\u8BB0\u8BB0\u5F55\u6765\u81EA\u53EF\u4FE1\u62CD\u6444\u94FE\u8DEF\u3002" : captureState === "NOT_TRUSTED" ? "\u5F53\u524D\u767B\u8BB0\u5C5E\u4E8E\u666E\u901A\u6765\u6E90\u8BB0\u5F55\u3002" : "\u5F53\u524D\u8BB0\u5F55\u6CA1\u6709\u8DB3\u591F\u7684\u53EF\u4FE1\u62CD\u6444\u94FE\u8DEF\u8BC1\u636E\u3002")
    ],
    serverResult
  };
};
var VerificationEvidencePreflightPipeline = class {
  constructor({ platform, limits = VERIFICATION_CLIENT_LIMITS_V1, subtle }) {
    Object.assign(this, { platform, limits, subtle });
  }
  async build(selected) {
    const clock = () => globalThis.performance?.now?.() || Date.now(), timings = {};
    let started = clock();
    let read;
    try {
      read = await this.platform.readFile(selected);
    } catch (error) {
      throw fail4("FILE_READ_FAILED", { cause: error });
    }
    timings.fileReadMs = clock() - started;
    const fileBytes = read instanceof Uint8Array ? read : read?.bytes;
    if (!(fileBytes instanceof Uint8Array)) throw fail4("FILE_READ_FAILED");
    if (fileBytes.byteLength > this.limits.maxFileBytes)
      throw fail4("IMAGE_TOO_LARGE", {
        stage: "file",
        bytes: fileBytes.byteLength
      });
    const format = detectVerificationImageFormat(fileBytes);
    if (format !== "image/jpeg") throw fail4("UNSUPPORTED_IMAGE_FORMAT");
    const encodedDimensions = readJpegDimensions(fileBytes);
    if (encodedDimensions && (encodedDimensions.width > this.limits.maxWidth || encodedDimensions.height > this.limits.maxHeight || encodedDimensions.width * encodedDimensions.height > this.limits.maxDecodedPixels || encodedDimensions.width * encodedDimensions.height * 8 + fileBytes.byteLength > this.limits.maxApproximateMemoryBytes)) throw fail4("IMAGE_TOO_LARGE", { stage: "encoded-header", ...encodedDimensions });
    let decoded;
    started = clock();
    try {
      decoded = await this.platform.decodeImage({
        selected,
        fileBytes,
        format
      });
    } catch (error) {
      throw fail4("IMAGE_DECODE_FAILED", { cause: error });
    }
    const { rgba, width, height } = decoded || {};
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4)
      throw fail4("IMAGE_DECODE_FAILED");
    const pixels = width * height, estimated = fileBytes.byteLength + rgba.byteLength * 2;
    if (width > this.limits.maxWidth || height > this.limits.maxHeight || pixels > this.limits.maxDecodedPixels || estimated > this.limits.maxApproximateMemoryBytes)
      throw fail4("IMAGE_TOO_LARGE", {
        stage: "decoded",
        width,
        height,
        pixels,
        estimated
      });
    const normalized = decoded.displayOrientationApplied ? { rgba, width, height, orientationApplied: decoded.orientation || 1 } : normalizeExifOrientationRgba(
      rgba,
      width,
      height,
      decoded.orientation || 1
    );
    timings.decodeOrientationMs = clock() - started;
    let blindMarker;
    started = clock();
    try {
      blindMarker = await this.platform.extractBlindMarker({
        fileBytes,
        rgba: normalized.rgba,
        width: normalized.width,
        height: normalized.height,
        format
      });
    } catch {
      blindMarker = null;
    }
    blindMarker = blindMarker || {
      algorithm: "jilu-blind-v2",
      protocolVersion: 2,
      extracted: false,
      markerId: "0".repeat(32),
      ticketDigest: "0".repeat(16),
      flags: 0,
      crcValid: false,
      confidence: 0
    };
    timings.blindMs = clock() - started;
    try {
      return {
        fileBytes,
        format,
        rgba: normalized.rgba,
        width: normalized.width,
        height: normalized.height,
        orientationApplied: normalized.orientationApplied,
        decodeCount: 1,
        timings,
        preflight: await buildVerificationEvidencePreflightV3({
          fileBytes,
          rgba: normalized.rgba,
          width: normalized.width,
          height: normalized.height,
          blindMarker,
          subtle: this.subtle,
          onTiming: (name, duration) => {
            timings[`${name}Ms`] = duration;
          }
        })
      };
    } catch (error) {
      throw fail4("EVIDENCE_BUILD_FAILED", { cause: error });
    }
  }
};
var VerificationPrepareClient = class {
  constructor({ transport }) {
    this.transport = transport;
  }
  async prepare(preflight) {
    try {
      return await this.transport.post(
        "/v3/provenance/verify/prepare",
        preflight
      );
    } catch (error) {
      throw mapVerificationClientError(error);
    }
  }
};
var WatermarkContextEvidenceBuilder = class {
  build({ prepareResponse, rgba, width, height }) {
    const contexts = prepareResponse?.watermarkContexts;
    if (!Array.isArray(contexts) || contexts.length > MAX_PUBLIC_WATERMARK_CONTEXTS)
      throw fail4(
        contexts?.length > MAX_PUBLIC_WATERMARK_CONTEXTS ? "VERIFICATION_CONTEXT_TOO_MANY" : "VERIFY_PROTOCOL_ERROR"
      );
    return buildWatermarkEvidenceContextsV3({
      watermarkContexts: contexts,
      rgba,
      width,
      height
    });
  }
};
var VerificationRequestV3Builder = class {
  constructor({ subtle } = {}) {
    this.subtle = subtle;
  }
  build(input) {
    return buildVerificationRequestV3({ ...input, subtle: this.subtle });
  }
};
var PublicSelectedFileVerificationClientV3 = class {
  constructor({ platform, transport, limits, subtle, maxStaleRetries = 1 }) {
    this.pipeline = new VerificationEvidencePreflightPipeline({
      platform,
      limits,
      subtle
    });
    this.prepareClient = new VerificationPrepareClient({ transport });
    this.contextBuilder = new WatermarkContextEvidenceBuilder();
    this.requestBuilder = new VerificationRequestV3Builder({ subtle });
    Object.assign(this, { platform, transport, maxStaleRetries });
  }
  async verify(selected, { localRegistrationState = null, onProgress = () => {
  }, isCancelled = () => false } = {}) {
    const clock = () => globalThis.performance?.now?.() || Date.now(), flowStarted = clock(), evidence = (onProgress("BUILDING_PREFLIGHT"), await this.pipeline.build(selected)), timings = evidence.timings;
    try {
      for (let attempt = 0; ; attempt++) {
        if (isCancelled()) throw fail4("VERIFY_CANCELLED");
        onProgress("PREPARING");
        let started = clock();
        const prepareResponse = await this.prepareClient.prepare(evidence.preflight);
        timings.prepareHttpMs = (timings.prepareHttpMs || 0) + clock() - started;
        started = clock();
        onProgress("BUILDING_WATERMARK_EVIDENCE");
        const watermarkEvidenceContexts = this.contextBuilder.build({
          prepareResponse,
          ...evidence
        });
        timings.watermarkMs = clock() - started;
        started = clock();
        const request = await this.requestBuilder.build({
          preparedEvidence: evidence.preflight,
          prepareResponse,
          watermarkEvidenceContexts
        });
        timings.finalRequestBuildMs = clock() - started;
        try {
          if (isCancelled()) throw fail4("VERIFY_CANCELLED");
          onProgress("FINAL_VERIFYING");
          started = clock();
          const result = await this.transport.post(
            "/v3/provenance/verify",
            request
          );
          timings.finalHttpMs = clock() - started;
          timings.totalFlowMs = clock() - flowStarted;
          return {
            result: buildVerificationResultModel(result, {
              localRegistrationState
            }),
            request,
            prepareResponse,
            metrics: {
              decodeCount: evidence.decodeCount,
              rgbaBuffers: 1,
              contextCount: watermarkEvidenceContexts.length,
              timings
            },
            privacy: { photoUploaded: false, anonymous: true }
          };
        } catch (error) {
          const mapped = mapVerificationClientError(error);
          if (mapped.code === "VERIFICATION_CONTEXT_STALE" && attempt < this.maxStaleRetries)
            continue;
          throw mapped;
        }
      }
    } finally {
      await this.platform.cleanup?.(selected);
    }
  }
};
export {
  ALGORITHM_ID,
  BLIND_ALLOWED_FLAGS,
  BLIND_FLAG,
  BLIND_V2_MAGIC,
  BLIND_V2_PAYLOAD_BYTES,
  BLIND_V2_VERSION,
  CAPTURE_RESULT,
  CAPTURE_TICKET_DEFAULT_TTL_MS,
  CAPTURE_TICKET_OFFLINE_MAX_TTL_MS,
  CameraCaptureAdapter,
  CaptureTicketPool,
  CaptureTicketRuntimeService,
  DurableProvenanceQueueV2,
  INTEGRITY_MIGRATION_V2_STAGES,
  INTEGRITY_V2_PROFILE,
  INTEGRITY_V3_PROFILE,
  KEY_PURPOSE,
  MAX_PUBLIC_WATERMARK_CONTEXTS,
  MemoryProvenanceCommitRepository,
  MemoryProvenanceRepositoryV2,
  PROVENANCE_REPOSITORY_V2_METHODS,
  ProvenanceQueueSyncServiceV2,
  ProvenanceRegistrationServiceV2,
  ProvenanceVerificationExchangeServiceV3,
  ProvenanceVerificationServiceV2,
  PublicSelectedFileVerificationClientV3,
  REGIONAL_CHANGE_ATTRIBUTION,
  REGISTRATION_RESULT,
  SOFT_RETRIEVAL_INDEX_VERSION,
  TICKET_STATE,
  VERIFICATION_CLIENT_ERROR,
  VERIFICATION_CLIENT_LIMITS_V1,
  VERIFICATION_CONTEXT_PROFILE,
  VERIFICATION_ERROR_PRESENTATION,
  VERIFICATION_EXCHANGE_VERSION,
  VERIFICATION_STATUS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_PRESENTATION,
  VERIFICATION_THRESHOLD_PROFILE_V1,
  VerificationEvidencePreflightPipeline,
  VerificationPrepareClient,
  VerificationRequestV3Builder,
  WatermarkContextEvidenceBuilder,
  attributeRegionalChange,
  bitsToHex,
  blindEmbedResult,
  buildBlindMarkerEvidence,
  buildFinalImageEvidence,
  buildRegistrationDraftV2,
  buildVerificationEvidencePreflightV3,
  buildVerificationRequestV3,
  buildVerificationResultModel,
  buildWatermarkEvidenceContextsV3,
  bytesFromHex,
  bytesToHex,
  canonicalJson,
  canonicalRecordDigest,
  canonicalUtf8,
  captureTicketClaims,
  captureWithTiming,
  compareRegionalIntegrityV2,
  compareRegionalIntegrityV3,
  compareWatermarkIntegrityV2,
  computeRegionalIntegrityV2,
  computeRegionalIntegrityV3,
  computeWatermarkIntegrityV2,
  contextSetDigest,
  createCaptureTicketHttpHandler,
  createDockerCaptureTicketHandler,
  createDockerProvenanceRegistrationHandler,
  createDockerProvenanceVerificationHandler,
  createEdgeCaptureTicketHandler,
  createEdgeProvenanceRegistrationHandler,
  createEdgeProvenanceVerificationHandler,
  createEsaProvenanceRegistrationHandler,
  createEsaProvenanceVerificationHandler,
  createProvenanceRegistrationHttpHandler,
  createProvenanceVerificationExchangeHttpHandler,
  createProvenanceVerificationHttpHandler,
  decodeBlindPayloadV2,
  detectVerificationImageFormat,
  dhash256FromLuma,
  dhash256FromRgba,
  digestCanonicalJson,
  discoverVerificationCandidatesV2,
  encodeBlindPayloadV2,
  evaluateCandidateEvidence,
  evaluateTrustedPreconditions,
  evaluateVerificationStatus,
  extractBlindMarkerV2,
  finalizeCaptureCandidate,
  getVerificationErrorPresentation,
  gridRegions,
  hammingDistance256,
  hexToBytes,
  integrity4x4,
  isVerificationStatus,
  lshBands256,
  mapVerificationClientError,
  migratePendingIntegrityV1Tasks,
  normalizeBounds,
  normalizeExifOrientationRgba,
  phash256FromLuma,
  phash256FromRgba,
  preparedEvidenceDigest,
  publicProvenanceProjection,
  publicWatermarkContext,
  rankVisualCandidates,
  readJpegDimensions,
  readJpegExifOrientation,
  receiptClaims,
  regionalDhash256,
  resampleLuma,
  rgbaToLuma,
  secureMarkerId,
  secureRandomBytes,
  sha256Bytes,
  signEd25519,
  ticketDigest,
  uniqueness,
  utf8Bytes,
  validateCaptureTicket,
  validateProvenanceDraftV2,
  validateReceipt,
  validateRegistrationRequestV2,
  validateRegistrationTicket,
  validateStoredRecord,
  validateVerificationPrepareV3,
  validateVerificationRequestV2,
  verifyEd25519,
  watermarkIntegrity4x3
};
//# sourceMappingURL=index.js.map
