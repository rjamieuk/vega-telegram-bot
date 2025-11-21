import dotenv from 'dotenv';
import { VegaBot } from './bot.js';

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