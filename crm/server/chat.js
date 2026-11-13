// Website chat: a chat bubble for your Sites pages and any other website. A visitor types
// their name and a question; they become a contact, the chat shows in Conversations next to
// their emails, and your iPhone buzzes. You answer from Conversations. If they already left
// the page, your answer is also emailed to them (when they gave an email address).
//
// The bubble is one line of code: <script src=".../chat/widget.js?k=KEY" async></script>.
// It opens a small page from this app in a frame, so it never clashes with the website.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_chat_settings (
  business_id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  greeting TEXT,
  group_name TEXT
);
CREATE TABLE IF NOT EXISTS crm_chat_visitors (
  token TEXT PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  business_id INTEGER,
  page TEXT,
  last_seen TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
require('./inbox'); // makes crm_messages
// The free answer bot: your own questions and answers. No AI service, nothing to pay.
db.exec(`
CREATE TABLE IF NOT EXISTS crm_chat_faq (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT,                          -- extra words people might use, like "cost, price, how much"
  sort INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0
);
`);
for (const [col, def] of [['bot_on', 'INTEGER NOT NULL DEFAULT 0'], ['bot_fallback', 'TEXT']]) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('crm_chat_settings') WHERE name='${col}'`).get()) db.exec(`ALTER TABLE crm_chat_settings ADD COLUMN ${col} ${def}`);
}
if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_chat_visitors') WHERE name='bot_waited'").get()) db.exec('ALTER TABLE crm_chat_visitors ADD COLUMN bot_waited INTEGER NOT NULL DEFAULT 0');
if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_messages') WHERE name='channel'").get()) db.exec("ALTER TABLE crm_messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'");

const businesses = () => require('./businesses');
const crm = () => require('./crm');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const DEFAULT_GREETING = 'Hi! Ask us anything. We usually answer within a few minutes.';
const DEFAULT_FALLBACK = 'Thanks! A person will answer you right here soon. If you leave, we will email you.';
const BOT = 'Answer bot';
const ONLINE_MS = 3 * 60e3;

// ---------- Settings (one chat bubble per business) ----------
function settingsFor(bizId) {
  const b = businesses().get(bizId) || businesses().all()[0];
  if (!b) throw err('Add a business first.');
  let s = db.prepare('SELECT * FROM crm_chat_settings WHERE business_id=?').get(b.id);
  if (!s) {
    db.prepare('INSERT INTO crm_chat_settings (business_id, key, enabled, greeting) VALUES (?,?,1,?)').run(b.id, crypto.randomBytes(8).toString('hex'), DEFAULT_GREETING);
    s = db.prepare('SELECT * FROM crm_chat_settings WHERE business_id=?').get(b.id);
  }
  const src = `${config.publicBaseUrl}/chat/widget.js?k=${s.key}`;
  return { ...s, enabled: Boolean(s.enabled), bot_on: Boolean(s.bot_on), bot_fallback: s.bot_fallback || DEFAULT_FALLBACK, faq: faqList(b.id),
    business: { id: b.id, name: b.name, color: b.color }, groups: b.groups,
    code: `<script src="${src}" async></script>`, testLink: `${config.publicBaseUrl}/chat/${s.key}?full=1` };
}
function saveSettings(bizId, body = {}) {
  const s = settingsFor(bizId);
  const greeting = 'greeting' in body ? String(body.greeting || '').trim().slice(0, 300) || DEFAULT_GREETING : s.greeting;
  const group = 'group_name' in body ? String(body.group_name || '').trim().slice(0, 60) || null : s.group_name;
  db.prepare('UPDATE crm_chat_settings SET enabled=?, greeting=?, group_name=? WHERE business_id=?').run('enabled' in body ? (body.enabled ? 1 : 0) : (s.enabled ? 1 : 0), greeting, group, s.business_id);
  if ('bot_on' in body) db.prepare('UPDATE crm_chat_settings SET bot_on=? WHERE business_id=?').run(body.bot_on ? 1 : 0, s.business_id);
  if ('bot_fallback' in body) db.prepare('UPDATE crm_chat_settings SET bot_fallback=? WHERE business_id=?').run(String(body.bot_fallback || '').trim().slice(0, 300) || null, s.business_id);
  return settingsFor(s.business_id);
}

// ---------- Answer bot (your own questions and answers) ----------
const faqList = (bizId) => db.prepare('SELECT * FROM crm_chat_faq WHERE business_id=? ORDER BY sort, id').all(Number(bizId));
function saveFaq(bizId, body = {}, id) {
  const b = businesses().get(bizId) || businesses().all()[0];
  const old = id ? db.prepare('SELECT * FROM crm_chat_faq WHERE id=?').get(Number(id)) : null;
  if (id && !old) throw err('Question not found', 404);
  const question = String(body.question ?? old?.question ?? '').trim().slice(0, 200);
  const answer = String(body.answer ?? old?.answer ?? '').trim().slice(0, 1500);
  const keywords = String(body.keywords ?? old?.keywords ?? '').trim().slice(0, 300) || null;
  if (!question) throw err('Type the question people ask.');
  if (!answer) throw err('Type your answer.');
  if (old) db.prepare('UPDATE crm_chat_faq SET question=?, answer=?, keywords=? WHERE id=?').run(question, answer, keywords, old.id);
  else {
    if (faqList(b.id).length >= 100) throw err('You can have up to 100 questions.');
    const sort = (db.prepare('SELECT MAX(sort) AS m FROM crm_chat_faq WHERE business_id=?').get(b.id).m || 0) + 1;
    db.prepare('INSERT INTO crm_chat_faq (business_id, question, answer, keywords, sort) VALUES (?,?,?,?,?)').run(b.id, question, answer, keywords, sort);
  }
  return settingsFor(b.id);
}
function deleteFaq(id) {
  const f = db.prepare('SELECT * FROM crm_chat_faq WHERE id=?').get(Number(id));
  if (!f) throw err('Question not found', 404);
  db.prepare('DELETE FROM crm_chat_faq WHERE id=?').run(f.id);
  return settingsFor(f.business_id);
}
const STOP = new Set('a an and are as at be but by can could do does for from get got have hello hey hi how i if in is it its me my no not of on or our please so that the their there this to us was we what when where which who why will with would you your yours'.split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '') || w;
const wordsOf = (t) => [...new Set(String(t || '').toLowerCase().replace(/[^a-z0-9$ ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem))];
// The best matching answer for what they typed, or null. Plain word matching, so it is free and fast.
function findAnswer(bizId, text) {
  const said = new Set(wordsOf(text));
  if (!said.size) return null;
  let best = null;
  for (const f of faqList(bizId)) {
    const q = wordsOf(f.question);
    const keys = String(f.keywords || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
    const phrase = keys.some((k) => k.length > 2 && ` ${String(text).toLowerCase()} `.includes(k));
    const hit = q.filter((w) => said.has(w)).length + keys.flatMap(wordsOf).filter((w) => said.has(w) && !q.includes(w)).length;
    const score = phrase ? 1 + hit : q.length ? hit / Math.min(q.length, Math.max(said.size, 2)) : 0;
    if ((phrase || (hit >= 1 && score >= 0.5)) && (!best || score > best.score)) best = { faq: f, score };
  }
  return best && best.faq;
}
// After someone writes: answer from your list, or tell them once that a person is coming.
function botReply(s, c, text, token) {
  if (!s.bot_on) return null;
  // Someone on your team answered in the last 30 minutes: the bot stays out of the way.
  const human = db.prepare("SELECT 1 FROM crm_messages WHERE contact_id=? AND channel='chat' AND direction='out' AND COALESCE(subject,'')<>? AND sent_at > ?")
    .get(c.id, BOT, new Date(Date.now() - 30 * 60e3).toISOString());
  if (human) return null;
  const f = findAnswer(s.business_id, text);
  let say = f ? f.answer : null;
  if (f) db.prepare('UPDATE crm_chat_faq SET hits=hits+1 WHERE id=?').run(f.id);
  else if (token) {
    const v = db.prepare('SELECT bot_waited FROM crm_chat_visitors WHERE token=?').get(token);
    if (v && !v.bot_waited) { say = s.bot_fallback || DEFAULT_FALLBACK; db.prepare('UPDATE crm_chat_visitors SET bot_waited=1 WHERE token=?').run(token); }
  }
  if (!say) return null;
  db.prepare(`INSERT INTO crm_messages (contact_id, direction, channel, subject, body, full_text, is_read, sent_at) VALUES (?, 'out', 'chat', ?, ?, ?, 1, ?)`)
    .run(c.id, BOT, say, say, new Date(Date.now() + 1).toISOString());
  return { answered: Boolean(f), question: f ? f.question : null };
}
const byKey = (k) => { const s = db.prepare('SELECT * FROM crm_chat_settings WHERE key=?').get(String(k || '')); return s && s.enabled ? s : null; };

// ---------- Visitors ----------
const hits = new Map();
function limited(key, max, ms = 3600e3) {
  const now = Date.now(), list = (hits.get(key) || []).filter((t) => now - t < ms);
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < ms)) hits.delete(k);
  return list.length > max;
}
const visitor = (s, token) => db.prepare('SELECT * FROM crm_chat_visitors WHERE token=? AND business_id=?').get(String(token || ''), s.business_id);

function start(s, { name, email, text, page } = {}, ip = '') {
  name = String(name || '').trim().slice(0, 80);
  email = String(email || '').trim().toLowerCase().slice(0, 200);
  text = String(text || '').trim().slice(0, 2000);
  if (!name) throw err('Please type your name.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('That email address does not look right.');
  if (!text) throw err('Please type your question.');
  if (limited(`start:${ip}`, 8)) throw err('Too many chats from here. Please try again later.', 429);
  const b = businesses().get(s.business_id);
  let c = email ? db.prepare('SELECT * FROM contacts WHERE lower(email)=?').get(email) : null;
  if (!c) {
    const group = s.group_name || (b && b.groups[0]) || 'Other';
    c = crm().createContact({ name, email: email || null, group_name: group, stage: 'New', notes: 'Started a website chat.' }, { source: 'chat' });
  }
  const token = crypto.randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO crm_chat_visitors (token, contact_id, business_id, page, last_seen) VALUES (?,?,?,?,?)').run(token, c.id, s.business_id, String(page || '').slice(0, 300) || null, new Date().toISOString());
  crm().logActivity(c.id, { kind: 'Note', note: `Started a website chat${page ? ` on ${String(page).slice(0, 200)}` : ''}` });
  addIncoming(c, text, s, findAnswer(s.business_id, text));
  if (s.bot_on) botReply(s, c, text, token);
  return { token, name: c.name };
}
function addIncoming(c, text, s, faq) {
  db.prepare(`INSERT INTO crm_messages (contact_id, direction, channel, subject, body, full_text, sent_at) VALUES (?, 'in', 'chat', 'Website chat', ?, ?, ?)`)
    .run(c.id, text, text, new Date().toISOString());
  // One buzz per chat every few minutes, not one per line.
  if (!limited(`buzz:${c.id}`, 1, 3 * 60e3)) {
    const b = businesses().get(s.business_id);
    const bot = s.bot_on && faq ? `\nThe answer bot answered: ${faq.question}` : '';
    notify.send(`Chat: ${c.name}`, `${text.slice(0, 180)}${b ? `\n(${b.name} website)` : ''}${bot}`, { tags: 'speech_balloon', priority: 'high' }).catch(() => {});
  }
}
function send(s, token, text) {
  const v = visitor(s, token);
  if (!v) throw err('This chat ended. Please start a new one.', 404);
  text = String(text || '').trim().slice(0, 2000);
  if (!text) throw err('Type a message first.');
  if (limited(`msg:${token}`, 60)) throw err('Slow down a little, please.', 429);
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(v.contact_id);
  if (!c) throw err('This chat ended. Please start a new one.', 404);
  db.prepare('UPDATE crm_chat_visitors SET last_seen=? WHERE token=?').run(new Date().toISOString(), v.token);
  addIncoming(c, text, s, findAnswer(s.business_id, text));
  if (s.bot_on) botReply(s, c, text, v.token);
  return messages(s, token, 0);
}
function messages(s, token, after = 0) {
  const v = visitor(s, token);
  if (!v) throw err('This chat ended. Please start a new one.', 404);
  db.prepare('UPDATE crm_chat_visitors SET last_seen=? WHERE token=?').run(new Date().toISOString(), v.token);
  const since = v.created_at.replace(' ', 'T') + 'Z';
  const rows = db.prepare(`SELECT id, direction, body, sent_at FROM crm_messages WHERE contact_id=? AND channel='chat' AND id > ? AND sent_at >= ? ORDER BY id`)
    .all(v.contact_id, Number(after) || 0, new Date(Date.parse(since) - 1000).toISOString());
  return { messages: rows.map((m) => ({ id: m.id, me: m.direction === 'in', text: m.body, at: m.sent_at })) };
}

// You answer a chat from Conversations. If they left the page, it also goes by email.
async function reply(contactId, text, opts = {}) {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(contactId));
  if (!c) throw err('Person not found', 404);
  text = String(text || '').trim();
  if (!text) throw err('Write a message first.');
  db.prepare(`INSERT INTO crm_messages (contact_id, direction, channel, subject, body, full_text, is_read, sent_at) VALUES (?, 'out', 'chat', 'Website chat', ?, ?, 1, ?)`)
    .run(c.id, text.slice(0, 5000), text.slice(0, 5000), new Date().toISOString());
  const v = db.prepare('SELECT * FROM crm_chat_visitors WHERE contact_id=? ORDER BY last_seen DESC LIMIT 1').get(c.id);
  const online = v && Date.now() - Date.parse(v.last_seen) < ONLINE_MS;
  let emailed = false;
  const email = require('./email');
  if (!online && c.email && email.provider()) {
    const b = v ? businesses().get(v.business_id) : null;
    await email.sendDirect({ to: c.email, toName: c.name, subject: `Your question${b ? ` for ${b.name}` : ''}`,
      text: `Hi ${String(c.name).split(' ')[0]},\n\nThanks for chatting with us. Here is our answer:\n\n${text}\n\nJust reply to this email if you have more questions.` }, opts);
    emailed = true;
  }
  crm().logActivity(c.id, { kind: 'Note', note: `You answered their chat${emailed ? ' (also emailed, they had left)' : ''}:\n${text.slice(0, 300)}` });
  return { ok: true, online: Boolean(online), emailed };
}
const isOnline = (contactId) => { const v = db.prepare('SELECT last_seen FROM crm_chat_visitors WHERE contact_id=? ORDER BY last_seen DESC LIMIT 1').get(Number(contactId)); return Boolean(v && Date.now() - Date.parse(v.last_seen) < ONLINE_MS); };

// ---------- Public: the bubble script and the chat page ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function widgetJs(key, color) {
  return `(function(){if(window.__vtChat)return;window.__vtChat=1;var s=document.currentScript,src=s&&s.src||'',base=src.split('/chat/widget.js')[0],k=${JSON.stringify(key)},c=${JSON.stringify(color)};
var b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Chat with us');
b.style.cssText='position:fixed;right:18px;bottom:18px;width:60px;height:60px;border-radius:50%;border:0;background:'+c+';color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;z-index:2147483646;display:grid;place-items:center';
b.innerHTML='<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"/></svg>';
var f=null;function open(){if(!f){f=document.createElement('iframe');f.title='Chat';f.src=base+'/chat/'+k+'?page='+encodeURIComponent(location.href.slice(0,300));
f.style.cssText='position:fixed;right:18px;bottom:88px;width:370px;height:560px;max-width:calc(100vw - 24px);max-height:calc(100vh - 110px);border:0;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:2147483647;background:#fff';
if(innerWidth<480){f.style.right='12px';f.style.bottom='84px';}document.body.appendChild(f);}else f.style.display=f.style.display==='none'?'':'none';}
b.onclick=open;addEventListener('message',function(e){if(e.data==='vt-chat-close'&&f)f.style.display='none';});
(document.body?Promise.resolve():new Promise(function(r){addEventListener('DOMContentLoaded',r)})).then(function(){document.body.appendChild(b);});})();`;
}
function chatPage(s, { full } = {}) {
  const b = businesses().get(s.business_id) || { name: 'Chat', color: '#4f46e5' };
  const faq = s.bot_on ? faqList(s.business_id).slice(0, 6).map((f) => ({ q: f.question, a: f.answer })) : [];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Chat with ${esc(b.name)}</title>
<style>:root{--c:${esc(b.color)};--bg:#fff;--soft:#f3f4f8;--text:#171a24;--muted:#6a7184;--line:#e4e7ef}
@media (prefers-color-scheme:dark){:root{--bg:#171a22;--soft:#232733;--text:#eceef4;--muted:#9aa1b4;--line:#2d3240}}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{background:${full ? 'var(--soft)' : 'var(--bg)'};color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.app{display:flex;flex-direction:column;height:100%;${full ? 'max-width:420px;margin:0 auto;background:var(--bg);box-shadow:0 0 30px rgb(0 0 0/.08)' : ''}}
header{background:var(--c);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}header b{font-size:1.05rem;flex:1}header span{display:block;font-size:.82rem;opacity:.9;font-weight:400}
.x{background:none;border:0;color:#fff;font-size:1.5rem;cursor:pointer;line-height:1;padding:0 4px}
.msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}.m{max-width:82%;padding:9px 12px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere}
.m.them{background:var(--soft);align-self:flex-start;border-bottom-left-radius:5px}.m.me{background:var(--c);color:#fff;align-self:flex-end;border-bottom-right-radius:5px}
.note{font-size:.8rem;color:var(--muted);text-align:center;margin:4px 0}
[hidden]{display:none!important}form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}textarea,input{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px;width:100%}
textarea{resize:none;height:44px}button.go{background:var(--c);color:#fff;border:0;border-radius:12px;padding:0 16px;font:inherit;font-weight:700;cursor:pointer}
.start{padding:14px;display:grid;gap:10px;border-top:1px solid var(--line)}.start textarea{height:80px}.start button{padding:12px}.err{color:#c92a2a;font-size:.88rem}.hp{position:absolute;left:-9999px}
.small{font-size:.78rem;color:var(--muted)}
.qs{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 4px}.qs button{font:inherit;font-size:.86rem;background:var(--bg);color:var(--c);border:1.5px solid var(--c);border-radius:99px;padding:6px 12px;cursor:pointer;text-align:left}
@media (prefers-color-scheme:dark){.qs button{color:var(--text)}}</style></head><body><div class="app">
<header><b>${esc(b.name)}<span>We usually answer in a few minutes</span></b>${full ? '' : '<button class="x" id="x" aria-label="Close chat">×</button>'}</header>
<div class="msgs" id="msgs"><div class="m them">${esc(s.greeting || DEFAULT_GREETING)}</div>${faq.length ? '<div class="qs" id="qs" aria-label="Common questions"></div>' : ''}</div>
<form class="start" id="start" hidden><input name="name" placeholder="Your name" required maxlength="80" autocomplete="name">
<input name="email" type="email" placeholder="Email (so we can answer if you leave)" maxlength="200" autocomplete="email">
<textarea name="text" placeholder="Your question" required maxlength="2000"></textarea><input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="go" type="submit">Start chat</button><div class="err" id="err1"></div><div class="small">We only use your details to answer you.</div></form>
<form id="send" hidden><textarea name="text" placeholder="Type a message" maxlength="2000" aria-label="Message"></textarea><button class="go" type="submit">Send</button></form>
</div><script>
(function(){var K=${JSON.stringify(s.key)},store='vtchat-'+K,tok=null,last=0,box=document.getElementById('msgs'),page=new URLSearchParams(location.search).get('page')||'';
try{tok=localStorage.getItem(store)}catch(e){}
var FAQ=${JSON.stringify(faq).replace(/</g, '\\u003c')};
function local(t,me){var d=document.createElement('div');d.className='m '+(me?'me':'them');d.textContent=t;box.appendChild(d);box.scrollTop=box.scrollHeight;}
var qs=document.getElementById('qs');if(qs)FAQ.forEach(function(f){var b=document.createElement('button');b.type='button';b.textContent=f.q;b.onclick=function(){
if(tok){api('send',{token:tok,text:f.q}).then(function(r){r.messages.forEach(add)});}else{local(f.q,true);local(f.a,false);var n=document.getElementById('more');if(!n){n=document.createElement('div');n.id='more';n.className='note';n.textContent='Still need help? Type your question below.';}box.appendChild(n);box.scrollTop=box.scrollHeight;}};qs.appendChild(b);});
var x=document.getElementById('x');if(x)x.onclick=function(){parent.postMessage('vt-chat-close','*')};
function add(m){if(m.id<=last)return;last=m.id;var d=document.createElement('div');d.className='m '+(m.me?'me':'them');d.textContent=m.text;box.appendChild(d);box.scrollTop=box.scrollHeight;}
function api(p,body){return fetch(K+'/'+p,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){if(!r.ok)throw Object.assign(new Error(j.error||'Error'),{status:r.status});return j;})});}
function chatting(){document.getElementById('start').hidden=true;document.getElementById('send').hidden=false;}
function poll(){if(!tok)return;api('poll?token='+encodeURIComponent(tok)+'&after='+last).then(function(r){r.messages.forEach(add)}).catch(function(e){if(e.status===404){tok=null;try{localStorage.removeItem(store)}catch(_){}document.getElementById('start').hidden=false;document.getElementById('send').hidden=true;}});}
if(tok){chatting();poll();}else document.getElementById('start').hidden=false;
setInterval(function(){if(document.visibilityState!=='hidden')poll()},4000);
document.getElementById('start').onsubmit=function(e){e.preventDefault();var f=e.target;if(f.website.value)return;
api('start',{name:f.name.value,email:f.email.value,text:f.text.value,page:page}).then(function(r){tok=r.token;try{localStorage.setItem(store,tok)}catch(_){}chatting();poll();
var n=document.createElement('div');n.className='note';n.textContent='Thanks '+r.name.split(' ')[0]+'! We got your message.';box.appendChild(n);})
.catch(function(er){document.getElementById('err1').textContent=er.message});};
var sf=document.getElementById('send'),ta=sf.text;ta.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sf.requestSubmit()}};
sf.onsubmit=function(e){e.preventDefault();var t=ta.value.trim();if(!t)return;ta.value='';api('send',{token:tok,text:t}).then(function(r){r.messages.forEach(add)}).catch(function(er){ta.value=t;alert(er.message)});};
})();</script></body></html>`;
}

function publicRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '20kb' }));
  r.get('/widget.js', (req, res) => {
    const s = byKey(req.query.k);
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300');
    if (!s) return res.send('/* chat is off */');
    const b = businesses().get(s.business_id);
    res.send(widgetJs(s.key, (b && b.color) || '#4f46e5'));
  });
  r.get('/:key', (req, res) => {
    const s = byKey(req.params.key);
    if (!s) return res.status(404).send('<p style="font:16px system-ui;padding:20px">Chat is not available right now.</p>');
    res.set('Cache-Control', 'no-store').type('html').send(chatPage(s, { full: Boolean(req.query.full) }));
  });
  const ip = (req) => String(req.get('cf-connecting-ip') || req.ip);
  const wrap = (fn) => (req, res) => {
    const s = byKey(req.params.key);
    if (!s) return res.status(404).json({ error: 'Chat is not available right now.' });
    try { res.json(fn(s, req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
  r.post('/:key/start', wrap((s, req) => { if ((req.body || {}).website) return { token: '', name: 'there' }; return start(s, req.body || {}, ip(req)); }));
  r.post('/:key/send', wrap((s, req) => send(s, (req.body || {}).token, (req.body || {}).text)));
  r.get('/:key/poll', wrap((s, req) => messages(s, req.query.token, req.query.after)));
  return r;
}

const router = express.Router();
const jwrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/settings', jwrap((req) => settingsFor(req.query.biz)));
router.put('/settings', jwrap((req) => saveSettings(req.query.biz, req.body || {})));
router.post('/faq', jwrap((req) => saveFaq(req.query.biz, req.body || {})));
router.put('/faq/:id', jwrap((req) => saveFaq(req.query.biz, req.body || {}, req.params.id)));
router.delete('/faq/:id', jwrap((req) => deleteFaq(req.params.id)));
router.post('/faq-test', jwrap((req) => { const f = findAnswer(settingsFor(req.query.biz).business_id, (req.body || {}).text); return { answer: f ? f.answer : null, question: f ? f.question : null }; }));
router.post('/:contactId/reply', jwrap((req) => reply(req.params.contactId, (req.body || {}).text)));

module.exports = { settingsFor, saveSettings, start, send, messages, reply, isOnline, publicRouter, router, byKey, saveFaq, deleteFaq, findAnswer, faqList };
