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
  
    if (!user || !user.derivToken) {
      this.bot.sendMessage(chatId, '❌ Configuração incompleta. Use /config');
      return;
    }

    const strategyMode = user.strategyMode || 'standard';

    // Estratégia padrão (já existente)
    if (strategyMode === 'standard') {
      if (!user.goalPercentage) {
        this.bot.sendMessage(chatId, '❌ Você precisa configurar sua meta %.\nUse /config');
        return;
      }

      const maxLosses = user.maxLosses ?? 6;
      const maxGlobalLoss = user.maxGlobalLoss ?? null;
      const useDigitDifferStrategy = user.useDigitDifferStrategy ?? false;
      const useUnderOverStrategy = user.useUnderOverStrategy ?? false;
      const useMartingaleEvenOdd = user.useMartingaleEvenOdd !== false; // default true

      const client = new DerivClient(
        user.derivToken,
        user.goalPercentage,
        maxLosses,
        chatId,
        this.bot,
        useDigitDifferStrategy,
        useUnderOverStrategy,
        useMartingaleEvenOdd,
        maxGlobalLoss,
        this,
        { mode: 'standard' } // options
      );

      this.sessions.set(chatId, client);

      const riskMap = { 1: 0.5, 2: 1.5, 3: 3.5, 4: 7.5, 5: 15.5, 6: 31.0 };
      const risk = riskMap[maxLosses] ?? 31.0;

      const globalLossText = maxGlobalLoss ? `\n🚨 Max Loss Global: ${maxGlobalLoss}%` : '';

      this.bot.sendMessage(chatId, `
🚀 *Sessão Iniciada (Estratégia Padrão)!*

🎯 Meta: ${user.goalPercentage}%
❌ Máx. Loss (Even/Odd): ${maxLosses} (Risco ~ ${risk}%)${globalLossText}
🔄 Martingale Even/Odd: ${useMartingaleEvenOdd ? '✅ Ativado' : '❌ Desativado'}
🧠 Estratégia Digit Differs: ${useDigitDifferStrategy ? '✅ Ativada' : '❌ Desativada'}
📉 Estratégia Under/Over: ${useUnderOverStrategy ? '✅ Ativada' : '❌ Desativada'}
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
      return;
    }

    // Estratégia PPCP
    if (strategyMode === 'ppcp') {
      const goal = user.ppcpGoalPercentage;
      const maxGlobalLoss = user.ppcpMaxGlobalLoss ?? null;
      const initialStake = user.ppcpInitialStake;

      if (!goal || !initialStake) {
        this.bot.sendMessage(chatId,
          '❌ Configuração PPCP incompleta.\n' +
          'Use /config e ajuste:\n' +
          '- Estratégia: PPCP\n' +
          '- Meta Global PPCP %\n' +
          '- Stake Inicial PPCP'
        );
        return;
      }

      const client = new DerivClient(
        user.derivToken,
        goal,
        null, // maxLosses não é usado na PPCP
        chatId,
        this.bot,
        false, // Digit Differs desativado na PPCP
        false, // Under/Over desativado na PPCP
        false, // Martingale padrão desativado, usamos lógica própria PPCP
        maxGlobalLoss,
        this,
        {
          mode: 'ppcp',
          ppcpInitialStake: initialStake
        }
      );

      this.sessions.set(chatId, client);

      const globalLossText = maxGlobalLoss
        ? `\n🚨 Max Loss Global PPCP: -${Math.abs(maxGlobalLoss)}%`
        : '\n🚨 Max Loss Global PPCP: ❌ Desativado';

      this.bot.sendMessage(chatId, `
🚀 *Sessão Iniciada (Estratégia PPCP)!*

🎯 Meta Global PPCP: ${goal}%
💵 Stake Inicial PPCP: ${initialStake.toFixed(2)}
${globalLossText}

📌 Regras PPCP:
- Opera somente em oportunidades Even/Odd (10x repetição) como já faz hoje;
- Após *loss*, NÃO entra em sequência: aguarda nova oportunidade;
- Após cada sessão, objetivo é lucro > 0.01 USD;
- Se *perder*: próxima stake = 1.5x da stake anterior;
- Se *ganhar* e o lucro acumulado da sessão ainda < 0.01: próxima stake = 1.94x da stake anterior;
- Se lucro da sessão >= 0.01: sessão é encerrada como WIN e reseta stake para inicial.

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
      return;
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