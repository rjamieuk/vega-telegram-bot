import dotenv from 'dotenv';
import { VegaBot } from './bot.js';

dotenv.config();

const bot = new VegaBot(process.env.TELEGRAM_BOT_TOKEN);

console.log('🤖 Vega Monitor Bot iniciado!');
console.log('📊 Aguardando comandos...');

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