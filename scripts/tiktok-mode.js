// Switch how Viral Post sends videos to TikTok.
//   npm run tiktok-direct   posts by itself with the choices made in New post
//                           (TikTok keeps posts private until its audit approves the app)
//   npm run tiktok-inbox    sends videos to your TikTok inbox, you tap Post (the default)
// Then run: npm run background:on
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const want = process.argv[2] === 'direct' ? 'direct' : 'draft';
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const line = `TIKTOK_MODE=${want}`;
text = /^TIKTOK_MODE=.*$/m.test(text) ? text.replace(/^TIKTOK_MODE=.*$/m, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
fs.writeFileSync(envPath, text);
console.log(want === 'direct'
  ? 'TikTok now posts by itself. New post shows the TikTok choices. Posts without choices still go to your inbox.'
  : 'TikTok now sends videos to your inbox. You tap Post in the TikTok app.');
console.log('Now run: npm run background:on');
