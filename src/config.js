const path = require('path');

// Customer copies (started by the sign-up gateway, see src/saas/) get TENANT_KEY. They must
// not read the owner's .env; their own settings (email, phone alerts) live in their folder.
if (process.env.TENANT_KEY) {
  if (process.env.DATA_DIR) require('dotenv').config({ path: path.join(process.env.DATA_DIR, 'settings.env'), quiet: true });
} else {
  require('dotenv').config({ quiet: true });
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  port: Number(process.env.PORT || 3000),
  // Leave empty to listen on every network (needed for Tailscale). Customer copies use 127.0.0.1.
  host: process.env.HOST || '',
  // Set only on customer copies: requests must come from the gateway carrying this key.
  tenantKey: process.env.TENANT_KEY || '',
  // Daniel's own ready-made forms, emails and booking page (parade, Viral Attraction, car
  // business). Customers start with a clean CRM instead.
  ownerStarters: !process.env.TENANT_KEY,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Where Facebook sends you back after connecting. Defaults to PUBLIC_BASE_URL; set it to
  // http://localhost:3000 when the public address changes each run (e.g. a quick tunnel).
  oauthBaseUrl: (process.env.OAUTH_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Optional: a "Facebook Login for Business" configuration ID, used instead of a scope list.
  metaLoginConfigId: process.env.META_LOGIN_CONFIG_ID || '',
  appPassword: process.env.APP_PASSWORD || '',
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  graphVersion: process.env.GRAPH_VERSION || 'v23.0',
  // Overridable so tests can point at a fake Graph API.
  graphBase: process.env.GRAPH_BASE || 'https://graph.facebook.com',
  graphVideoBase: process.env.GRAPH_VIDEO_BASE || process.env.GRAPH_BASE || 'https://graph-video.facebook.com',
  // Instagram's direct video upload address (used so Instagram never has to download from this Mac).
  igUploadBase: process.env.IG_UPLOAD_BASE || process.env.GRAPH_BASE || 'https://rupload.facebook.com',
  dataDir,
  mediaDir: path.join(dataDir, 'media'),
  dbPath: path.join(dataDir, 'scheduler.db'),
};
