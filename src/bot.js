import TelegramBot from 'node-telegram-bot-api';
import { UserStore } from './userStore.js';
import { SessionManager } from './sessionManager.js';

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

Sou um robô automatizado que opera na Deriv com estratégias próprias de análise de padrões e gestão de risco.

*Fluxo básico:*
1️⃣ Configure sua estratégia: /config  
2️⃣ Inicie uma sessão: /session  
3️⃣ Acompanhe o status: /status  
4️⃣ Pare a sessão: /stop  

⚠️ *Aviso:* Trading envolve riscos. Use apenas capital que pode perder.
      `;
      
      this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/config/, (msg) => {
      const chatId = msg.chat.id;
      this.showConfigMenu(chatId);
    });

    this.bot.onText(/\/session/, (msg) => {
      const chatId = msg.chat.id;
      this.sessionManager.startSession(chatId);
    });

    this.bot.onText(/\/stop/, (msg) => {
      const chatId = msg.chat.id;
      
      if (this.sessionManager.hasActiveSession(chatId)) {
        this.sessionManager.stopSession(chatId);
        this.bot.sendMessage(chatId, '🛑 *Sessão encerrada com sucesso!*', { parse_mode: 'Markdown' });
      } else {
        this.bot.sendMessage(chatId, '❌ Nenhuma sessão ativa no momento.');
      }
    });

    this.bot.onText(/\/status/, (msg) => {
      const chatId = msg.chat.id;
      const status = this.sessionManager.getStatus(chatId);

      if (!status) {
        this.bot.sendMessage(chatId, '❌ Nenhuma sessão ativa. Use /session para iniciar.');
        return;
      }

      let modeLabel = 'Default';
      if (status.strategyMode === 'ppcp') modeLabel = 'PPCP';
      else if (status.strategyMode === 'digithunter') modeLabel = 'DigitHunter';
      else if (status.strategyMode === 'hardtest') modeLabel = 'HardTest';

      const globalLossText = status.maxGlobalLoss 
        ? `\n🚨 *Max Loss Global:* -${Math.abs(status.maxGlobalLoss)}%` 
        : '';

      let strategyInfo = '';
      if (status.strategyMode === 'standard') {
        strategyInfo = `
🔄 *Martingale:* ${status.useMartingaleEvenOdd ? '✅ Ativo' : '❌ Inativo'}
🧠 *Digit Differs:* ${status.useDigitDifferStrategy ? '✅ Ativo' : '❌ Inativo'}
📉 *Under/Over:* ${status.useUnderOverStrategy ? '✅ Ativo' : '❌ Inativo'}`;
      } else if (status.strategyMode === 'ppcp' && status.ppcpState) {
        const directionLabel = status.ppcpState.direction === 'favor' ? 'A Favor' : 'Contra';
        strategyInfo = `
💵 *Stake Inicial:* ${status.currency} ${status.ppcpState.initialStake.toFixed(2)}
💰 *Stake Atual:* ${status.currency} ${status.ppcpState.currentStake.toFixed(2)}
🎲 *Direção:* ${directionLabel}
🔄 *Em Sequência:* ${status.ppcpState.inSequence ? '✅ Sim' : '❌ Não'}`;
      } else if (status.strategyMode === 'digithunter' && status.digitHunterState) {
        strategyInfo = `
💵 *Stake Inicial:* ${status.currency} ${status.digitHunterState.initialStake.toFixed(2)}
💰 *Stake Atual:* ${status.currency} ${status.digitHunterState.currentStake.toFixed(2)}
🔄 *Em Sequência:* ${status.digitHunterState.inSequence ? '✅ Sim' : '❌ Não'}`;
      } else if (status.strategyMode === 'hardtest' && status.hardTestState) {
        strategyInfo = `
🔢 *Ciclo Atual:* #${status.hardTestState.cycleNumber}
🎯 *Meta do Ciclo:* ${status.hardTestState.cycleGoalPercentage}%
🔁 *Máx. Recuperações:* ${status.hardTestState.maxRecoveries}
💵 *Stake Base:* ${status.currency} ${status.hardTestState.baseStake.toFixed(2)}
💰 *Stake Atual:* ${status.currency} ${status.hardTestState.currentStake.toFixed(2)}
📊 *Entradas no Ciclo:* ${status.hardTestState.cycleTradesCount}
💸 *Lucro/Prejuízo do Ciclo:* ${status.currency} ${status.hardTestState.cycleProfitAccumulated.toFixed(2)}
🔄 *Perdas Consecutivas:* ${status.hardTestState.lossesInARow}
📋 *Ciclos:* ✅ ${status.hardTestState.winCycles} | ❌ ${status.hardTestState.lossCycles}`;
      }

      const message = `
