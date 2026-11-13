// Form builder for Viral Touch CRM: your own free, drag-and-drop online forms.
//
// A form is a list of questions ("fields", saved as JSON on crm_forms) plus a look ("style").
// People fill it in on a public page (/f/<random code>) served by this Mac, or, for a page that
// is always on even while the Mac sleeps, through the "website code" that sends answers to your
// free Google Sheet website inbox (see website.js). Either way:
//   - every answer is saved as a response (crm_form_entries), with any uploaded files,
//   - the person becomes (or updates) a contact when they leave a name and an email or phone,
//   - "OK to email" is only set when they tick the email permission box themselves,
//   - your phone gets an alert, and automations run (form_filled).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('../../src/config');
const db = require('../../src/db');
const crm = require('./crm');
const notify = require('../../src/notify');

const { esc, nl } = crm.html;
const filesDir = path.join(config.dataDir, 'form-files');
const err400 = (m) => Object.assign(new Error(m), { status: 400 });

// ---------- Question types ----------
// contact: which contact detail the answer fills in.
const TYPES = {
  heading: { name: 'Heading', group: 'Layout' },
  paragraph: { name: 'Text block', group: 'Layout' },
  name: { name: 'Full name', group: 'Contact', contact: 'name' },
  email: { name: 'Email', group: 'Contact', contact: 'email' },
  phone: { name: 'Phone', group: 'Contact', contact: 'phone' },
  company: { name: 'Business', group: 'Contact', contact: 'company' },
  address: { name: 'Address', group: 'Contact', contact: 'address' },
  short: { name: 'Short answer', group: 'Questions' },
  long: { name: 'Long answer', group: 'Questions' },
  number: { name: 'Number', group: 'Questions' },
  url: { name: 'Website link', group: 'Questions' },
  date: { name: 'Date', group: 'Questions' },
  time: { name: 'Time', group: 'Questions' },
  dropdown: { name: 'Dropdown', group: 'Choices', options: true },
  radio: { name: 'Single choice', group: 'Choices', options: true },
  checkboxes: { name: 'Multiple choice', group: 'Choices', options: true },
  rating: { name: 'Star rating', group: 'Choices' },
  scale: { name: '0 to 10 scale', group: 'Choices' },
  file: { name: 'File upload', group: 'Extras', mac: true },
  signature: { name: 'Signature', group: 'Extras', mac: true },
  agree: { name: 'I agree box', group: 'Extras' },
  consent: { name: 'Email permission', group: 'Extras' },
};
const LAYOUT = new Set(['heading', 'paragraph']);

const THEMES = {
  clean: { name: 'Clean', bg: '#f3f4f8', card: '#ffffff', text: '#1d2330', muted: '#667085', line: '#e3e6ec', accent: '#4f46e5' },
  midnight: { name: 'Midnight', bg: 'linear-gradient(140deg,#0b1033 0%,#1d1a5a 55%,#4a1f5c 100%)', card: '#ffffff', text: '#1d2330', muted: '#667085', line: '#e3e6ec', accent: '#f97316' },
  holiday: { name: 'Holiday', bg: 'linear-gradient(140deg,#7f1d1d 0%,#b91c1c 45%,#14532d 100%)', card: '#fffdf8', text: '#1f2a1f', muted: '#6b6b5e', line: '#ece5d6', accent: '#b91c1c' },
  forest: { name: 'Forest', bg: 'linear-gradient(140deg,#052e16,#166534)', card: '#ffffff', text: '#18261c', muted: '#5f6f63', line: '#dfe8e1', accent: '#15803d' },
  sunset: { name: 'Sunset', bg: 'linear-gradient(140deg,#f97316,#db2777)', card: '#ffffff', text: '#2a1d24', muted: '#76656d', line: '#f0e2e8', accent: '#db2777' },
  ocean: { name: 'Ocean', bg: 'linear-gradient(140deg,#0c4a6e,#0ea5e9)', card: '#ffffff', text: '#14232e', muted: '#5d6f7b', line: '#dce8ef', accent: '#0284c7' },
  dark: { name: 'Dark', bg: '#0f1115', card: '#1b1e25', text: '#e8eaf0', muted: '#9aa1b2', line: '#2d323c', accent: '#8b85ff' },
};

const uid = () => 'f_' + crypto.randomBytes(4).toString('hex');
const fieldsFor = (list) => list.map((x) => ({ id: uid(), required: false, ...x }));

// Older forms (made before the builder) only had on/off switches. Their field ids match the
// names the old page used, so old links and tests keep working.
function legacyFields(f) {
  const out = [{ id: 'name', type: 'name', label: 'Name', required: true }];
  if (f.ask_company) out.push({ id: 'company', type: 'company', label: 'Business or organization', required: false });
  out.push({ id: 'email', type: 'email', label: 'Email', required: !f.ask_phone });
  if (f.ask_phone) out.push({ id: 'phone', type: 'phone', label: 'Phone', required: false });
  if (f.ask_message) out.push({ id: 'message', type: 'long', label: 'Message', required: false });
  if (f.email_checkbox) out.push({ id: 'email_ok', type: 'consent', label: f.email_checkbox, required: false });
  return out;
}

function parse(v, fallback) { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } }

// Cleans what the builder sends, so nothing odd is ever saved or shown.
function cleanFields(list) {
  if (!Array.isArray(list)) throw err400('The form questions could not be read.');
  if (list.length > 80) throw err400('That is a lot of questions. Keep a form under 80.');
  const s = (v, n) => String(v ?? '').trim().slice(0, n);
  const seen = new Set();
  const out = list.filter((x) => x && TYPES[x.type]).map((x) => {
    let id = /^[a-z][a-z0-9_]{1,30}$/i.test(x.id || '') && x.id !== 'website' && !seen.has(x.id) ? x.id : uid();
    seen.add(id);
    const f = { id, type: x.type, label: s(x.label, 600) || TYPES[x.type].name, required: Boolean(x.required) && !LAYOUT.has(x.type) };
    if (x.help) f.help = s(x.help, 1000);
    if (x.placeholder) f.placeholder = s(x.placeholder, 120);
    if (TYPES[x.type].options) {
      f.options = (Array.isArray(x.options) ? x.options : String(x.options || '').split('\n')).map((o) => s(o, 160)).filter(Boolean).slice(0, 60);
      if (!f.options.length) f.options = ['Option 1', 'Option 2'];
    }
    if (x.show_if && x.show_if.field) f.show_if = { field: s(x.show_if.field, 40), value: s(x.show_if.value, 160) };
    return f;
  });
  // A "show only if" must point at a question above it.
  out.forEach((f, i) => { if (f.show_if && !out.slice(0, i).some((o) => o.id === f.show_if.field)) delete f.show_if; });
  if (out.filter((f) => f.type === 'consent').length > 1) throw err400('Use only one email permission box per form.');
  return out;
}

function cleanStyle(v = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '';
  const logo = /^\/media\/[\w.-]+$/.test(v.logo || '') ? v.logo : '';
  return { theme: THEMES[v.theme] ? v.theme : 'clean', color, button: String(v.button || '').trim().slice(0, 40) || 'Send', logo };
}

function formView(f) {
  const fields = f.fields ? parse(f.fields, null) : null;
  return { ...f, fields: fields || legacyFields(f), style: cleanStyle(parse(f.style, {})), builder: Boolean(fields) };
}

function saveForm(body, id) {
  const b = { ...body };
  if (b.fields !== undefined) b.fields = cleanFields(b.fields);
  if (b.style !== undefined) b.style = cleanStyle(b.style);
  return formView(crm.saveForm(b, id));
}

