// Turns a simple email design (heading, picture, text, button) into a good-looking HTML
// email that works in Gmail, Apple Mail and Outlook (tables and inline styles only).
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^(https?:\/\/|mailto:|tel:|\{\{)/i.test(String(u || '').trim()) ? String(u).trim() : '');

// Plain text -> paragraphs; links become clickable; **bold** works.
function textToHtml(text) {
  return String(text || '').trim().split(/\n\s*\n/).filter(Boolean).map((p) => {
    let h = esc(p).replace(/\n/g, '<br>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#6d28d9">$1</a>');
    return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2330">${h}</p>`;
  }).join('\n');
}

// design: { preheader, heading, body, image_url, button_text, button_url }
// footerHtml: already-safe HTML for the bottom (address, unsubscribe link).
function render(design, footerHtml = '') {
  const d = design || {};
  const img = safeUrl(d.image_url);
  const btnUrl = safeUrl(d.button_url);
  const color = /^#[0-9a-f]{6}$/i.test(d.color || '') ? d.color : '#6d28d9';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.heading || d.subject || '')}</title></head>
<body style="margin:0;padding:0;background:#f3f4f8">
${d.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(d.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
${img ? `<tr><td><img src="${esc(img)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>` : `<tr><td style="height:6px;background:${color}"></td></tr>`}
<tr><td style="padding:28px 28px 8px">
${d.heading ? `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#111">${esc(d.heading)}</h1>` : ''}
${textToHtml(d.body)}
${d.button_text && btnUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:8px;background:${color}">
<a href="${esc(btnUrl)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(d.button_text)}</a></td></tr></table>` : ''}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #eceef3;font-size:12px;line-height:1.6;color:#80869a">${footerHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

module.exports = { render, textToHtml, esc, safeUrl };
