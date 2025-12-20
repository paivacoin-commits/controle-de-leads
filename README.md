# Hotmart Group Tracker

Sistema de rastreamento de vendas com integração WhatsApp para verificar se compradores entraram nos grupos.

## 🚀 Funcionalidades

- ✅ Integração com WhatsApp via QR Code
- ✅ Webhook para receber vendas da Hotmart
- ✅ Rastreamento de entrada em grupos
- ✅ Múltiplos projetos e grupos
- ✅ Sincronização automática de membros
- ✅ Importação/Exportação CSV
- ✅ Dashboard completo

## 📋 Requisitos

- Node.js 18+
- NPM ou Yarn

## 🔧 Instalação Local

```bash
# Clonar o repositório
git clone <seu-repo>
cd hotmart-group-tracker

# Instalar dependências
npm install

# Iniciar em desenvolvimento
npm run dev

# Iniciar em produção
npm start
```

Acesse: http://localhost:3000

## 🌐 Deploy no Oracle Cloud (Free Tier)

### 1. Criar conta no Oracle Cloud
- Acesse: https://cloud.oracle.com
- Crie uma conta (Free Tier disponível)

### 2. Criar uma VM Always Free
- Vá em: Compute → Instances → Create Instance
- Shape: VM.Standard.E2.1.Micro (Always Free)
- OS: Ubuntu 22.04
- Gere ou use sua chave SSH

### 3. Conectar via SSH
```bash
ssh ubuntu@<IP-DA-VM>
```

### 4. Instalar Node.js
```bash
# Instalar NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc

# Instalar Node.js 20
nvm install 20
nvm use 20
```

### 5. Clonar e configurar o projeto
```bash
# Clonar
git clone <seu-repo> hotmart-tracker
cd hotmart-tracker

# Instalar dependências
npm install

# Instalar PM2 globalmente
npm install -g pm2
```

### 6. Iniciar com PM2
```bash
# Iniciar o servidor
pm2 start server.js --name "hotmart-tracker"

# Salvar configuração para reiniciar após reboot
pm2 save
pm2 startup
```

### 7. Configurar Firewall na Oracle Cloud
- Vá em: Networking → Virtual Cloud Networks
- Clique na sua VCN → Security Lists → Default
- Adicione regra de entrada:
  - Source: 0.0.0.0/0
  - Protocol: TCP
  - Port: 3000

### 8. Configurar Firewall no Ubuntu
```bash
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo apt install iptables-persistent
sudo netfilter-persistent save
```

### 9. Acessar o sistema
- Acesse: http://<IP-DA-VM>:3000
- Configure o webhook da Hotmart com essa URL

## 📱 Configuração do WhatsApp

1. Acesse o dashboard
2. Vá em "WhatsApp"
3. Escaneie o QR Code com seu celular
4. A conexão será mantida automaticamente

## 🔗 Configuração do Webhook Hotmart

1. Crie um projeto no dashboard
2. Copie a URL do webhook: `http://<seu-ip>:3000/webhook/<slug-do-projeto>`
3. Na Hotmart: Ferramentas → Webhooks → Criar Webhook
4. Cole a URL e selecione "Compra Aprovada"

## 🛠️ Comandos Úteis (PM2)

```bash
# Ver status
pm2 status

# Ver logs
pm2 logs hotmart-tracker

# Reiniciar
pm2 restart hotmart-tracker

# Parar
pm2 stop hotmart-tracker

# Monitorar
pm2 monit
```

## 📝 Licença

MIT
