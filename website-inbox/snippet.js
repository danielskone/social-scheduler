/* Viral Post: copies every form sign-up on this website into Viral Touch CRM.
   It only listens: your forms keep working exactly as before (and keep emailing you).
   Optional tags on a <form>: data-viral-post="off" (skip it), "newsletter" or "contact",
   and data-viral-post-form="Name to show in the CRM". */
(function () {
  var INBOX = '__INBOX_URL__';
  if (!/^https:\/\/script\.google\.com\//.test(INBOX)) return;

  function labelOf(el) {
    var t = '';
    if (el.labels && el.labels.length) {
      var c = el.labels[0].cloneNode(true); // leave out the box itself (and a list's choices)
      Array.prototype.forEach.call(c.querySelectorAll('input, select, textarea'), function (x) { x.remove(); });
      t = c.textContent;
    }
    if (!t && el.id) { var l = document.querySelector('label[for="' + el.id + '"]'); if (l) t = l.textContent; }
    return (t || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
  }
  function hidden(el) {
    var r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return el.offsetParent === null || s.visibility === 'hidden' || s.opacity === '0' || r.right < 0 || r.bottom < 0 || r.width < 2 || r.height < 2;
  }
  function titleOf(form) {
    if (form.getAttribute('data-viral-post-form')) return form.getAttribute('data-viral-post-form');
    var box = form.closest('section, article, aside, footer, main') || form.parentElement;
    var h = box && box.querySelector('h1, h2, h3, h4');
    return ((h && h.textContent) || form.getAttribute('aria-label') || form.id || 'Website form').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function collect(form, submitter) {
    var d = { name: '', last: '', email: '', phone: '', company: '', interest: '', preferred_time: '', message: [], newsletter: false, bot: false };
    var all = [];
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name && !el.id) return;
      if (/^(submit|button|reset|file|password|image)$/.test(el.type) || el.disabled) return;
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
      var v = String(el.value || '').trim(), label = labelOf(el), key = (label + ' ' + (el.name || '')).toLowerCase();
      if (!v) return;
      if (el.type === 'hidden') return;
      // A filled-in text box that people can't see is a spam-robot trap.
      if (el.tagName === 'INPUT' && /^(text|email|url|tel|number|)$/.test(el.type) && hidden(el)) { d.bot = true; return; }
      if (el.type === 'checkbox') {
        if (/newsletter|e-?mail me|updates|stay in the loop|subscribe|mailing list/.test(key)) d.newsletter = true;
        all.push(label + ': yes'); return;
      }
      all.push(label + ': ' + v);
      if (!d.email && (el.type === 'email' || /e-?mail/.test(key))) d.email = v;
      else if (!d.phone && (el.type === 'tel' || /phone|mobile|cell/.test(key))) d.phone = v;
      else if (!d.company && /business|company|organi[sz]ation/.test(key)) d.company = v;
      else if (!d.last && /last.?name|surname/.test(key)) d.last = v;
      else if (!d.name && /name/.test(key)) d.name = v;
      else if (!d.interest && (el.tagName === 'SELECT' || /interest|help with|service/.test(key))) d.interest = v;
      else if (!d.preferred_time && /time|when|day/.test(key)) d.preferred_time = v;
      else if (el.tagName === 'TEXTAREA' || /message|goal|about|detail|comment|question/.test(key)) d.message.push((label ? label + ': ' : '') + v);
    });
    var mode = form.getAttribute('data-viral-post') || '';
    var words = (titleOf(form) + ' ' + ((submitter && (submitter.value || submitter.textContent)) || '')).toLowerCase();
    if (mode === 'newsletter' || (mode !== 'contact' && /newsletter|stay in the loop|subscribe|sign ?up/.test(words))) d.newsletter = true;
    d.all = all;
    return d;
  }

  document.addEventListener('submit', function (ev) {
    try {
      var form = ev.target;
      if (!form || form.getAttribute('data-viral-post') === 'off') return;
      var d = collect(form, ev.submitter);
      if (d.bot || (!d.email && !d.phone)) return;
      var p = new URLSearchParams();
      p.set('form', location.hostname.replace(/^www\./, '') + ': ' + titleOf(form));
      p.set('name', (d.name + ' ' + d.last).trim());
      p.set('email', d.email); p.set('phone', d.phone); p.set('company', d.company);
      p.set('interest', d.interest); p.set('preferred_time', d.preferred_time);
      p.set('message', d.message.join('\n')); p.set('newsletter', d.newsletter ? 'yes' : 'no');
      p.set('page', location.href.split('#')[0]); p.set('fields', d.all.join('\n'));
      p.set('reply', 'json');
      // sendBeacon still delivers when the page moves on to a thank-you page.
      if (!(navigator.sendBeacon && navigator.sendBeacon(INBOX, p))) fetch(INBOX, { method: 'POST', body: p, mode: 'no-cors', keepalive: true });
    } catch (e) { /* never get in the way of the website's own form */ }
  }, true);
})();
