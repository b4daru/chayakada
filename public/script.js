/* CHAYAKADA KAVALA – live site. All data comes from /api (Vercel function + Upstash Redis). */
const API = '/api?i=1';
let LS; try { localStorage.setItem('ck_t', '1'); LS = localStorage; } catch(e){ LS = {}; }   // some in-app browsers block storage
const UID = LS.ck_uid || (LS.ck_uid = Array.from({length: 24}, () => Math.floor(Math.random() * 16).toString(16)).join(''));  // per-user id for rate limits
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const EMOJIS = ["😂","🔥","❤️","👏"];
let S = null, last = '', filter = 'all', sort = 'new', prevId = 0, prevLead = '', teamsH = '', stick = false, imgData = '';
let seen = false, shown = {}, noted = (() => { try { return JSON.parse(LS.ck_noted || '[]'); } catch(e){ return []; } })();
const fmt = ts => new Date(ts * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

/* ---------- server calls ---------- */
async function call(a, body, bust){
  const r = await fetch(`${API}&a=${a}${body || bust ? '&_=' + Date.now() : ''}`, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...body, uid: UID})} : {});
  const txt = await r.text(); let j;
  try { j = JSON.parse(txt); } catch(e){ throw new Error('സർവർ മറുപടി ശരിയല്ല: ' + txt.slice(0, 80).replace(/\s+/g, ' ')); }
  if (j.error) throw new Error(j.error); return j;
}
const refresh = () => { last = ''; ver = ''; return sync(true, true); };   // after my own post: ask for fresh data
let ver = '', fails = 0;
async function sync(force, fresh){            // fetch latest data (server answers {same:1} when nothing changed)
  if (document.hidden && !force) return;
  try {
    const s = await call('get&v=' + ver + (fresh ? '&fresh=1' : ''), null, fresh); fails = 0;
    if (s.same) return;
    ver = s._v || ''; const h = JSON.stringify(s); if (h === last) return; last = h; S = s; render(); if (!seen) { seen = true; goHash(); }
  }
  catch(e){
    fails++; if (fails === 3 && S) toast('കണക്ഷൻ പ്രശ്നം… വീണ്ടും ശ്രമിക്കുന്നു');
    if (!S) $('#msgs').innerHTML = `<p class="empty">സർവർ കിട്ടുന്നില്ല 😕<br><small>${esc(e.message)}</small><br><a href="/api?a=ping" target="_blank" rel="noopener"><u>സർവർ ടെസ്റ്റ് ചെയ്യൂ</u></a></p>`;
  }
}
function toast(t){ const d = document.createElement('div'); d.textContent = t; $('#toast').appendChild(d); setTimeout(() => d.remove(), 3200); }
const post = (a, b) => call(a, b).catch(e => { toast(e.message); return refresh(); });   // success: keep the instant UI update, no extra request

