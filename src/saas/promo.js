// The Viral Touch CRM sales page (/deal), for ads and promotions. Plain HTML, no build step,
// works on phones. A sale shows only when SAAS_PROMO_TEXT is set and SAAS_PROMO_ENDS has not
// passed; the discount itself is a Stripe promotion code the customer types at checkout.
const { esc } = require('./pages');

// Reads the sale from .env. Returns null when there is no sale running right now.
function promoFrom(env, now = Date.now()) {
  const text = String(env.SAAS_PROMO_TEXT || '').trim();
  if (!text) return null;
  const ends = env.SAAS_PROMO_ENDS ? Date.parse(env.SAAS_PROMO_ENDS) : NaN;
  if (Number.isFinite(ends) && ends <= now) return null;
  return {
    text,
    code: String(env.SAAS_PROMO_CODE || '').trim(),
    ends: Number.isFinite(ends) ? ends : null,
    endsLabel: String(env.SAAS_PROMO_ENDS_LABEL || '').trim(),
  };
}

const INCLUDED = [
  'Contacts and sales pipelines', 'Tasks and reminders', 'Forms and sign-up pages',
  'Booking pages with Google Calendar', 'Email campaigns', 'Automations and workflows',
  'One inbox for your messages', 'Quotes, invoices and contracts', 'Review requests',
  'Websites, funnels and a blog', 'Courses and a member community', 'Coupons, gift cards and loyalty',
  'Social post scheduling', 'Team logins',
];

