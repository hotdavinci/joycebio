const { env } = require('./common');

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function clean(value) {
  return String(value || '').trim();
}

function base() {
  return clean(env('SYNCPAY_BASE_URL', 'https://api.syncpayments.com.br')).replace(/\/+$/, '');
}

async function request(method, path, body, headers = {}) {
  const response = await fetch(base() + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!response.ok) {
    const err = new Error(`Sync Pay HTTP ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function getCredentials() {
  const client_id = clean(env('SYNCPAY_CLIENT_ID'));
  const client_secret = clean(env('SYNCPAY_CLIENT_SECRET'));
  return { client_id, client_secret };
}

async function getAccessToken() {
  if (cachedToken && cachedTokenExpiresAt > Date.now()) return cachedToken;
  const { client_id, client_secret } = getCredentials();
  if (!client_id || !client_secret) throw new Error('Credenciais Sync Pay ausentes nas variáveis da Vercel.');
  const data = await request('POST', '/api/partner/v1/auth-token', { client_id, client_secret });
  if (!data.access_token) throw new Error('Sync Pay não retornou access_token.');
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

async function createCashIn(payload) {
  const token = await getAccessToken();
  return request('POST', '/api/partner/v1/cash-in', payload, { Authorization: `Bearer ${token}` });
}

async function getTransaction(identifier) {
  const token = await getAccessToken();
  return request('GET', `/api/partner/v1/transaction/${encodeURIComponent(identifier)}`, null, { Authorization: `Bearer ${token}` });
}

module.exports = { createCashIn, getTransaction, request, base, getCredentials };
