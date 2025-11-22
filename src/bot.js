import TelegramBot from 'node-telegram-bot-api';
import { UserStore } from './userStore.js';
import { SessionManager } from './sessionManager.js';

const riskByMaxLoss = {
  1: 0.5,
  2: 1.5,
  3: 3.5,
  4: 7.5,
  5: 15.5,
  6: 31.0
};

export class VegaBot {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: true });
    this.userStore = new UserStore();
    this.sessionManager = new SessionManager(this.bot, this.userStore);
    
    this.setupCommands();
    this.setupCallbacks();
  }

  setupCommands() {
    // Comando /start
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const welcomeMessage = `
🎯 *Bem-vindo ao Vega Monitor Trading System*

Sou um robô automatizado que opera na Deriv usando:
- Estratégia de padrões Even/Odd em índices de volatilidade
- (Opcional) Estratégia Digit Differs por repetição de dígitos

*Como funcionar:*
1️⃣ Configure seu token da Deriv: /config
2️⃣ Inicie uma sessão: /session
3️⃣ Acompanhe o status: /status
4️⃣ Pare a sessão: /stop

*Comandos disponíveis:*
/config - Configurar token, meta, risco e Digit Differs
/session - Iniciar nova sessão
/status - Ver status atual
/stop - Parar sessão ativa
/help - Ajuda

⚠️ *Aviso:* Trading envolve riscos. Use apenas capital que pode perder.
      `;
      
      this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    });

    // Comando /help
    this.bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = `
📚 *Ajuda - Vega Monitor Bot*

*Comandos:*
/start - Mensagem de boas-vindas
/config - Configurar token Deriv, meta %, máx. loss e Digit Differs
/session - Iniciar sessão de trading
/status - Ver status da sessão atual
/stop - Parar sessão ativa
/help - Esta mensagem

*Como configurar:*
1. Use /config
2. Envie seu API token da Deriv
3. Defina sua meta de crescimento (%)
4. Defina o máximo de loss (1-6) para estratégia Even/Odd
5. Escolha se deseja ativar a estratégia Digit Differs

*Como operar:*
1. Use /session para iniciar
2. O bot detecta padrões automaticamente
   - Even/Odd com martingale e limite de losses
   - (Opcional) Digit Differs com 5% de stake sem gale (4 dígitos consecutivos)
3. O lucro de qualquer estratégia conta para a mesma meta
4. Para ao atingir meta ou limite de perdas da estratégia Even/Odd

*Suporte:*
Em caso de dúvidas, entre em contato com o desenvolvedor.
      `;
      
      this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    // Comando /config
    this.bot.onText(/\/config/, (msg) => {
      const chatId = msg.chat.id;
      
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
            [{ text: '🎯 Configurar Meta %', callback_data: 'config_goal' }],
            [{ text: '❌ Máx. Loss (1–6)', callback_data: 'config_max_loss' }],
            [{ text: '🔢 Estratégia Digit Differs', callback_data: 'config_digit_diff' }],
            [{ text: '📊 Ver Configuração', callback_data: 'view_config' }]
          ]
        }
      };
      
      this.bot.sendMessage(chatId, '⚙️ *Configurações*\n\nEscolha uma opção:', {
        parse_mode: 'Markdown',
        ...keyboard
      });
    });

    // Comando /session
    this.bot.onText(/\/session/, async (msg) => {
      const chatId = msg.chat.id;
      const user = this.userStore.getUser(chatId);
      
      if (!user || !user.derivToken) {
        this.bot.sendMessage(chatId, '❌ Você precisa configurar seu token primeiro.\nUse /config');
        return;
      }
      
      if (!user.goalPercentage) {
        this.bot.sendMessage(chatId, '❌ Você precisa configurar sua meta %.\nUse /config');
        return;
      }
      
      if (this.sessionManager.hasActiveSession(chatId)) {
        this.bot.sendMessage(chatId, '⚠️ Você já tem uma sessão ativa.\nUse /stop para encerrar.');
        return;
      }
      
      await this.sessionManager.startSession(chatId);
    });

    // Comando /status
    this.bot.onText(/\/status/, (msg) => {
      const chatId = msg.chat.id;
      const status = this.sessionManager.getStatus(chatId);
      
      if (!status) {
        this.bot.sendMessage(chatId, '📊 Nenhuma sessão ativa no momento.\n\nUse /session para iniciar.');
        return;
      }
      
      const statusMessage = `
📊 *Status da Sessão*

⏱ *Tempo:* ${status.executionTime}
💰 *Saldo Inicial:* ${status.currency} ${status.initialBalance.toFixed(2)}
💵 *Saldo Atual:* ${status.currency} ${status.currentBalance.toFixed(2)}
📈 *Lucro:* ${status.currency} ${status.profit.toFixed(2)}
📊 *Crescimento:* ${status.growth.toFixed(2)}%
🎯 *Meta:* ${status.goalPercentage}%

📋 *Sessões (Even/Odd):* ${status.totalSessions}
✅ *Vitórias:* ${status.winSessions}
❌ *Derrotas:* ${status.lossSessions}
📊 *Taxa de Vitória:* ${status.winRate.toFixed(2)}%

🧠 *Digit Differs:* ${status.useDigitDifferStrategy ? '✅ Ativado' : '❌ Desativado'}
${status.isTrading ? '🔄 *Trade em andamento...*' : '👀 *Observando oportunidades...*'}
      `;
      
      this.bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
    });

    // Comando /stop
    this.bot.onText(/\/stop/, (msg) => {
      const chatId = msg.chat.id;
      
      if (!this.sessionManager.hasActiveSession(chatId)) {
        this.bot.sendMessage(chatId, '❌ Nenhuma sessão ativa para parar.');
        return;
      }
      
      this.sessionManager.stopSession(chatId);
      this.bot.sendMessage(chatId, '🛑 Sessão encerrada com sucesso!');
    });
  }

  setupCallbacks() {
    this.bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;
      
      if (data === 'config_token') {
        this.bot.sendMessage(chatId, '🔑 *Configurar Token Deriv*\n\nEnvie seu API token da Deriv:', {
          parse_mode: 'Markdown'
        });
        
        const listener = (msg) => {
          if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
            const token = msg.text.trim();
            this.userStore.setDerivToken(chatId, token);
            this.bot.sendMessage(chatId, '✅ Token configurado com sucesso!');
            this.bot.removeListener('message', listener);
          }
        };
        this.bot.on('message', listener);
      }
      
      if (data === 'config_goal') {
        this.bot.sendMessage(chatId, '🎯 *Configurar Meta de Crescimento*\n\nEnvie a meta em % (ex: 10):', {
          parse_mode: 'Markdown'
        });
        
        const listener = (msg) => {
          if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
            const goal = parseFloat(msg.text.trim());
            if (isNaN(goal) || goal <= 0) {
              this.bot.sendMessage(chatId, '❌ Meta inválida. Use um número positivo (ex: 10)');
              this.bot.removeListener('message', listener);
              return;
            }
            this.userStore.setGoalPercentage(chatId, goal);
            this.bot.sendMessage(chatId, `✅ Meta configurada para ${goal}%`);
            this.bot.removeListener('message', listener);
          }
        };
        this.bot.on('message', listener);
      }
      
      if (data === 'config_max_loss') {
        this.bot.sendMessage(chatId,
          '❌ *Máximo de Loss por Sessão (Even/Odd)*\n\n' +
          'Envie um número entre 1 e 6.\n\n' +
          '*Riscos aproximados:*\n' +
          '1 → 0.5%\n' +
          '2 → 1.5%\n' +
          '3 → 3.5%\n' +
          '4 → 7.5%\n' +
          '5 → 15.5%\n' +
          '6 → 31%',
          { parse_mode: 'Markdown' }
        );

        const listener = (msg) => {
          if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
            const val = parseInt(msg.text.trim(), 10);
            if (isNaN(val) || val < 1 || val > 6) {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Envie um número entre 1 e 6.');
              this.bot.removeListener('message', listener);
              return;
            }
            this.userStore.setMaxLosses(chatId, val);
            const risk = riskByMaxLoss[val];
            this.bot.sendMessage(
              chatId,
              `✅ Máximo de loss configurado para ${val}.\n🔔 Risco estimado por sessão: *${risk}%*.`,
              { parse_mode: 'Markdown' }
            );
            this.bot.removeListener('message', listener);
          }
        };
        this.bot.on('message', listener);
      }

      if (data === 'config_digit_diff') {
        const user = this.userStore.getUser(chatId) || {};
        const currentlyOn = !!user.useDigitDifferStrategy;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Ativar Digit Differs', callback_data: 'digit_diff_on' }],
              [{ text: '❌ Desativar Digit Differs', callback_data: 'digit_diff_off' }]
            ]
          }
        };

        this.bot.sendMessage(
          chatId,
          `🔢 *Estratégia Digit Differs*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `- Usa 5% do capital por entrada, sem gale.\n` +
          `- Opera quando os últimos 4 dígitos da sequência de 10 são iguais.\n` +
          `- O lucro conta para a mesma meta global.\n\n` +
          `Escolha uma opção:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'digit_diff_on') {
        this.userStore.setUseDigitDifferStrategy(chatId, true);
        this.bot.sendMessage(chatId, '✅ Estratégia Digit Differs *ativada*.', { parse_mode: 'Markdown' });
      }

      if (data === 'digit_diff_off') {
        this.userStore.setUseDigitDifferStrategy(chatId, false);
        this.bot.sendMessage(chatId, '❌ Estratégia Digit Differs *desativada*.', { parse_mode: 'Markdown' });
      }
      
      if (data === 'view_config') {
        const user = this.userStore.getUser(chatId);
        if (!user) {
          this.bot.sendMessage(chatId, '❌ Nenhuma configuração encontrada.\nUse /config para configurar.');
          this.bot.answerCallbackQuery(query.id);
          return;
        }
        
        const maxLosses = user.maxLosses ?? 6;
        const risk = riskByMaxLoss[maxLosses] ?? 31.0;
        const useDigitDifferStrategy = user.useDigitDifferStrategy ?? false;

        const configMessage = `
⚙️ *Suas Configurações*

🔑 *Token:* ${user.derivToken ? '✅ Configurado' : '❌ Não configurado'}
🎯 *Meta:* ${user.goalPercentage ? `${user.goalPercentage}%` : '❌ Não configurada'}
❌ *Máx. Loss (Even/Odd):* ${maxLosses} (Risco ~ ${risk}%)
🔢 *Digit Differs:* ${useDigitDifferStrategy ? '✅ Ativado (4 dígitos)' : '❌ Desativado'}

${(!user.derivToken || !user.goalPercentage) ? '\n⚠️ Configure todos os itens antes de iniciar uma sessão.' : '\n✅ Tudo pronto! Use /session para iniciar.'}
        `;
        
        this.bot.sendMessage(chatId, configMessage, { parse_mode: 'Markdown' });
      }
      
      this.bot.answerCallbackQuery(query.id);
    });
  }

  stop() {
    this.sessionManager.stopAll();
    this.bot.stopPolling();
  }
}