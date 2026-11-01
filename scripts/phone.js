// Sets up iPhone notifications: `npm run phone`
// Prints the name to type into the free ntfy app and sends a test message.
const notify = require('../src/notify');

(async () => {
  const t = notify.createTopic();
  console.log('\nPHONE NOTIFICATIONS ARE ON.\n');
  console.log('On your iPhone: open the ntfy app, tap +, and type this exactly:\n');
  console.log(`    ${t}\n`);
  console.log('Then tap Subscribe. A test message is being sent now...');
  const ok = await notify.send('Scheduler connected', 'You will get a message here each time a post goes out or fails.', { tags: 'tada' });
  console.log(ok ? 'Test message sent. (If you subscribe after this, run `npm run phone` again to resend it.)' : 'Could not send the test message. Check the internet connection.');
})();
