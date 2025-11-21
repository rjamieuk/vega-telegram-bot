import dotenv from 'dotenv';
import { VegaBot } from './bot.js';
import express from 'express';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

// Validação: se não tiver token, não inicia
if (!token) {
  console.error('❌ Erro: TELEGRAM_BOT_TOKEN não encontrado nas variáveis de ambiente.');
  console.error('Configure a variável de ambiente antes de iniciar o bot.');
  process.exit(1);
}

const bot = new VegaBot(token);

console.log('🤖 Vega Monitor Bot iniciado!');
console.log('📨 Aguardando comandos...');

// Servidor HTTP para manter ativo no Render
const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
});

// Ping interno a cada 10 minutos (600000ms) para manter o serviço ativo
setInterval(() => {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`🏓 Keep-alive ping - ${now}`);
}, 600000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Encerrando bot...');
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Encerrando bot...');
  bot.stop();
  process.exit(0);
});