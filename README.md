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

## Run it in the background (Mac)

```bash
npm run background:on      # starts now and at every login, no Terminal window needed
npm run background:status  # is it running? shows the last log lines (data/app.log)
npm run background:off     # stop
```

The Mac must be on (the app keeps it from idle-sleeping; the screen can still turn off).

## Import many posts at once

On the Calendar, **Import posts** takes a post bundle: one `.json` file with the posts and their pictures (base64). Format is documented at the top of `src/importer.js`. Everything is checked first; if any post has a problem, nothing is imported. Importing the same bundle twice doesn't create duplicates.

## Updating

`npm run update` downloads the latest version from GitHub (the repo must be public while it runs), keeping `.env` and `data/`.

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

## Phone notifications (free)

1. Install the free **ntfy** app on your iPhone (App Store) and allow notifications.
2. In Terminal, in the app folder: `npm run phone`. It prints a name like `sched-…`.
3. In ntfy tap **+**, type that name exactly, tap **Subscribe**.

You then get a message each time a post goes out, and an urgent one if a post fails.

## YouTube (free)

Step-by-step guide: `/mnt/project-files/setup/youtube-setup.md` (in the project files).
Short version: create a Google Cloud project, enable **YouTube Data API v3**, set up the
consent screen (External, then **Publish app**), create a **Web application** OAuth client with
redirect `http://localhost:3000/auth/youtube/callback`, run `npm run youtube-keys`, then
`npm run background:on` and click **Connect YouTube** on the Accounts page.

YouTube posts need a video. The title defaults to the caption's first line (or set one in the
composer / `"title"` in an import bundle). Until Google audits your API project (free form:
YouTube API Services Audit and Quota Extension), uploads are kept **private** by YouTube.

## TikTok (free)

Step-by-step guide: `/mnt/project-files/setup/tiktok-setup.md` (in the project files).
TikTok only returns sign-ins to https addresses, so `docs/tiktok-callback.html` (served by
GitHub Pages from the `docs/` folder) forwards the sign-in to `http://localhost:3000`. The same
folder has the Terms and Privacy pages TikTok asks for. Keys: `npm run tiktok-keys`.

`TIKTOK_MODE=draft` (default): at the scheduled time the video goes to your TikTok inbox and your
phone alert includes the caption to paste; you tap Post in TikTok. `TIKTOK_MODE=direct` posts by
itself, but TikTok keeps those posts private until the app passes TikTok's audit.

## Use it on your iPhone (free home-screen app)
1. On the Mac: `npm run password` (pick a password), then `npm run background:on`.
2. `npm run phone-app` shows the address, for example `http://192.168.1.20:3000`.
3. On the iPhone (same Wi-Fi), open that address in Safari, tap Share, then **Add to Home Screen**.
Without a password, Viral Post only opens on the Mac itself.
