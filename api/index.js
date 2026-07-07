const fs = require('fs');
const path = require('path');
const {
  q, exec, json, allowOptions, baseUrl, frontUrl, planConfig, normalizeMoney,
  randomToken, randomPassword, verifyPassword, hashPassword, dateBr,
  addDays, bearer, env
} = require('./_lib/common');
const SyncPay = require('./_lib/syncpay');
const QRCode = require('qrcode');

const paidStatuses = ['completed', 'paid', 'approved', 'success', 'confirmed', 'succeeded'];
const legacyMediaRoot = path.join(process.cwd(), 'api', '_midias-vip');
const rootImageFolder = path.join(process.cwd(), 'imagens');
const rootVideoFolder = path.join(process.cwd(), 'videos');
const apiImageFolder = path.join(process.cwd(), 'api', '_midias-vip', 'imagens');
const apiPhotoFolder = path.join(process.cwd(), 'api', '_midias-vip', 'fotos');
const apiVideoFolder = path.join(process.cwd(), 'api', '_midias-vip', 'videos');
const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg']);
const videoExts = new Set(['.mp4', '.webm', '.mov', '.m4v']);

module.exports = async function handler(req, res) {
  if (allowOptions(req, res)) return;
  try {
    const action = req.query.action || '';
    if (action === 'create_pix') return await createPix(req, res);
    if (action === 'payment_status') return await paymentStatus(req, res);
    if (action === 'create_password') return await createPassword(req, res);
    if (action === 'generate_instant_access') return await generateInstantAccess(req, res);
    if (action === 'login') return await login(req, res);
    if (action === 'check_status') return await checkStatus(req, res);
    if (action === 'media') return await media(req, res);
    if (action === 'media_file') return await mediaFile(req, res);
    if (action === 'users_list') return await usersList(req, res);
    if (action === 'upload') return await uploadMedia(req, res);
    if (action === 'delete') return await deleteMedia(req, res);
    if (action === 'like') return await likeMedia(req, res);
    return json(res, { success: false, message: 'Ação inválida.' }, 404);
  } catch (e) {
    return json(res, { success: false, message: e.message }, 500);
  }
};

function body(req) {
  return typeof req.body === 'object' && req.body ? req.body : {};
}

function isPaidStatus(status) {
  return paidStatuses.includes(String(status || '').toLowerCase());
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function createPix(req, res) {
  const input = body(req);
  const planKey = String(input.plan || '');
  if (planKey === 'test') return json(res, { success: false, message: 'Plano de teste desativado.' }, 422);

  const plan = planConfig(planKey);
  if (!plan) return json(res, { success: false, message: 'Plano inválido.' }, 422);

  const clientIn = input.client || {};
  const email = String(clientIn.email || '').trim().toLowerCase();
  if (!validEmail(email)) return json(res, { success: false, message: 'E-mail obrigatório para gerar Pix.' }, 422);
  const client = {
    name: String(clientIn.name || 'Cliente VIP').trim() || 'Cliente VIP',
    cpf: '12345678909',
    email,
    phone: '27999995555'
  };

  const payload = {
    amount: normalizeMoney(plan.amount),
    description: `Acesso VIP - ${plan.label}`,
    webhook_url: `${baseUrl(req).replace(/\/$/, '')}/webhook/syncpay.php`,
    client
  };
  if (Array.isArray(input.split)) payload.split = input.split;

  const response = await SyncPay.createCashIn(payload);
  const identifier = String(response.identifier || '');
  const pixCode = String(response.pix_code || '');
  if (!identifier || !pixCode) {
    return json(res, { success: false, message: 'Resposta Sync Pay sem identifier ou pix_code.', syncpay: response }, 502);
  }

  let qrCode = '';
  try {
    qrCode = await QRCode.toDataURL(pixCode, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280
    });
  } catch (_) {}

  await exec(`INSERT INTO payments (identifier, plan, access_plan, plan_name, amount, status, pix_code, client_json, raw_response, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (identifier) DO UPDATE SET pix_code=EXCLUDED.pix_code, raw_response=EXCLUDED.raw_response, client_json=EXCLUDED.client_json, updated_at=NOW()`,
    [identifier, planKey, plan.access_plan, plan.label, normalizeMoney(plan.amount), 'pending', pixCode, client, response]);

  return json(res, {
    success: true,
    message: response.message || 'Pix gerado com sucesso.',
    identifier,
    pix_code: pixCode,
    qr_code: qrCode,
    plan: planKey,
    access_plan: plan.access_plan,
    amount: normalizeMoney(plan.amount),
    status: 'pending',
    email
  });
}