// ---------- Ready-made templates ----------
const PARADE = 'fuquayvarinachristmasparade.org';
const PARADE_BOX = 'Yes, email me Fuquay-Varina Christmas Parade news and updates. I can unsubscribe any time.';
const VA_BOX = 'Yes, send me Viral Attraction video marketing tips and offers. I can unsubscribe any time.';
const contactBits = (phone = true) => [
  { type: 'name', label: 'Full name', required: true },
  { type: 'email', label: 'Email', required: true },
  ...(phone ? [{ type: 'phone', label: 'Phone' }] : []),
];
const TEMPLATES = [
  { key: 'contact', name: 'Contact us', desc: 'Name, email, phone and a message.', color: '#4f46e5', icon: 'chat', words: 'contact message question reach inquiry enquiry get in touch',
    title: 'Contact us', intro: 'Send us a note and we will get back to you within one business day.', group: 'Viral Attraction lead',
    fields: [...contactBits(), { type: 'long', label: 'How can we help?', required: true }, { type: 'consent', label: VA_BOX }] },
  { key: 'rsvp', name: 'Event RSVP', desc: 'Who is coming, how many, and any notes.', color: '#f97316', icon: 'calendar', words: 'rsvp event party attend attending guest invite invitation celebration dinner',
    title: 'RSVP', intro: 'Let us know if you can make it!', group: 'Other', style: { theme: 'midnight' },
    fields: [...contactBits(false), { type: 'radio', label: 'Will you be there?', required: true, options: ['Yes, I will be there', 'Sorry, I cannot make it'] },
      { type: 'number', label: 'How many people in your group (including you)?', show_if: { field: '#2', value: 'Yes, I will be there' } },
      { type: 'long', label: 'Anything we should know? (food allergies, accessibility)' }] },
  { key: 'sponsor', name: 'Parade sponsor', desc: 'Sponsor level, business details and logo upload.', color: '#b91c1c', icon: 'star', words: 'sponsor sponsorship parade christmas business donate support',
    title: 'Become a Fuquay-Varina Christmas Parade sponsor', group: 'Parade sponsor', style: { theme: 'holiday', button: 'Become a sponsor' },
    intro: 'Help light up downtown Fuquay-Varina! Sponsors are thanked on our social pages and at the parade.',
    thank_you: `Thank you for supporting the parade! We will reach out soon with next steps. Sponsor levels are also at ${PARADE}/parade/sponsorship.`,
    fields: [{ type: 'company', label: 'Business name', required: true }, ...contactBits(),
      { type: 'dropdown', label: 'Sponsor level you are interested in', required: true, options: ['Gold', 'Silver', 'Bronze', 'Friend of the parade', 'Not sure yet, tell me more'] },
      { type: 'file', label: 'Upload your logo (optional)', help: 'A PNG or JPG works best.' }, { type: 'long', label: 'Questions or notes' }, { type: 'consent', label: PARADE_BOX }] },
  { key: 'entry', name: 'Parade entry', desc: 'Register a float, band, car or walking group.', color: '#15803d', icon: 'flag', words: 'parade entry register registration float band walking group car participate',
    title: 'Register a parade entry', group: 'Parade entry', style: { theme: 'holiday', button: 'Register my entry' },
    intro: 'Want to walk, ride or roll in the Fuquay-Varina Christmas Parade? Tell us about your entry.',
    thank_you: `Thanks! We got your entry and will be in touch. Full entry rules are at ${PARADE}.`,
    fields: [{ type: 'company', label: 'Group or organization name', required: true }, ...contactBits(),
      { type: 'radio', label: 'Type of entry', required: true, options: ['Float', 'Marching band', 'Car or truck', 'Walking group', 'Horse or animal unit', 'Other'] },
      { type: 'short', label: 'Tell us what kind', show_if: { field: '#4', value: 'Other' } },
      { type: 'number', label: 'About how many people?' }, { type: 'file', label: 'Photo of your entry from a past year (optional)' },
      { type: 'agree', label: 'I have read the parade entry rules and agree to follow them.', required: true }, { type: 'consent', label: PARADE_BOX }] },
  { key: 'parade-team', name: 'Contact the parade team', desc: 'Who is on the team, how to reach them, and a message box.', color: '#7f1d1d', icon: 'person', words: 'team contact contacts coordinator coordinators directory staff committee parade christmas fuquay',
    title: 'Contact the Fuquay-Varina Christmas Parade team', group: 'Parade contact', style: { theme: 'holiday', button: 'Send my message' },
    intro: 'Questions about marching, volunteering, sponsorship or parade day? Reach a parade coordinator directly, or send a message below and we will get back to you.',
    thank_you: `Thank you! A parade coordinator will get back to you soon. You can also find everything at ${PARADE}.`,
    fields: [
      { type: 'heading', label: 'Meet the parade team', help: 'The Fuquay-Varina Christmas Parade is a program of The Writing, Music & Film Society, a 501(c)(3) nonprofit.' },
      { type: 'paragraph', label: 'Jill Eagan, Parade Coordinator\nSponsorships: reserving a sponsor level, sponsor perks and questions from local businesses.\nPhone: 919-418-1934 · Email: wmfsociety@gmail.com' },
      { type: 'paragraph', label: 'Daniel King, Parade Coordinator\nParade questions: marching, volunteering and parade day.\nPhone: 984-289-6210' },
      { type: 'paragraph', label: 'General email: wmfsociety@gmail.com' },
      { type: 'heading', label: 'Send us a message' },
      { type: 'radio', label: 'Who would you like to reach?', options: ['Jill Eagan (sponsorships)', 'Daniel King', 'Whoever is free'] },
      { type: 'dropdown', label: 'What is this about?', required: true, options: ['Sponsorship', 'Register a parade entry', 'Volunteering', 'Parade day', 'Shop or donate', 'Something else'] },
      ...contactBits(), { type: 'long', label: 'Your message', required: true }, { type: 'consent', label: PARADE_BOX }] },
  { key: 'volunteer', name: 'Volunteer sign-up', desc: 'Availability, roles and t-shirt size.', color: '#0284c7', icon: 'hand', words: 'volunteer help helper sign up shift',
    title: 'Volunteer at the Christmas Parade', group: 'Volunteer', style: { theme: 'holiday' },
    intro: 'We need friendly helpers on parade day for line-up, route safety and more.',
    thank_you: `Thank you for volunteering! We will contact you with details. More info at ${PARADE}.`,
    fields: [...contactBits(), { type: 'checkboxes', label: 'What would you like to help with?', options: ['Line-up and staging', 'Route safety', 'Setup and cleanup', 'Information booth', 'Anywhere you need me'] },
      { type: 'dropdown', label: 'T-shirt size', options: ['S', 'M', 'L', 'XL', '2XL', '3XL'] }, { type: 'consent', label: PARADE_BOX }] },
  { key: 'feedback', name: 'Feedback survey', desc: 'Star rating, 0 to 10 score and comments.', color: '#7c3aed', icon: 'chart', words: 'survey feedback satisfaction review rating opinion poll customer',
    title: 'How did we do?', intro: 'Two minutes of feedback helps us get better. Thank you!', group: 'Other',
    fields: [{ type: 'rating', label: 'Overall, how happy are you?', required: true },
      { type: 'scale', label: 'How likely are you to recommend us to a friend?', required: true },
      { type: 'long', label: 'What could we do better?', show_if: { field: '#0', value: '1|2|3' } },
      { type: 'long', label: 'What did you like most?' }, { type: 'name', label: 'Your name (optional)' }, { type: 'email', label: 'Email (optional, if you want a reply)' }] },
  { key: 'consent', name: 'Photo and video release', desc: 'Permission to film or photograph, with signature.', color: '#0f766e', icon: 'sign', words: 'consent release waiver permission photo video model agreement signature sign',
    title: 'Photo and video release', group: 'Viral Attraction lead',
    intro: 'This form gives Viral Attraction permission to use photos and video of you in marketing.',
    fields: [...contactBits(), { type: 'date', label: 'Date of filming', required: true },
      { type: 'paragraph', label: 'I give Viral Attraction permission to record, edit and publish photos and video of me for marketing on websites and social media. I will not be paid for this use.' },
      { type: 'agree', label: 'I have read and agree to the release above.', required: true }, { type: 'signature', label: 'Signature', required: true }] },
  { key: 'video-quote', name: 'Video quote request', desc: 'Project type, budget and timeline.', color: '#db2777', icon: 'video', words: 'quote video marketing agency project estimate proposal budget viral attraction lead client',
    title: 'Get a video marketing quote', group: 'Viral Attraction lead', style: { theme: 'sunset', button: 'Get my quote' },
    intro: 'Tell us about your business and goals and we will send a custom plan.',
    fields: [{ type: 'company', label: 'Business name', required: true }, ...contactBits(), { type: 'url', label: 'Website or social page' },
      { type: 'checkboxes', label: 'What do you need?', required: true, options: ['Social media videos', 'Ads', 'Commercial', 'Event video', 'Monthly content plan'] },
      { type: 'dropdown', label: 'Monthly budget', options: ['Under $500', '$500 to $1,500', '$1,500 to $5,000', '$5,000+', 'Not sure yet'] },
      { type: 'date', label: 'When would you like to start?' }, { type: 'long', label: 'Your goals' }, { type: 'consent', label: VA_BOX }] },
  { key: 'car', name: 'Car shopping', desc: 'What they want, budget and trade-in.', color: '#1d4ed8', icon: 'car', words: 'car vehicle auto truck dealer dealership trade test drive buy financing automotive',
    title: 'Find your next car', group: 'Auto customer', style: { theme: 'ocean', button: 'Send my request' },
    intro: 'Tell me what you are looking for and I will find the right match.',
    fields: [...contactBits(), { type: 'radio', label: 'New or used?', options: ['New', 'Used', 'Either'] }, { type: 'short', label: 'Make and model you like' },
      { type: 'dropdown', label: 'Budget', options: ['Under $15,000', '$15,000 to $25,000', '$25,000 to $40,000', '$40,000+'] },
      { type: 'radio', label: 'Do you have a trade-in?', options: ['Yes', 'No'] },
      { type: 'short', label: 'Trade-in year, make, model and miles', show_if: { field: '#6', value: 'Yes' } },
      { type: 'file', label: 'Photos of your trade-in (optional)', show_if: { field: '#6', value: 'Yes' } }] },
  { key: 'registration', name: 'Registration', desc: 'Sign people up for a class or program.', color: '#0891b2', icon: 'person', words: 'registration register signup class course workshop program camp enroll',
    title: 'Registration', group: 'Other', intro: 'Save your spot.',
    fields: [...contactBits(), { type: 'address', label: 'Mailing address' }, { type: 'date', label: 'Date of birth' },
      { type: 'dropdown', label: 'Which session?', required: true, options: ['Session 1', 'Session 2'] }, { type: 'agree', label: 'I agree to the terms.', required: true }] },
  { key: 'newsletter', name: 'Email sign-up', desc: 'Just a name and email, for your list.', color: '#16a34a', icon: 'mail', words: 'newsletter email list subscribe updates mailing',
    title: 'Get our news by email', group: 'Other', intro: 'News, tips and offers. No spam, unsubscribe any time.', style: { button: 'Sign me up' },
    fields: [{ type: 'name', label: 'First name', required: true }, { type: 'email', label: 'Email', required: true }, { type: 'consent', label: 'Yes, email me news and updates. I can unsubscribe any time.' }] },
  { key: 'blank', name: 'Blank form', desc: 'Start from nothing.', color: '#64748b', icon: 'plus', words: '', title: 'Untitled form', group: 'Other',
    fields: [{ type: 'name', label: 'Full name', required: true }, { type: 'email', label: 'Email', required: true }] },
];

