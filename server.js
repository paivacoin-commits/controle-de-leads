import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

if (supabase) {
  console.log('✅ Supabase conectado!');
} else {
  console.log('⚠️ Supabase não configurado - usando armazenamento local');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Database
const db = new Database(join(__dirname, 'database.sqlite'));
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS project_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    group_id TEXT,
    group_name TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    transaction_id TEXT,
    buyer_name TEXT,
    buyer_email TEXT,
    buyer_phone TEXT,
    product_name TEXT,
    price REAL DEFAULT 0,
    status TEXT DEFAULT 'approved',
    joined_group INTEGER DEFAULT 0,
    joined_date DATETIME,
    purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT,
    phone TEXT,
    name TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    event_type TEXT,
    payload TEXT,
    status TEXT DEFAULT 'success',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
  CREATE INDEX IF NOT EXISTS idx_purchases_project ON purchases(project_id);
  CREATE INDEX IF NOT EXISTS idx_purchases_phone ON purchases(buyer_phone);
  CREATE INDEX IF NOT EXISTS idx_members_group ON group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_members_phone ON group_members(phone);
  CREATE INDEX IF NOT EXISTS idx_project_groups ON project_groups(project_id);
  CREATE INDEX IF NOT EXISTS idx_webhook_logs ON webhook_logs(project_id);
`);

// WhatsApp State
let sock = null;
let qrCode = null;
let connectionState = 'disconnected';
let connectedNumber = null;

// Helper - Normaliza para comparação (apenas números locais)
function normalizePhone(phone) {
  if (!phone) return null;
  let n = phone.replace(/\D/g, '');
  // Remove DDI 55 se presente
  if (n.startsWith('55') && n.length > 11) n = n.substring(2);
  // Remove zero inicial
  if (n.startsWith('0')) n = n.substring(1);
  // Garante que tem 9 dígitos após DDD (celular brasileiro)
  if (n.length === 10) {
    // Adiciona 9 após DDD para números antigos
    n = n.substring(0, 2) + '9' + n.substring(2);
  }
  return n;
}

// Formata para exibição: mostra o número como vem do WhatsApp
function formatPhoneDisplay(phone) {
  if (!phone) return '';
  // Remove caracteres não numéricos, mantendo o número original
  return phone.replace(/\D/g, '');
}

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ========== WHATSAPP CONNECTION ==========
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL = 5000; // 5 segundos base

// Função para restaurar sessão do Supabase para arquivos locais
async function restoreSessionFromSupabase() {
  if (!supabase) return false;

  try {
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('session_id', 'whatsapp_session')
      .single();

    if (session?.creds) {
      const fs = await import('fs');
      const authPath = join(__dirname, 'auth_info');

      // Criar pasta se não existir
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
      }

      // Restaurar creds
      fs.writeFileSync(join(authPath, 'creds.json'), session.creds);

      // Restaurar keys se existirem
      if (session.keys) {
        const keys = JSON.parse(session.keys);
        for (const [filename, content] of Object.entries(keys)) {
          fs.writeFileSync(join(authPath, filename), JSON.stringify(content));
        }
      }

      console.log('📥 Sessão restaurada do Supabase');
      return true;
    }
  } catch (error) {
    console.log('� Nenhuma sessão encontrada no Supabase (primeira vez)');
  }
  return false;
}

// Função para salvar sessão no Supabase
async function saveSessionToSupabase() {
  if (!supabase) return;

  try {
    const fs = await import('fs');
    const authPath = join(__dirname, 'auth_info');

    if (!fs.existsSync(authPath)) return;

    // Ler creds.json
    const credsPath = join(authPath, 'creds.json');
    if (!fs.existsSync(credsPath)) return;

    const creds = fs.readFileSync(credsPath, 'utf8');

    // Ler outros arquivos de keys
    const keys = {};
    const files = fs.readdirSync(authPath);
    for (const file of files) {
      if (file !== 'creds.json' && file.endsWith('.json')) {
        const content = fs.readFileSync(join(authPath, file), 'utf8');
        keys[file] = JSON.parse(content);
      }
    }

    const { error } = await supabase
      .from('whatsapp_sessions')
      .upsert({
        session_id: 'whatsapp_session',
        creds: creds,
        keys: JSON.stringify(keys),
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id' });

    if (error) {
      console.error('❌ Erro ao salvar no Supabase:', error.message);
    } else {
      console.log('💾 Sessão salva no Supabase');
    }
  } catch (error) {
    console.error('❌ Erro ao salvar sessão:', error.message);
  }
}

async function connectWhatsApp() {
  try {
    // Restaurar sessão do Supabase antes de conectar
    if (supabase) {
      await restoreSessionFromSupabase();
    }

    const { state, saveCreds } = await useMultiFileAuthState(join(__dirname, 'auth_info'));

    // Wrapper para salvar também no Supabase
    const saveCredsWithSupabase = async () => {
      await saveCreds();
      await saveSessionToSupabase();
    };

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      // Configurações para conexão mais estável
      connectTimeoutMs: 60000, // 60 segundos para conectar
      defaultQueryTimeoutMs: 60000, // 60 segundos para queries
      keepAliveIntervalMs: 30000, // Ping a cada 30 segundos
      retryRequestDelayMs: 500, // Delay entre retries
      markOnlineOnConnect: true, // Marca como online ao conectar
      syncFullHistory: false, // Não sincronizar histórico completo (mais rápido)
      generateHighQualityLinkPreview: false, // Desativa preview de links (mais leve)
    });

    sock.ev.on('creds.update', saveCredsWithSupabase);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = await QRCode.toDataURL(qr);
        connectionState = 'qr';
        console.log('📱 QR Code gerado! Escaneie no dashboard.');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        connectionState = 'disconnected';
        qrCode = null;

        console.log(`❌ Conexão fechada. Status: ${statusCode}`);

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          // Delay exponencial: 5s, 10s, 20s, 40s...
          const delay = Math.min(RECONNECT_INTERVAL * Math.pow(1.5, reconnectAttempts - 1), 60000);
          console.log(`🔄 Reconectando em ${delay / 1000}s... (tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(connectWhatsApp, delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('🚪 Logout detectado. Limpando sessão...');
          // Limpar a pasta de autenticação para forçar novo QR
          const fs = await import('fs');
          const authPath = join(__dirname, 'auth_info');
          if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
          }
          reconnectAttempts = 0;
          setTimeout(connectWhatsApp, 2000);
        } else {
          console.log('❌ Máximo de tentativas atingido. Reinicie o servidor ou escaneie o QR novamente.');
        }
      } else if (connection === 'open') {
        connectionState = 'connected';
        qrCode = null;
        reconnectAttempts = 0; // Reset contador de tentativas
        connectedNumber = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0];
        console.log('✅ WhatsApp conectado!', connectedNumber);
      } else if (connection === 'connecting') {
        connectionState = 'connecting';
        console.log('🔌 Conectando ao WhatsApp...');
      }
    });

    // Listen for group participant updates
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
      console.log(`👥 Grupo ${id}: ${action} - ${participants.join(', ')}`);
      if (action === 'add') {
        // Verificar em todos os projetos que têm esse grupo
        const projectGroups = db.prepare('SELECT * FROM project_groups WHERE group_id = ?').all(id);
        for (const pg of projectGroups) {
          for (const participant of participants) {
            const phone = normalizePhone(participant.split('@')[0]);
            // Check if this person made a purchase
            const purchase = db.prepare('SELECT * FROM purchases WHERE project_id = ? AND buyer_phone LIKE ? AND joined_group = 0')
              .get(pg.project_id, `%${phone}%`);
            if (purchase) {
              db.prepare('UPDATE purchases SET joined_group = 1, joined_date = CURRENT_TIMESTAMP WHERE id = ?').run(purchase.id);
              console.log(`✅ ${purchase.buyer_name} entrou no grupo!`);
            }
          }
        }
      }
    });

    // Tratar erros gerais do socket
    sock.ev.on('error', (error) => {
      console.error('❌ Erro no WhatsApp:', error);
    });

  } catch (error) {
    console.error('❌ Erro ao conectar WhatsApp:', error);
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`🔄 Tentando reconectar em ${RECONNECT_INTERVAL / 1000}s...`);
      setTimeout(connectWhatsApp, RECONNECT_INTERVAL);
    }
  }
}

