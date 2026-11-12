// The separate apps that live in this one install. Each has its own address, menu, icon and
// home-screen / Desktop app, but they share one background program and one set of data, so a
// clip or an ad can still be scheduled in Viral Post.
//
// APPS in .env picks which apps are switched on (default: all), e.g. APPS=scheduler to sell or
// run Viral Post on its own. Viral Post (the scheduler) is always on.
const APPS = [
  { key: 'scheduler', name: 'Viral Post', short: 'Viral Post', path: '/', home: 'calendar', views: ['calendar', 'compose', 'analytics', 'accounts'], icon: 'icon', theme: '#3b5bdb', about: 'Schedule and auto-post to Facebook, Instagram, TikTok and YouTube.' },
  { key: 'crm', name: 'Viral Touch CRM', short: 'Viral Touch', path: '/crm/', home: 'contacts', views: ['contacts'], icon: 'crm', theme: '#10967a', about: 'Contacts, pipeline, tasks, forms, bookings, email and automations.', apis: ['/api/crm'] },
  { key: 'clips', name: 'Viral Clips', short: 'Viral Clips', path: '/clips/', home: 'clips', views: ['clips'], icon: 'clips', theme: '#f58c1e', about: 'Turn a long video into short captioned clips.', apis: ['/api/clips', '/clipfile'] },
  { key: 'ads', name: 'Viral Ads Studio', short: 'Ads Studio', path: '/ads/', home: 'ads', views: ['ads'], icon: 'ads', theme: '#823cdc', about: 'Make video ads with presenters, voices and captions.', apis: ['/api/ads', '/adfile', '/adlib'] },
];

function enabledApps(env = process.env) {
  const raw = String(env.APPS || '').trim().toLowerCase();
  if (!raw || raw === 'all') return APPS;
  const want = new Set(raw.split(/[\s,]+/));
  return APPS.filter((a) => a.key === 'scheduler' || want.has(a.key));
}

const byKey = (key) => APPS.find((a) => a.key === key);

// What the browser needs: names, addresses and pages of the apps that are on.
const publicInfo = (list) => list.map(({ key, name, short, path, home, views, icon }) => ({ key, name, short, path, home, views, icon }));

function manifest(a) {
  const icon = a.icon === 'icon' ? 'icon' : a.icon;
  return {
    name: a.name,
    short_name: a.short,
    id: a.path,
    start_url: `${a.path}#${a.home}`,
    scope: a.path,
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

module.exports = { APPS, enabledApps, byKey, publicInfo, manifest, touchIcon };
