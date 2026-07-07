(function(){
  const API = '/index.php?action=';
  const TOKEN_KEY = 'vip_token';
  const EMAIL_KEY = 'vip_email';
  const USER_KEY = 'vip_user';

  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c];
    });
  }

  function token(){ return localStorage.getItem(TOKEN_KEY) || ''; }
  function clearSession(){
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function saveSession(data){
    if(data && data.token) localStorage.setItem(TOKEN_KEY, data.token);
    if(data && data.email) localStorage.setItem(EMAIL_KEY, data.email);
    if(data && data.user_name) localStorage.setItem(USER_KEY, data.user_name);
  }
  function go(url){
    try{
      if(window.top && window.top !== window){ window.top.location.href = url; return; }
    }catch(_){ }
    window.location.href = url;
  }

  async function api(action, method, payload, authToken){
    const options = { method: method || 'GET', headers: {} };
    if(payload){
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    if(authToken) options.headers.Authorization = 'Bearer ' + authToken;
    const response = await fetch(API + encodeURIComponent(action), options);
    let json;
    try { json = await response.json(); } catch (_) { json = {}; }
    if(!response.ok || json.success === false){
      throw new Error(json.message || 'Erro na solicitação.');
    }
    return json;
  }

  function ensureRoot(){
    let root = document.getElementById('root');
    if(!root){ root = document.createElement('div'); root.id = 'root'; document.body.prepend(root); }
    return root;
  }

  function setMessage(id, message, error){
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = message || '';
    el.classList.toggle('active', !!message);
    el.classList.toggle('vip-error', !!error);
    el.classList.toggle('vip-success', !error);
  }

  function unlockScroll(){
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
  function lockScroll(){
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  function ensurePasswordModal(){
    let overlay = document.getElementById('vipPasswordOverlay');
    if(overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'vipPasswordOverlay';
    overlay.className = 'vip-password-overlay';
    overlay.innerHTML = '<div class="vip-password-modal" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(event){ if(event.target === overlay) closePasswordModal(); });
    document.addEventListener('keydown', function(event){ if(event.key === 'Escape') closePasswordModal(); });
    return overlay;
  }
  function closePasswordModal(){
    const overlay = document.getElementById('vipPasswordOverlay');
    if(overlay) overlay.classList.remove('active');
    unlockScroll();
  }

  function startCreatePassword(options){
    options = options || {};
    const isTest = false;
    const overlay = ensurePasswordModal();
    const box = overlay.querySelector('.vip-password-modal');
    const emailValue = esc(options.email || localStorage.getItem('vip_payment_email') || localStorage.getItem(EMAIL_KEY) || '');
    box.innerHTML = `
      <button class="vip-password-close" type="button" aria-label="Fechar">&times;</button>
      <div class="vip-modal-icon">🔐</div>
      <h2 class="vip-modal-title">Pagamento confirmado</h2>
      <p class="vip-modal-text">Crie sua senha para acessar a área VIP. Depois disso o login será feito automaticamente.</p>
      <form class="vip-form" id="vipPasswordForm">
        <div class="vip-error" id="vipPasswordError"></div>
        <label class="vip-label" for="vipPasswordEmail">E-mail</label>
        <input class="vip-input" id="vipPasswordEmail" name="email" type="email" required autocomplete="email" placeholder="seuemail@exemplo.com" value="${emailValue}">
        <label class="vip-label" for="vipPassword">Criar senha</label>
        <input class="vip-input" id="vipPassword" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="Mínimo 6 caracteres">
        <label class="vip-label" for="vipConfirmPassword">Confirmar senha</label>
        <input class="vip-input" id="vipConfirmPassword" name="password_confirmation" type="password" required minlength="6" autocomplete="new-password" placeholder="Repita a senha">
        <div class="vip-modal-note">O cliente vai usar esse e-mail e essa senha para entrar depois.</div>
        <div class="vip-modal-actions">
          <button class="vip-button" id="vipPasswordSubmit" type="submit">Criar senha e acessar</button>
          <button class="vip-small-link" type="button" id="vipGoLogin">Já tenho senha</button>
        </div>
      </form>`;
    overlay.classList.add('active');
    lockScroll();
    const closeBtn = box.querySelector('.vip-password-close');
    if(closeBtn) closeBtn.addEventListener('click', closePasswordModal);
    const goLogin = box.querySelector('#vipGoLogin');
    if(goLogin) goLogin.addEventListener('click', function(){ closePasswordModal(); startLoginModal({ redirect: options.redirect || '/vip-feed' }); });
    const emailInput = box.querySelector('#vipPasswordEmail');
    if(emailInput && !emailInput.value) setTimeout(function(){ emailInput.focus(); }, 60);
    box.querySelector('#vipPasswordForm').addEventListener('submit', async function(event){
      event.preventDefault();
      setMessage('vipPasswordError', '', false);
      const button = box.querySelector('#vipPasswordSubmit');
      button.disabled = true;
      button.textContent = 'Liberando acesso...';
      const form = Object.fromEntries(new FormData(event.currentTarget).entries());
      try {
        let identifier = options.identifier || localStorage.getItem('vip_payment_identifier') || '';
        const result = await api('create_password', 'POST', {
          identifier: identifier,
          email: form.email,
          password: form.password,
          password_confirmation: form.password_confirmation
        });
        saveSession(result);
        closePasswordModal();
        go(options.redirect || result.redirect || '/vip-feed');
      } catch (error) {
        setMessage('vipPasswordError', error.message || 'Não foi possível criar a senha.', true);
        button.disabled = false;
        button.textContent = 'Criar senha e acessar';
      }
    });
  }

  function ensureLoginModal(){
    let overlay = document.getElementById('vipLoginOverlay');
    if(overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'vipLoginOverlay';
    overlay.className = 'vip-password-overlay';
    overlay.innerHTML = '<div class="vip-password-modal" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(event){ if(event.target === overlay) closeLoginModal(); });
    document.addEventListener('keydown', function(event){ if(event.key === 'Escape') closeLoginModal(); });
    return overlay;
  }
  function closeLoginModal(){
    const overlay = document.getElementById('vipLoginOverlay');
    if(overlay) overlay.classList.remove('active');
    unlockScroll();
  }

  function startLoginModal(options){
    options = options || {};
    const overlay = ensureLoginModal();
    const box = overlay.querySelector('.vip-password-modal');
    box.innerHTML = `
      <button class="vip-password-close" type="button" aria-label="Fechar">&times;</button>
      <div class="vip-modal-icon">👑</div>
      <h2 class="vip-modal-title">Entrar na área liberada</h2>
      <p class="vip-modal-text">Use o mesmo e-mail do pagamento e a senha criada após a confirmação do Pix.</p>
      <form class="vip-form" id="vipLoginFormModal">
        <div class="vip-error" id="vipLoginModalError"></div>
        <label class="vip-label" for="vipLoginModalEmail">E-mail</label>
        <input class="vip-input" id="vipLoginModalEmail" name="email" type="email" required autocomplete="email" placeholder="seuemail@exemplo.com" value="${esc(localStorage.getItem('vip_payment_email') || localStorage.getItem(EMAIL_KEY) || '')}">
        <label class="vip-label" for="vipLoginModalPassword">Senha</label>
        <input class="vip-input" id="vipLoginModalPassword" name="password" type="password" required autocomplete="current-password" placeholder="Sua senha">
        <button class="vip-button" id="vipLoginModalSubmit" type="submit">Entrar agora</button>
        <button class="vip-small-link" type="button" id="vipLoginModalBack">Ver ofertas VIP</button>
      </form>`;
    overlay.classList.add('active');
    lockScroll();
    const closeBtn = box.querySelector('.vip-password-close');
    if(closeBtn) closeBtn.addEventListener('click', closeLoginModal);
    const back = box.querySelector('#vipLoginModalBack');
    if(back) back.addEventListener('click', function(){ closeLoginModal(); if(location.pathname.replace(/\/+$/, '') === '/login') go('/vip'); });
    const emailInput = box.querySelector('#vipLoginModalEmail');
    if(emailInput) setTimeout(function(){ emailInput.focus(); }, 60);
    box.querySelector('#vipLoginFormModal').addEventListener('submit', async function(event){
      event.preventDefault();
      setMessage('vipLoginModalError', '', false);
      const button = box.querySelector('#vipLoginModalSubmit');
      button.disabled = true;
      button.textContent = 'Entrando...';
      const form = Object.fromEntries(new FormData(event.currentTarget).entries());
      try {
        const result = await api('login', 'POST', form);
        saveSession(result);
        closeLoginModal();
        go(options.redirect || result.redirect || '/vip-feed');
      } catch (error) {
        setMessage('vipLoginModalError', error.message || 'Erro ao entrar.', true);
        button.disabled = false;
        button.textContent = 'Entrar agora';
      }
    });
  }

  function renderLogin(){
    const params = new URLSearchParams(window.location.search);
    const qs = window.location.search || '?login=1';
    if(params.get('criar-senha') === '1' || params.has('tx')) { go('/vip' + qs); return; }
    go('/vip?login=1');
  }

  function renderTestAccess(){
    go('/vip');
  }

  function mediaTypeLabel(item){ return item.type === 'video' ? 'Vídeo' : 'Foto'; }
  function iconSvg(type){
    if(type === 'video') return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"></path><rect x="2" y="6" width="14" height="12" rx="2"></rect></svg>';
    if(type === 'image') return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect><path d="M14 4h7"></path><path d="M14 9h7"></path><path d="M14 15h7"></path><path d="M14 20h7"></path></svg>';
  }

  function renderGallery(){
    const root = ensureRoot();
    document.body.classList.add('member-feed-body');
    if(!token()){
      go('/vip?login=1');
      return;
    }
    const userLabel = esc(localStorage.getItem(USER_KEY) || 'Membro');
    root.innerHTML = `
      <header class="member-app-header">
        <a href="/" class="member-logo">Joyce <span>Privs</span></a>
        <div class="member-header-actions">
          <a href="/vip" class="member-head-link">Ofertas</a>
          <button id="vipLogout" class="member-head-button" type="button">Sair</button>
        </div>
      </header>
      <main class="member-main">
        <div class="member-hero">
          <div>
            <h2 class="member-greeting">Olá, ${userLabel}</h2>
            <div class="member-status-row">
              <div class="member-chip member-chip-green">${iconSvg('clock')}<span class="font-bold">Ativo</span></div>
              <div class="member-chip member-chip-orange">👑 <span class="font-bold truncate" id="vipGalleryPlan">Carregando plano...</span></div>
              <div class="member-chip member-chip-muted">📅 <span id="vipGalleryStatus">Carregando vencimento...</span></div>
            </div>
          </div>
        </div>
        <div class="member-tabs" role="group" aria-label="Filtrar conteúdos">
          <button class="member-tab active" data-filter="all" type="button">${iconSvg('all')}<span>Tudo</span></button>
          <button class="member-tab" data-filter="image" type="button">${iconSvg('image')}<span>Fotos</span></button>
          <button class="member-tab" data-filter="video" type="button">${iconSvg('video')}<span>Vídeos</span></button>
          <button class="member-tab" data-filter="post" type="button">☰<span>Posts</span></button>
        </div>
        <section id="vipGalleryGrid" class="member-grid"><div class="member-empty">Carregando conteúdos...</div></section>
      </main>`;
    const logout = document.getElementById('vipLogout');
    if(logout) logout.addEventListener('click', function(){ clearSession(); go('/vip'); });
    let allMedia = [];
    let currentFilter = 'all';
    const statusEl = document.getElementById('vipGalleryStatus');
    const planEl = document.getElementById('vipGalleryPlan');
    const grid = document.getElementById('vipGalleryGrid');
    function renderItems(){
      const items = allMedia.filter(function(item){
        if(currentFilter === 'all') return true;
        if(currentFilter === 'post') return item.type === 'text' || item.type === 'post';
        return item.type === currentFilter;
      });
      if(!items.length){
        grid.className = 'member-grid';
        grid.innerHTML = `<div class="member-empty">Nenhum conteúdo disponível nesta aba.</div>`;
        return;
      }
      grid.className = 'member-grid';
      grid.innerHTML = items.map(function(item){
        const isVideo = item.type === 'video';
        const media = isVideo ? `<video src="${esc(item.url)}" controls preload="metadata" playsinline controlsList="nodownload"></video>` : `<img src="${esc(item.url)}" alt="${esc(item.title)}" loading="lazy" draggable="false">`;
        return `<article class="member-media-card">
          <div class="member-media-frame">${media}</div>
          <div class="member-media-info">
            <div>
              <div class="member-media-title">${esc(item.title)}</div>
              <div class="member-media-sub">Conteúdo liberado</div>
            </div>
            <span class="member-media-badge">${mediaTypeLabel(item)}</span>
          </div>
        </article>`;
      }).join('');
    }
    document.querySelectorAll('.member-tab').forEach(function(btn){
      btn.addEventListener('click', function(){
        document.querySelectorAll('.member-tab').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        renderItems();
      });
    });
    (async function(){
      try{
        const status = await api('check_status', 'POST', { token: token() }, token());
        if(status.status !== 'active') throw new Error('Acesso expirado. Faça login novamente.');
        if(planEl) planEl.textContent = status.plan_name || 'Plano ativo';
        if(statusEl) statusEl.innerHTML = `Vence em <b>${Number(status.days_left || 0)} dias</b>`;
        const data = await api('media', 'GET', null, token());
        allMedia = Array.isArray(data) ? data : (data.media || []);
        renderItems();
      }catch(error){
        clearSession();
        root.innerHTML = `<main class="member-main"><div class="member-empty"><b>Acesso não liberado.</b><br>${esc(error.message || 'Faça login novamente para acessar.')}</div></main>`;
        setTimeout(function(){ startLoginModal({ redirect:'/vip-feed' }); }, 250);
      }
    })();
  }

  function installVipHooks(){
    document.addEventListener('click', function(event){
      const link = event.target && event.target.closest ? event.target.closest('a') : null;
      if(!link) return;
      const href = link.getAttribute('href') || '';
      const text = (link.textContent || '').toLowerCase();
      if(href === '/login' || href.indexOf('/login') === 0 || text.includes('entrar')){
        event.preventDefault();
        event.stopImmediatePropagation();
        startLoginModal({ redirect:'/vip-feed' });
        return;
      }
      if(href.includes('private-access-create-account') || text.includes('já fiz o pagamento')){
        event.preventDefault();
        event.stopImmediatePropagation();
        const identifier = localStorage.getItem('vip_payment_identifier') || '';
        if(identifier){
          startCreatePassword({ identifier, email: localStorage.getItem('vip_payment_email') || '', redirect:'/vip-feed' });
        }else{
          startLoginModal({ redirect:'/vip-feed' });
        }
      }
    }, true);

    const params = new URLSearchParams(window.location.search);
    const tx = params.get('tx') || localStorage.getItem('vip_payment_identifier') || '';
    if(params.get('login') === '1') setTimeout(function(){ startLoginModal({ redirect:'/vip-feed' }); }, 500);
    if(tx && (params.get('criar-senha') === '1' || params.has('tx'))) setTimeout(function(){ startCreatePassword({ identifier: tx, email: localStorage.getItem('vip_payment_email') || '', redirect:'/vip-feed' }); }, 500);
  }

  function normalizedPath(){
    let path = location.pathname.replace(/\/+$/, '') || '/';
    path = path.replace(/\.html$/i, '');
    if(path === '/login' || path === '/login/index') return '/login';
    if(path === '/vip-feed' || path === '/galeria-vip' || path === '/feed') return '/vip-feed';
    return path;
  }

  function boot(){
    const path = normalizedPath();
    if(path === '/login') renderLogin();
    else if(path === '/vip-feed') renderGallery();
    else installVipHooks();
  }

  window.VipAccessFlow = { startCreatePassword, startLoginModal, renderGallery, clearSession };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
