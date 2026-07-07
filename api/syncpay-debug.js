const { json, allowOptions, env } = require('./_lib/common');
const { request, base, getCredentials } = require('./_lib/syncpay');

function clean(v) { return String(v || '').trim(); }
function mask(v) {
  v = clean(v);
  if (!v) return null;
  if (v.length <= 10) return `${v.slice(0, 2)}***${v.slice(-2)} (${v.length})`;
  return `${v.slice(0, 6)}***${v.slice(-6)} (${v.length})`;
}

module.exports = async function handler(req, res) {
  if (allowOptions(req, res)) return;
  const key = clean(req.query.key || req.headers['x-debug-key']);
  const expected = clean(env('INSTALL_KEY'));
  if (!expected || key !== expected) {
    return json(res, { success: false, message: 'Chave de debug inválida. Use ?key=SUA_INSTALL_KEY' }, 403);
  }

  const { client_id, client_secret } = getCredentials();
  const report = {
    success: false,
    base_url: base(),
    auth_url: base() + '/api/partner/v1/auth-token',
    env_loaded: {
      SYNCPAY_BASE_URL: mask(env('SYNCPAY_BASE_URL')),
      SYNCPAY_CLIENT_ID: mask(env('SYNCPAY_CLIENT_ID')),
      SYNCPAY_CLIENT_SECRET: mask(env('SYNCPAY_CLIENT_SECRET')),
      INSTALL_KEY: mask(env('INSTALL_KEY')),
      POSTGRES_URL: env('POSTGRES_URL') ? 'presente' : 'ausente'
    },
    credentials_used: {
      client_id: mask(client_id),
      client_secret: mask(client_secret)
    }
  };

  try {
    const data = await request('POST', '/api/partner/v1/auth-token', { client_id, client_secret });
    report.success = true;
    report.auth_status = 200;
    report.auth_response = {
      token_type: data.token_type || null,
      expires_in: data.expires_in || null,
      expires_at: data.expires_at || null,
      access_token: data.access_token ? mask(data.access_token) : null
    };
    return json(res, report);
  } catch (err) {
    report.success = false;
    report.auth_status = err.status || null;
    report.auth_error = err.data || String(err.message || err);
    return json(res, report, 200);
  }
};
