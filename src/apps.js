// The separate apps: Viral Post (the scheduler), Viral Touch CRM and Viral Clips.
//
// On the Mac each app runs as its own program (APP=crm etc., see scripts/background.js) on its
// own port: Viral Post 3000, Viral Touch CRM 3001, Viral Clips 3002. Each
// has its own address, menu, icon, Desktop app and background jobs. They read the same data
// folder, so a clip or an ad can still be scheduled in Viral Post.
//
// Without APP (customer copies, tests) one program serves every app at its own path instead:
// /, /crm/, /clips/.
//
// APPS in .env picks which apps are switched on (default: all), e.g. APPS=scheduler to sell or
// run Viral Post on its own. Viral Post (the scheduler) is always on.
const APPS = [
  { key: 'scheduler', name: 'Viral Post', short: 'Viral Post', path: '/', port: 3000, home: 'calendar', views: ['calendar', 'compose', 'analytics', 'accounts'], icon: 'icon', theme: '#3b5bdb', about: 'Schedule and auto-post to Facebook, Instagram, TikTok and YouTube.' },
  { key: 'crm', name: 'Viral Touch CRM', short: 'Viral Touch', path: '/crm/', port: 3001, home: 'contacts', views: ['contacts'], icon: 'crm', theme: '#10967a', about: 'Contacts, pipeline, tasks, forms, bookings, email and automations.', apis: ['/api/crm'] },
  { key: 'clips', name: 'Viral Clips', short: 'Viral Clips', path: '/clips/', port: 3002, home: 'clips', views: ['clips'], icon: 'clips', theme: '#f58c1e', about: 'Turn a long video into short captioned clips.', apis: ['/api/clips', '/clipfile'] },
];

// Apps that were removed (Viral Ads Studio, 2026-11). The Mac setup scripts stop their old
// background program and remove their Desktop app; their saved files in data/ are left alone.
const RETIRED = [{ key: 'ads', name: 'Viral Ads Studio', port: 3003 }];

function enabledApps(env = process.env) {
  const raw = String(env.APPS || '').trim().toLowerCase();
  if (!raw || raw === 'all') return APPS;
  const want = new Set(raw.split(/[\s,]+/));
  return APPS.filter((a) => a.key === 'scheduler' || want.has(a.key));
}

const byKey = (key) => APPS.find((a) => a.key === key);

// The app this program runs on its own (APP=crm), or null when one program serves them all.
function own(env = process.env) {
  const a = byKey(String(env.APP || '').trim().toLowerCase());
  return a && enabledApps(env).includes(a) ? a : null;
}

// Each app's port when they run as separate programs (CRM_PORT=4001 etc. can move one).
const portOf = (a, env = process.env) => Number(env[`${a.key.toUpperCase()}_PORT`] || a.port);

// What the browser needs: names, addresses and pages of the apps that are on.
// separate=true: each app is at its own port (the page builds http://<same host>:<port>/).
const publicInfo = (list, separate = false, env = process.env) => list.map(({ key, name, short, path, home, views, icon, ...a }) => ({
  key, name, short, home, views, icon, path: separate ? '/' : path, port: separate ? portOf({ key, ...a }, env) : null,
}));

function manifest(a, separate = false) {
  const icon = a.icon;
  return {
    name: a.name,
    short_name: a.short,
    id: separate ? `/${a.key}` : a.path,
    start_url: `${separate ? '/' : a.path}#${a.home}`,
    scope: separate ? '/' : a.path,
    display: 'standalone',
    background_color: '#14161b',
    theme_color: a.theme,
    icons: [
      { src: `/icons/${icon}-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `/icons/${icon}-512.png`, sizes: '512x512', type: 'image/png' },
    ],
  };
}

const touchIcon = (a) => (a.icon === 'icon' ? '/icons/apple-touch-icon.png' : `/icons/${a.icon}-touch.png`);

module.exports = { APPS, RETIRED, enabledApps, byKey, own, portOf, publicInfo, manifest, touchIcon };