// ========== WHATSAPP API ROUTES ==========
app.get('/api/whatsapp/status', (req, res) => {
  res.json({ state: connectionState, qrCode, connectedNumber });
});

app.post('/api/whatsapp/connect', async (req, res) => {
  if (connectionState === 'connected') {
    return res.json({ success: true, message: 'Já conectado' });
  }
  try {
    await connectWhatsApp();
    res.json({ success: true, message: 'Conectando...' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  if (sock) {
    await sock.logout();
    sock = null;
    connectionState = 'disconnected';
    qrCode = null;
    connectedNumber = null;
  }
  res.json({ success: true });
});

app.get('/api/whatsapp/groups', async (req, res) => {
  if (!sock || connectionState !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp não conectado' });
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject,
      participantsCount: g.participants?.length || 0,
      creation: g.creation
    }));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/whatsapp/groups/:groupId/members', async (req, res) => {
  if (!sock || connectionState !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp não conectado' });
  }
  try {
    const metadata = await sock.groupMetadata(req.params.groupId);

    console.log(`\n📱 Buscando membros do grupo: ${metadata.subject}`);
    console.log(`   Total de participantes: ${metadata.participants?.length || 0}`);

    // Log primeiro participante para debug
    if (metadata.participants && metadata.participants.length > 0) {
      console.log('   Estrutura do primeiro participante:', JSON.stringify(metadata.participants[0], null, 2));
    }

    const members = metadata.participants.map(p => {
      // Log completo do primeiro participante para debug (só uma vez)

      // O ID pode ser um LID (número longo) ou um número de telefone real
      // Formato normal: 5562999999999@s.whatsapp.net
      // Formato LID: 123456789012345@lid
      const rawId = p.id.split('@')[0];
      const isLid = p.id.includes('@lid');

      // Tenta pegar o número real de várias fontes possíveis (Baileys v7+)
      let phone = '';
      let source = 'unknown';

      // 1. Verifica phoneNumber (Baileys v7)
      if (p.phoneNumber) {
        phone = p.phoneNumber.replace(/\D/g, '');
        source = 'phoneNumber';
      }
      // 2. Verifica lid (quando phoneNumber tem o número e id tem o LID)
      else if (p.lid && !isLid) {
        // O id é o número, lid é o LID
        phone = rawId;
        source = 'id_with_lid';
      }
      // 3. Verifica se não é LID (é número normal)
      else if (!isLid) {
        phone = rawId;
        source = 'id_phone';
      }
      // 4. Último recurso - mostra o LID como ID (sem conversão possível)
      else {
        phone = rawId;
        source = 'lid_only';
      }

      return {
        phone: phone,
        rawPhone: rawId,
        idType: isLid ? 'LID' : 'PHONE',
        source: source,
        isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        notify: p.notify || '' // Nome do contato se disponível
      };
    });

    // Filtrar apenas membros com números reais (não LIDs)
    const realMembers = members.filter(m => m.idType === 'PHONE');
    const lidMembers = members.filter(m => m.idType === 'LID');

    console.log(`   Membros com número real: ${realMembers.length}`);
    console.log(`   Membros com LID: ${lidMembers.length}`);

    // Save to database - salva todos os membros
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(req.params.groupId);
    const insert = db.prepare('INSERT INTO group_members (group_id, phone, name) VALUES (?, ?, ?)');
    for (const m of members) {
      insert.run(req.params.groupId, m.phone, m.notify || m.phone);
    }

    // Update purchases
    updateProjectPurchases(req.params.groupId);

    res.json({
      members,
      count: members.length,
      realCount: realMembers.length,
      lidCount: lidMembers.length,
      groupName: metadata.subject
    });
  } catch (error) {
    console.error('❌ Erro ao buscar membros:', error);
    res.status(500).json({ error: error.message });
  }
});

function updateProjectPurchases(groupId) {
  // Find project that has this group
  const pg = db.prepare('SELECT * FROM project_groups WHERE group_id = ?').get(groupId);
  if (!pg) return;

  const purchases = db.prepare('SELECT * FROM purchases WHERE project_id = ? AND joined_group = 0').all(pg.project_id);
  for (const p of purchases) {
    if (!p.buyer_phone) continue;
    const phone = normalizePhone(p.buyer_phone);
    // Check in all groups of the project
    const projectGroups = db.prepare('SELECT group_id FROM project_groups WHERE project_id = ?').all(pg.project_id);
    for (const grp of projectGroups) {
      const member = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND phone LIKE ?').get(grp.group_id, `%${phone}%`);
      if (member) {
        db.prepare('UPDATE purchases SET joined_group = 1, joined_date = CURRENT_TIMESTAMP WHERE id = ?').run(p.id);
        break;
      }
    }
  }
}

// ========== PROJECTS API ==========
app.get('/api/projects', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, 
      (SELECT COUNT(*) FROM purchases WHERE project_id = p.id AND status = 'approved') as total_purchases,
      (SELECT COUNT(*) FROM purchases WHERE project_id = p.id AND joined_group = 1) as joined_count,
      (SELECT COUNT(*) FROM purchases WHERE project_id = p.id AND joined_group = 0) as not_joined_count
    FROM projects p ORDER BY created_at DESC
  `).all();

  // Add groups to each project
  for (const p of projects) {
    p.groups = db.prepare('SELECT * FROM project_groups WHERE project_id = ?').all(p.id);
  }

  res.json(projects);
});

app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });
  project.groups = db.prepare('SELECT * FROM project_groups WHERE project_id = ?').all(project.id);
  res.json(project);
});

// Debug endpoint - verificar grupos do projeto
app.get('/api/projects/:id/debug', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  const projectGroups = db.prepare('SELECT * FROM project_groups WHERE project_id = ?').all(project.id);

  // Buscar grupos do WhatsApp
  let whatsappGroups = [];
  if (sock && connectionState === 'connected') {
    try {
      const groups = await sock.groupFetchAllParticipating();
      whatsappGroups = Object.values(groups).map(g => ({
        id: g.id,
        name: g.subject,
        participantsCount: g.participants?.length || 0
      }));
    } catch (e) {
      whatsappGroups = [{ error: e.message }];
    }
  }

  // Verificar correspondência
  const comparison = projectGroups.map(pg => {
    const waGroup = whatsappGroups.find(w => w.id === pg.group_id);
    return {
      stored_group_id: pg.group_id,
      stored_group_name: pg.group_name,
      whatsapp_match: waGroup ? 'ENCONTRADO' : 'NÃO ENCONTRADO',
      whatsapp_name: waGroup?.name || 'N/A',
      whatsapp_participants: waGroup?.participantsCount || 0
    };
  });

  res.json({
    project: { id: project.id, name: project.name },
    projectGroups: projectGroups,
    whatsappGroupsTotal: whatsappGroups.length,
    whatsappGroups: whatsappGroups.slice(0, 10), // Primeiros 10 grupos
    comparison: comparison
  });
});

app.post('/api/projects', (req, res) => {
  const { name, groups } = req.body; // groups is array of {group_id, group_name}
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });

  const slug = generateSlug(name);
  try {
    const result = db.prepare('INSERT INTO projects (name, slug) VALUES (?, ?)').run(name, slug);
    const projectId = result.lastInsertRowid;

    // Insert groups
    if (groups && groups.length) {
      const insertGroup = db.prepare('INSERT INTO project_groups (project_id, group_id, group_name) VALUES (?, ?, ?)');
      for (const g of groups) {
        insertGroup.run(projectId, g.group_id, g.group_name);
      }
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    project.groups = db.prepare('SELECT * FROM project_groups WHERE project_id = ?').all(projectId);
    res.json({ success: true, project, webhookUrl: `/webhook/${slug}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  const { name, groups } = req.body;
  const projectId = req.params.id;

  if (name) {
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, projectId);
  }

  // Update groups (delete and re-insert)
  if (groups) {
    db.prepare('DELETE FROM project_groups WHERE project_id = ?').run(projectId);
    const insertGroup = db.prepare('INSERT INTO project_groups (project_id, group_id, group_name) VALUES (?, ?, ?)');
    for (const g of groups) {
      insertGroup.run(projectId, g.group_id, g.group_name);
    }
  }

  res.json({ success: true });
});

