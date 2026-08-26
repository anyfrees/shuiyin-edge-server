const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const FORBIDDEN_KEYS = new Set(["subjectId","subject_id","publicId","image","imageBase64","photoBase64","file","blob","binary","filePath","albumAsset","albumAssetId"]);
export const WORK_LOG_SCHEMA_VERSION = 1;
export const workLogEnabled = env => String(env?.WORK_LOG_V1_ENABLED || "").toLowerCase() === "true";
export class WorkLogError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const crc5Usb = bytes => {
  let crc = 0x1f;
  for (const byte of bytes) for (let bit = 0; bit < 8; bit++) {
    const mix = (crc ^ (byte >> bit)) & 1;
    crc >>= 1;
    if (mix) crc ^= 0x14;
  }
  return (crc ^ 0x1f) & 0x1f;
};
const ascii = value => Uint8Array.from([...value].map(x => x.charCodeAt(0)));
export const normalizeJiluCode = value => {
  const compact = String(value || "").toUpperCase().replace(/-/g, "");
  if (!/^JL[0-9]{6}[0-9A-HJKMNP-TV-Z]{13}$/.test(compact)) throw new WorkLogError("JILU_CODE_INVALID");
  const core = compact.slice(0, 20), check = compact.slice(20);
  const yy = Number(core.slice(2,4)), mm = Number(core.slice(4,6)), dd = Number(core.slice(6,8));
  const date = new Date(Date.UTC(2000 + yy, mm - 1, dd));
  if (date.getUTCFullYear() !== 2000 + yy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) throw new WorkLogError("JILU_CODE_INVALID");
  if (CROCKFORD[crc5Usb(ascii(core))] !== check) throw new WorkLogError("JILU_CODE_CHECKSUM_INVALID");
  return `${core.slice(0,2)}-${core.slice(2,8)}-${core.slice(8,20)}-${check}`;
};
export const generateJiluCode = (localDate, randomBytes = length => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}) => {
  if (!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(localDate)) throw new WorkLogError("LOCAL_DATE_INVALID");
  const date = localDate.slice(2).replace(/-/g, "");
  const bytes = randomBytes(8);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  bits &= (1n << 60n) - 1n;
  let random = "";
  for (let i = 0; i < 12; i++) random += CROCKFORD[Number((bits >> BigInt((11-i)*5)) & 31n)];
  const raw = `JL${date}${random}`;
  return normalizeJiluCode(raw + CROCKFORD[crc5Usb(ascii(raw))]);
};
export const canonicalize = value => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WorkLogError("NON_FINITE_NUMBER");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k.normalize("NFC"))}:${canonicalize(value[k])}`).join(",")}}`;
  throw new WorkLogError("CANONICAL_VALUE_INVALID");
};
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,"0")).join("");
export const payloadDigest = async value => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(value))));
const rejectForbidden = (value, path = "") => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item,index) => rejectForbidden(item, `${path}/${index}`));
  for (const [key,item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key) || /(?:image|base64|binary|blob|filepath|albumasset)/i.test(key)) throw new WorkLogError("PHOTO_UPLOAD_NOT_SUPPORTED");
    rejectForbidden(item, `${path}/${key}`);
  }
};
const bounded = (value,max,code) => { if (String(value ?? "").length > max) throw new WorkLogError(code); };
export const deriveLocalDate = ({capturedAt,timezone,utcOffsetMinutes}) => {
  const instant = new Date(capturedAt);
  if (!Number.isFinite(instant.getTime())) throw new WorkLogError("CAPTURE_TIME_INVALID");
  if (!Number.isInteger(utcOffsetMinutes) || utcOffsetMinutes < -840 || utcOffsetMinutes > 840) throw new WorkLogError("UTC_OFFSET_INVALID");
  if (timezone) try {
    const parts = new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(instant);
    const by = Object.fromEntries(parts.map(x => [x.type,x.value]));
    return `${by.year}-${by.month}-${by.day}`;
  } catch { throw new WorkLogError("TIMEZONE_INVALID"); }
  return new Date(instant.getTime()+utcOffsetMinutes*60000).toISOString().slice(0,10);
};
export const validateCaptureSnapshot = snapshot => {
  rejectForbidden(snapshot);
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.state !== "COMMITTED") throw new WorkLogError("CAPTURE_SCHEMA_INVALID");
  const c = snapshot.capture || {}, p = snapshot.photo || {};
  if (!/^cap_[A-Za-z0-9_-]{22}$/.test(c.clientCaptureId || "")) throw new WorkLogError("CLIENT_CAPTURE_ID_INVALID");
  const jiluCode = normalizeJiluCode(c.jiluCode);
  if (!/^[a-f0-9]{64}$/.test(p.sha256 || "") || p.storageState !== "LOCAL_ONLY") throw new WorkLogError("PHOTO_CONTRACT_INVALID");
  if (!["LIVE_CAMERA","ALBUM_WATERMARKED"].includes(c.sourceType)) throw new WorkLogError("CAPTURE_SOURCE_INVALID");
  if (!Array.isArray(snapshot.fields) || snapshot.fields.length > 100) throw new WorkLogError("CAPTURE_FIELDS_INVALID");
  for (const field of snapshot.fields) {
    bounded(field.fieldId,160,"FIELD_TOO_LARGE"); bounded(field.labelSnapshot,120,"FIELD_TOO_LARGE");
    if (!["text","number","date","time","datetime","person","people","select","multi_select","boolean","location","note"].includes(field.type)) throw new WorkLogError("FIELD_TYPE_INVALID");
    if (typeof field.value === "string") bounded(field.value, field.type === "note" ? 8000 : 2000, "FIELD_TOO_LARGE");
    if (Array.isArray(field.value) && (field.value.length > 50 || field.value.some(x => typeof x !== "string" || x.length > 200))) throw new WorkLogError("FIELD_TOO_LARGE");
    if (field.value && typeof field.value === "object" && !Array.isArray(field.value)) throw new WorkLogError("FIELD_VALUE_INVALID");
  }
  const localDate = deriveLocalDate(c);
  return {snapshot:{...snapshot,capture:{...c,jiluCode}},clientCaptureId:c.clientCaptureId,jiluCode,localDate,photoSha256:p.sha256};
};
export const transitionAllowed = (from,to) => ({
  DRAFT:new Set(["FINAL","ARCHIVED","DELETED"]),
  FINAL:new Set(["ARCHIVED","DELETED"]),
  ARCHIVED:new Set(["DELETED"]),
  DELETED:new Set(["DRAFT"])
}[from]?.has(to) || false);
export const normalizeProjectName = value => String(value || "").normalize("NFC").trim().replace(/\s+/g," ").toLocaleLowerCase("zh-CN");