// Turns a template into a fresh form (new ids; "#n" in show_if means "the question at position n").
function fromTemplate(key) {
  const t = TEMPLATES.find((x) => x.key === key) || TEMPLATES.at(-1);
  const fields = fieldsFor(t.fields.map((f) => ({ ...f, show_if: f.show_if ? { ...f.show_if } : undefined })));
  fields.forEach((f) => {
    if (!f.show_if) { delete f.show_if; return; }
    const target = fields[Number(f.show_if.field.slice(1))];
    // A value like "1|2|3" means "any of these".
    if (target) f.show_if.field = target.id; else delete f.show_if;
  });
  return { title: t.title, intro: t.intro || '', group_name: t.group, thank_you: t.thank_you || '', active: 1, fields, style: cleanStyle(t.style || {}) };
}

// "Describe your form": picks the closest template and adds questions the words ask for.
// Plain keyword matching, so it is free and works offline.
const EXTRAS = [
  [/\b(?:phone|call|text me)\b/, { type: 'phone', label: 'Phone' }],
  [/\b(?:business|company|organi[sz]ation)\b/, { type: 'company', label: 'Business name' }],
  [/\b(?:address)\b/, { type: 'address', label: 'Address' }],
  [/\b(?:date|day)\b/, { type: 'date', label: 'Date' }],
  [/\b(?:time)\b/, { type: 'time', label: 'Preferred time' }],
  [/\b(?:upload|photo|picture|resume|file|logo|document)\b/, { type: 'file', label: 'Upload a file' }],
  [/\b(?:signature|sign)\b/, { type: 'signature', label: 'Signature', required: true }],
  [/\b(?:rating|stars?|rate)\b/, { type: 'rating', label: 'Your rating' }],
  [/\b(?:size|shirt)\b/, { type: 'dropdown', label: 'Size', options: ['S', 'M', 'L', 'XL', '2XL'] }],
  [/\b(?:budget|price)\b/, { type: 'dropdown', label: 'Budget', options: ['Under $500', '$500 to $1,500', '$1,500+'] }],
  [/\b(?:website|link|instagram|social)\b/, { type: 'url', label: 'Website or social page' }],
  [/\b(?:newsletter|email list|updates)\b/, { type: 'consent', label: 'Yes, email me news and updates. I can unsubscribe any time.' }],
  [/\b(?:agree|terms|waiver|rules)\b/, { type: 'agree', label: 'I agree to the terms.', required: true }],
  [/\b(?:message|comments?|notes?|questions?)\b/, { type: 'long', label: 'Message' }],
];
function suggest(text) {
  const words = String(text || '').toLowerCase();
  if (!words.trim()) return { ...fromTemplate('blank'), template: 'blank' };
  let best = TEMPLATES.at(-1), score = 0;
  for (const t of TEMPLATES) {
    const n = t.words.split(' ').filter((w) => w && new RegExp(`\\b${w}`).test(words)).length;
    if (n > score) { best = t; score = n; }
  }
  const form = fromTemplate(best.key);
  for (const [re, f] of EXTRAS) {
    if (re.test(words) && !form.fields.some((x) => x.type === f.type && (f.type !== 'dropdown' || x.label === f.label))) {
      const at = form.fields.findIndex((x) => x.type === 'consent' || x.type === 'agree' || x.type === 'signature');
      const nf = { id: uid(), required: false, ...f };
      const contactAt = ['phone', 'company', 'address'].includes(f.type) ? form.fields.map((x) => ['name', 'email', 'phone', 'company'].includes(x.type)).lastIndexOf(true) : -1;
      if (contactAt >= 0) form.fields.splice(contactAt + 1, 0, nf);
      else if (at < 0 || ['consent', 'agree', 'signature'].includes(f.type)) form.fields.push(nf); else form.fields.splice(at, 0, nf);
    }
  }
  const m = String(text).match(/\b(?:for|about)\s+(?:an?\s+|the\s+|my\s+|our\s+)?([^.,!?\n]{3,50}?)(?=\s+(?:with|and|that|including|where|which|so)\b|[.,!?\n]|$)/i);
  if (best.key === 'blank' || best.key === 'rsvp' || best.key === 'registration') {
    const what = m ? m[1].trim().replace(/^./, (c) => c.toUpperCase()) : '';
    if (what) form.title = best.key === 'rsvp' ? `RSVP: ${what}` : best.key === 'registration' ? `Register: ${what}` : what;
  }
  return { ...form, template: best.key };
}

