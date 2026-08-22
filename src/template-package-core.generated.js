// @ts-nocheck -- generated from shared template-package-core
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key2, value) => key2 in obj ? __defProp(obj, key2, { enumerable: true, configurable: true, writable: true, value }) : obj[key2] = value;
var __publicField = (obj, key2, value) => __defNormalProp(obj, typeof key2 !== "symbol" ? key2 + "" : key2, value);

// node_modules/@noble/ed25519/index.js
var ed25519_CURVE = Object.freeze({
  p: 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn,
  n: 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3edn,
  h: 8n,
  a: 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffecn,
  d: 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3n,
  Gx: 0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51an,
  Gy: 0x6666666666666666666666666666666666666666666666666666666666666658n
});
var { p: P, n: N, Gx, Gy, a: _a, d: _d, h } = ed25519_CURVE;
var L = 32;
var captureTrace = (...args) => {
  if ("captureStackTrace" in Error && typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(...args);
  }
};
var err = (message = "") => {
  const e = new Error(message);
  captureTrace(e, err);
  throw e;
};
var isBig = (n) => typeof n === "bigint";
var isStr = (s) => typeof s === "string";
var isBytes = (a) => a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
var abytes = (value, length, title = "") => {
  const bytes2 = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes2 || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes2 ? `length=${len}` : `type=${typeof value}`;
    const msg = prefix + "expected Uint8Array" + ofLen + ", got " + got;
    throw bytes2 ? new RangeError(msg) : new TypeError(msg);
  }
  return value;
};
var u8n = (len) => new Uint8Array(len);
var u8fr = (buf) => Uint8Array.from(buf);
var padh = (n, pad) => n.toString(16).padStart(pad, "0");
var bytesToHex = (b) => Array.from(abytes(b)).map((e) => padh(e, 2)).join("");
var C = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
var _ch = (ch) => {
  if (ch >= C._0 && ch <= C._9)
    return ch - C._0;
  if (ch >= C.A && ch <= C.F)
    return ch - (C.A - 10);
  if (ch >= C.a && ch <= C.f)
    return ch - (C.a - 10);
  return;
};
var hexToBytes = (hex2) => {
  const e = "hex invalid";
  if (!isStr(hex2))
    return err(e);
  const hl = hex2.length;
  const al = hl / 2;
  if (hl % 2)
    return err(e);
  const array = u8n(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = _ch(hex2.charCodeAt(hi));
    const n2 = _ch(hex2.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0)
      return err(e);
    array[ai] = n1 * 16 + n2;
  }
  return array;
};
var cr = () => globalThis?.crypto;
var subtle = () => cr()?.subtle ?? err("crypto.subtle must be defined, consider polyfill");
var concatBytes = (...arrs) => {
  let len = 0;
  for (const a of arrs)
    len += abytes(a).length;
  const r = u8n(len);
  let pad = 0;
  arrs.forEach((a) => {
    r.set(a, pad);
    pad += a.length;
  });
  return r;
};
var big = BigInt;
var assertRange = (n, min, max, msg = "bad number: out of range") => {
  if (!isBig(n))
    throw new TypeError(msg);
  if (min <= n && n < max)
    return n;
  throw new RangeError(msg);
};
var M = (a, b = P) => {
  const r = a % b;
  return r >= 0n ? r : b + r;
};
var P_MASK = (1n << 255n) - 1n;
var modP = (num) => {
  if (num < 0n)
    err("negative coordinate");
  let r = (num >> 255n) * 19n + (num & P_MASK);
  r = (r >> 255n) * 19n + (r & P_MASK);
  return r % P;
};
var modN = (a) => M(a, N);
var invert = (num, md) => {
  if (num === 0n || md <= 0n)
    err("no inverse n=" + num + " mod=" + md);
  let a = M(num, md), b = md, x = 0n, y = 1n, u = 1n, v = 0n;
  while (a !== 0n) {
    const q = b / a, r = b % a;
    const m = x - u * q, n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  return b === 1n ? M(x, md) : err("no inverse");
};
var callHash = (name) => {
  const fn = hashes[name];
  if (typeof fn !== "function")
    err("hashes." + name + " not set");
  return fn;
};
var checkDigest = (value) => abytes(value, 64, "digest");
var apoint = (p) => p instanceof Point ? p : err("Point expected");
var B256 = 2n ** 256n;
var _Point = class _Point {
  // Constructor only bounds-checks and freezes XYZT coordinates; it does not prove the point is
  // on-curve or that T matches X*Y/Z.
  constructor(X, Y, Z, T) {
    __publicField(this, "X");
    __publicField(this, "Y");
    __publicField(this, "Z");
    __publicField(this, "T");
    const max = B256;
    this.X = assertRange(X, 0n, max);
    this.Y = assertRange(Y, 0n, max);
    this.Z = assertRange(Z, 1n, max);
    this.T = assertRange(T, 0n, max);
    Object.freeze(this);
  }
  static CURVE() {
    return ed25519_CURVE;
  }
  static fromAffine(p) {
    return new _Point(p.x, p.y, 1n, modP(p.x * p.y));
  }
  /** RFC8032 5.1.3: Bytes to Point. */
  static fromBytes(hex2, zip215 = false) {
    const d = _d;
    const normed = u8fr(abytes(hex2, L));
    const lastByte = hex2[31];
    normed[31] = lastByte & ~128;
    const y = bytesToNumberLE(normed);
    const max = zip215 ? B256 : P;
    assertRange(y, 0n, max);
    const y2 = modP(y * y);
    const u = M(y2 - 1n);
    const v = modP(d * y2 + 1n);
    let { isValid, value: x } = uvRatio(u, v);
    if (!isValid)
      err("bad point: y not sqrt");
    const isXOdd = (x & 1n) === 1n;
    const isLastByteOdd = (lastByte & 128) !== 0;
    if (!zip215 && x === 0n && isLastByteOdd)
      err("bad point: x==0, isLastByteOdd");
    if (isLastByteOdd !== isXOdd)
      x = M(-x);
    return new _Point(x, y, 1n, modP(x * y));
  }
  static fromHex(hex2, zip215) {
    return _Point.fromBytes(hexToBytes(hex2), zip215);
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  /** Checks if the point is valid and on-curve. */
  assertValidity() {
    const a = _a;
    const d = _d;
    const p = this;
    if (p.is0())
      return err("bad point: ZERO");
    const { X, Y, Z, T } = p;
    const X2 = modP(X * X);
    const Y2 = modP(Y * Y);
    const Z2 = modP(Z * Z);
    const Z4 = modP(Z2 * Z2);
    const aX2 = modP(X2 * a);
    const left = modP(Z2 * (aX2 + Y2));
    const right = M(Z4 + modP(d * modP(X2 * Y2)));
    if (left !== right)
      return err("bad point: equation left != right (1)");
    const XY = modP(X * Y);
    const ZT = modP(Z * T);
    if (XY !== ZT)
      return err("bad point: equation left != right (2)");
    return this;
  }
  /** Equality check: compare points P&Q. */
  equals(other) {
    const { X: X1, Y: Y1, Z: Z1 } = this;
    const { X: X2, Y: Y2, Z: Z2 } = apoint(other);
    const X1Z2 = modP(X1 * Z2);
    const X2Z1 = modP(X2 * Z1);
    const Y1Z2 = modP(Y1 * Z2);
    const Y2Z1 = modP(Y2 * Z1);
    return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
  }
  is0() {
    return this.equals(I);
  }
  /** Flip point over y coordinate. */
  negate() {
    return new _Point(M(-this.X), this.Y, this.Z, M(-this.T));
  }
  /** Point doubling. Complete formula. Cost: `4M + 4S + 1*a + 6add + 1*2`. */
  double() {
    const { X: X1, Y: Y1, Z: Z1 } = this;
    const a = _a;
    const A = modP(X1 * X1);
    const B = modP(Y1 * Y1);
    const C2 = modP(2n * Z1 * Z1);
    const D = modP(a * A);
    const x1y1 = M(X1 + Y1);
    const E = M(modP(x1y1 * x1y1) - A - B);
    const G2 = M(D + B);
    const F = M(G2 - C2);
    const H = M(D - B);
    const X3 = modP(E * F);
    const Y3 = modP(G2 * H);
    const T3 = modP(E * H);
    const Z3 = modP(F * G2);
    return new _Point(X3, Y3, Z3, T3);
  }
  /** Point addition. Complete formula. Cost: `8M + 1*k + 8add + 1*2`. */
  add(other) {
    const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
    const { X: X2, Y: Y2, Z: Z2, T: T2 } = apoint(other);
    const a = _a;
    const d = _d;
    const A = modP(X1 * X2);
    const B = modP(Y1 * Y2);
    const C2 = modP(modP(T1 * d) * T2);
    const D = modP(Z1 * Z2);
    const E = M(modP(M(X1 + Y1) * M(X2 + Y2)) - A - B);
    const F = M(D - C2);
    const G2 = M(D + C2);
    const H = M(B - modP(a * A));
    const X3 = modP(E * F);
    const Y3 = modP(G2 * H);
    const T3 = modP(E * H);
    const Z3 = modP(F * G2);
    return new _Point(X3, Y3, Z3, T3);
  }
  subtract(other) {
    return this.add(apoint(other).negate());
  }
  /**
   * Point-by-scalar multiplication. Safe mode requires `1 <= n < CURVE.n`.
   * Unsafe mode additionally permits `n = 0` and returns the identity point for that case.
   * Uses {@link wNAF} for base point.
   * Uses fake point to mitigate side-channel leakage.
   * @param n - scalar by which point is multiplied
   * @param safe - safe mode guards against timing attacks; unsafe mode is faster
   */
  multiply(n, safe = true) {
    if (!safe && n === 0n)
      return I;
    assertRange(n, 1n, N);
    if (!safe && this.is0())
      return I;
    if (n === 1n)
      return this;
    if (this.equals(G))
      return wNAF(n).p;
    let p = I;
    let f = G;
    for (let d = this; n > 0n; d = d.double(), n >>= 1n) {
      if (n & 1n)
        p = p.add(d);
      else if (safe)
        f = f.add(d);
    }
    return p;
  }
  multiplyUnsafe(scalar) {
    return this.multiply(scalar, false);
  }
  /** Convert point to 2d xy affine point. (X, Y, Z) ∋ (x=X/Z, y=Y/Z) */
  toAffine() {
    const { X, Y, Z } = this;
    if (this.equals(I))
      return { x: 0n, y: 1n };
    const iz = invert(Z, P);
    if (modP(Z * iz) !== 1n)
      err("invalid inverse");
    const x = modP(X * iz);
    const y = modP(Y * iz);
    return { x, y };
  }
  toBytes() {
    const { x, y } = this.toAffine();
    const b = numTo32bLE(y);
    b[31] |= x & 1n ? 128 : 0;
    return b;
  }
  toHex() {
    return bytesToHex(this.toBytes());
  }
  clearCofactor() {
    return this.multiply(big(h), false);
  }
  isSmallOrder() {
    return this.clearCofactor().is0();
  }
  isTorsionFree() {
    let p = this.multiply(N / 2n, false).double();
    if (N % 2n)
      p = p.add(this);
    return p.is0();
  }
};
__publicField(_Point, "BASE");
__publicField(_Point, "ZERO");
var Point = _Point;
var G = new Point(Gx, Gy, 1n, M(Gx * Gy));
var I = new Point(0n, 1n, 1n, 0n);
Point.BASE = G;
Point.ZERO = I;
var numTo32bLE = (num) => hexToBytes(padh(assertRange(num, 0n, B256), 64)).reverse();
var bytesToNumberLE = (b) => big("0x" + bytesToHex(u8fr(abytes(b)).reverse()));
var pow2 = (x, power) => {
  let r = x;
  while (power-- > 0n) {
    r = modP(r * r);
  }
  return r;
};
var pow_2_252_3 = (x) => {
  const x2 = modP(x * x);
  const b2 = modP(x2 * x);
  const b4 = modP(pow2(b2, 2n) * b2);
  const b5 = modP(pow2(b4, 1n) * x);
  const b10 = modP(pow2(b5, 5n) * b5);
  const b20 = modP(pow2(b10, 10n) * b10);
  const b40 = modP(pow2(b20, 20n) * b20);
  const b80 = modP(pow2(b40, 40n) * b40);
  const b160 = modP(pow2(b80, 80n) * b80);
  const b240 = modP(pow2(b160, 80n) * b80);
  const b250 = modP(pow2(b240, 10n) * b10);
  const pow_p_5_8 = modP(pow2(b250, 2n) * x);
  return { pow_p_5_8, b2 };
};
var RM1 = 0x2b8324804fc1df0b2b4d00993dfbd7a72f431806ad2fe478c4ee1b274a0ea0b0n;
var uvRatio = (u, v) => {
  const v3 = modP(v * modP(v * v));
  const v7 = modP(modP(v3 * v3) * v);
  const pow = pow_2_252_3(modP(u * v7)).pow_p_5_8;
  let x = modP(u * modP(v3 * pow));
  const vx2 = modP(v * modP(x * x));
  const root1 = x;
  const root2 = modP(x * RM1);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === M(-u);
  const noRoot = vx2 === M(-u * RM1);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if ((M(x) & 1n) === 1n)
    x = M(-x);
  return { isValid: useRoot1 || useRoot2, value: x };
};
var modL_LE = (hash) => modN(bytesToNumberLE(hash));
var sha512a = (...m) => Promise.resolve(callHash("sha512Async")(concatBytes(...m))).then(checkDigest);
var hash2extK = (hashed) => {
  const copy = u8fr(hashed);
  const head = copy.slice(0, 32);
  head[0] &= 248;
  head[31] &= 127;
  head[31] |= 64;
  const prefix = copy.slice(32, 64);
  const scalar = modL_LE(head);
  const point = G.multiply(scalar);
  const pointBytes = point.toBytes();
  return { head, prefix, scalar, point, pointBytes };
};
var getExtendedPublicKeyAsync = (secretKey) => sha512a(abytes(secretKey, L)).then(hash2extK);
var hashFinishA = (res) => sha512a(res.hashable).then(res.finish);
var _sign = (e, rBytes, msg) => {
  const { pointBytes: P2, scalar: s } = e;
  const r = modL_LE(rBytes);
  const R = G.multiply(r).toBytes();
  const hashable = concatBytes(R, P2, msg);
  const finish = (hashed) => {
    const S = modN(r + modL_LE(hashed) * s);
    return abytes(concatBytes(R, numTo32bLE(S)), 64);
  };
  return { hashable, finish };
};
var signAsync = async (message, secretKey) => {
  const m = abytes(message);
  const e = await getExtendedPublicKeyAsync(secretKey);
  const rBytes = await sha512a(e.prefix, m);
  return hashFinishA(_sign(e, rBytes, m));
};
var defaultVerifyOpts = { zip215: true };
var _verify = (sig, msg, publicKey, options = defaultVerifyOpts) => {
  sig = abytes(sig, 64);
  msg = abytes(msg);
  publicKey = abytes(publicKey, L);
  const { zip215 = true } = options;
  const r = sig.subarray(0, L);
  const s = bytesToNumberLE(sig.subarray(L, L * 2));
  let A, R, SB;
  let hashable = Uint8Array.of();
  let finished = false;
  try {
    A = Point.fromBytes(publicKey, zip215);
    R = Point.fromBytes(r, zip215);
    SB = G.multiply(s, false);
    hashable = concatBytes(r, publicKey, msg);
    finished = true;
  } catch (error) {
  }
  const finish = (hashed) => {
    if (!finished)
      return false;
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = modL_LE(hashed);
    const RkA = R.add(A.multiply(k, false));
    return RkA.subtract(SB).clearCofactor().is0();
  };
  return { hashable, finish };
};
var verifyAsync = async (signature, message, publicKey, opts = defaultVerifyOpts) => hashFinishA(_verify(signature, message, publicKey, opts));
var hashes = {
  sha512Async: async (message) => {
    const s = subtle();
    const m = concatBytes(message);
    return u8n(await s.digest("SHA-512", m.buffer));
  },
  sha512: void 0
};
var W = 8;
var scalarBits = 256;
var pwindows = Math.ceil(scalarBits / W) + 1;
var pwindowSize = 2 ** (W - 1);
var precompute = () => {
  const points = [];
  let p = G;
  let b = p;
  for (let w = 0; w < pwindows; w++) {
    b = p;
    points.push(b);
    for (let i = 1; i < pwindowSize; i++) {
      b = b.add(p);
      points.push(b);
    }
    p = b.double();
  }
  return points;
};
var Gpows = void 0;
var ctneg = (cnd, p) => {
  const n = p.negate();
  return cnd ? n : p;
};
var wNAF = (n) => {
  const comp = Gpows || (Gpows = precompute());
  let p = I;
  let f = G;
  const pow_2_w = 2 ** W;
  const maxNum = pow_2_w;
  const mask = big(pow_2_w - 1);
  const shiftBy = big(W);
  for (let w = 0; w < pwindows; w++) {
    let wbits = Number(n & mask);
    n >>= shiftBy;
    if (wbits > pwindowSize) {
      wbits -= maxNum;
      n += 1n;
    }
    const off = w * pwindowSize;
    const offF = off;
    const offP = off + Math.abs(wbits) - 1;
    const isEven = w % 2 !== 0;
    const isNeg = wbits < 0;
    if (wbits === 0) {
      f = f.add(ctneg(isEven, comp[offF]));
    } else {
      p = p.add(ctneg(isNeg, comp[offP]));
    }
  }
  if (n !== 0n)
    err("invalid wnaf");
  return { p, f };
};

// packages/template-package-core/src/storage.js
var failure = (code) => Object.assign(new Error(code), { code });
var key = (id, v, type) => {
  if (!/^tpl_[a-z0-9_-]{3,80}$/.test(id) || !Number.isInteger(v) || v < 1) throw failure("TEMPLATE_PACKAGE_INVALID");
  return `templates/${id}/v${v}/${type}`;
};
var parseRef = (ref) => {
  const m = String(ref).match(/^templates\/(tpl_[a-z0-9_-]{3,80})\/v(\d+)\/package\.jltpkg$/);
  if (!m) throw failure("TEMPLATE_PACKAGE_INVALID");
  return { id: m[1], version: Number(m[2]) };
};
var Contract = class {
  objectRef(id, v) {
    return key(id, v, "package.jltpkg");
  }
  async deleteObject(ref) {
    const x = parseRef(ref);
    return this.deletePackage(x.id, x.version);
  }
};
var MemoryTemplateObjectStorage = class extends Contract {
  constructor({ now = () => Date.now() } = {}) {
    super();
    this.data = /* @__PURE__ */ new Map();
    this.created = /* @__PURE__ */ new Map();
    this.now = now;
  }
  async putPackage(id, v, b) {
    const k = this.objectRef(id, v);
    if (this.data.has(k)) throw failure("TEMPLATE_VERSION_CONFLICT");
    this.data.set(k, b);
    this.created.set(k, this.now());
    return k;
  }
  async getPackage(id, v) {
    return this.data.get(this.objectRef(id, v)) || null;
  }
  async putPreview(id, v, b) {
    this.data.set(key(id, v, "preview.webp"), b);
  }
  async getPreview(id, v) {
    return this.data.get(key(id, v, "preview.webp")) || null;
  }
  async deletePackage(id, v) {
    const k = this.objectRef(id, v);
    this.created.delete(k);
    return this.data.delete(k);
  }
  async deletePreview(id, v) {
    this.data.delete(key(id, v, "preview.webp"));
  }
  async exists(id, v) {
    return this.data.has(this.objectRef(id, v));
  }
  async getMetadata(id, v) {
    const k = this.objectRef(id, v), b = this.data.get(k);
    return b ? { size: b.byteLength, createdAt: this.created.get(k), objectRef: k } : null;
  }
  async listPackages() {
    return [...this.data.entries()].filter(([k]) => k.endsWith("/package.jltpkg")).map(([objectRef, b]) => ({ objectRef, safeId: objectRef, size: b.byteLength, createdAt: this.created.get(objectRef) }));
  }
};
var CloudflareR2TemplateStorage = class extends Contract {
  constructor(bucket) {
    super();
    if (!bucket) throw failure("OBJECT_STORAGE_NOT_CONFIGURED");
    this.bucket = bucket;
  }
  async putPackage(id, v, b) {
    const k = this.objectRef(id, v), old = await this.bucket.head(k);
    if (old) throw failure("TEMPLATE_VERSION_CONFLICT");
    await this.bucket.put(k, b, { httpMetadata: { contentType: "application/vnd.jilu.template+json" }, customMetadata: { jiluImmutable: "1" } });
    return k;
  }
  async getPackage(id, v) {
    const x = await this.bucket.get(this.objectRef(id, v));
    return x ? new Uint8Array(await x.arrayBuffer()) : null;
  }
  async putPreview(id, v, b) {
    await this.bucket.put(key(id, v, "preview.webp"), b, { httpMetadata: { contentType: "image/webp" } });
  }
  async getPreview(id, v) {
    const x = await this.bucket.get(key(id, v, "preview.webp"));
    return x ? new Uint8Array(await x.arrayBuffer()) : null;
  }
  async deletePackage(id, v) {
    return this.bucket.delete(this.objectRef(id, v));
  }
  async exists(id, v) {
    return Boolean(await this.bucket.head(this.objectRef(id, v)));
  }
  async getMetadata(id, v) {
    return this.bucket.head(this.objectRef(id, v));
  }
  async listPackages() {
    const out = [];
    let cursor;
    do {
      const page = await this.bucket.list({ prefix: "templates/", ...cursor ? { cursor } : {} });
      for (const x of page.objects || []) if (x.key.endsWith("/package.jltpkg")) out.push({ objectRef: x.key, safeId: x.key, size: x.size, createdAt: new Date(x.uploaded || 0).getTime() });
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
    return out;
  }
};
var EdgeOneBlobTemplateStorage = class extends Contract {
  constructor(store) {
    super();
    if (!store) throw failure("OBJECT_STORAGE_NOT_CONFIGURED");
    this.store = store;
  }
  async putPackage(id, v, b) {
    const k = this.objectRef(id, v);
    await this.store.set(k, b, { onlyIfNew: true });
    return k;
  }
  async getPackage(id, v) {
    const x = await this.store.get(this.objectRef(id, v), { consistency: "strong" });
    return x ? new Uint8Array(await x.arrayBuffer?.() || x) : null;
  }
  async putPreview(id, v, b) {
    await this.store.set(key(id, v, "preview.webp"), b);
  }
  async getPreview(id, v) {
    const x = await this.store.get(key(id, v, "preview.webp"), { consistency: "strong" });
    return x ? new Uint8Array(await x.arrayBuffer?.() || x) : null;
  }
  async deletePackage(id, v) {
    return this.store.delete(this.objectRef(id, v));
  }
  async exists(id, v) {
    return Boolean(await this.store.get(this.objectRef(id, v), { consistency: "strong" }));
  }
  async getMetadata(id, v) {
    const x = await this.store.getWithHeaders?.(this.objectRef(id, v), { consistency: "strong" });
    if (x) return x;
    const b = await this.getPackage(id, v);
    return b ? { size: b.byteLength } : null;
  }
  async listPackages() {
    if (typeof this.store.list !== "function") throw failure("CAPABILITY_NOT_SUPPORTED");
    const out = [];
    let cursor;
    do {
      const page = await this.store.list({ prefix: "templates/", ...cursor ? { cursor } : {} }), items = page.blobs || page.objects || page.items || [];
      out.push(...items.filter((x) => (x.key || x.name).endsWith("/package.jltpkg")).map((x) => ({ objectRef: x.key || x.name, safeId: x.key || x.name, size: x.size, createdAt: new Date(x.uploadedAt || x.uploaded || x.createdAt || 0).getTime() })));
      cursor = page.hasMore || page.truncated ? page.cursor : null;
    } while (cursor);
    return out;
  }
};
var AlibabaEsaTemplateStorage = class {
  constructor(storage) {
    if (!storage) throw failure("OBJECT_STORAGE_NOT_CONFIGURED");
    this.storage = storage;
  }
};

// packages/template-entitlement-core/src/http.js
var enc = new TextEncoder();

// packages/template-entitlement-core/src/index.js
var VISIBILITIES = ["PUBLIC", "AUTHENTICATED", "USER_RESTRICTED", "GROUP_RESTRICTED", "INTERNAL", "DISABLED"];
var UPDATE_POLICIES = ["AUTO", "PROMPT", "FORCED"];
var VERSION_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"];
var active = (x, now) => Boolean(x && x.enabled !== false && !x.revokedAt && (x.expiresAt == null || Number(x.expiresAt) > now));
var TEMPLATE_VISIBILITY = Object.freeze(Object.fromEntries(VISIBILITIES.map((x) => [x, x])));
var TEMPLATE_UPDATE_POLICY = Object.freeze(Object.fromEntries(UPDATE_POLICIES.map((x) => [x, x])));
var TEMPLATE_VERSION_STATUS = Object.freeze(Object.fromEntries(VERSION_STATUSES.map((x) => [x, x])));
var evaluateTemplateAccess = ({ template, subject, directGrant, memberships = [], groups = [], groupGrants = [], now = Date.now() }) => {
  const deny = (reason) => ({ allowed: false, reason, entitlementType: null, expiresAt: null }), allow = (reason, type, expiresAt = null) => ({ allowed: true, reason, entitlementType: type, expiresAt });
  if (!template || template.enabled !== true || template.visibility === "DISABLED" || template.deletedAt || template.archivedAt || template.lifecycleStatus === "FAILED" || !Number.isInteger(Number(template.latestVersion)) || Number(template.latestVersion) < 1) return deny("TEMPLATE_NOT_PUBLISHED");
  if (!subject || subject.status !== "active") return deny("SUBJECT_DISABLED");
  if (template.visibility === "PUBLIC") return allow("PUBLIC", "PUBLIC");
  if (subject.anonymous === true) return deny("NOT_ENTITLED");
  if (template.visibility === "AUTHENTICATED") return allow("AUTHENTICATED", "AUTHENTICATED");
  if (template.visibility === "INTERNAL") return subject.internal === true ? allow("INTERNAL", "INTERNAL") : deny("NOT_ENTITLED");
  if (template.visibility === "USER_RESTRICTED") return active(directGrant, now) ? allow("DIRECT_GRANT", "USER_RESTRICTED", directGrant.expiresAt ?? null) : deny("NOT_ENTITLED");
  if (template.visibility === "GROUP_RESTRICTED") for (const membership of memberships) {
    if (!active(membership, now) || membership.subjectId !== subject.subjectId) continue;
    const group = groups.find((x) => x.groupId === membership.groupId);
    const grant = groupGrants.find((x) => x.groupId === membership.groupId && x.templateId === template.templateId);
    if (group?.enabled === true && active(grant, now)) {
      const expiries = [membership.expiresAt, grant.expiresAt].filter((x) => x != null);
      return allow("GROUP_GRANT", "GROUP_RESTRICTED", expiries.length ? Math.min(...expiries) : null);
    }
  }
  return deny("NOT_ENTITLED");
};

// packages/template-package-core/src/runtime.js
var fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
var safeId = (id) => /^tpl_[a-z0-9_-]{3,80}$/.test(String(id || ""));
var noStore = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization"
};
var restricted = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization"
};
var json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...noStore, ...headers } });
var unavailable = () => fail("TEMPLATE_NOT_AVAILABLE", 404);
var asBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);
var packagePreview = (raw) => {
  try {
    const bundle = JSON.parse(new TextDecoder().decode(asBytes(raw))), asset = (bundle.manifest?.assets || []).find(
      (x) => String(x.mimeType || "").startsWith("image/") && bundle.files?.[x.path]
    );
    return asset ? {
      bytes: Uint8Array.from(
        atob(
          bundle.files[asset.path].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - bundle.files[asset.path].length % 4) % 4)
        ),
        (c) => c.charCodeAt(0)
      ),
      contentType: asset.mimeType
    } : null;
  } catch {
    return null;
  }
};
var TEMPLATE_RUNTIME_DEFAULTS = Object.freeze({
  downloadTokenTtlMs: 18e4,
  maxLeaseHours: 168,
  publicKeysMaxAge: 300
});
var TemplateRuntimeService = class {
  constructor({
    entitlementService,
    repository,
    storage,
    downloadTokenKey,
    packageKeys = [],
    leaseKeys = [],
    additionalPublicKeys = [],
    now = () => Date.now(),
    downloadTokenTtlMs = TEMPLATE_RUNTIME_DEFAULTS.downloadTokenTtlMs,
    maxLeaseHours = TEMPLATE_RUNTIME_DEFAULTS.maxLeaseHours
  }) {
    Object.assign(this, {
      entitlementService,
      repository,
      storage,
      downloadTokenKey,
      packageKeys,
      leaseKeys,
      additionalPublicKeys,
      now,
      downloadTokenTtlMs,
      maxLeaseHours
    });
  }
  async authorized(subject, templateId, templateVersion) {
    if (!subject || subject.status !== "active")
      throw fail("SUBJECT_DISABLED", 403);
    if (!safeId(templateId)) throw unavailable();
    const ctx = await this.entitlementService.context(subject, templateId), access = evaluateTemplateAccess(ctx), version = await this.repository.getVersion(
      templateId,
      Number(templateVersion)
    );
    if (!access.allowed || !version || version.status !== "PUBLISHED" || version.templateVersion !== Number(templateVersion))
      throw unavailable();
    return {
      ctx,
      access,
      version,
      epoch: await this.repository.getEpoch(templateId)
    };
  }
  async downloadToken(subject, { templateId, templateVersion }) {
    if (!this.downloadTokenKey)
      throw fail("TEMPLATE_DOWNLOAD_TOKEN_KEY_NOT_CONFIGURED", 503);
    const x = await this.authorized(subject, templateId, templateVersion), issuedAt = this.now();
    return {
      downloadToken: await issueDownloadToken(
        {
          subjectId: subject.subjectId,
          templateId,
          templateVersion: Number(templateVersion),
          entitlementEpoch: x.epoch,
          issuedAt,
          expiresAt: issuedAt + this.downloadTokenTtlMs
        },
        this.downloadTokenKey
      ),
      expiresAt: issuedAt + this.downloadTokenTtlMs
    };
  }
  async package(subject, templateId, token, { requestId = "", appVersion = "" } = {}) {
    if (!this.storage) throw fail("OBJECT_STORAGE_NOT_CONFIGURED", 503);
    if (!this.downloadTokenKey)
      throw fail("TEMPLATE_DOWNLOAD_TOKEN_KEY_NOT_CONFIGURED", 503);
    const payload = await verifyDownloadToken(
      token,
      this.downloadTokenKey,
      this.now()
    );
    if (payload.subjectId !== subject?.subjectId)
      throw fail("TEMPLATE_DOWNLOAD_TOKEN_INVALID", 401);
    if (payload.templateId !== templateId)
      throw fail("TEMPLATE_DOWNLOAD_TOKEN_INVALID", 401);
    const x = await this.authorized(
      subject,
      templateId,
      payload.templateVersion
    );
    if (x.epoch !== payload.entitlementEpoch)
      throw fail("TEMPLATE_DOWNLOAD_TOKEN_INVALID", 401);
    const bytes2 = await this.storage.getPackage(
      templateId,
      payload.templateVersion
    );
    if (!bytes2) throw fail("TEMPLATE_PACKAGE_NOT_AVAILABLE", 404);
    await this.repository.appendAudit({
      eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
      eventType: "TEMPLATE_PACKAGE_DOWNLOADED",
      actorId: subject.subjectId,
      subjectId: subject.subjectId,
      templateId,
      templateVersion: payload.templateVersion,
      timestamp: this.now(),
      requestId: String(requestId).slice(0, 128),
      appVersion: String(appVersion).slice(0, 64)
    });
    return {
      bytes: asBytes(bytes2),
      version: x.version,
      templateVersion: payload.templateVersion
    };
  }
  async preview(subject, templateId, templateVersion) {
    if (!this.storage) throw fail("OBJECT_STORAGE_NOT_CONFIGURED", 503);
    const version = Number(templateVersion) || Number((await this.repository.getTemplate(templateId))?.latestVersion), x = await this.authorized(subject, templateId, version);
    let bytes2 = await this.storage.getPreview?.(templateId, version), contentType = "image/webp";
    if (!bytes2) {
      const fallback = packagePreview(
        await this.storage.getPackage(templateId, version)
      );
      bytes2 = fallback?.bytes;
      contentType = fallback?.contentType;
    }
    if (!bytes2) throw fail("TEMPLATE_PACKAGE_NOT_AVAILABLE", 404);
    return {
      bytes: asBytes(bytes2),
      contentType,
      templateVersion: version,
      version: x.version
    };
  }
  activeLeaseKey() {
    const key2 = this.leaseKeys.find(
      (x) => x.status === "ACTIVE" && x.privateKey
    );
    if (!key2) throw fail("TEMPLATE_SIGNATURE_KEY_UNKNOWN", 503);
    return key2;
  }
  async lease(subject, { templateId, templateVersion }) {
    const x = await this.authorized(subject, templateId, templateVersion), policy = x.ctx.template.offlinePolicy || {};
    if (!policy.allowed) throw fail("TEMPLATE_LEASE_NOT_ALLOWED", 403);
    const key2 = this.activeLeaseKey(), issuedAt = this.now(), hours = Math.min(
      this.maxLeaseHours,
      Math.max(0, Number(policy.leaseHours) || 0)
    );
    if (!hours) throw fail("TEMPLATE_LEASE_NOT_ALLOWED", 403);
    return issueLease({
      keyId: key2.keyId,
      privateKey: key2.privateKey,
      algorithm: key2.algorithm || "Ed25519",
      lease: {
        subjectId: subject.subjectId,
        templateId,
        templateVersion: Number(templateVersion),
        entitlementEpoch: x.epoch,
        issuedAt,
        expiresAt: issuedAt + hours * 36e5
      }
    });
  }
  async renew(subject, { lease }) {
    if (!lease || lease.subjectId !== subject?.subjectId)
      throw fail("TEMPLATE_LEASE_INVALID", 401);
    const x = await this.authorized(
      subject,
      lease.templateId,
      lease.templateVersion
    );
    await verifyLease({
      lease,
      keys: this.leaseKeys,
      now: this.now(),
      subjectId: subject.subjectId,
      templateId: lease.templateId,
      templateVersion: lease.templateVersion,
      entitlementEpoch: x.epoch
    });
    return this.lease(subject, {
      templateId: lease.templateId,
      templateVersion: lease.templateVersion
    });
  }
  publicKeys() {
    return [
      ...this.packageKeys.map((x) => ({
        ...x,
        purpose: "template-package-signing"
      })),
      ...this.leaseKeys.map((x) => ({
        ...x,
        purpose: "template-entitlement-lease"
      })),
      ...this.additionalPublicKeys
    ].filter((x) => ["ACTIVE", "VERIFY_ONLY"].includes(x.status)).map(({ keyId, purpose, algorithm = "Ed25519", status, publicKey }) => ({
      keyId,
      purpose,
      algorithm,
      status,
      publicKey
    }));
  }
};
var statusFor = (code) => ({
  TEMPLATE_NOT_AVAILABLE: 404,
  TEMPLATE_PACKAGE_NOT_AVAILABLE: 404,
  TEMPLATE_DOWNLOAD_TOKEN_INVALID: 401,
  TEMPLATE_DOWNLOAD_TOKEN_EXPIRED: 401,
  TEMPLATE_LEASE_INVALID: 401,
  TEMPLATE_LEASE_EXPIRED: 401,
  TEMPLATE_LEASE_NOT_ALLOWED: 403,
  SUBJECT_DISABLED: 403,
  OBJECT_STORAGE_NOT_CONFIGURED: 503,
  TEMPLATE_DOWNLOAD_TOKEN_KEY_NOT_CONFIGURED: 503,
  TEMPLATE_SIGNATURE_KEY_UNKNOWN: 503,
  RATE_LIMITED: 429
})[code] || 400;
var createTemplateRuntimeHttpHandler = ({
  service,
  authenticate,
  limits = {},
  now = () => Date.now()
}) => {
  const rates = /* @__PURE__ */ new Map(), defaults = {
    downloadToken: 30,
    package: 60,
    preview: 60,
    leaseIssue: 20,
    leaseRenew: 20,
    publicKeys: 240,
    ...limits
  };
  return async (request) => {
    const url = new URL(request.url), p = url.pathname, m = request.method;
    let bucket = p === "/v1/templates/download-token" ? "downloadToken" : p.startsWith("/v1/templates/package/") ? "package" : p.startsWith("/v1/templates/preview/") ? "preview" : p === "/v1/templates/lease" ? "leaseIssue" : p === "/v1/templates/lease/renew" ? "leaseRenew" : p === "/v2/public-keys" ? "publicKeys" : null;
    if (!bucket) return json({ ok: false, code: "NOT_FOUND" }, 404);
    try {
      let subject = null;
      if (bucket !== "publicKeys") subject = await authenticate(request);
      const rateKey = `${bucket}:${subject?.subjectId || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "anonymous"}`, time = now(), state = rates.get(rateKey), limit = defaults[bucket];
      if (!state || state.resetAt <= time)
        rates.set(rateKey, { count: 1, resetAt: time + 6e4 });
      else if (++state.count > limit)
        return json({ ok: false, code: "RATE_LIMITED" }, 429, {
          "Retry-After": String(
            Math.max(1, Math.ceil((state.resetAt - time) / 1e3))
          )
        });
      if (bucket === "publicKeys" && m === "GET")
        return json({ keys: service.publicKeys() }, 200, {
          "Cache-Control": `public, max-age=${TEMPLATE_RUNTIME_DEFAULTS.publicKeysMaxAge}`,
          Vary: "Accept-Encoding"
        });
      const body = ["GET", "HEAD"].includes(m) ? {} : await request.json().catch(() => {
        throw fail("INVALID_JSON");
      });
      if (bucket === "downloadToken" && m === "POST")
        return json({
          ok: true,
          ...await service.downloadToken(subject, body)
        });
      if (bucket === "package" && m === "GET") {
        const id = decodeURIComponent(p.slice("/v1/templates/package/".length)), x = await service.package(
          subject,
          id,
          request.headers.get("x-jilu-download-token") || url.searchParams.get("token") || "",
          {
            requestId: request.headers.get("x-request-id") || "",
            appVersion: request.headers.get("x-jilu-app-version") || ""
          }
        ), name = `jilu-template-${id.replace(/[^a-z0-9_-]/g, "_")}-v${x.templateVersion}.jltpkg`;
        return new Response(x.bytes, {
          status: 200,
          headers: {
            ...restricted,
            "Content-Type": "application/vnd.jilu.template+json",
            "Content-Length": String(x.bytes.byteLength),
            "Content-Disposition": `attachment; filename="${name}"`,
            "X-JILU-Template-ID": id,
            "X-JILU-Template-Version": String(x.templateVersion),
            ...x.version.packageSha256 ? {
              ETag: `"sha256-${x.version.packageSha256}"`,
              Digest: `sha-256=${x.version.packageSha256}`
            } : {}
          }
        });
      }
      if (bucket === "preview" && m === "GET") {
        const id = decodeURIComponent(p.slice("/v1/templates/preview/".length)), x = await service.preview(
          subject,
          id,
          url.searchParams.get("version")
        );
        return new Response(x.bytes, {
          status: 200,
          headers: {
            ...restricted,
            "Content-Type": x.contentType || "image/webp",
            "Content-Length": String(x.bytes.byteLength),
            "X-JILU-Template-ID": id,
            "X-JILU-Template-Version": String(x.templateVersion)
          }
        });
      }
      if (bucket === "leaseIssue" && m === "POST")
        return json({ ok: true, lease: await service.lease(subject, body) });
      if (bucket === "leaseRenew" && m === "POST")
        return json({ ok: true, lease: await service.renew(subject, body) });
      return json({ ok: false, code: "NOT_FOUND" }, 404);
    } catch (error) {
      const code = error?.code || "TEMPLATE_NOT_AVAILABLE";
      return json({ ok: false, code }, error?.status || statusFor(code));
    }
  };
};

