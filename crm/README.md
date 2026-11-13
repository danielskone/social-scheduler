# Viral Touch CRM

Everything that belongs only to Viral Touch CRM lives in this folder:

- `server/`: the CRM's server code (contacts, pipeline, tasks, forms, bookings, email, automations, website sign-ups, Google Calendar).
- `public/`: the CRM's page files (crm.js, forms.js, workflows.js and their styles). They load at the same addresses as before (/crm.js and so on).
- `scripts/`: CRM setup commands: `npm run email-setup`, `npm run calendar`, `npm run website`.
- `website-inbox/`: the Google Sheet inbox that brings website form sign-ups into the CRM.
- `test/`: the CRM's tests (run with the rest by `npm test`).

The CRM still shares a few things with Viral Post on purpose, so nothing has to be set up twice:
the same data folder (your contacts stay where they are), the same .env settings file,
the same background setup (`npm run background:on`) and the same update command (`npm run update`).
It still runs as its own program on port 3001.
