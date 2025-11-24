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

Sou um robô automatizado que opera na Deriv usando:

*Estratégia Padrão:*
- Padrões Even/Odd em índices de volatilidade (com martingale opcional)
- (Opcional) Estratégia Digit Differs
- (Opcional) Estratégia Under/Over

*Estratégia PPCP (nova):*
- Opera somente Even/Odd quando há 10 repetições
- Trabalha por sessões com objetivo de lucro > 0.01 USD
- Após loss: próxima stake = 1.5x da anterior, aguardando nova oportunidade
- Após win (se sessão ainda < 0.01): próxima stake = 1.94x
- Reset da sessão quando lucro >= 0.01

*Fluxo básico:*
1️⃣ Configure sua estratégia e parâmetros: /config
2️⃣ Inicie uma sessão: /session
3️⃣ Acompanhe o status: /status
4️⃣ Pare a sessão: /stop

*Comandos:*
/config - Configurar token, meta, risco e estratégia (Padrão ou PPCP)
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
/config - Configurar token, metas, riscos e escolher estratégia
/session - Iniciar sessão de trading
/status - Ver status da sessão atual
/stop - Parar sessão ativa
/help - Esta mensagem

*Estratégias:*

1️⃣ *Estratégia Padrão*  
- Even/Odd com martingale opcional (limite de 1–6 losses)  
- (Opcional) Digit Differs (5% do capital, sem gale)  
- (Opcional) Under/Over (1% do capital, sem gale)  
- Usa a meta % global configurada em *Meta %*.

2️⃣ *Estratégia PPCP*  
- Opera apenas Even/Odd com padrão de 10 repetições  
- Cada sessão busca lucro > 0.01 USD:  
  - Se perder: próxima stake = 1.5x da anterior, sempre aguardando nova oportunidade  
  - Se ganhar e sessão ainda < 0.01: próxima stake = 1.94x da anterior  
  - Se lucro da sessão >= 0.01: sessão WIN, stake volta para a inicial  
- Usa *Meta PPCP %* e *Stake Inicial PPCP*.

*Como configurar:*
1. Use /config
2. Configure o token
3. Escolha a *Estratégia Atual* (Padrão ou PPCP)
4. Para Padrão: defina Meta %, Máx. Loss (1–6), Max Loss Global opcional, Digit Differs e Under/Over
5. Para PPCP: defina Meta PPCP %, Max Loss Global PPCP (opcional) e Stake Inicial PPCP

