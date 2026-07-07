const { exec, q, json, allowOptions, env, hashPassword } = require('./_lib/common');

module.exports = async function handler(req, res) {
  if (allowOptions(req, res)) return;
  try {
    const key = req.query.key || (req.body && req.body.key) || '';
    if (!env('POSTGRES_URL')) return json(res, { success: false, message: 'POSTGRES_URL não configurado. Crie/conecte o banco Postgres na Vercel.' }, 500);
    if (!env('INSTALL_KEY')) return json(res, { success: false, message: 'INSTALL_KEY não configurado nas variáveis da Vercel.' }, 500);
    if (key !== env('INSTALL_KEY')) return json(res, { success: false, message: 'Chave de instalação inválida.' }, 403);

    await exec(`CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL DEFAULT 'Admin',
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      email VARCHAR(190),
      name VARCHAR(120),
      password_hash VARCHAR(255) NOT NULL,
      password_plain VARCHAR(120),
      role VARCHAR(20) NOT NULL DEFAULT 'vip',
      plan VARCHAR(40) NOT NULL DEFAULT 'weekly',
      plan_name VARCHAR(80) NOT NULL DEFAULT 'Semanal',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      expires_at TIMESTAMPTZ NOT NULL,
      token VARCHAR(128) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      identifier VARCHAR(120) NOT NULL UNIQUE,
      plan VARCHAR(40) NOT NULL,
      access_plan VARCHAR(40) NOT NULL,
      plan_name VARCHAR(80) NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      pix_code TEXT,
      client_json JSONB,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      access_generated BOOLEAN NOT NULL DEFAULT FALSE,
      raw_response JSONB,
      raw_webhook JSONB,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )`);

    await exec(`CREATE TABLE IF NOT EXISTS media (
      id SERIAL PRIMARY KEY,
      type VARCHAR(20) NOT NULL DEFAULT 'image',
      title VARCHAR(255) NOT NULL,
      url TEXT,
      likes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await exec(`CREATE INDEX IF NOT EXISTS idx_users_token ON users(token)`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_users_expires ON users(expires_at)`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email))`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);

    const adminEmail = env('ADMIN_EMAIL', 'admin@seudominio.com');
    const adminPassword = env('ADMIN_PASSWORD', 'admin123');
    const adminName = env('ADMIN_NAME', 'Admin');
    const hash = await hashPassword(adminPassword);
    await exec(`INSERT INTO admins (email, name, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash`, [adminEmail, adminName, hash]);

    const mediaCount = await q('SELECT COUNT(*)::int AS total FROM media');
    if ((mediaCount[0] && mediaCount[0].total) === 0) {
      await exec(`INSERT INTO media (type, title, url, likes) VALUES
        ('image', 'Prévia VIP', '/pics/Perfil.png', 23),
        ('image', 'Banner VIP', '/pics/Banner.png', 11)`);
    }

    return json(res, { success: true, message: 'Banco instalado/atualizado com sucesso.', admin: adminEmail });
  } catch (e) {
    return json(res, { success: false, message: e.message }, 500);
  }
};