// packages/template-package-core/src/publish.js
var fail2 = (code, status = 400, cause) => Object.assign(new Error(code, { cause }), { code, status });
var bytes = (value) => value instanceof Uint8Array ? value : typeof value === "string" ? Uint8Array.from(
  atob(
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)
  ),
  (c) => c.charCodeAt(0)
) : new Uint8Array(value || []);
var PUBLISH_OPERATION_STATUS = Object.freeze({
  BUILDING: "BUILDING",
  UPLOADED: "UPLOADED",
  VERIFIED: "VERIFIED",
  COMMITTING: "COMMITTING",
  COMPLETED: "COMPLETED",
  AUDIT_PENDING: "AUDIT_PENDING",
  FAILED: "FAILED"
});
var TemplatePublishService = class {
  constructor({
    repository,
    storage,
    packageKeys = [],
    now = () => Date.now(),
    operationId = () => `pop_${crypto.randomUUID().replace(/-/g, "")}`,
    builder = buildTemplateBundle,
    validator = validateTemplateBundle
  }) {
    Object.assign(this, {
      repository,
      storage,
      packageKeys,
      now,
      operationId,
      builder,
      validator
    });
  }
  activeKey() {
    const key2 = this.packageKeys.find(
      (x) => x.status === "ACTIVE" && x.privateKey && x.publicKey
    );
    if (!key2) throw fail2("TEMPLATE_SIGNING_KEY_UNAVAILABLE", 503);
    return key2;
  }
  async publish({
    templateId,
    templateVersion,
    actorId = "admin",
    requestId = ""
  }) {
    if (!this.storage) throw fail2("OBJECT_STORAGE_NOT_CONFIGURED", 503);
    const template = await this.repository.getTemplate(templateId), version = await this.repository.getVersion(
      templateId,
      Number(templateVersion)
    );
    if (!template) throw fail2("TEMPLATE_NOT_AVAILABLE", 404);
    if (!version) throw fail2("TEMPLATE_VERSION_NOT_FOUND", 404);
    if (version.status === "PUBLISHED" && version.contentDigest && version.artifactSha256)
      return { ...this.response(version), idempotent: true };
    if (version.status !== "DRAFT")
      throw fail2("TEMPLATE_VERSION_NOT_DRAFT", 409);
    const opId = this.operationId(), op = {
      operationId: opId,
      templateId,
      templateVersion: Number(templateVersion),
      status: "BUILDING",
      actorId,
      requestId: String(requestId).slice(0, 128),
      createdAt: this.now(),
      updatedAt: this.now()
    };
    await this.repository.savePublishOperation(op);
    let built, uploaded = false;
    try {
      this.validateTemplate(template);
      const key2 = this.activeKey(), draft = version.draft || {};
      built = await this.builder({
        templateId,
        templateVersion: Number(templateVersion),
        name: template.name,
        description: template.description,
        layout: draft.layout,
        assets: (draft.assets || []).map((a) => ({
          ...a,
          bytes: bytes(a.bytes ?? a.data)
        })),
        createdAt: version.createdAt || 0,
        keyId: key2.keyId,
        privateKey: key2.privateKey,
        algorithm: key2.algorithm || "Ed25519"
      });
      await this.validator({
        bytes: built.bytes,
        expectedTemplateId: templateId,
        expectedVersion: Number(templateVersion),
        rendererVersion: 2,
        keys: this.packageKeys
      });
      const existing = await this.storage.getPackage(
        templateId,
        Number(templateVersion)
      );
      if (existing) {
        const remote2 = await this.validateRemote(
          existing,
          built,
          templateId,
          Number(templateVersion)
        );
        if (!remote2) throw fail2("TEMPLATE_VERSION_CONFLICT", 409);
      } else {
        try {
          await this.storage.putPackage(
            templateId,
            Number(templateVersion),
            built.bytes
          );
          uploaded = true;
        } catch (error) {
          if (error?.code === "TEMPLATE_VERSION_CONFLICT") {
            const remote2 = await this.storage.getPackage(
              templateId,
              Number(templateVersion)
            );
            if (!remote2 || !await this.validateRemote(
              remote2,
              built,
              templateId,
              Number(templateVersion)
            ))
              throw fail2("TEMPLATE_VERSION_CONFLICT", 409);
          } else throw fail2("TEMPLATE_STORAGE_UPLOAD_FAILED", 502, error);
        }
      }
      await this.updateOp(op, "UPLOADED", {
        artifactSha256: built.artifactSha256,
        contentDigest: built.contentDigest,
        objectRef: this.storage.objectRef?.(templateId, Number(templateVersion)) || `template:${templateId}:v${templateVersion}`
      });
      const remote = await this.storage.getPackage(
        templateId,
        Number(templateVersion)
      ), metadata = await this.storage.getMetadata(
        templateId,
        Number(templateVersion)
      );
      if (!remote || Number(metadata?.size ?? remote.byteLength) !== built.bytes.byteLength || !await this.validateRemote(
        remote,
        built,
        templateId,
        Number(templateVersion)
      ))
        throw fail2("TEMPLATE_STORAGE_VERIFY_FAILED", 502);
      await this.updateOp(op, "VERIFIED");
      const publishedAt = this.now(), published = {
        ...version,
        status: "PUBLISHED",
        previewLayout: structuredClone(draft.layout),
        contentDigest: built.contentDigest,
        artifactSha256: built.artifactSha256,
        packageSha256: built.artifactSha256,
        packageSize: built.bytes.byteLength,
        signature: built.manifest.signature.value,
        packageSignature: built.manifest.signature.value,
        signatureKeyId: key2.keyId,
        signatureAlgorithm: built.manifest.signature.algorithm,
        packageKeyId: key2.keyId,
        internalObjectRef: op.objectRef,
        publishedAt,
        publishedBy: actorId,
        draft: void 0
      }, audit = {
        eventId: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
        eventType: "TEMPLATE_VERSION_PUBLISHED",
        actorId,
        templateId,
        templateVersion: Number(templateVersion),
        contentDigest: built.contentDigest,
        artifactSha256: built.artifactSha256,
        timestamp: publishedAt,
        operationId: opId,
        requestId: String(requestId).slice(0, 128)
      };
      await this.updateOp(op, "COMMITTING");
      try {
        await this.repository.commitPublished({
          version: published,
          template: {
            ...template,
            latestVersion: Math.max(
              Number(template.latestVersion) || 0,
              Number(templateVersion)
            ),
            updatedAt: publishedAt,
            publishedAt
          },
          audit,
          operation: { ...op, status: "COMPLETED", updatedAt: this.now() }
        });
      } catch (error) {
        await this.updateOp(op, "FAILED", {
          errorCode: "TEMPLATE_PUBLISH_COMMIT_FAILED"
        }).catch(() => {
        });
        throw fail2("TEMPLATE_PUBLISH_COMMIT_FAILED", 500, error);
      }
      return this.response(published);
    } catch (error) {
      if (!["COMPLETED", "FAILED"].includes(op.status))
        await this.updateOp(op, "FAILED", {
          errorCode: error?.code || "TEMPLATE_PACKAGE_INVALID",
          uploaded
        }).catch(() => {
        });
      throw error?.code ? error : fail2("TEMPLATE_PACKAGE_INVALID", 400, error);
    }
  }
  validateTemplate(t) {
    if (!t || !/^tpl_[a-z0-9_-]{3,80}$/.test(t.templateId) || !String(t.name || "").trim() || ![
      "PUBLIC",
      "AUTHENTICATED",
      "USER_RESTRICTED",
      "GROUP_RESTRICTED",
      "INTERNAL",
      "DISABLED"
    ].includes(t.visibility))
      throw fail2("TEMPLATE_PACKAGE_INVALID");
  }
  async validateRemote(remote, built, id, v) {
    try {
      const data = remote instanceof Uint8Array ? remote : new Uint8Array(remote);
      if (data.byteLength !== built.bytes.byteLength) return false;
      const checked = await this.validator({
        bytes: data,
        expectedTemplateId: id,
        expectedVersion: v,
        rendererVersion: 2,
        keys: this.packageKeys
      });
      return checked.manifest.artifactSha256 === built.artifactSha256 && checked.manifest.contentDigest === built.contentDigest;
    } catch {
      return false;
    }
  }
  async updateOp(op, status, patch = {}) {
    Object.assign(op, patch, { status, updatedAt: this.now() });
    await this.repository.savePublishOperation(op);
    return op;
  }
  response(v) {
    return {
      ok: true,
      templateId: v.templateId,
      templateVersion: v.templateVersion,
      status: "PUBLISHED",
      contentDigest: v.contentDigest,
      artifactSha256: v.artifactSha256,
      publishedAt: v.publishedAt
    };
  }
};
var cleanupOrphanPackages = async ({
  repository,
  storage,
  execute = false,
  olderThanMs = 24 * 36e5,
  now = Date.now()
}) => {
  if (!storage) throw fail2("OBJECT_STORAGE_NOT_CONFIGURED", 503);
  if (typeof storage.listPackages !== "function" || typeof storage.deleteObject !== "function")
    throw fail2("CAPABILITY_NOT_SUPPORTED", 501);
  const objects = await storage.listPackages(), out = [];
  for (const object of objects) {
    const age = Math.max(0, now - Number(object.createdAt || now)), referenced = await repository.isObjectReferenced(object.objectRef);
    if (!referenced && age >= olderThanMs) {
      const item = {
        objectKey: object.safeId || object.objectRef,
        ageMs: age,
        reason: "NO_PUBLISHED_VERSION_REFERENCE",
        referenced: false,
        estimatedBytes: Number(object.size) || 0,
        deleted: false
      };
      if (execute && !await repository.isObjectReferenced(object.objectRef)) {
        await storage.deleteObject(object.objectRef);
        item.deleted = true;
      }
      out.push(item);
    }
  }
  return {
    dryRun: !execute,
    objectCount: out.length,
    estimatedBytes: out.reduce((n, x) => n + x.estimatedBytes, 0),
    objects: out
  };
};
var recoverPublishOperations = async ({ repository, storage }) => {
  const ops = await repository.listPublishOperations?.([
    "UPLOADED",
    "VERIFIED",
    "COMMITTING",
    "AUDIT_PENDING",
    "FAILED"
  ]) || [], result = [];
  for (const op of ops) {
    const version = await repository.getVersion(
      op.templateId,
      op.templateVersion
    );
    if (version?.status === "PUBLISHED") {
      if (op.status !== "COMPLETED")
        await repository.savePublishOperation({
          ...op,
          status: "COMPLETED",
          updatedAt: Date.now()
        });
      result.push({ operationId: op.operationId, status: "COMPLETED" });
    } else
      result.push({ operationId: op.operationId, status: "ORPHAN_CANDIDATE" });
  }
  return result;
};

