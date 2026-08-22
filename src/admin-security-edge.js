import { argon2idAsync } from '@noble/hashes/argon2.js'
import { ADMIN_ROLES, evaluateAdminAccess, validateDelegation } from './admin-authorization.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = value => Uint8Array.from(atob(String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value).length / 4) * 4, '=')), x => x.charCodeAt(0))
const random = size => { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return b64u(bytes) }
const clean = (value, max = 120) => String(value || '').replace(/[\u0000-\u001f]/g, '').slice(0, max)
const digest = async value => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(value)))))
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
const parse = value => { try { return value ? JSON.parse(value) : null } catch { return null } }
const cookie = request => Object.fromEntries((request.headers.get('cookie') || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2))
const fail = (code, status = 403) => Object.assign(new Error(code), { code, status })
const key = (kind, id) => `admin:${kind}:${id}`
const get = async (kv, kind, id) => parse(await kv.get(key(kind, id)))
const put = (kv, kind, id, value, options) => kv.put(key(kind, id), JSON.stringify(value), options)
const remove = (kv, kind, id) => kv.delete(key(kind, id))
const list = async (kv, prefix) => {
  const values = []; let cursor
  do {
    const page = await kv.list({ prefix: key(prefix, ''), limit: 100, ...(cursor ? { cursor } : {}) })
    for (const item of page.keys || []) { const value = parse(await kv.get(item.name)); if (value) values.push(value) }
    cursor = page.list_complete === true || page.complete === true ? '' : page.cursor
  } while (cursor)
  return values
}
const timingSafe = (left, right) => {
  const a = enc.encode(String(left)), b = enc.encode(String(right)); if (a.length !== b.length) return false
  let different = 0; for (let index = 0; index < a.length; index++) different |= a[index] ^ b[index]; return different === 0
}
const argonHash = async (password, encodedHash = '') => {
  let salt, t = 3, m = 65536, p = 1, expected
  if (encodedHash) {
    const match = String(encodedHash).match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/)
    if (!match) throw new Error('ARGON2_HASH_INVALID')
    m=Number(match[1]);t=Number(match[2]);p=Number(match[3]); salt = Uint8Array.from(atob(match[4].replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(match[4].length/4)*4,'=')),x=>x.charCodeAt(0)); expected = match[5]
  } else { salt = new Uint8Array(16); crypto.getRandomValues(salt) }
  const result = await argon2idAsync(String(password), salt, { t: Number(t), m: Number(m), p: Number(p), dkLen: expected ? fromB64u(expected).length : 32, maxmem: 128 * 1024 * 1024, asyncTick: 10 }), encoded = b64u(result)
  return encodedHash ? timingSafe(encoded, expected) : `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64u(salt)}$${encoded}`
}
const concat = (...arrays) => { const out=new Uint8Array(arrays.reduce((n,x)=>n+x.length,0));let offset=0;for(const x of arrays){out.set(x,offset);offset+=x.length}return out }
const cbor = (bytes, start = 0) => { let offset=start;const readLength=info=>{if(info<24)return info;if(info===24)return bytes[offset++];if(info===25){const n=(bytes[offset]<<8)|bytes[offset+1];offset+=2;return n}if(info===26){const n=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0);offset+=4;return n}throw new Error('CBOR_LENGTH')};const head=bytes[offset++],major=head>>5,length=readLength(head&31);if(major===0)return{value:length,offset};if(major===1)return{value:-1-length,offset};if(major===2){const value=bytes.slice(offset,offset+length);return{value,offset:offset+length}}if(major===3){const value=dec.decode(bytes.slice(offset,offset+length));return{value,offset:offset+length}}if(major===4){const value=[];for(let i=0;i<length;i++){const x=cbor(bytes,offset);value.push(x.value);offset=x.offset}return{value,offset}}if(major===5){const value=new Map;for(let i=0;i<length;i++){const k=cbor(bytes,offset);offset=k.offset;const v=cbor(bytes,offset);offset=v.offset;value.set(k.value,v.value)}return{value,offset}}if(major===7&&length===20)return{value:false,offset};if(major===7&&length===21)return{value:true,offset};if(major===7&&length===22)return{value:null,offset};throw new Error('CBOR_TYPE') }
const clientData = response => { const raw=fromB64u(response.response.clientDataJSON),value=JSON.parse(dec.decode(raw));return{raw,value} }
const verifyClient = async (response, challenge, origins, type) => { const data=clientData(response);if(data.value.type!==type||data.value.challenge!==challenge||!origins.includes(data.value.origin))throw fail('PASSKEY_INVALID',400);return data.raw }
const rpHashValid = async (authData, rpId) => timingSafe(b64u(authData.slice(0,32)),b64u(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(rpId)))))
const P256_SPKI_PREFIX=Uint8Array.of(0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00,0x04)
const coseKey = async cose => {
  const map=cbor(cose).value,kty=map.get(1),alg=map.get(3)
  if(kty===2&&alg===-7){
    const x=map.get(-2),y=map.get(-3)
    if(!(x instanceof Uint8Array)||x.length!==32||!(y instanceof Uint8Array)||y.length!==32)throw fail('PASSKEY_INVALID',400)
    const key=await crypto.subtle.importKey('spki',concat(P256_SPKI_PREFIX,x,y),{name:'ECDSA',namedCurve:'P-256'},false,['verify'])
    return {key,verifyAlgorithm:{name:'ECDSA',hash:'SHA-256'},ecdsa:true}
  }
  if(kty===3&&alg===-257){
    const key=await crypto.subtle.importKey('jwk',{kty:'RSA',n:b64u(map.get(-1)),e:b64u(map.get(-2)),alg:'RS256',ext:true,key_ops:['verify'],use:'sig'},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])
    return {key,verifyAlgorithm:{name:'RSASSA-PKCS1-v1_5'},ecdsa:false}
  }
  throw fail('PASSKEY_ALGORITHM_UNSUPPORTED',400)
}
const derToRaw = signature => { if(signature[0]!==0x30)return signature;let o=2;if(signature[1]&0x80)o=2+(signature[1]&0x7f);if(signature[o++]!==2)throw fail('PASSKEY_INVALID',400);let rl=signature[o++],r=signature.slice(o,o+rl);o+=rl;if(signature[o++]!==2)throw fail('PASSKEY_INVALID',400);let sl=signature[o++],s=signature.slice(o,o+sl);while(r.length>32&&r[0]===0)r=r.slice(1);while(s.length>32&&s[0]===0)s=s.slice(1);const out=new Uint8Array(64);out.set(r.slice(-32),32-r.slice(-32).length);out.set(s.slice(-32),64-s.slice(-32).length);return out }
const hmac = async (secret, value) => {
  const k = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(value))))
}
const permissionsFor = roles => new Set(roles.flatMap(role => ADMIN_ROLES[role] || []))
const publicPrincipal = admin => ({ admin_id: admin.adminId, username: admin.username, display_name: admin.displayName, status: admin.status, roles: admin.roles, templateScopes: admin.templateScopes, groupScopes: admin.groupScopes, totpEnabled: Boolean(admin.totpEnabled), hasPassword: Boolean(admin.passwordHash), passkeyCount: admin.passkeyIds?.length || 0, created_at: admin.createdAt, updated_at: admin.updatedAt })

