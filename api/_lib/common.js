const crypto = require('crypto');
const { sql } = require('@vercel/postgres');

function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Admin-Token, event');
  res.end(JSON.stringify(data));
}

function allowOptions(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return env('APP_BASE_URL') || `${proto}://${host}`;
}

function frontUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return env('FRONTEND_BASE_URL') || `${proto}://${host}`;
}

function planConfig(plan) {
  const plans = {
    weekly: {
      gateway_plan: 'weekly', access_plan: 'weekly', label: 'Semanal', days: 7,
      amount: Number(env('PLAN_WEEKLY_AMOUNT', '23.49')), rescue_path: 'resgate-semanal'
    },
    monthly: {
      gateway_plan: 'monthly', access_plan: 'monthly', label: 'Mensal', days: 30,
      amount: Number(env('PLAN_MONTHLY_AMOUNT', '31.90')), rescue_path: 'resgate-mensal'
    },
    biannual: {
      gateway_plan: 'biannual', access_plan: 'biannual', label: 'Semestral', days: 180,
      amount: Number(env('PLAN_BIANNUAL_AMOUNT', '60.49')), rescue_path: 'resgate-semestral'
    },
    weekly_promo: {
      gateway_plan: 'weekly_promo', access_plan: 'weekly', label: 'Semanal Promocional', days: 7,
      amount: Number(env('PLAN_WEEKLY_PROMO_AMOUNT', '11.75')), rescue_path: 'resgate-semanal'
    },
    test: {
      gateway_plan: 'test', access_plan: 'test', label: 'Assinatura de Teste', days: Number(env('TEST_PLAN_DAYS', '1')),
      amount: 0, rescue_path: 'vip-feed'
    }
  };
  return plans[plan] || null;
}

function normalizeMoney(v) {
  return Number(Number(v).toFixed(2));
}

function cleanDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomPassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => err ? reject(err) : resolve(derived.toString('hex')));
  });
  return `scrypt:${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const [, salt, expected] = stored.split(':');
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => err ? reject(err) : resolve(derived.toString('hex')));
  });
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
}

function dateBr(value) {
  const d = new Date(value);
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days));
  d.setHours(23, 59, 59, 0);
  return d;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}

async function q(text, params = []) {
  const result = await sql.query(text, params);
  return result.rows;
}

async function exec(text, params = []) {
  return sql.query(text, params);
}

module.exports = {
  sql, q, exec, json, allowOptions, env, baseUrl, frontUrl, planConfig,
  normalizeMoney, cleanDigits, randomToken, randomPassword, hashPassword,
  verifyPassword, dateBr, addDays, bearer
};
