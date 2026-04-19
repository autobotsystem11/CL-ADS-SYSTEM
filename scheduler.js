const cron = require('node-cron');

// Fire every day at 08:00 AM (Malaysia time = UTC+8, so 00:00 UTC)
// Cron format: second minute hour day month weekday
cron.schedule('0 0 * * *', async () => {
  console.log('⏰ Daily report scheduler fired:', new Date().toISOString());
  try {
    const { sendReport, sendClientReports } = require('./bot');
    await sendReport();         // admin report
    await sendClientReports();  // per-client Telegram reports
    console.log('✅ Daily reports sent via Telegram.');
  } catch (e) {
    console.error('❌ Scheduler error:', e.message);
  }
}, {
  timezone: 'Asia/Kuala_Lumpur'
});

console.log('⏰ Scheduler active — daily report at 08:00 MYT.');