const CHECK = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#0d0e17;color:#f4f4f8;font:17px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:#2dd4bf}.wrap{max-width:1160px;margin:0 auto;padding:0 24px}
.bar{background:#7c3aed;color:#fff;text-align:center;padding:12px 20px;font-weight:600;font-size:15px}
.top{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;padding:20px 24px}
.logo{display:flex;align-items:center;gap:12px;font-weight:700;font-size:20px;color:#f4f4f8;text-decoration:none}.logo img{width:44px;height:44px;border-radius:12px}
nav{display:flex;flex-wrap:wrap;gap:20px;align-items:center}nav a{color:#c9cbd8;text-decoration:none}
.btn{display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:12px}.btn:hover{background:#6d28d9}
.btn.ghost{background:none;border:1px solid #3a3d52;color:#f4f4f8}.btn.ghost:hover{border-color:#2dd4bf}
.btn.small{padding:10px 18px}.btn.full{display:block;text-align:center}
.hero{display:flex;flex-wrap:wrap;gap:48px;align-items:center;padding:56px 24px 80px}
.hero>div{flex:1 1 440px;min-width:0}.kicker{color:#2dd4bf;font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:14px;margin:0 0 14px}
h1{font-size:clamp(38px,5.5vw,62px);line-height:1.05;margin:0 0 20px}h2{font-size:clamp(30px,4vw,42px);line-height:1.15;margin:0 0 16px}h3{font-size:21px;margin:0 0 8px}
.lead{font-size:19px;color:#c9cbd8;margin:0 0 30px}.row{display:flex;flex-wrap:wrap;gap:14px}
.panel{background:#161828;border:1px solid #2a2d42;border-radius:20px;padding:30px}
.clock{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:8px 0 20px}
.clock div{background:#0d0e17;border-radius:12px;padding:14px 4px;text-align:center}.clock b{display:block;font-size:34px}.clock span{font-size:13px;color:#a8abbe}
.code{display:inline-block;font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:20px;letter-spacing:.06em;background:#0d0e17;border:1px dashed #2dd4bf;border-radius:10px;padding:8px 16px;margin:4px 0 12px}
.muted{color:#a8abbe}.light{background:#f4f4f8;color:#0d0e17}.light .muted{color:#44475a}
section.pad{padding:88px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:24px}
.card{background:#fff;border-radius:16px;padding:28px}.card p{margin:0;color:#44475a}
.list{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px 32px;list-style:none;padding:0;margin:40px 0 0}.list li{display:flex;gap:10px;align-items:flex-start}.list svg{flex:none;margin-top:3px}
.price{max-width:480px;margin:40px auto 0;text-align:center}.price .big{font-size:48px;font-weight:700;margin:6px 0}
.final{background:#7c3aed;color:#fff;text-align:center}.final .btn{background:#fff;color:#4c1d95}
footer{padding:40px 24px 56px;color:#a8abbe;font-size:13px}footer a{color:#a8abbe}
`;

function crmPromo({ priceLabel, trialDays, signupsOpen, beta, promo }) {
  const start = beta
    ? '<a class="btn" href="/login">Sign in</a>'
    : signupsOpen ? `<a class="btn" href="/signup">${trialDays ? `Start your ${trialDays}-day free trial` : 'Create your account'}</a>` : '<a class="btn" href="/login">Sign in</a>';
  const startFull = start.replace('class="btn"', 'class="btn full"');
  const ends = promo && (promo.endsLabel || (promo.ends ? new Date(promo.ends).toUTCString().replace(':00 GMT', ' GMT') : ''));
  const offer = promo ? `
<div class="panel">
  ${promo.ends ? `<p class="muted" style="margin:0">Deal ends in</p>
  <div class="clock" id="clock" data-ends="${promo.ends}"><div><b>--</b><span>Days</span></div><div><b>--</b><span>Hours</span></div><div><b>--</b><span>Minutes</span></div><div><b>--</b><span>Seconds</span></div></div>` : ''}
  <p style="margin:0 0 6px;font-weight:600">${esc(promo.text)}</p>
  ${promo.code ? `<p class="muted" style="margin:0">Use this code at checkout:</p><span class="code">${esc(promo.code)}</span>` : ''}
  ${ends ? `<p class="muted small" style="margin:0;font-size:15px">Offer ends ${esc(ends)}.</p>` : ''}
</div>` : `
<div class="panel">
  <p style="margin:0 0 6px;font-weight:600">One plan, everything included.</p>
  <p class="muted" style="margin:0">${esc(priceLabel)}${trialDays && !beta ? ` after your ${trialDays}-day free trial` : ''}. No setup fees.</p>
</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Viral Touch CRM${promo ? ` · ${esc(promo.text)}` : ''}</title>
<meta name="description" content="Contacts, pipelines, booking, email, automations and invoices in one login.">
<link rel="icon" href="/icons/crm-192.png"><style>${CSS}</style></head><body>
${promo ? `<div class="bar">${esc(promo.text)}${promo.code ? ` with code ${esc(promo.code)}` : ''}${ends ? `. Ends ${esc(ends)}.` : ''}</div>` : ''}
<header class="wrap top">
  <a class="logo" href="/deal"><img src="/icons/crm-192.png" alt="">Viral Touch CRM</a>
  <nav><a href="#included">Features</a><a href="#pricing">Pricing</a><a href="/login">Sign in</a>${signupsOpen && !beta ? '<a class="btn small" href="/signup">Get started</a>' : ''}</nav>
</header>

<section class="wrap hero">
  <div>
    <p class="kicker">${promo ? 'Limited-time offer' : 'Viral Touch CRM'}</p>
    <h1>Run your whole business from one CRM.</h1>
    <p class="lead">Contacts, pipelines, booking, email, automations and invoices in one login, on your computer or your phone.</p>
    <div class="row">${start}<a class="btn ghost" href="#included">See what’s included</a></div>
  </div>
  <div>${offer}</div>
</section>

<section class="light pad"><div class="wrap">
  <h2 style="max-width:760px">One login. One bill. No more juggling apps.</h2>
  <p class="muted" style="max-width:720px;margin:0 0 40px">Stop paying for a scheduler, an email tool, a form builder and a spreadsheet that never talk to each other. Viral Touch keeps every lead and every conversation in one place.</p>
  <div class="grid">
    <div class="card"><h3>Never lose a lead</h3><p>Every form, booking and message lands on one contact record and moves through your pipeline.</p></div>
    <div class="card"><h3>Follow up automatically</h3><p>Set emails and tasks to happen on their own after a form fill or a booked appointment.</p></div>
    <div class="card"><h3>Get paid faster</h3><p>Send quotes, contracts and invoices from the same place you keep your customers.</p></div>
  </div>
</div></section>

<section class="pad" id="included"><div class="wrap">
  <h2>Everything included</h2>
  <ul class="list">${INCLUDED.map((i) => `<li>${CHECK}${esc(i)}</li>`).join('')}</ul>
</div></section>

<section class="pad" id="pricing" style="background:#161828"><div class="wrap">
  <h2 style="text-align:center">Simple pricing</h2>
  <div class="panel price" style="background:#0d0e17">
    <p class="muted" style="margin:0">Viral Touch CRM</p>
    <p class="big">${esc(priceLabel)}</p>
    <p class="muted">${trialDays && !beta ? `${trialDays}-day free trial. ` : ''}Every feature included. Cancel any time.</p>
    ${promo ? `<p style="color:#2dd4bf;font-weight:600">${esc(promo.text)}${promo.code ? ` with code ${esc(promo.code)}` : ''}</p>` : ''}
    ${startFull}
  </div>
</div></section>

<section class="final pad"><div class="wrap" style="max-width:820px">
  <h2>It’s your turn.</h2>
  <p style="font-size:19px;margin:0 0 30px">${promo ? `${esc(promo.text)}${ends ? `, until ${esc(ends)}` : ''}. After that, regular pricing applies.` : 'Bring your leads, bookings and follow-ups into one place today.'}</p>
  ${start}
</div></section>

<footer class="wrap">
  ${promo ? `<p>${promo.code ? `Enter code ${esc(promo.code)} on the payment page to get the discount. ` : ''}The offer is for new subscriptions${ends ? ` started before ${esc(ends)}` : ''}. Regular pricing applies after the discount period. Results vary by business.</p>` : ''}
  <p>© ${new Date().getFullYear()} Viral Touch CRM · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
</footer>
${promo && promo.ends ? `<script>
(function(){var c=document.getElementById('clock');if(!c)return;var end=Number(c.dataset.ends),b=c.querySelectorAll('b');
function p(n){return String(n).padStart(2,'0')}
function t(){var s=Math.max(0,Math.floor((end-Date.now())/1000));b[0].textContent=p(Math.floor(s/86400));b[1].textContent=p(Math.floor(s%86400/3600));b[2].textContent=p(Math.floor(s%3600/60));b[3].textContent=p(s%60);}
t();setInterval(t,1000);})();
</script>` : ''}
</body></html>`;
}

module.exports = { crmPromo, promoFrom };
