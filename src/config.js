require('dotenv').config();
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  port: Number(process.env.PORT || 3000),
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
  dataDir,
  mediaDir: path.join(dataDir, 'media'),
  dbPath: path.join(dataDir, 'scheduler.db'),
};