📊 *Status da Sessão (${modeLabel})*

⏱ *Tempo:* ${status.executionTime}
💰 *Saldo Inicial:* ${status.currency} ${status.initialBalance.toFixed(2)}
💵 *Saldo Atual:* ${status.currency} ${status.currentBalance.toFixed(2)}
📈 *Lucro/Prejuízo:* ${status.currency} ${status.profit.toFixed(2)}
📊 *Crescimento:* ${status.growth.toFixed(2)}%
🎯 *Meta:* ${status.goalPercentage}%${globalLossText}

📋 *Sessões Globais:* ${status.totalSessions}
✅ *Vitórias:* ${status.winSessions}
❌ *Derrotas:* ${status.lossSessions}
📊 *Taxa de Vitória:* ${status.winRate.toFixed(2)}%
${strategyInfo}

🔄 *Operando:* ${status.isTrading ? '✅ Sim' : '❌ Não'}
      `;

      this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
  }

  showConfigMenu(chatId) {
    const currentMode = this.userStore.getStrategyMode(chatId);
    
    const message = `
⚙️ *Configurações*

Escolha sua estratégia:
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: currentMode === 'standard' ? '✅ Default' : 'Default', callback_data: 'mode_standard' },
          { text: currentMode === 'ppcp' ? '✅ PPCP' : 'PPCP', callback_data: 'mode_ppcp' }
        ],
        [
          { text: currentMode === 'digithunter' ? '✅ DigitHunter' : 'DigitHunter', callback_data: 'mode_digithunter' },
          { text: currentMode === 'hardtest' ? '✅ HardTest' : 'HardTest', callback_data: 'mode_hardtest' }
        ]
      ]
    };

    this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  showStrategyConfigMenu(chatId) {
    const mode = this.userStore.getStrategyMode(chatId);

    if (mode === 'ppcp') {
      this.showPPCPConfigMenu(chatId);
    } else if (mode === 'digithunter') {
      this.showDigitHunterConfigMenu(chatId);
    } else if (mode === 'hardtest') {
      this.showHardTestConfigMenu(chatId);
    } else {
      this.showStandardConfigMenu(chatId);
    }
  }

  isPPCPConfigComplete(chatId) {
    const token = this.userStore.getToken(chatId);
    const goal = this.userStore.getGoalPercentage(chatId);
    const stake = this.userStore.getPPCPInitialStake(chatId);
    const direction = this.userStore.getPPCPDirection(chatId);
    return !!(token && goal && stake && direction);
  }

  isStandardConfigComplete(chatId) {
    const token = this.userStore.getToken(chatId);
    const goal = this.userStore.getGoalPercentage(chatId);
    return !!(token && goal);
  }

  isDigitHunterConfigComplete(chatId) {
    const token = this.userStore.getToken(chatId);
    const goal = this.userStore.getGoalPercentage(chatId);
    const stake = this.userStore.getDigitHunterInitialStake(chatId);
    return !!(token && goal && stake);
  }

  // HardTest: agora exige token + meta de ciclo + máx. recuperações
  isHardTestConfigComplete(chatId) {
    const token = this.userStore.getToken(chatId);
    const cycleGoal = this.userStore.getHardTestCycleGoal(chatId);
    const maxRecoveries = this.userStore.getHardTestMaxRecoveries(chatId);
    return !!(token && cycleGoal && maxRecoveries);
  }

  showPPCPConfigMenu(chatId) {
    const token = this.userStore.getToken(chatId);
    const goalPercentage = this.userStore.getGoalPercentage(chatId);
    const maxGlobalLoss = this.userStore.getMaxGlobalLoss(chatId);
    const ppcpInitialStake = this.userStore.getPPCPInitialStake(chatId);
    const ppcpDirection = this.userStore.getPPCPDirection(chatId);

    const tokenStatus = token ? '✅' : '❌';
    const globalLossText = maxGlobalLoss ? `${maxGlobalLoss}%` : 'Não definido';
    const directionText = ppcpDirection === 'favor' ? 'A Favor' : 'Contra';

    const message = `
⚙️ *Configurações PPCP*

${tokenStatus} *Token API:* ${token ? 'Configurado' : 'Não configurado'}
🎯 *Meta de Lucro:* ${goalPercentage}%
🚨 *Max Loss Global:* ${globalLossText}
💵 *Stake Inicial:* ${ppcpInitialStake.toFixed(2)} USD
🎲 *Direção:* ${directionText}

Escolha o que deseja configurar:
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
        [{ text: '🎯 Definir Meta de Lucro', callback_data: 'config_goal' }],
        [{ text: '🚨 Definir Max Loss Global', callback_data: 'config_global_loss' }],
        [{ text: '💵 Definir Stake Inicial', callback_data: 'config_ppcp_stake' }],
        [{ text: '🎲 Escolher Direção', callback_data: 'config_ppcp_direction' }],
        [{ text: '🔙 Voltar', callback_data: 'back_to_mode_selection' }]
      ]
    };

    if (this.isPPCPConfigComplete(chatId)) {
      keyboard.inline_keyboard.splice(
        keyboard.inline_keyboard.length - 1,
        0,
        [{ text: '▶️ Iniciar Sessão', callback_data: 'start_session' }]
      );
    }

    this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  showDigitHunterConfigMenu(chatId) {
    const token = this.userStore.getToken(chatId);
    const goalPercentage = this.userStore.getGoalPercentage(chatId);
    const maxGlobalLoss = this.userStore.getMaxGlobalLoss(chatId);
    const digitHunterInitialStake = this.userStore.getDigitHunterInitialStake(chatId);

    const tokenStatus = token ? '✅' : '❌';
    const globalLossText = maxGlobalLoss ? `${maxGlobalLoss}%` : 'Não definido';

    const message = `
⚙️ *Configurações DigitHunter*

${tokenStatus} *Token API:* ${token ? 'Configurado' : 'Não configurado'}
🎯 *Meta de Lucro:* ${goalPercentage}%
🚨 *Max Loss Global:* ${globalLossText}
💵 *Stake Inicial:* ${digitHunterInitialStake.toFixed(2)} USD

Escolha o que deseja configurar:
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
        [{ text: '🎯 Definir Meta de Lucro', callback_data: 'config_goal' }],
        [{ text: '🚨 Definir Max Loss Global', callback_data: 'config_global_loss' }],
        [{ text: '💵 Definir Stake Inicial', callback_data: 'config_digithunter_stake' }],
        [{ text: '🔙 Voltar', callback_data: 'back_to_mode_selection' }]
      ]
    };

    if (this.isDigitHunterConfigComplete(chatId)) {
      keyboard.inline_keyboard.splice(
        keyboard.inline_keyboard.length - 1,
        0,
        [{ text: '▶️ Iniciar Sessão', callback_data: 'start_session' }]
      );
    }

    this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  // HardTest config – agora com meta de ciclo e máx. recuperações configuráveis
  showHardTestConfigMenu(chatId) {
    const token = this.userStore.getToken(chatId);
    const maxGlobalLoss = this.userStore.getMaxGlobalLoss(chatId);
    const cycleGoal = this.userStore.getHardTestCycleGoal(chatId);
    const maxRecoveries = this.userStore.getHardTestMaxRecoveries(chatId);

    const tokenStatus = token ? '✅' : '❌';
    const globalLossText = maxGlobalLoss ? `${maxGlobalLoss}%` : 'Não definido';

    const message = `
⚙️ *Configurações HardTest*

${tokenStatus} *Token API:* ${token ? 'Configurado' : 'Não configurado'}
🎯 *Meta do Ciclo:* ${cycleGoal}%
🔁 *Máx. Recuperações:* ${maxRecoveries}
💵 *Stake Inicial por Ciclo:* 0.5% do saldo (mínimo 0.35 USD)
🚨 *Max Loss Global:* ${globalLossText}

*Atenção:* HardTest executa em loop até que você use /stop.

Escolha o que deseja configurar:
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
        [{ text: '🎯 Definir Meta do Ciclo', callback_data: 'config_hardtest_cycle_goal' }],
        [{ text: '🔁 Definir Máx. Recuperações', callback_data: 'config_hardtest_max_recoveries' }],
        [{ text: '🚨 Definir Max Loss Global', callback_data: 'config_global_loss' }],
        [{ text: '🔙 Voltar', callback_data: 'back_to_mode_selection' }]
      ]
    };

    if (this.isHardTestConfigComplete(chatId)) {
      keyboard.inline_keyboard.splice(
        keyboard.inline_keyboard.length - 1,
        0,
        [{ text: '▶️ Iniciar Sessão', callback_data: 'start_session' }]
      );
    }

    this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  showStandardConfigMenu(chatId) {
    const token = this.userStore.getToken(chatId);
    const goalPercentage = this.userStore.getGoalPercentage(chatId);
    const maxLosses = this.userStore.getMaxLosses(chatId);
    const useDigitDiffer = this.userStore.getDigitDifferStrategy(chatId);
    const useUnderOver = this.userStore.getUnderOverStrategy(chatId);
    const useMartingale = this.userStore.getMartingaleEvenOdd(chatId);
    const maxGlobalLoss = this.userStore.getMaxGlobalLoss(chatId);

    const tokenStatus = token ? '✅' : '❌';
    const digitDifferStatus = useDigitDiffer ? '✅' : '❌';
    const underOverStatus = useUnderOver ? '✅' : '❌';
    const martingaleStatus = useMartingale ? '✅' : '❌';
    const globalLossText = maxGlobalLoss ? `${maxGlobalLoss}%` : 'Não definido';

    const message = `
⚙️ *Configurações Default*

${tokenStatus} *Token API:* ${token ? 'Configurado' : 'Não configurado'}
🎯 *Meta de Lucro:* ${goalPercentage}%
🔄 *Martingale Even/Odd:* ${martingaleStatus}
🔢 *Max Losses (Martingale):* ${maxLosses}
🚨 *Max Loss Global:* ${globalLossText}
🎲 *Digit Differs:* ${digitDifferStatus}
📊 *Under/Over:* ${underOverStatus}

Escolha o que deseja configurar:
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔑 Configurar Token', callback_data: 'config_token' }],
        [{ text: '🎯 Definir Meta de Lucro', callback_data: 'config_goal' }],
        [{ text: '🔄 Alternar Martingale Even/Odd', callback_data: 'toggle_martingale' }],
        [{ text: '🔢 Definir Max Losses', callback_data: 'config_max_losses' }],
        [{ text: '🚨 Definir Max Loss Global', callback_data: 'config_global_loss' }],
        [{ text: '🎲 Alternar Digit Differs', callback_data: 'toggle_digit_differ' }],
        [{ text: '📊 Alternar Under/Over', callback_data: 'toggle_under_over' }],
        [{ text: '🔙 Voltar', callback_data: 'back_to_mode_selection' }]
      ]
    };

    if (this.isStandardConfigComplete(chatId)) {
      keyboard.inline_keyboard.splice(
        keyboard.inline_keyboard.length - 1,
        0,
        [{ text: '▶️ Iniciar Sessão', callback_data: 'start_session' }]
      );
    }

    this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  setupCallbacks() {
    this.bot.on('callback_query', (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;

      // INICIAR SESSÃO
      if (data === 'start_session') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.sessionManager.startSession(chatId);
        return;
      }

      // Seleção de modo
      if (data === 'mode_standard') {
        this.userStore.setStrategyMode(chatId, 'standard');
        this.bot.answerCallbackQuery(query.id, { text: '✅ Modo Default selecionado' });
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }

      if (data === 'mode_ppcp') {
        this.userStore.setStrategyMode(chatId, 'ppcp');
        this.bot.answerCallbackQuery(query.id, { text: '✅ Modo PPCP selecionado' });
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }

      if (data === 'mode_digithunter') {
        this.userStore.setStrategyMode(chatId, 'digithunter');
        this.bot.answerCallbackQuery(query.id, { text: '✅ Modo DigitHunter selecionado' });
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }

      // HardTest: exige senha 159753 ao selecionar
      if (data === 'mode_hardtest') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '🔐 *Acesso Restrito*\n\nDigite a senha para habilitar a estratégia HardTest:',
          { parse_mode: 'Markdown' }
        );

        const passwordListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            const pwd = msg.text.trim();
            if (pwd === '159753') {
              this.userStore.setStrategyMode(chatId, 'hardtest');
              this.bot.sendMessage(chatId, '✅ HardTest habilitada para este chat.');
              this.bot.removeListener('message', passwordListener);
              this.showStrategyConfigMenu(chatId);
            } else {
              this.bot.sendMessage(chatId, '❌ Senha incorreta. A estratégia HardTest não foi habilitada.');
              this.bot.removeListener('message', passwordListener);
              this.showConfigMenu(chatId);
            }
          }
        };

        this.bot.on('message', passwordListener);
        return;
      }

      if (data === 'back_to_mode_selection') {
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showConfigMenu(chatId);
        return;
      }

      if (data === 'back_to_config') {
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }

      // Configurações comuns (token / goal / global loss)
      if (data === 'config_token') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '🔑 *Configurar Token API*\n\nEnvie seu token da Deriv:',
          { parse_mode: 'Markdown' }
        );
        
        const tokenListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            this.userStore.setToken(chatId, msg.text.trim());
            this.bot.sendMessage(chatId, '✅ Token configurado com sucesso!');
            this.bot.removeListener('message', tokenListener);
            this.showStrategyConfigMenu(chatId);
          }
        };
        
        this.bot.on('message', tokenListener);
        return;
      }

      if (data === 'config_goal') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '🎯 *Definir Meta de Lucro*\n\nEnvie a porcentagem desejada (ex: 5 para 5%):',
          { parse_mode: 'Markdown' }
        );
        
        const goalListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            const percentage = parseFloat(msg.text);
            if (!isNaN(percentage) && percentage > 0) {
              this.userStore.setGoalPercentage(chatId, percentage);
              this.bot.sendMessage(chatId, `✅ Meta definida para ${percentage}%`);
              this.bot.removeListener('message', goalListener);
              this.showStrategyConfigMenu(chatId);
            } else {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Tente novamente.');
            }
          }
        };
        
        this.bot.on('message', goalListener);
        return;
      }

      if (data === 'config_global_loss') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '🚨 *Definir Max Loss Global*\n\nEnvie a porcentagem máxima de perda (ex: 10 para -10%) ou "0" para desativar:',
          { parse_mode: 'Markdown' }
        );
        
        const lossListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            const percentage = parseFloat(msg.text);
            if (!isNaN(percentage) && percentage >= 0) {
              this.userStore.setMaxGlobalLoss(chatId, percentage === 0 ? null : percentage);
              this.bot.sendMessage(
                chatId,
                percentage === 0
                  ? '✅ Max Loss Global desativado'
                  : `✅ Max Loss Global definido para -${percentage}%`
              );
              this.bot.removeListener('message', lossListener);
              this.showStrategyConfigMenu(chatId);
            } else {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Tente novamente.');
            }
          }
        };
        
        this.bot.on('message', lossListener);
        return;
      }

      // PPCP
      if (data === 'config_ppcp_stake') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '💵 *Definir Stake Inicial PPCP*\n\nEnvie o valor em USD (ex: 1.0):',
          { parse_mode: 'Markdown' }
        );
        
        const stakeListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            const stake = parseFloat(msg.text);
            if (!isNaN(stake) && stake > 0) {
              this.userStore.setPPCPInitialStake(chatId, stake);
              this.bot.sendMessage(chatId, `✅ Stake inicial definida para ${stake.toFixed(2)} USD`);
              this.bot.removeListener('message', stakeListener);
              this.showStrategyConfigMenu(chatId);
            } else {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Tente novamente.');
            }
          }
        };
        
        this.bot.on('message', stakeListener);
        return;
      }

      if (data === 'config_ppcp_direction') {
        this.bot.answerCallbackQuery(query.id);
        
        const currentDirection = this.userStore.getPPCPDirection(chatId);
        
        const message = `
🎲 *Escolher Direção PPCP*

Quando detectar uma sequência de 10x:

*Contra:* 10x ODD → entrar EVEN | 10x EVEN → entrar ODD
*A Favor:* 10x ODD → entrar ODD | 10x EVEN → entrar EVEN

Direção atual: *${currentDirection === 'favor' ? 'A Favor' : 'Contra'}*
        `;

        const keyboard = {
          inline_keyboard: [
            [
              { text: currentDirection === 'against' ? '✅ Contra' : 'Contra', callback_data: 'direction_against' },
              { text: currentDirection === 'favor' ? '✅ A Favor' : 'A Favor', callback_data: 'direction_favor' }
            ],
            [{ text: '🔙 Voltar', callback_data: 'back_to_config' }]
          ]
        };

        this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
        return;
      }

      if (data === 'direction_against') {
        this.userStore.setPPCPDirection(chatId, 'against');
        this.bot.answerCallbackQuery(query.id, { text: '✅ Direção: Contra' });
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }

      if (data === 'direction_favor') {
        this.userStore.setPPCPDirection(chatId, 'favor');
        this.bot.answerCallbackQuery(query.id, { text: '✅ Direção: A Favor' });
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }

      // DigitHunter
      if (data === 'config_digithunter_stake') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '💵 *Definir Stake Inicial DigitHunter*\n\nEnvie o valor em USD (ex: 1.0):',
          { parse_mode: 'Markdown' }
        );
        
        const stakeListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            const stake = parseFloat(msg.text);
            if (!isNaN(stake) && stake > 0) {
              this.userStore.setDigitHunterInitialStake(chatId, stake);
              this.bot.sendMessage(chatId, `✅ Stake inicial definida para ${stake.toFixed(2)} USD`);
              this.bot.removeListener('message', stakeListener);
              this.showStrategyConfigMenu(chatId);
            } else {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Tente novamente.');
            }
          }
        };
        
        this.bot.on('message', stakeListener);
        return;
      }

      // HardTest - Meta do Ciclo
      if (data === 'config_hardtest_cycle_goal') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '🎯 *Definir Meta do Ciclo HardTest*\n\nEnvie a porcentagem de lucro desejada por ciclo (ex: 10 para 10%):',
          { parse_mode: 'Markdown' }
        );
        
        const cycleGoalListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            const percentage = parseFloat(msg.text);
            if (!isNaN(percentage) && percentage > 0) {
              this.userStore.setHardTestCycleGoal(chatId, percentage);
              this.bot.sendMessage(chatId, `✅ Meta do ciclo definida para ${percentage}%`);
              this.bot.removeListener('message', cycleGoalListener);
              this.showStrategyConfigMenu(chatId);
            } else {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Tente novamente.');
            }
          }
        };
        
        this.bot.on('message', cycleGoalListener);
        return;
      }

      // HardTest - Máximo de Recuperações
      if (data === 'config_hardtest_max_recoveries') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '🔁 *Definir Máximo de Recuperações HardTest*\n\nEnvie o número máximo de tentativas consecutivas de recuperação (ex: 20):',
          { parse_mode: 'Markdown' }
        );
        
        const maxRecoveriesListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            const maxRecoveries = parseInt(msg.text);
            if (!isNaN(maxRecoveries) && maxRecoveries > 0) {
              this.userStore.setHardTestMaxRecoveries(chatId, maxRecoveries);
              this.bot.sendMessage(chatId, `✅ Máximo de recuperações definido para ${maxRecoveries}`);
              this.bot.removeListener('message', maxRecoveriesListener);
              this.showStrategyConfigMenu(chatId);
            } else {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Tente novamente.');
            }
          }
        };
        
        this.bot.on('message', maxRecoveriesListener);
        return;
      }

      // Default – martingale / max losses / toggles
      if (data === 'toggle_martingale') {
        const current = this.userStore.getMartingaleEvenOdd(chatId);
        this.userStore.setMartingaleEvenOdd(chatId, !current);
        this.bot.answerCallbackQuery(query.id, { text: `✅ Martingale ${!current ? 'ativado' : 'desativado'}` });
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }

      if (data === 'config_max_losses') {
        this.bot.answerCallbackQuery(query.id);
        this.bot.sendMessage(
          chatId,
          '🔢 *Definir Max Losses*\n\nEnvie o número máximo de tentativas no Martingale (ex: 6):',
          { parse_mode: 'Markdown' }
        );
        
        const maxLossListener = (msg) => {
          if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
            const maxLosses = parseInt(msg.text);
            if (!isNaN(maxLosses) && maxLosses > 0) {
              this.userStore.setMaxLosses(chatId, maxLosses);
              this.bot.sendMessage(chatId, `✅ Max Losses definido para ${maxLosses}`);
              this.bot.removeListener('message', maxLossListener);
              this.showStrategyConfigMenu(chatId);
            } else {
              this.bot.sendMessage(chatId, '❌ Valor inválido. Tente novamente.');
            }
          }
        };
        
        this.bot.on('message', maxLossListener);
        return;
      }

      if (data === 'toggle_digit_differ') {
        const current = this.userStore.getDigitDifferStrategy(chatId);
        this.userStore.setDigitDifferStrategy(chatId, !current);
        this.bot.answerCallbackQuery(query.id, { text: `✅ Digit Differs ${!current ? 'ativado' : 'desativado'}` });
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }

      if (data === 'toggle_under_over') {
        const current = this.userStore.getUnderOverStrategy(chatId);
        this.userStore.setUnderOverStrategy(chatId, !current);
        this.bot.answerCallbackQuery(query.id, { text: `✅ Under/Over ${!current ? 'ativado' : 'desativado'}` });
        this.bot.deleteMessage(chatId, query.message.message_id);
        this.showStrategyConfigMenu(chatId);
        return;
      }
    });
  }

  start() {
    console.log('🤖 Vega Bot iniciado!');
  }
}