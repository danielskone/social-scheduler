# Selling Viral Post (customer version)

Your own Mac setup does not change. The customer version is a separate way of starting
the same app, made for a server:

    npm run saas

## How it works

- Customers sign up at your site with their email and a password (stored scrambled, never readable).
- Each customer gets their own private copy of Viral Post: own folder, own database, own
  pictures, own scheduler. One customer can never see another's posts, contacts or files.
- New customers get a free trial (14 days by default). When it ends, the app closes for them
  until they pay. Their scheduled posts stop too.
- Payments go through Stripe's own secure page. Card numbers never touch Viral Post.
- You sign up with your own email (SAAS_ADMIN_EMAIL) to become the owner: free access plus a
  Customers page where you can give free access, add trial days, turn someone off, or make a
  password reset link.
- Customers send CRM emails from their own mailbox (Account page). Every email still carries
  their mailing address and an unsubscribe line (CAN-SPAM).
- Their public links (pictures for Instagram, sign-up forms, booking pages) live at
  https://your-site/w/<customer number>/...

## Settings (in the server's .env file, never in GitHub)

    SAAS_PUBLIC_URL=https://app.viralattraction.com
    SAAS_ADMIN_EMAIL=you@example.com
    SAAS_PRICE_LABEL=$29/month
    SAAS_TRIAL_DAYS=14
    SAAS_SIGNUPS=open            # or closed

    # Shared platform apps that customers connect their own accounts through
    META_APP_ID=...   META_APP_SECRET=...
    GOOGLE_CLIENT_ID=...   GOOGLE_CLIENT_SECRET=...
    TIKTOK_CLIENT_KEY=...   TIKTOK_CLIENT_SECRET=...

    # Optional: email password-reset links to customers
    SAAS_SMTP_HOST=smtp.hostinger.com   SAAS_SMTP_PORT=465
    SAAS_SMTP_USER=support@viralattraction.com   SAAS_SMTP_PASS=...   SAAS_EMAIL_FROM=support@viralattraction.com

    # Optional: switch payments on
    STRIPE_SECRET_KEY=sk_live_...   STRIPE_PRICE_ID=price_...   STRIPE_WEBHOOK_SECRET=whsec_...

Redirect addresses to add in each platform's developer settings:

- Meta:   https://app.viralattraction.com/auth/facebook/callback
- Google: https://app.viralattraction.com/auth/youtube/callback
- TikTok: https://app.viralattraction.com/auth/tiktok/callback
- Stripe webhook: https://app.viralattraction.com/stripe/webhook
  (events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted)

The gateway listens on 127.0.0.1 only. Put Caddy (free, automatic HTTPS) in front of it:

    app.viralattraction.com {
        reverse_proxy 127.0.0.1:3000
    }

## Before strangers can connect their accounts

- Meta: switch the app to Live and pass App Review for the Page and Instagram permissions
  (needs Business Verification and a short screen recording). Until then only people you add
  as app testers can connect.
- YouTube: the free quota is about 6 uploads a day in total, shared by all customers. Ask
  Google for a quota increase (free). The audit must pass for public uploads.
- TikTok: apply for the Direct Post audit, otherwise videos go to each customer's TikTok inbox.

## Limits on a server

- Mac voices (including Siri) in Ads Studio only exist on a Mac.
- Clips (speech-to-text) uses a lot of computer power; a small server can do one at a time.
- Each customer's copy uses roughly 100 MB of memory.