// ---------- Public page ----------
function themeCss(style) {
  const t = THEMES[style.theme] || THEMES.clean, accent = style.color || t.accent;
  return `--vpf-bg:${t.bg};--vpf-card:${t.card};--vpf-text:${t.text};--vpf-muted:${t.muted};--vpf-line:${t.line};--vpf-accent:${accent}`;
}

// Styles are all under .vpf so the same markup can go on another website without clashing.
const FORM_CSS = `
.vpf{color:var(--vpf-text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.45}
.vpf *{box-sizing:border-box}
.vpf-card{max-width:640px;margin:0 auto;background:var(--vpf-card);border-radius:18px;padding:30px 28px;box-shadow:0 20px 50px rgba(10,15,40,.18)}
.vpf-logo{max-height:64px;max-width:220px;display:block;margin:0 0 14px}
.vpf h1{font-size:1.65rem;line-height:1.2;margin:0 0 8px;letter-spacing:-.01em}
.vpf-intro{color:var(--vpf-muted);margin:0 0 6px}
.vpf-q{margin:18px 0 0}
.vpf-q>label:not(.vpf-opt),.vpf-q>.vpf-l{display:block;font-weight:650;margin:0 0 7px;font-size:.96rem}
.vpf-req{color:var(--vpf-accent);margin-left:3px}
.vpf-help{color:var(--vpf-muted);font-size:.85rem;margin:-3px 0 7px}
.vpf input[type=text],.vpf input[type=email],.vpf input[type=tel],.vpf input[type=number],.vpf input[type=url],.vpf input[type=date],.vpf input[type=time],.vpf select,.vpf textarea{width:100%;font:inherit;font-size:16px;color:inherit;background:transparent;border:1.5px solid var(--vpf-line);border-radius:10px;padding:11px 12px}
.vpf input:focus,.vpf select:focus,.vpf textarea:focus{outline:none;border-color:var(--vpf-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--vpf-accent) 18%,transparent)}
.vpf-h{margin:26px 0 0;padding-top:18px;border-top:1px solid var(--vpf-line)}.vpf-h h2{font-size:1.2rem;margin:0 0 4px}
.vpf-p{margin:16px 0 0;color:var(--vpf-muted);white-space:normal}
.vpf-opts{display:grid;gap:8px}
.vpf-opt{display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--vpf-line);border-radius:10px;padding:10px 12px;cursor:pointer;font-weight:450}
.vpf-opt:has(input:checked){border-color:var(--vpf-accent);background:color-mix(in srgb,var(--vpf-accent) 8%,transparent)}
.vpf-opt input{margin-top:3px;accent-color:var(--vpf-accent);width:17px;height:17px;flex:none}
.vpf-stars{display:inline-flex;flex-direction:row-reverse;gap:4px}
.vpf-stars input{position:absolute;opacity:0;width:1px;height:1px}
.vpf-stars label{font-size:34px;line-height:1;color:var(--vpf-line);cursor:pointer;transition:transform .1s}
.vpf-stars label:hover,.vpf-stars label:hover~label,.vpf-stars input:checked~label{color:#f5b301}
.vpf-stars input:focus-visible+label{outline:2px solid var(--vpf-accent);border-radius:4px}
.vpf-scale{display:grid;grid-template-columns:repeat(11,1fr);gap:4px}
.vpf-scale input{position:absolute;opacity:0;width:1px;height:1px}
.vpf-scale label{display:grid;place-items:center;height:40px;border:1.5px solid var(--vpf-line);border-radius:8px;cursor:pointer;font-weight:600;font-size:.9rem}
.vpf-scale input:checked+label{background:var(--vpf-accent);border-color:var(--vpf-accent);color:#fff}
.vpf-scale-ends{display:flex;justify-content:space-between;color:var(--vpf-muted);font-size:.78rem;margin-top:4px}
.vpf-file{border:1.5px dashed var(--vpf-line);border-radius:10px;padding:14px;text-align:center}
.vpf-file input{font:inherit;max-width:100%}
.vpf-sig{border:1.5px solid var(--vpf-line);border-radius:10px;background:#fff;touch-action:none;width:100%;height:150px;display:block}
.vpf-sig-row{display:flex;justify-content:space-between;align-items:center;color:var(--vpf-muted);font-size:.8rem;margin-top:4px}
.vpf-sig-row button{border:0;background:none;color:var(--vpf-accent);font:inherit;cursor:pointer;padding:0}
.vpf-btn{margin-top:26px;width:100%;padding:14px;border:0;border-radius:12px;background:var(--vpf-accent);color:#fff;font:inherit;font-size:1.05rem;font-weight:700;cursor:pointer;box-shadow:0 8px 20px color-mix(in srgb,var(--vpf-accent) 35%,transparent)}
.vpf-btn:disabled{opacity:.6;cursor:wait}
.vpf-err{color:#c92a2a;background:#fdecec;border-radius:10px;padding:10px 12px;margin:14px 0 0}
.vpf-fine{color:var(--vpf-muted);font-size:.8rem;margin:12px 0 0;text-align:center}
.vpf-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.vpf [hidden]{display:none!important}
@media (max-width:520px){.vpf-card{padding:22px 18px;border-radius:14px}.vpf-scale{grid-template-columns:repeat(6,1fr)}}`;

// Shows/hides "show only if" questions and draws signatures. Same script on both versions.
const FORM_JS = `(function(){
var root=document.currentScript&&document.currentScript.previousElementSibling;var forms=root&&root.tagName==='FORM'?[root]:document.querySelectorAll('form.vpf-form');
Array.prototype.forEach.call(forms,function(form){
function val(id){var els=form.querySelectorAll('[name="'+id+'"]'),out=[];Array.prototype.forEach.call(els,function(e){if((e.type==='checkbox'||e.type==='radio')&&!e.checked)return;if(e.value)out.push(e.value)});return out}
function update(){Array.prototype.forEach.call(form.querySelectorAll('[data-show-field]'),function(q){var want=q.getAttribute('data-show-value').split('|').map(function(s){return s.trim().toLowerCase()});var parent=form.querySelector('[data-q="'+q.getAttribute('data-show-field')+'"]');var have=parent&&!parent.hidden?val(q.getAttribute('data-show-field')).map(function(s){return s.toLowerCase()}):[];var on=want[0]===''?have.length>0:have.some(function(v){return want.indexOf(v)>=0});q.hidden=!on;Array.prototype.forEach.call(q.querySelectorAll('input,select,textarea'),function(e){e.disabled=!on})})}
form.addEventListener('change',update);form.addEventListener('input',update);update();update();
Array.prototype.forEach.call(form.querySelectorAll('canvas.vpf-sig'),function(c){var input=c.parentNode.querySelector('input[type=hidden]'),ctx,draw=false,used=false;
function size(){var r=c.getBoundingClientRect(),d=window.devicePixelRatio||1;c.width=r.width*d;c.height=r.height*d;ctx=c.getContext('2d');ctx.scale(d,d);ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#111';used=false;input.value=''}
function pt(e){var r=c.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]}
c.addEventListener('pointerdown',function(e){draw=true;c.setPointerCapture(e.pointerId);var p=pt(e);ctx.beginPath();ctx.moveTo(p[0],p[1])});
c.addEventListener('pointermove',function(e){if(!draw)return;var p=pt(e);ctx.lineTo(p[0],p[1]);ctx.stroke();used=true});
function end(){if(draw&&used)input.value=c.toDataURL('image/png');draw=false}
c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);
var clear=c.parentNode.querySelector('[data-sig-clear]');if(clear)clear.onclick=function(){size()};size()});
form.addEventListener('submit',function(e){var bad=null;Array.prototype.forEach.call(form.querySelectorAll('[data-q]'),function(q){if(bad||q.hidden)return;if(q.getAttribute('data-required')==='1'&&(q.getAttribute('data-type')==='checkboxes'||q.getAttribute('data-type')==='signature')&&!val(q.getAttribute('data-q')).length)bad=q});
if(bad){e.preventDefault();e.stopImmediatePropagation();var m=bad.getAttribute('data-type')==='signature'?'Please sign in the box.':'Please pick at least one.';var p=bad.querySelector('.vpf-miss');if(!p){p=document.createElement('div');p.className='vpf-err vpf-miss';bad.appendChild(p)}p.textContent=m;bad.scrollIntoView({behavior:'smooth',block:'center'});return}
var b=form.querySelector('.vpf-btn');if(b)setTimeout(function(){b.disabled=true},0)},true);
});})();`;

