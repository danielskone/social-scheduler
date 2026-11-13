// Simple website pages: a one-page site for each business, made of ready blocks (a big
// welcome, services, photos, reviews, a booking button, a sign-up form, contact details).
// No coding: pick a starting design, fill in the words, press Publish. The page lives at
// /s/<name>, works on phones, and uses the business's own color. Forms and booking pages
// made in the CRM can be placed right on it, so every visitor who signs up or books becomes
// a contact by itself.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../src/db');
const config = require('../../src/config');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_sites (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  sections TEXT NOT NULL DEFAULT '[]',
  font TEXT NOT NULL DEFAULT 'modern',     -- modern, classic, friendly
  look TEXT NOT NULL DEFAULT 'light',      -- light, dark
  color TEXT,                              -- empty = the business color
  published INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_sites') WHERE name='chat'").get()) db.exec('ALTER TABLE crm_sites ADD COLUMN chat INTEGER NOT NULL DEFAULT 0');
const MEDIA = path.join(config.dataDir, 'site-media');
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');

// ---------- Blocks ----------
// Each block: what it's called, and the boxes you fill in. "list" blocks hold several items.
const BLOCKS = {
  hero: { name: 'Big welcome', fields: ['heading', 'text', 'button_text', 'button_link', 'image'] },
  text: { name: 'About / text', fields: ['heading', 'text', 'image'] },
  services: { name: 'Services or prices', fields: ['heading', 'text'], list: ['title', 'text', 'price'] },
  gallery: { name: 'Photos', fields: ['heading'], list: ['image', 'caption'] },
  reviews: { name: 'What people say', fields: ['heading'], list: ['quote', 'name'] },
  booking: { name: 'Book a time', fields: ['heading', 'text', 'booking'] },
  form: { name: 'Sign-up form', fields: ['heading', 'text', 'form'] },
  faq: { name: 'Questions and answers', fields: ['heading'], list: ['q', 'a'] },
  cta: { name: 'Call to action', fields: ['heading', 'text', 'button_text', 'button_link'] },
  buy: { name: 'Buy button (a product)', fields: ['heading', 'text', 'product', 'button_text'] },
  contact: { name: 'Contact details', fields: ['heading', 'text', 'show_map'] },
};
const LIMITS = { heading: 120, text: 2000, button_text: 40, button_link: 500, image: 500, title: 120, price: 40, caption: 160, quote: 600, name: 80, q: 200, a: 1500, booking: 20, form: 40, show_map: 5, product: 20 };

function cleanSections(list) {
  if (!Array.isArray(list)) throw err('Something went wrong with the blocks. Reload and try again.');
  if (list.length > 40) throw err('That is too many blocks for one page.');
  return list.filter((s) => s && BLOCKS[s.type]).map((s) => {
    const def = BLOCKS[s.type];
    const out = { id: /^[a-z0-9]{4,16}$/.test(s.id || '') ? s.id : crypto.randomBytes(4).toString('hex'), type: s.type };
    for (const f of def.fields) out[f] = String(s[f] ?? '').slice(0, LIMITS[f] || 500);
    if (def.list) out.items = (Array.isArray(s.items) ? s.items : []).slice(0, 30).map((it) => Object.fromEntries(def.list.map((f) => [f, String((it || {})[f] ?? '').slice(0, LIMITS[f] || 500)])));
    for (const k of ['button_link', 'image']) if (out[k] && !/^(https?:\/\/|\/|#|mailto:|tel:|media\/)/i.test(out[k])) out[k] = /^[\w.-]+\.[a-z]{2,}/i.test(out[k]) ? `https://${out[k]}` : '';
    if (out.items) out.items.forEach((it) => { if ('image' in it && it.image && !/^(https?:\/\/|\/|media\/)/i.test(it.image)) it.image = ''; });
    return out;
  });
}

// Starting designs. {name}, {phone} and {email} fill in from the business.
const block = (type, o = {}) => ({ id: crypto.randomBytes(4).toString('hex'), type, ...o });
const TEMPLATES = {
  business: { name: 'Local business', about: 'Services, reviews, booking and contact.', sections: () => [
    block('hero', { heading: '{name}', text: 'Friendly, honest service you can count on. Book a time that works for you, or send us a message.', button_text: 'Book a time', button_link: '#book' }),
    block('services', { heading: 'What we do', text: '', items: [{ title: 'Service one', text: 'A short line about it.', price: 'From $49' }, { title: 'Service two', text: 'A short line about it.', price: 'From $99' }, { title: 'Service three', text: 'A short line about it.', price: 'Call for a quote' }] }),
    block('reviews', { heading: 'What people say', items: [{ quote: 'Great to work with. Fast and fair.', name: 'A happy customer' }, { quote: 'I recommend them to all my friends.', name: 'Another happy customer' }] }),
    block('booking', { heading: 'Book a time', text: 'Pick a time that works for you. It only takes a minute.' }),
    block('contact', { heading: 'Get in touch', text: '', show_map: '1' }),
  ] },
  event: { name: 'Event', about: 'For a parade, fundraiser or show: date, photos, sign-up and FAQ.', sections: () => [
    block('hero', { heading: '{name}', text: 'Join us! Save the date and bring the whole family.', button_text: 'Sign up', button_link: '#signup' }),
    block('text', { heading: 'About the event', text: 'Tell people what it is, when and where it happens, and why they will love it.' }),
    block('gallery', { heading: 'Photos from last year', items: [] }),
    block('form', { heading: 'Sign up', text: 'Sponsors, vendors, volunteers and entries: sign up here.' }),
    block('faq', { heading: 'Questions', items: [{ q: 'When is it?', a: 'Add the date and time here.' }, { q: 'Where do I park?', a: 'Add parking details here.' }] }),
    block('contact', { heading: 'Contact us', text: '', show_map: '' }),
  ] },
  coach: { name: 'Coach or consultant', about: 'About you, what you offer, results and a free call.', sections: () => [
    block('hero', { heading: 'Grow faster with {name}', text: 'Clear steps, real results. Book a free intro call to see if we are a good fit.', button_text: 'Book a free call', button_link: '#book' }),
    block('text', { heading: 'How I help', text: 'Write two or three sentences about who you help and how.' }),
    block('services', { heading: 'Ways to work together', text: '', items: [{ title: 'Free intro call', text: '20 minutes to talk about your goals.', price: 'Free' }, { title: 'Monthly plan', text: 'Ongoing help, every week.', price: '$' }] }),
    block('reviews', { heading: 'Results', items: [{ quote: 'We doubled our leads in two months.', name: 'Client name' }] }),
    block('booking', { heading: 'Book your free call', text: '' }),
  ] },
  blank: { name: 'Start empty', about: 'Just a welcome block. Add your own.', sections: () => [block('hero', { heading: '{name}', text: '', button_text: '', button_link: '' })] },
};

// ---------- Saving ----------
const parse = (r) => (r ? { ...r, sections: (() => { try { return JSON.parse(r.sections) || []; } catch { return []; } })() } : null);
const get = (id) => parse(db.prepare('SELECT * FROM crm_sites WHERE id=?').get(Number(id)));
const bySlug = (s) => parse(db.prepare('SELECT * FROM crm_sites WHERE slug=?').get(String(s)));
const linkFor = (s) => `${config.publicBaseUrl}/s/${s.slug}`;
const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'site';
function uniqueSlug(want, id = 0) {
  let s = slugify(want), n = 1;
  while (db.prepare('SELECT 1 FROM crm_sites WHERE slug=? AND id != ?').get(s, id)) s = `${slugify(want)}-${++n}`;
  return s;
}
const withLink = (s) => (s ? { ...s, link: linkFor(s) } : null);

function create({ template = 'business', biz, title } = {}) {
  const t = TEMPLATES[template] || TEMPLATES.business;
  const all = businesses().all();
  const b = all.find((x) => x.id === Number(biz)) || all[0];
  const name = String(title || (b && b.name) || 'My business').trim().slice(0, 120);
  const fill = (v) => (typeof v === 'string' ? v.replace(/\{name\}/g, name).replace(/\{phone\}/g, (b && b.phone) || '').replace(/\{email\}/g, (b && b.email) || '') : v);
  const sections = cleanSections(t.sections().map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, fill(v)]))));
  const r = db.prepare('INSERT INTO crm_sites (business_id, slug, title, description, sections) VALUES (?,?,?,?,?)')
    .run(b ? b.id : null, uniqueSlug(name), name, null, JSON.stringify(sections));
  return withLink(get(r.lastInsertRowid));
}
function save(id, body = {}) {
  const old = get(id);
  if (!old) throw err('Page not found', 404);
  const title = 'title' in body ? String(body.title || '').trim().slice(0, 120) : old.title;
  if (!title) throw err('Give the page a title.');
  const sections = 'sections' in body ? cleanSections(body.sections) : old.sections;
  const slug = 'slug' in body && String(body.slug || '').trim() ? uniqueSlug(body.slug, old.id) : old.slug;
  const color = 'color' in body ? (/^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : null) : old.color;
  const row = { id: old.id, title, slug, sections: JSON.stringify(sections), color,
    description: 'description' in body ? String(body.description || '').trim().slice(0, 300) || null : old.description,
    font: ['modern', 'classic', 'friendly'].includes(body.font) ? body.font : old.font,
    look: ['light', 'dark'].includes(body.look) ? body.look : old.look,
    published: 'published' in body ? (body.published ? 1 : 0) : old.published,
    chat: 'chat' in body ? (body.chat ? 1 : 0) : old.chat,
    business_id: 'business_id' in body && businesses().get(body.business_id) ? Number(body.business_id) : old.business_id };
  db.prepare(`UPDATE crm_sites SET title=@title, slug=@slug, sections=@sections, color=@color, description=@description, font=@font, look=@look,
    published=@published, chat=@chat, business_id=@business_id, updated_at=datetime('now') WHERE id=@id`).run(row);
  return withLink(get(old.id));
}
function list(biz) {
  const rows = db.prepare('SELECT * FROM crm_sites ORDER BY id DESC').all().map(parse)
    .filter((s) => !biz || biz === 'all' || s.business_id === Number(biz) || !s.business_id);
  return rows.map((s) => ({ ...withLink(s), blocks: s.sections.length, sections: undefined }));
}
function remove(id) { db.prepare('DELETE FROM crm_sites WHERE id=?').run(Number(id)); return { ok: true }; }