// Add groups to project
app.post('/api/projects/:id/groups', (req, res) => {
  const { group_id, group_name } = req.body;
  const projectId = req.params.id;

  // Check if already exists
  const exists = db.prepare('SELECT * FROM project_groups WHERE project_id = ? AND group_id = ?').get(projectId, group_id);
  if (exists) {
    return res.status(400).json({ error: 'Grupo já adicionado' });
  }

  db.prepare('INSERT INTO project_groups (project_id, group_id, group_name) VALUES (?, ?, ?)').run(projectId, group_id, group_name);
  res.json({ success: true });
});

// Remove group from project
app.delete('/api/projects/:id/groups/:groupId', (req, res) => {
  db.prepare('DELETE FROM project_groups WHERE project_id = ? AND group_id = ?').run(req.params.id, req.params.groupId);
  res.json({ success: true });
});

app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM purchases WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM project_groups WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ========== WEBHOOK HOTMART (POR PROJETO) ==========
app.post('/webhook/:projectSlug', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(req.params.projectSlug);
  if (!project) {
    console.log(`❌ Webhook recebido para projeto inexistente: ${req.params.projectSlug}`);
    return res.status(404).json({ error: 'Projeto não encontrado' });
  }

  try {
    const data = req.body;
    const eventType = data.event || 'PURCHASE_APPROVED';

    console.log(`\n📥 Webhook ${project.name} [${eventType}]:`);
    console.log(JSON.stringify(data, null, 2));

    // Salvar log do webhook
    db.prepare(`INSERT INTO webhook_logs (project_id, event_type, payload) VALUES (?, ?, ?)`).run(
      project.id,
      eventType,
      JSON.stringify(data)
    );

    // Extrair dados do comprador (suporta múltiplos formatos da Hotmart)
    const buyer = data.buyer || data.data?.buyer || {};
    const product = data.product || data.data?.product || {};
    const purchase = data.purchase || data.data?.purchase || {};
    const transaction = data.transaction || purchase.transaction || data.data?.purchase?.transaction || `HM_${Date.now()}`;

    // Tentar extrair telefone de várias fontes
    const rawPhone = buyer.phone || buyer.cellphone || buyer.checkout_phone ||
      data.data?.buyer?.phone || data.data?.buyer?.checkout_phone || '';
    const phone = normalizePhone(rawPhone);

    // Verificar se já existe essa transação
    const existingPurchase = db.prepare('SELECT * FROM purchases WHERE transaction_id = ?').get(transaction);
    if (existingPurchase) {
      console.log(`⚠️ Transação já registrada: ${transaction}`);
      return res.json({ success: true, message: 'Transação já registrada' });
    }

    // Inserir nova compra
    db.prepare(`
      INSERT INTO purchases (project_id, transaction_id, buyer_name, buyer_email, buyer_phone, product_name, price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')
    `).run(
      project.id,
      transaction,
      buyer.name || data.data?.buyer?.name || 'Desconhecido',
      buyer.email || data.data?.buyer?.email || '',
      phone,
      product.name || data.data?.product?.name || 'Produto',
      purchase.price?.value || data.data?.purchase?.price?.value || 0
    );

    // Verificar se o comprador já está em algum grupo do projeto
    if (phone) {
      const projectGroups = db.prepare('SELECT group_id FROM project_groups WHERE project_id = ?').all(project.id);
      for (const grp of projectGroups) {
        const member = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND phone LIKE ?').get(grp.group_id, `%${phone}%`);
        if (member) {
          db.prepare('UPDATE purchases SET joined_group = 1, joined_date = CURRENT_TIMESTAMP WHERE transaction_id = ?').run(transaction);
          console.log(`✅ Comprador já está no grupo ${grp.group_id}`);
          break;
        }
      }
    }

    console.log(`✅ Venda registrada: ${buyer.name || 'N/A'} - ${product.name || 'N/A'} - ${phone || 'Sem telefone'}`);
    res.json({ success: true, message: 'Compra registrada com sucesso' });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Salvar log de erro
    db.prepare(`INSERT INTO webhook_logs (project_id, event_type, payload, status) VALUES (?, ?, ?, ?)`).run(
      project.id,
      'ERROR',
      JSON.stringify({ error: error.message, body: req.body }),
      'error'
    );
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para buscar logs de webhook
app.get('/api/projects/:projectId/webhook-logs', (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM webhook_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.params.projectId);
  res.json(logs);
});

// Endpoint para testar webhook manualmente
app.post('/api/projects/:projectId/test-webhook', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  const testData = {
    event: 'PURCHASE_APPROVED',
    buyer: {
      name: req.body.name || 'Comprador Teste',
      email: req.body.email || 'teste@email.com',
      phone: req.body.phone || '5562999999999'
    },
    product: {
      name: req.body.product || 'Produto Teste'
    },
    purchase: {
      transaction: `TEST_${Date.now()}`,
      price: { value: req.body.price || 97.00 }
    }
  };

  // Simular chamada ao webhook
  const url = `${req.protocol}://${req.get('host')}/webhook/${project.slug}`;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testData)
  }).then(r => r.json())
    .then(result => {
      res.json({ success: true, testData, result, webhookUrl: url });
    })
    .catch(err => {
      res.status(500).json({ error: err.message });
    });
});