async function getPayment(identifier) {
  const rows = await q('SELECT * FROM payments WHERE identifier = $1 LIMIT 1', [identifier]);
  return rows[0] || null;
}

async function refreshPaymentStatus(payment, identifier) {
  if (!payment) return null;
  if (isPaidStatus(payment.status)) return payment;
  try {
    const remote = await SyncPay.getTransaction(identifier);
    const remoteStatus = String(remote.status || '').toLowerCase();
    if (remoteStatus && remoteStatus !== payment.status) {
      const isPaid = isPaidStatus(remoteStatus);
      await exec(`UPDATE payments SET status=$1, raw_webhook=$2, paid_at=CASE WHEN $3 THEN COALESCE(paid_at, NOW()) ELSE paid_at END, updated_at=NOW() WHERE identifier=$4`,
        [remoteStatus, { transaction_lookup: remote }, isPaid, identifier]);
      payment.status = remoteStatus;
      if (isPaid) payment.paid_at = new Date();
    }
  } catch (_) {}
  return payment;
}

async function paymentStatus(req, res) {
  const input = body(req);
  const identifier = String(req.query.identifier || input.identifier || '');
  if (!identifier) return json(res, { success: false, message: 'identifier obrigatório.' }, 422);

  let payment = await getPayment(identifier);
  if (!payment) return json(res, { success: false, message: 'Pagamento não encontrado.' }, 404);
  payment = await refreshPaymentStatus(payment, identifier);

  const isPaid = isPaidStatus(payment.status);
  const plan = planConfig(payment.access_plan) || planConfig('weekly');
  const client = payment.client_json || {};
  return json(res, {
    success: true,
    identifier,
    status: payment.status,
    paid: isPaid,
    plan: payment.plan,
    access_plan: payment.access_plan,
    email: client.email || null,
    needs_password: isPaid && !payment.user_id,
    rescue_url: isPaid ? `${frontUrl(req).replace(/\/$/, '')}/${plan.rescue_path}?tx=${encodeURIComponent(identifier)}` : null
  });
}

