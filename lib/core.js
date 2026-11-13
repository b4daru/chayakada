'use strict';
/*
  CHAYAKADA KAVALA – backend for Vercel (replaces api.php).
  Data lives in Upstash Redis (free). Keys:
    ck:cfg      JSON {TEAMS, START_SCORES, NOTICES}   (only admin changes it)
    ck:ver      number, +1 on every change (pages poll this cheaply)
    ck:chat     list of JSON messages
    ck:rx       hash  "<msgId>|<emoji>" -> count
    ck:memes    hash  "<memeId>" -> JSON {id,t,cap,img}
    ck:ml       hash  "<memeId>|likes|laughs" -> count
    ck:cheers   hash  team -> count
    ck:img:<id> JSON {m,d}  uploaded meme picture (base64)
    ck:nid      id counter
*/
const crypto = require('crypto');

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const EMOJIS = ['\u{1F602}', '\u{1F525}', '\u2764\uFE0F', '\u{1F44F}'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- redis client (created on first use) ---------- */
let client = null;
function R() {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new HttpError(500, 'Redis ബന്ധിപ്പിച്ചിട്ടില്ല – Vercel → Storage → Upstash Redis connect ചെയ്ത് Redeploy ചെയ്യൂ');
  const { Redis } = require('@upstash/redis');
  client = new Redis({ url, token, automaticDeserialization: false });
  return client;
}
function _setClient(c) { client = c; resetMem(); }   // used by tests

/* ---------- small helpers ---------- */
const clean = (s, n) => Array.from(String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim()).slice(0, n).join('');
const j = v => { if (typeof v !== 'string') return v == null ? null : v; try { return JSON.parse(v); } catch (e) { return null; } };
const obj = x => {                                   // normalise hgetall results
  if (!x) return {};
  if (Array.isArray(x)) { const o = {}; for (let i = 0; i + 1 < x.length; i += 2) o[x[i]] = x[i + 1]; return o; }
  return x;
};
function send(res, code, body, cache) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', code === 200 && cache ? cache : 'no-store');
  res.end(JSON.stringify(body));
}
function clientIp(req) {
  const h = req.headers || {};
  // x-real-ip is set by the platform. Otherwise take the LAST x-forwarded-for entry: the one the
  // platform itself appended. The first entry is whatever the client typed, so it can be faked.
  const xff = (h['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return String(h['x-real-ip'] || xff[xff.length - 1] || (req.socket && req.socket.remoteAddress) || 'unknown').trim();
}
async function readBody(req) {
  let b = req.body;
  if (b === undefined) { const chunks = []; for await (const c of req) chunks.push(c); b = Buffer.concat(chunks); }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

/* ---------- small in-memory caches (save Redis commands) ---------- */
let cfgMem = null, verMem = null, snapMem = null, seededOnce = false;
function resetMem() { cfgMem = null; verMem = null; snapMem = null; seededOnce = false; }
const touched = () => { verMem = null; snapMem = null; };      // call after any write

async function getCfg() {
  if (cfgMem && Date.now() - cfgMem.t < 10000) return cfgMem.v;   // short: other instances pick up admin changes quickly
  const v = j(await R().get('ck:cfg'));
  if (v) cfgMem = { v, t: Date.now() };
  return v;
}
const teamKeys = async () => { const c = await getCfg(); return c && c.TEAMS ? Object.keys(c.TEAMS) : []; };

/* ---------- loading a whole db.json-style object (first start + admin import) ---------- */
async function loadDb(db) {
  const oldIds = (await R().hkeys('ck:memes')) || [];
  const p = R().pipeline();
  for (const id of oldIds) p.del('ck:img:' + id);     // don't leave old picture data behind
  const chat = (Array.isArray(db.chat) ? db.chat : []).slice(-300);
  const memes = Array.isArray(db.memes) ? db.memes : [];
  let maxId = +db.nid || 100;
  p.del('ck:chat', 'ck:rx', 'ck:memes', 'ck:ml', 'ck:cheers');
  p.set('ck:cfg', JSON.stringify({ TEAMS: db.TEAMS, START_SCORES: db.START_SCORES, NOTICES: db.NOTICES }));
  if (chat.length) p.rpush('ck:chat', ...chat.map(c => JSON.stringify({ id: +c.id, u: String(c.u), t: String(c.t), m: String(c.m), ts: +c.ts })));
  const rx = {};
  for (const c of chat) {
    maxId = Math.max(maxId, +c.id || 0);
    if (c.r && typeof c.r === 'object' && !Array.isArray(c.r)) for (const [e, n] of Object.entries(c.r)) if (EMOJIS.includes(e) && +n > 0) rx[`${+c.id}|${e}`] = +n;
  }
  if (Object.keys(rx).length) p.hset('ck:rx', rx);
  const mm = {}, ml = {};
  for (const m of memes) {
    maxId = Math.max(maxId, +m.id || 0);
    mm[+m.id] = JSON.stringify({ id: +m.id, t: String(m.t), cap: String(m.cap), img: String(m.img) });
    ml[`${+m.id}|likes`] = +m.likes || 0; ml[`${+m.id}|laughs`] = +m.laughs || 0;
  }
  if (Object.keys(mm).length) { p.hset('ck:memes', mm); p.hset('ck:ml', ml); }
  const ch = {}; for (const [k, n] of Object.entries(db.cheers || {})) ch[k] = +n || 0;
  if (Object.keys(ch).length) p.hset('ck:cheers', ch);
  p.set('ck:nid', maxId);
  p.incr('ck:ver');
  await p.exec();
  resetMem();
}
async function seed() {
  const r = R();
  if (await r.set('ck:seedlock', '1', { nx: true, ex: 30 })) { await loadDb(require('./seed-data.json')); return; }
  for (let i = 0; i < 20; i++) { await sleep(250); if (await r.get('ck:ver')) return; }
  throw new HttpError(503, 'ഡാറ്റ ലോഡ് ചെയ്യുന്നു… കുറച്ച് കഴിഞ്ഞ് ശ്രമിക്കൂ');
}

/* ---------- version + snapshot ---------- */
async function version(fresh) {
  if (!fresh && verMem && Date.now() - verMem.t < 4000) return verMem.v;
  let v = await R().get('ck:ver');
  if (v == null) { await seed(); v = await R().get('ck:ver'); }
  seededOnce = true;
  v = String(v); verMem = { v, t: Date.now() };
  return v;
}
async function readAll(ver) {
  const p = R().pipeline();
  p.get('ck:cfg'); p.lrange('ck:chat', -80, -1); p.hgetall('ck:rx'); p.hgetall('ck:memes'); p.hgetall('ck:ml'); p.hgetall('ck:cheers');
  const [cfgS, chatL, rx, mm, ml, ch] = await p.exec();
  const cfg = j(cfgS);
  if (!cfg) throw new HttpError(500, 'ഡാറ്റ കാണുന്നില്ല');
  const chat = (chatL || []).map(j).filter(Boolean).map(c => ({ ...c, r: {} }));
  const byId = new Map(chat.map(c => [String(c.id), c]));
  for (const [k, n] of Object.entries(obj(rx))) { const [id, e] = k.split('|'); const c = byId.get(id); if (c) c.r[e] = +n; }
  const mlo = obj(ml);
  const memes = Object.values(obj(mm)).map(j).filter(Boolean).sort((a, b) => a.id - b.id)
    .map(m => ({ ...m, likes: +mlo[`${m.id}|likes`] || 0, laughs: +mlo[`${m.id}|laughs`] || 0 }));
  const cheers = {}; for (const [k, n] of Object.entries(obj(ch))) cheers[k] = +n || 0;
  return { TEAMS: cfg.TEAMS, START_SCORES: cfg.START_SCORES, NOTICES: (cfg.NOTICES || []).map((n, i) => ({ ...n, id: n.id || 'L' + i })), chat, memes, cheers, _v: ver };
}

/* ---------- anti-spam: one action per person per N seconds + generous per-IP ceiling ---------- */
/* Three layers:
   1. per-person cooldown: one action of kind k per s seconds (uid, or IP if no uid)
   2. per-IP ceiling per minute, kept high because many phones share one IP (mobile CGNAT, college Wi-Fi)
   3. one site-wide hourly write budget, which is what actually protects the Redis quota */
// Playful replies for "too fast" – one is picked at random each time
const COOL_MSGS = [
  'കുറച്ച് പതുക്കെ, സബൂർ ആവ്! 😅',
  'ഇജ്ജ് അയച്ചത് അവിടെ എത്തട്ടെ ആദ്യം , പതുക്കെ മച്ചു🙄',
  'എന്ത് സ്പീഡാട ഒന്ന് ശ്വാസം വിട് 😋',
  'ആവേശം ആകാം, പരിധി വിട്ടാൽ നാളെ എണീക്കുമ്പോ വെബ്സൈറ്റ് കാണൂല 😪',
  'ചായക്കടയിൽ ക്യൂ ഉണ്ട്, ക്ഷമിക്ക് വിധിച്ചതേ കിട്ടൂ 😉',
  'ഒരു ചായ കുടിച്ചിട്ട് വാ, എന്നിട്ട് ആക്കാം ബാക്കി  😄',
  'അമിത ആവേശം നല്ലതല്ല സുഹൃത്തേ 🥱',
  'ഹവെബ്സൈറ്റ് കേടാക്കല്ലേ , കുറച്ച് കഴിഞ്ഞ് വാ 🔥',
  'നഇങ്ങനെ ഒന്നും നെക്കല്ലേ, സ്ക്രീൻ കേടാവും  😂',
];
const pick = a => a[Math.floor(Math.random() * a.length)];
const BUSY_MSGS = [
  'കടയിൽ ഇപ്പോൾ നല്ല തിരക്ക്! അൽപം കഴിഞ്ഞ് വരൂ 🏃',
  'ചായക്കടയിൽ സീറ്റ് ഫുള്ള് ആണ്, ഒരു നിമിഷം കാത്തിരിക്കൂ ☕',
  'ചായക്കട നിറഞ്ഞു! കുറച്ച് കഴിഞ്ഞ് സീറ്റ് കിട്ടും 🪑',
];
const NET_MSGS = [
  'ഒരു ഹോട്ട്സ്പോട്ട് ന്ന് തന്നെ എല്ലാരും സൈറ്റ് എടുക്കുന്നു, സ്വയ്ര്യം താ  🙌',
];
const HOURLY_WRITES = +process.env.HOURLY_WRITE_CAP || 3000;
const IP_PER_MIN = 900;
async function limit(ctx, k, s) {
  const who = ctx.uid ? 'u' + ctx.uid : 'i' + ctx.ip;
  const ipk = `ck:ip:${ctx.ip}:${Math.floor(Date.now() / 60000)}`;
  const hk = `ck:wh:${Math.floor(Date.now() / 3600000)}`;
  const p = R().pipeline();
  p.incr(ipk); p.expire(ipk, 120);
  p.set(`ck:rl:${who}:${k}`, '1', { nx: true, ex: s });
  p.incr(hk); p.expire(hk, 7200);
  const [c, , ok, h] = await p.exec();
  if (+h > HOURLY_WRITES) throw new HttpError(503, pick(BUSY_MSGS));
  if (+c > IP_PER_MIN) throw new HttpError(429, pick(NET_MSGS));
  if (!ok) throw new HttpError(429, pick(COOL_MSGS));
}


/* ---------- public actions ---------- */
async function actGet(q, res) {
  const fresh = q.fresh === '1';
  const v = await version(fresh);
  const cache = fresh ? 'no-store' : 'public, max-age=0, s-maxage=5';   // CDN keeps it 5 s: 150 people share one Redis read
  if (!fresh && q.v === v) return send(res, 200, { same: 1 }, cache);
  let body = !fresh && snapMem && snapMem.v === v ? snapMem.body : null;
  if (!body) { body = await readAll(v); snapMem = { v, body }; }
  return send(res, 200, body, cache);
}
async function actChat(ctx, b) {
  const t = String(b.t || ''); if (!(await teamKeys()).includes(t)) throw new HttpError(400, 'ടീം തിരഞ്ഞെടുക്കൂ');
  const m = clean(b.m, 200); if (!m) throw new HttpError(400, 'സന്ദേശം ശൂന്യമാണ്');
  await limit(ctx, 'chat', 4);
  const u = clean(b.u, 20) || 'അജ്ഞാതൻ';
  const id = await R().incr('ck:nid');
  const p = R().pipeline();
  p.rpush('ck:chat', JSON.stringify({ id, u, t, m, ts: Math.floor(Date.now() / 1000) }));
  p.ltrim('ck:chat', -300, -1); p.incr('ck:ver');
  await p.exec(); touched();
  return { ok: 1 };
}
async function actReact(ctx, b) {
  const e = String(b.e || ''), id = parseInt(b.id, 10);
  if (!EMOJIS.includes(e) || !(id > 0)) throw new HttpError(400, 'emoji?');
  await limit(ctx, 'rx', 1);
  // one reaction per person per message per emoji: a double tap or a reload can't add a second one
  if (!(await R().sadd(`ck:rxu:${id}|${e}`, ctx.uid || ctx.ip))) return { ok: 1, dup: 1 };
  const p = R().pipeline(); p.hincrby('ck:rx', `${id}|${e}`, 1); p.incr('ck:ver'); await p.exec(); touched();
  return { ok: 1 };
}
const magicOk = (type, b) =>
  type === 'jpeg' ? b[0] === 0xFF && b[1] === 0xD8 :
  type === 'png' ? b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 :
  b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP';
async function actMeme(ctx, b) {
  const t = String(b.t || ''); if (!(await teamKeys()).includes(t)) throw new HttpError(400, 'ടീം തിരഞ്ഞെടുക്കൂ');
  const cap = clean(b.cap, 80); if (!cap) throw new HttpError(400, 'ക്യാപ്ഷൻ വേണം');
  const s = String(b.img || ''); if (s.length > 2200000) throw new HttpError(413, 'ചിത്രം വലുതാണ്');
  const mm = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(s);
  if (!mm) throw new HttpError(400, 'ചിത്രം ശരിയല്ല');
  const buf = Buffer.from(mm[2].replace(/\s/g, ''), 'base64');
  if (!buf.length || buf.length > 1500000 || !magicOk(mm[1], buf)) throw new HttpError(400, 'ചിത്രം വലുതാണ് / ശരിയല്ല');
  await limit(ctx, 'meme', 60);
  const id = await R().incr('ck:nid');
  const p = R().pipeline();
  p.set('ck:img:' + id, JSON.stringify({ m: 'image/' + mm[1], d: buf.toString('base64') }));
  p.hset('ck:memes', { [id]: JSON.stringify({ id, t, cap, img: '/api/img?id=' + id }) });
  p.hset('ck:ml', { [`${id}|likes`]: 0, [`${id}|laughs`]: 0 });
  p.incr('ck:ver');
  await p.exec(); touched();
  return { ok: 1 };
}
async function actMlike(ctx, b) {
  const k = String(b.k || ''), id = parseInt(b.id, 10);
  if (!['likes', 'laughs'].includes(k) || !(id > 0)) throw new HttpError(400, 'k?');
  await limit(ctx, 'ml', 1);
  if (!(await R().sadd(`ck:mlu:${id}|${k}`, ctx.uid || ctx.ip))) return { ok: 1, dup: 1 };   // one vote per person
  const p = R().pipeline(); p.hincrby('ck:ml', `${id}|${k}`, 1); p.incr('ck:ver'); await p.exec(); touched();
  return { ok: 1 };
}
async function actCheer(ctx, b) {
  const t = String(b.t || ''); if (!(await teamKeys()).includes(t)) throw new HttpError(400, 'ടീം?');
  await limit(ctx, 'ch', 2);
  const p = R().pipeline(); p.hincrby('ck:cheers', t, 1); p.incr('ck:ver'); await p.exec(); touched();
  return { ok: 1 };
}

/* ---------- admin actions ---------- */
const sameSecret = (a, b) => { const h = x => crypto.createHash('sha256').update(String(x)).digest(); return crypto.timingSafeEqual(h(a), h(b)); };
async function adminAuth(ctx, b) {
  const pw = process.env.ADMIN_PASS;
  if (!pw) throw new HttpError(503, 'ADMIN_PASS സെറ്റ് ചെയ്തിട്ടില്ല (Vercel → Settings → Environment Variables)');
  const fk = `ck:af:${ctx.ip}`;
  if ((+(await R().get(fk)) || 0) >= 10) throw new HttpError(429, 'കുറേ തവണ തെറ്റി – 5 മിനിറ്റ് കഴിഞ്ഞ് ശ്രമിക്കൂ');
  if (!sameSecret(pw, b.pw == null ? '' : b.pw)) {
    const p = R().pipeline(); p.incr(fk); p.expire(fk, 300); await p.exec();
    throw new HttpError(403, 'തെറ്റായ passcode');
  }
}
async function actSave(ctx, b) {
  const cur = j(await R().get('ck:cfg')) || {};
  for (const k of ['TEAMS', 'START_SCORES', 'NOTICES']) if (b[k] !== undefined) cur[k] = b[k];
  if (Array.isArray(cur.NOTICES)) cur.NOTICES = cur.NOTICES.map((n, i) => ({ ...n, id: n.id || 'n' + Date.now().toString(36) + i }));   // stable ids for reminders/links
  const okShape = cur.TEAMS && typeof cur.TEAMS === 'object' && !Array.isArray(cur.TEAMS) &&
    cur.START_SCORES && typeof cur.START_SCORES === 'object' && Array.isArray(cur.NOTICES);
  const s = JSON.stringify(cur);
  if (!okShape || s.length > 300000) throw new HttpError(400, 'ഡാറ്റ ശരിയല്ല');
  const p = R().pipeline(); p.set('ck:cfg', s); p.incr('ck:ver'); await p.exec();
  cfgMem = { v: cur, t: Date.now() }; touched();
  return { ok: 1 };
}
async function actDelChat(ctx, b) {
  const id = parseInt(b.id, 10);
  for (const raw of (await R().lrange('ck:chat', 0, -1)) || []) {
    const o = j(raw);
    if (o && +o.id === id) { await R().lrem('ck:chat', 1, raw); break; }
  }
  await R().incr('ck:ver'); touched();
  return { ok: 1 };
}
async function actDelMeme(ctx, b) {
  const id = parseInt(b.id, 10);
  const p = R().pipeline();
  p.hdel('ck:memes', String(id)); p.hdel('ck:ml', `${id}|likes`, `${id}|laughs`); p.del('ck:img:' + id); p.incr('ck:ver');
  await p.exec(); touched();
  return { ok: 1 };
}
async function actImport(ctx, b) {
  const db = b.db;
  if (!db || typeof db !== 'object' || !db.TEAMS || typeof db.TEAMS !== 'object' || !db.START_SCORES || !Array.isArray(db.NOTICES))
    throw new HttpError(400, 'db.json ശരിയല്ല');
  await loadDb(db);
  return { ok: 1 };
}

/* ---------- self-test ---------- */
async function actPing() {
  const out = {
    ok: 1, node: process.version,
    redisEnv: !!((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)),
    adminPassSet: !!process.env.ADMIN_PASS,
  };
  try { out.redis = await R().ping(); out.seeded = (await R().get('ck:ver')) != null; }
  catch (e) { out.redis = 'ERROR: ' + e.message; }
  return out;
}

/* ---------- entry point for api/index.js ---------- */
async function handle(req, res) {
  try {
    const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const a = q.a || 'get';
    const ctx = { ip: clientIp(req), uid: '' };
    if (a === 'ping') return send(res, 200, await actPing());
    if (a === 'get') return await actGet(q, res);
    if (req.method !== 'POST') throw new HttpError(405, 'POST വേണം');
    const b = await readBody(req);
    ctx.uid = /^[a-f0-9]{16,32}$/.test(String(b.uid || '')) ? String(b.uid) : '';
    if (!seededOnce) await version(true);
    const pub = { chat: actChat, react: actReact, meme: actMeme, mlike: actMlike, cheer: actCheer };
    if (pub[a]) return send(res, 200, await pub[a](ctx, b));
    await adminAuth(ctx, b);
    const adm = { login: async () => ({ ok: 1 }), save: actSave, del_chat: actDelChat, del_meme: actDelMeme, import: actImport };
    if (adm[a]) return send(res, 200, await adm[a](ctx, b));
    throw new HttpError(400, 'unknown action');
  } catch (e) {
    send(res, e instanceof HttpError ? e.code : 500, { error: e instanceof HttpError ? e.message : 'Server error: ' + e.message });
  }
}

/* picture endpoint (api/img.js) */
async function handleImg(req, res) {
  try {
    const id = parseInt(new URL(req.url, 'http://x').searchParams.get('id'), 10);
    const o = id > 0 ? j(await R().get('ck:img:' + id)) : null;
    if (!o || !o.d) { res.statusCode = 404; res.setHeader('Cache-Control', 'no-store'); return res.end('not found'); }
    const buf = Buffer.from(o.d, 'base64');
    res.statusCode = 200;
    res.setHeader('Content-Type', /^image\/(jpeg|png|webp)$/.test(o.m) ? o.m : 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');   // memes never change
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) { res.statusCode = 500; res.setHeader('Cache-Control', 'no-store'); res.end('error'); }
}

module.exports = { handle, handleImg, _setClient, HttpError };