/* ---------- render ---------- */
function render(){
  const K = Object.keys(S.TEAMS);
  if ($('#cTeam').options.length !== K.length) {   // normally the HTML already has them
    const kt = $('#cTeam').value, km = $('#mTeam').value, o = K.map(k => `<option value="${k}">${S.TEAMS[k].name}</option>`).join('');
    $('#cTeam').innerHTML = o; $('#mTeam').innerHTML = o; $('#cTeam').value = kt || K[0]; $('#mTeam').value = km || K[0];
  }
  const tk = S.NOTICES.map(n => '📢 ' + esc(n.title)).join(' &nbsp;•&nbsp; ') + ' &nbsp;•&nbsp; ';
  $('#ticker').innerHTML = tk + tk;
  const th = JSON.stringify(S.TEAMS); if (th !== teamsH) { teamsH = th; renderTeams(K); }
  renderChat(K); renderMemes(); renderBoard(K); renderNotices();
}
function renderChat(K = Object.keys(S.TEAMS)){
  const box = $('#msgs'), near = box.scrollHeight - box.scrollTop - box.clientHeight < 90, mine = LS.ck_name;
  $('#chatFilters').innerHTML = ['all', ...K].map(k => `<button class="chip ${k === filter ? 'on' : ''}" data-act="filter" data-f="${k}">${k === 'all' ? 'എല്ലാവരും' : S.TEAMS[k].name}</button>`).join('');
  box.innerHTML = S.chat.filter(m => filter === 'all' || m.t === filter).map(m => `
    <div class="msg ${m.t}${m.u === mine ? ' mine' : ''}" id="msg-${m.id}"><b>${esc(m.u)}</b><small>${esc(S.TEAMS[m.t]?.name || '')} · ${fmt(m.ts)}</small><div>${esc(m.m)}</div>
    <div class="rx">${EMOJIS.map(e => `<button data-act="react" data-id="${m.id}" data-e="${e}">${e} ${m.r[e] || ''}</button>`).join('')}<button data-act="share" data-k="msg" data-id="${m.id}" aria-label="Share">🔗</button></div></div>`).join('')
    || '<p class="empty">ഇവിടെ ആരും ഒന്നും പറഞ്ഞിട്ടില്ല. നീ തുടങ്ങ്! ☕</p>';
  const lastId = S.chat.length ? S.chat[S.chat.length - 1].id : 0;
  if (near || stick || !prevId) { box.scrollTop = box.scrollHeight; $('#pill').hidden = true; }
  else if (lastId > prevId) $('#pill').hidden = false;       // new messages while scrolled up
  prevId = lastId; stick = false;
}
function renderTeams(K){
  const ini = m => esc((m.name || '?')[0]), ph = m => m.photo ? `<img src="${esc(m.photo)}" alt="${esc(m.name)}" data-f="${ini(m)}" onerror="this.replaceWith(this.dataset.f)">` : ini(m);
  $('#teamList').innerHTML = K.map(k => { const t = S.TEAMS[k]; return `
    <article class="team ${k}" id="team-${k}">
      <div class="thead"><h3>${esc(t.name)}</h3><q>${esc(t.slogan)}</q><p>${esc(t.intro)}</p><br><button class="chip" data-act="share" data-k="team" data-id="${k}">🔗 ഷെയർ</button></div>
      <div class="tbody"><h4>അംഗങ്ങൾ (ക്ലിക്ക് ചെയ്യൂ)</h4>
        <div class="members">${t.members.map((m, i) => !m.name ? '' : `<button class="mem" data-act="member" data-t="${k}" data-i="${i}"><div class="ph">${ph(m)}</div><b>${esc(m.name)}</b><span>${esc(m.role)}</span></button>`).join('')}</div>
        <h4>നേട്ടങ്ങൾ</h4><ul class="wins">${t.wins.map(w => `<li>🏆 ${esc(w)}</li>`).join('')}</ul></div></article>`; }).join('');
}
function renderMemes(){
  const top = Math.max(0, ...S.memes.map(m => m.likes));
  const list = sort === 'hot' ? [...S.memes].sort((a, b) => b.likes - a.likes) : [...S.memes].reverse();
  $$('[data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === sort));
  $('#memeGrid').innerHTML = list.map(m => `
    <div class="meme ${m.t}" id="meme-${m.id}"><span class="tl">${esc(S.TEAMS[m.t]?.name || '')}</span>${m.likes === top && top > 0 ? '<span class="hot">🔥 TRENDING</span>' : ''}
      <div class="mimg">${/^(uploads\/|\/api\/img\?)/.test(m.img) ? `<img src="${esc(m.img)}" alt="" loading="lazy">` : esc(m.img)}</div><p>${esc(m.cap)}</p>
      <div class="macts"><button data-act="mlike" data-id="${m.id}" data-k="likes">👍 ${m.likes}</button><button data-act="mlike" data-id="${m.id}" data-k="laughs">😂 ${m.laughs}</button><button data-act="share" data-k="meme" data-id="${m.id}" aria-label="Share">🔗</button></div></div>`).join('');
}
function renderBoard(K){
  const sc = S.START_SCORES, order = [...K].sort((a, b) => sc[b] - sc[a]), max = Math.max(...Object.values(sc), 1);
  $('#board').innerHTML = order.map((k, i) => `
    <div class="srow ${k}"><div class="rank">${i + 1}</div>
      <div><div class="sname">${esc(S.TEAMS[k].name)}<small>🏆 ${S.TEAMS[k].victories} വിജയങ്ങൾ</small></div><div class="bar"><div class="fill" style="width:${sc[k] / max * 100}%"></div></div></div>
      <div class="pts" id="pts-${k}">${shown[k] || 0}</div></div>`).join('');
  K.forEach(k => countTo(k, sc[k]));
  $('#cheer').innerHTML = '<span>ഹൈപ്പ് മീറ്റർ – ടാപ്പ് ചെയ്ത് ടീമിനെ ചിയർ ചെയ്യൂ:</span> ' + K.map(k => `<button class="chip ${k}" data-act="cheer" data-k="${k}">🔥 ${esc(S.TEAMS[k].name)} <b>${S.cheers[k] || 0}</b></button>`).join(' ');
  if (prevLead && order[0] !== prevLead) toast(`🏆 ${S.TEAMS[order[0]].name} ഒന്നാം സ്ഥാനത്ത്!`);
  prevLead = order[0];
}
function countTo(k, target){           // animated counter
  const from = shown[k] || 0, t0 = performance.now();
  (function step(now){
    const p = Math.min((now - t0) / 800, 1); shown[k] = Math.round(from + (target - from) * p);
    const el = $('#pts-' + k); if (el) el.textContent = shown[k];
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}
function renderNotices(){
  $('#noticeGrid').innerHTML = S.NOTICES.map((n, i) => `
    <div class="note ${n.tag === 'TODAY' ? 'today' : ''}" id="notice-${i}"><em>${esc(n.tag)}</em><h4>${esc(n.title)}</h4><p>${esc(n.text)}</p>
    <button data-act="note" data-i="${i}" class="${noted.includes(i) ? 'on' : ''}">${noted.includes(i) ? '✔ ഓർമ്മിപ്പിക്കും' : '🔔 ഓർമ്മിപ്പിക്കൂ'}</button> <button data-act="share" data-k="notice" data-id="${i}" aria-label="Share">🔗</button></div>`).join('');
}

/* ---------- clicks (one listener for every data-act button) ---------- */
const bump = (o, k) => { o[k] = (+o[k] || 0) + 1; };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const d = b.dataset;
  if (d.act === 'filter') { filter = d.f; renderChat(); }
  else if (d.act === 'sort') { sort = d.s; renderMemes(); }
  else if (d.act === 'react') { const m = S.chat.find(x => x.id == d.id); if (!m) return; if (Array.isArray(m.r)) m.r = {}; bump(m.r, d.e); renderChat(); post('react', {id:+d.id, e:d.e}); }
  else if (d.act === 'mlike') { const m = S.memes.find(x => x.id == d.id); if (!m) return; bump(m, d.k); renderMemes(); post('mlike', {id:+d.id, k:d.k}); }
  else if (d.act === 'cheer') { bump(S.cheers, d.k); renderBoard(Object.keys(S.TEAMS)); post('cheer', {t:d.k}); }
  else if (d.act === 'note') { const i = +d.i; noted = noted.includes(i) ? noted.filter(x => x !== i) : [...noted, i]; LS.ck_noted = JSON.stringify(noted); renderNotices(); }
  else if (d.act === 'member') {
    const m = S.TEAMS[d.t].members[d.i];
    $('#mbox').className = 'mbox ' + d.t;
    $('#mbox').innerHTML = `<div class="ph">${m.photo ? `<img src="${esc(m.photo)}" alt="" data-f="${esc((m.name || '?')[0])}" onerror="this.replaceWith(this.dataset.f)">` : esc((m.name || '?')[0])}</div><h3>${esc(m.name)}</h3><p><b>${esc(m.role)}</b></p><p>${esc(m.bio)}</p><br><button class="btn" data-act="close">ശരി</button>`;
    $('#modal').hidden = false;
  }
  else if (d.act === 'share') share(d.k, d.id);
  else if (d.act === 'copy') { (navigator.clipboard ? navigator.clipboard.writeText(d.u) : Promise.reject()).then(() => toast('ലിങ്ക് കോപ്പി ചെയ്തു ✔'), () => prompt('ലിങ്ക് കോപ്പി ചെയ്യൂ:', d.u)); }
  else if (d.act === 'close') $('#modal').hidden = true;
});
$('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').hidden = true; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').hidden = true; });
$('#burger').onclick = () => $('#menu').classList.toggle('open');
$$('#menu a').forEach(a => a.onclick = () => $('#menu').classList.remove('open'));

/* ---------- chat send ---------- */
async function send(){
  const m = $('#cText').value.trim(); if (!m) return;
  const u = $('#cName').value.trim() || 'അജ്ഞാതൻ', t = $('#cTeam').value;
  LS.ck_name = u; LS.ck_team = t; $('#cSend').disabled = true; stick = true;
  try { await call('chat', {u, t, m}); $('#cText').value = ''; await refresh(); } catch(e){ toast(e.message); }
  $('#cSend').disabled = false; $('#cText').focus();
}
$('#cSend').onclick = send;
$('#cText').onkeydown = e => { if (e.key === 'Enter') send(); };
$('#cTeam').onchange = () => { $('#cSend').className = 'btn ' + $('#cTeam').value; };
$('#pill').onclick = () => { const b = $('#msgs'); b.scrollTo({top:b.scrollHeight, behavior:'smooth'}); $('#pill').hidden = true; };
$('#msgs').onscroll = () => { const b = $('#msgs'); if (b.scrollHeight - b.scrollTop - b.clientHeight < 90) $('#pill').hidden = true; };

/* ---------- meme upload (photo is resized in the browser first) ---------- */
$('#mFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return; const img = new Image();
  img.onload = () => {
    const sc = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = img.width * sc; c.height = img.height * sc; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    imgData = c.toDataURL('image/jpeg', .8); $('#mPrev').src = imgData; $('#mPrev').hidden = false;
  };
  img.src = URL.createObjectURL(f);
};
$('#mPost').onclick = async () => {
  const cap = $('#mCap').value.trim(); if (!imgData || !cap) { toast('ഫോട്ടോയും ക്യാപ്ഷനും വേണം'); return; }
  $('#mPost').disabled = true;
  try { await call('meme', {t:$('#mTeam').value, cap, img:imgData}); imgData = ''; $('#mFile').value = ''; $('#mCap').value = ''; $('#mPrev').hidden = true; toast('ട്രോൾ പോസ്റ്റ് ചെയ്തു! 😂'); await refresh(); }
  catch(e){ toast(e.message); }
  $('#mPost').disabled = false;
};

/* ---------- sharing (phone share sheet, or a menu of apps on desktop) ---------- */
function shareInfo(k, id){
  const base = location.origin + location.pathname, T = x => S?.TEAMS[x]?.name || '';
  if (k === 'msg') { const m = S.chat.find(x => x.id == id); return {t: `💬 ${m.u} (${T(m.t)}): "${m.m}"`, u: `${base}#msg-${id}`}; }
  if (k === 'meme') { const m = S.memes.find(x => x.id == id); return {t: `😂 ${m.cap} – ${T(m.t)} | ചായക്കട കവല`, u: `${base}#meme-${id}`, img: m.img}; }
  if (k === 'notice') { const n = S.NOTICES[id]; return {t: `📌 ${n.title} – ${n.text}`, u: `${base}#notice-${id}`}; }
  if (k === 'team') { const t = S.TEAMS[id]; return {t: `🛡 ${t.name}: ${t.slogan}`, u: `${base}#team-${id}`}; }
  return {t: '☕ CHAYAKADA KAVALA – ചായ ചൂടാണ്... ചർച്ച അതിലും ചൂടാണ്! Three teams. One chayakada.', u: base};
}
async function share(k, id){
  const s = shareInfo(k, id);
  if (navigator.share) {
    try {
      let data = {title: 'CHAYAKADA KAVALA', text: s.t, url: s.u};
      if (s.img && /^(uploads\/|\/api\/img\?)/.test(s.img)) {            // memes: try to share the picture itself
        try { const b = await (await fetch(s.img)).blob(), f = new File([b], 'meme.jpg', {type: b.type || 'image/jpeg'});
          if (navigator.canShare && navigator.canShare({files: [f]})) data = {title: 'CHAYAKADA KAVALA', text: s.t + ' ' + s.u, files: [f]}; } catch(e){}
      }
      await navigator.share(data); return;
    } catch(e){ if (e.name === 'AbortError') return; }
  }
  const u = encodeURIComponent(s.u), t = encodeURIComponent(s.t), both = encodeURIComponent(s.t + ' ' + s.u), L = (h, n) => `<a class="btn" target="_blank" rel="noopener" href="${h}">${n}</a>`;
  $('#mbox').className = 'mbox';
  $('#mbox').innerHTML = `<h3>🔗 ഷെയർ ചെയ്യൂ</h3><p class="shtxt">${esc(s.t)}</p><div class="shbtns">${L('https://wa.me/?text=' + both, 'WhatsApp')}${L('https://t.me/share/url?url=' + u + '&text=' + t, 'Telegram')}${L('https://twitter.com/intent/tweet?text=' + t + '&url=' + u, 'X')}${L('https://www.facebook.com/sharer/sharer.php?u=' + u, 'Facebook')}<button class="btn" data-act="copy" data-u="${esc(s.u)}">ലിങ്ക് കോപ്പി</button></div><br><button class="chip" data-act="close">അടയ്ക്കുക</button>`;
  $('#modal').hidden = false;
}
function goHash(){                                     // open a shared link straight at that post
  const id = location.hash.slice(1), el = /^(msg|meme|notice|team)-/.test(id) && document.getElementById(id);
  if (el) { el.scrollIntoView({block: 'center'}); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 3000); }
}
$('#cName').value = LS.ck_name || ''; if (LS.ck_team) $('#cTeam').value = LS.ck_team;
$('#cSend').className = 'btn ' + $('#cTeam').value;

/* ---------- page extras ---------- */
const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) $$('#menu a,#tabs a').forEach(a => a.classList.toggle('act', a.getAttribute('href') === '#' + x.target.id)); }), {rootMargin:'-45% 0px -50% 0px'});
$$('section').forEach(s => io.observe(s));
/* ---------- gentle polling: saves the host's daily hit limit ---------- */
const POLL = 30000, IDLE_SLOW = 5 * 60000, IDLE_STOP = 15 * 60000;
let timer = 0, lastAct = Date.now(), asleep = false;
function schedule(){
  clearTimeout(timer);
  const idle = Date.now() - lastAct;
  if (idle > IDLE_STOP) { asleep = true; return; }                       // forgotten tab: stop until the person comes back
  const d = fails ? Math.min(POLL * 2 ** fails, 60000) : idle > IDLE_SLOW ? 60000 : POLL;   // back off on errors / when idle
  timer = setTimeout(async () => { await sync(); schedule(); }, d);
}
function wake(){ lastAct = Date.now(); if (asleep) { asleep = false; sync(true).finally(schedule); } }
['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(ev => addEventListener(ev, wake, {passive: true, capture: true}));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastAct = Date.now(); asleep = false; sync(true).finally(schedule); } });
sync(true).finally(schedule);
