# Social Scheduler

A personal Metricool-style scheduler for **Facebook Pages** and **Instagram** (Business/Creator). Write a post once, pick accounts and a time, and it publishes automatically. Includes a content calendar and basic analytics (likes, comments, shares, views, follower growth).

TikTok and YouTube are planned next.

## What you need

- [Node.js](https://nodejs.org) 20 or newer
- A Meta developer app (see `setup/meta-facebook-instagram-setup.md` in the project files), left in **Development mode**. No App Review needed because only you use it.

## Run it

```bash
npm install
cp .env.example .env      # then fill in META_APP_ID, META_APP_SECRET, APP_PASSWORD, TZ
npm start
```

Open http://localhost:3000 and go to **Accounts → Connect Facebook & Instagram**.

### One extra Meta setting

In your Meta app, add the **Facebook Login** product (if it isn't already there), then under Facebook Login → Settings add this as a **Valid OAuth Redirect URI**:

```
<PUBLIC_BASE_URL>/auth/facebook/callback
```

e.g. `http://localhost:3000/auth/facebook/callback`. The Accounts page shows the exact address to paste.

## Instagram needs a public address

Instagram's API doesn't accept uploads. It downloads your photo/video from a link, so `PUBLIC_BASE_URL` must be a public `https://` address pointing at this app. Facebook posts work without it. Free options:

- **Your own computer**: `npm run mac` starts the app with a free Cloudflare quick tunnel and sets the public address automatically (needs `brew install cloudflared`). See `setup/run-on-your-mac.md` in the project files.
- **A small always-on server** (e.g. Oracle Cloud Always Free, or a cheap VPS), so posts go out while your computer is off.

Set `APP_PASSWORD` before exposing the app publicly. Uploaded media under `/media/` stays public on purpose so Instagram can fetch it.

## How it works

- `src/server.js`: web server, dashboard API, Facebook login
- `src/scheduler.js`: checks every minute for due posts and publishes them; refreshes stats every 3 hours
- `src/meta.js`: Meta Graph API calls (publish, stats, tokens)
- `src/db.js`: SQLite database in `data/` (uploaded media in `data/media/`)
- `public/`: the dashboard (calendar, composer, analytics, accounts)

Page tokens obtained through the login don't expire, so you only need to reconnect if you change your Facebook password or remove the app's access.

If the app restarts in the middle of publishing, that post is marked **failed** rather than retried, to avoid double posting. Check the platform, then hit **Retry** if needed.

## Limits

- Instagram: photos (JPG) and videos (posted as Reels), up to 50 API posts per 24 hours. Carousels and Stories aren't supported yet.
- Facebook: text, photo, or video posts to Pages. Personal profiles can't be posted to via Meta's API.

## Tests

```bash
npm test
```

Runs an end-to-end test against a fake Graph API (no real accounts are touched).