function fieldHtml(f, values = {}, { embed = false } = {}) {
  const name = esc(f.id), v = values[f.id];
  const one = Array.isArray(v) ? v[0] : v;
  const val = esc(one ?? '');
  const req = f.required ? ' required' : '';
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const star = f.required ? '<span class="vpf-req" aria-hidden="true">*</span>' : '';
  const label = (forId) => `<label for="${forId}">${esc(f.label)}${star}</label>${f.help ? `<div class="vpf-help">${nl(f.help)}</div>` : ''}`;
  const legend = `<div class="vpf-l">${esc(f.label)}${star}</div>${f.help ? `<div class="vpf-help">${nl(f.help)}</div>` : ''}`;
  const iid = `q-${name}`;
  const input = (type, extra = '') => `${label(iid)}<input type="${type}" id="${iid}" name="${name}" value="${val}"${req}${ph}${extra}>`;
  let inner;
  switch (f.type) {
    case 'heading': return `<div class="vpf-h" data-q="${name}"${showAttrs(f)}><h2>${esc(f.label)}</h2>${f.help ? `<div class="vpf-help">${nl(f.help)}</div>` : ''}</div>`;
    case 'paragraph': return `<p class="vpf-p" data-q="${name}"${showAttrs(f)}>${nl(f.label)}</p>`;
    case 'name': inner = input('text', ' maxlength="120" autocomplete="name"'); break;
    case 'email': inner = input('email', ' maxlength="200" autocomplete="email"'); break;
    case 'phone': inner = input('tel', ' maxlength="40" autocomplete="tel"'); break;
    case 'company': inner = input('text', ' maxlength="160" autocomplete="organization"'); break;
    case 'short': inner = input('text', ' maxlength="500"'); break;
    case 'number': inner = input('number', ' step="any" inputmode="decimal"'); break;
    case 'url': inner = input('url', ' maxlength="300" placeholder="https://"'); break;
    case 'date': inner = input('date'); break;
    case 'time': inner = input('time'); break;
    case 'address': inner = `${label(iid)}<textarea id="${iid}" name="${name}" rows="2" maxlength="300" autocomplete="street-address"${req}${ph}>${val}</textarea>`; break;
    case 'long': inner = `${label(iid)}<textarea id="${iid}" name="${name}" rows="4" maxlength="3000"${req}${ph}>${val}</textarea>`; break;
    case 'dropdown': inner = `${label(iid)}<select id="${iid}" name="${name}"${req}><option value="">Choose one</option>${f.options.map((o) => `<option${o === one ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
    case 'radio': case 'checkboxes': {
      const type = f.type === 'radio' ? 'radio' : 'checkbox', picked = [].concat(v || []);
      inner = `${legend}<div class="vpf-opts" role="group" aria-label="${esc(f.label)}">${f.options.map((o) => `<label class="vpf-opt"><input type="${type}" name="${name}" value="${esc(o)}"${picked.includes(o) ? ' checked' : ''}${type === 'radio' ? req : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
      break;
    }
    case 'rating':
      inner = `${legend}<div class="vpf-stars" role="radiogroup" aria-label="${esc(f.label)}">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="${iid}-${n}" name="${name}" value="${n}"${String(one) === String(n) ? ' checked' : ''}${req}><label for="${iid}-${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}</div>`;
      break;
    case 'scale':
      inner = `${legend}<div class="vpf-scale" role="radiogroup" aria-label="${esc(f.label)}">${Array.from({ length: 11 }, (_, n) => `<span><input type="radio" id="${iid}-${n}" name="${name}" value="${n}"${String(one) === String(n) ? ' checked' : ''}${req}><label for="${iid}-${n}">${n}</label></span>`).join('')}</div><div class="vpf-scale-ends"><span>Not likely</span><span>Very likely</span></div>`;
      break;
    case 'file':
      if (embed) return '';
      inner = `${label(iid)}<div class="vpf-file"><input type="file" id="${iid}" name="${name}" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.heic"${req}><div class="vpf-help" style="margin:6px 0 0">Up to 5 files, 25 MB each.</div></div>`;
      break;
    case 'signature':
      if (embed) return '';
      inner = `${legend}<canvas class="vpf-sig" aria-label="Sign here with your finger or mouse"></canvas><input type="hidden" name="${name}"><div class="vpf-sig-row"><span>Sign above with your finger or mouse</span><button type="button" data-sig-clear>Clear</button></div>`;
      break;
    case 'agree': case 'consent':
      inner = `<label class="vpf-opt"><input type="checkbox" name="${name}" value="1"${one ? ' checked' : ''}${f.type === 'agree' ? req : ''}><span>${esc(f.label)}${f.type === 'agree' && f.required ? star : ''}</span></label>${f.help ? `<div class="vpf-help" style="margin-top:6px">${nl(f.help)}</div>` : ''}`;
      break;
    default: return '';
  }
  return `<div class="vpf-q" data-q="${name}" data-type="${f.type}" data-required="${f.required ? 1 : 0}"${showAttrs(f)}>${inner}</div>`;
}
function showAttrs(f) {
  return f.show_if ? ` data-show-field="${esc(f.show_if.field)}" data-show-value="${esc(f.show_if.value)}" hidden` : '';
}

function formInner(form, { error = '', values = {}, embed = false, action = '' } = {}) {
  const fields = form.fields, st = form.style;
  const hasFile = !embed && fields.some((f) => f.type === 'file');
  const consent = fields.some((f) => f.type === 'consent');
  return `<div class="vpf-card">${st.logo && !embed ? `<img class="vpf-logo" src="${esc(st.logo.replace(/^\/media\//, '../media/'))}" alt="">` : ''}<h1>${esc(form.title)}</h1>${form.intro ? `<p class="vpf-intro">${nl(form.intro)}</p>` : ''}
<div class="vpf-err" role="alert"${error ? '' : ' hidden'}>${esc(error)}</div>
<form class="vpf-form" method="post"${action ? ` action="${esc(action)}"` : ''}${hasFile ? ' enctype="multipart/form-data"' : ''}${embed ? ' data-viral-post="off"' : ''}>
${fields.map((f) => fieldHtml(f, values, { embed })).join('\n')}
<div class="vpf-hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
<button class="vpf-btn" type="submit">${esc(st.button)}</button>
<p class="vpf-fine">Your details are only used to reply to you${consent ? ', and to email you updates if you tick the box' : ''}. They are never sold or shared.</p>
</form><script>${FORM_JS}</script></div>`;
}

function shell(title, style, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>${FORM_CSS}
html{min-height:100%;background:${(THEMES[style.theme] || THEMES.clean).bg}}body{margin:0;padding:40px 16px 60px}
.vpf-thanks{text-align:center;padding:24px 8px}.vpf-thanks .ok{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;margin:0 auto 14px;background:var(--vpf-accent);color:#fff;font-size:32px}
</style></head><body><div class="vpf" style="${themeCss(style)}">${inner}</div></body></html>`;
}

function renderPage(form, opts = {}) { return shell(form.title, form.style, formInner(form, opts)); }
function thanksPage(form) {
  return shell(form.title, form.style, `<div class="vpf-card vpf-thanks"><div class="ok">✓</div><h1>Thank you!</h1><p class="vpf-intro">${nl(form.thank_you || "We got your answers and we'll be in touch soon.")}</p></div>`);
}
function notFound() { return shell('Not found', cleanStyle({}), '<div class="vpf-card"><h1>This form is not available.</h1></div>'); }

// ---------- Taking in answers ----------
const visible = (fields, values) => {
  const shown = new Set();
  for (const f of fields) {
    if (!f.show_if) { shown.add(f.id); continue; }
    const want = f.show_if.value.split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const have = shown.has(f.show_if.field) ? [].concat(values[f.show_if.field] || []).map((s) => String(s).toLowerCase()).filter(Boolean) : [];
    if (want.length ? have.some((x) => want.includes(x)) : have.length) shown.add(f.id);
  }
  return shown;
};

const SAFE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.pdf', '.mp4', '.mov', '.m4v', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv']);

// Checks the answers against the questions. Returns the tidy answers, or throws a 400 with a friendly message.
function readAnswers(form, body, uploads = []) {
  const fields = form.fields;
  const values = {};
  for (const f of fields) {
    const raw = body[f.id];
    values[f.id] = f.type === 'checkboxes' ? [].concat(raw ?? []).map((x) => String(x).trim()).filter(Boolean) : String(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '').trim();
  }
  const shown = visible(fields, values);
  const answers = [], files = [];
  for (const f of fields) {
    if (LAYOUT.has(f.type) || !shown.has(f.id)) continue;
    let v = values[f.id];
    const missing = (msg) => { throw err400(msg || `Please answer "${f.label}".`); };
    if (f.type === 'file') {
      const mine = uploads.filter((u) => u.fieldname === f.id);
      if (f.required && !mine.length) missing(`Please add a file for "${f.label}".`);
      for (const u of mine) {
        if (!SAFE_EXT.has(path.extname(u.originalname || '').toLowerCase())) throw err400(`"${u.originalname}" is not a file type this form takes. Try a photo, video, PDF or Office file.`);
        files.push({ field: f.id, label: f.label, name: String(u.originalname).slice(0, 160), upload: u });
      }
      if (mine.length) answers.push({ id: f.id, label: f.label, type: f.type, value: mine.map((u) => u.originalname).join(', ') });
      continue;
    }
    if (f.type === 'signature') {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/.test(v)) { if (f.required) missing('Please sign in the signature box.'); continue; }
      if (v.length > 600000) throw err400('That signature is too big. Please clear it and sign again.');
      files.push({ field: f.id, label: f.label, name: 'signature.png', data: Buffer.from(v.split(',')[1], 'base64') });
      answers.push({ id: f.id, label: f.label, type: f.type, value: 'Signed' });
      continue;
    }
    if (f.type === 'checkboxes') {
      v = v.filter((x) => f.options.includes(x));
      if (f.required && !v.length) missing();
      if (v.length) answers.push({ id: f.id, label: f.label, type: f.type, value: v.join(', ') });
      continue;
    }
    v = v.slice(0, f.type === 'long' ? 3000 : 600);
    if (!v) { if (f.required) missing(f.type === 'agree' ? `Please tick "${f.label}".` : undefined); continue; }
    if (f.type === 'email') { v = v.toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw err400('That email address does not look right.'); }
    if (f.type === 'number' && !Number.isFinite(Number(v))) throw err400(`"${f.label}" needs a number.`);
    if ((f.type === 'radio' || f.type === 'dropdown') && !f.options.includes(v)) throw err400(`Please pick one of the choices for "${f.label}".`);
    if (f.type === 'rating' && !/^[1-5]$/.test(v)) throw err400(`Please pick 1 to 5 stars for "${f.label}".`);
    if (f.type === 'scale' && !/^(10|[0-9])$/.test(v)) throw err400(`Please pick 0 to 10 for "${f.label}".`);
    if (f.type === 'agree' || f.type === 'consent') v = 'Yes';
    answers.push({ id: f.id, label: f.label, type: f.type, value: v });
  }
  // Contact forms need some way to reach the person back.
  const has = (t) => fields.some((f) => f.type === t && shown.has(f.id));
  const got = (t) => answers.find((a) => a.type === t)?.value || '';
  if (has('email') && has('phone') && !got('email') && !got('phone')) throw err400('Please enter an email or phone number.');
  return { answers, files };
}

function saveFiles(form, files) {
  if (!files.length) return [];
  const dir = path.join(filesDir, form.slug);
  fs.mkdirSync(dir, { recursive: true });
  return files.map((f) => {
    const ext = path.extname(f.name).toLowerCase() || '.png';
    const file = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}${ext}`;
    if (f.upload) fs.renameSync(f.upload.path, path.join(dir, file));
    else fs.writeFileSync(path.join(dir, file), f.data);
    return { field: f.field, label: f.label, name: f.name, file: `${form.slug}/${file}` };
  });
}

const stars = (n) => '★'.repeat(Number(n)) + '☆'.repeat(5 - Number(n));
const answerLine = (a) => `${a.label}: ${a.type === 'rating' ? `${stars(a.value)} (${a.value} of 5)` : a.type === 'scale' ? `${a.value} out of 10` : a.value}`;

// Saves one response: contact (when there is a way to reach them), history note, response row, alert.
// Returns { entry, contact, isNew }.
function record(form, answers, savedFiles = [], { source = 'link', optInSource } = {}) {
  const get = (t) => answers.find((a) => a.type === t)?.value || '';
  const email = get('email'), phone = get('phone'), company = get('company');
  const name = get('name') || company || (email ? email.split('@')[0] : '');
  const consent = answers.some((a) => a.type === 'consent');
  const rest = answers.filter((a) => !['name', 'email', 'phone', 'company', 'consent'].includes(a.type));
  // An old-style form with only a Message box keeps its plain note.
  const message = rest.length === 1 && rest[0].id === 'message' ? rest[0].value : rest.map(answerLine).join('\n');
  let contact = null, isNew = false;
  if (name && (email || phone)) {
    ({ contact, isNew } = crm.submitForm(form, { name, email, phone, company, message, email_ok: consent ? '1' : '' },
      optInSource && consent && email ? { optIn: { source: optInSource } } : {}));
    const address = get('address');
    if (address && !contact.address) contact = crm.updateContact(contact.id, { address });
    if (savedFiles.length) crm.logActivity(contact.id, { kind: 'Form', note: `Sent ${savedFiles.length} file${savedFiles.length > 1 ? 's' : ''} with "${form.title}" (see Forms > Responses).` });
  }
  const id = db.prepare('INSERT INTO crm_form_entries (form_id, contact_id, answers, files, source) VALUES (?,?,?,?,?)')
    .run(form.id, contact ? contact.id : null, JSON.stringify(answers), savedFiles.length ? JSON.stringify(savedFiles) : null, source).lastInsertRowid;
  const who = contact ? `${contact.name}${contact.company ? ` (${contact.company})` : ''}` : 'Someone';
  notify.send(contact ? (isNew ? 'New lead' : 'Form filled again') : 'New form response', `${who} filled out "${form.title}"`, { tags: 'inbox_tray' }).catch(() => {});
  return { entry: id, contact, isNew };
}

// A response that came through the always-on website code (Google Sheet inbox). See website.js.
function recordFromInbox(slug, r) {
  const row = db.prepare('SELECT * FROM crm_forms WHERE slug=?').get(String(slug));
  if (!row) return null;
  const form = formView(row);
  const lines = String(r.message || '').split('\n');
  const answers = [];
  // The website code sends "Question: answer" lines in the same order as the form.
  for (const f of form.fields) {
    if (LAYOUT.has(f.type) || f.type === 'file' || f.type === 'signature') continue;
    const direct = { name: r.name, email: r.email, phone: r.phone, company: r.company }[f.type];
    let value = direct;
    if (direct === undefined) {
      const at = lines.findIndex((l) => l.startsWith(`${f.label}: `));
      if (at >= 0) value = lines.splice(at, 1)[0].slice(f.label.length + 2);
    }
    if (f.type === 'consent') value = r.newsletter ? 'Yes' : '';
    if (value) answers.push({ id: f.id, label: f.label, type: f.type, value: String(value).slice(0, 3000) });
  }
  if (!answers.length) return null;
  const consent = form.fields.find((f) => f.type === 'consent');
  return record(form, answers, [], { source: 'website', optInSource: consent ? `Checked "${consent.label}" on form "${form.title}" (website), ${String(r.received || '').slice(0, 10)}` : null });
}

// ---------- Public routes (mounted at /f, no password) ----------
const tmpDir = path.join(filesDir, '.incoming');
const upload = multer({
  dest: tmpDir,
  limits: { fileSize: 25 * 1024 * 1024, files: 10, fieldSize: 1024 * 1024, fields: 200 },
});
const publicForms = express.Router();
publicForms.use(express.urlencoded({ extended: false, limit: '2mb' }));
const activeForm = (slug) => {
  const f = db.prepare('SELECT * FROM crm_forms WHERE slug=? AND active=1').get(String(slug));
  return f ? formView(f) : null;
};
publicForms.get('/:slug', (req, res) => {
  const f = activeForm(req.params.slug);
  if (!f) return res.status(404).send(notFound());
  res.send(renderPage(f));
});
publicForms.post('/:slug', (req, res, next) => {
  fs.mkdirSync(tmpDir, { recursive: true });
  upload.any()(req, res, (e) => {
    if (!e) return next();
    const f = activeForm(req.params.slug);
    const msg = e.code === 'LIMIT_FILE_SIZE' ? 'One of the files is bigger than 25 MB. Please pick a smaller one.' : e.code === 'LIMIT_FILE_COUNT' ? 'Please send 5 files or fewer.' : 'The form could not be read. Please try again.';
    res.status(400).send(f ? renderPage(f, { error: msg }) : notFound());
  });
}, (req, res) => {
  const uploads = req.files || [];
  const cleanup = () => uploads.forEach((u) => fs.rm(u.path, { force: true }, () => {}));
  const f = activeForm(req.params.slug);
  if (!f) { cleanup(); return res.status(404).send(notFound()); }
  if (req.body.website) { cleanup(); return res.send(thanksPage(f)); } // hidden box only spam robots fill in
  // Behind the Cloudflare tunnel every visitor looks like this computer, so use the visitor address it passes along.
  if (crm.tooMany(String(req.get('cf-connecting-ip') || req.ip))) { cleanup(); return res.status(429).send(shell(f.title, f.style, '<div class="vpf-card"><h1>Too many tries</h1><p>Please try again later.</p></div>')); }
  if (uploads.length > 5 * Math.max(1, f.fields.filter((x) => x.type === 'file').length)) { cleanup(); return res.status(400).send(renderPage(f, { error: 'Please send 5 files or fewer.', values: req.body })); }
  try {
    const { answers, files } = readAnswers(f, req.body, uploads);
    const used = new Set(files.filter((x) => x.upload).map((x) => x.upload.path));
    uploads.filter((u) => !used.has(u.path)).forEach((u) => fs.rm(u.path, { force: true }, () => {}));
    if (!answers.length) return res.status(400).send(renderPage(f, { error: 'Please answer at least one question.', values: req.body }));
    record(f, answers, saveFiles(f, files));
    res.send(thanksPage(f));
  } catch (e) {
    cleanup();
    if (!e.status) console.error(`[forms] ${e.stack || e.message}`);
    res.status(e.status || 500).send(renderPage(f, { error: e.status ? e.message : 'Something went wrong. Please try again.', values: req.body }));
  }
});

// ---------- Always-on website code ----------
// A copy of the form for any website. It sends answers to your Google Sheet website inbox,
// which is always on, so it works even when this Mac is off. No uploads or signatures there.
function embedCode(form, inboxUrl) {
  const scope = `vpf-${form.slug}`;
  const send = `(function(){var box=document.getElementById('${scope}');var form=box.querySelector('form');var INBOX=${JSON.stringify(inboxUrl)};
var map=${JSON.stringify(form.fields.filter((f) => !LAYOUT.has(f.type) && f.type !== 'file' && f.type !== 'signature').map((f) => [f.id, f.type, f.label]))};
form.addEventListener('submit',function(e){e.preventDefault();if(form.website&&form.website.value)return done();if(!form.reportValidity())return;
var p=new URLSearchParams(),lines=[],c={name:'',email:'',phone:'',company:''},news='no';
map.forEach(function(m){var vals=[];Array.prototype.forEach.call(form.querySelectorAll('[name="'+m[0]+'"]'),function(el){if(el.disabled)return;if((el.type==='checkbox'||el.type==='radio')&&!el.checked)return;if(el.value)vals.push(el.value)});
var v=vals.join(', ');if(!v)return;if(m[1] in c){c[m[1]]=v;return}if(m[1]==='consent'){news='yes';return}lines.push(m[2]+': '+(m[1]==='agree'?'Yes':v))});
if(!c.name&&!c.email&&!c.phone){form.querySelector('.vpf-btn').disabled=false;var er=box.querySelector('.vpf-err');er.hidden=false;er.textContent='Please add your name, email or phone so we can get back to you.';return}
p.set('form','vpform:${form.slug}');p.set('name',c.name);p.set('email',c.email);p.set('phone',c.phone);p.set('company',c.company);
p.set('message',lines.join('\\n'));p.set('newsletter',news);p.set('page',location.href.split('#')[0]);p.set('reply','json');
var b=form.querySelector('.vpf-btn');b.disabled=true;fetch(INBOX,{method:'POST',body:p,mode:'no-cors'}).then(done,function(){b.disabled=false;var er=box.querySelector('.vpf-err');er.hidden=false;er.textContent='Could not send. Please check your connection and try again.'})});
function done(){box.querySelector('.vpf-card').innerHTML='<div style="text-align:center;padding:20px 6px"><h1>Thank you!</h1><p class="vpf-intro">'+${JSON.stringify(nl(form.thank_you || "We got your answers and we'll be in touch soon."))}+'</p></div>'}})();`;
  return `<!-- ${form.title.replace(/--/g, '-')} (made with Viral Post) -->
<div id="${scope}" class="vpf" style="${themeCss(form.style)};padding:24px 12px;background:${(THEMES[form.style.theme] || THEMES.clean).bg};border-radius:16px">
<style>${FORM_CSS}</style>
${formInner(form, { embed: true })}
<script>${send}</script>
</div>`;
}

// ---------- Private routes (mounted at /api/crm/forms) ----------
const router = express.Router();
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};
const one = (id) => {
  const f = db.prepare('SELECT * FROM crm_forms WHERE id=?').get(Number(id));
  if (!f) throw Object.assign(new Error('Form not found'), { status: 404 });
  return formView(f);
};
const publicUrl = (f) => `${config.publicBaseUrl}/f/${f.slug}`;