export class EdgeAdminSecurityService {
  constructor({ kv, env, now = () => Date.now() }) { this.kv = kv; this.env = env; this.now = now; this.rpId = env.ADMIN_WEBAUTHN_RP_ID || 'shuiyin.nnu.cn'; this.origins = String(env.ADMIN_ORIGIN || 'https://shuiyin.nnu.cn').split(',').map(x => x.trim()).filter(Boolean) }
  async audit(actorId, action, resourceType = '', resourceId = '', result = 'SUCCESS', metadata = {}) {
    const timestamp = this.now(), eventId = `ae_${random(18)}`
    await put(this.kv, 'audit', `${String(9e15 - timestamp).padStart(16, '0')}:${eventId}`, { event_id: eventId, actor_id: actorId || null, action, resource_type: resourceType || null, resource_id: resourceId || null, result, timestamp, metadata })
  }
  async principal(adminId) { return get(this.kv, 'principal', adminId) }
  async byUsername(username) { const id = await this.kv.get(key('username', clean(username, 80).toLowerCase())); return id ? this.principal(id) : null }
  access(admin) {
    if (!admin || admin.status !== 'ACTIVE') throw fail('ADMIN_DISABLED', 401)
    const roles = admin.roles || [], superAdmin = roles.includes('SUPER_ADMIN')
    return { principal: admin, roles: new Set(roles), permissions: permissionsFor(roles), superAdmin, templateScope: new Set(admin.templateScopes || []), groupScope: new Set(admin.groupScopes || []) }
  }
  async require(access, requirement) { if (!evaluateAdminAccess(access, requirement)) { await this.audit(access.principal.adminId, 'AUTHORIZATION_DENIED', requirement.templateId ? 'template' : requirement.groupId ? 'group' : 'permission', requirement.templateId || requirement.groupId || requirement.permission, 'DENIED', { permission: requirement.permission }); throw fail('ADMIN_SCOPE_DENIED') } return access }
  async passwordHash(password) { return argonHash(password) }
  async issueSession(admin, method) {
    const token = random(32), csrf = random(24), now = this.now(), sessionHash = await digest(token), expiresAt = now + Number(this.env.ADMIN_SESSION_MS || 8 * 60 * 60 * 1000)
    await put(this.kv, 'session', sessionHash, { sessionHash, adminId: admin.adminId, csrfHash: await digest(csrf), authMethod: method, authzEpoch: admin.authzEpoch, createdAt: now, expiresAt, revokedAt: null, lastSeenAt: now }, { expirationTtl: Math.ceil((expiresAt - now) / 1000) + 60 })
    return { token, csrf, expiresAt, method }
  }
  async authenticate(request, csrfRequired = false) {
    const token = cookie(request).jilu_admin_session
    if (!token) throw fail('ADMIN_AUTH_REQUIRED', 401)
    const session = await get(this.kv, 'session', await digest(token)), admin = session && await this.principal(session.adminId)
    if (!session || session.revokedAt || session.expiresAt <= this.now() || !admin || admin.status !== 'ACTIVE' || session.authzEpoch !== admin.authzEpoch) throw fail('ADMIN_SESSION_INVALID', 401)
    if (csrfRequired && await digest(request.headers.get('x-csrf-token') || '') !== session.csrfHash) throw fail('CSRF_INVALID', 403)
    session.lastSeenAt = this.now(); await put(this.kv, 'session', session.sessionHash, session, { expirationTtl: Math.max(60, Math.ceil((session.expiresAt - this.now()) / 1000)) })
    return { ...this.access(admin), session }
  }
  async passwordLogin(input) {
    const admin = await this.byUsername(input.username)
    let valid = false
    try { valid = Boolean(admin?.passwordHash) && await argonHash(String(input.password || ''), admin.passwordHash) === true } catch {}
    if (!valid || admin.status !== 'ACTIVE') { await this.audit(null, 'ADMIN_LOGIN_FAILURE', '', '', 'DENIED'); throw fail('ADMIN_LOGIN_FAILED', 401) }
    if (admin.totpEnabled) { if (!String(input.totp || '').trim()) throw fail('TOTP_REQUIRED', 428); if (!await this.verifyTotp(await this.open(admin.totpSecret), input.totp)) throw fail('ADMIN_LOGIN_FAILED', 401) }
    const method = admin.totpEnabled ? 'PASSWORD_TOTP' : 'PASSWORD'; await this.audit(admin.adminId, 'ADMIN_LOGIN_SUCCESS', '', '', 'SUCCESS', { method }); return this.issueSession(admin, method)
  }
  async recoveryLogin(input) {
    const admin = await this.byUsername(input.username); let valid = false
    try { valid = Boolean(admin?.passwordHash) && await argonHash(String(input.password || ''), admin.passwordHash) === true } catch {}
    const codeHash = await digest(String(input.recoveryCode || '').toUpperCase()), code = admin && await get(this.kv, 'recovery', codeHash)
    if (!valid || !code || code.adminId !== admin.adminId || code.usedAt) throw fail('ADMIN_LOGIN_FAILED', 401)
    code.usedAt = this.now(); await put(this.kv, 'recovery', codeHash, code); await this.audit(admin.adminId, 'RECOVERY_CODE_USE', 'admin', admin.adminId); return this.issueSession(admin, 'PASSWORD_RECOVERY')
  }
  async createPrincipal(actor, input, bootstrap = false) {
    if (!bootstrap) await this.require(actor, { permission: 'admin.manage' })
    const username = clean(input.username, 80).toLowerCase(), password = String(input.password || ''), roles = [...new Set(input.roles || [])], assignment = { roles, templateScopes: [...new Set(input.templateScopes || [])], groupScopes: [...new Set(input.groupScopes || [])] }
    if (!/^[a-z0-9._-]{3,80}$/.test(username) || password.length < 12 || roles.some(x => !ADMIN_ROLES[x])) throw fail('ADMIN_INPUT_INVALID', 400)
    if (!bootstrap && !validateDelegation(actor, assignment)) throw fail('PRIVILEGE_AMPLIFICATION_DENIED')
    if (await this.byUsername(username)) throw fail('ADMIN_USERNAME_EXISTS', 409)
    const now = this.now(), admin = { adminId: `adm_${random(18)}`, username, displayName: clean(input.displayName || username, 80), status: 'ACTIVE', authzEpoch: 1, totpSecret: null, totpEnabled: false, passwordHash: await this.passwordHash(password), roles, templateScopes: assignment.templateScopes, groupScopes: assignment.groupScopes, passkeyIds: [], createdAt: now, updatedAt: now }
    await Promise.all([put(this.kv, 'principal', admin.adminId, admin), this.kv.put(key('username', username), admin.adminId)]); await this.audit(actor?.principal?.adminId || admin.adminId, bootstrap ? 'ADMIN_BOOTSTRAP' : 'ADMIN_CREATE', 'admin', admin.adminId); return publicPrincipal(admin)
  }
  async updatePrincipal(actor, targetId, input) {
    await this.require(actor, { permission: 'admin.manage' }); const target = await this.principal(targetId); if (!target) throw fail('ADMIN_NOT_FOUND', 404)
    const assignment = { roles: [...new Set(input.roles || [])], templateScopes: [...new Set(input.templateScopes || [])], groupScopes: [...new Set(input.groupScopes || [])] }
    if (!validateDelegation(actor, assignment)) throw fail('PRIVILEGE_AMPLIFICATION_DENIED')
    Object.assign(target, { status: input.status || target.status, displayName: clean(input.displayName || target.displayName, 80), ...assignment, authzEpoch: target.authzEpoch + 1, updatedAt: this.now() }); await put(this.kv, 'principal', targetId, target); await this.revokeAll(targetId); await this.audit(actor.principal.adminId, target.status === 'DISABLED' ? 'ADMIN_DISABLE' : 'SCOPE_ASSIGN', 'admin', targetId)
  }
  async revokeAll(adminId) { for (const session of await list(this.kv, 'session')) if (session.adminId === adminId && !session.revokedAt) { session.revokedAt = this.now(); await put(this.kv, 'session', session.sessionHash, session) } }
  async refreshCsrf(request) { const access = await this.authenticate(request), csrf = random(24); access.session.csrfHash = await digest(csrf); await put(this.kv, 'session', access.session.sessionHash, access.session); return csrf }
  async authOptions(username = '') {
    const admin = username ? await this.byUsername(username) : null, keys = admin ? await Promise.all((admin.passkeyIds || []).map(id => get(this.kv, 'passkey', id))) : []
    const options = { challenge:random(32),timeout:300000,rpId:this.rpId,userVerification:'required',allowCredentials:keys.filter(Boolean).map(x=>({id:x.credentialId,type:'public-key',transports:x.transports||[]})) }; await this.saveChallenge(options.challenge, admin?.adminId || null, 'AUTHENTICATE'); return options
  }
  async verifyAuthentication(response) {
    let stage='LOAD'
    try {
      const passkey = await get(this.kv, 'passkey', response.id), admin = passkey && await this.principal(passkey.adminId)
      if (!passkey || !admin || admin.status !== 'ACTIVE') throw fail('ADMIN_LOGIN_FAILED', 401)
      stage='CHALLENGE'; const challenge = await this.consumeChallenge(admin.adminId, 'AUTHENTICATE')
      stage='CLIENT'; const clientRaw=await verifyClient(response,challenge.challenge,this.origins,'webauthn.get')
      stage='AUTH_DATA'; const authData=fromB64u(response.response.authenticatorData)
      stage='RP'; if(!await rpHashValid(authData,this.rpId)||(authData[32]&5)!==5)throw fail('PASSKEY_RP_INVALID',401)
      stage='SIGNED_DATA'; const counter=new DataView(authData.buffer,authData.byteOffset+33,4).getUint32(0),signed=concat(authData,new Uint8Array(await crypto.subtle.digest('SHA-256',clientRaw)))
      stage='PUBLIC_KEY'; const material=await coseKey(fromB64u(passkey.publicKey)),signature=fromB64u(response.response.signature)
      stage='SIGNATURE'; let verified=false
      try{verified=await crypto.subtle.verify(material.verifyAlgorithm,material.key,material.ecdsa?derToRaw(signature):signature,signed)}catch{}
      if(!verified&&material.ecdsa)try{verified=await crypto.subtle.verify(material.verifyAlgorithm,material.key,signature,signed)}catch{}
      if(!verified)throw fail('PASSKEY_SIGNATURE_INVALID',401)
      if(passkey.counter&&counter<=passkey.counter)throw fail('PASSKEY_COUNTER_INVALID',401)
      stage='CREDENTIAL_SAVE'; passkey.counter=counter; passkey.lastUsedAt = this.now(); await put(this.kv, 'passkey', passkey.credentialId, passkey)
      stage='SESSION'; const session=await this.issueSession(admin, 'PASSKEY')
      try{await this.audit(admin.adminId, 'ADMIN_LOGIN_SUCCESS', '', '', 'SUCCESS', { method: 'PASSKEY' })}catch{}
      return session
    } catch(error) {
      if(error && typeof error === 'object' && 'status' in error)throw error
      throw fail(`PASSKEY_RUNTIME_${stage}`,500)
    }
  }
  async registrationOptions(admin) {
    const keys = await Promise.all((admin.passkeyIds || []).map(id => get(this.kv, 'passkey', id))), options={challenge:random(32),rp:{name:'迹录管理后台',id:this.rpId},user:{id:b64u(enc.encode(admin.adminId)),name:admin.username,displayName:admin.displayName},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],timeout:300000,attestation:'none',excludeCredentials:keys.filter(Boolean).map(x=>({id:x.credentialId,type:'public-key',transports:x.transports||[]})),authenticatorSelection:{residentKey:'preferred',userVerification:'required'}};await this.saveChallenge(options.challenge, admin.adminId, 'REGISTER'); return options
  }
  async verifyRegistration(admin, response, name) {
    const challenge=await this.consumeChallenge(admin.adminId,'REGISTER');await verifyClient(response,challenge.challenge,this.origins,'webauthn.create');const attestation=cbor(fromB64u(response.response.attestationObject)).value,authData=attestation.get('authData');if(!authData||!await rpHashValid(authData,this.rpId)||(authData[32]&69)!==69)throw fail('PASSKEY_INVALID',400);let offset=37+16,credentialLength=(authData[offset]<<8)|authData[offset+1];offset+=2;const credentialId=b64u(authData.slice(offset,offset+credentialLength));offset+=credentialLength;const parsedKey=cbor(authData,offset),publicKeyBytes=authData.slice(offset,parsedKey.offset);await coseKey(publicKeyBytes);if(credentialId!==response.id&&credentialId!==response.rawId)throw fail('PASSKEY_INVALID',400);const passkey={credentialId,adminId:admin.adminId,publicKey:b64u(publicKeyBytes),counter:new DataView(authData.buffer,authData.byteOffset+33,4).getUint32(0),transports:response.response.transports||[],deviceType:null,backedUp:Boolean(authData[32]&16),name:clean(name||'Passkey',80),createdAt:this.now(),lastUsedAt:null};admin.passkeyIds=[...new Set([...(admin.passkeyIds||[]),credentialId])];await Promise.all([put(this.kv,'passkey',credentialId,passkey),put(this.kv,'principal',admin.adminId,admin)]);await this.audit(admin.adminId,'PASSKEY_REGISTER','passkey',(await digest(credentialId)).slice(0,16))
  }
  async saveChallenge(challenge, adminId, purpose) { const value = { challenge, adminId, purpose, expiresAt: this.now() + 300000 }; await put(this.kv, 'challenge', `${purpose}:${adminId || 'discoverable'}`, value, { expirationTtl: 360 }) }
  async consumeChallenge(adminId, purpose) { const ids = [`${purpose}:${adminId}`, `${purpose}:discoverable`]; for (const id of ids) { const value = await get(this.kv, 'challenge', id); if (value && value.expiresAt > this.now()) { await remove(this.kv, 'challenge', id); return value } } throw fail('CHALLENGE_INVALID', 400) }
  async credentialKey() { return crypto.subtle.digest('SHA-256', enc.encode(String(this.env.ADMIN_CREDENTIAL_KEY || ''))) }
  async seal(value) { const iv = new Uint8Array(12); crypto.getRandomValues(iv); const k = await crypto.subtle.importKey('raw', await this.credentialKey(), 'AES-GCM', false, ['encrypt']), combined = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, enc.encode(String(value)))), tag = combined.slice(-16), body = combined.slice(0, -16); return `${b64u(iv)}.${b64u(tag)}.${b64u(body)}` }
  async open(value) { const [iv, tag, body] = String(value || '').split('.').map(fromB64u), combined = new Uint8Array(body.length + tag.length); combined.set(body); combined.set(tag, body.length); const k = await crypto.subtle.importKey('raw', await this.credentialKey(), 'AES-GCM', false, ['decrypt']); return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, combined)) }
  async verifyTotp(secret, token, time = this.now()) { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bits = [...String(secret).replace(/=+$/,'').toUpperCase()].map(c => alphabet.indexOf(c).toString(2).padStart(5,'0')).join(''), bytes = new Uint8Array(Math.floor(bits.length / 8)); for(let i=0;i<bytes.length;i++) bytes[i]=parseInt(bits.slice(i*8,i*8+8),2); const k=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-1'},false,['sign']); for(let drift=-1;drift<=1;drift++){const counter=Math.floor(time/30000)+drift,b=new ArrayBuffer(8),v=new DataView(b);v.setUint32(4,counter);const h=new Uint8Array(await crypto.subtle.sign('HMAC',k,b)),o=h[19]&15,n=((h[o]&127)<<24)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3];if(String(n%1e6).padStart(6,'0')===String(token).trim())return true} return false }
  async beginTotp(admin) { const bytes=new Uint8Array(20);crypto.getRandomValues(bytes);const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=[...bytes].map(x=>x.toString(2).padStart(8,'0')).join(''),secret='';for(let i=0;i<bits.length;i+=5)secret+=alphabet[parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];admin.totpSecret=await this.seal(secret);admin.totpEnabled=false;await put(this.kv,'principal',admin.adminId,admin);return {secret,uri:`otpauth://totp/${encodeURIComponent(`迹录管理后台:${admin.username}`)}?secret=${secret}&issuer=${encodeURIComponent('迹录管理后台')}&algorithm=SHA1&digits=6&period=30`} }
  async enableTotp(admin, token) { if(!admin.totpSecret || !await this.verifyTotp(await this.open(admin.totpSecret),token))throw fail('TOTP_INVALID',400);admin.totpEnabled=true;admin.authzEpoch++;const codes=Array.from({length:10},()=>random(9).toUpperCase());await put(this.kv,'principal',admin.adminId,admin);for(const code of codes){const codeHash=await digest(code);await put(this.kv,'recovery',codeHash,{codeHash,adminId:admin.adminId,createdAt:this.now(),usedAt:null})}await this.audit(admin.adminId,'TOTP_ENABLE','admin',admin.adminId);return codes }
}

