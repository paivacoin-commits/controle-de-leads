const API = '';
let currentProject = null;
let waCheckInterval = null;
let allGroups = []; // Armazena todos os grupos para filtrar

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  loadProjects();
  checkWhatsApp();
  waCheckInterval = setInterval(checkWhatsApp, 3000);
});

function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      currentProject = null;
      if (item.dataset.page === 'projects') loadProjects();
      else if (item.dataset.page === 'whatsapp') loadWhatsApp();
      document.getElementById('sidebar').classList.remove('open');
    });
  });
  document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('newProjectBtn').addEventListener('click', () => openNewProjectModal());
  document.getElementById('waConnectBtn').addEventListener('click', () => connectWhatsApp());
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function formatDate(d) { return d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'; }
function whatsappLink(phone, name) {
  const p = (phone || '').replace(/\D/g, '');
  const fp = p.startsWith('55') ? p : '55' + p;
  return `https://wa.me/${fp}?text=${encodeURIComponent(`Olá ${name}! Vimos que você comprou mas ainda não entrou no grupo. Posso ajudar?`)}`;
}

function openModal(title, content) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = content;
  document.getElementById('modalOverlay').classList.add('active');
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('active'); }

// ========== WHATSAPP ==========
let lastWaState = null;
let waPageActive = false;

async function checkWhatsApp() {
  try {
    const res = await fetch(`${API}/api/whatsapp/status`);
    const data = await res.json();
    const indicator = document.querySelector('.wa-indicator');
    const btn = document.getElementById('waConnectBtn');

    indicator.className = 'wa-indicator';
    if (data.state === 'connected') {
      indicator.classList.add('connected');
      btn.textContent = '✓';
      btn.disabled = true;

      // Se estava em outro estado e agora conectou, atualizar a página se estiver na página do WhatsApp
      if (lastWaState !== 'connected' && waPageActive) {
        console.log('WhatsApp conectou! Atualizando página...');
        loadWhatsApp();
      }
    } else if (data.state === 'qr') {
      indicator.classList.add('connecting');
      btn.textContent = 'QR';
      btn.disabled = true;
    } else if (data.state === 'connecting') {
      indicator.classList.add('connecting');
      btn.textContent = '...';
      btn.disabled = true;
    } else {
      btn.textContent = 'Conectar';
      btn.disabled = false;
    }

    lastWaState = data.state;
  } catch (e) { }
}

async function connectWhatsApp() {
  showToast('Iniciando conexão...', 'info');
  await fetch(`${API}/api/whatsapp/connect`, { method: 'POST' });
  setTimeout(() => loadWhatsApp(), 1000);
}

async function forceNewQR() {
  showToast('Gerando novo QR Code...', 'info');
  await fetch(`${API}/api/whatsapp/force-new-qr`, { method: 'POST' });
  setTimeout(() => loadWhatsApp(), 2000);
}

async function loadWhatsApp() {
  waPageActive = true;
  document.getElementById('pageTitle').textContent = 'WhatsApp';
  document.getElementById('newProjectBtn').style.display = 'none';

  const res = await fetch(`${API}/api/whatsapp/status`);
  const status = await res.json();

  console.log('Status WhatsApp:', status.state);

  let html = '';
  if (status.state === 'connected') {
    const groupsRes = await fetch(`${API}/api/whatsapp/groups`);
    allGroups = await groupsRes.json();

    html = `
      <div class="connected-info">
        <div style="font-size:48px;margin-bottom:16px;">✅</div>
        <div class="connected-number">Conectado: ${status.connectedNumber || 'WhatsApp'}</div>
        <button class="btn btn-danger" style="margin-top:16px;" onclick="disconnectWhatsApp()">Desconectar</button>
      </div>
      <div class="section-header" style="margin-top:32px;">
        <h3 class="section-title">👥 Seus Grupos (${allGroups.length})</h3>
      </div>
      <div class="search-box" style="margin-bottom:20px;">
        <input type="text" id="groupSearch" class="form-input" placeholder="🔍 Pesquisar grupos..." oninput="filterGroups()" style="max-width:400px;">
      </div>
      <div class="groups-grid" id="groupsGrid">
        ${renderGroupCards(allGroups)}
      </div>
    `;
  } else if (status.state === 'qr' && status.qrCode) {
    html = `
      <div class="qr-container">
        <h3>📱 Escaneie o QR Code</h3>
        <p style="color:var(--text-secondary);margin-top:8px;">Abra o WhatsApp > Menu > Aparelhos conectados</p>
        <div class="qr-code"><img src="${status.qrCode}" alt="QR Code" id="qrImage"></div>
        <p style="font-size:13px;color:var(--text-secondary);">⏱️ O QR expira em ~60s - atualizando automaticamente</p>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;">
          <button class="btn btn-secondary btn-sm" onclick="forceNewQR()">🔄 Novo QR</button>
          <button class="btn btn-secondary btn-sm" onclick="loadWhatsApp()">🔃 Atualizar</button>
        </div>
      </div>
    `;
    // Atualizar a cada 1.5 segundos enquanto aguarda QR (mais rápido)
    setTimeout(() => {
      if (waPageActive) loadWhatsApp();
    }, 1500);
  } else if (status.state === 'connecting') {
    html = `
      <div class="qr-container">
        <h3>🔌 Conectando...</h3>
        <div style="font-size:48px;margin:20px;">⏳</div>
        <p style="color:var(--text-secondary);">Aguarde, conectando ao WhatsApp...</p>
        <p style="font-size:12px;color:var(--text-secondary);margin-top:12px;">Isso pode levar até 30 segundos</p>
      </div>
    `;
    // Atualizar a cada 1.5 segundos
    setTimeout(() => {
      if (waPageActive) loadWhatsApp();
    }, 1500);
  } else {
    html = `
      <div class="qr-container">
        <h3>📱 Conectar WhatsApp</h3>
        <p style="color:var(--text-secondary);margin:20px 0;">Clique no botão abaixo para gerar o QR Code</p>
        <button class="btn btn-primary" onclick="connectWhatsApp()">Gerar QR Code</button>
        <p style="font-size:12px;color:var(--text-secondary);margin-top:16px;">💡 Certifique-se de que o WhatsApp está atualizado no celular</p>
      </div>
    `;
  }

  document.getElementById('pageContainer').innerHTML = html;
}