*Como operar:*
- Use /session para iniciar
- O lucro de qualquer entrada conta para a meta da estratégia ativa
- O bot para ao atingir a meta ou o limite de perdas globais (se configurado)

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
      
      const strategyMode = user.strategyMode || 'standard';

      if (strategyMode === 'standard' && !user.goalPercentage) {
        this.bot.sendMessage(chatId, '❌ Você precisa configurar sua meta % (Estratégia Padrão).\nUse /config');
        return;
      }

      if (strategyMode === 'ppcp') {
        if (!user.ppcpGoalPercentage || !user.ppcpInitialStake) {
          this.bot.sendMessage(chatId,
            '❌ Configuração PPCP incompleta.\n' +
            'Use /config e ajuste:\n' +
            '- Estratégia: PPCP\n' +
            '- Meta PPCP %\n' +
            '- Stake Inicial PPCP'
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
      
      const globalLossText = status.maxGlobalLoss
        ? `\n🚨 *Max Loss Global:* -${Math.abs(status.maxGlobalLoss)}%`
        : '';

      const strategyLine = status.strategyMode === 'ppcp'
        ? '🎯 *Estratégia Atual:* PPCP'
        : '🎯 *Estratégia Atual:* Padrão';
      
      const statusMessage = `
📊 *Status da Sessão*

${strategyLine}
⏱ *Tempo:* ${status.executionTime}
💰 *Saldo Inicial:* ${status.currency} ${status.initialBalance.toFixed(2)}
💵 *Saldo Atual:* ${status.currency} ${status.currentBalance.toFixed(2)}
📈 *Lucro:* ${status.currency} ${status.profit.toFixed(2)}
📊 *Crescimento:* ${status.growth.toFixed(2)}%
🎯 *Meta (da estratégia ativa):* ${status.goalPercentage}%${globalLossText}

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

          // Escolha da estratégia
          [{ text: '🎯 Estratégia Atual (Padrão/PPCP)', callback_data: 'config_strategy_mode' }],

          // Configuração estratégia padrão
          [{ text: '🎯 Meta % (Estratégia Padrão)', callback_data: 'config_goal' }],
          [{ text: '❌ Máx. Loss (1–6)', callback_data: 'config_max_loss' }],
          [{ text: '🚨 Max Loss Global % (Padrão)', callback_data: 'config_global_loss' }],
          [{ text: '🔄 Martingale Even/Odd', callback_data: 'config_martingale' }],
          [{ text: '🔢 Estratégia Digit Differs', callback_data: 'config_digit_diff' }],
          [{ text: '📉 Estratégia Under/Over', callback_data: 'config_under_over' }],

          // Configuração PPCP
          [{ text: '🎯 Meta PPCP %', callback_data: 'config_ppcp_goal' }],
          [{ text: '🚨 Max Loss Global % (PPCP)', callback_data: 'config_ppcp_global_loss' }],
          [{ text: '💵 Stake Inicial PPCP', callback_data: 'config_ppcp_initial_stake' }],

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

      // Escolha modo de estratégia
      if (data === 'config_strategy_mode') {
        const user = this.userStore.getUser(chatId) || {};
        const mode = user.strategyMode || 'standard';

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🧠 Usar Estratégia Padrão', callback_data: 'strategy_standard' }],
              [{ text: '🔥 Usar Estratégia PPCP', callback_data: 'strategy_ppcp' }],
              [{ text: '🔙 Voltar ao Menu', callback_data: 'back_to_menu' }]
            ]
          }
        };

        this.bot.sendMessage(
          chatId,
          `🎯 *Estratégia Atual*\n\n` +
          `Modo atual: *${mode === 'ppcp' ? 'PPCP' : 'Padrão'}*\n\n` +
          `• *Padrão*: Even/Odd + DigitDiff + Under/Over, com martingale opcional.\n` +
          `• *PPCP*: Apenas Even/Odd com lógica especial de recuperação (1.5x loss / 1.94x win) e objetivo de sessão > 0.01.\n\n` +
          `Escolha o modo:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'strategy_standard') {
        this.userStore.setStrategyMode(chatId, 'standard');
        this.bot.sendMessage(chatId, '✅ Estratégia definida para *Padrão*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'strategy_ppcp') {
        this.userStore.setStrategyMode(chatId, 'ppcp');
        this.bot.sendMessage(chatId, '🔥 Estratégia definida para *PPCP*.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }
      
      if (data === 'config_goal') {
        this.bot.sendMessage(chatId, '🎯 *Configurar Meta de Crescimento (Estratégia Padrão)*\n\nEnvie a meta em % (ex: 10):', {
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
            this.bot.sendMessage(chatId, `✅ Meta (Estratégia Padrão) configurada para ${goal}%`);
            this.bot.removeListener('message', listener);
            
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }
      
      if (data === 'config_max_loss') {
        this.bot.sendMessage(chatId,
          '❌ *Máximo de Loss por Sessão (Even/Odd – Estratégia Padrão)*\n\n' +
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
          '🚨 *Max Loss Global (Estratégia Padrão)*\n\n' +
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
              this.bot.sendMessage(chatId, '✅ Max Loss Global (Padrão) *desativado*.', { parse_mode: 'Markdown' });
            } else {
              this.userStore.setMaxGlobalLoss(chatId, val);
              this.bot.sendMessage(chatId, `✅ Max Loss Global (Padrão) configurado para *-${val}%*.`, { parse_mode: 'Markdown' });
            }
            
            this.bot.removeListener('message', listener);
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }

      // Martingale padrão
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
          `🔄 *Martingale Even/Odd (Estratégia Padrão)*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `- Quando *ativado*: dobra o stake a cada loss até atingir o máximo de loss configurado.\n` +
          `- Quando *desativado*: usa sempre 0.5% do saldo, sem parar no loss (parada manual).\n\n` +
          `Obs: na estratégia PPCP o martingale padrão não é usado (há lógica própria).\n\n` +
          `Escolha uma opção:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'martingale_on') {
        this.userStore.setUseMartingaleEvenOdd(chatId, true);
        this.bot.sendMessage(chatId, '✅ Martingale Even/Odd *ativado* (Estratégia Padrão).', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'martingale_off') {
        this.userStore.setUseMartingaleEvenOdd(chatId, false);
        this.bot.sendMessage(chatId, '❌ Martingale Even/Odd *desativado* (Estratégia Padrão).\n\nℹ️ O bot continuará operando sem parar no loss. Use /stop para encerrar manualmente.', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      // DigitDiff
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
          `🔢 *Estratégia Digit Differs (Padrão)*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `- Usa 5% do capital por entrada, sem gale.\n` +
          `- Opera quando os últimos 4 dígitos da sequência de 10 são iguais.\n` +
          `- O lucro conta para a mesma meta global da Estratégia Padrão.\n\n` +
          `Obs: na PPCP, Digit Differs não é utilizado.\n\n` +
          `Escolha uma opção:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'digit_diff_on') {
        this.userStore.setUseDigitDifferStrategy(chatId, true);
        this.bot.sendMessage(chatId, '✅ Estratégia Digit Differs *ativada* (Padrão).', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'digit_diff_off') {
        this.userStore.setUseDigitDifferStrategy(chatId, false);
        this.bot.sendMessage(chatId, '❌ Estratégia Digit Differs *desativada* (Padrão).', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      // Under/Over
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
          `📉 *Estratégia Under/Over (Padrão)*\n\n` +
          `Estado atual: *${currentlyOn ? 'Ativado' : 'Desativado'}*\n\n` +
          `- Usa 1% do capital por entrada, sem gale.\n` +
          `- Opera quando todos os 10 dígitos analisados são > 6 (7, 8, 9).\n` +
          `- Entra com DIGITUNDER 7.\n` +
          `- O lucro conta para a mesma meta global da Estratégia Padrão.\n\n` +
          `Obs: na PPCP, Under/Over não é utilizado.\n\n` +
          `Escolha uma opção:`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      if (data === 'under_over_on') {
        this.userStore.setUseUnderOverStrategy(chatId, true);
        this.bot.sendMessage(chatId, '✅ Estratégia Under/Over *ativada* (Padrão).', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      if (data === 'under_over_off') {
        this.userStore.setUseUnderOverStrategy(chatId, false);
        this.bot.sendMessage(chatId, '❌ Estratégia Under/Over *desativada* (Padrão).', { parse_mode: 'Markdown' });
        setTimeout(() => this.showConfigMenu(chatId), 500);
      }

      // ---- CONFIGURAÇÕES PPCP ----
      if (data === 'config_ppcp_goal') {
        this.bot.sendMessage(chatId, '🎯 *Configurar Meta PPCP (%)*\n\nEnvie a meta em % (ex: 5):', {
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
            this.bot.sendMessage(chatId, `✅ Meta PPCP configurada para ${goal}%`);
            this.bot.removeListener('message', listener);
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }

      if (data === 'config_ppcp_global_loss') {
        this.bot.sendMessage(chatId,
          '🚨 *Max Loss Global (PPCP)*\n\n' +
          'Envie o percentual negativo máximo de crescimento antes de encerrar a operação.\n\n' +
          'Exemplo: envie *5* para parar quando o crescimento atingir -5%.\n' +
          'Envie *0* para desativar este limite na PPCP.',
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
              this.userStore.setPpcpMaxGlobalLoss(chatId, null);
              this.bot.sendMessage(chatId, '✅ Max Loss Global PPCP *desativado*.', { parse_mode: 'Markdown' });
            } else {
              this.userStore.setPpcpMaxGlobalLoss(chatId, val);
              this.bot.sendMessage(chatId, `✅ Max Loss Global PPCP configurado para *-${val}%*.`, { parse_mode: 'Markdown' });
            }
            
            this.bot.removeListener('message', listener);
            setTimeout(() => this.showConfigMenu(chatId), 500);
          }
        };
        this.bot.on('message', listener);
      }

      if (data === 'config_ppcp_initial_stake') {
        this.bot.sendMessage(chatId,
          '💵 *Stake Inicial PPCP*\n\n' +
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
            this.bot.sendMessage(chatId, `✅ Stake inicial PPCP configurada para ${stake.toFixed(2)} USD.`);
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
        
        const maxLosses = user.maxLosses ?? 6;
        const risk = riskByMaxLoss[maxLosses] ?? 31.0;
        const maxGlobalLoss = user.maxGlobalLoss ?? null;
        const useDigitDifferStrategy = user.useDigitDifferStrategy ?? false;
        const useUnderOverStrategy = user.useUnderOverStrategy ?? false;
        const useMartingaleEvenOdd = user.useMartingaleEvenOdd !== false;
        const strategyMode = user.strategyMode || 'standard';

        const globalLossText = maxGlobalLoss
          ? `\n🚨 *Max Loss Global (Padrão):* -${Math.abs(maxGlobalLoss)}%`
          : '\n🚨 *Max Loss Global (Padrão):* ❌ Desativado';

        const ppcpGoal = user.ppcpGoalPercentage ?? null;
        const ppcpGlobalLoss = user.ppcpMaxGlobalLoss ?? null;
        const ppcpInitialStake = user.ppcpInitialStake ?? null;

        const ppcpGlobalLossText = ppcpGlobalLoss
          ? `\n🚨 *Max Loss Global (PPCP):* -${Math.abs(ppcpGlobalLoss)}%`
          : '\n🚨 *Max Loss Global (PPCP):* ❌ Desativado';

        const configMessage = `
⚙️ *Suas Configurações*

🔑 *Token:* ${user.derivToken ? '✅ Configurado' : '❌ Não configurado'}

🎯 *Estratégia Atual:* ${strategyMode === 'ppcp' ? '🔥 PPCP' : '🧠 Padrão'}

📌 *Estratégia Padrão:*
🎯 *Meta:* ${user.goalPercentage ? `${user.goalPercentage}%` : '❌ Não configurada'}
❌ *Máx. Loss (Even/Odd):* ${maxLosses} (Risco ~ ${risk}%)${globalLossText}
🔄 *Martingale Even/Odd:* ${useMartingaleEvenOdd ? '✅ Ativado' : '❌ Desativado'}
🔢 *Digit Differs:* ${useDigitDifferStrategy ? '✅ Ativado (4 dígitos)' : '❌ Desativado'}
📉 *Under/Over:* ${useUnderOverStrategy ? '✅ Ativado (10 dígitos > 6)' : '❌ Desativado'}

🔥 *Estratégia PPCP:*
🎯 *Meta PPCP:* ${ppcpGoal ? `${ppcpGoal}%` : '❌ Não configurada'}
💵 *Stake Inicial PPCP:* ${ppcpInitialStake ? `${ppcpInitialStake.toFixed(2)} USD` : '❌ Não configurada'}${ppcpGlobalLossText}
        `;
        
        const isReadyStandard = user.derivToken && user.goalPercentage;
        const isReadyPpcp = user.derivToken && ppcpGoal && ppcpInitialStake;

        const isReady =
          (strategyMode === 'standard' && isReadyStandard) ||
          (strategyMode === 'ppcp' && isReadyPpcp);
        
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
          ? configMessage + '\n✅ *Tudo pronto!* Clique em "Iniciar Sessão" ou use /session.'
          : configMessage + '\n⚠️ *Complete as configurações obrigatórias da estratégia selecionada antes de iniciar uma sessão.*';
        
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

        const strategyMode = user.strategyMode || 'standard';

        if (strategyMode === 'standard') {
          if (!user.goalPercentage) {
            this.bot.sendMessage(chatId, '❌ Você precisa configurar a meta % da Estratégia Padrão.\nUse /config');
            this.bot.answerCallbackQuery(query.id);
            return;
          }
        } else {
          if (!user.ppcpGoalPercentage || !user.ppcpInitialStake) {
            this.bot.sendMessage(chatId,
              '❌ Configuração PPCP incompleta.\n' +
              'Use /config e ajuste:\n' +
              '- Estratégia: PPCP\n' +
              '- Meta PPCP %\n' +
              '- Stake Inicial PPCP'
            );
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