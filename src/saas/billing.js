// Payments through Stripe (free to set up; Stripe keeps a small fee from each payment).
// Switched off until STRIPE_SECRET_KEY and STRIPE_PRICE_ID are set; until then new
// customers simply get the free trial. Uses Stripe's plain web API, no extra packages.
//
// Stripe settings (all in the server's .env, never in GitHub):
//   STRIPE_SECRET_KEY      sk_live_... (or sk_test_... while testing)
//   STRIPE_PRICE_ID        price_...  the monthly plan made in the Stripe dashboard
//   STRIPE_WEBHOOK_SECRET  whsec_...  from Developers > Webhooks, pointing at /stripe/webhook
const crypto = require('crypto');

function createBilling({ secretKey = '', priceId = '', webhookSecret = '', apiBase = 'https://api.stripe.com' } = {}) {
  const enabled = Boolean(secretKey && priceId);

  async function stripe(method, path, params) {
    const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
    const res = await fetch(`${apiBase}/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Stripe said ${res.status}`);
    return data;
  }

  return {
    enabled,

    // Sends the customer to Stripe's own secure payment page. Card numbers never touch Viral Post.
    async checkoutUrl(user, baseUrl) {
      const params = {
        mode: 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': 1,
        client_reference_id: String(user.id),
        success_url: `${baseUrl}/account?paid=1`,
        cancel_url: `${baseUrl}/account`,
        allow_promotion_codes: 'true',
      };
      if (user.stripe_customer_id) params.customer = user.stripe_customer_id;
      else params.customer_email = user.email;
      return (await stripe('POST', 'checkout/sessions', params)).url;
    },

    // Stripe's page where customers change their card, see receipts, or cancel.
    async portalUrl(user, baseUrl) {
      return (await stripe('POST', 'billing_portal/sessions', { customer: user.stripe_customer_id, return_url: `${baseUrl}/account` })).url;
    },

    // Checks the message really came from Stripe (signed with the webhook secret).
    verifyWebhook(rawBody, header, { toleranceSec = 300, now = Date.now() } = {}) {
      if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
      const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
      const sigs = String(header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
      const t = Number(parts.t);
      if (!t || !sigs.length) throw new Error('Missing Stripe signature.');
      if (Math.abs(now / 1000 - t) > toleranceSec) throw new Error('Stripe message is too old.');
      const want = crypto.createHmac('sha256', webhookSecret).update(`${t}.${rawBody}`).digest('hex');
      const ok = sigs.some((s) => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
      if (!ok) throw new Error('Stripe signature does not match.');
      return JSON.parse(rawBody);
    },

    // Updates a customer's plan from a Stripe event. Returns the user that changed (if any).
    applyEvent(store, event) {
      const o = event.data?.object || {};
      if (event.type === 'checkout.session.completed') {
        const user = store.getUser(Number(o.client_reference_id));
        if (!user) return null;
        return store.update(user.id, { stripe_customer_id: o.customer, stripe_subscription_id: o.subscription, status: 'active' });
      }
      if (event.type.startsWith('customer.subscription.')) {
        const user = store.byStripeCustomer(o.customer);
        if (!user) return null;
        if (user.status === 'free' || user.status === 'disabled') return user; // owner's choice wins
        const map = { active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'canceled', canceled: 'canceled', incomplete_expired: 'canceled', incomplete: 'past_due' };
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : (map[o.status] || 'canceled');
        const end = o.current_period_end || o.items?.data?.[0]?.current_period_end; // newer Stripe puts it on the item
        return store.update(user.id, {
          status,
          stripe_subscription_id: o.id,
          current_period_end: end ? new Date(end * 1000).toISOString() : user.current_period_end,
        });
      }
      return null;
    },
  };
}

function flatten(obj) {
  return Object.entries(obj).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]);
}

module.exports = { createBilling };