function renderGroupCards(groups) {
  if (!groups.length) {
    return '<div class="empty-state-card">Nenhum grupo encontrado</div>';
  }
  return groups.map(g => `
      <div class="group-card">
        <div class="group-name">📱 ${g.name}</div>
        <div class="group-info">${g.participantsCount} membros</div>
        <div class="group-actions">
          <button class="btn btn-sm btn-secondary" onclick="syncGroup('${g.id}', '${g.name}')">🔄 Sincronizar</button>
          <button class="btn btn-sm btn-secondary" onclick="exportGroup('${g.id}')">📥 Exportar</button>
        </div>
      </div>
    `).join('');
}

function filterGroups() {
  const search = document.getElementById('groupSearch').value.toLowerCase().trim();
  const filtered = allGroups.filter(g => g.name.toLowerCase().includes(search));
  document.getElementById('groupsGrid').innerHTML = renderGroupCards(filtered);
}

async function disconnectWhatsApp() {
  if (!confirm('Tem certeza que deseja desconectar?')) return;
  await fetch(`${API}/api/whatsapp/disconnect`, { method: 'POST' });
  showToast('Desconectado', 'info');
  loadWhatsApp();
}

async function syncGroup(groupId, groupName) {
  showToast('Sincronizando membros...', 'info');
  const res = await fetch(`${API}/api/whatsapp/groups/${groupId}/members`);
  const data = await res.json();
  showToast(`${data.count} membros sincronizados!`, 'success');
}

function exportGroup(groupId) {
  window.open(`${API}/api/whatsapp/groups/${groupId}/export`);
}

// ========== PROJECTS ==========
async function loadProjects() {
  waPageActive = false; // Saiu da página do WhatsApp
  document.getElementById('pageTitle').textContent = 'Projetos';
  document.getElementById('newProjectBtn').style.display = 'flex';

  const res = await fetch(`${API}/api/projects`);
  const projects = await res.json();

  if (!projects.length) {
    document.getElementById('pageContainer').innerHTML = `
      <div style="text-align:center;padding:80px 20px;">
        <div style="font-size:64px;margin-bottom:24px;">📁</div>
        <h2 style="margin-bottom:12px;">Nenhum projeto ainda</h2>
        <p style="color:var(--text-secondary);margin-bottom:24px;">Crie seu primeiro projeto para começar a rastrear vendas</p>
        <button class="btn btn-primary" onclick="openNewProjectModal()">➕ Criar Projeto</button>
      </div>
    `;
    return;
  }

  document.getElementById('pageContainer').innerHTML = `
    <div class="projects-grid">
      ${projects.map(p => {
    const groupsText = p.groups && p.groups.length
      ? `📱 ${p.groups.length} grupo(s): ${p.groups.map(g => g.group_name).join(', ')}`
      : '⚠️ Nenhum grupo vinculado';
    return `
        <div class="project-card" onclick="openProject(${p.id})">
          <div class="project-name">${p.name}</div>
          <div class="project-group">${groupsText}</div>
          <div class="project-stats">
            <div class="project-stat">
              <div class="project-stat-value">${p.total_purchases || 0}</div>
              <div class="project-stat-label">Vendas</div>
            </div>
            <div class="project-stat success">
              <div class="project-stat-value">${p.joined_count || 0}</div>
              <div class="project-stat-label">Entraram</div>
            </div>
            <div class="project-stat danger">
              <div class="project-stat-value">${p.not_joined_count || 0}</div>
              <div class="project-stat-label">Não Entraram</div>
            </div>
          </div>
          <div class="project-webhook">
            <strong>Webhook:</strong> <code>${window.location.origin}/webhook/${p.slug}</code>
          </div>
        </div>
      `}).join('')}
    </div>
  `;
}

let newProjectGroups = [];

async function openNewProjectModal() {
  const waRes = await fetch(`${API}/api/whatsapp/status`);
  const waStatus = await waRes.json();

  newProjectGroups = [];
  let groupsHtml = '';
  if (waStatus.state === 'connected') {
    const groupsRes = await fetch(`${API}/api/whatsapp/groups`);
    newProjectGroups = await groupsRes.json();
    groupsHtml = renderNewProjectGroups(newProjectGroups);
  }

  openModal('Novo Projeto', `
    <form onsubmit="createProject(event)">
      <div class="form-group">
        <label>Nome do Projeto</label>
        <input type="text" id="projectName" class="form-input" placeholder="Ex: Evento XYZ" required>
      </div>
      <div class="form-group">
        <label>Grupos do WhatsApp (selecione um ou mais)</label>
        ${waStatus.state === 'connected' ? `
          <div class="search-box" style="margin-bottom:8px;">
            <input type="text" id="newProjectGroupSearch" class="form-input" placeholder="🔍 Pesquisar grupos..." oninput="filterNewProjectGroups()">
          </div>
        ` : ''}
        <div class="groups-checklist" id="newProjectGroupsList">
          ${waStatus.state === 'connected' ? groupsHtml : '<p style="color:var(--accent-orange);font-size:13px;">⚠️ Conecte o WhatsApp primeiro para ver os grupos</p>'}
        </div>
        <p class="help-text">Você pode adicionar mais grupos depois</p>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Criar Projeto</button>
    </form>
  `);
}

function renderNewProjectGroups(groups) {
  return groups.map(g => `
    <label class="checkbox-item">
      <input type="checkbox" name="projectGroups" value="${g.id}" data-name="${g.name}">
      <span>📱 ${g.name} (${g.participantsCount})</span>
    </label>
  `).join('');
}

function filterNewProjectGroups() {
  const search = document.getElementById('newProjectGroupSearch').value.toLowerCase().trim();
  const filtered = newProjectGroups.filter(g => g.name.toLowerCase().includes(search));
  document.getElementById('newProjectGroupsList').innerHTML = renderNewProjectGroups(filtered);
}