async function createPassword(req, res) {
  const input = body(req);
  const identifier = String(input.identifier || input.tx || req.query.identifier || req.query.tx || '').trim();
  const emailInput = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const confirmation = String(input.password_confirmation || input.confirm_password || '');

  if (!identifier) return json(res, { success: false, message: 'Pagamento não informado.' }, 422);
  if (password.length < 6) return json(res, { success: false, message: 'A senha precisa ter pelo menos 6 caracteres.' }, 422);
  if (password !== confirmation) return json(res, { success: false, message: 'A confirmação da senha não confere.' }, 422);

  let payment = await getPayment(identifier);
  if (!payment) return json(res, { success: false, message: 'Pagamento não encontrado.' }, 404);
  payment = await refreshPaymentStatus(payment, identifier);
  if (!isPaidStatus(payment.status)) return json(res, { success: false, message: 'Pagamento ainda não confirmado.' }, 402);

  const client = payment.client_json || {};
  const email = emailInput || String(client.email || '').trim().toLowerCase();
  if (!validEmail(email)) return json(res, { success: false, message: 'E-mail inválido ou ausente.' }, 422);

  const plan = planConfig(payment.access_plan) || planConfig('weekly');
  const passwordHash = await hashPassword(password);
  const token = randomToken(32);
  let user = null;

  if (payment.user_id) {
    const existingByPayment = await q('SELECT * FROM users WHERE id=$1 LIMIT 1', [payment.user_id]);
    user = existingByPayment[0] || null;
  }
  if (!user) {
    const existingByEmail = await q('SELECT * FROM users WHERE LOWER(email)=LOWER($1) ORDER BY id DESC LIMIT 1', [email]);
    user = existingByEmail[0] || null;
  }

  let saved;
  if (user) {
    const updated = await q(`UPDATE users SET email=$1, password_hash=$2, password_plain=NULL, role='vip', plan=$3, plan_name=$4,
      status='active', expires_at=$5, token=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
      [email, passwordHash, payment.access_plan, plan.label, addDays(plan.days), token, user.id]);
    saved = updated[0];
  } else {
    let username;
    while (true) {
      username = 'vip' + Math.floor(10000 + Math.random() * 90000);
      const exists = await q('SELECT id FROM users WHERE username=$1 LIMIT 1', [username]);
      if (!exists[0]) break;
    }
    const inserted = await q(`INSERT INTO users (username, email, password_hash, password_plain, role, plan, plan_name, status, expires_at, token, updated_at)
      VALUES ($1,$2,$3,NULL,'vip',$4,$5,'active',$6,$7,NOW()) RETURNING *`,
      [username, email, passwordHash, payment.access_plan, plan.label, addDays(plan.days), token]);
    saved = inserted[0];
  }

  await exec('UPDATE payments SET user_id=$1, access_generated=TRUE, updated_at=NOW() WHERE id=$2', [saved.id, payment.id]);
  return json(res, {
    success: true,
    token,
    role: 'vip',
    email: saved.email,
    user_name: saved.email || saved.username,
    plan_name: saved.plan_name,
    expires: dateBr(saved.expires_at),
    redirect: '/vip-feed'
  });
}

async function generateInstantAccess(req, res) {
  const input = body(req);
  const planKey = String(input.plan || '');
  const identifier = String(input.identifier || input.tx || req.query.identifier || req.query.tx || '');
  if (!identifier) return json(res, { success: false, message: 'Pagamento não informado.' }, 422);

  let payment = await getPayment(identifier);
  if (!payment) return json(res, { success: false, message: 'Pagamento não encontrado.' }, 404);
  if (planKey && payment.access_plan !== planKey) return json(res, { success: false, message: 'Plano do pagamento não corresponde ao resgate.' }, 403);

  payment = await refreshPaymentStatus(payment, identifier);
  if (!isPaidStatus(payment.status)) return json(res, { success: false, message: 'Pagamento ainda não confirmado.' }, 402);

  if (payment.user_id) {
    const users = await q('SELECT * FROM users WHERE id = $1 LIMIT 1', [payment.user_id]);
    if (users[0]) return json(res, { success: true, credentials: credentialsPayload(users[0]), needs_password: false });
  }

  const plan = planConfig(payment.access_plan);
  if (!plan) return json(res, { success: false, message: 'Plano interno inválido.' }, 500);

  let username;
  while (true) {
    username = 'vip' + Math.floor(10000 + Math.random() * 90000);
    const exists = await q('SELECT id FROM users WHERE username=$1 LIMIT 1', [username]);
    if (!exists[0]) break;
  }
  const password = randomPassword(8);
  const passwordHash = await hashPassword(password);
  const client = payment.client_json || {};
  const inserted = await q(`INSERT INTO users (username, email, password_hash, password_plain, role, plan, plan_name, status, expires_at, updated_at)
    VALUES ($1,$2,$3,$4,'vip',$5,$6,'active',$7,NOW()) RETURNING *`,
    [username, client.email || null, passwordHash, password, payment.access_plan, plan.label, addDays(plan.days)]);
  const user = inserted[0];
  await exec('UPDATE payments SET user_id=$1, access_generated=TRUE, updated_at=NOW() WHERE id=$2', [user.id, payment.id]);
  return json(res, { success: true, credentials: credentialsPayload(user), needs_password: false });
}

function credentialsPayload(user) {
  return {
    user: user.email || user.username,
    password: user.password_plain || 'senha_indisponivel',
    expires: dateBr(user.expires_at),
    plan_name: user.plan_name
  };
}

async function login(req, res) {
  const input = body(req);
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!email || !password) return json(res, { success: false, message: 'Informe usuário/e-mail e senha.' }, 422);

  const admins = await q('SELECT id, email, name, password_hash FROM admins WHERE LOWER(email)=LOWER($1) LIMIT 1', [email]);
  const admin = admins[0];
  if (admin && await verifyPassword(password, admin.password_hash)) {
    return json(res, { success: true, token: randomToken(32), role: 'admin', user_name: admin.name });
  }

  const users = await q('SELECT * FROM users WHERE username=$1 OR LOWER(email)=LOWER($1) ORDER BY id DESC LIMIT 1', [email]);
  const user = users[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) return json(res, { success: false, message: 'Dados de acesso incorretos.' }, 401);
  if (user.status !== 'active' || new Date(user.expires_at) < new Date()) return json(res, { success: false, message: 'Acesso expirado.' }, 403);

  const token = randomToken(32);
  await exec('UPDATE users SET token=$1, updated_at=NOW() WHERE id=$2', [token, user.id]);
  return json(res, { success: true, token, role: 'vip', user_name: user.email || user.username, email: user.email, plan_name: user.plan_name, redirect: '/vip-feed' });
}

async function userByToken(token) {
  if (!token) return null;
  const rows = await q('SELECT * FROM users WHERE token=$1 LIMIT 1', [token]);
  return rows[0] || null;
}

async function requireVip(req, res) {
  const token = String(bearer(req) || (req.query && req.query.token) || '');
  const user = await userByToken(token);
  if (!user || user.status !== 'active' || new Date(user.expires_at) < new Date()) {
    json(res, { success: false, message: 'Faça login novamente para acessar a galeria.' }, 403);
    return null;
  }
  return user;
}


function mediaContentType(ext) {
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4'
  };
  return map[ext] || 'application/octet-stream';
}

async function mediaFile(req, res) {
  const user = await requireVip(req, res);
  if (!user) return;

  const folder = String((req.query && req.query.folder) || '').trim().toLowerCase();
  const rel = String((req.query && req.query.file) || '').replace(/\\/g, '/');
  if (!rel || rel.includes('\0')) return json(res, { success: false, message: 'Arquivo inválido.' }, 422);

  const resolved = resolveMediaPath(folder, rel);
  if (!resolved) return json(res, { success: false, message: 'Arquivo não encontrado.' }, 404);

  const full = resolved.full;
  const ext = path.extname(full).toLowerCase();
  const isImage = imageExts.has(ext);
  const isVideo = videoExts.has(ext);
  if (!isImage && !isVideo) return json(res, { success: false, message: 'Tipo de arquivo não permitido.' }, 403);

  const stat = fs.statSync(full);
  const contentType = mediaContentType(ext);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const range = req.headers.range;
  if (isVideo && range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start >= stat.size || end >= stat.size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    return fs.createReadStream(full, { start, end }).pipe(res);
  }

  res.statusCode = 200;
  res.setHeader('Content-Length', stat.size);
  if (isVideo) res.setHeader('Accept-Ranges', 'bytes');
  return fs.createReadStream(full).pipe(res);
}

async function checkStatus(req, res) {
  const input = body(req);
  const token = String(input.token || bearer(req) || '');
  const user = await userByToken(token);
  if (!user) return json(res, { success: false, status: 'expired', days_left: 0 }, 403);
  const expires = new Date(user.expires_at);
  const daysLeft = Math.max(0, Math.ceil((expires - new Date()) / 86400000));
  const status = (user.status === 'active' && expires >= new Date()) ? 'active' : 'expired';
  return json(res, { success: true, status, days_left: daysLeft, plan_name: user.plan_name, email: user.email || user.username });
}

function safeResolve(base, rel) {
  const normalizedRel = String(rel || '').replace(/\\/g, '/');
  if (!normalizedRel || normalizedRel.includes('\0')) return null;
  const full = path.resolve(base, normalizedRel);
  const root = path.resolve(base);
  if (full !== root && full.startsWith(root + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  return null;
}

function mediaRootsByFolder(folder) {
  if (folder === 'videos' || folder === 'video') {
    return [
      { folder: 'videos', base: rootVideoFolder, source: 'videos', allowed: videoExts },
      { folder: 'videos', base: apiVideoFolder, source: 'api/_midias-vip/videos', allowed: videoExts }
    ];
  }
  if (folder === 'imagens' || folder === 'fotos' || folder === 'image') {
    return [
      { folder: 'imagens', base: rootImageFolder, source: 'imagens', allowed: imageExts },
      { folder: 'imagens', base: apiImageFolder, source: 'api/_midias-vip/imagens', allowed: imageExts },
      { folder: 'imagens', base: apiPhotoFolder, source: 'api/_midias-vip/fotos', allowed: imageExts }
    ];
  }
  return [
    { folder: 'imagens', base: rootImageFolder, source: 'imagens', allowed: imageExts },
    { folder: 'videos', base: rootVideoFolder, source: 'videos', allowed: videoExts },
    { folder: 'imagens', base: apiImageFolder, source: 'api/_midias-vip/imagens', allowed: imageExts },
    { folder: 'imagens', base: apiPhotoFolder, source: 'api/_midias-vip/fotos', allowed: imageExts },
    { folder: 'videos', base: apiVideoFolder, source: 'api/_midias-vip/videos', allowed: videoExts }
  ];
}

function resolveMediaPath(folder, rel) {
  for (const root of mediaRootsByFolder(folder)) {
    const full = safeResolve(root.base, rel);
    if (!full) continue;
    const ext = path.extname(full).toLowerCase();
    if (!root.allowed.has(ext)) continue;
    return { ...root, full };
  }

  // Compatibilidade com a versão anterior, que usava api/_midias-vip/fotos e api/_midias-vip/videos no parâmetro file.
  const legacyFull = safeResolve(legacyMediaRoot, rel);
  if (legacyFull) {
    const ext = path.extname(legacyFull).toLowerCase();
    if (imageExts.has(ext) || videoExts.has(ext)) return { folder: 'legacy', base: legacyMediaRoot, source: 'api/_midias-vip', full: legacyFull };
  }
  return null;
}

function proxyUrlForMedia(folder, rel, token) {
  return `/index.php?action=media_file&folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(rel)}&token=${encodeURIComponent(token || '')}`;
}

function titleFromFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return path.basename(fileName, ext).replace(/[-_]+/g, ' ').trim() || fileName;
}

function scanOneRoot(root, token, out, seen) {
  if (!fs.existsSync(root.base)) return;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!root.allowed.has(ext)) continue;
      const type = imageExts.has(ext) ? 'image' : videoExts.has(ext) ? 'video' : null;
      if (!type) continue;
      const rel = path.relative(root.base, full).replace(/\\/g, '/');
      const key = `${root.folder}:${rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const stat = fs.statSync(full);
      out.push({
        id: `file:${key}`,
        type,
        title: titleFromFile(entry.name),
        url: proxyUrlForMedia(root.folder, rel, token),
        created_at: stat.mtime.toISOString(),
        source: root.source
      });
    }
  }
  walk(root.base);
}

