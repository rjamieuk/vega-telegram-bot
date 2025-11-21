import dotenv from 'dotenv';
import express from 'express';
import { VegaBot } from './bot.js';

console.log('🟡 Iniciando Vega Monitor Bot...');

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

// Validação: se não tiver token, não inicia
if (!token) {
  console.error('❌ Erro: TELEGRAM_BOT_TOKEN não encontrado nas variáveis de ambiente.');
  console.error('Configure a variável de ambiente antes de iniciar o bot.');
  process.exit(1);
}

// ========================================
// 1. SERVIDOR HTTP (sobe PRIMEIRO)
// ========================================
const app = express();

app.get('/', (req, res) => {
  res.send('🤖 Vega Bot está online!');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    message: 'Vega Monitor Bot rodando'
  });
});

// Inicia o servidor HTTP ANTES do bot
app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
  console.log(`✅ Render detectou a porta com sucesso`);
});

// ========================================
// 2. BOT DO TELEGRAM (inicia DEPOIS)
// ========================================
const bot = new VegaBot(token);

console.log('🤖 Vega Monitor Bot iniciado!');
console.log('📨 Aguardando comandos...');

// ========================================
// 3. KEEP-ALIVE PING (a cada 10 minutos)
// ========================================
setInterval(() => {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`🏓 Keep-alive ping - ${now}`);
}, 600000);

// ========================================
// 4. GRACEFUL SHUTDOWN
// ========================================
process.on('SIGINT', () => {
  console.log('\n🛑 Encerrando bot (SIGINT)...');
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Encerrando bot (SIGTERM)...');
  bot.stop();
  process.exit(0);
});