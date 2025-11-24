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
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const welcomeMessage = `
🎯 *Bem-vindo ao Vega Monitor Trading System*

Sou um robô automatizado que opera na Deriv usando estratégias avançadas de análise de padrões em índices de volatilidade.

*Como começar:*
1️⃣ Configure sua estratégia: /config
2️⃣ Inicie uma sessão: /session
3️⃣ Acompanhe o status: /status
4️⃣ Pare a sessão: /stop

*Comandos disponíveis:*
/config - Configurar estratégia e parâmetros
/session - Iniciar nova sessão
/status - Ver status atual
/stop - Parar sessão ativa
/help - Ajuda

⚠️ *Aviso:* Trading envolve riscos. Use apenas capital que pode perder.
      `;
      
      this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = `
📚 *Ajuda - Vega Monitor Bot*

*Comandos:*
/start - Mensagem de boas-vindas
/config - Configurar estratégia e parâmetros
/session - Iniciar sessão de trading
/status - Ver status da sessão atual
/stop - Parar sessão ativa
/help - Esta mensagem

*Estratégias Disponíveis:*

🧠 *Default*  
Estratégia multi-camadas com análise de padrões Even/Odd, Digit Differs e Under/Over. Utiliza gestão de risco progressiva e múltiplas oportunidades de entrada.

🔥 *PPCP*  
Estratégia focada em recuperação inteligente com análise de padrões Even/Odd. Sistema de gestão de stake adaptativo por sessão com objetivo de lucro incremental.

*Como configurar:*
1. Use /config
2. Escolha sua estratégia (Default ou PPCP)
3. Configure os parâmetros solicitados
4. Use /session para iniciar

*Suporte:*
Em caso de dúvidas, entre em contato com o desenvolvedor.
      `;
      
      this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/config/, (msg) => {
      const chatId = msg.chat.id;
      this.showConfigMenu(chatId);
    });

    this.bot.onText(/\/session/, async (msg) => {
      const chatId = msg.chat.id;
      const user = this.userStore.getUser(chatId);
      
      if (!user || !user.derivToken) {
        this.bot.sendMessage(chatId, '❌ Você precisa configurar seu token primeiro.\nUse /config');
        return;
      }
      
      const strategyMode = user.strategyMode || null;

      if (!strategyMode) {
        this.bot.sendMessage(chatId, '❌ Você precisa escolher uma estratégia primeiro.\nUse /config');
        return;
      }

      if (strategyMode === 'standard' && !user.goalPercentage) {
        this.bot.sendMessage(chatId, '❌ Você precisa configurar sua meta %.\nUse /config');
        return;
      }

      if (strategyMode === 'ppcp') {
        if (!user.ppcpGoalPercentage || !user.ppcpInitialStake) {
          this.bot.sendMessage(chatId,
            '❌ Configuração PPCP incompleta.\n' +
            'Use /config e ajuste os parâmetros necessários.'
          );
          return;
        }
      }
      
      if (this.sessionManager.hasActiveSession(chatId)) {
        this.bot.sendMessage(chatId, '⚠️ Você já tem uma sessão ativa.\nUse /stop para encerrar.');
        return;
      }
      
      await this.sessionManager.startSession(chatId);
    });

    this.bot.onText(/\/status/, (msg) => {
      const chatId = msg.chat.id;
      const status = this.sessionManager.getStatus(chatId);
      
      if (!status) {
        this.bot.sendMessage(chatId, '📊 Nenhuma sessão ativa no momento.\n\nUse /session para iniciar.');
        return;
      }
      
      const strategyLabel = status.strategyMode === 'ppcp' ? '🔥 PPCP' : '🧠 Default';
      
      let statusMessage = `
📊 *Status da Sessão*

🎯 *Estratégia:* ${strategyLabel}
⏱ *Tempo:* ${status.executionTime}
💰 *Saldo Inicial:* ${status.currency} ${status.initialBalance.toFixed(2)}
💵 *Saldo Atual:* ${status.currency} ${status.currentBalance.toFixed(2)}
📈 *Lucro:* ${status.currency} ${status.profit.toFixed(2)}
📊 *Crescimento:* ${status.growth.toFixed(2)}%
🎯 *Meta:* ${status.goalPercentage}%
`;

      if (status.maxGlobalLoss) {
        statusMessage += `🚨 *Max Loss Global:* -${Math.abs(status.maxGlobalLoss)}%\n`;
      }

      statusMessage += `
📋 *Sessões:* ${status.totalSessions}
✅ *Vitórias:* ${status.winSessions}
❌ *Derrotas:* ${status.lossSessions}
📊 *Taxa de Vitória:* ${status.winRate.toFixed(2)}%
`;

      // Informações específicas por estratégia
      if (status.strategyMode === 'standard') {
        statusMessage += `
🔄 *Martingale:* ${status.useMartingaleEvenOdd ? '✅ Ativo' : '❌ Inativo'}
🧠 *Digit Differs:* ${status.useDigitDifferStrategy ? '✅ Ativo' : '❌ Inativo'}
📉 *Under/Over:* ${status.useUnderOverStrategy ? '✅ Ativo' : '❌ Inativo'}
`;
      } else if (status.strategyMode === 'ppcp' && status.ppcpState) {
        const sessionProfit = status.ppcpState.sessionProfit || 0;
        const currentStake = status.ppcpState.currentStake || 0;
        statusMessage += `
💵 *Stake Atual:* ${status.currency} ${currentStake.toFixed(2)}
💰 *Lucro da Sessão Atual:* ${status.currency} ${sessionProfit.toFixed(5)}
`;
      }

      statusMessage += `\n${status.isTrading ? '🔄 *Trade em andamento...*' : '👀 *Observando oportunidades...*'}`;
      
      this.bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
    });

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
    const user = this.userStore.getUser(chatId) || {};
    const strategyMode = user.strategyMode || null;

    // Se ainda não escolheu estratégia, mostra apenas escolha de estratégia
    if (!strategyMode) {
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
            [{ text: '🎯 Escolher Estratégia', callback_data: 'config_strategy_mode' }],
            [{ text: '📊 Ver Configuração', callback_data: 'view_config' }]
          ]
        }
      };
      
      this.bot.sendMessage(chatId, '⚙️ *Configurações*\n\n⚠️ Escolha uma estratégia para continuar.', {
        parse_mode: 'Markdown',
        ...keyboard
      });
      return;
    }

    // Menu específico para Default
    if (strategyMode === 'standard') {
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
            [{ text: '🎯 Trocar Estratégia', callback_data: 'config_strategy_mode' }],
            [{ text: '📈 Meta %', callback_data: 'config_goal' }],
            [{ text: '❌ Máx. Loss (1–6)', callback_data: 'config_max_loss' }],
            [{ text: '🚨 Max Loss Global %', callback_data: 'config_global_loss' }],
            [{ text: '🔄 Martingale', callback_data: 'config_martingale' }],
            [{ text: '🔢 Digit Differs', callback_data: 'config_digit_diff' }],
            [{ text: '📉 Under/Over', callback_data: 'config_under_over' }],
            [{ text: '📊 Ver Configuração', callback_data: 'view_config' }]
          ]
        }
      };
      
      this.bot.sendMessage(chatId, '⚙️ *Configurações (Estratégia Default)*\n\nEscolha uma opção:', {
        parse_mode: 'Markdown',
        ...keyboard
      });
      return;
    }

    // Menu específico para PPCP
    if (strategyMode === 'ppcp') {
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
            [{ text: '🎯 Trocar Estratégia', callback_data: 'config_strategy_mode' }],
            [{ text: '📈 Meta %', callback_data: 'config_ppcp_goal' }],
            [{ text: '🚨 Max Loss Global %', callback_data: 'config_ppcp_global_loss' }],
            [{ text: '💵 Stake Inicial', callback_data: 'config_ppcp_initial_stake' }],
            [{ text: '📊 Ver Configuração', callback_data: 'view_config' }]
          ]
        }
      };
      
      this.bot.sendMessage(chatId, '⚙️ *Configurações (Estratégia PPCP)*\n\nEscolha uma opção:', {
        parse_mode: 'Markdown',
        ...keyboard
      });
      return;
    }
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

      // Escolha modo de estratégia
      if (data === 'config_strategy_mode') {
        const user = this.userStore.getUser(chatId) || {};
        const mode = user.strategyMode || null;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🧠 Estratégia Default', callback_data: 'strategy_standard' }],
              [{ text: '🔥 Estratégia PPCP', callback_data: 'strategy_ppcp' }],
              [{ text: '🔙 Voltar ao Menu', callback_data: 'back_to_menu' }]
            ]
          }
        };

        const currentText = mode ? `\n\nEstratégia atual: *${mode === 'ppcp' ? 'PPCP' : 'Default'}*` : '';

        this.bot.sendMessage(
          chatId,
          `🎯 *Escolha sua Estratégia*${currentText}\n\n` +
          `🧠 *Default*: Análise multi-camadas com gestão de risco progressiva.\n\n` +
          `🔥 *PPCP*: Sistema de recuperação inteligente com gestão adaptativa de stake.\n\n` +
          `Escolha o modo:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'strategy_standard') {
        this.userStore.setStrategyMode(chatId, 'standard');
        this.bot.sendMessage(chatId, '✅ Estratégia definida para *Default*.\n\nConfigure os parâmetros necessários.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'strategy_ppcp') {
        this.userStore.setStrategyMode(chatId, 'ppcp');
        this.bot.sendMessage(chatId, '🔥 Estratégia definida para *PPCP*.\n\nConfigure os parâmetros necessários.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }
      
      // ===== CONFIGURAÇÕES DEFAULT =====
      if (data === 'config_goal') {
        this.bot.sendMessage(chatId, '📈 *Configurar Meta de Crescimento*\n\nEnvie a meta em % (ex: 10):', {
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
          '❌ *Máximo de Loss por Sessão*\n\n' +
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
              `✅ Máximo de loss configurado para ${val}.\n🔔 Risco estimado: *${risk}%*.`,
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
          'Envie o percentual negativo máximo antes de encerrar.\n\n' +
          'Exemplo: *5* para parar em -5%.\n' +
          'Envie *0* para desativar.',
          { parse_mode: 'Markdown' }
        );

        const listener = (msg) => {
          if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
            const val = parseFloat(msg.text.trim());
            if (isNaN(val) || val < 0) {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Envie um número positivo ou 0.');
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
              [{ text: '✅ Ativar', callback_data: 'martingale_on' }],
              [{ text: '❌ Desativar', callback_data: 'martingale_off' }],
              [{ text: '🔙 Voltar', callback_data: 'back_to_menu' }]
            ]
          }
        };

        this.bot.sendMessage(
          chatId,
          `🔄 *Martingale*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `Sistema de progressão de stake em caso de perda.\n\n` +
          `Escolha:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'martingale_on') {
        this.userStore.setUseMartingaleEvenOdd(chatId, true);
        this.bot.sendMessage(chatId, '✅ Martingale *ativado*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'martingale_off') {
        this.userStore.setUseMartingaleEvenOdd(chatId, false);
        this.bot.sendMessage(chatId, '❌ Martingale *desativado*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'config_digit_diff') {
        const user = this.userStore.getUser(chatId) || {};
        const currentlyOn = !!user.useDigitDifferStrategy;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Ativar', callback_data: 'digit_diff_on' }],
              [{ text: '❌ Desativar', callback_data: 'digit_diff_off' }],
              [{ text: '🔙 Voltar', callback_data: 'back_to_menu' }]
            ]
          }
        };

        this.bot.sendMessage(
          chatId,
          `🔢 *Digit Differs*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `Análise de padrões de repetição de dígitos.\n\n` +
          `Escolha:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'digit_diff_on') {
        this.userStore.setUseDigitDifferStrategy(chatId, true);
        this.bot.sendMessage(chatId, '✅ Digit Differs *ativado*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'digit_diff_off') {
        this.userStore.setUseDigitDifferStrategy(chatId, false);
        this.bot.sendMessage(chatId, '❌ Digit Differs *desativado*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'config_under_over') {
        const user = this.userStore.getUser(chatId) || {};
        const currentlyOn = !!user.useUnderOverStrategy;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Ativar', callback_data: 'under_over_on' }],
              [{ text: '❌ Desativar', callback_data: 'under_over_off' }],
              [{ text: '🔙 Voltar', callback_data: 'back_to_menu' }]
            ]
          }
        };

        this.bot.sendMessage(
          chatId,
          `📉 *Under/Over*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `Análise de tendências de dígitos extremos.\n\n` +
          `Escolha:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'under_over_on') {
        this.userStore.setUseUnderOverStrategy(chatId, true);
        this.bot.sendMessage(chatId, '✅ Under/Over *ativado*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'under_over_off') {
        this.userStore.setUseUnderOverStrategy(chatId, false);
        this.bot.sendMessage(chatId, '❌ Under/Over *desativado*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      // ===== CONFIGURAÇÕES PPCP =====
      if (data === 'config_ppcp_goal') {
        this.bot.sendMessage(chatId, '📈 *Configurar Meta*\n\nEnvie a meta em % (ex: 5):', {
          parse_mode: 'Markdown'
        });

        const listener = (msg) => {
          if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
            const goal = parseFloat(msg.text.trim());
            if (isNaN(goal) || goal <= 0) {
              this.bot.sendMessage(chatId, '❌ Meta inválida. Use um número positivo (ex: 5)');
              this.bot.removeListener('message', listener);
              setTimeout(() => this.showConfigMenu(chatId), 500);
              return;
            }

            this.userStore.setPpcpGoalPercentage(chatId, goal);
            this.bot.sendMessage(chatId, `✅ Meta configurada para ${goal}%`);
            this.bot.removeListener('message', listener);
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }

      if (data === 'config_ppcp_global_loss') {
        this.bot.sendMessage(chatId,
          '🚨 *Max Loss Global*\n\n' +
          'Envie o percentual negativo máximo antes de encerrar.\n\n' +
          'Exemplo: *5* para parar em -5%.\n' +
          'Envie *0* para desativar.',
          { parse_mode: 'Markdown' }
        );

        const listener = (msg) => {
          if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
            const val = parseFloat(msg.text.trim());
            if (isNaN(val) || val < 0) {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Envie um número positivo ou 0.');
              this.bot.removeListener('message', listener);
              setTimeout(() => this.showConfigMenu(chatId), 500);
              return;
            }
            
            if (val === 0) {
              this.userStore.setPpcpMaxGlobalLoss(chatId, null);
              this.bot.sendMessage(chatId, '✅ Max Loss Global *desativado*.', { parse_mode: 'Markdown' });
            } else {
              this.userStore.setPpcpMaxGlobalLoss(chatId, val);
              this.bot.sendMessage(chatId, `✅ Max Loss Global configurado para *-${val}%*.`, { parse_mode: 'Markdown' });
            }
            
            this.bot.removeListener('message', listener);
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }

      if (data === 'config_ppcp_initial_stake') {
        this.bot.sendMessage(chatId,
          '💵 *Stake Inicial*\n\n' +
          'Envie o valor da stake inicial em USD (ex: 1.5):',
          { parse_mode: 'Markdown' }
        );

        const listener = (msg) => {
          if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
            const stake = parseFloat(msg.text.trim());
            if (isNaN(stake) || stake <= 0) {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Envie um número positivo (ex: 1.5).');
              this.bot.removeListener('message', listener);
              setTimeout(() => this.showConfigMenu(chatId), 500);
              return;
            }

            this.userStore.setPpcpInitialStake(chatId, stake);
            this.bot.sendMessage(chatId, `✅ Stake inicial configurada para ${stake.toFixed(2)} USD.`);
            this.bot.removeListener('message', listener);
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }

      if (data === 'back_to_menu' || data === 'back_to_config') {
        this.showConfigMenu(chatId);
      }
      
      if (data === 'view_config') {
        const user = this.userStore.getUser(chatId);
        if (!user) {
          this.bot.sendMessage(chatId, '❌ Nenhuma configuração encontrada.\nUse /config para configurar.');
          this.bot.answerCallbackQuery(query.id);
          return;
        }
        
        const strategyMode = user.strategyMode || null;

        if (!strategyMode) {
          this.bot.sendMessage(chatId, '⚠️ Nenhuma estratégia selecionada.\n\nUse /config para escolher.');
          this.bot.answerCallbackQuery(query.id);
          return;
        }

        let configMessage = `
⚙️ *Suas Configurações*

🔑 *Token:* ${user.derivToken ? '✅ Configurado' : '❌ Não configurado'}
🎯 *Estratégia:* ${strategyMode === 'ppcp' ? '🔥 PPCP' : '🧠 Default'}

`;

        let isReady = false;

        if (strategyMode === 'standard') {
          const maxLosses = user.maxLosses ?? 6;
          const risk = riskByMaxLoss[maxLosses] ?? 31.0;
          const maxGlobalLoss = user.maxGlobalLoss ?? null;
          const useDigitDifferStrategy = user.useDigitDifferStrategy ?? false;
          const useUnderOverStrategy = user.useUnderOverStrategy ?? false;
          const useMartingaleEvenOdd = user.useMartingaleEvenOdd !== false;

          const globalLossText = maxGlobalLoss
            ? `\n🚨 *Max Loss Global:* -${Math.abs(maxGlobalLoss)}%`
            : '\n🚨 *Max Loss Global:* ❌ Desativado';

          configMessage += `📈 *Meta:* ${user.goalPercentage ? `${user.goalPercentage}%` : '❌ Não configurada'}
❌ *Máx. Loss:* ${maxLosses} (Risco ~ ${risk}%)${globalLossText}
🔄 *Martingale:* ${useMartingaleEvenOdd ? '✅ Ativo' : '❌ Inativo'}
🔢 *Digit Differs:* ${useDigitDifferStrategy ? '✅ Ativo' : '❌ Inativo'}
📉 *Under/Over:* ${useUnderOverStrategy ? '✅ Ativo' : '❌ Inativo'}
`;

          isReady = user.derivToken && user.goalPercentage;
        } else if (strategyMode === 'ppcp') {
          const ppcpGoal = user.ppcpGoalPercentage ?? null;
          const ppcpGlobalLoss = user.ppcpMaxGlobalLoss ?? null;
          const ppcpInitialStake = user.ppcpInitialStake ?? null;

          const ppcpGlobalLossText = ppcpGlobalLoss
            ? `\n🚨 *Max Loss Global:* -${Math.abs(ppcpGlobalLoss)}%`
            : '\n🚨 *Max Loss Global:* ❌ Desativado';

          configMessage += `📈 *Meta:* ${ppcpGoal ? `${ppcpGoal}%` : '❌ Não configurada'}
💵 *Stake Inicial:* ${ppcpInitialStake ? `${ppcpInitialStake.toFixed(2)} USD` : '❌ Não configurada'}${ppcpGlobalLossText}
`;

          isReady = user.derivToken && ppcpGoal && ppcpInitialStake;
        }
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: isReady 
              ? [
                  [{ text: '🚀 Iniciar Sessão', callback_data: 'start_session' }],
                  [{ text: '🔙 Voltar', callback_data: 'back_to_menu' }]
                ]
              : [
                  [{ text: '🔙 Voltar', callback_data: 'back_to_menu' }]
                ]
          }
        };
        
        const finalMessage = isReady 
          ? configMessage + '\n✅ *Tudo pronto!* Clique em "Iniciar Sessão" ou use /session.'
          : configMessage + '\n⚠️ *Complete as configurações obrigatórias antes de iniciar.*';
        
        this.bot.sendMessage(chatId, finalMessage, { 
          parse_mode: 'Markdown',
          ...keyboard
        });
      }

      if (data === 'start_session') {
        const user = this.userStore.getUser(chatId);
        
        if (!user || !user.derivToken) {
          this.bot.sendMessage(chatId, '❌ Configuração incompleta. Use /config');
          this.bot.answerCallbackQuery(query.id);
          return;
        }

        const strategyMode = user.strategyMode || null;

        if (!strategyMode) {
          this.bot.sendMessage(chatId, '❌ Escolha uma estratégia primeiro.\nUse /config');
          this.bot.answerCallbackQuery(query.id);
          return;
        }

        if (strategyMode === 'standard') {
          if (!user.goalPercentage) {
            this.bot.sendMessage(chatId, '❌ Configure a meta % primeiro.\nUse /config');
            this.bot.answerCallbackQuery(query.id);
            return;
          }
        } else {
          if (!user.ppcpGoalPercentage || !user.ppcpInitialStake) {
            this.bot.sendMessage(chatId, '❌ Configuração PPCP incompleta.\nUse /config');
            this.bot.answerCallbackQuery(query.id);
            return;
          }
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