// Photos you upload for your pages (saved on this Mac, served at /s/media/...).
function upload(buf, type) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[String(type || '').split(';')[0]];
  if (!ext) throw err('Pick a photo (JPG, PNG, WebP or GIF).');
  if (!buf || !buf.length) throw err('That photo is empty.');
  fs.mkdirSync(MEDIA, { recursive: true });
  const name = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(MEDIA, name), buf);
  return { url: `media/${name}` };
}

// What the editor needs to fill the "booking page" and "form" menus.
function choices() {
  const pages = db.prepare('SELECT id, title, slug, active FROM crm_booking_pages ORDER BY id').all();
  const forms = db.prepare('SELECT slug, title, active FROM crm_forms ORDER BY id DESC').all();
  const products = db.prepare("SELECT id, name, price, active FROM crm_products ORDER BY name").all();
  return { pages, forms, products, blocks: Object.fromEntries(Object.entries(BLOCKS).map(([k, v]) => [k, v.name])),
    templates: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, { name: v.name, about: v.about }])) };
}

// ---------- The public page ----------
const FONTS = {
  modern: { css: '"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', head: '"Inter",-apple-system,sans-serif', link: 'Inter:wght@400;600;800' },
  classic: { css: '"Source Serif 4",Georgia,serif', head: '"Playfair Display",Georgia,serif', link: 'Playfair+Display:wght@700;800&family=Source+Serif+4:wght@400;600' },
  friendly: { css: '"Nunito",-apple-system,sans-serif', head: '"Nunito",-apple-system,sans-serif', link: 'Nunito:wght@400;700;900' },
};
function render(site, { preview = false, base = '' } = {}) {
  const b = (site.business_id && businesses().get(site.business_id)) || businesses().all()[0] || { name: site.title, color: '#4f46e5' };
  const color = site.color || b.color || '#4f46e5';
  const f = FONTS[site.font] || FONTS.modern;
  const dark = site.look === 'dark';
  // Links inside the page: relative to /s/, so they work through any web address.
  const up = preview ? `${base}` : '../';
  const img = (u) => (/^media\//.test(u) ? `${preview ? `${base}s/` : ''}${u}` : u);
  const pages = db.prepare('SELECT id, slug, active FROM crm_booking_pages').all();
  const bookUrl = (id) => { const p = pages.find((x) => String(x.id) === String(id)) || pages.find((x) => x.active); return p ? `${up}book/${p.slug}` : null; };
  const nextSlug = (() => { try { return require('./funnels').nextSlug(site.id); } catch { return null; } })();
  const nextUrl = nextSlug ? (preview ? '#' : `${up}s/${nextSlug}`) : null;
  const href = (u) => (u === '#next' ? esc(nextUrl || '#') : null) || esc(u === '#book' && !site.sections.some((s) => s.type === 'booking') ? (bookUrl() || '#') : u);
  const head = (s) => (s.heading ? `<h2>${esc(s.heading)}</h2>` : '');
  const sec = (s, inner, cls = '') => `<section class="blk ${s.type} ${cls}" id="${{ booking: 'book', form: 'signup', contact: 'contact', buy: 'buy' }[s.type] || `b-${s.id}`}"><div class="in">${inner}</div></section>`;
  const blocks = site.sections.map((s) => {
    switch (s.type) {
      case 'hero': return `<header class="hero${s.image ? ' has-img' : ''}"${s.image ? ` style="--img:url('${esc(img(s.image))}')"` : ''}><div class="in"><h1>${esc(s.heading)}</h1>${s.text ? `<p class="lead">${nl(s.text)}</p>` : ''}
        ${s.button_text ? `<a class="btn" href="${href(s.button_link || '#contact')}">${esc(s.button_text)}</a>` : ''}</div></header>`;
      case 'text': return sec(s, `<div class="split${s.image ? '' : ' one'}"><div>${head(s)}<p>${nl(s.text)}</p></div>${s.image ? `<img src="${esc(img(s.image))}" alt="" loading="lazy">` : ''}</div>`);
      case 'services': return sec(s, `${head(s)}${s.text ? `<p class="sub">${nl(s.text)}</p>` : ''}<div class="grid">${s.items.map((i) => `<div class="tile"><h3>${esc(i.title)}</h3>${i.text ? `<p>${nl(i.text)}</p>` : ''}${i.price ? `<div class="price">${esc(i.price)}</div>` : ''}</div>`).join('')}</div>`);
      case 'gallery': return s.items.length || preview ? sec(s, `${head(s)}<div class="photos">${s.items.map((i) => `<figure><img src="${esc(img(i.image))}" alt="${esc(i.caption)}" loading="lazy">${i.caption ? `<figcaption>${esc(i.caption)}</figcaption>` : ''}</figure>`).join('') || '<p class="sub">Add photos in the editor.</p>'}</div>`) : '';
      case 'reviews': return sec(s, `${head(s)}<div class="grid">${s.items.map((i) => `<blockquote class="tile"><div class="stars" aria-label="5 stars">★★★★★</div><p>“${esc(i.quote)}”</p><cite>${esc(i.name)}</cite></blockquote>`).join('')}</div>`, 'alt');
      case 'booking': { const u = bookUrl(s.booking); return sec(s, `${head(s)}${s.text ? `<p class="sub">${nl(s.text)}</p>` : ''}${u ? `<a class="btn" href="${esc(u)}">See open times</a>` : '<p class="sub">Make a booking page in Appointments first, then pick it here.</p>'}`, 'center alt'); }
      case 'form': { const fm = s.form && db.prepare('SELECT slug FROM crm_forms WHERE slug=? AND active=1').get(s.form);
        return sec(s, `${head(s)}${s.text ? `<p class="sub">${nl(s.text)}</p>` : ''}${fm ? `<iframe class="form" src="${esc(`${up}f/${fm.slug}`)}" title="${esc(s.heading || 'Sign-up form')}" loading="lazy"></iframe>` : '<p class="sub">Pick a form in the editor.</p>'}`, 'center'); }
      case 'buy': { const pr = s.product && db.prepare('SELECT * FROM crm_products WHERE id=? AND active=1').get(Number(s.product));
        const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        return sec(s, `${head(s)}${s.text ? `<p class="sub">${nl(s.text)}</p>` : ''}${pr ? `<div class="price big">${money(pr.price)}</div><a class="btn" href="${esc(`${up}pay/${pr.token}`)}">${esc(s.button_text || `Buy now`)}</a>`
          : '<p class="sub">Pick a product in the editor.</p>'}`, 'center'); }
      case 'faq': return sec(s, `${head(s)}<div class="faq">${s.items.map((i) => `<details><summary>${esc(i.q)}</summary><p>${nl(i.a)}</p></details>`).join('')}</div>`);
      case 'cta': return sec(s, `${head(s)}${s.text ? `<p class="sub">${nl(s.text)}</p>` : ''}${s.button_text ? `<a class="btn light" href="${href(s.button_link || '#contact')}">${esc(s.button_text)}</a>` : ''}`, 'center band');
      case 'contact': return sec(s, `${head(s)}${s.text ? `<p class="sub">${nl(s.text)}</p>` : ''}<div class="contact">
        ${b.phone ? `<a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(b.phone)}</a>` : ''}${b.email ? `<a href="mailto:${esc(b.email)}">✉️ ${esc(b.email)}</a>` : ''}
        ${b.address ? `<a href="https://maps.google.com/?q=${encodeURIComponent(b.address)}" target="_blank" rel="noopener">📍 ${esc(b.address)}</a>` : ''}${b.website && !preview ? '' : ''}</div>
        ${s.show_map && b.address ? `<iframe class="map" title="Map" loading="lazy" src="https://maps.google.com/maps?q=${encodeURIComponent(b.address)}&output=embed"></iframe>` : ''}
        ${!b.phone && !b.email && !b.address ? '<p class="sub">Add a phone, email or address to the business in Settings and it shows here.</p>' : ''}`, 'center');
      default: return '';
    }
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.title)}</title>${site.description ? `<meta name="description" content="${esc(site.description)}">` : ''}
<meta property="og:title" content="${esc(site.title)}">${site.description ? `<meta property="og:description" content="${esc(site.description)}">` : ''}${!site.published ? '<meta name="robots" content="noindex">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f.link}&display=swap">
<style>
:root{--c:${esc(color)};--bg:${dark ? '#0e1016' : '#ffffff'};--alt:${dark ? '#161922' : '#f6f7fb'};--text:${dark ? '#eef0f5' : '#151821'};--muted:${dark ? '#a3a9b8' : '#5d6475'};--line:${dark ? '#262a35' : '#e6e8ef'};--card:${dark ? '#1b1e28' : '#ffffff'}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.6 ${f.css}}
h1,h2,h3{font-family:${f.head};line-height:1.15;margin:0 0 12px}h1{font-size:clamp(2rem,6vw,3.4rem);font-weight:800}h2{font-size:clamp(1.5rem,4vw,2.2rem);font-weight:800}h3{font-size:1.15rem}
.in{max-width:1040px;margin:0 auto;padding:0 20px}.blk{padding:64px 0}.blk.alt{background:var(--alt)}.center{text-align:center}.sub{color:var(--muted);max-width:640px;margin:0 auto 26px}
.center .sub{margin-left:auto;margin-right:auto}.blk:not(.center) .sub{margin-left:0}
.hero{padding:96px 0 84px;background:linear-gradient(135deg,color-mix(in srgb,var(--c) 92%,#000),color-mix(in srgb,var(--c) 70%,#fff 0%));color:#fff;text-align:center;position:relative}
.hero.has-img{background:linear-gradient(rgb(0 0 0/.5),rgb(0 0 0/.55)),var(--img) center/cover no-repeat}.lead{font-size:1.2rem;max-width:640px;margin:0 auto 28px;opacity:.95}
.btn{display:inline-block;padding:15px 30px;border-radius:999px;background:var(--c);color:#fff;font-weight:700;text-decoration:none;box-shadow:0 6px 20px color-mix(in srgb,var(--c) 35%,transparent)}
.hero .btn,.band .btn{background:#fff;color:var(--c);box-shadow:0 6px 20px rgb(0 0 0/.2)}.btn:hover{filter:brightness(1.06)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin-top:22px}.tile{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;margin:0;text-align:left}
.tile p{color:var(--muted);margin:0 0 10px}.price{font-weight:800;color:var(--c);font-size:1.1rem}.price.big{font-size:2.2rem;margin:6px 0 18px}.stars{color:#f59e0b;letter-spacing:2px;margin-bottom:6px}cite{font-style:normal;font-weight:700}
.split{display:grid;grid-template-columns:1.2fr 1fr;gap:36px;align-items:center}.split.one{grid-template-columns:1fr;max-width:760px}.split img{width:100%;border-radius:18px;object-fit:cover;max-height:420px}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:20px}figure{margin:0}.photos img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:14px;display:block}figcaption{color:var(--muted);font-size:.9rem;margin-top:6px}
div.faq{max-width:760px;margin-top:16px}details{border-bottom:1px solid var(--line);padding:14px 0}summary{cursor:pointer;font-weight:700;font-size:1.05rem}details p{color:var(--muted);margin:10px 0 0}
.band{background:var(--c);color:#fff}.band .sub{color:#fff;opacity:.9}
div.contact{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}div.contact a{padding:12px 18px;border:1px solid var(--line);border-radius:999px;color:var(--text);text-decoration:none;background:var(--card)}
iframe.form{width:100%;max-width:620px;height:760px;border:0;border-radius:18px;background:var(--card);display:block;margin:0 auto}iframe.map{width:100%;max-width:760px;height:300px;border:0;border-radius:18px;margin-top:22px}
footer{padding:28px 0;text-align:center;color:var(--muted);font-size:.85rem;border-top:1px solid var(--line)}
@media (max-width:720px){.blk{padding:48px 0}.hero{padding:72px 0 64px}.split{grid-template-columns:1fr}}
</style></head><body>
${blocks}
<footer><div class="in">© ${new Date().getFullYear()} ${esc(b.name || site.title)}</div></footer>
${site.chat && !preview ? (() => { let c = null; try { c = require('./chat').settingsFor(b.id); } catch { /* no business */ } return c && c.enabled ? `<script src="../chat/widget.js?k=${esc(c.key)}" async></script>` : ''; })() : ''}
${nextUrl && !preview ? `<script>addEventListener('message',function(e){if(e.data==='vtf-done')setTimeout(function(){location.href=${JSON.stringify(nextUrl)}},1500)})</script>` : ''}
</body></html>`;
}

function publicRouter() {
  const r = express.Router();
  r.use('/media', express.static(MEDIA, { maxAge: '30d', fallthrough: false }));
  r.get('/:slug', (req, res) => {
    const s = bySlug(req.params.slug);
    if (!s || !s.published) return res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This page is not available.</p>');
    db.prepare('UPDATE crm_sites SET views=views+1 WHERE id=?').run(s.id);
    res.set('Cache-Control', 'no-cache').type('html').send(render(s));
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => ({ sites: list(req.query.biz), ...choices() })));
router.post('/', wrap((req) => create({ ...(req.body || {}), biz: (req.body || {}).biz || req.query.biz })));
router.post('/upload', express.raw({ type: 'image/*', limit: '10mb' }), wrap((req) => upload(req.body, req.get('content-type'))));
router.get('/:id', wrap((req) => { const s = withLink(get(req.params.id)); if (!s) throw err('Page not found', 404); return s; }));
router.put('/:id', wrap((req) => save(req.params.id, req.body || {})));
router.delete('/:id', wrap((req) => remove(req.params.id)));
// The editor's live preview: the page as it would look with what's on screen now (not saved yet).
router.post('/:id/preview', (req, res) => {
  const s = get(req.params.id);
  if (!s) return res.status(404).send('Not found');
  const b = req.body || {};
  let sections = s.sections;
  try { if (b.sections) sections = cleanSections(b.sections); } catch { /* show the saved version */ }
  const draft = { ...s, ...Object.fromEntries(['title', 'description', 'font', 'look', 'color', 'business_id', 'chat'].filter((k) => k in b).map((k) => [k, b[k]])), sections, published: 0 };
  if (!/^#[0-9a-f]{6}$/i.test(draft.color || '')) draft.color = null;
  res.type('html').send(render(draft, { preview: true, base: String(b.base || '/') }));
});

module.exports = { BLOCKS, TEMPLATES, create, save, list, get, remove, render, upload, publicRouter, router, cleanSections, choices };
