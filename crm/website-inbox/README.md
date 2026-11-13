# Connect your website's forms to Viral Touch CRM

Every time someone fills in a form on your website (for example viralattraction.com), they
show up in Viral Post > Contacts within about 2 minutes, in the group **Viral Attraction lead**,
and your iPhone buzzes. Free, no new accounts.

How it works: your website sends each sign-up to a Google Sheet in your own Google account
(always on, so nothing is lost while the Mac is off). Viral Post reads new rows from it.
Your Mac is never opened up to the internet.

Email rules: only the newsletter sign-up ("Stay in the loop") marks someone **OK to email**,
and it records when and where they signed up. Contact forms do not.

## Part 1: make the free inbox (about 5 minutes)

1. Go to **sheets.new** (signed in to your Google account). Name the sheet `Website sign-ups`.
2. Click **Extensions > Apps Script**.
3. Delete everything in the code box. Paste in all of `Code.gs` from this folder. Click the **Save** icon.
4. At the top, next to **Run**, pick `setup`. Click **Run**. Click **Review permissions**,
   pick your account, **Advanced > Go to ... (unsafe)** (it is your own script), **Allow**.
5. At the bottom, the log shows `YOUR SECRET KEY (copy it): ...`. Copy that key into Notes.
6. Click **Deploy > New deployment**. Click the gear, pick **Web app**.
   Execute as: **Me**. Who has access: **Anyone**. Click **Deploy**.
7. Copy the **Web app URL** (it ends with `/exec`) into Notes too.

## Part 2: tell Viral Post (on the Mac)

In Terminal:

    cd ~/social-scheduler && npm run website

Paste the Web app URL, then the key. When it says `WEBSITE SAVED`, run:

    npm run background:on

## Part 3: add the code to your website

Open Viral Post > **Contacts > Forms**. The card **Your website's forms** has
**Code for your website**. Click **Copy code** and paste it where your website builder lets you
add code to every page:

- **Wix**: Settings > Custom code > Add custom code > All pages, Body - end.
- **Squarespace**: Settings > Advanced > Code injection > Footer.
- **WordPress**: a plugin like "WPCode" > Add snippet > Site wide footer.
- **GoDaddy / others**: look for "custom code", "embed code" or "footer code".
- **Your own HTML site**: paste it just before `</body>` on each page.

Your forms keep working exactly as before. The code only copies each sign-up to the inbox.

## Check it

Fill in one of your own website forms with your email. Within 2 minutes you should get a phone
alert and see yourself in Contacts. Or click **Check now** on the card.