function scanFolderMedia(token) {
  const out = [];
  const seen = new Set();
  for (const root of mediaRootsByFolder('')) scanOneRoot(root, token, out, seen);
  return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function media(req, res) {
  const user = await requireVip(req, res);
  if (!user) return;

  const folderItems = scanFolderMedia(String(bearer(req) || (req.query && req.query.token) || ''));
  let dbItems = [];
  try {
    dbItems = await q("SELECT id, type, title, url, likes, created_at FROM media WHERE type IN ('image','video') AND url IS NOT NULL AND url <> '' ORDER BY id DESC");
    dbItems = dbItems.map(item => ({ ...item, source: 'database' }));
  } catch (_) {}
  return json(res, { success: true, media: [...folderItems, ...dbItems] });
}

async function usersList(req, res) {
  const rows = await q(`SELECT id, username AS user, email, plan_name, status,
    TO_CHAR(expires_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS expires, created_at
    FROM users ORDER BY id DESC`);
  return json(res, rows);
}

async function uploadMedia(req, res) {
  const input = body(req);
  const title = String(input.title || 'Mídia').trim();
  const type = ['image', 'video', 'text'].includes(input.type) ? input.type : 'image';
  const url = String(input.url || '').trim();
  const rows = await q('INSERT INTO media (type, title, url) VALUES ($1,$2,$3) RETURNING id', [type, title, url || null]);
  return json(res, { success: true, id: rows[0].id, url: url || null, note: 'Na Vercel, upload direto de arquivo não é persistente. Coloque imagens na pasta imagens/ e vídeos na pasta videos/. Depois faça novo deploy.' });
}

async function deleteMedia(req, res) {
  const input = body(req);
  const id = Number(input.id || 0);
  if (!id) return json(res, { success: false, message: 'ID inválido.' }, 422);
  await exec('DELETE FROM media WHERE id=$1', [id]);
  return json(res, { success: true });
}

async function likeMedia(req, res) {
  const input = body(req);
  const id = Number(input.id || 0);
  if (!id) return json(res, { success: false, message: 'ID inválido.' }, 422);
  await exec('UPDATE media SET likes = likes + 1 WHERE id=$1', [id]);
  return json(res, { success: true });
}
