import { DerivClient } from './derivClient.js';

export class SessionManager {
  constructor(bot, userStore) {
    this.bot = bot;
    this.userStore = userStore;
    this.sessions = new Map();
    this.searchingMessages = new Map();
  }

  hasActiveSession(chatId) {
    return this.sessions.has(chatId);
  }

  async startSession(chatId) {
    const user = this.userStore.getUser(chatId);
  
    // ✅ CORRIGIDO: usar "token" ao invés de "derivToken"
    if (!user || !user.token) {
      this.bot.sendMessage(chatId, '❌ Configuração incompleta. Use /config');
      return;
    }

    const strategyMode = user.strategyMode || 'standard';

    // ========== ESTRATÉGIA PADRÃO ==========
    if (strategyMode === 'standard') {
      if (!user.goalPercentage) {
        this.bot.sendMessage(chatId, '❌ Você precisa configurar sua meta %.\nUse /config');
        return;
      }

      const maxLosses = user.maxLosses ?? 6;
      const maxGlobalLoss = user.maxGlobalLoss ?? null;
      const useDigitDifferStrategy = user.useDigitDifferStrategy ?? false;
      const useUnderOverStrategy = user.useUnderOverStrategy ?? false;
      const useMartingaleEvenOdd = user.useMartingaleEvenOdd !== false;

      const client = new DerivClient(
        user.token,  // ✅ CORRIGIDO
        user.goalPercentage,
        maxLosses,
        chatId,
        this.bot,
        useDigitDifferStrategy,
        useUnderOverStrategy,
        useMartingaleEvenOdd,
        maxGlobalLoss,
        this,
        { mode: 'standard' }
      );

      this.sessions.set(chatId, client);

      const riskMap = { 1: 0.5, 2: 1.5, 3: 3.5, 4: 7.5, 5: 15.5, 6: 31.0 };
      const risk = riskMap[maxLosses] ?? 31.0;

      const globalLossText = maxGlobalLoss ? `\n🚨 Max Loss Global: ${maxGlobalLoss}%` : '';

      this.bot.sendMessage(chatId, `
🚀 *Sessão Iniciada (Default)!*

🎯 Meta: ${user.goalPercentage}%
❌ Máx. Loss: ${maxLosses} (Risco ~ ${risk}%)${globalLossText}
🔄 Martingale: ${useMartingaleEvenOdd ? '✅ Ativo' : '❌ Inativo'}
🧠 Digit Differs: ${useDigitDifferStrategy ? '✅ Ativo' : '❌ Inativo'}
📉 Under/Over: ${useUnderOverStrategy ? '✅ Ativo' : '❌ Inativo'}

Use /status para acompanhar
Use /stop para encerrar
      `, { parse_mode: 'Markdown' });

      try {
        await client.connect();
        this.startSearchingAnimation(chatId);
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Erro ao conectar: ${error.message}`);
        this.sessions.delete(chatId);
      }
      return;
    }

    // ========== ESTRATÉGIA PPCP ==========
    if (strategyMode === 'ppcp') {
      // ✅ CORRIGIDO: usar os campos corretos do userStore
      const goal = user.goalPercentage;  // PPCP usa o mesmo campo goalPercentage
      const maxGlobalLoss = user.maxGlobalLoss ?? null;
      const initialStake = user.ppcpInitialStake;
      const direction = user.ppcpDirection;

      // ✅ Validação completa
      if (!goal || !initialStake || !direction) {
        this.bot.sendMessage(chatId,
          '❌ Configuração PPCP incompleta.\n\n' +
          'Certifique-se de configurar:\n' +
          '• Meta de Lucro\n' +
          '• Stake Inicial\n' +
          '• Direção (A Favor ou Contra)\n\n' +
          'Use /config para ajustar.'
        );
        return;
      }

      const client = new DerivClient(
        user.token,  // ✅ CORRIGIDO
        goal,
        null,
        chatId,
        this.bot,
        false,
        false,
        false,
        maxGlobalLoss,
        this,
        {
          mode: 'ppcp',
          ppcpInitialStake: initialStake,
          ppcpDirection: direction
        }
      );

      this.sessions.set(chatId, client);

      const globalLossText = maxGlobalLoss
        ? `\n🚨 Max Loss Global: -${Math.abs(maxGlobalLoss)}%`
        : '';

      const directionLabel = direction === 'favor' ? 'A Favor' : 'Contra';

      this.bot.sendMessage(chatId, `
🚀 *Sessão Iniciada (PPCP)!*

🎯 Meta: ${goal}%
💵 Stake Inicial: ${initialStake.toFixed(2)} USD
🎲 Direção: ${directionLabel}${globalLossText}

📌 Sistema de recuperação inteligente ativo.

Use /status para acompanhar
Use /stop para encerrar
      `, { parse_mode: 'Markdown' });

      try {
        await client.connect();
        this.startSearchingAnimation(chatId);
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Erro ao conectar: ${error.message}`);
        this.sessions.delete(chatId);
      }
      return;
    }
  }

  startSearchingAnimation(chatId) {
    const emojis = ['🔍', '🔎', '👀', '🎯'];
    let index = 0;

    const sendSearching = async () => {
      try {
        const msg = await this.bot.sendMessage(
          chatId,
          `${emojis[index]} *Buscando Oportunidade...*`,
          { parse_mode: 'Markdown' }
        );
        
        this.searchingMessages.set(chatId, { messageId: msg.message_id, intervalId: null });
        
        const intervalId = setInterval(async () => {
          if (!this.sessions.has(chatId)) {
            clearInterval(intervalId);
            this.searchingMessages.delete(chatId);
            return;
          }

          const client = this.sessions.get(chatId);
          if (client && (client.tradingState.isActive || client.digitDifferState?.isActive || client.underOverState?.isActive)) {
            clearInterval(intervalId);
            try {
              await this.bot.deleteMessage(chatId, msg.message_id);
            } catch (e) {
              // Mensagem já pode ter sido deletada
            }
            this.searchingMessages.delete(chatId);
            return;
          }

          index = (index + 1) % emojis.length;
          try {
            await this.bot.editMessageText(
              `${emojis[index]} *Buscando Oportunidade...*`,
              {
                chat_id: chatId,
                message_id: msg.message_id,
                parse_mode: 'Markdown'
              }
            );
          } catch (e) {
            // Ignora erros de edição
          }
        }, 2000);

        const searchData = this.searchingMessages.get(chatId);
        if (searchData) {
          searchData.intervalId = intervalId;
        }
      } catch (error) {
        console.error(`[${chatId}] Erro ao enviar mensagem de busca:`, error);
      }
    };

    sendSearching();
  }

  stopSearchingAnimation(chatId) {
    const searchData = this.searchingMessages.get(chatId);
    if (searchData) {
      if (searchData.intervalId) {
        clearInterval(searchData.intervalId);
      }
      try {
        this.bot.deleteMessage(chatId, searchData.messageId);
      } catch (e) {
        // Ignora se já foi deletada
      }
      this.searchingMessages.delete(chatId);
    }
  }

  stopSession(chatId) {
    const client = this.sessions.get(chatId);
    if (client) {
      client.disconnect();
      this.sessions.delete(chatId);
    }
    this.stopSearchingAnimation(chatId);
  }

  getStatus(chatId) {
    const client = this.sessions.get(chatId);
    if (!client) return null;
    return client.getStatus();
  }

  stopAll() {
    for (const [chatId, client] of this.sessions) {
      client.disconnect();
      this.stopSearchingAnimation(chatId);
    }
    this.sessions.clear();
  }

  notifyIdle(chatId) {
    if (!this.sessions.has(chatId)) return;
    if (this.searchingMessages.has(chatId)) return;
    this.startSearchingAnimation(chatId);
  }
}