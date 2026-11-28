// The Viral Touch CRM sales page (/deal): the sale shows only while it is running.
const test = require('node:test');
const assert = require('node:assert');
const { crmPromo, promoFrom } = require('../src/saas/promo');

const page = (promo, extra = {}) => crmPromo({ priceLabel: '$29/month', trialDays: 14, signupsOpen: true, beta: false, promo, ...extra });

test('no sale set: the page shows the regular price and no countdown', () => {
  assert.strictEqual(promoFrom({}), null);
  const html = page(null);
  assert.match(html, /\$29\/month/);
  assert.match(html, /Start your 14-day free trial/);
  assert.doesNotMatch(html, /id="clock"/);
});

test('a running sale shows its text, code and countdown', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const promo = promoFrom({ SAAS_PROMO_TEXT: '50% off your first 3 months', SAAS_PROMO_CODE: 'BLACKFRIDAY', SAAS_PROMO_ENDS: '2026-11-30T23:59:00-05:00', SAAS_PROMO_ENDS_LABEL: 'Monday, Nov 30 at 11:59 PM ET' }, now);
  assert.ok(promo);
  const html = page(promo);
  assert.match(html, /50% off your first 3 months/);
  assert.match(html, /BLACKFRIDAY/);
  assert.match(html, /id="clock" data-ends="\d+"/);
  assert.match(html, /Monday, Nov 30 at 11:59 PM ET/);
});

test('a sale that has ended is hidden', () => {
  const promo = promoFrom({ SAAS_PROMO_TEXT: '50% off', SAAS_PROMO_ENDS: '2026-11-30T23:59:00-05:00' }, Date.parse('2026-12-02T00:00:00Z'));
  assert.strictEqual(promo, null);
});

test('text from .env is escaped, and closed sign-ups or beta send people to sign in', () => {
  const html = page({ text: '<b>x</b>', code: '"><script>', ends: null, endsLabel: '' });
  assert.doesNotMatch(html, /<b>x<\/b>|"><script>/);
  assert.doesNotMatch(page(null, { signupsOpen: false }), /href="\/signup"/);
  assert.doesNotMatch(page(null, { beta: true }), /href="\/signup"/);
});
