const { planConfig, json, allowOptions } = require('./_lib/common');

function escapeHtml(s) {
  return String(s || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
}

module.exports = async function handler(req, res) {
  if (allowOptions(req, res)) return;
  const planKey = String(req.query.plan || 'weekly');
  const plan = planConfig(planKey);
  if (!plan) return json(res, { success: false, message: 'Plano inválido.' }, 404);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pagamento Pix - ${escapeHtml(plan.label)}</title>
  <link rel="stylesheet" href="/styles/auth-gallery.css">
  <style>
    *{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;background:transparent;color:#18181b;margin:0;padding:12px;display:flex;min-height:100vh;align-items:center;justify-content:center}.card{width:100%;max-width:410px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:28px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.16)}h1{font-size:23px;line-height:1.05;margin:0 0 8px;font-weight:950;letter-spacing:-.04em}.muted{color:#71717a;font-size:13px;line-height:1.45}.price{font-size:34px;font-weight:950;margin:16px 0;color:#f97316;letter-spacing:-.04em}label{font-size:13px;color:#3f3f46;font-weight:800;display:block;margin:13px 0 6px}input{width:100%;box-sizing:border-box;border-radius:15px;border:1px solid #e4e4e7;background:#fff;color:#111;padding:13px 14px;font-size:15px;outline:none}input:focus{border-color:#f97316;box-shadow:0 0 0 4px rgba(249,115,22,.12)}button,.btn{width:100%;border:0;border-radius:999px;background:#f97316;color:#fff;font-weight:900;padding:14px 15px;cursor:pointer;text-align:center;text-decoration:none;display:block;margin-top:14px;box-shadow:0 14px 32px rgba(249,115,22,.22)}.btn.secondary{background:#f4f4f5;color:#18181b;box-shadow:none}.pix{background:#fafafa;border:1px dashed #d4d4d8;border-radius:14px;padding:12px;word-break:break-all;font-family:monospace;color:#27272a;font-size:12px;max-height:110px;overflow:auto}.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:14px;padding:11px;margin:12px 0;font-size:13px;font-weight:700}.ok{background:#ecfdf5;color:#047857;border:1px solid #bbf7d0;border-radius:14px;padding:11px;margin:12px 0;font-size:13px;font-weight:700}.qrwrap{display:flex;justify-content:center;margin:14px 0 8px}.qrwrap img{width:210px;max-width:100%;background:#fff;border:1px solid #eee;border-radius:18px;padding:10px}.small{font-size:12px;color:#71717a;margin-top:12px;text-align:center}.hidden{display:none}.loader{opacity:.7;pointer-events:none}@media(max-width:420px){body{padding:8px}.card{padding:20px;border-radius:24px}.price{font-size:30px}.qrwrap img{width:190px}}
  </style>
</head>
<body>
  <main class="card">
    <h1>Pagamento Pix</h1>
    <p class="muted">Plano ${escapeHtml(plan.label)}. Após a confirmação do Pix, o acesso VIP será liberado automaticamente.</p>
    <div class="price">R$ ${Number(plan.amount).toFixed(2).replace('.', ',')}</div>
    <div id="error" class="error hidden"></div>
    <form id="form">
      <label>E-mail</label><input name="email" type="email" required autocomplete="email" placeholder="seuemail@exemplo.com">
      <button id="submit" type="submit">Gerar Pix</button>
    </form>
    <section id="pixArea" class="hidden">
      <div class="ok">Pix gerado. Escaneie o QR Code ou copie o código abaixo e pague no app do seu banco.</div>
      <div class="qrwrap"><img id="qrCode" alt="QR Code Pix" class="hidden"></div>
      <label>Código Pix copia e cola</label>
      <div class="pix" id="pixCode"></div>
      <button onclick="copyPix()">Copiar Pix</button>
      <div class="small" id="status">Aguardando confirmação do pagamento...</div>
      <a class="btn hidden" id="rescue" href="#">Resgatar acesso</a>
    </section>
  </main>
  <script src="/scripts/auth-gallery.js"></script>
  <script>
    const planKey = ${JSON.stringify(planKey)};
    const accessPlan = ${JSON.stringify(plan.access_plan)};
    const rescuePath = ${JSON.stringify(plan.rescue_path)};
    let identifier = '';
    let checkoutEmail = localStorage.getItem('vip_payment_email') || '';

    function showError(message){ const el = document.getElementById('error'); el.textContent = message; el.classList.remove('hidden'); }
    function hideError(){ document.getElementById('error').classList.add('hidden'); }
    function copyPix(){ navigator.clipboard.writeText(document.getElementById('pixCode').innerText); document.getElementById('status').innerText='Pix copiado. Após pagar, aguarde a confirmação.'; }

    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault(); hideError();
      const button = document.getElementById('submit'); button.textContent = 'Gerando Pix...'; button.disabled = true;
      const data = Object.fromEntries(new FormData(e.currentTarget).entries());
      checkoutEmail = String(data.email || '').trim().toLowerCase();
      localStorage.setItem('vip_payment_email', checkoutEmail);
      try {
        const response = await fetch('/index.php?action=create_pix', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: planKey, client: data })
        });
        const j = await response.json();
        if (!j.success) throw new Error(j.message || 'Erro ao gerar Pix.');
        identifier = j.identifier;
        localStorage.setItem('vip_payment_identifier', identifier);
        localStorage.setItem('vip_purchase_intent', accessPlan);
        document.getElementById('pixCode').textContent = j.pix_code;
        const qrImg = document.getElementById('qrCode');
        if (j.qr_code) {
          qrImg.src = j.qr_code;
        } else {
          qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent(j.pix_code);
        }
        qrImg.classList.remove('hidden');
        document.getElementById('form').classList.add('hidden');
        document.getElementById('pixArea').classList.remove('hidden');
        poll();
      } catch (err) {
        showError(err.message || 'Erro de conexão.');
        button.textContent = 'Gerar Pix'; button.disabled = false;
      }
    });

    async function poll(){
      try {
        const response = await fetch('/index.php?action=payment_status&identifier=' + encodeURIComponent(identifier));
        const j = await response.json();
        if (j.paid) {
          localStorage.setItem('vip_purchase_intent', accessPlan);
          localStorage.setItem('vip_payment_identifier', identifier);
          if (j.email) { checkoutEmail = j.email; localStorage.setItem('vip_payment_email', checkoutEmail); }
          document.getElementById('status').innerText='Pagamento confirmado! Crie sua senha para entrar automaticamente.';
          const openPassword = () => {
            if (window.VipAccessFlow && window.VipAccessFlow.startCreatePassword) {
              window.VipAccessFlow.startCreatePassword({ identifier, email: checkoutEmail, plan: accessPlan, redirect: '/vip-feed' });
            } else {
              try { window.top.location.href = '/vip?criar-senha=1&tx=' + encodeURIComponent(identifier); } catch(_) { window.location.href = '/vip?criar-senha=1&tx=' + encodeURIComponent(identifier); }
            }
          };
          const a = document.getElementById('rescue');
          a.href = '#';
          a.textContent = 'Criar senha e acessar';
          a.onclick = (event) => { event.preventDefault(); openPassword(); };
          a.classList.remove('hidden');
          setTimeout(openPassword, 500);
          return;
        }
      } catch (_) {}
      setTimeout(poll, 5000);
    }
  </script>
</body>
</html>`);
};
