/**
 * Viral Post "website inbox" (free, runs in your own Google account).
 *
 * Your website's forms send each sign-up here. It is saved as a row in this Google Sheet,
 * which is always on, so nothing is lost while your Mac is off. Viral Post on your Mac
 * checks this inbox every 2 minutes and adds new people to Viral Touch CRM.
 *
 * Setup (one time):
 *   1. In the Sheet: Extensions > Apps Script. Delete what is there and paste this whole file.
 *   2. Click Save, choose the function "setup" at the top, click Run, and allow access.
 *      The log at the bottom shows your SECRET KEY. Copy it.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone.
 *      Click Deploy and copy the Web app URL (ends with /exec).
 *   4. On the Mac: npm run website   (paste the URL and the key)
 *
 * Anyone can ADD a sign-up (that is what a website form does), but only someone with the
 * secret key can READ the list, so your leads stay private.
 */
var SHEET = 'Inbox';
var HEADERS = ['Received', 'Form', 'Name', 'Email', 'Phone', 'Business', 'Interest', 'Preferred time',
  'Message', 'Newsletter', 'Page', 'All fields'];

function setup() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('KEY', key);
  }
  sheet_();
  Logger.log('YOUR SECRET KEY (copy it): ' + key);
  return key;
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); sh.setFrozenRows(1); }
  return sh;
}

// The leading ' keeps text as text: phone numbers keep their digits and nothing typed
// into a form can ever run as a spreadsheet formula. Sheets hides the ' and never returns it.
function cut_(v, n) { var s = String(v == null ? '' : v).trim().slice(0, n); return s ? "'" + s : ''; }

// A website form sends a sign-up.
function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.website_hp) return done_(p); // hidden box only spam robots fill in
  var row = [
    "'" + new Date().toISOString(), cut_(p.form, 120), cut_(p.name, 120), cut_(p.email, 200).toLowerCase(),
    cut_(p.phone, 40), cut_(p.company, 160), cut_(p.interest, 160), cut_(p.preferred_time, 160),
    cut_(p.message, 2000), p.newsletter === 'yes' ? 'yes' : 'no', cut_(p.page, 300), cut_(p.fields, 4000),
  ];
  if (!row[2] && !row[3] && !row[4]) return done_(p);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { sheet_().appendRow(row); } finally { lock.releaseLock(); }
  return done_(p);
}

function done_(p) {
  if (p.reply === 'json') return ContentService.createTextOutput('{"ok":true}').setMimeType(ContentService.MimeType.JSON);
  var back = /^https:\/\//.test(p.page || '') ? String(p.page) : '';
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<div style="font:18px system-ui;max-width:520px;margin:40px auto;padding:0 16px"><h2>Thank you!</h2>'
    + '<p>We got your message and will be in touch soon.</p>'
    + (back ? '<p><a href="' + back.replace(/[&<>"']/g, '') + '" target="_top">Back to the website</a></p>' : '') + '</div>');
}

// Viral Post reads new sign-ups (needs the secret key). ?key=...&after=<last row number>
function doGet(e) {
  var p = (e && e.parameter) || {};
  var key = PropertiesService.getScriptProperties().getProperty('KEY');
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  if (!key || p.key !== key) return out({ ok: false, error: 'wrong key' });
  var sh = sheet_();
  var after = Math.max(1, Number(p.after) || 1); // row 1 is the header
  var last = sh.getLastRow();
  var rows = [];
  if (last > after) {
    var n = Math.min(last - after, 200);
    var values = sh.getRange(after + 1, 1, n, HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      var t = function (x) { return String(x == null ? '' : x).replace(/^'/, ''); };
      rows.push({ row: after + 1 + i, received: t(v[0]), form: t(v[1]), name: t(v[2]), email: t(v[3]), phone: t(v[4]), company: t(v[5]),
        interest: t(v[6]), preferred_time: t(v[7]), message: t(v[8]), newsletter: t(v[9]) === 'yes', page: t(v[10]) });
    }
  }
  return out({ ok: true, rows: rows, last: last });
}