router.get('/', wrap((req, res) => {
  const bf = require('./businesses').filter(req.query.biz);
  const forms = db.prepare(`SELECT * FROM crm_forms ${bf.sql ? `WHERE ${bf.sql}` : ''} ORDER BY id DESC`).all(...bf.args).map(formView);
  const counts = new Map(db.prepare('SELECT form_id, COUNT(*) AS n, MAX(created_at) AS last FROM crm_form_entries GROUP BY form_id').all().map((r) => [r.form_id, r]));
  // Sign-ups from before the builder only live in contact history.
  const legacy = db.prepare("SELECT note, COUNT(*) AS n FROM contact_activities WHERE kind='Form' AND note LIKE 'Filled out \"%' GROUP BY note").all();
  res.json(forms.map((f) => {
    const old = legacy.filter((c) => c.note.startsWith(`Filled out "${f.title}"`)).reduce((n, c) => n + c.n, 0);
    const c = counts.get(f.id);
    return { ...f, url: publicUrl(f), submissions: Math.max(c ? c.n : 0, old), last: c ? c.last : null };
  }));
}));
router.get('/kit', (req, res) => res.json({
  types: Object.entries(TYPES).map(([key, t]) => ({ key, ...t })),
  themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name, bg: t.bg, accent: t.accent, card: t.card })),
  templates: TEMPLATES.map(({ key, name, desc, color, icon }) => ({ key, name, desc, color, icon })),
}));
router.get('/template/:key', (req, res) => res.json(fromTemplate(req.params.key)));
router.post('/suggest', wrap((req, res) => res.json(suggest((req.body || {}).text))));
router.post('/preview', wrap((req, res) => {
  const b = req.body || {};
  const f = { title: String(b.title || 'Untitled form').slice(0, 200), intro: String(b.intro || ''), thank_you: String(b.thank_you || ''), fields: cleanFields(b.fields || []), style: cleanStyle(b.style || {}) };
  res.type('html').send(b.thanks ? thanksPage(f) : renderPage(f));
}));
router.post('/', wrap((req, res) => { require('./businesses').claim(req.query.biz, (req.body || {}).group_name); const f = saveForm(req.body || {}); res.json({ ...f, url: publicUrl(f) }); }));
router.put('/:id', wrap((req, res) => { require('./businesses').claim(req.query.biz, (req.body || {}).group_name); const f = saveForm(req.body || {}, Number(req.params.id)); res.json({ ...f, url: publicUrl(f) }); }));
router.post('/:id/copy', wrap((req, res) => {
  const f = one(req.params.id);
  const c = saveForm({ title: `${f.title} (copy)`, intro: f.intro, group_name: f.group_name, thank_you: f.thank_you, active: 1, fields: f.fields.map((x) => ({ ...x })), style: f.style });
  res.json({ ...c, url: publicUrl(c) });
}));
router.delete('/:id', wrap((req, res) => {
  const f = one(req.params.id);
  db.prepare('DELETE FROM crm_forms WHERE id=?').run(f.id);
  res.json({ ok: true });
}));
router.post('/logo', (req, res) => {
  multer({ dest: config.mediaDir, limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('logo')(req, res, (e) => {
    if (e || !req.file) return res.status(400).json({ error: 'Pick a picture under 5 MB.' });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) { fs.rm(req.file.path, { force: true }, () => {}); return res.status(400).json({ error: 'Use a PNG, JPG, GIF or WebP picture.' }); }
    const name = `form-logo-${crypto.randomBytes(6).toString('hex')}${ext}`;
    fs.renameSync(req.file.path, path.join(config.mediaDir, name));
    res.json({ logo: `/media/${name}` });
  });
});
router.get('/:id/qr.svg', wrap(async (req, res) => {
  const QR = require('qrcode');
  const svg = await QR.toString(publicUrl(one(req.params.id)), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
}));
router.get('/:id/qr.png', wrap(async (req, res) => {
  const QR = require('qrcode');
  const f = one(req.params.id);
  res.set('Content-Disposition', `attachment; filename="${f.title.replace(/[^\w -]+/g, '').slice(0, 60) || 'form'} QR code.png"`);
  res.type('png').send(await QR.toBuffer(publicUrl(f), { width: 1000, margin: 2 }));
}));
router.get('/:id/embed', wrap((req, res) => {
  const f = one(req.params.id);
  const inbox = (process.env.WEBSITE_INBOX_URL || '').trim();
  const skipped = f.fields.filter((x) => x.type === 'file' || x.type === 'signature').map((x) => x.label);
  const frame = `<iframe src="${publicUrl(f)}" title="${esc(f.title)}" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`;
  res.json({ ready: Boolean(inbox && process.env.WEBSITE_INBOX_KEY), code: inbox ? embedCode(f, inbox) : '', skipped, frame });
}));
router.get('/:id/entries', wrap((req, res) => {
  const f = one(req.params.id);
  const rows = db.prepare(`SELECT e.*, c.name AS contact_name FROM crm_form_entries e LEFT JOIN contacts c ON c.id=e.contact_id
    WHERE e.form_id=? ORDER BY e.id DESC LIMIT 1000`).all(f.id)
    .map((e) => ({ ...e, answers: parse(e.answers, []), files: parse(e.files, []) }));
  res.json({ form: f, entries: rows });
}));
router.delete('/:id/entries/:entry', wrap((req, res) => {
  const e = db.prepare('SELECT * FROM crm_form_entries WHERE id=? AND form_id=?').get(Number(req.params.entry), Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Response not found' });
  for (const x of parse(e.files, [])) fs.rm(path.join(filesDir, x.file), { force: true }, () => {});
  db.prepare('DELETE FROM crm_form_entries WHERE id=?').run(e.id);
  res.json({ ok: true });
}));
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formulas from running
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
router.get('/:id/entries.csv', wrap((req, res) => {
  const f = one(req.params.id);
  const qs = f.fields.filter((x) => !LAYOUT.has(x.type));
  const rows = db.prepare('SELECT * FROM crm_form_entries WHERE form_id=? ORDER BY id').all(f.id);
  const lines = [['Received', 'From', ...qs.map((q) => q.label), 'Files'].map(csvCell).join(',')];
  for (const r of rows) {
    const a = parse(r.answers, []), files = parse(r.files, []);
    lines.push([r.created_at, r.source === 'website' ? 'Website' : 'Link', ...qs.map((q) => a.find((x) => x.id === q.id)?.value ?? ''), files.map((x) => x.name).join('; ')].map(csvCell).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${f.title.replace(/[^\w -]+/g, '').slice(0, 60) || 'form'} responses.csv"`);
  res.send('﻿' + lines.join('\r\n') + '\r\n');
}));
// Uploaded files stay private (behind your password). Pictures, videos and PDFs open in the browser; anything else downloads.
router.get('/file/:slug/:name', (req, res) => {
  const slug = path.basename(req.params.slug), name = path.basename(req.params.name);
  const file = path.join(filesDir, slug, name);
  if (!/^[0-9a-f]+$/.test(slug) || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });
  const inline = /\.(jpe?g|png|gif|webp|pdf|mp4|mov|m4v)$/i.test(name);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  if (!inline) res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.sendFile(file);
});

module.exports = { TYPES, THEMES, TEMPLATES, publicForms, router, saveForm, formView, fromTemplate, suggest, readAnswers, record, recordFromInbox, renderPage, embedCode, legacyFields, cleanFields };
