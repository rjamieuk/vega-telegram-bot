import { DerivClient } from './derivClient.js';

export class SessionManager {
  constructor(bot, userStore) {
    this.bot = bot;
    this.userStore = userStore;
    this.sessions = new Map();
    this.searchingMessages = new Map(); // chatId -> { messageId, intervalId, lastEditAt }
  }

  hasActiveSession(chatId) {
    return this.sessions.has(chatId);
  }

  async startSession(chatId) {
    const user = this.userStore.getUser(chatId);

    if (!user || !user.token) {
      this.bot.sendMessage(chatId, '❌ Configuração incompleta. Use /config');
      return;
    }

    const strategyMode = user.strategyMode || 'standard';

    // ========== ESTRATÉGIA PADRÃO ==========
    if (strategyMode === 'standard') {
      if (!user.goalPercentage) {
        this.bot.sendMessage(
          chatId,
          '❌ Você precisa configurar sua meta %.\nUse /config'
        );
        return;
      }

      const maxLosses = user.maxLosses ?? 6;
      const maxGlobalLoss = user.maxGlobalLoss ?? null;
      const useDigitDifferStrategy = user.useDigitDifferStrategy ?? false;
      const useUnderOverStrategy = user.useUnderOverStrategy ?? false;
      const useMartingaleEvenOdd = user.useMartingaleEvenOdd !== false;

      const client = new DerivClient(
        user.token,
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

      const globalLossText = maxGlobalLoss
        ? `\n🚨 Max Loss Global: ${maxGlobalLoss}%`
        : '';

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
      const goal = user.goalPercentage;
      const maxGlobalLoss = user.maxGlobalLoss ?? null;
      const initialStake = user.ppcpInitialStake;
      const direction = user.ppcpDirection;

      if (!goal || !initialStake || !direction) {
        this.bot.sendMessage(
          chatId,
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
        user.token,
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

    // ========== ESTRATÉGIA DIGITHUNTER ==========
    if (strategyMode === 'digithunter') {
      const goal = user.goalPercentage;
      const maxGlobalLoss = user.maxGlobalLoss ?? null;
      const initialStake = user.digitHunterInitialStake;

      if (!goal || !initialStake) {
        this.bot.sendMessage(
          chatId,
          '❌ Configuração DigitHunter incompleta.\n\n' +
          'Certifique-se de configurar:\n' +
          '• Meta de Lucro\n' +
          '• Stake Inicial\n\n' +
          'Use /config para ajustar.'
        );
        return;
      }

      const client = new DerivClient(
        user.token,
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
          mode: 'digithunter',
          digitHunterInitialStake: initialStake
        }
      );

      this.sessions.set(chatId, client);

      const globalLossText = maxGlobalLoss
        ? `\n🚨 Max Loss Global: -${Math.abs(maxGlobalLoss)}%`
        : '';

      this.bot.sendMessage(chatId, `
🚀 *Sessão Iniciada (DigitHunter)!*

🎯 Meta: ${goal}%
💵 Stake Inicial: ${initialStake.toFixed(2)} USD${globalLossText}

📌 Estratégia DigitHunter:
• Detecta melhores momentos de acúmulo
• Entra com DIGITMATCH seguindo o estudo
• Em caso de loss, recupera com fator 1.12x até acertar
• Ao acertar, encerra sessão e volta stake ao inicial.

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

    // ========== ESTRATÉGIA HARDTEST ==========
    if (strategyMode === 'hardtest') {
      const maxGlobalLoss = user.maxGlobalLoss ?? null;

      const client = new DerivClient(
        user.token,
        10,
        null,
        chatId,
        this.bot,
        false,
        false,
        false,
        maxGlobalLoss,
        this,
        { mode: 'hardtest' }
      );

      this.sessions.set(chatId, client);

      const globalLossText = maxGlobalLoss
        ? `\n🚨 Max Loss Global: -${Math.abs(maxGlobalLoss)}%`
        : '';

      this.bot.sendMessage(chatId, `
🚀 *Sessão Iniciada (HardTest)!*

📌 Estratégia HardTest:
• Usa DIGITMATCH com dígito aleatório (0–9) a cada entrada
• Stake = 0.5% do saldo (mínimo 0.35 USD, arredondado com 2 casas decimais)
• Fator de recuperação: 1.13x em caso de loss
• Meta do ciclo: lucro > 10% sobre o saldo do início do ciclo
• Ao atingir meta: inicia novo ciclo automaticamente com recálculo de stake
• Após 20 perdas consecutivas: inicia novo ciclo automaticamente
• O bot só para quando você digitar /stop ou atingir Max Loss Global

${globalLossText}

Use /status para acompanhar
Use /stop para encerrar totalmente
      `, { parse_mode: 'Markdown' });

      try {
        await client.connect();
        // HardTest NÃO tem animação de busca
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Erro ao conectar: ${error.message}`);
        this.sessions.delete(chatId);
      }
      return;
    }
  }

  startSearchingAnimation(chatId) {
    // Se já existe animação rodando, não cria outra
    if (this.searchingMessages.has(chatId)) {
      return;
    }

    // Se a estratégia for HardTest, não cria animação
    const client = this.sessions.get(chatId);
    if (client && client.strategyMode === 'hardtest') {
      return;
    }

    const emojis = ['🔍', '🔎', '👀', '🎯'];
    let index = 0;

    const sendSearching = async () => {
      try {
        const msg = await this.bot.sendMessage(
          chatId,
          `${emojis[index]} *Buscando Oportunidade...*`,
          { parse_mode: 'Markdown' }
        );

        this.searchingMessages.set(chatId, {
          messageId: msg.message_id,
          intervalId: null,
          lastEditAt: Date.now()
        });

        // Intervalo de 10s em vez de 2s para reduzir carga
        const intervalId = setInterval(async () => {
          if (!this.sessions.has(chatId)) {
            clearInterval(intervalId);
            this.searchingMessages.delete(chatId);
            return;
          }

          const client = this.sessions.get(chatId);
          if (client && (
            client.tradingState.isActive ||
            client.digitDifferState?.isActive ||
            client.underOverState?.isActive ||
            client.digitHunterTradeState?.isActive ||
            client.hardTestState?.trade?.isActive
          )) {
            clearInterval(intervalId);
            try {
              await this.bot.deleteMessage(chatId, msg.message_id);
            } catch (e) {
              // mensagem já pode ter sido deletada
            }
            this.searchingMessages.delete(chatId);
            return;
          }

          const searchData = this.searchingMessages.get(chatId);
          if (!searchData) {
            clearInterval(intervalId);
            return;
          }

          // Só edita se passou pelo menos 10s desde a última edição
          const now = Date.now();
          if (now - searchData.lastEditAt < 10000) {
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
            searchData.lastEditAt = now;
          } catch (e) {
            // ignora erros de edição (ex: mensagem não mudou)
          }
        }, 10000); // 10 segundos

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
    for (const [id, client] of this.sessions) {
      client.disconnect();
      this.stopSearchingAnimation(id);
    }
    this.sessions.clear();
  }

  notifyIdle(chatId) {
    if (!this.sessions.has(chatId)) return;

    const client = this.sessions.get(chatId);
    // HardTest não tem animação de busca
    if (client && client.strategyMode === 'hardtest') {
      return;
    }

    // Se já existe animação, não cria outra
    if (this.searchingMessages.has(chatId)) return;

    this.startSearchingAnimation(chatId);
  }
}