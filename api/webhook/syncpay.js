const { q, exec, json, allowOptions } = require('../_lib/common');

const paidStatuses = ['completed', 'paid', 'approved', 'success', 'confirmed', 'succeeded'];

module.exports = async function handler(req, res) {
  if (allowOptions(req, res)) return;
  try {
    const event = req.headers.event || req.headers.Event || '';
    const payload = typeof req.body === 'object' && req.body ? req.body : {};
    const data = payload.data || payload;
    const identifier = String(data.id || data.identifier || payload.identifier || '');
    const status = String(data.status || payload.status || '').toLowerCase();
    if (!identifier) return json(res, { success: false, message: 'identifier/id ausente.' }, 422);

    const isPaid = paidStatuses.includes(status);
    const raw = { event, payload };
    const result = await exec(`UPDATE payments SET status=$1, raw_webhook=$2, paid_at=CASE WHEN $3 THEN COALESCE(paid_at, NOW()) ELSE paid_at END, updated_at=NOW() WHERE identifier=$4`,
      [status || 'updated', raw, isPaid, identifier]);

    if (result.rowCount === 0) {
      const amount = Number(data.amount || data.final_amount || 0);
      await exec(`INSERT INTO payments (identifier, plan, access_plan, plan_name, amount, status, raw_webhook, paid_at, updated_at)
        VALUES ($1,'unknown','weekly','Webhook',$2,$3,$4,CASE WHEN $5 THEN NOW() ELSE NULL END,NOW())
        ON CONFLICT (identifier) DO UPDATE SET status=EXCLUDED.status, raw_webhook=EXCLUDED.raw_webhook, paid_at=CASE WHEN $5 THEN COALESCE(payments.paid_at, NOW()) ELSE payments.paid_at END, updated_at=NOW()`,
        [identifier, amount, status || 'updated', raw, isPaid]);
    }

    return json(res, { success: true, message: 'Webhook processado.' });
  } catch (e) {
    return json(res, { success: false, message: e.message }, 500);
  }
};