// Limpar logs antigos
app.delete('/api/projects/:projectId/webhook-logs', (req, res) => {
  db.prepare('DELETE FROM webhook_logs WHERE project_id = ?').run(req.params.projectId);
  res.json({ success: true });
});

// ========== PURCHASES API ==========
app.get('/api/projects/:projectId/stats', (req, res) => {
  const { startDate, endDate } = req.query;
  const id = req.params.projectId;

  let dateFilter = '';
  if (startDate) dateFilter += ` AND purchase_date >= '${startDate}'`;
  if (endDate) dateFilter += ` AND purchase_date <= '${endDate} 23:59:59'`;

  const total = db.prepare(`SELECT COUNT(*) as c FROM purchases WHERE project_id = ? AND status = 'approved' ${dateFilter}`).get(id)?.c || 0;
  const joined = db.prepare(`SELECT COUNT(*) as c FROM purchases WHERE project_id = ? AND joined_group = 1 ${dateFilter}`).get(id)?.c || 0;
  const notJoined = total - joined;
  const rate = total > 0 ? ((joined / total) * 100).toFixed(1) : 0;

  const today = new Date().toISOString().split('T')[0];
  const todayTotal = db.prepare(`SELECT COUNT(*) as c FROM purchases WHERE project_id = ? AND DATE(purchase_date) = DATE(?)`).get(id, today)?.c || 0;
  const todayJoined = db.prepare(`SELECT COUNT(*) as c FROM purchases WHERE project_id = ? AND joined_group = 1 AND DATE(purchase_date) = DATE(?)`).get(id, today)?.c || 0;

  res.json({ total, joined, notJoined, rate, todayTotal, todayJoined, todayNotJoined: todayTotal - todayJoined });
});