// packages/template-package-core/src/index.js
var enc2 = new TextEncoder();
var dec = new TextDecoder();
var hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
var b64 = (b) => {
  let s = "";
  for (let i = 0; i < b.length; i += 32768)
    s += String.fromCharCode(...b.subarray(i, i + 32768));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
var unb64 = (s) => Uint8Array.from(
  atob(
    String(s).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)
  ),
  (c) => c.charCodeAt(0)
);
var canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map((x) => x === void 0 ? "null" : canonical(x)).join(",")}]` : `{${Object.keys(v).filter((k) => v[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
var sha = async (b) => hex(
  new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      b instanceof Uint8Array ? b : enc2.encode(b)
    )
  )
);
var err2 = (code) => Object.assign(new Error(code), { code });
var safePath = (p) => typeof p === "string" && !p.includes("..") && !p.includes("\\") && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && /^[\x20-\x7e]+$/.test(p);
var PACKAGE_LIMITS = Object.freeze({
  package: 10 * 1024 * 1024,
  assetCount: 32,
  asset: 5 * 1024 * 1024,
  manifest: 64 * 1024,
  layout: 256 * 1024
});
var MIME_ALLOWLIST = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp"
]);
var WEB_DIY_FORMAT = "xianchang-jilu-watermark-scheme";
var WEB_DIY_VERSION = 1;
var officialTypes = /* @__PURE__ */ new Set([
  "text",
  "single-select",
  "multi-select",
  "person",
  "system-time",
  "location",
  "system-weather",
  "image",
  "logo",
  "custom-text"
]);
var typeAliases = {
  time: "system-time",
  date: "system-time",
  location: "location",
  weather: "system-weather",
  person: "person",
  logo: "logo"
};
var parseWebDiyExport = (value) => {
  let raw;
  try {
    raw = typeof value === "string" ? JSON.parse(value.replace(/^\uFEFF/, "")) : structuredClone(value);
  } catch {
    throw err2("TEMPLATE_JSON_INVALID");
  }
  if (raw?.format && raw.format !== WEB_DIY_FORMAT)
    throw err2("TEMPLATE_FORMAT_UNSUPPORTED");
  if (raw?.version != null && Number(raw.version) !== WEB_DIY_VERSION)
    throw err2("TEMPLATE_VERSION_UNSUPPORTED");
  return raw;
};
var normalizeWebDiyExport = (value) => {
  const raw = parseWebDiyExport(value), source = raw?.layout || raw?.scheme || raw?.template || raw, sourceFields = Array.isArray(source?.fields) ? source.fields : Array.isArray(source?.elements) ? source.elements : Array.isArray(source?.textLayout) ? source.textLayout : [];
  if (!source || !sourceFields.length) throw err2("TEMPLATE_PACKAGE_INVALID");
  const used = /* @__PURE__ */ new Set(), fields = sourceFields.filter((f) => f?.enabled !== false).map((f, i) => {
    const stem = String(f.fieldId || f.key || `item_${i + 1}`).toLowerCase().replace(/^field_/, "").replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56);
    let fieldId = `field_${stem || `item_${i + 1}`}`;
    while (used.has(fieldId)) fieldId = `${fieldId.slice(0, 60)}_${i + 1}`;
    used.add(fieldId);
    return {
      ...f,
      fieldId,
      type: officialTypes.has(f.type) ? f.type : typeAliases[f.key] || "text",
      label: String(f.label || f.sample || `\u680F\u76EE ${i + 1}`).slice(0, 120)
    };
  }), assets = Array.isArray(raw.assets) ? raw.assets : Object.entries(raw.assets || {}).filter(([, a]) => a?.data).map(([id, a]) => {
    const ext = /^(png|jpe?g|webp)$/i.test(a.ext) ? a.ext.toLowerCase().replace("jpeg", "jpg") : "png";
    return {
      id,
      path: `assets/${id}.${ext}`,
      mimeType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
      data: a.data
    };
  });
  return {
    layout: {
      ...source,
      identity: "OFFICIAL",
      origin: "official",
      customTemplateId: void 0,
      fields
    },
    assets
  };
};
var validateLayout = (layout) => {
  if (!layout || !Array.isArray(layout.fields))
    throw err2("TEMPLATE_PACKAGE_INVALID");
  const ids = /* @__PURE__ */ new Set();
  for (const f of layout.fields) {
    if (!/^field_[a-z0-9_-]{2,64}$/.test(f?.fieldId || "") || ids.has(f.fieldId))
      throw err2("TEMPLATE_PACKAGE_INVALID");
    ids.add(f.fieldId);
    if (![
      "text",
      "single-select",
      "multi-select",
      "person",
      "location",
      "system-time",
      "system-weather",
      "image",
      "logo",
      "custom-text"
    ].includes(f.type))
      throw err2("TEMPLATE_PACKAGE_INVALID");
  }
  return true;
};
var SIGNATURE_ALGORITHMS = Object.freeze({
  ED25519: "Ed25519",
  ECDSA_P256: "ECDSA-P256-SHA256"
});
var signaturePayload = (m) => enc2.encode(
  canonical(
    m.signature?.algorithm === SIGNATURE_ALGORITHMS.ECDSA_P256 ? {
      format: m.format,
      formatVersion: m.formatVersion,
      templateId: m.templateId,
      templateVersion: m.templateVersion,
      contentDigest: m.contentDigest,
      minimumRendererVersion: m.rendererCompatibility.minimumRendererVersion,
      signatureAlgorithm: m.signature.algorithm,
      signatureKeyId: m.signature.keyId
    } : {
      format: m.format,
      formatVersion: m.formatVersion,
      templateId: m.templateId,
      templateVersion: m.templateVersion,
      contentDigest: m.contentDigest,
      minimumRendererVersion: m.rendererCompatibility.minimumRendererVersion
    }
  )
);
var importPrivate = (k) => crypto.subtle.importKey("pkcs8", unb64(k), { name: "Ed25519" }, false, [
  "sign"
]);
var importPublic = (k) => crypto.subtle.importKey("raw", unb64(k), { name: "Ed25519" }, false, [
  "verify"
]);
var signEd25519 = async (data, key2) => {
  try {
    return new Uint8Array(
      await crypto.subtle.sign("Ed25519", await importPrivate(key2), data)
    );
  } catch {
    return signAsync(data, unb64(key2).slice(-32));
  }
};
var verifyEd25519 = async (signature, data, key2) => {
  try {
    return await crypto.subtle.verify(
      "Ed25519",
      await importPublic(key2),
      signature,
      data
    );
  } catch {
    return verifyAsync(signature, data, unb64(key2));
  }
};
var importP256Private = (k) => crypto.subtle.importKey(
  "pkcs8",
  unb64(k),
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign"]
);
var importP256Public = (k) => crypto.subtle.importKey(
  "raw",
  unb64(k),
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["verify"]
);
var signDetached = async (algorithm, data, key2) => {
  if (algorithm === SIGNATURE_ALGORITHMS.ED25519) return signEd25519(data, key2);
  if (algorithm === SIGNATURE_ALGORITHMS.ECDSA_P256)
    return new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        await importP256Private(key2),
        data
      )
    );
  throw err2("TEMPLATE_SIGNATURE_ALGORITHM_UNSUPPORTED");
};
var verifyDetached = async (algorithm, signature, data, key2) => {
  if (algorithm === SIGNATURE_ALGORITHMS.ED25519)
    return verifyEd25519(signature, data, key2);
  if (algorithm === SIGNATURE_ALGORITHMS.ECDSA_P256)
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await importP256Public(key2),
      signature,
      data
    );
  throw err2("TEMPLATE_SIGNATURE_ALGORITHM_UNSUPPORTED");
};
var buildTemplateBundle = async ({
  templateId,
  templateVersion,
  name = "",
  description = "",
  layout,
  assets = [],
  createdAt = 0,
  keyId,
  privateKey,
  algorithm = SIGNATURE_ALGORITHMS.ED25519
}) => {
  if (!/^tpl_[a-z0-9_-]{3,80}$/.test(templateId) || !Number.isInteger(templateVersion) || templateVersion < 1)
    throw err2("TEMPLATE_PACKAGE_INVALID");
  validateLayout(layout);
  const layoutBytes = enc2.encode(canonical(layout));
  if (layoutBytes.length > PACKAGE_LIMITS.layout)
    throw err2("TEMPLATE_PACKAGE_TOO_LARGE");
  if (assets.length > PACKAGE_LIMITS.assetCount)
    throw err2("TEMPLATE_PACKAGE_TOO_LARGE");
  const paths = /* @__PURE__ */ new Set(["manifest.json", "layout.json"]), files = { "layout.json": b64(layoutBytes) }, entries = [];
  for (const a of [...assets].sort((x, y) => x.path.localeCompare(y.path))) {
    if (!safePath(a.path) || !a.path.startsWith("assets/") || paths.has(a.path.toLowerCase()) || !MIME_ALLOWLIST.includes(a.mimeType))
      throw err2("TEMPLATE_PACKAGE_INVALID");
    paths.add(a.path.toLowerCase());
    const bytes3 = a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes);
    if (bytes3.length > PACKAGE_LIMITS.asset)
      throw err2("TEMPLATE_PACKAGE_TOO_LARGE");
    files[a.path] = b64(bytes3);
    entries.push({
      id: a.id,
      path: a.path,
      sha256: await sha(bytes3),
      mimeType: a.mimeType,
      size: bytes3.length
    });
  }
  const content = {
    layout: {
      path: "layout.json",
      sha256: await sha(layoutBytes),
      size: layoutBytes.length
    },
    assets: entries
  }, contentDigest = await sha(canonical(content));
  let manifest = {
    format: "jilu-template",
    formatVersion: 2,
    templateId,
    templateVersion,
    name,
    description,
    layout: content.layout,
    assets: entries,
    rendererCompatibility: { minimumRendererVersion: 2 },
    createdAt,
    contentDigest,
    artifactSha256: null,
    signature: { algorithm, keyId, value: "" }
  };
  manifest.signature.value = b64(
    await signDetached(algorithm, signaturePayload(manifest), privateKey)
  );
  const artifact = enc2.encode(canonical({ manifest, files }));
  if (artifact.length > PACKAGE_LIMITS.package)
    throw err2("TEMPLATE_PACKAGE_TOO_LARGE");
  manifest.artifactSha256 = await sha(artifact);
  const bytes2 = enc2.encode(canonical({ manifest, files }));
  return {
    bytes: bytes2,
    manifest: { ...manifest },
    contentDigest,
    artifactSha256: manifest.artifactSha256
  };
};
var validateTemplateBundle = async ({
  bytes: bytes2,
  expectedTemplateId,
  expectedVersion,
  rendererVersion,
  keys
}) => {
  if (bytes2.length > PACKAGE_LIMITS.package)
    throw err2("TEMPLATE_PACKAGE_TOO_LARGE");
  let bundle;
  try {
    bundle = JSON.parse(dec.decode(bytes2));
  } catch {
    throw err2("TEMPLATE_PACKAGE_INVALID");
  }
  const m = bundle.manifest;
  if (m?.formatVersion !== 2) throw err2("TEMPLATE_FORMAT_UNSUPPORTED");
  if (m.templateId !== expectedTemplateId || m.templateVersion !== expectedVersion)
    throw err2("TEMPLATE_PACKAGE_INVALID");
  const unsignedArtifact = structuredClone(bundle);
  unsignedArtifact.manifest.artifactSha256 = null;
  if (await sha(enc2.encode(canonical(unsignedArtifact))) !== m.artifactSha256)
    throw err2("TEMPLATE_PACKAGE_HASH_MISMATCH");
  if (rendererVersion < m.rendererCompatibility.minimumRendererVersion)
    throw err2("RENDERER_UPDATE_REQUIRED");
  const key2 = keys.find(
    (x) => x.keyId === m.signature.keyId && ["ACTIVE", "VERIFY_ONLY"].includes(x.status)
  );
  if (!key2) throw err2("TEMPLATE_SIGNATURE_KEY_UNKNOWN");
  const algorithm = m.signature?.algorithm || SIGNATURE_ALGORITHMS.ED25519;
  if (key2.algorithm && key2.algorithm !== algorithm)
    throw err2("TEMPLATE_SIGNATURE_INVALID");
  if (!await verifyDetached(
    algorithm,
    unb64(m.signature.value),
    signaturePayload(m),
    key2.publicKey
  ))
    throw err2("TEMPLATE_SIGNATURE_INVALID");
  validateLayout(JSON.parse(dec.decode(unb64(bundle.files["layout.json"]))));
  if (await sha(unb64(bundle.files["layout.json"])) !== m.layout.sha256)
    throw err2("TEMPLATE_ASSET_HASH_MISMATCH");
  const listed = /* @__PURE__ */ new Set(["layout.json"]);
  for (const a of m.assets) {
    listed.add(a.path);
    if (!safePath(a.path) || !bundle.files[a.path] || await sha(unb64(bundle.files[a.path])) !== a.sha256)
      throw err2("TEMPLATE_ASSET_HASH_MISMATCH");
  }
  if (Object.keys(bundle.files).some((x) => !listed.has(x)))
    throw err2("TEMPLATE_PACKAGE_INVALID");
  return { valid: true, manifest: m };
};
var tokenKey = async (secret) => crypto.subtle.importKey(
  "raw",
  enc2.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
);
var issueDownloadToken = async (payload, secret) => {
  const body = b64(enc2.encode(canonical(payload))), sig = b64(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await tokenKey(secret),
        enc2.encode(body)
      )
    )
  );
  return `${body}.${sig}`;
};
var verifyDownloadToken = async (token, secret, now = Date.now()) => {
  const [body, sig] = String(token).split(".");
  if (!body || !sig || !await crypto.subtle.verify(
    "HMAC",
    await tokenKey(secret),
    unb64(sig),
    enc2.encode(body)
  ))
    throw err2("TEMPLATE_DOWNLOAD_TOKEN_INVALID");
  const p = JSON.parse(dec.decode(unb64(body)));
  if (p.expiresAt <= now) throw err2("TEMPLATE_DOWNLOAD_TOKEN_EXPIRED");
  return p;
};
var issueLease = async ({
  lease,
  keyId,
  privateKey,
  algorithm = SIGNATURE_ALGORITHMS.ED25519
}) => {
  const body = {
    schema: "jilu-template-entitlement-lease",
    version: 1,
    ...lease,
    keyId,
    ...algorithm === SIGNATURE_ALGORITHMS.ED25519 ? {} : { algorithm }
  };
  return {
    ...body,
    signature: b64(
      await signDetached(algorithm, enc2.encode(canonical(body)), privateKey)
    )
  };
};
var verifyLease = async ({
  lease,
  keys,
  now = Date.now(),
  subjectId,
  templateId,
  templateVersion,
  entitlementEpoch
}) => {
  const { signature, ...body } = lease || {}, key2 = keys.find(
    (x) => x.keyId === body.keyId && ["ACTIVE", "VERIFY_ONLY"].includes(x.status)
  ), algorithm = body.algorithm || SIGNATURE_ALGORITHMS.ED25519;
  if (!key2 || key2.algorithm && key2.algorithm !== algorithm || !await verifyDetached(
    algorithm,
    unb64(signature || ""),
    enc2.encode(canonical(body)),
    key2.publicKey
  ))
    throw err2("TEMPLATE_LEASE_INVALID");
  if (body.expiresAt <= now) throw err2("TEMPLATE_LEASE_EXPIRED");
  if (body.subjectId !== subjectId || body.templateId !== templateId || body.templateVersion !== templateVersion || body.entitlementEpoch !== entitlementEpoch)
    throw err2("TEMPLATE_LEASE_INVALID");
  return true;
};
var decideTemplateUpdate = ({
  installedVersion,
  latestVersion,
  minimumSupportedVersion,
  updatePolicy
}) => installedVersion >= latestVersion ? "CURRENT" : installedVersion < minimumSupportedVersion ? "FORCED_UPDATE_REQUIRED" : updatePolicy === "AUTO" ? "AUTO_UPDATE_AVAILABLE" : updatePolicy === "PROMPT" ? "PROMPT_UPDATE_AVAILABLE" : "FORCED_UPDATE_REQUIRED";
var MemoryAtomicInstaller = class {
  constructor() {
    this.active = /* @__PURE__ */ new Map();
    this.staging = /* @__PURE__ */ new Map();
  }
  stage(id, v, data) {
    this.staging.set(`${id}:${v}`, data);
  }
  commit(id, v) {
    const k = `${id}:${v}`;
    if (!this.staging.has(k)) throw err2("TEMPLATE_UPDATE_FAILED");
    this.active.set(id, { version: v, data: this.staging.get(k) });
    this.staging.delete(k);
  }
  recover() {
    this.staging.clear();
  }
  get(id) {
    return this.active.get(id) || null;
  }
};
export {
  AlibabaEsaTemplateStorage,
  CloudflareR2TemplateStorage,
  EdgeOneBlobTemplateStorage,
  MIME_ALLOWLIST,
  MemoryAtomicInstaller,
  MemoryTemplateObjectStorage,
  PACKAGE_LIMITS,
  PUBLISH_OPERATION_STATUS,
  SIGNATURE_ALGORITHMS,
  TEMPLATE_RUNTIME_DEFAULTS,
  TemplatePublishService,
  TemplateRuntimeService,
  WEB_DIY_FORMAT,
  WEB_DIY_VERSION,
  buildTemplateBundle,
  cleanupOrphanPackages,
  createTemplateRuntimeHttpHandler,
  decideTemplateUpdate,
  issueDownloadToken,
  issueLease,
  normalizeWebDiyExport,
  parseWebDiyExport,
  recoverPublishOperations,
  signaturePayload,
  validateLayout,
  validateTemplateBundle,
  verifyDownloadToken,
  verifyLease
};
/*! Bundled license information:

@noble/ed25519/index.js:
  (*! noble-ed25519 - MIT License (c) 2019 Paul Miller (paulmillr.com) *)
*/
//# sourceMappingURL=index.js.map