async function createProject(e) {
  e.preventDefault();
  const name = document.getElementById('projectName').value;

  // Get selected groups
  const checkboxes = document.querySelectorAll('input[name="projectGroups"]:checked');
  const groups = Array.from(checkboxes).map(cb => ({
    group_id: cb.value,
    group_name: cb.dataset.name
  }));

  const res = await fetch(`${API}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, groups })
  });
  const data = await res.json();

  if (data.success) {
    closeModal();
    showToast('Projeto criado!', 'success');
    loadProjects();
  } else {
    showToast(data.error || 'Erro', 'error');
  }
}

// Store current project data for tabs
let currentProjectData = null;
let currentProjectContacts = [];

async function openProject(id) {
  currentProject = id;

  document.getElementById('pageTitle').textContent = 'Carregando...';
  document.getElementById('newProjectBtn').style.display = 'none';

  // Show loading state
  document.getElementById('pageContainer').innerHTML = `
    <a href="#" class="back-btn" onclick="loadProjects();return false;">← Voltar aos Projetos</a>
    <div style="text-align:center;padding:60px;">
      <div style="font-size:48px;margin-bottom:16px;">⏳</div>
      <p>Carregando projeto e sincronizando contatos...</p>
    </div>
  `;

  const [projectRes, statsRes, purchasesRes] = await Promise.all([
    fetch(`${API}/api/projects/${id}`),
    fetch(`${API}/api/projects/${id}/stats`),
    fetch(`${API}/api/projects/${id}/purchases?limit=100`)
  ]);

  const project = await projectRes.json();
  const stats = await statsRes.json();
  const { purchases } = await purchasesRes.json();

  currentProjectData = { project, stats, purchases };
  document.getElementById('pageTitle').textContent = project.name;

  // Auto-sync if groups exist
  if (project.groups && project.groups.length > 0) {
    try {
      const syncRes = await fetch(`${API}/api/projects/${id}/sync`, { method: 'POST' });
      const syncData = await syncRes.json();
      if (syncData.success && syncData.uniqueMembers) {
        // Usa a lista única (sem duplicatas) do servidor
        currentProjectContacts = syncData.uniqueMembers.map(m => ({
          ...m,
          groupName: m.groups ? m.groups.join(', ') : 'N/A',
          groupId: 'all'
        }));
        // Re-fetch stats after sync
        const newStatsRes = await fetch(`${API}/api/projects/${id}/stats`);
        currentProjectData.stats = await newStatsRes.json();
      }
    } catch (e) {
      console.error('Erro ao sincronizar:', e);
    }
  }

  renderProjectPage(id, 'contacts');
}

function renderProjectPage(id, activeTab = 'contacts') {
  const { project, stats, purchases } = currentProjectData;

  const groupsList = project.groups && project.groups.length
    ? project.groups.map(g => `
        <span class="group-tag">
          📱 ${g.group_name}
          <button onclick="viewGroupContacts('${g.group_id}', '${g.group_name}')" title="Ver contatos" class="view-btn">👥</button>
          <button onclick="removeGroupFromProject(${id}, '${g.group_id}')" title="Remover" class="remove-btn">×</button>
        </span>
      `).join('')
    : '<span style="color:var(--text-secondary)">Nenhum grupo vinculado</span>';

  document.getElementById('pageContainer').innerHTML = `
    <a href="#" class="back-btn" onclick="loadProjects();return false;">← Voltar aos Projetos</a>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">🛒</div>
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Total Vendas</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✅</div>
        <div class="stat-value" style="color:var(--accent-green)">${stats.joined}</div>
        <div class="stat-label">Entraram no Grupo</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">❌</div>
        <div class="stat-value" style="color:var(--accent-red)">${stats.notJoined}</div>
        <div class="stat-label">Não Entraram</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📊</div>
        <div class="stat-value">${stats.rate}%</div>
        <div class="stat-label">Taxa Conversão</div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="project-tabs" style="margin-bottom:24px;">
      <button class="project-tab-btn ${activeTab === 'contacts' ? 'active' : ''}" onclick="switchProjectTab('contacts')">
        👥 Contatos do Grupo (${currentProjectContacts.length})
      </button>
      <button class="project-tab-btn ${activeTab === 'config' ? 'active' : ''}" onclick="switchProjectTab('config')">
        ⚙️ Configurações & Vendas
      </button>
    </div>

    <!-- Tab Content -->
    <div id="projectTabContent">
      ${activeTab === 'contacts' ? renderContactsTab(id) : renderConfigTab(id, project, purchases, groupsList)}
    </div>
  `;
}

function switchProjectTab(tab) {
  renderProjectPage(currentProject, tab);
}

function renderContactsTab(projectId) {
  if (!currentProjectContacts.length) {
    return `
      <div style="background:var(--bg-card);padding:40px;border-radius:var(--radius);border:1px solid var(--border-color);text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">📭</div>
        <h3 style="margin-bottom:8px;">Nenhum contato sincronizado</h3>
        <p style="color:var(--text-secondary);margin-bottom:20px;">Adicione grupos ao projeto e sincronize para ver os contatos</p>
        <button class="btn btn-primary" onclick="manualSyncProject(${projectId})">🔄 Sincronizar Agora</button>
      </div>
    `;
  }

  // Group contacts by group
  const groupsMap = {};
  for (const c of currentProjectContacts) {
    if (!groupsMap[c.groupId]) {
      groupsMap[c.groupId] = { name: c.groupName, members: [] };
    }
    groupsMap[c.groupId].members.push(c);
  }

  const groupTabs = Object.entries(groupsMap).map(([gId, g]) =>
    `<button class="tab-btn" onclick="filterProjectContacts('${gId}')" data-group="${gId}">
      📱 ${g.name} (${g.members.length})
    </button>`
  ).join('');

  return `
    <div style="background:var(--bg-card);padding:20px;border-radius:var(--radius);border:1px solid var(--border-color);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3>👥 Contatos dos Grupos</h3>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-secondary" onclick="manualSyncProject(${projectId})">🔄 Atualizar</button>
          <button class="btn btn-sm btn-secondary" onclick="copyAllProjectContacts()">📋 Copiar Todos</button>
          <button class="btn btn-sm btn-secondary" onclick="exportProjectContacts()">📥 Exportar CSV</button>
        </div>
      </div>
      
      <div class="tabs-container" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
        <button class="tab-btn active" onclick="filterProjectContacts('all')" data-group="all">
          📋 Todos (${currentProjectContacts.length})
        </button>
        ${groupTabs}
      </div>
      
      <div class="search-box" style="margin-bottom:12px;">
        <input type="text" id="projectContactsSearch" class="form-input" placeholder="🔍 Pesquisar contatos..." oninput="filterProjectContactsBySearch()">
      </div>
      
      <div class="contacts-list" id="projectContactsList" style="max-height:500px;overflow-y:auto;">
        ${renderProjectContactsList(currentProjectContacts)}
      </div>
      <input type="hidden" id="currentContactFilter" value="all">
    </div>
  `;
}

function renderConfigTab(projectId, project, purchases, groupsList) {
  // Check if we have a stored ngrok URL
  const ngrokUrl = localStorage.getItem('ngrokUrl') || '';
  const webhookUrl = ngrokUrl ? `${ngrokUrl}/webhook/${project.slug}` : `${window.location.origin}/webhook/${project.slug}`;
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  return `
    <!-- Seção Webhook Hotmart -->
    <div style="background:var(--bg-card);padding:20px;border-radius:var(--radius);border:1px solid var(--border-color);margin-bottom:24px;">
      <h3 style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:24px;">🔥</span> Configuração Webhook Hotmart
      </h3>
      
      ${isLocal && !ngrokUrl ? `
      <!-- Aviso de ambiente local -->
      <div style="background:rgba(241,196,15,0.15);border:1px solid var(--accent-yellow);border-radius:8px;padding:16px;margin-bottom:16px;">
        <strong style="color:var(--accent-yellow);">⚠️ Ambiente Local Detectado</strong>
        <p style="font-size:13px;color:var(--text-secondary);margin:8px 0 12px;">
          Você está rodando em <strong>localhost</strong>. A Hotmart não consegue enviar webhooks para localhost.
          Para testar webhooks reais, use o <strong>ngrok</strong> para criar um túnel público.
        </p>
        <div style="background:var(--bg-darker);padding:12px;border-radius:6px;margin-bottom:12px;">
          <strong style="font-size:13px;">Como usar ngrok:</strong>
          <ol style="margin:8px 0 0 0;padding-left:20px;color:var(--text-secondary);font-size:12px;line-height:1.8;">
            <li>Baixe em <a href="https://ngrok.com/download" target="_blank" style="color:var(--accent-cyan);">ngrok.com/download</a></li>
            <li>Execute: <code style="background:var(--bg-card);padding:2px 6px;border-radius:4px;">ngrok http 3000</code></li>
            <li>Copie a URL gerada (ex: https://abc123.ngrok.io)</li>
            <li>Cole abaixo e clique em Salvar</li>
          </ol>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="ngrokUrlInput" class="text-input" placeholder="https://abc123.ngrok.io" style="flex:1;">
          <button class="btn btn-primary" onclick="saveNgrokUrl()">💾 Salvar</button>
        </div>
      </div>
      ` : ''}
      
      ${ngrokUrl ? `
      <div style="background:rgba(155,89,182,0.15);border:1px solid var(--accent-purple);border-radius:8px;padding:12px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <strong style="color:var(--accent-purple);">🌐 Túnel ngrok ativo:</strong>
          <span style="color:var(--text-secondary);margin-left:8px;">${ngrokUrl}</span>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="clearNgrokUrl()">✕ Remover</button>
      </div>
      ` : ''}
      
      <div style="background:rgba(26,188,156,0.1);border:1px solid var(--accent-green);border-radius:8px;padding:16px;margin-bottom:16px;">
        <strong style="color:var(--accent-green);">📋 URL do Webhook (copie e cole na Hotmart):</strong>
        <div style="display:flex;align-items:center;gap:12px;margin-top:8px;">
          <code id="webhookUrlDisplay" style="background:var(--bg-darker);color:var(--accent-cyan);padding:10px 16px;border-radius:6px;flex:1;font-size:14px;word-break:break-all;">
            ${webhookUrl}
          </code>
          <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${webhookUrl}');showToast('URL copiada!','success')">📋 Copiar</button>
        </div>
        ${isLocal && !ngrokUrl ? `<p style="font-size:11px;color:var(--accent-yellow);margin-top:8px;">⚠️ Esta URL só funciona localmente. Configure o ngrok acima para receber webhooks reais.</p>` : ''}
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div style="background:var(--bg-darker);padding:16px;border-radius:8px;">
          <strong>📌 Como configurar na Hotmart:</strong>
          <ol style="margin:12px 0 0 0;padding-left:20px;color:var(--text-secondary);font-size:13px;line-height:1.8;">
            <li>Acesse <strong>Ferramentas → Webhooks</strong></li>
            <li>Clique em <strong>"Criar Webhook"</strong></li>
            <li>Cole a URL acima no campo de URL</li>
            <li>Selecione o evento <strong>"Compra Aprovada"</strong></li>
            <li>Clique em <strong>"Salvar"</strong></li>
          </ol>
        </div>
        
        <div style="background:var(--bg-darker);padding:16px;border-radius:8px;">
          <strong>🧪 Testar Webhook:</strong>
          <p style="font-size:13px;color:var(--text-secondary);margin:8px 0 12px;">Simule uma compra para verificar se está funcionando:</p>
          <button class="btn btn-primary" onclick="testWebhook(${projectId})">
            🚀 Enviar Compra Teste
          </button>
          <button class="btn btn-secondary" onclick="viewWebhookLogs(${projectId})" style="margin-left:8px;">
            📜 Ver Logs
          </button>
        </div>
      </div>
    </div>
    
    <!-- Seção Grupos -->
    <div style="background:var(--bg-card);padding:20px;border-radius:var(--radius);border:1px solid var(--border-color);margin-bottom:24px;">
      <h3 style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:24px;">📱</span> Grupos Vinculados
      </h3>
      <div class="groups-tags" style="margin-bottom:12px;">${groupsList}</div>
      <button class="btn btn-secondary" onclick="openAddGroupModal(${projectId})">➕ Adicionar Grupo</button>
    </div>
    
    <!-- Seção Vendas -->
    <div style="background:var(--bg-card);padding:20px;border-radius:var(--radius);border:1px solid var(--border-color);margin-bottom:24px;">
      <h3 style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:24px;">🛒</span> Vendas Registradas
      </h3>
      
      <div class="filters-row" style="margin-bottom:16px;">
        <select id="filterJoined" class="select-input" style="width:200px;" onchange="filterProjectPurchases()">
          <option value="">Todos</option>
          <option value="0">⚠️ Não entraram</option>
          <option value="1">✅ Entraram</option>
        </select>
        <button class="btn btn-secondary" onclick="openAddPurchaseModal(${projectId})">➕ Add Manual</button>
        <button class="btn btn-secondary" onclick="openImportCSVModal(${projectId})">📤 Importar CSV</button>
        <button class="btn btn-secondary" onclick="window.open('${API}/api/projects/${projectId}/export')">📥 Exportar</button>
      </div>
      
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr><th>Nome</th><th>Telefone</th><th>Email</th><th>Produto</th><th>Data</th><th>Status</th><th>Ação</th></tr>
          </thead>
          <tbody id="purchasesTable">
            ${purchases.length ? purchases.map(p => `
              <tr>
                <td><strong>${p.buyer_name}</strong></td>
                <td>${p.buyer_phone || '-'}</td>
                <td>${p.buyer_email || '-'}</td>
                <td>${p.product_name}</td>
                <td>${formatDate(p.purchase_date)}</td>
                <td><span class="status-badge ${p.joined_group ? 'success' : 'danger'}">${p.joined_group ? '✅ No grupo' : '❌ Não entrou'}</span></td>
                <td>${p.buyer_phone && !p.joined_group ? `<a href="${whatsappLink(p.buyer_phone, p.buyer_name)}" target="_blank" class="whatsapp-btn">📱 Chamar</a>` : '-'}</td>
              </tr>
            `).join('') : '<tr><td colspan="7" class="empty-state">Nenhuma venda registrada ainda</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    
    <!-- Zona de Perigo -->
    <div style="background:rgba(231,76,60,0.1);padding:20px;border-radius:var(--radius);border:1px solid var(--accent-red);">
      <h3 style="margin-bottom:12px;color:var(--accent-red);">⚠️ Zona de Perigo</h3>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">Ações irreversíveis. Tenha cuidado!</p>
      <button class="btn btn-danger" onclick="deleteProject(${projectId})">🗑️ Excluir Projeto</button>
    </div>
  `;
}

function renderProjectContactsList(members) {
  if (!members.length) {
    return '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Nenhum contato encontrado</p>';
  }
  return members.map((m, i) => `
    <div class="contact-item" style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border-color);">
      <span class="contact-number" style="color:var(--text-secondary);min-width:30px;">${i + 1}.</span>
      <span class="contact-phone" style="flex:1;font-family:monospace;">📱 ${m.phone}</span>
      <span class="contact-group" style="font-size:12px;color:var(--accent-purple);background:rgba(155,89,182,0.1);padding:2px 8px;border-radius:12px;">${m.groupName}</span>
      ${m.isAdmin ? '<span style="font-size:11px;color:var(--accent-cyan);background:rgba(26,188,156,0.1);padding:2px 6px;border-radius:12px;">👑 Admin</span>' : ''}
      <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${m.phone}');showToast('Copiado!','success')">📋</button>
    </div>
  `).join('');
}

function filterProjectContacts(groupId) {
  document.querySelectorAll('.tabs-container .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.group === groupId);
  });

  document.getElementById('currentContactFilter').value = groupId;
  document.getElementById('projectContactsSearch').value = '';

  const filtered = groupId === 'all'
    ? currentProjectContacts
    : currentProjectContacts.filter(m => m.groupId === groupId);

  document.getElementById('projectContactsList').innerHTML = renderProjectContactsList(filtered);
}

function filterProjectContactsBySearch() {
  const search = document.getElementById('projectContactsSearch').value.toLowerCase().trim();
  const currentFilter = document.getElementById('currentContactFilter').value;

  let filtered = currentFilter === 'all'
    ? currentProjectContacts
    : currentProjectContacts.filter(m => m.groupId === currentFilter);

  if (search) {
    filtered = filtered.filter(m =>
      m.phone.toLowerCase().includes(search) ||
      m.groupName.toLowerCase().includes(search)
    );
  }

  document.getElementById('projectContactsList').innerHTML = renderProjectContactsList(filtered);
}

function copyAllProjectContacts() {
  const currentFilter = document.getElementById('currentContactFilter')?.value || 'all';
  const members = currentFilter === 'all'
    ? currentProjectContacts
    : currentProjectContacts.filter(m => m.groupId === currentFilter);

  const phones = members.map(m => m.phone).join('\n');
  navigator.clipboard.writeText(phones);
  showToast(`${members.length} contatos copiados!`, 'success');
}

function exportProjectContacts() {
  const currentFilter = document.getElementById('currentContactFilter')?.value || 'all';
  const members = currentFilter === 'all'
    ? currentProjectContacts
    : currentProjectContacts.filter(m => m.groupId === currentFilter);

  let csv = 'Telefone,Grupo,Admin\n';
  for (const m of members) {
    csv += `"${m.phone}","${m.groupName}","${m.isAdmin ? 'Sim' : 'Não'}"\n`;
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contatos_${currentProjectData.project.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado!', 'success');
}

async function manualSyncProject(id) {
  showToast('Sincronizando...', 'info');
  try {
    const syncRes = await fetch(`${API}/api/projects/${id}/sync`, { method: 'POST' });
    const syncData = await syncRes.json();
    if (syncData.success && syncData.uniqueMembers) {
      // Usa a lista única (sem duplicatas) do servidor
      currentProjectContacts = syncData.uniqueMembers.map(m => ({
        ...m,
        groupName: m.groups ? m.groups.join(', ') : 'N/A',
        groupId: 'all'
      }));
      // Re-fetch stats and purchases
      const [statsRes, purchasesRes] = await Promise.all([
        fetch(`${API}/api/projects/${id}/stats`),
        fetch(`${API}/api/projects/${id}/purchases?limit=100`)
      ]);
      currentProjectData.stats = await statsRes.json();
      const purchasesData = await purchasesRes.json();
      currentProjectData.purchases = purchasesData.purchases;

      showToast(`${syncData.memberCount} contatos únicos sincronizados!`, 'success');
      renderProjectPage(id, 'contacts');
    } else {
      showToast(syncData.error || 'Erro ao sincronizar', 'error');
    }
  } catch (e) {
    showToast('Erro ao sincronizar', 'error');
  }
}

async function filterProjectPurchases() {
  const joined = document.getElementById('filterJoined').value;
  const res = await fetch(`${API}/api/projects/${currentProject}/purchases?joined=${joined}&limit=100`);
  const { purchases } = await res.json();

  document.getElementById('purchasesTable').innerHTML = purchases.length ? purchases.map(p => `
    <tr>
      <td><strong>${p.buyer_name}</strong></td>
      <td>${p.buyer_phone || '-'}</td>
      <td>${p.buyer_email || '-'}</td>
      <td>${p.product_name}</td>
      <td>${formatDate(p.purchase_date)}</td>
      <td><span class="status-badge ${p.joined_group ? 'success' : 'danger'}">${p.joined_group ? '✅ No grupo' : '❌ Não entrou'}</span></td>
      <td>${p.buyer_phone && !p.joined_group ? `<a href="${whatsappLink(p.buyer_phone, p.buyer_name)}" target="_blank" class="whatsapp-btn">📱 Chamar</a>` : '-'}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty-state">Nenhum resultado</td></tr>';
}

async function syncProject(id) {
  showToast('Sincronizando...', 'info');
  const res = await fetch(`${API}/api/projects/${id}/sync`, { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    showToast(`${data.memberCount} membros sincronizados!`, 'success');

    // Show modal with contacts from all groups
    if (data.groups && data.groups.length > 0) {
      showSyncResultsModal(data.groups, data.memberCount);
    }

    openProject(id);
  } else {
    showToast(data.error || 'Erro', 'error');
  }
}

// ========== WEBHOOK TESTING ==========
async function testWebhook(projectId) {
  openModal('🧪 Testar Webhook', `
    <p style="margin-bottom:16px;color:var(--text-secondary);">Preencha os dados para simular uma compra:</p>
    <form onsubmit="sendTestWebhook(event, ${projectId})">
      <div style="display:grid;gap:12px;">
        <div>
          <label style="display:block;margin-bottom:4px;font-size:13px;">Nome do Comprador:</label>
          <input type="text" id="testName" class="text-input" value="Comprador Teste" required>
        </div>
        <div>
          <label style="display:block;margin-bottom:4px;font-size:13px;">Email:</label>
          <input type="email" id="testEmail" class="text-input" value="teste@email.com" required>
        </div>
        <div>
          <label style="display:block;margin-bottom:4px;font-size:13px;">Telefone (com DDI):</label>
          <input type="text" id="testPhone" class="text-input" value="5562999999999" required>
        </div>
        <div>
          <label style="display:block;margin-bottom:4px;font-size:13px;">Nome do Produto:</label>
          <input type="text" id="testProduct" class="text-input" value="Produto Teste" required>
        </div>
        <div>
          <label style="display:block;margin-bottom:4px;font-size:13px;">Valor (R$):</label>
          <input type="number" id="testPrice" class="text-input" value="97" step="0.01" required>
        </div>
      </div>
      <div style="margin-top:20px;display:flex;gap:12px;justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">🚀 Enviar Teste</button>
      </div>
    </form>
  `);
}

async function sendTestWebhook(e, projectId) {
  e.preventDefault();

  const data = {
    name: document.getElementById('testName').value,
    email: document.getElementById('testEmail').value,
    phone: document.getElementById('testPhone').value,
    product: document.getElementById('testProduct').value,
    price: parseFloat(document.getElementById('testPrice').value)
  };

  showToast('Enviando teste...', 'info');
  closeModal();

  try {
    const res = await fetch(`${API}/api/projects/${projectId}/test-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (result.success) {
      showToast('✅ Teste enviado com sucesso! Veja na aba Configurações.', 'success');
      // Atualizar a página para mostrar a nova venda
      openProject(projectId);
    } else {
      showToast(result.error || 'Erro ao enviar teste', 'error');
    }
  } catch (err) {
    showToast('Erro ao enviar teste: ' + err.message, 'error');
  }
}

async function viewWebhookLogs(projectId) {
  showToast('Carregando logs...', 'info');

  try {
    const res = await fetch(`${API}/api/projects/${projectId}/webhook-logs`);
    const logs = await res.json();

    const logsHtml = logs.length ? logs.map(log => {
      const payload = JSON.parse(log.payload || '{}');
      const buyer = payload.buyer || payload.data?.buyer || {};
      return `
        <div style="background:var(--bg-darker);padding:12px;border-radius:8px;margin-bottom:8px;border-left:3px solid ${log.status === 'error' ? 'var(--accent-red)' : 'var(--accent-green)'};">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-weight:600;color:${log.status === 'error' ? 'var(--accent-red)' : 'var(--accent-green)'};">
              ${log.event_type}
            </span>
            <span style="font-size:12px;color:var(--text-secondary);">${formatDate(log.created_at)}</span>
          </div>
          <div style="font-size:13px;color:var(--text-secondary);">
            ${buyer.name ? `<strong>Nome:</strong> ${buyer.name}<br>` : ''}
            ${buyer.email ? `<strong>Email:</strong> ${buyer.email}<br>` : ''}
            ${buyer.phone ? `<strong>Telefone:</strong> ${buyer.phone}` : ''}
          </div>
          <details style="margin-top:8px;">
            <summary style="cursor:pointer;font-size:12px;color:var(--accent-cyan);">Ver payload completo</summary>
            <pre style="margin-top:8px;font-size:11px;overflow-x:auto;max-height:200px;background:var(--bg-card);padding:8px;border-radius:4px;">${JSON.stringify(payload, null, 2)}</pre>
          </details>
        </div>
      `;
    }).join('') : '<p style="color:var(--text-secondary);text-align:center;">Nenhum log registrado ainda</p>';

    openModal('📜 Logs do Webhook', `
      <div style="max-height:500px;overflow-y:auto;">
        ${logsHtml}
      </div>
      <div style="margin-top:16px;display:flex;justify-content:space-between;">
        <button class="btn btn-danger btn-sm" onclick="clearWebhookLogs(${projectId})">🗑️ Limpar Logs</button>
        <button class="btn btn-secondary" onclick="closeModal()">Fechar</button>
      </div>
    `);
  } catch (err) {
    showToast('Erro ao carregar logs: ' + err.message, 'error');
  }
}

async function clearWebhookLogs(projectId) {
  if (!confirm('Tem certeza que deseja limpar todos os logs?')) return;

  try {
    await fetch(`${API}/api/projects/${projectId}/webhook-logs`, { method: 'DELETE' });
    showToast('Logs limpos!', 'success');
    closeModal();
  } catch (err) {
    showToast('Erro ao limpar logs', 'error');
  }
}

// ========== NGROK URL MANAGEMENT ==========
function saveNgrokUrl() {
  const url = document.getElementById('ngrokUrlInput').value.trim();
  if (!url) {
    showToast('Digite a URL do ngrok', 'error');
    return;
  }

  // Validar formato básico
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showToast('URL deve começar com http:// ou https://', 'error');
    return;
  }

  // Remover barra final se houver
  const cleanUrl = url.replace(/\/$/, '');
  localStorage.setItem('ngrokUrl', cleanUrl);
  showToast('URL do ngrok salva! Recarregando...', 'success');

  // Recarregar a página do projeto
  setTimeout(() => {
    openProject(currentProject);
  }, 500);
}

function clearNgrokUrl() {
  localStorage.removeItem('ngrokUrl');
  showToast('URL do ngrok removida!', 'success');
  openProject(currentProject);
}

// Store all synced members for filtering
let allSyncedMembers = [];

function showSyncResultsModal(groups, totalMembers) {
  // Flatten all members with group info
  allSyncedMembers = [];
  for (const g of groups) {
    for (const m of g.members) {
      allSyncedMembers.push({
        ...m,
        groupName: g.group_name,
        groupId: g.group_id
      });
    }
  }

  const groupTabs = groups.map((g, idx) =>
    `<button class="tab-btn ${idx === 0 ? 'active' : ''}" onclick="filterSyncedContacts('${g.group_id}')" data-group="${g.group_id}">
      📱 ${g.group_name} (${g.members.length})
    </button>`
  ).join('');

  openModal(`👥 Contatos Sincronizados (${totalMembers})`, `
    <div class="sync-results-container">
      <div class="tabs-container" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
        <button class="tab-btn active" onclick="filterSyncedContacts('all')" data-group="all">
          📋 Todos (${totalMembers})
        </button>
        ${groupTabs}
      </div>
      <div class="search-box" style="margin-bottom:12px;">
        <input type="text" id="syncContactsSearch" class="form-input" placeholder="🔍 Pesquisar contatos..." oninput="filterSyncedContactsBySearch()">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button class="btn btn-sm btn-secondary" onclick="copyAllSyncedContacts()">📋 Copiar Todos</button>
        <button class="btn btn-sm btn-secondary" onclick="exportSyncedContacts()">📥 Exportar CSV</button>
      </div>
      <div class="contacts-list" id="syncedContactsList" style="max-height:400px;overflow-y:auto;">
        ${renderSyncedContactsList(allSyncedMembers)}
      </div>
      <input type="hidden" id="currentSyncFilter" value="all">
    </div>
  `);
}

function renderSyncedContactsList(members) {
  if (!members.length) {
    return '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Nenhum contato encontrado</p>';
  }
  return members.map((m, i) => `
    <div class="contact-item" style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border-color);">
      <span class="contact-number" style="color:var(--text-secondary);min-width:30px;">${i + 1}.</span>
      <span class="contact-phone" style="flex:1;">📱 ${m.phone}</span>
      <span class="contact-group" style="font-size:12px;color:var(--accent-purple);background:rgba(155,89,182,0.1);padding:2px 8px;border-radius:12px;">${m.groupName}</span>
      ${m.isAdmin ? '<span style="font-size:11px;color:var(--accent-cyan);background:rgba(26,188,156,0.1);padding:2px 6px;border-radius:12px;">👑 Admin</span>' : ''}
      <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${m.phone}');showToast('Copiado!','success')">📋</button>
    </div>
  `).join('');
}

function filterSyncedContacts(groupId) {
  // Update tab styles
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.group === groupId);
  });

  document.getElementById('currentSyncFilter').value = groupId;
  document.getElementById('syncContactsSearch').value = '';

  const filtered = groupId === 'all'
    ? allSyncedMembers
    : allSyncedMembers.filter(m => m.groupId === groupId);

  document.getElementById('syncedContactsList').innerHTML = renderSyncedContactsList(filtered);
}

function filterSyncedContactsBySearch() {
  const search = document.getElementById('syncContactsSearch').value.toLowerCase().trim();
  const currentFilter = document.getElementById('currentSyncFilter').value;

  let filtered = currentFilter === 'all'
    ? allSyncedMembers
    : allSyncedMembers.filter(m => m.groupId === currentFilter);

  if (search) {
    filtered = filtered.filter(m =>
      m.phone.toLowerCase().includes(search) ||
      m.groupName.toLowerCase().includes(search)
    );
  }

  document.getElementById('syncedContactsList').innerHTML = renderSyncedContactsList(filtered);
}

function copyAllSyncedContacts() {
  const currentFilter = document.getElementById('currentSyncFilter').value;
  const members = currentFilter === 'all'
    ? allSyncedMembers
    : allSyncedMembers.filter(m => m.groupId === currentFilter);

  const phones = members.map(m => m.phone).join('\n');
  navigator.clipboard.writeText(phones);
  showToast(`${members.length} contatos copiados!`, 'success');
}

function exportSyncedContacts() {
  const currentFilter = document.getElementById('currentSyncFilter').value;
  const members = currentFilter === 'all'
    ? allSyncedMembers
    : allSyncedMembers.filter(m => m.groupId === currentFilter);

  let csv = 'Telefone,Grupo,Admin\n';
  for (const m of members) {
    csv += `"${m.phone}","${m.groupName}","${m.isAdmin ? 'Sim' : 'Não'}"\n`;
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contatos_sincronizados_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado!', 'success');
}

async function deleteProject(id) {
  if (!confirm('Tem certeza? Isso excluirá todas as vendas do projeto.')) return;
  await fetch(`${API}/api/projects/${id}`, { method: 'DELETE' });
  showToast('Projeto excluído', 'success');
  loadProjects();
}

function openAddPurchaseModal(projectId) {
  openModal('Adicionar Venda Manual', `
    <form onsubmit="addManualPurchase(event, ${projectId})">
      <div class="form-row">
        <div class="form-group">
          <label>Nome</label>
          <input type="text" id="manualName" class="form-input" required>
        </div>
        <div class="form-group">
          <label>Telefone</label>
          <input type="tel" id="manualPhone" class="form-input" placeholder="11999999999" required>
        </div>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="manualEmail" class="form-input">
      </div>
      <div class="form-group">
        <label>Produto</label>
        <input type="text" id="manualProduct" class="form-input" value="Ingresso">
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;">Adicionar</button>
    </form>
  `);
}

async function addManualPurchase(e, projectId) {
  e.preventDefault();
  await fetch(`${API}/api/projects/${projectId}/purchases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      buyer_name: document.getElementById('manualName').value,
      buyer_phone: document.getElementById('manualPhone').value,
      buyer_email: document.getElementById('manualEmail').value,
      product_name: document.getElementById('manualProduct').value
    })
  });
  closeModal();
  showToast('Venda adicionada!', 'success');
  openProject(projectId);
}