app.get('/api/projects/:projectId/purchases', (req, res) => {
  const { joined, page = 1, limit = 50 } = req.query;
  let where = 'WHERE project_id = ?';
  const params = [req.params.projectId];

  if (joined !== undefined && joined !== '') {
    where += ' AND joined_group = ?';
    params.push(Number(joined));
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM purchases ${where}`).get(...params)?.c || 0;
  const purchases = db.prepare(`SELECT * FROM purchases ${where} ORDER BY purchase_date DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), (Number(page) - 1) * Number(limit));

  res.json({ purchases, total, totalPages: Math.ceil(total / Number(limit)) });
});

app.post('/api/projects/:projectId/purchases', (req, res) => {
  const { buyer_name, buyer_phone, buyer_email, product_name } = req.body;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  const phone = normalizePhone(buyer_phone);
  db.prepare(`INSERT INTO purchases (project_id, transaction_id, buyer_name, buyer_email, buyer_phone, product_name, status) VALUES (?, ?, ?, ?, ?, ?, 'approved')`)
    .run(project.id, `MANUAL_${Date.now()}`, buyer_name, buyer_email, phone, product_name || 'Manual');

  // Check in all project groups
  if (phone) {
    const projectGroups = db.prepare('SELECT group_id FROM project_groups WHERE project_id = ?').all(project.id);
    for (const grp of projectGroups) {
      const member = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND phone LIKE ?').get(grp.group_id, `%${phone}%`);
      if (member) {
        db.prepare('UPDATE purchases SET joined_group = 1, joined_date = CURRENT_TIMESTAMP WHERE buyer_phone = ? AND project_id = ?').run(phone, project.id);
        break;
      }
    }
  }

  res.json({ success: true });
});

