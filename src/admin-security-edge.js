import { argon2idAsync } from '@noble/hashes/argon2.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ADMIN_ROLES, evaluateAdminAccess, validateDelegation } from './admin-authorization.js'
import { EdgeNotificationService } from './notification-service-edge.js'

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
const anonymousRates = new Map()
const rateGuard = (request,bucket,limit) => { const ip=request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown',key=`${bucket}|${ip}`,now=Date.now(),state=anonymousRates.get(key);if(!state||state.resetAt<=now)anonymousRates.set(key,{count:1,resetAt:now+60000});else if(++state.count>limit)throw Object.assign(fail('RATE_LIMITED',429),{retryAfter:Math.ceil((state.resetAt-now)/1000)});if(anonymousRates.size>5000)for(const [entryKey,entry] of anonymousRates)if(entry.resetAt<=now)anonymousRates.delete(entryKey) }
const validQrInput = input => /^qr_[A-Za-z0-9_-]{20,64}$/.test(String(input?.requestId||''))&&/^[A-Za-z0-9_-]{32,96}$/.test(String(input?.secret||''))
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
const listValues = async (kv, prefix) => {
  const values=[];let cursor
  do{const page=await kv.list({prefix,limit:100,...(cursor?{cursor}:{})});for(const item of page.keys||[]){const name=item.name||item.key,value=parse(await kv.get(name));if(value)values.push(value)}cursor=page.list_complete===true||page.complete===true?'':page.cursor}while(cursor)
  return values
}
const listRecords = async (kv, prefix) => {
  const records=[];let cursor
  do{const page=await kv.list({prefix,limit:100,...(cursor?{cursor}:{})});for(const item of page.keys||[]){const name=item.name||item.key,value=parse(await kv.get(name));if(value)records.push({name,value})}cursor=page.list_complete===true||page.complete===true?'':page.cursor}while(cursor)
  return records
}
const listNames = async (kv, prefix) => {
  const names=[];let cursor
  do{const page=await kv.list({prefix,limit:100,...(cursor?{cursor}:{})});names.push(...(page.keys||[]).map(item=>item.name||item.key).filter(Boolean));cursor=page.list_complete===true||page.complete===true?'':page.cursor}while(cursor)
  return names
}
const countKeys = async (kv, prefix) => {
  let count=0,cursor
  do{const page=await kv.list({prefix,limit:100,...(cursor?{cursor}:{})});count+=(page.keys||[]).length;cursor=page.list_complete===true||page.complete===true?'':page.cursor}while(cursor)
  return count
}
const timingSafe = (left, right) => {
  const a = enc.encode(String(left)), b = enc.encode(String(right)); if (a.length !== b.length) return false
  let different = 0; for (let index = 0; index < a.length; index++) different |= a[index] ^ b[index]; return different === 0
}
const pbkdf2Hash = async (password, encodedHash = '') => {
  let salt, iterations = 210000, expected
  if (encodedHash) {
    const match = String(encodedHash).match(/^\$pbkdf2-sha256\$i=(\d+)\$([^$]+)\$([^$]+)$/)
    if (!match) throw new Error('PBKDF2_HASH_INVALID')
    iterations = Number(match[1]); salt = fromB64u(match[2]); expected = match[3]
  } else { salt = new Uint8Array(16); crypto.getRandomValues(salt) }
  const result = await pbkdf2Async(sha256, enc.encode(String(password)), salt, { c: iterations, dkLen: expected ? fromB64u(expected).length : 32, asyncTick: 10 })
  const encoded = b64u(result)
  return encodedHash ? timingSafe(encoded, expected) : `$pbkdf2-sha256$i=${iterations}$${b64u(salt)}$${encoded}`
}
const argonHash = async (password, encodedHash = '') => {
  let salt, t = 2, m = 19456, p = 1, expected
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
  async passwordHash(password) {
    const pepper = String(this.env.ADMIN_CREDENTIAL_KEY || '')
    if (pepper.length < 16) throw fail('ADMIN_CREDENTIAL_KEY_REQUIRED', 500)
    const salt = random(16)
    return `$hmac-sha256$v=1$${salt}$${await hmac(pepper, `${salt}\u0000${String(password)}`)}`
  }
  async passwordVerify(password, encodedHash) {
    const value = String(encodedHash || '')
    if (value.startsWith('$hmac-sha256$')) {
      const match = value.match(/^\$hmac-sha256\$v=1\$([^$]+)\$([^$]+)$/), pepper = String(this.env.ADMIN_CREDENTIAL_KEY || '')
      if (!match || pepper.length < 16) return false
      return timingSafe(await hmac(pepper, `${match[1]}\u0000${String(password)}`), match[2])
    }
    if (value.startsWith('$pbkdf2-sha256$')) return pbkdf2Hash(String(password), value)
    return argonHash(String(password), value)
  }
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
    try { valid = Boolean(admin?.passwordHash) && await this.passwordVerify(String(input.password || ''), admin.passwordHash) === true } catch {}
    if (!valid || admin.status !== 'ACTIVE') { await this.audit(null, 'ADMIN_LOGIN_FAILURE', '', '', 'DENIED'); throw fail('ADMIN_LOGIN_FAILED', 401) }
    if (admin.totpEnabled) { if (!String(input.totp || '').trim()) throw fail('TOTP_REQUIRED', 428); if (!await this.verifyTotp(await this.open(admin.totpSecret), input.totp)) throw fail('ADMIN_LOGIN_FAILED', 401) }
    const method = admin.totpEnabled ? 'PASSWORD_TOTP' : 'PASSWORD'; await this.audit(admin.adminId, 'ADMIN_LOGIN_SUCCESS', '', '', 'SUCCESS', { method }); return this.issueSession(admin, method)
  }
  async recoveryLogin(input) {
    const admin = await this.byUsername(input.username); let valid = false
    try { valid = Boolean(admin?.passwordHash) && await this.passwordVerify(String(input.password || ''), admin.passwordHash) === true } catch {}
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
    const now = this.now(); let passwordHash
    try { passwordHash = await this.passwordHash(password) } catch { throw fail('ADMIN_CREATE_HASH_FAILED', 500) }
    const admin = { adminId: `adm_${random(18)}`, username, displayName: clean(input.displayName || username, 80), status: 'ACTIVE', authzEpoch: 1, totpSecret: null, totpEnabled: false, passwordHash, roles, templateScopes: assignment.templateScopes, groupScopes: assignment.groupScopes, passkeyIds: [], createdAt: now, updatedAt: now }
    try { await put(this.kv, 'principal', admin.adminId, admin) } catch { throw fail('ADMIN_CREATE_PRINCIPAL_WRITE_FAILED', 500) }
    try { await this.kv.put(key('username', username), admin.adminId) } catch { await remove(this.kv, 'principal', admin.adminId).catch(() => {}); throw fail('ADMIN_CREATE_USERNAME_WRITE_FAILED', 500) }
    try { await this.audit(actor?.principal?.adminId || admin.adminId, bootstrap ? 'ADMIN_BOOTSTRAP' : 'ADMIN_CREATE', 'admin', admin.adminId) } catch {}
    return publicPrincipal(admin)
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

const BACKUP_PREFIXES = Object.freeze([
  'admin:principal:', 'admin:username:', 'admin:passkey:', 'admin:recovery:',
  'subject_', 'public_', 'subject-meta_', 'id_',
  'te_tpl_', 'te_ver_', 'te_grp_', 'te_mem_', 'te_dg_', 'te_gg_',
  'te_idx_', 'te_s_tpl_', 'te_s_grp_', 'te_g_tpl_',
  'te_epoch_', 'te_audit_', 'admin:audit:'
])
const backupRecords = async kv => {
  const records = []
  for (const prefix of BACKUP_PREFIXES) {
    for (const item of await listRecords(kv, prefix)) records.push({ name: item.name, value: await kv.get(item.name) })
  }
  return records.sort((a, b) => a.name.localeCompare(b.name))
}
const packageIdentity = objectRef => {
  const match = String(objectRef || '').match(/^templates\/(tpl_[a-z0-9_-]{3,80})\/v(\d+)\/package\.jltpkg$/)
  return match ? { templateId: match[1], templateVersion: Number(match[2]) } : null
}
const byteDigest = async value => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', value)))
const BACKUP_SECTIONS = ['administrators','users','templates','groups','entitlements','audit','packages']
const backupRecordSection = name => name.startsWith('admin:audit:')||name.startsWith('te_audit_')?'audit':name.startsWith('admin:')?'administrators':name.startsWith('subject_')||name.startsWith('public_')||name.startsWith('id_')||name.startsWith('subject-meta_')?'users':name.startsWith('te_tpl_')||name.startsWith('te_ver_')||name.startsWith('te_idx_')?'templates':name.startsWith('te_grp_')||name.startsWith('te_mem_')||name.startsWith('te_s_grp_')?'groups':name.startsWith('te_dg_')||name.startsWith('te_gg_')||name.startsWith('te_s_tpl_')||name.startsWith('te_g_tpl_')||name.startsWith('te_epoch_')?'entitlements':null
const requestedBackupSections = url => { const supplied=String(url.searchParams.get('sections')||'').split(',').map(x=>x.trim()).filter(Boolean);if(supplied.some(x=>!BACKUP_SECTIONS.includes(x)))throw fail('BACKUP_SELECTION_INVALID',400);return new Set(supplied.length?supplied:BACKUP_SECTIONS) }

export const createEdgeAdminHandler = ({ kv, env, forward, forwardToken, backupStorage, waitUntil, identities }) => async request => {
  const notifications=new EdgeNotificationService({kv,env})
  const service = new EdgeAdminSecurityService({ kv, env }), url = new URL(request.url), path = url.pathname.replace(/^\/admin\/v1\/console/, ''), method = request.method
  let migrationAuthorized=false
  try {
    if (path === '/bootstrap/status' && method === 'GET') {
      const principals = await list(kv, 'principal')
      return json({ ok: true, initialized: principals.length > 0 })
    }
    if (path === '/bootstrap' && method === 'POST') {
      const expected = String(env.ADMIN_BOOTSTRAP_TOKEN || '')
      const supplied = String(request.headers.get('x-bootstrap-token') || '')
      if (!expected || !timingSafe(supplied, expected)) throw fail('BOOTSTRAP_DENIED', 403)
      if ((await list(kv, 'principal')).length) throw fail('BOOTSTRAP_CLOSED', 409)
      const admin = await service.createPrincipal(null, { ...(await bodyOf(request)), roles: ['SUPER_ADMIN'], templateScopes: [], groupScopes: [] }, true)
      return json({ ok: true, admin }, 201)
    }
    if (path === '/bootstrap/reset' && method === 'POST') {
      if (url.hostname !== 'test.shuiyin.nnu.cn') throw fail('BOOTSTRAP_RESET_DENIED', 403)
      const expected = String(env.ADMIN_BOOTSTRAP_TOKEN || ''), supplied = String(request.headers.get('x-bootstrap-token') || '')
      if (!expected || !timingSafe(supplied, expected) || request.headers.get('x-bootstrap-reset') !== 'confirmed') throw fail('BOOTSTRAP_RESET_DENIED', 403)
      const prefixes = ['admin:principal:', 'admin:username:', 'admin:passkey:', 'admin:recovery:', 'admin:session:', 'admin:challenge:', 'admin:registration:']
      let deleted = 0
      for (const prefix of prefixes) for (const name of await listNames(kv, prefix)) { await kv.delete(name); deleted++ }
      return json({ ok: true, reset: true, deleted })
    }
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
    if (path === '/auth/password' && method === 'POST') {
      const input=await bodyOf(request),ip=request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')||'local',guardId=await digest(`${clean(input.username,80).toLowerCase()}|${ip}`),guardKey=key('login-guard',guardId),now=Date.now(),guard=parse(await kv.get(guardKey));
      if(guard?.lockedUntil>now){const retryAfter=Math.ceil((guard.lockedUntil-now)/1000);return json({ok:false,code:'ADMIN_LOGIN_RATE_LIMITED',retryAfter},429,{'Retry-After':String(retryAfter)})}
      try { const session = await service.passwordLogin(input);await kv.delete(guardKey);return json({ ok: true, csrfToken: session.csrf, expiresAt: session.expiresAt, method: session.method }, 200, { 'Set-Cookie': sessionCookie(session, env.ENVIRONMENT !== 'test') }) }
      catch(error){const code=error instanceof Error&&'code'in error?String(error.code):'';if(code==='ADMIN_LOGIN_FAILED'){const fresh=!guard||now-Number(guard.firstFailure||0)>15*60_000,state=fresh?{count:1,firstFailure:now,lockedUntil:0}:{...guard,count:Number(guard.count||0)+1};if(state.count>=5)state.lockedUntil=now+Math.min(60*60_000,15*60_000*2**Math.floor((state.count-5)/5));await kv.put(guardKey,JSON.stringify(state),{expirationTtl:Math.max(960,Math.ceil(((state.lockedUntil||now+15*60_000)-now)/1000)+60)})}throw error}
    }
    if (path === '/auth/recovery' && method === 'POST') { const session = await service.recoveryLogin(await bodyOf(request)); return json({ ok: true, csrfToken: session.csrf, expiresAt: session.expiresAt, method: session.method }, 200, { 'Set-Cookie': sessionCookie(session, env.ENVIRONMENT !== 'test') }) }
    if (path === '/auth/passkey/options' && method === 'POST') return json(await service.authOptions((await bodyOf(request)).username))
    if (path === '/auth/passkey/verify' && method === 'POST') { const session = await service.verifyAuthentication(await bodyOf(request)); return json({ ok: true, csrfToken: session.csrf, expiresAt: session.expiresAt, method: session.method }, 200, { 'Set-Cookie': sessionCookie(session, env.ENVIRONMENT !== 'test') }) }
    if (path === '/auth/wechat-code' && method === 'POST') { rateGuard(request,'wechat-code',10);const input=await bodyOf(request),session=await identities.withBindingCode(input.bindingCode,async subjectId=>{const adminId=await kv.get(key('wechat-subject',subjectId));if(!adminId)throw fail('ADMIN_WECHAT_NOT_BOUND',403);const admin=await service.principal(adminId);if(!admin||admin.status!=='ACTIVE')throw fail('ADMIN_DISABLED',401);await service.audit(adminId,'ADMIN_WECHAT_LOGIN','admin',adminId);return service.issueSession(admin,'WECHAT_CODE')});return json({ok:true,csrfToken:session.csrf,expiresAt:session.expiresAt,method:session.method},200,{'Set-Cookie':sessionCookie(session,env.ENVIRONMENT!=='test')}) }
    if(path==='/auth/qr/options'&&method==='POST'){rateGuard(request,'qr-options',12);const requestId=`qr_${random(18)}`,secret=random(24),expiresAt=Date.now()+120000,record={requestId,secretHash:await digest(secret),purpose:'ADMIN',status:'PENDING',createdAt:Date.now(),expiresAt};await kv.put(`web-qr:${requestId}`,JSON.stringify(record),{expirationTtl:180});return json({ok:true,requestId,secret,purpose:'admin',expiresAt,qrContent:`https://shuiyin.nnu.cn/wx-login?request=${encodeURIComponent(requestId)}&secret=${encodeURIComponent(secret)}&purpose=admin`},201)}
    if(path==='/auth/qr/verify'&&method==='POST'){rateGuard(request,'qr-verify',100);const input=await bodyOf(request);if(!validQrInput(input))throw fail('QR_LOGIN_INVALID',404);const name=`web-qr:${clean(input.requestId,96)}`,record=parse(await kv.get(name));if(!record||record.secretHash!==await digest(input.secret)||record.purpose!=='ADMIN'||record.expiresAt<=Date.now()||record.usedAt)throw fail('QR_LOGIN_INVALID',404);if(record.status==='PENDING')return json({ok:true,pending:true,expiresAt:record.expiresAt},202);const adminId=await kv.get(key('wechat-subject',record.subjectId));if(!adminId)throw fail('ADMIN_WECHAT_NOT_BOUND',403);const admin=await service.principal(adminId);if(!admin||admin.status!=='ACTIVE')throw fail('ADMIN_DISABLED',401);record.usedAt=Date.now();record.consumptionId=random(12);await kv.put(name,JSON.stringify(record),{expirationTtl:60});if(parse(await kv.get(name))?.consumptionId!==record.consumptionId)throw fail('QR_LOGIN_CONSUMED',409);const session=await service.issueSession(admin,'WECHAT_QR');await service.audit(adminId,'ADMIN_WECHAT_QR_LOGIN','admin',adminId);return json({ok:true,csrfToken:session.csrf,expiresAt:session.expiresAt,method:session.method},200,{'Set-Cookie':sessionCookie(session,env.ENVIRONMENT!=='test')})}
    if (path === '/auth/csrf' && method === 'POST') return json({ ok: true, csrfToken: await service.refreshCsrf(request) })
    if (path === '/auth/logout' && method === 'POST') { const access = await service.authenticate(request, true); access.session.revokedAt = Date.now(); await put(kv, 'session', access.session.sessionHash, access.session); return new Response(null, { status: 204, headers: { 'Set-Cookie': 'jilu_admin_session=; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=0; Secure' } }) }
    const access = await service.authenticate(request, !['GET','HEAD'].includes(method))
    if (path === '/me' && method === 'GET') return json({ ok: true, admin: { adminId: access.principal.adminId, username: access.principal.username, displayName: access.principal.displayName, roles: [...access.roles], permissions: [...access.permissions], templateScopes: [...access.templateScope], groupScopes: [...access.groupScope], superAdmin: access.superAdmin, totpEnabled: Boolean(access.principal.totpEnabled), hasPassword: Boolean(access.principal.passwordHash), sessionMethod: access.session.authMethod, wechatBound:Boolean(await kv.get(key('wechat-admin',access.principal.adminId))) } })
    if(path==='/wechat-binding'&&method==='POST'){const input=await bodyOf(request),result=await identities.withBindingCode(input.bindingCode,async subjectId=>{const owner=await kv.get(key('wechat-subject',subjectId));if(owner&&owner!==access.principal.adminId)throw fail('ADMIN_WECHAT_ALREADY_BOUND',409);const previous=await kv.get(key('wechat-admin',access.principal.adminId));if(previous&&previous!==subjectId)await kv.delete(key('wechat-subject',previous));await Promise.all([kv.put(key('wechat-admin',access.principal.adminId),subjectId),kv.put(key('wechat-subject',subjectId),access.principal.adminId)]);await service.audit(access.principal.adminId,'ADMIN_WECHAT_BIND','admin',access.principal.adminId);return{bound:true}});return json({ok:true,...result})}
    if(path==='/wechat-binding'&&method==='DELETE'){const subjectId=await kv.get(key('wechat-admin',access.principal.adminId));await kv.delete(key('wechat-admin',access.principal.adminId));if(subjectId)await kv.delete(key('wechat-subject',subjectId));await service.audit(access.principal.adminId,'ADMIN_WECHAT_UNBIND','admin',access.principal.adminId);return new Response(null,{status:204})}
    const submissionMatch=path.match(/^\/submissions\/([^/]+)$/),submissionAction=path.match(/^\/submissions\/([^/]+)\/(approve|reject)$/)
    const clearSubmissionPackage=async record=>{for(let index=0;index<Number(record.packageChunks||0);index++)await kv.delete(`submission:package:${record.submissionId}:${index}`);record.packageChunks=0;record.packageSize=0;await kv.delete(`submission:active:${record.subjectId}`)}
    const cleanupCreatorFeedback=async()=>{const cutoff=Date.now()-30*86400000,names=await listNames(kv,'creator:inquiry:');for(const name of names){const record=parse(await kv.get(name));if(record&&Number(record.updatedAt||record.createdAt)<cutoff)await kv.delete(name)}}
    if(path==='/submissions'&&method==='GET'){await service.require(access,{permission:'template.read'});const names=await listNames(kv,'submission:record:'),items=[];for(const name of names){const record=parse(await kv.get(name));if(!record)continue;const subject=parse(await kv.get(`subject_${record.subjectId}`));items.push({...record,publicId:subject?.publicId||'未知用户'});delete items[items.length-1].statusTokenHash;delete items[items.length-1].subjectId;delete items[items.length-1].packageChunks}items.sort((a,b)=>(a.status==='PENDING'?-1:1)-(b.status==='PENDING'?-1:1)||Number(b.createdAt)-Number(a.createdAt));const inquiryNames=await listNames(kv,'creator:inquiry:'),inquiries=[];for(const name of inquiryNames){const record=parse(await kv.get(name)),subject=record&&parse(await kv.get(`subject_${record.subjectId}`));if(record)inquiries.push({...record,publicId:subject?.publicId||'未知用户'})}inquiries.sort((a,b)=>(a.status==='OPEN'?-1:1)-(b.status==='OPEN'?-1:1)||b.createdAt-a.createdAt);return json({ok:true,items:items.slice(0,500),inquiries:inquiries.slice(0,500)})}
    if(path==='/notifications/summary'&&method==='GET'){await service.require(access,{permission:'template.read'});await cleanupCreatorFeedback();const submissionNames=await listNames(kv,'submission:record:'),inquiryNames=await listNames(kv,'creator:inquiry:');let pendingSubmissions=0,openInquiries=0,latestActivityAt=0;for(const name of submissionNames){const record=parse(await kv.get(name));if(record?.status==='PENDING'){pendingSubmissions++;latestActivityAt=Math.max(latestActivityAt,Number(record.createdAt||0))}}for(const name of inquiryNames){const record=parse(await kv.get(name));if(record?.status==='OPEN'){openInquiries++;latestActivityAt=Math.max(latestActivityAt,Number(record.updatedAt||record.createdAt||0))}}return json({ok:true,pendingSubmissions,openInquiries,latestActivityAt})}
    if(path==='/notification-settings'&&method==='GET'){await service.require(access,{permission:'security.manage'});return json({ok:true,settings:await notifications.public()})}
    if(path==='/notification-settings'&&method==='PUT'){await service.require(access,{permission:'security.manage'});const settings=await notifications.save(await bodyOf(request));await service.audit(access.principal.adminId,'NOTIFICATION_SETTINGS_UPDATE','security','notifications');return json({ok:true,settings})}
    if(path==='/notification-settings/test'&&method==='POST'){await service.require(access,{permission:'security.manage'});const result=await notifications.emit('USER_INQUIRY',{source:'管理后台测试',message:'这是一条测试通知'},{force:true});await service.audit(access.principal.adminId,'NOTIFICATION_TEST','security','notifications',result.deliveries.some(x=>x.ok)?'SUCCESS':'FAILED',result);return json({ok:true,...result})}
    const inquiryAction=path.match(/^\/inquiries\/([^/]+)\/resolve$/);if(inquiryAction&&method==='POST'){await service.require(access,{permission:'template.read'});const name=`creator:inquiry:${decodeURIComponent(inquiryAction[1])}`,record=parse(await kv.get(name));if(!record)throw fail('INQUIRY_NOT_FOUND',404);const reply=clean((await bodyOf(request)).reply,1000);if(!reply)throw fail('INQUIRY_REPLY_INVALID',400);const now=Date.now();record.messages=Array.isArray(record.messages)?record.messages:[];record.messages.push({messageId:`im_${crypto.randomUUID().replaceAll('-','')}`,senderType:'ADMIN',senderId:access.principal.adminId,content:reply,createdAt:now});record.status='RESOLVED';record.resolvedAt=now;record.updatedAt=now;record.resolvedBy=access.principal.adminId;record.reply=reply;await kv.put(name,JSON.stringify(record));await service.audit(access.principal.adminId,'CREATOR_INQUIRY_REPLY','inquiry',record.inquiryId);return json({ok:true,status:'RESOLVED'})}
    if(submissionMatch&&method==='GET'){await service.require(access,{permission:'template.read'});const record=parse(await kv.get(`submission:record:${decodeURIComponent(submissionMatch[1])}`));if(!record)throw fail('SUBMISSION_NOT_FOUND',404);const chunks=await Promise.all(Array.from({length:Number(record.packageChunks||0)},(_,index)=>kv.get(`submission:package:${record.submissionId}:${index}`)));if(record.status==='PENDING'&&chunks.some(chunk=>typeof chunk!=='string'))throw fail('SUBMISSION_PACKAGE_INCOMPLETE',409);const subject=parse(await kv.get(`subject_${record.subjectId}`)),item={...record,publicId:subject?.publicId||'未知用户',template:chunks.length?parse(chunks.join('')):null};delete item.statusTokenHash;delete item.subjectId;delete item.packageChunks;return json({ok:true,item})}
    if(submissionAction&&method==='POST'){await service.require(access,{permission:'template.publish'});const record=parse(await kv.get(`submission:record:${decodeURIComponent(submissionAction[1])}`));if(!record||record.status!=='PENDING')throw fail('SUBMISSION_NOT_FOUND_OR_REVIEWED',409);const input=await bodyOf(request),approve=submissionAction[2]==='approve',reviewNote=clean(input.reviewNote,300),templateId=approve?clean(input.templateId,96):'';if(approve&&!templateId)throw fail('INVALID_TEMPLATE_ID',400);if(approve&&record.upgradeTemplateId&&templateId!==record.upgradeTemplateId)throw fail('SUBMISSION_UPGRADE_TARGET_MISMATCH',409);if(!approve&&!reviewNote)throw fail('SUBMISSION_REJECTION_REASON_REQUIRED',400);let template=null;if(approve){template=parse(await kv.get(`te_tpl_${templateId}`));const version=template&&!template.deletedAt&&Number(template.latestVersion)>0?parse(await kv.get(`te_ver_${templateId}_${Number(template.latestVersion)}`)):null;if(!template||template.deletedAt||Number(template.latestVersion)<1||version?.status!=='PUBLISHED')throw fail('SUBMISSION_TEMPLATE_NOT_PUBLISHED',409);if(!record.upgradeTemplateId){const subject=parse(await kv.get(`subject_${record.subjectId}`));if(template.contributionType!=='USER_SUBMISSION'||template.creatorPublicId!==subject?.publicId)throw fail('SUBMISSION_PUBLISH_TARGET_MISMATCH',409)}}if(approve&&record.upgradeTemplateId){const keepVersion=Number(template?.latestVersion||0),versionNames=(await kv.list({prefix:`te_ver_${templateId}_`})).keys||[],removedVersions=[];for(const item of versionNames){const name=item.name||item.key,version=parse(await kv.get(name)),number=Number(version?.templateVersion||name.slice(`te_ver_${templateId}_`.length));if(number>=keepVersion)continue;await kv.delete(name);await backupStorage?.deletePackage?.(templateId,number);const chunks=(await kv.list({prefix:`te_pkg_${templateId}_${number}_`})).keys||[];for(const chunk of chunks)await kv.delete(chunk.name||chunk.key);removedVersions.push(number)}await service.audit(access.principal.adminId,'TEMPLATE_VERSION_HISTORY_PRUNE','template',templateId,'SUCCESS',{keepVersion,removedVersions})}record.status=approve?'APPROVED':'REJECTED';record.reviewedAt=Date.now();record.reviewedBy=access.principal.adminId;record.reviewNote=reviewNote||(approve?'审核通过并发布':'');record.publishedTemplateId=approve?templateId:null;await clearSubmissionPackage(record);await kv.put(`submission:record:${record.submissionId}`,JSON.stringify(record));try{await service.audit(access.principal.adminId,approve?'TEMPLATE_SUBMISSION_APPROVE':'TEMPLATE_SUBMISSION_REJECT','submission',record.submissionId,'SUCCESS',{templateId:record.publishedTemplateId})}catch(error){console.warn('submission audit write failed',error?.code||error?.message||error)}return json({ok:true,status:record.status,templateId:record.publishedTemplateId,packageDeleted:true})}
    if (path === '/dashboard' && method === 'GET') { const sessions=(await list(kv,'session')).filter(x=>!x.revokedAt&&x.expiresAt>Date.now()&&(access.superAdmin||x.adminId===access.principal.adminId)).length,templates=(await listValues(kv,'te_tpl_')).filter(x=>!x.deletedAt).length,groups=(await listValues(kv,'te_grp_')).filter(x=>!x.deletedAt).length;return json({ok:true,counts:{sessions,templates:access.superAdmin?templates:access.templateScope.size,groups:access.superAdmin?groups:access.groupScope.size}}) }
    if (path === '/backup/status' && method === 'GET') return json({ ok: true, available: access.superAdmin, canExport: access.superAdmin, canRestore: access.superAdmin, packageStorage: Boolean(backupStorage), schemaVersion: 1, sections: backupStorage ? BACKUP_SECTIONS : BACKUP_SECTIONS.filter(section => section !== 'packages') })
    if (path === '/backup/export' && method === 'GET') {
      if (!access.superAdmin) throw fail('ADMIN_SCOPE_DENIED', 403)
      const selection=requestedBackupSections(url)
      const packages = selection.has('packages')&&backupStorage ? (await backupStorage.listPackages()).map(x => packageIdentity(x.objectRef)).filter(Boolean) : []
      const records = (await backupRecords(kv)).filter(record=>{const section=backupRecordSection(record.name);return section!==null&&selection.has(section)})
      await service.audit(access.principal.adminId, 'BACKUP_EXPORT', 'system', 'full')
      return json({ ok: true, format: 'jilu-admin-backup', schemaVersion: 1, exportedAt: Date.now(), selection:[...selection], records, packages })
    }
    const backupPackage = path.match(/^\/backup\/packages\/(tpl_[a-z0-9_-]{3,80})\/(\d+)$/)
    if (backupPackage && method === 'GET') {
      if (!access.superAdmin) throw fail('ADMIN_SCOPE_DENIED', 403)
      const raw = await backupStorage?.getPackage(backupPackage[1], Number(backupPackage[2]))
      if (!raw) throw fail('TEMPLATE_VERSION_NOT_FOUND', 404)
      return new Response(raw, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(raw.byteLength), 'x-content-sha256': await byteDigest(raw) } })
    }
    if (path === '/backup/restore/records' && method === 'POST') {
      if (!access.superAdmin) throw fail('ADMIN_SCOPE_DENIED', 403)
      const input = await bodyOf(request), records = Array.isArray(input.records) ? input.records : []
      if (!records.length || records.length > 50) throw fail('BACKUP_PAYLOAD_INVALID', 400)
      for (const record of records) {
        if (!BACKUP_PREFIXES.some(prefix => String(record.name || '').startsWith(prefix)) || typeof record.value !== 'string') throw fail('BACKUP_PAYLOAD_INVALID', 400)
        if (record.value.length > 950_000) throw fail('BACKUP_PAYLOAD_INVALID', 400)
        if (String(record.name).startsWith('admin:principal:')) {
          const source=parse(record.value),mappedId=source?.username&&await kv.get(key('username',clean(source.username,80).toLowerCase()))
          if(mappedId&&mappedId!==source.adminId){const previous=await service.principal(mappedId);if(previous){previous.username=`restore-retired-${String(mappedId).slice(-32)}`;previous.status='DISABLED';previous.authzEpoch=Number(previous.authzEpoch||0)+1;previous.updatedAt=Date.now();await Promise.all([put(kv,'principal',mappedId,previous),kv.put(key('username',previous.username),mappedId)])}}
        }
        await kv.put(record.name, record.value)
      }
      await service.audit(access.principal.adminId, 'BACKUP_RESTORE_RECORDS', 'system', 'full', 'SUCCESS', { count: records.length })
      return json({ ok: true, restored: records.length })
    }
    const restorePackage = path.match(/^\/backup\/restore\/packages\/(tpl_[a-z0-9_-]{3,80})\/(\d+)$/)
    if (restorePackage && method === 'POST') {
      if (!access.superAdmin) throw fail('ADMIN_SCOPE_DENIED', 403)
      if (!backupStorage) throw fail('OBJECT_STORAGE_NOT_CONFIGURED', 503)
      const raw = new Uint8Array(await request.arrayBuffer()), expected = String(request.headers.get('x-content-sha256') || '')
      if (!raw.byteLength || !expected || !timingSafe(await byteDigest(raw), expected)) throw fail('BACKUP_PACKAGE_INVALID', 400)
      const existing=await backupStorage.getPackage(restorePackage[1], Number(restorePackage[2]))
      if (existing) { if(!timingSafe(await byteDigest(existing),expected))throw fail('BACKUP_PACKAGE_CONFLICT',409);return json({ ok: true, alreadyPresent: true }) }
      await backupStorage.putPackage(restorePackage[1], Number(restorePackage[2]), raw)
      await service.audit(access.principal.adminId, 'BACKUP_RESTORE_PACKAGE', 'template', restorePackage[1], 'SUCCESS', { templateVersion: Number(restorePackage[2]), size: raw.byteLength })
      return json({ ok: true, restored: true }, 201)
    }
    if(path==='/subjects'&&method==='GET'){
      await service.require(access,{permission:'template.read'})
      const subjects=await listValues(kv,'subject_'),direct=access.superAdmin?[]:await listValues(kv,'te_dg_'),memberships=access.superAdmin?[]:await listValues(kv,'te_mem_'),visible=new Set()
      if(!access.superAdmin){for(const grant of direct)if(access.templateScope.has(grant.templateId))visible.add(grant.subjectId);for(const membership of memberships)if(access.groupScope.has(membership.groupId))visible.add(membership.subjectId)}
      const selected=subjects.filter(subject=>access.superAdmin||visible.has(subject.subjectId)),items=await Promise.all(selected.map(async subject=>{const metadata=await get(kv,'subject-meta',subject.subjectId);const remarkName=clean(metadata?.remarkName,80);return{publicId:subject.publicId,remarkName,displayName:remarkName||subject.publicId,status:subject.status,internal:Boolean(subject.internal),createdAt:subject.createdAt,lastSeenAt:subject.lastSeenAt}}))
      items.sort((a,b)=>Number(b.lastSeenAt||0)-Number(a.lastSeenAt||0));return json({ok:true,items})
    }
    const subjectMatch=path.match(/^\/subjects\/([^/]+)$/),subjectAccessMatch=path.match(/^\/subjects\/([^/]+)\/access$/)
    if(subjectAccessMatch&&method==='GET'){
      await service.require(access,{permission:'template.read'});const publicId=decodeURIComponent(subjectAccessMatch[1]),subjectId=await kv.get(`public_${publicId}`),subject=subjectId&&parse(await kv.get(`subject_${subjectId}`));if(!subject)throw fail('SUBJECT_NOT_FOUND',404)
      const directGrants=(await listValues(kv,`te_dg_${subjectId}_`)).filter(item=>access.superAdmin||access.templateScope.has(item.templateId)),memberships=(await listValues(kv,`te_mem_${subjectId}_`)).filter(item=>access.superAdmin||access.groupScope.has(item.groupId)),groupGrants=(await listValues(kv,'te_gg_')).filter(item=>memberships.some(member=>member.groupId===item.groupId)&&(access.superAdmin||access.templateScope.has(item.templateId))),metadata=await get(kv,'subject-meta',subjectId),remarkName=clean(metadata?.remarkName,80)
      return json({ok:true,subject:{publicId:subject.publicId,remarkName,displayName:remarkName||subject.publicId,status:subject.status,createdAt:subject.createdAt,lastSeenAt:subject.lastSeenAt},directGrants,memberships,groupGrants})
    }
    if(subjectMatch&&method==='PATCH'){
      await service.require(access,{permission:'grant.user'});const publicId=decodeURIComponent(subjectMatch[1]),subjectId=await kv.get(`public_${publicId}`),subject=subjectId&&parse(await kv.get(`subject_${subjectId}`));if(!subject)throw fail('SUBJECT_NOT_FOUND',404);const remarkName=clean((await bodyOf(request)).remarkName,80).trim();await put(kv,'subject-meta',subjectId,{remarkName,updatedBy:access.principal.adminId,updatedAt:Date.now()});try{await service.audit(access.principal.adminId,'SUBJECT_REMARK_UPDATE','subject',publicId,'SUCCESS',{remarkName})}catch{}return json({ok:true,subject:{publicId,remarkName,displayName:remarkName||publicId}})
    }
    if(subjectMatch&&method==='DELETE'){
      await service.require(access,{permission:'grant.user'});const publicId=decodeURIComponent(subjectMatch[1]).toUpperCase(),subjectId=await kv.get(`public_${publicId}`),subject=subjectId&&parse(await kv.get(`subject_${subjectId}`));if(!subject)throw fail('SUBJECT_NOT_FOUND',404);if(subject.internal)throw fail('INTERNAL_SUBJECT_DELETE_DENIED',409);const now=Date.now();subject.status='disabled';subject.updatedAt=now;await kv.put(`subject_${subjectId}`,JSON.stringify(subject));for(const record of await listRecords(kv,'session_'))if(record.value.subjectId===subjectId&&!record.value.revokedAt){record.value.revokedAt=now;await kv.put(record.name,JSON.stringify(record.value))}for(const grant of await listValues(kv,`te_dg_${subjectId}_`))if(grant.enabled!==false&&!grant.revokedAt){grant.enabled=false;grant.revokedAt=now;grant.revokedBy=access.principal.adminId;await kv.put(`te_dg_${subjectId}_${grant.templateId}`,JSON.stringify(grant))}for(const membership of await listValues(kv,`te_mem_${subjectId}_`))if(membership.enabled!==false&&!membership.revokedAt){membership.enabled=false;membership.revokedAt=now;membership.revokedBy=access.principal.adminId;await kv.put(`te_mem_${subjectId}_${membership.groupId}`,JSON.stringify(membership))}try{await service.audit(access.principal.adminId,'SUBJECT_DELETE','subject',publicId)}catch{}return new Response(null,{status:204})
    }
    if (path === '/administrators' && method === 'GET') { await service.require(access, { permission: 'admin.read' }); return json({ ok: true, items: (await list(kv, 'principal')).map(publicPrincipal) }) }
    if (path === '/administrators' && method === 'POST') return json({ ok: true, admin: await service.createPrincipal(access, await bodyOf(request)) }, 201)
    const adminMatch = path.match(/^\/administrators\/([^/]+)$/)
    if (adminMatch && method === 'PATCH') { await service.updatePrincipal(access, adminMatch[1], await bodyOf(request)); return json({ ok: true }) }
    if (adminMatch && method === 'DELETE') {
      await service.require(access, { permission: 'admin.manage' }); if (access.principal.adminId === adminMatch[1]) throw fail('SELF_DELETE_DENIED', 409)
      const target = await service.principal(adminMatch[1]); if (!target) throw fail('ADMIN_NOT_FOUND', 404); if (!access.superAdmin && (target.roles || []).includes('SUPER_ADMIN')) throw fail('PRIVILEGE_AMPLIFICATION_DENIED', 403)
      for (const passkeyId of target.passkeyIds || []) await remove(kv, 'passkey', passkeyId)
      for (const session of await list(kv, 'session')) if (session.adminId === target.adminId) await remove(kv, 'session', session.sessionHash)
      for (const recovery of await list(kv, 'recovery')) if (recovery.adminId === target.adminId) await remove(kv, 'recovery', recovery.codeHash)
      for (const challenge of await list(kv, 'challenge')) if (challenge.adminId === target.adminId) await remove(kv, 'challenge', `${challenge.purpose}:${target.adminId}`)
      await kv.delete(key('username', target.username)); await remove(kv, 'principal', target.adminId); await service.audit(access.principal.adminId, 'ADMIN_DELETE', 'admin', target.adminId)
      return new Response(null, { status: 204 })
    }
    if (path === '/passkeys/options' && method === 'POST') return json(await service.registrationOptions(access.principal))
    if (path === '/passkeys/verify' && method === 'POST') { const b = await bodyOf(request); await service.verifyRegistration(access.principal, b.response, b.name); return json({ ok: true }) }
    if (path === '/passkeys' && method === 'GET') { const stored = (await Promise.all((access.principal.passkeyIds || []).map(id => get(kv, 'passkey', id)))).filter(Boolean), items = await Promise.all(stored.map(async x => ({ credential_id: (await digest(x.credentialId)).slice(0,16), name: x.name, transports: x.transports, device_type: x.deviceType, backed_up: x.backedUp, created_at: x.createdAt, last_used_at: x.lastUsedAt }))); return json({ ok: true, items }) }
    const passkeyMatch = path.match(/^\/passkeys\/([^/]+)$/)
    if (passkeyMatch && ['PATCH','DELETE'].includes(method)) { const candidates = (await Promise.all((access.principal.passkeyIds || []).map(id => get(kv, 'passkey', id)))).filter(Boolean), hashes=await Promise.all(candidates.map(async x=>({item:x,hash:await digest(x.credentialId)}))), item = hashes.find(x => x.item.credentialId === passkeyMatch[1] || x.hash.startsWith(passkeyMatch[1]))?.item; if (!item) throw fail('PASSKEY_NOT_FOUND', 404); if (method === 'PATCH') { item.name = clean((await bodyOf(request)).name, 80); await put(kv, 'passkey', item.credentialId, item); await service.audit(access.principal.adminId,'PASSKEY_RENAME','passkey',passkeyMatch[1]);return json({ ok: true }) } if (candidates.length === 1 && !access.principal.totpEnabled) throw fail('LAST_STRONG_CREDENTIAL', 409); await remove(kv, 'passkey', item.credentialId); access.principal.passkeyIds = access.principal.passkeyIds.filter(x => x !== item.credentialId); await put(kv, 'principal', access.principal.adminId, access.principal);await service.audit(access.principal.adminId,'PASSKEY_REVOKE','passkey',passkeyMatch[1]); return new Response(null, { status: 204 }) }
    if (path === '/sessions' && method === 'GET') return json({ ok: true, items: (await list(kv, 'session')).filter(x => x.adminId === access.principal.adminId && !x.revokedAt).map(x => ({ session_hash: x.sessionHash, auth_method: x.authMethod, created_at: x.createdAt, expires_at: x.expiresAt, last_seen_at: x.lastSeenAt })) })
    const sessionMatch=path.match(/^\/sessions\/([^/]+)$/);if(sessionMatch&&method==='DELETE'){const sessions=(await list(kv,'session')).filter(x=>x.adminId===access.principal.adminId&&!x.revokedAt),target=sessions.find(x=>x.sessionHash===sessionMatch[1]||x.sessionHash.startsWith(sessionMatch[1]));if(!target)throw fail('SESSION_NOT_FOUND',404);target.revokedAt=Date.now();await put(kv,'session',target.sessionHash,target);await service.audit(access.principal.adminId,'SESSION_REVOKE','session',target.sessionHash.slice(0,12));return new Response(null,{status:204})}
    if(path==='/totp/begin'&&method==='POST')return json({ok:true,...await service.beginTotp(access.principal)})
    if(path==='/totp/enable'&&method==='POST')return json({ok:true,recoveryCodes:await service.enableTotp(access.principal,(await bodyOf(request)).token)})
    if (path === '/audit' && method === 'GET') { await service.require(access, { permission: 'audit.read' }); const entitlement=(await listValues(kv,'te_audit_')).map(x=>({event_id:x.eventId,actor_id:x.actorId||'admin',action:x.eventType||'ENTITLEMENT_EVENT',resource_type:x.templateId?'template':x.groupId?'group':x.subjectId?'subject':null,resource_id:x.templateId||x.groupId||x.subjectId||null,result:'SUCCESS',timestamp:x.timestamp,metadata:{templateVersion:x.templateVersion||null,reason:x.reason||null}}));let items=[...(await list(kv,'audit')), ...entitlement].sort((a,b)=>Number(b.timestamp||0)-Number(a.timestamp||0)).slice(0,200);if(!access.superAdmin)items=items.filter(x=>!x.resource_id||(x.resource_type==='template'&&access.templateScope.has(x.resource_id))||(x.resource_type==='group'&&access.groupScope.has(x.resource_id))||x.actor_id===access.principal.adminId);return json({ ok: true, items }) }
    if (path === '/audit' && method === 'DELETE') { if(!access.superAdmin)throw fail('ADMIN_SCOPE_DENIED',403);const names=[...await listNames(kv,'admin:audit:'),...await listNames(kv,'te_audit_')];for(const name of names)await kv.delete(name);await service.audit(access.principal.adminId,'AUDIT_CLEAR','system','audit','SUCCESS',{deleted:names.length});return json({ok:true,deleted:names.length}) }
    if (path === '/password/change' && method === 'POST') { const b=await bodyOf(request),hasPassword=Boolean(access.principal.passwordHash),verified=hasPassword?await service.passwordVerify(String(b.currentPassword||''),access.principal.passwordHash):access.session.authMethod==='PASSKEY'; if(!verified || String(b.newPassword||'').length<12) throw fail('PASSWORD_CHANGE_DENIED',400); access.principal.passwordHash=await service.passwordHash(String(b.newPassword)); access.principal.authzEpoch++; access.principal.updatedAt=Date.now(); await put(kv,'principal',access.principal.adminId,access.principal); await service.revokeAll(access.principal.adminId); await service.audit(access.principal.adminId,hasPassword?'PASSWORD_CHANGE':'PASSWORD_SET','admin',access.principal.adminId); return json({ok:true}) }
    if (path === '/password' && method === 'DELETE') { if (!(access.principal.passkeyIds || []).length) throw fail('PASSKEY_REQUIRED',409); access.principal.passwordHash=null; access.principal.authzEpoch++; await put(kv,'principal',access.principal.adminId,access.principal); await service.revokeAll(access.principal.adminId); return new Response(null,{status:204,headers:{'Set-Cookie':'jilu_admin_session=; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=0; Secure'}}) }
    const forwardAdmin = async (targetPath, targetMethod = method, payload) => {
      if (!forward) throw fail('ADMIN_ROUTE_UNAVAILABLE', 503)
      const headers = new Headers(request.headers)
      headers.set('authorization', `Bearer ${forwardToken || env.ADMIN_TOKEN}`)
      headers.set('x-jilu-admin-actor', access.principal.adminId)
      headers.set('content-type', 'application/json')
      const url = new URL(request.url); url.pathname = `/admin/v1/console${targetPath}`
      return forward(new Request(url, { method: targetMethod, headers, ...(payload === undefined || ['GET','HEAD','DELETE'].includes(targetMethod) ? {} : { body: JSON.stringify(payload) }) }))
    }
    const uploadChunk = path.match(/^\/uploads\/([a-zA-Z0-9_-]{8,128})\/chunks\/(\d+)$/)
    if (uploadChunk && method === 'POST') {
      const input = await bodyOf(request), index = Number(uploadChunk[2]), total = Number(input.total)
      const targetPath = String(input.targetPath || '')
      const target = targetPath.match(/^\/templates\/([^/]+)\/versions(?:\/\d+\/commit-prepared)?$/)
      const atomic = targetPath === '/templates/atomic-publish'
      if ((!target && !atomic) || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total || total < 1 || total > 64 || typeof input.chunk !== 'string' || input.chunk.length > 128000) throw fail('INVALID_UPLOAD_CHUNK', 400)
      await service.require(access, { permission: 'template.publish', ...(target ? { templateId: decodeURIComponent(target[1]) } : {}) })
      await kv.put(`admin_upload_${uploadChunk[1]}_meta`, JSON.stringify({ targetPath, total, adminId: access.principal.adminId, createdAt: Date.now() }))
      await kv.put(`admin_upload_${uploadChunk[1]}_${index}`, input.chunk)
      return json({ ok: true, index, total })
    }
    const uploadCommit = path.match(/^\/uploads\/([a-zA-Z0-9_-]{8,128})\/commit$/)
    if (uploadCommit && method === 'POST') {
      const prefix = `admin_upload_${uploadCommit[1]}`, meta = parse(await kv.get(`${prefix}_meta`))
      if (!meta || meta.adminId !== access.principal.adminId || Date.now() - Number(meta.createdAt || 0) > 30 * 60_000) throw fail('UPLOAD_SESSION_INVALID', 404)
      const target = String(meta.targetPath).match(/^\/templates\/([^/]+)\/versions$/)
      await service.require(access, { permission: 'template.publish', ...(target ? { templateId: decodeURIComponent(target[1]) } : {}) })
      const chunks = await Promise.all(Array.from({ length: Number(meta.total) }, (_, index) => kv.get(`${prefix}_${index}`)))
      if (chunks.some(chunk => typeof chunk !== 'string')) throw fail('UPLOAD_CHUNK_MISSING', 409)
      let payload
      try { payload = JSON.parse(chunks.join('')) } catch { throw fail('INVALID_JSON', 400) }
      const response = await forwardAdmin(meta.targetPath, 'POST', payload)
      if (response.ok) {
        await Promise.all([kv.delete(`${prefix}_meta`), ...chunks.map((_, index) => kv.delete(`${prefix}_${index}`))])
      }
      return response
    }
    const asyncPublish = path.match(/^\/templates\/([^/]+)\/versions\/(\d+)\/publish-async$/)
    if (asyncPublish && method === 'POST') {
      const templateId = decodeURIComponent(asyncPublish[1]), templateVersion = Number(asyncPublish[2])
      await service.require(access, { permission: 'template.publish', templateId })
      if (typeof waitUntil !== 'function') throw fail('ASYNC_PUBLISH_UNAVAILABLE', 503)
      const jobId = crypto.randomUUID(), key = `admin_publish_job_${jobId}`
      await kv.put(key, JSON.stringify({ jobId, templateId, templateVersion, adminId: access.principal.adminId, status: 'PENDING', createdAt: Date.now() }))
      waitUntil((async () => {
        try {
          const response = await forwardAdmin(`/templates/${encodeURIComponent(templateId)}/versions/${templateVersion}/publish`, 'POST', {})
          const result = /** @type {any} */ (await response.clone().json().catch(() => ({})))
          await kv.put(key, JSON.stringify({ jobId, templateId, templateVersion, adminId: access.principal.adminId, status: response.ok ? 'SUCCEEDED' : 'FAILED', code: response.ok ? null : result.code || `HTTP_${response.status}`, completedAt: Date.now() }))
        } catch (error) {
          const errorCode = /** @type {any} */ (error)?.code || 'PUBLISH_JOB_FAILED'
          await kv.put(key, JSON.stringify({ jobId, templateId, templateVersion, adminId: access.principal.adminId, status: 'FAILED', code: errorCode, completedAt: Date.now() }))
        }
      })())
      return json({ ok: true, jobId, status: 'PENDING' }, 202)
    }
    const publishJob = path.match(/^\/publish-jobs\/([a-f0-9-]{20,80})$/)
    if (publishJob && method === 'GET') {
      const job = parse(await kv.get(`admin_publish_job_${publishJob[1]}`))
      if (!job || job.adminId !== access.principal.adminId) throw fail('PUBLISH_JOB_NOT_FOUND', 404)
      return json({ ok: true, job })
    }
    if (path === '/publish-jobs' && method === 'GET') {
      const items = (await listValues(kv, 'admin_publish_job_'))
        .filter(job => job?.adminId === access.principal.adminId)
        .sort((a, b) => Number(b.createdAt || b.completedAt || 0) - Number(a.createdAt || a.completedAt || 0))
        .slice(0, 20)
      return json({ ok: true, items })
    }
    const subjectForPublicId = async publicId => {
      const normalized = decodeURIComponent(publicId).toUpperCase(), subjectId = await kv.get(`public_${normalized}`), subject = subjectId && parse(await kv.get(`subject_${subjectId}`))
      if (!subject) throw fail('SUBJECT_NOT_FOUND', 404)
      return subject
    }
    const templateToggle = path.match(/^\/templates\/([^/]+)\/(enable|disable)$/)
    if (templateToggle && method === 'POST') {
      await service.require(access, { permission: 'template.disable', templateId: templateToggle[1] })
      return forwardAdmin(`/templates/${templateToggle[1]}`, 'PATCH', templateToggle[2] === 'enable' ? { enabled: true, archivedAt: null, lifecycleStatus: 'ACTIVE' } : { enabled: false, lifecycleStatus: 'DISABLED' })
    }
    const recoverPublish = path.match(/^\/templates\/([^/]+)\/versions\/(\d+)\/recover-publish$/)
    if (recoverPublish && method === 'POST') {
      await service.require(access, { permission: 'template.publish', templateId: recoverPublish[1] })
      return forwardAdmin(path, 'POST', await bodyOf(request))
    }
    const stagedPublish = path.match(/^\/templates\/([^/]+)\/versions\/(\d+)\/(prepare-publish|commit-prepared|prepare-client-publish|commit-client-publish)$/)
    if (stagedPublish && method === 'POST') {
      await service.require(access, { permission: 'template.publish', templateId: decodeURIComponent(stagedPublish[1]) })
      return forwardAdmin(path, 'POST', await bodyOf(request))
    }
    const packageChunk = path.match(/^\/templates\/([^/]+)\/versions\/(\d+)\/package-chunks\/(\d+)$/)
    if (packageChunk && method === 'POST') {
      const templateId = decodeURIComponent(packageChunk[1]), templateVersion = Number(packageChunk[2]), index = Number(packageChunk[3]), input = await bodyOf(request)
      await service.require(access, { permission: 'template.publish', templateId })
      const meta = parse(await kv.get(`te_prepared_${input.prepareId}_meta`))
      if (!meta?.client || meta.actorId !== access.principal.adminId || meta.templateId !== templateId || Number(meta.templateVersion) !== templateVersion || !Number.isInteger(index) || index < 0 || index >= 128 || typeof input.chunk !== 'string' || input.chunk.length > 90000) throw fail('PUBLISH_CHUNK_INVALID', 400)
      await kv.put(`te_pkg_${templateId}_${templateVersion}_${index}`, input.chunk)
      return json({ ok: true, index })
    }
    const staleVersion = path.match(/^\/templates\/([^/]+)\/versions\/(\d+)\/stale$/)
    if (staleVersion && method === 'DELETE') {
      const templateId = decodeURIComponent(staleVersion[1]), templateVersion = Number(staleVersion[2])
      await service.require(access, { permission: 'template.publish', templateId })
      const template = parse(await kv.get(`te_tpl_${templateId}`))
      const version = parse(await kv.get(`te_ver_${templateId}_${templateVersion}`))
      if (!template || !version) throw fail('TEMPLATE_VERSION_NOT_FOUND', 404)
      if (Number(template.latestVersion || 0) >= templateVersion) throw fail('TEMPLATE_VERSION_DELETE_UNSAFE', 409)
      await kv.delete(`te_ver_${templateId}_${templateVersion}`)
      await backupStorage?.deletePackage?.(templateId, templateVersion)
      await service.audit(access.principal.adminId, 'TEMPLATE_STALE_VERSION_DELETE', 'template', `${templateId}:v${templateVersion}`)
      return new Response(null, { status: 204 })
    }
    if (path === '/templates' && method === 'GET') {
      await service.require(access, { permission: 'template.read' })
      const response = await forwardAdmin('/templates', 'GET'), result = await response.json()
      const direct = await listValues(kv, 'te_dg_'), grouped = await listValues(kv, 'te_gg_')
      result.items = await Promise.all((result.items || []).map(async item => {
        let preview = item.preview || null, previewImage = item.previewImage || null
        try {
          const raw = await backupStorage?.getPackage(item.templateId, Number(item.latestVersion || 0))
          const bundle = raw && JSON.parse(dec.decode(raw))
          const layoutPath = bundle?.manifest?.layout?.path || 'layout.json'
          const encodedLayout = bundle?.files?.[layoutPath]
          if (encodedLayout) preview ||= JSON.parse(dec.decode(fromB64u(encodedLayout)))
          else if (bundle?.manifest?.layout && !bundle.manifest.layout.path) preview ||= bundle.manifest.layout
          const asset = (bundle?.manifest?.assets || []).find(value => String(value.mimeType || '').startsWith('image/') && bundle.files?.[value.path])
          if (asset) {
            const encoded = String(bundle.files[asset.path]).replace(/-/g, '+').replace(/_/g, '/')
            previewImage = `data:${asset.mimeType};base64,${encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')}`
          }
        } catch {}
        return { ...item, preview, previewImage, authorizationCount: direct.filter(x => x.templateId === item.templateId && x.enabled !== false && !x.revokedAt).length + grouped.filter(x => x.templateId === item.templateId && x.enabled !== false && !x.revokedAt).length }
      }))
      return json(result, response.status)
    }
    const legacyGrantUser = path.match(/^\/templates\/([^/]+)\/grant-user(?:\/([^/]+))?$/)
    if (legacyGrantUser) {
      await service.require(access, { permission: method === 'DELETE' ? 'grant.revoke' : 'grant.user', templateId: legacyGrantUser[1] })
      if (method === 'POST') return forwardAdmin(`/templates/${legacyGrantUser[1]}/user-grants`, 'POST', await bodyOf(request))
      if (method === 'DELETE' && legacyGrantUser[2]) { const subject = await subjectForPublicId(legacyGrantUser[2]); return forwardAdmin(`/templates/${legacyGrantUser[1]}/user-grants/${subject.subjectId}`, 'DELETE') }
    }
    const legacyGrantGroup = path.match(/^\/templates\/([^/]+)\/grant-group(?:\/([^/]+))?$/)
    if (legacyGrantGroup) {
      const input = method === 'POST' ? await bodyOf(request) : {}, groupId = legacyGrantGroup[2] || input.groupId
      await service.require(access, { permission: method === 'DELETE' ? 'grant.revoke' : 'grant.group', templateId: legacyGrantGroup[1], groupId })
      if (method === 'POST') return forwardAdmin(`/templates/${legacyGrantGroup[1]}/group-grants`, 'POST', input)
      if (method === 'DELETE' && groupId) return forwardAdmin(`/templates/${legacyGrantGroup[1]}/group-grants/${groupId}`, 'DELETE')
    }
    if (path === '/groups' && method === 'POST') {
      await service.require(access, { permission: 'group.create' })
      const input = await bodyOf(request), subjects = await Promise.all([...(new Set(input.initialMembers || []))].map(subjectForPublicId))
      const createdResponse = await forwardAdmin('/groups', 'POST', { name: input.name, enabled: input.enabled }), created = await createdResponse.json(), groupId = created.group?.groupId || created.item?.groupId
      for (const subject of subjects) await forwardAdmin(`/groups/${groupId}/members`, 'POST', { subjectId: subject.subjectId, expiresAt: input.expiresAt || null })
      return json({ ...created, initialMemberCount: subjects.length }, createdResponse.status)
    }
    const groupDetail = path.match(/^\/groups\/([^/]+)\/detail$/)
    if (groupDetail && method === 'GET') {
      await service.require(access, { permission: 'group.read', groupId: groupDetail[1] })
      const response = await forwardAdmin(path, 'GET'), detail = await response.json()
      detail.members = await Promise.all((detail.members || []).map(async member => { const subject = parse(await kv.get(`subject_${member.subjectId}`)); return { ...member, publicId: subject?.publicId || member.subjectId } }))
      return json(detail, response.status)
    }
    const groupMember = path.match(/^\/groups\/([^/]+)\/members(?:\/([^/]+))?$/)
    if (groupMember && ['POST','DELETE'].includes(method)) {
      await service.require(access, { permission: 'group.manage_members', groupId: groupMember[1] })
      const input = method === 'POST' ? await bodyOf(request) : {}, subject = await subjectForPublicId(groupMember[2] || input.publicId)
      return forwardAdmin(`/groups/${groupMember[1]}/members/${method === 'DELETE' ? subject.subjectId : ''}`.replace(/\/$/, ''), method, method === 'POST' ? { subjectId: subject.subjectId, expiresAt: input.expiresAt || null } : undefined)
    }
    const groupDelete = path.match(/^\/groups\/([^/]+)$/)
    if (groupDelete && method === 'DELETE') {
      await service.require(access, { permission: 'group.update', groupId: groupDelete[1] })
      const group = parse(await kv.get(`te_grp_${groupDelete[1]}`)); if (!group) throw fail('GROUP_NOT_FOUND', 404)
      const members = (await listValues(kv, 'te_mem_')).filter(x => x.groupId === groupDelete[1] && x.enabled !== false && !x.revokedAt), grants = (await listValues(kv, 'te_gg_')).filter(x => x.groupId === groupDelete[1] && x.enabled !== false && !x.revokedAt)
      if (members.length || grants.length) throw fail('GROUP_DELETE_UNSAFE', 409)
      await kv.delete(`te_grp_${groupDelete[1]}`)
      for (const principal of await list(kv, 'principal')) if ((principal.groupScopes || []).includes(groupDelete[1])) { principal.groupScopes = principal.groupScopes.filter(x => x !== groupDelete[1]); principal.authzEpoch++; await put(kv, 'principal', principal.adminId, principal) }
      await service.audit(access.principal.adminId, 'GROUP_DELETE', 'group', groupDelete[1]); return new Response(null, { status: 204 })
    }
    const requirement = routePermission(path, method)
    if (requirement && forward) {
      await service.require(access, requirement)
      const payload = ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : await bodyOf(request)
      return forwardAdmin(path, method, payload)
    }
    return json({ ok: false, code: 'NOT_FOUND' }, 404)
  } catch (error) { const problem = /** @type {any} */ (error); return json({ ok: false, code: problem.code || 'ADMIN_OPERATION_FAILED', ...(migrationAuthorized?{diagnostic:clean(problem.message||problem.name,160)}:{}) }, problem.status || 500) }
}
