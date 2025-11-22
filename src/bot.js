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
- Estratégia de padrões Even/Odd em índices de volatilidade (com martingale opcional)
- (Opcional) Estratégia Digit Differs por repetição de dígitos
- (Opcional) Estratégia Under/Over quando todos os 10 dígitos > 6

*Como funcionar:*
1️⃣ Configure seu token da Deriv: /config
2️⃣ Inicie uma sessão: /session
3️⃣ Acompanhe o status: /status
4️⃣ Pare a sessão: /stop

*Comandos disponíveis:*
/config - Configurar token, meta, risco e estratégias
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
/config - Configurar token Deriv, meta %, máx. loss e estratégias
/session - Iniciar sessão de trading
/status - Ver status da sessão atual
/stop - Parar sessão ativa
/help - Esta mensagem

*Como configurar:*
1. Use /config
2. Envie seu API token da Deriv
3. Defina sua meta de crescimento (%)
4. Defina o máximo de loss (1-6) para estratégia Even/Odd
5. Defina o máximo de loss global (%) - opcional
6. Escolha se deseja ativar martingale na estratégia Even/Odd
7. Escolha se deseja ativar a estratégia Digit Differs
8. Escolha se deseja ativar a estratégia Under/Over

*Como operar:*
1. Use /session para iniciar
2. O bot detecta padrões automaticamente
   - Even/Odd com martingale opcional e limite de losses
   - (Opcional) Digit Differs com 5% de stake sem gale (4 dígitos consecutivos)
   - (Opcional) Under/Over com 1% de stake sem gale (10 dígitos > 6)
3. O lucro de qualquer estratégia conta para a mesma meta
4. Para ao atingir meta, limite de perdas da estratégia Even/Odd (se martingale ativo) ou max loss global

*Suporte:*
Em caso de dúvidas, entre em contato com o desenvolvedor.
      `;
      
      this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    // Comando /config
    this.bot.onText(/\/config/, (msg) => {
      const chatId = msg.chat.id;
      this.showConfigMenu(chatId);
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
      
      const globalLossText = status.maxGlobalLoss ? `\n🚨 *Max Loss Global:* -${Math.abs(status.maxGlobalLoss)}%` : '';
      
      const statusMessage = `
📊 *Status da Sessão*

⏱ *Tempo:* ${status.executionTime}
💰 *Saldo Inicial:* ${status.currency} ${status.initialBalance.toFixed(2)}
💵 *Saldo Atual:* ${status.currency} ${status.currentBalance.toFixed(2)}
📈 *Lucro:* ${status.currency} ${status.profit.toFixed(2)}
📊 *Crescimento:* ${status.growth.toFixed(2)}%
🎯 *Meta:* ${status.goalPercentage}%${globalLossText}

📋 *Sessões (Even/Odd):* ${status.totalSessions}
✅ *Vitórias:* ${status.winSessions}
❌ *Derrotas:* ${status.lossSessions}
📊 *Taxa de Vitória:* ${status.winRate.toFixed(2)}%