// Import CSV
app.post('/api/projects/:projectId/import', (req, res) => {
  const { data } = req.body; // Array of {name, phone, email, product}
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  const projectGroups = db.prepare('SELECT group_id FROM project_groups WHERE project_id = ?').all(project.id);
  let imported = 0;
  let updated = 0;

  const insertStmt = db.prepare(`INSERT INTO purchases (project_id, transaction_id, buyer_name, buyer_email, buyer_phone, product_name, status, joined_group, joined_date) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)`);

  for (const row of data) {
    if (!row.name && !row.phone) continue;

    const phone = normalizePhone(row.phone || '');

    // Check if already in any group
    let inGroup = 0;
    let joinedDate = null;
    if (phone) {
      for (const grp of projectGroups) {
        const member = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND phone LIKE ?').get(grp.group_id, `%${phone}%`);
        if (member) {
          inGroup = 1;
          joinedDate = new Date().toISOString();
          break;
        }
      }
    }

    insertStmt.run(
      project.id,
      `IMPORT_${Date.now()}_${imported}`,
      row.name || 'Sem nome',
      row.email || '',
      phone,
      row.product || 'Importado',
      inGroup,
      joinedDate
    );

    if (inGroup) updated++;
    imported++;
  }

  res.json({ success: true, imported, alreadyInGroup: updated });
});