// ========== GROUP MANAGEMENT ==========
let availableGroupsForProject = [];

async function openAddGroupModal(projectId) {
  const waRes = await fetch(`${API}/api/whatsapp/status`);
  const waStatus = await waRes.json();

  if (waStatus.state !== 'connected') {
    showToast('Conecte o WhatsApp primeiro', 'error');
    return;
  }

  const groupsRes = await fetch(`${API}/api/whatsapp/groups`);
  const groups = await groupsRes.json();

  const projectRes = await fetch(`${API}/api/projects/${projectId}`);
  const project = await projectRes.json();
  const existingIds = (project.groups || []).map(g => g.group_id);

  availableGroupsForProject = groups.filter(g => !existingIds.includes(g.id));

  if (!availableGroupsForProject.length) {
    showToast('Todos os grupos já estão vinculados', 'info');
    return;
  }

  openModal('Adicionar Grupo ao Projeto', `
    <div class="search-box" style="margin-bottom:12px;">
      <input type="text" id="addGroupSearch" class="form-input" placeholder="🔍 Pesquisar grupos..." oninput="filterAddGroupList()">
    </div>
    <div class="groups-checklist" id="addGroupsList">
      ${renderAddGroupItems(availableGroupsForProject)}
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:16px;" onclick="addGroupsToProject(${projectId})">Adicionar Selecionados</button>
  `);
}

