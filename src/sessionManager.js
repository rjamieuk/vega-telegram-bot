import { DerivClient } from './derivClient.js';

export class SessionManager {
  constructor(bot, userStore) {
    this.bot = bot;
    this.userStore = userStore;
    this.sessions = new Map();
  }

  hasActiveSession(chatId) {
    return this.sessions.has(chatId);
  }

  async startSession(chatId) {
    const user = this.userStore.getUser(chatId);
    
    if (!user || !user.derivToken || !user.goalPercentage) {
      this.bot.sendMessage(chatId, '❌ Configuração incompleta. Use /config');
      return;
    }

    const maxLosses = user.maxLosses ?? 6;
    const useDigitDifferStrategy = user.useDigitDifferStrategy ?? false;

    const client = new DerivClient(
      user.derivToken,
      user.goalPercentage,
      maxLosses,
      chatId,
      this.bot,
      useDigitDifferStrategy
    );

    this.sessions.set(chatId, client);

    const riskMap = { 1: 0.5, 2: 1.5, 3: 3.5, 4: 7.5, 5: 15.5, 6: 31.0 };
    const risk = riskMap[maxLosses] ?? 31.0;

    this.bot.sendMessage(chatId, `
🚀 *Sessão Iniciada!*

🎯 Meta: ${user.goalPercentage}%
❌ Máx. Loss (Even/Odd): ${maxLosses} (Risco ~ ${risk}%)
🧠 Estratégia Digit Differs: ${useDigitDifferStrategy ? '✅ Ativada' : '❌ Desativada'}
👀 Observando oportunidades...

Use /status para acompanhar
Use /stop para encerrar
    `, { parse_mode: 'Markdown' });

    try {
      await client.connect();
    } catch (error) {
      this.bot.sendMessage(chatId, `❌ Erro ao conectar: ${error.message}`);
      this.sessions.delete(chatId);
    }
  }

  stopSession(chatId) {
    const client = this.sessions.get(chatId);
    if (client) {
      client.disconnect();
      this.sessions.delete(chatId);
    }
  }

  getStatus(chatId) {
    const client = this.sessions.get(chatId);
    if (!client) return null;
    return client.getStatus();
  }

  stopAll() {
    for (const [chatId, client] of this.sessions) {
      client.disconnect();
    }
    this.sessions.clear();
  }
}