const sessionCookie = (session, secure = true) => `jilu_admin_session=${encodeURIComponent(session.token)}; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))}${secure ? '; Secure' : ''}`
const bodyOf = async request => { try { return await request.json() } catch { throw fail('INVALID_JSON', 400) } }
const routePermission = (path, method) => {
  if (path === '/templates' && method === 'GET') return { permission: 'template.read' }
  if (path.startsWith('/templates')) return { permission: method === 'DELETE' ? 'template.disable' : path.includes('grant-') ? 'grant.user' : 'template.update' }
  if (path.startsWith('/groups')) return { permission: method === 'GET' ? 'group.read' : 'group.update' }
  if (path.startsWith('/subjects')) return { permission: method === 'GET' ? 'template.read' : 'grant.user' }
  return null
}

export const createEdgeAdminHandler = ({ kv, env, forward }) => async request => {
  const service = new EdgeAdminSecurityService({ kv, env }), url = new URL(request.url), path = url.pathname.replace(/^\/admin\/v1\/console/, ''), method = request.method
  let migrationAuthorized=false
  try {
    if (path === '/migration/import' && method === 'POST') {
      if (!env.ADMIN_MIGRATION_TOKEN) throw fail('MIGRATION_DISABLED', 404)
      const raw = await request.text(), supplied = request.headers.get('x-migration-signature') || '', expected = await hmac(env.ADMIN_MIGRATION_TOKEN, raw)
      if (!timingSafe(supplied, expected)) throw fail('MIGRATION_SIGNATURE_INVALID', 403)
      migrationAuthorized=true
      const payload = parse(raw); if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.principals)) throw fail('MIGRATION_PAYLOAD_INVALID', 400)
      if (await kv.get(key('migration', payload.migrationId))) return json({ ok: true, alreadyImported: true, migrationId: payload.migrationId })
      if (await kv.get(key('migration', 'active')) && request.headers.get('x-migration-replace') !== 'confirmed') throw fail('MIGRATION_ALREADY_COMPLETED', 409)
      const auditOffset=Math.max(0,Number(request.headers.get('x-migration-audit-offset')||0)),auditBatch=(payload.audits||[]).slice(auditOffset,auditOffset+5),includePrincipals=auditOffset===0,counts = { principals: 0, passkeys: 0, recoveryCodes: 0, audits: auditOffset }
      for (const source of includePrincipals?payload.principals:[]) {
        const admin = { adminId: source.adminId, username: clean(source.username, 80).toLowerCase(), displayName: clean(source.displayName || source.username, 80), status: source.status, authzEpoch: Number(source.authzEpoch) || 1, totpSecret: source.totpSecret || null, totpEnabled: Boolean(source.totpEnabled), passwordHash: source.passwordHash || null, roles: [...new Set(source.roles || [])].filter(x => ADMIN_ROLES[x]), templateScopes: [...new Set(source.templateScopes || [])], groupScopes: [...new Set(source.groupScopes || [])], passkeyIds: (source.passkeys || []).map(x => x.credentialId), createdAt: Number(source.createdAt) || Date.now(), updatedAt: Number(source.updatedAt) || Date.now() }
        if (!admin.adminId || !/^[a-z0-9._-]{3,80}$/.test(admin.username)) throw fail('MIGRATION_PAYLOAD_INVALID', 400)
        await Promise.all([put(kv, 'principal', admin.adminId, admin), kv.put(key('username', admin.username), admin.adminId)]); counts.principals++
        for (const passkey of source.passkeys || []) { await put(kv, 'passkey', passkey.credentialId, { ...passkey, adminId: admin.adminId }); counts.passkeys++ }
        for (const recovery of source.recoveryCodes || []) { await put(kv, 'recovery', recovery.codeHash, { ...recovery, adminId: admin.adminId }); counts.recoveryCodes++ }
      }
      for (const event of auditBatch) { const normalized={event_id:event.eventId,actor_id:event.actorId,action:event.action,resource_type:event.resourceType,resource_id:event.resourceId,result:event.result,timestamp:event.timestamp,metadata:event.metadata||{}};await put(kv, 'audit', `${String(9e15 - Number(event.timestamp)).padStart(16, '0')}:${event.eventId}`, normalized); counts.audits++ }
      if(counts.audits<(payload.audits||[]).length)return json({ok:true,migrationId:payload.migrationId,partial:true,nextAuditOffset:counts.audits,counts},202)
      const completed = { migrationId: payload.migrationId, sourceDigest: await digest(raw), completedAt: Date.now(), counts }
      await Promise.all([put(kv, 'migration', payload.migrationId, completed), put(kv, 'migration', 'active', completed)])
      return json({ ok: true, ...completed }, 201)
    }
    if (path === '/auth/password' && method === 'POST') { const session = await service.passwordLogin(await bodyOf(request)); return json({ ok: true, csrfToken: session.csrf, expiresAt: session.expiresAt, method: session.method }, 200, { 'Set-Cookie': sessionCookie(session, env.ENVIRONMENT !== 'test') }) }
    if (path === '/auth/recovery' && method === 'POST') { const session = await service.recoveryLogin(await bodyOf(request)); return json({ ok: true, csrfToken: session.csrf, expiresAt: session.expiresAt, method: session.method }, 200, { 'Set-Cookie': sessionCookie(session, env.ENVIRONMENT !== 'test') }) }
    if (path === '/auth/passkey/options' && method === 'POST') return json(await service.authOptions((await bodyOf(request)).username))
    if (path === '/auth/passkey/verify' && method === 'POST') { const session = await service.verifyAuthentication(await bodyOf(request)); return json({ ok: true, csrfToken: session.csrf, expiresAt: session.expiresAt, method: session.method }, 200, { 'Set-Cookie': sessionCookie(session, env.ENVIRONMENT !== 'test') }) }
    if (path === '/auth/csrf' && method === 'POST') return json({ ok: true, csrfToken: await service.refreshCsrf(request) })
    if (path === '/auth/logout' && method === 'POST') { const access = await service.authenticate(request, true); access.session.revokedAt = Date.now(); await put(kv, 'session', access.session.sessionHash, access.session); return new Response(null, { status: 204, headers: { 'Set-Cookie': 'jilu_admin_session=; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=0; Secure' } }) }
    const access = await service.authenticate(request, !['GET','HEAD'].includes(method))
    if (path === '/me' && method === 'GET') return json({ ok: true, admin: { adminId: access.principal.adminId, username: access.principal.username, displayName: access.principal.displayName, roles: [...access.roles], permissions: [...access.permissions], templateScopes: [...access.templateScope], groupScopes: [...access.groupScope], superAdmin: access.superAdmin, totpEnabled: Boolean(access.principal.totpEnabled), hasPassword: Boolean(access.principal.passwordHash), sessionMethod: access.session.authMethod } })
    if (path === '/dashboard' && method === 'GET') { const sessions=(await list(kv,'session')).filter(x=>!x.revokedAt&&x.expiresAt>Date.now()&&(access.superAdmin||x.adminId===access.principal.adminId)).length,templates=(await kv.list({prefix:'te_tpl_',limit:1000})).keys?.length||0,groups=(await kv.list({prefix:'te_grp_',limit:1000})).keys?.length||0;return json({ok:true,counts:{sessions,templates:access.superAdmin?templates:access.templateScope.size,groups:access.superAdmin?groups:access.groupScope.size}}) }
    if (path === '/administrators' && method === 'GET') { await service.require(access, { permission: 'admin.read' }); return json({ ok: true, items: (await list(kv, 'principal')).map(publicPrincipal) }) }
    if (path === '/administrators' && method === 'POST') return json({ ok: true, admin: await service.createPrincipal(access, await bodyOf(request)) }, 201)
    const adminMatch = path.match(/^\/administrators\/([^/]+)$/)
    if (adminMatch && method === 'PATCH') { await service.updatePrincipal(access, adminMatch[1], await bodyOf(request)); return json({ ok: true }) }
    if (adminMatch && method === 'DELETE') { if (access.principal.adminId === adminMatch[1]) throw fail('SELF_DELETE_DENIED', 409); const target = await service.principal(adminMatch[1]); if (!target) throw fail('ADMIN_NOT_FOUND', 404); await service.updatePrincipal(access, adminMatch[1], { status: 'DISABLED', displayName: target.displayName, roles: [], templateScopes: [], groupScopes: [] }); return new Response(null, { status: 204 }) }
    if (path === '/passkeys/options' && method === 'POST') return json(await service.registrationOptions(access.principal))
    if (path === '/passkeys/verify' && method === 'POST') { const b = await bodyOf(request); await service.verifyRegistration(access.principal, b.response, b.name); return json({ ok: true }) }
    if (path === '/passkeys' && method === 'GET') { const items = (await Promise.all((access.principal.passkeyIds || []).map(id => get(kv, 'passkey', id)))).filter(Boolean).map(x => ({ credential_id: x.credentialId, name: x.name, transports: x.transports, device_type: x.deviceType, backed_up: x.backedUp, created_at: x.createdAt, last_used_at: x.lastUsedAt })); return json({ ok: true, items }) }
    const passkeyMatch = path.match(/^\/passkeys\/([^/]+)$/)
    if (passkeyMatch && ['PATCH','DELETE'].includes(method)) { const candidates = (await Promise.all((access.principal.passkeyIds || []).map(id => get(kv, 'passkey', id)))).filter(Boolean), item = candidates.find(x => x.credentialId === passkeyMatch[1] || x.credentialId.startsWith(passkeyMatch[1])); if (!item) throw fail('PASSKEY_NOT_FOUND', 404); if (method === 'PATCH') { item.name = clean((await bodyOf(request)).name, 80); await put(kv, 'passkey', item.credentialId, item); return json({ ok: true }) } if (candidates.length === 1 && !access.principal.passwordHash) throw fail('LAST_AUTHENTICATOR_DELETE_DENIED', 409); await remove(kv, 'passkey', item.credentialId); access.principal.passkeyIds = access.principal.passkeyIds.filter(x => x !== item.credentialId); await put(kv, 'principal', access.principal.adminId, access.principal); return new Response(null, { status: 204 }) }
    if (path === '/sessions' && method === 'GET') return json({ ok: true, items: (await list(kv, 'session')).filter(x => x.adminId === access.principal.adminId && !x.revokedAt).map(x => ({ session_hash: x.sessionHash, auth_method: x.authMethod, created_at: x.createdAt, expires_at: x.expiresAt, last_seen_at: x.lastSeenAt })) })
    const sessionMatch=path.match(/^\/sessions\/([^/]+)$/);if(sessionMatch&&method==='DELETE'){const sessions=(await list(kv,'session')).filter(x=>x.adminId===access.principal.adminId&&!x.revokedAt),target=sessions.find(x=>x.sessionHash===sessionMatch[1]||x.sessionHash.startsWith(sessionMatch[1]));if(!target)throw fail('SESSION_NOT_FOUND',404);target.revokedAt=Date.now();await put(kv,'session',target.sessionHash,target);await service.audit(access.principal.adminId,'SESSION_REVOKE','session',target.sessionHash.slice(0,12));return new Response(null,{status:204})}
    if(path==='/totp/begin'&&method==='POST')return json({ok:true,...await service.beginTotp(access.principal)})
    if(path==='/totp/enable'&&method==='POST')return json({ok:true,recoveryCodes:await service.enableTotp(access.principal,(await bodyOf(request)).token)})
    if (path === '/audit' && method === 'GET') { await service.require(access, { permission: 'audit.read' }); return json({ ok: true, items: (await list(kv, 'audit')).slice(0, 200) }) }
    if (path === '/password/change' && method === 'POST') { const b=await bodyOf(request); if(!access.principal.passwordHash || !await argonHash(String(b.currentPassword||''),access.principal.passwordHash) || String(b.newPassword||'').length<12) throw fail('PASSWORD_CHANGE_DENIED',400); access.principal.passwordHash=await service.passwordHash(String(b.newPassword)); access.principal.authzEpoch++; access.principal.updatedAt=Date.now(); await put(kv,'principal',access.principal.adminId,access.principal); await service.revokeAll(access.principal.adminId); return json({ok:true}) }
    if (path === '/password' && method === 'DELETE') { if (!(access.principal.passkeyIds || []).length) throw fail('PASSKEY_REQUIRED',409); access.principal.passwordHash=null; access.principal.authzEpoch++; await put(kv,'principal',access.principal.adminId,access.principal); await service.revokeAll(access.principal.adminId); return new Response(null,{status:204,headers:{'Set-Cookie':'jilu_admin_session=; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=0; Secure'}}) }
    const requirement = routePermission(path, method)
    if (requirement && forward) { await service.require(access, requirement); const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${env.ADMIN_TOKEN}`); return forward(new Request(request, { headers })) }
    return json({ ok: false, code: 'NOT_FOUND' }, 404)
  } catch (error) { const problem = /** @type {any} */ (error); return json({ ok: false, code: problem.code || 'ADMIN_OPERATION_FAILED', ...(migrationAuthorized?{diagnostic:clean(problem.message||problem.name,160)}:{}) }, problem.status || 500) }
}