app.post('/api/projects/:projectId/sync', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  const projectGroups = db.prepare('SELECT * FROM project_groups WHERE project_id = ?').all(req.params.projectId);

  if (!projectGroups.length) return res.status(400).json({ error: 'Nenhum grupo configurado' });
  if (!sock || connectionState !== 'connected') return res.status(400).json({ error: 'WhatsApp não conectado' });

  try {
    let totalMembers = 0;
    let totalReal = 0;
    let totalLid = 0;
    const groupsData = [];

    // Sync all groups
    for (const pg of projectGroups) {
      console.log(`\n📱 Sincronizando grupo: ${pg.group_name} (${pg.group_id})`);

      const metadata = await sock.groupMetadata(pg.group_id);

      console.log(`   Nome do grupo: ${metadata.subject}`);
      console.log(`   Participantes encontrados: ${metadata.participants?.length || 0}`);

      // Log primeiro participante para ver estrutura
      if (metadata.participants && metadata.participants.length > 0) {
        console.log('   Estrutura do primeiro participante:', JSON.stringify(metadata.participants[0], null, 2));
      }

      const members = metadata.participants.map(p => {
        // O ID pode ser um LID (número longo) ou um número de telefone real
        const rawId = p.id.split('@')[0];
        const idType = p.id.includes('@lid') ? 'LID' : 'PHONE';

        // Tenta pegar o número real de várias fontes possíveis
        let phone = '';

        if (p.phoneNumber) {
          phone = p.phoneNumber.replace(/\D/g, '');
        } else if (idType === 'PHONE') {
          phone = rawId;
        } else {
          // É um LID - mostra como está (sem prefixo LID: para não confundir)
          phone = rawId;
        }

        return {
          phone: phone,
          rawPhone: rawId,
          idType: idType,
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          notify: p.notify || ''
        };
      });

      // Contar tipos
      const realMembers = members.filter(m => m.idType === 'PHONE');
      const lidMembers = members.filter(m => m.idType === 'LID');

      console.log(`   Membros com número real: ${realMembers.length}`);
      console.log(`   Membros com LID: ${lidMembers.length}`);

      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(pg.group_id);
      const insert = db.prepare('INSERT INTO group_members (group_id, phone, name) VALUES (?, ?, ?)');
      for (const m of members) {
        // Salva todos os membros, incluindo LIDs
        insert.run(pg.group_id, m.phone, m.notify || m.phone);
      }

      totalMembers += members.length;
      totalReal += realMembers.length;
      totalLid += lidMembers.length;

      groupsData.push({
        group_id: pg.group_id,
        group_name: pg.group_name || metadata.subject,
        members: members // TODOS os membros
      });

      console.log(`   ✅ ${members.length} membros sincronizados para ${pg.group_name}`);
    }

    // Consolidar membros únicos de todos os grupos (remover duplicatas)
    const allMembersMap = new Map();
    for (const group of groupsData) {
      for (const member of group.members) {
        const key = member.phone;
        if (allMembersMap.has(key)) {
          // Já existe - atualiza info
          const existing = allMembersMap.get(key);
          existing.groups.push(group.group_name);
          if (member.isAdmin) existing.isAdmin = true; // Se for admin em qualquer grupo
        } else {
          // Novo membro
          allMembersMap.set(key, {
            phone: member.phone,
            rawPhone: member.rawPhone,
            idType: member.idType,
            isAdmin: member.isAdmin,
            notify: member.notify,
            groups: [group.group_name]
          });
        }
      }
    }

    // Converter map para array de membros únicos
    const uniqueMembers = Array.from(allMembersMap.values());
    console.log(`   📊 Total de membros únicos: ${uniqueMembers.length}`);

    // Update purchases for all groups
    for (const pg of projectGroups) {
      updateProjectPurchases(pg.group_id);
    }

    console.log(`\n✅ Sincronização completa: ${uniqueMembers.length} membros únicos em ${projectGroups.length} grupos\n`);
    res.json({
      success: true,
      memberCount: uniqueMembers.length,
      totalWithDuplicates: totalMembers,
      groupsCount: projectGroups.length,
      groups: groupsData,
      uniqueMembers: uniqueMembers // Lista consolidada sem duplicatas
    });
  } catch (error) {
    console.error('❌ Erro na sincronização:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== EXPORT ==========
app.get('/api/projects/:projectId/export', (req, res) => {
  const purchases = db.prepare('SELECT * FROM purchases WHERE project_id = ? ORDER BY purchase_date DESC').all(req.params.projectId);

  let csv = 'Nome,Email,Telefone,Produto,Data,Entrou no Grupo\n';
  for (const p of purchases) {
    csv += `"${p.buyer_name}","${p.buyer_email}","${p.buyer_phone}","${p.product_name}","${p.purchase_date}","${p.joined_group ? 'Sim' : 'Não'}"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=export.csv');
  res.send(csv);
});

app.get('/api/whatsapp/groups/:groupId/export', (req, res) => {
  const members = db.prepare('SELECT * FROM group_members WHERE group_id = ?').all(req.params.groupId);

  let csv = 'Telefone,Nome\n';
  for (const m of members) {
    csv += `"${m.phone}","${m.name}"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=group_members.csv');
  res.send(csv);
});

// Self-ping para manter o Render acordado (evita sleep após 15min)
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

  setInterval(async () => {
    try {
      const response = await fetch(`${url}/api/whatsapp/status`);
      console.log(`🏓 Keep-alive ping: ${response.status}`);
    } catch (error) {
      console.log('🏓 Keep-alive ping falhou (normal em localhost)');
    }
  }, 5 * 60 * 1000); // A cada 5 minutos
}

// Start
app.listen(PORT, () => {
  console.log(`
  🚀 Redirect+ Clone iniciado!
  
  📊 Dashboard: http://localhost:${PORT}
  📱 WhatsApp: Iniciando conexão automática...
  
  Crie projetos e configure webhooks por projeto!
  `);

  // Iniciar conexão do WhatsApp automaticamente
  connectWhatsApp();

  // Iniciar keep-alive para Render
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log('🏓 Keep-alive ativado para Render');
    keepAlive();
  }
});