🔄 *Martingale Even/Odd:* ${status.useMartingaleEvenOdd ? '✅ Ativado' : '❌ Desativado'}
🧠 *Digit Differs:* ${status.useDigitDifferStrategy ? '✅ Ativado' : '❌ Desativado'}
📉 *Under/Over:* ${status.useUnderOverStrategy ? '✅ Ativado' : '❌ Desativado'}
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
      this.bot.sendMessage(chatId, '🛑 Sessão encerrada com sucesso!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Voltar para Configurações', callback_data: 'back_to_config' }]
          ]
        }
      });
    });
  }

  showConfigMenu(chatId) {
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
          [{ text: '🎯 Configurar Meta %', callback_data: 'config_goal' }],
          [{ text: '❌ Máx. Loss (1–6)', callback_data: 'config_max_loss' }],
          [{ text: '🚨 Max Loss Global %', callback_data: 'config_global_loss' }],
          [{ text: '🔄 Martingale Even/Odd', callback_data: 'config_martingale' }],
          [{ text: '🔢 Estratégia Digit Differs', callback_data: 'config_digit_diff' }],
          [{ text: '📉 Estratégia Under/Over', callback_data: 'config_under_over' }],
          [{ text: '📊 Ver Configuração', callback_data: 'view_config' }]
        ]
      }
    };
    
    this.bot.sendMessage(chatId, '⚙️ *Configurações*\n\nEscolha uma opção:', {
      parse_mode: 'Markdown',
      ...keyboard
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
            
            setTimeout(() => this.showConfigMenu(chatId), 500);
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
              setTimeout(() => this.showConfigMenu(chatId), 500);
              return;
            }
            this.userStore.setGoalPercentage(chatId, goal);
            this.bot.sendMessage(chatId, `✅ Meta configurada para ${goal}%`);
            this.bot.removeListener('message', listener);
            
            setTimeout(() => this.showConfigMenu(chatId), 500);
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
              setTimeout(() => this.showConfigMenu(chatId), 500);
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
            
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }

      if (data === 'config_global_loss') {
        this.bot.sendMessage(chatId,
          '🚨 *Max Loss Global*\n\n' +
          'Envie o percentual negativo máximo de crescimento antes de encerrar a operação.\n\n' +
          'Exemplo: envie *5* para parar quando o crescimento atingir -5%.\n' +
          'Envie *0* para desativar este limite.',
          { parse_mode: 'Markdown' }
        );

        const listener = (msg) => {
          if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
            const val = parseFloat(msg.text.trim());
            if (isNaN(val) || val < 0) {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Envie um número positivo ou 0 para desativar.');
              this.bot.removeListener('message', listener);
              setTimeout(() => this.showConfigMenu(chatId), 500);
              return;
            }
            
            if (val === 0) {
              this.userStore.setMaxGlobalLoss(chatId, null);
              this.bot.sendMessage(chatId, '✅ Max Loss Global *desativado*.', { parse_mode: 'Markdown' });
            } else {
              this.userStore.setMaxGlobalLoss(chatId, val);
              this.bot.sendMessage(chatId, `✅ Max Loss Global configurado para *-${val}%*.`, { parse_mode: 'Markdown' });
            }
            
            this.bot.removeListener('message', listener);
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }

      if (data === 'config_martingale') {
        const user = this.userStore.getUser(chatId) || {};
        const currentlyOn = user.useMartingaleEvenOdd !== false;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Ativar Martingale', callback_data: 'martingale_on' }],
              [{ text: '❌ Desativar Martingale', callback_data: 'martingale_off' }],
              [{ text: '🔙 Voltar ao Menu', callback_data: 'back_to_menu' }]
            ]
          }
        };

        this.bot.sendMessage(
          chatId,
          `🔄 *Martingale Even/Odd*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `- Quando *ativado*: dobra o stake a cada loss até atingir o máximo de loss configurado.\n` +
          `- Quando *desativado*: usa sempre 0.5% do saldo, sem parar no loss (parada manual).\n\n` +
          `Escolha uma opção:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'martingale_on') {
        this.userStore.setUseMartingaleEvenOdd(chatId, true);
        this.bot.sendMessage(chatId, '✅ Martingale Even/Odd *ativado*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'martingale_off') {
        this.userStore.setUseMartingaleEvenOdd(chatId, false);
        this.bot.sendMessage(chatId, '❌ Martingale Even/Odd *desativado*.\n\nℹ️ O bot continuará operando sem parar no loss. Use /stop para encerrar manualmente.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'config_digit_diff') {
        const user = this.userStore.getUser(chatId) || {};
        const currentlyOn = !!user.useDigitDifferStrategy;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Ativar Digit Differs', callback_data: 'digit_diff_on' }],
              [{ text: '❌ Desativar Digit Differs', callback_data: 'digit_diff_off' }],
              [{ text: '🔙 Voltar ao Menu', callback_data: 'back_to_menu' }]
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
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'digit_diff_off') {
        this.userStore.setUseDigitDifferStrategy(chatId, false);
        this.bot.sendMessage(chatId, '❌ Estratégia Digit Differs *desativada*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'config_under_over') {
        const user = this.userStore.getUser(chatId) || {};
        const currentlyOn = !!user.useUnderOverStrategy;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Ativar Under/Over', callback_data: 'under_over_on' }],
              [{ text: '❌ Desativar Under/Over', callback_data: 'under_over_off' }],
              [{ text: '🔙 Voltar ao Menu', callback_data: 'back_to_menu' }]
            ]
          }
        };

        this.bot.sendMessage(
          chatId,
          `📉 *Estratégia Under/Over*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `- Usa 1% do capital por entrada, sem gale.\n` +
          `- Opera quando todos os 10 dígitos analisados são > 6 (7, 8, 9).\n` +
          `- Entra com DIGITUNDER 7.\n` +
          `- O lucro conta para a mesma meta global.\n\n` +
          `Escolha uma opção:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'under_over_on') {
        this.userStore.setUseUnderOverStrategy(chatId, true);
        this.bot.sendMessage(chatId, '✅ Estratégia Under/Over *ativada*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'under_over_off') {
        this.userStore.setUseUnderOverStrategy(chatId, false);
        this.bot.sendMessage(chatId, '❌ Estratégia Under/Over *desativada*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'back_to_menu') {
        this.showConfigMenu(chatId);
      }

      if (data === 'back_to_config') {
        this.showConfigMenu(chatId);
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
        const maxGlobalLoss = user.maxGlobalLoss ?? null;
        const useDigitDifferStrategy = user.useDigitDifferStrategy ?? false;
        const useUnderOverStrategy = user.useUnderOverStrategy ?? false;
        const useMartingaleEvenOdd = user.useMartingaleEvenOdd !== false;

        const globalLossText = maxGlobalLoss ? `\n🚨 *Max Loss Global:* -${Math.abs(maxGlobalLoss)}%` : '\n🚨 *Max Loss Global:* ❌ Desativado';

        const configMessage = `
⚙️ *Suas Configurações*

🔑 *Token:* ${user.derivToken ? '✅ Configurado' : '❌ Não configurado'}
🎯 *Meta:* ${user.goalPercentage ? `${user.goalPercentage}%` : '❌ Não configurada'}
❌ *Máx. Loss (Even/Odd):* ${maxLosses} (Risco ~ ${risk}%)${globalLossText}
🔄 *Martingale Even/Odd:* ${useMartingaleEvenOdd ? '✅ Ativado' : '❌ Desativado'}
🔢 *Digit Differs:* ${useDigitDifferStrategy ? '✅ Ativado (4 dígitos)' : '❌ Desativado'}
📉 *Under/Over:* ${useUnderOverStrategy ? '✅ Ativado (10 dígitos > 6)' : '❌ Desativado'}
        `;
        
        const isReady = user.derivToken && user.goalPercentage;
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: isReady 
              ? [
                  [{ text: '🚀 Iniciar Sessão', callback_data: 'start_session' }],
                  [{ text: '🔙 Voltar para Configuração', callback_data: 'back_to_menu' }]
                ]
              : [
                  [{ text: '🔙 Voltar para Configuração', callback_data: 'back_to_menu' }]
                ]
          }
        };
        
        const finalMessage = isReady 
          ? configMessage + '\n✅ *Tudo pronto!* Clique em "Iniciar Sessão" ou use /session'
          : configMessage + '\n⚠️ *Configure todos os itens obrigatórios antes de iniciar uma sessão.*';
        
        this.bot.sendMessage(chatId, finalMessage, { 
          parse_mode: 'Markdown',
          ...keyboard
        });
      }

      if (data === 'start_session') {
        const user = this.userStore.getUser(chatId);
        
        if (!user || !user.derivToken || !user.goalPercentage) {
          this.bot.sendMessage(chatId, '❌ Configuração incompleta. Use /config');
          this.bot.answerCallbackQuery(query.id);
          return;
        }
        
        if (this.sessionManager.hasActiveSession(chatId)) {
          this.bot.sendMessage(chatId, '⚠️ Você já tem uma sessão ativa.\nUse /stop para encerrar.');
          this.bot.answerCallbackQuery(query.id);
          return;
        }
        
        await this.sessionManager.startSession(chatId);
      }
      
      this.bot.answerCallbackQuery(query.id);
    });
  }

  stop() {
    this.sessionManager.stopAll();
    this.bot.stopPolling();
  }
}