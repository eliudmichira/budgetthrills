const test = require('node:test');
const assert = require('node:assert/strict');
const src = require('fs').readFileSync(__dirname + '/../functions/index.js', 'utf8');
const slice = src.slice(src.indexOf('const EMAIL_PROVIDERS'), src.indexOf('/** Sends and records the outcome'));

function boot(env) {
  for (const k of Object.keys(process.env)) if (/API_KEY|EMAIL_/.test(k)) delete process.env[k];
  Object.assign(process.env, env);
  return new Function('process', slice + '; return { deliver, mailConfigProblems, templateFor, EMAIL_PROVIDER, MAIL_READY };')(process);
}

test('provider is picked from the key and payloads match each API', async () => {
  const calls = [];
  global.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 201, text: async () => '{}' }; };
  const brevo = boot({ BREVO_API_KEY: 'xkeysib-x', EMAIL_FROM: 'a@b.com' });
  assert.equal(brevo.EMAIL_PROVIDER, 'brevo'); assert.equal(brevo.MAIL_READY, true);
  await brevo.deliver({ to: 'c@d.com', subject: 's', html: '<b>x</b>', templateId: brevo.templateFor('order-confirmation'), params: { orderId: 'BT-1' } });
  assert.equal(calls[0].body.templateId, 1); assert.equal(calls[0].body.params.orderId, 'BT-1');
  const resend = boot({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.com' });
  await resend.deliver({ to: 'c@d.com', subject: 's', html: '<b>x</b>' });
  assert.equal(calls[1].url, 'https://api.resend.com/emails');
  const none = boot({});
  assert.equal(none.MAIL_READY, false);
  assert.ok(none.mailConfigProblems()[0].includes('BREVO_API_KEY'));
});