function renderAddGroupItems(groups) {
  return groups.map(g => `
    <label class="checkbox-item">
      <input type="checkbox" name="addGroups" value="${g.id}" data-name="${g.name}">
      <span>📱 ${g.name} (${g.participantsCount} membros)</span>
    </label>
  `).join('');
}

function filterAddGroupList() {
  const search = document.getElementById('addGroupSearch').value.toLowerCase().trim();
  const filtered = availableGroupsForProject.filter(g => g.name.toLowerCase().includes(search));
  document.getElementById('addGroupsList').innerHTML = renderAddGroupItems(filtered);
}

async function addGroupsToProject(projectId) {
  const checkboxes = document.querySelectorAll('input[name="addGroups"]:checked');
  if (!checkboxes.length) {
    showToast('Selecione pelo menos um grupo', 'error');
    return;
  }

  for (const cb of checkboxes) {
    await fetch(`${API}/api/projects/${projectId}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: cb.value, group_name: cb.dataset.name })
    });
  }

  closeModal();
  showToast('Grupos adicionados!', 'success');
  openProject(projectId);
}

async function removeGroupFromProject(projectId, groupId) {
  if (!confirm('Remover este grupo do projeto?')) return;
  await fetch(`${API}/api/projects/${projectId}/groups/${groupId}`, { method: 'DELETE' });
  showToast('Grupo removido', 'success');
  openProject(projectId);
}

// ========== VIEW GROUP CONTACTS ==========
async function viewGroupContacts(groupId, groupName) {
  showToast('Carregando contatos...', 'info');

  try {
    const res = await fetch(`${API}/api/whatsapp/groups/${groupId}/members`);
    const data = await res.json();

    if (data.error) {
      showToast(data.error, 'error');
      return;
    }

    const members = data.members || [];

    openModal(`👥 Contatos: ${groupName} (${members.length})`, `
      <div class="search-box" style="margin-bottom:12px;">
        <input type="text" id="contactsSearch" class="form-input" placeholder="🔍 Pesquisar contatos..." oninput="filterContactsList()">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button class="btn btn-sm btn-secondary" onclick="copyAllContacts()">📋 Copiar Todos</button>
        <button class="btn btn-sm btn-secondary" onclick="window.open('${API}/api/whatsapp/groups/${groupId}/export')">📥 Exportar CSV</button>
      </div>
      <div class="contacts-list" id="contactsList">
        ${renderContactsList(members)}
      </div>
      <input type="hidden" id="allContactsData" value='${JSON.stringify(members)}'>
    `);
  } catch (error) {
    showToast('Erro ao carregar contatos', 'error');
  }
}

function renderContactsList(members) {
  if (!members.length) {
    return '<p style="color:var(--text-secondary);text-align:center;padding:20px;">Nenhum contato encontrado</p>';
  }
  return members.map((m, i) => `
    <div class="contact-item">
      <span class="contact-number">${i + 1}.</span>
      <span class="contact-phone">📱 ${m.phone}</span>
      <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${m.phone}');showToast('Copiado!','success')">📋</button>
    </div>
  `).join('');
}

function filterContactsList() {
  const search = document.getElementById('contactsSearch').value.toLowerCase().trim();
  const allData = JSON.parse(document.getElementById('allContactsData').value);
  const filtered = allData.filter(m => m.phone.includes(search));
  document.getElementById('contactsList').innerHTML = renderContactsList(filtered);
}

function copyAllContacts() {
  const allData = JSON.parse(document.getElementById('allContactsData').value);
  const phones = allData.map(m => m.phone).join('\n');
  navigator.clipboard.writeText(phones);
  showToast(`${allData.length} contatos copiados!`, 'success');
}

// ========== IMPORT CSV ==========
function openImportCSVModal(projectId) {
  openModal('Importar CSV', `
    <div class="form-group">
      <label>Selecione o arquivo CSV</label>
      <input type="file" id="csvFile" class="form-input" accept=".csv" style="padding:10px;">
      <p class="help-text" style="margin-top:8px;">O CSV deve ter colunas: nome, telefone, email (opcional), produto (opcional)</p>
    </div>
    <div class="form-group">
      <label>Preview</label>
      <div id="csvPreview" style="background:var(--bg-primary);padding:12px;border-radius:8px;max-height:200px;overflow-y:auto;font-size:13px;">
        Selecione um arquivo para ver o preview
      </div>
    </div>
    <button class="btn btn-primary" style="width:100%;" onclick="importCSV(${projectId})">📤 Importar</button>
    <script>
      document.getElementById('csvFile').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
          const lines = e.target.result.split('\\n').slice(0, 6);
          document.getElementById('csvPreview').innerHTML = '<pre>' + lines.join('\\n') + '</pre>' + (lines.length >= 6 ? '...' : '');
        };
        reader.readAsText(file);
      });
    <\/script>
  `);
}

async function importCSV(projectId) {
  const fileInput = document.getElementById('csvFile');
  const file = fileInput.files[0];
  if (!file) {
    showToast('Selecione um arquivo', 'error');
    return;
  }

  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());

  // Parse CSV
  const data = [];
  for (let i = 1; i < lines.length; i++) { // Skip header
    const parts = lines[i].split(',').map(p => p.replace(/"/g, '').trim());
    if (parts.length >= 2) {
      data.push({
        name: parts[0],
        phone: parts[1],
        email: parts[2] || '',
        product: parts[3] || 'Importado'
      });
    }
  }

  if (!data.length) {
    showToast('Nenhum dado válido no CSV', 'error');
    return;
  }

  showToast(`Importando ${data.length} registros...`, 'info');

  const res = await fetch(`${API}/api/projects/${projectId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
  const result = await res.json();

  if (result.success) {
    closeModal();
    showToast(`✅ ${result.imported} importados, ${result.alreadyInGroup} já no grupo`, 'success');
    openProject(projectId);
  } else {
    showToast(result.error || 'Erro na importação', 'error');
  }
}
