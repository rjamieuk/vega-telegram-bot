import WebSocket from 'ws';

export class DerivClient {
  constructor(
    token,
    goalPercentage,
    maxLosses,
    chatId,
    bot,
    useDigitDifferStrategy = false,
    useUnderOverStrategy = false,
    useMartingaleEvenOdd = true,
    maxGlobalLoss = null,
    sessionManager = null,
    options = {}
  ) {
    this.token = token;
    this.goalPercentage = goalPercentage;
    this.maxLosses = maxLosses ?? 6;
    this.maxGlobalLoss = maxGlobalLoss;
    this.chatId = chatId;
    this.bot = bot;
    this.sessionManager = sessionManager;

    this.strategyMode =
      options.mode === 'ppcp'
        ? 'ppcp'
        : options.mode === 'digithunter'
          ? 'digithunter'
          : options.mode === 'hardtest'
            ? 'hardtest'
            : 'standard';

    if (this.strategyMode === 'ppcp') {
      this.useDigitDifferStrategy = false;
      this.useUnderOverStrategy = false;
      this.useMartingaleEvenOdd = false;

      this.ppcpState = {
        initialStake: options.ppcpInitialStake || 1.0,
        currentStake: options.ppcpInitialStake || 1.0,
        sessionTrades: [],
        sessionProfit: 0,
        inSequence: false,
        lastSymbol: null,
        lastType: null,
        direction: options.ppcpDirection || 'against'
      };

      this.digitHunterState = null;
      this.hardTestState = null;

    } else if (this.strategyMode === 'digithunter') {
      this.useDigitDifferStrategy = false;
      this.useUnderOverStrategy = false;
      this.useMartingaleEvenOdd = false;
      this.ppcpState = null;

      this.digitHunterState = {
        initialStake: options.digitHunterInitialStake || 1.0,
        currentStake: options.digitHunterInitialStake || 1.0,
        inSequence: false,
        targetDigit: null,
        lastSymbol: null,
        sessionProfit: 0,
        sessionTrades: []
      };

      this.hardTestState = null;

    } else if (this.strategyMode === 'hardtest') {
      this.useDigitDifferStrategy = false;
      this.useUnderOverStrategy = false;
      this.useMartingaleEvenOdd = false;
      this.ppcpState = null;
      this.digitHunterState = null;

      this.hardTestState = {
        cycleNumber: 0,
        cycleBaseBalance: 0,
        cycleTargetProfit: 0,
        cycleProfitAccumulated: 0,
        cycleTradesCount: 0,
        currentStake: 0,
        baseStake: 0,
        lossesInARow: 0,
        winCycles: 0,
        lossCycles: 0,
        isPaused: false,
        cycleGoalPercentage: options.hardTestCycleGoal ?? 10,
        maxRecoveries: options.hardTestMaxRecoveries ?? 20,
        trade: {
          isActive: false,
          symbol: null,
          predictionDigit: null,
          stake: 0,
          contractId: null,
          timeoutId: null
        }
      };

    } else {
      this.useDigitDifferStrategy = useDigitDifferStrategy;
      this.useUnderOverStrategy = useUnderOverStrategy;
      this.useMartingaleEvenOdd = useMartingaleEvenOdd;
      this.ppcpState = null;
      this.digitHunterState = null;
      this.hardTestState = null;
    }

    this.ws = null;
    this.isConnected = false;

    this.balance = {
      initial: 0,
      current: 0,
      currency: 'USD'
    };

    this.digitHistory = {};
    this.sessionHistory = [];
    this.startTime = Date.now();

    this.tradingState = {
      isActive: false,
      currentSymbol: null,
      currentType: null,
      attemptNumber: 0,
      baseStake: 0,
      currentStake: 0,
      maxAttempts: this.maxLosses,
      contractId: null,
      sessionTrades: [],
      timeoutId: null
    };

    this.digitDifferState = {
      isActive: false,
      currentSymbol: null,
      predictionDigit: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    this.underOverState = {
      isActive: false,
      currentSymbol: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    this.digitHunterTradeState = {
      isActive: false,
      currentSymbol: null,
      predictionDigit: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    this.symbols = {
      '1HZ10V': { name: 'Volatility 10 (1s)', decimals: 2 },
      '1HZ25V': { name: 'Volatility 25 (1s)', decimals: 2 },
      '1HZ30V': { name: 'Volatility 30 (1s)', decimals: 3 },
      '1HZ50V': { name: 'Volatility 50 (1s)', decimals: 2 },
      '1HZ75V': { name: 'Volatility 75 (1s)', decimals: 2 },
      '1HZ90V': { name: 'Volatility 90 (1s)', decimals: 3 },
      '1HZ100V': { name: 'Volatility 100 (1s)', decimals: 2 }
    };

    Object.keys(this.symbols).forEach(symbol => {
      this.digitHistory[symbol] = [];
    });
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

      this.ws.on('open', () => {
        console.log(`[${this.chatId}] WebSocket conectado`);
        this.ws.send(JSON.stringify({ authorize: this.token }));
      });

      this.ws.on('message', (data) => {
        this.handleMessage(JSON.parse(data.toString()));
      });

      this.ws.on('error', (error) => {
        console.error(`[${this.chatId}] WebSocket error:`, error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log(`[${this.chatId}] WebSocket desconectado`);
        this.isConnected = false;
      });

      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Timeout na conexão'));
        } else {
          resolve();
        }
      }, 10000);
    });
  }

  handleMessage(data) {
    if (data.error) {
      console.error(`[${this.chatId}] Erro API:`, data.error);
      this.bot.sendMessage(this.chatId, `❌ Erro: ${data.error.message}`);
      return;
    }

    if (data.msg_type === 'authorize') {
      this.isConnected = true;
      this.balance.initial = parseFloat(data.authorize.balance);
      this.balance.current = parseFloat(data.authorize.balance);
      this.balance.currency = data.authorize.currency;

      if (this.strategyMode === 'hardtest' && this.hardTestState) {
        this.initHardTestCycle();
      }

      this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));

      Object.keys(this.symbols).forEach(symbol => {
        this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      });
    }

    if (data.msg_type === 'balance') {
      this.balance.current = parseFloat(data.balance.balance);
      this.checkGoalReached();
      this.checkGlobalLossReached();
    }

    if (data.msg_type === 'tick') {
      this.handleTick(data.tick);
    }

    if (data.msg_type === 'proposal' && data.proposal) {
      const proposal = data.proposal;
      const proposalId = proposal.id;
      const contractType = proposal.contract_type;

      console.log(
        `[${this.chatId}] Proposta recebida: ${proposalId} (${contractType}), ask_price: ${proposal.ask_price}`
      );

      this.ws.send(JSON.stringify({
        buy: proposalId,
        price: proposal.ask_price
      }));
    }

    if (data.msg_type === 'buy' && data.buy) {
      const contract = data.buy;
      const contractId = contract.contract_id;
      const contractType = contract.contract_type;

      console.log(
        `[${this.chatId}] ✅ Contrato comprado: ${contractId} (${contractType})`
      );

      if (this.tradingState.isActive &&
          !this.digitDifferState.isActive &&
          !this.underOverState.isActive &&
          !this.digitHunterTradeState.isActive &&
          !this.hardTestState?.trade?.isActive) {

        this.tradingState.contractId = contractId;
        this.tradingState.timeoutId = setTimeout(() => {
          this.bot.sendMessage(
            this.chatId,
            `⚠️ *Timeout no contrato Even/Odd*\n\nContrato ${contractId} sem retorno em 15s.\nResetando estado...`,
            { parse_mode: 'Markdown' }
          );
          this.resetTradingStateEvenOdd();
        }, 15000);

      } else if (this.digitDifferState.isActive &&
                 !this.tradingState.isActive &&
                 !this.underOverState.isActive &&
                 !this.digitHunterTradeState.isActive &&
                 !this.hardTestState?.trade?.isActive) {

        this.digitDifferState.contractId = contractId;
        this.digitDifferState.timeoutId = setTimeout(() => {
          this.bot.sendMessage(
            this.chatId,
            `⚠️ *Timeout no contrato Digit Differs*\n\nContrato ${contractId} sem retorno em 15s.\nResetando estado...`,
            { parse_mode: 'Markdown' }
          );
          this.resetDigitDifferState();
        }, 15000);

      } else if (this.underOverState.isActive &&
                 !this.tradingState.isActive &&
                 !this.digitDifferState.isActive &&
                 !this.digitHunterTradeState.isActive &&
                 !this.hardTestState?.trade?.isActive) {

        this.underOverState.contractId = contractId;
        this.underOverState.timeoutId = setTimeout(() => {
          this.bot.sendMessage(
            this.chatId,
            `⚠️ *Timeout no contrato Under/Over*\n\nContrato ${contractId} sem retorno em 15s.\nResetando estado...`,
            { parse_mode: 'Markdown' }
          );
          this.resetUnderOverState();
        }, 15000);

      } else if (this.digitHunterTradeState.isActive &&
                 !this.tradingState.isActive &&
                 !this.digitDifferState.isActive &&
                 !this.underOverState.isActive &&
                 !this.hardTestState?.trade?.isActive) {

        this.digitHunterTradeState.contractId = contractId;
        this.digitHunterTradeState.timeoutId = setTimeout(() => {
          this.bot.sendMessage(
            this.chatId,
            `⚠️ *Timeout no contrato DigitHunter*\n\nContrato ${contractId} sem retorno em 15s.\nResetando estado...`,
            { parse_mode: 'Markdown' }
          );
          this.resetDigitHunterTradeState();
        }, 15000);

      } else if (this.hardTestState?.trade?.isActive &&
                 !this.tradingState.isActive &&
                 !this.digitDifferState.isActive &&
                 !this.underOverState.isActive &&
                 !this.digitHunterTradeState.isActive) {

        this.hardTestState.trade.contractId = contractId;
        this.hardTestState.trade.timeoutId = setTimeout(() => {
          console.error(`[${this.chatId}] ⚠️ Timeout no contrato HardTest ${contractId}`);
          this.resetHardTestTradeState();
        }, 15000);
      }

      this.ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: contractId,
        subscribe: 1
      }));
    }

    if (data.msg_type === 'proposal_open_contract') {
      const poc = data.proposal_open_contract;

      if (poc && poc.is_sold) {
        const profit = parseFloat(poc.profit);
        const contractId = poc.contract_id;

        console.log(
          `[${this.chatId}] 🏁 Contrato finalizado: ${contractId} - Profit: ${profit}`
        );

        if (this.tradingState.contractId === contractId) {
          if (this.tradingState.timeoutId) {
            clearTimeout(this.tradingState.timeoutId);
            this.tradingState.timeoutId = null;
          }
          this.handleEvenOddTradeResult(profit > 0, profit);

        } else if (this.digitDifferState.contractId === contractId) {
          if (this.digitDifferState.timeoutId) {
            clearTimeout(this.digitDifferState.timeoutId);
            this.digitDifferState.timeoutId = null;
          }
          this.handleDigitDifferResult(profit > 0, profit);

        } else if (this.underOverState.contractId === contractId) {
          if (this.underOverState.timeoutId) {
            clearTimeout(this.underOverState.timeoutId);
            this.underOverState.timeoutId = null;
          }
          this.handleUnderOverResult(profit > 0, profit);

        } else if (this.digitHunterTradeState.contractId === contractId) {
          if (this.digitHunterTradeState.timeoutId) {
            clearTimeout(this.digitHunterTradeState.timeoutId);
            this.digitHunterTradeState.timeoutId = null;
          }
          this.handleDigitHunterResult(profit > 0, profit);

        } else if (this.hardTestState?.trade?.contractId === contractId) {
          if (this.hardTestState.trade.timeoutId) {
            clearTimeout(this.hardTestState.trade.timeoutId);
            this.hardTestState.trade.timeoutId = null;
          }
          this.handleHardTestResult(profit > 0, profit);
        }
      }
    }
  }

  handleTick(tick) {
    const symbol = tick.symbol;
    const price = tick.quote;

    const config = this.symbols[symbol];
    if (!config) return;

    const priceStr = parseFloat(price).toFixed(config.decimals);
    const lastDigit = priceStr.charAt(priceStr.length - 1);

    this.digitHistory[symbol].push(lastDigit);
    if (this.digitHistory[symbol].length > 20) {
      this.digitHistory[symbol].shift();
    }

    const anyTradeActive =
      this.tradingState.isActive ||
      this.digitDifferState.isActive ||
      this.underOverState.isActive ||
      this.digitHunterTradeState.isActive ||
      (this.hardTestState?.trade?.isActive ?? false);

    if (anyTradeActive) return;

    // HardTest em pausa (aguardando 10s após fim de ciclo)
    if (this.strategyMode === 'hardtest' && this.hardTestState?.isPaused) {
      return;
    }

    if (this.strategyMode === 'ppcp' && this.ppcpState?.inSequence) {
      const lastSymbol = this.ppcpState.lastSymbol;
      const lastType = this.ppcpState.lastType;
      if (lastSymbol && lastType) {
        this.executeEvenOddTrade(lastSymbol, lastType, { isSequence: true });
        return;
      }
    }

    if (this.strategyMode === 'digithunter' &&
        this.digitHunterState &&
        this.digitHunterState.inSequence &&
        this.digitHunterState.lastSymbol &&
        this.digitHunterState.targetDigit !== null) {

      this.executeDigitHunterTrade(
        this.digitHunterState.lastSymbol,
        this.digitHunterState.targetDigit,
        { isSequence: true }
      );
      return;
    }

    if (this.strategyMode === 'hardtest' && this.hardTestState) {
      this.executeHardTestTrade(symbol);
      return;
    }

    if (this.strategyMode === 'digithunter') {
      const dhPattern = this.analyzePatternDigitHunter(symbol);
      if (dhPattern.isOpportunity) {
        this.executeDigitHunterTrade(symbol, dhPattern.predictionDigit, dhPattern);
      }
      return;
    }

    if (this.strategyMode === 'ppcp') {
      const pattern = this.analyzePatternEvenOdd(symbol);
      if (pattern.isOpportunity) {
        this.executeEvenOddTrade(symbol, pattern.suggestion, pattern);
      }
      return;
    }

    const pattern = this.analyzePatternEvenOdd(symbol);
    if (pattern.isOpportunity) {
      this.executeEvenOddTrade(symbol, pattern.suggestion, pattern);
      return;
    }

    if (this.useUnderOverStrategy) {
      const underOverPattern = this.analyzePatternUnderOver(symbol);
      if (underOverPattern.isOpportunity) {
        this.executeUnderOverTrade(symbol, underOverPattern);
        return;
      }
    }

    if (this.useDigitDifferStrategy) {
      const diffPattern = this.analyzePatternDigitDiffer(symbol);
      if (diffPattern.isOpportunity) {
        this.executeDigitDifferTrade(symbol, diffPattern.predictionDigit, diffPattern);
      }
    }
  }

  analyzePatternEvenOdd(symbol) {
    const history = this.digitHistory[symbol];
    if (history.length < 10) return { isOpportunity: false };

    const last10 = history.slice(-10);
    const evenCount = last10.filter(d => parseInt(d) % 2 === 0).length;
    const oddCount = 10 - evenCount;

    if (evenCount === 10) {
      return { isOpportunity: true, suggestion: 'odd', count: 10, type: 'even' };
    }
    if (oddCount === 10) {
      return { isOpportunity: true, suggestion: 'even', count: 10, type: 'odd' };
    }
    return { isOpportunity: false };
  }

  executeEvenOddTrade(symbol, type, pattern) {
    if (!this.isConnected) return;

    this.notifySearchingStop();

    this.tradingState.isActive = true;
    this.tradingState.currentSymbol = symbol;
    this.tradingState.currentType = type;

    let stake = 0;
    if (this.strategyMode === 'ppcp' && this.ppcpState) {
      stake = this.ppcpState.currentStake;
    } else {
      if (this.tradingState.attemptNumber === 0) {
        const stakeInfo = this.calculateStakeEvenOdd();
        this.tradingState.baseStake = stakeInfo.baseStake;
        stake = stakeInfo.baseStake;
      } else {
        stake = this.tradingState.currentStake;
      }
    }

    this.tradingState.currentStake = stake;

    const digitHistory = this.digitHistory[symbol].slice(-10).join(' ');
    const message = `
🎯 *Entrada Encontrada (Even/Odd)*

📊 Ativo: ${this.symbols[symbol].name}
📈 Últimos 10 dígitos: ${digitHistory}
🎲 Tipo: *${type.toUpperCase()}*
💵 Entrada: ${this.balance.currency} ${stake.toFixed(2)}
    `;

    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    const contractType = type === 'even' ? 'DIGITEVEN' : 'DIGITODD';

    const proposal = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: contractType,
      currency: this.balance.currency,
      duration: 1,
      duration_unit: 't',
      symbol: symbol
    };

    this.ws.send(JSON.stringify(proposal));
  }

  calculateStakeEvenOdd() {
    const riskFactor = {
      1: 0.5,
      2: 1.5,
      3: 3.5,
      4: 7.5,
      5: 15.5,
      6: 31.0
    }[this.maxLosses] || 31.0;

    const riskAmount = (this.balance.current * riskFactor) / 100;
    let stake = riskAmount / Math.pow(2, this.maxLosses - 1);
    if (stake < 0.35) stake = 0.35;

    return { baseStake: stake };
  }

  handleEvenOddTradeResult(isWin, profit) {
    this.tradingState.sessionTrades.push({ isWin, profit });

    const stake = this.tradingState.currentStake;
    const type = this.tradingState.currentType;

    if (isWin) {
      this.tradingState.attemptNumber = 0;
      this.tradingState.currentStake = this.tradingState.baseStake;

      this.tradingState.isActive = false;
      this.addSessionToHistory(true, profit);

      const message = `
✅ *Trade Vencedor (Even/Odd)*

🎲 Tipo: *${type.toUpperCase()}*
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
💰 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📊 Crescimento Atual: ${this.getGrowthPercentage().toFixed(2)}%
      `;
      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

      if (this.isConnected &&
          !this.digitDifferState.isActive &&
          !this.underOverState.isActive &&
          !this.digitHunterTradeState.isActive &&
          !this.hardTestState?.trade?.isActive) {
        this.notifySearchingStart();
      }

    } else {
      this.tradingState.attemptNumber += 1;

      const message = `
❌ *Trade Perdedor (Even/Odd)*

🎲 Tipo: *${type.toUpperCase()}*
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
💸 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
🔁 Tentativa: ${this.tradingState.attemptNumber}/${this.tradingState.maxAttempts}
      `;
      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

      if (!this.useMartingaleEvenOdd || this.tradingState.attemptNumber >= this.tradingState.maxAttempts) {
        this.addSessionToHistory(false, profit);
        const summary = this.generateSummaryOnMaxLoss(profit);
        this.bot.sendMessage(this.chatId, summary, { parse_mode: 'Markdown' });
        this.disconnect();
        if (this.sessionManager) this.sessionManager.stopSession(this.chatId);
      } else {
        let nextStake = this.tradingState.currentStake * 2;
        this.tradingState.currentStake = nextStake;

        const messageMartingale = `
🔁 *Martingale Ativo (Even/Odd)*

🔼 Próxima Stake: ${this.balance.currency} ${nextStake.toFixed(2)}
📊 Tentativa: ${this.tradingState.attemptNumber + 1}/${this.tradingState.maxAttempts}
        `;
        this.bot.sendMessage(this.chatId, messageMartingale, { parse_mode: 'Markdown' });

        this.tradingState.isActive = false;
        if (this.isConnected &&
            !this.digitDifferState.isActive &&
            !this.underOverState.isActive &&
            !this.digitHunterTradeState.isActive &&
            !this.hardTestState?.trade?.isActive) {
          this.notifySearchingStart();
        }
      }
    }

    this.tradingState.isActive = false;
    this.tradingState.contractId = null;
  }

  resetTradingStateEvenOdd() {
    if (this.tradingState.timeoutId) {
      clearTimeout(this.tradingState.timeoutId);
      this.tradingState.timeoutId = null;
    }

    this.tradingState.isActive = false;
    this.tradingState.currentSymbol = null;
    this.tradingState.currentType = null;
    this.tradingState.attemptNumber = 0;
    this.tradingState.baseStake = 0;
    this.tradingState.currentStake = 0;
    this.tradingState.contractId = null;

    if (this.isConnected &&
        !this.digitDifferState.isActive &&
        !this.underOverState.isActive &&
        !this.digitHunterTradeState.isActive &&
        !this.hardTestState?.trade?.isActive) {
      this.notifySearchingStart();
    }
  }

  analyzePatternDigitDiffer(symbol) {
    const history = this.digitHistory[symbol];
    if (history.length < 5) return { isOpportunity: false };

    const last5 = history.slice(-5);
    const counts = {};
    last5.forEach(d => { counts[d] = (counts[d] || 0) + 1; });

    const overRepeated = Object.entries(counts)
      .filter(([, count]) => count >= 4)
      .map(([digit]) => digit);

    if (overRepeated.length === 0) return { isOpportunity: false };

    const repeatedDigit = parseInt(overRepeated[0], 10);
    const predictionDigit = (repeatedDigit + 1) % 10;

    return { isOpportunity: true, repeatedDigit, predictionDigit };
  }

  executeDigitDifferTrade(symbol, predictionDigit, pattern) {
    if (!this.isConnected) return;

    this.notifySearchingStop();

    this.digitDifferState.isActive = true;
    this.digitDifferState.currentSymbol = symbol;
    this.digitDifferState.predictionDigit = predictionDigit;

    const stake = 0.35;
    this.digitDifferState.stake = stake;

    const message = `
🎯 *Entrada Encontrada (Digit Differs)*

📊 Ativo: ${this.symbols[symbol].name}
🔢 Dígitos recentes: ${this.digitHistory[symbol].slice(-5).join(' ')}
🔁 Dígito repetido: ${pattern.repeatedDigit}
🎯 Previsão (diferente de): ${predictionDigit}
💵 Entrada: ${this.balance.currency} ${stake.toFixed(2)}
    `;
    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    const proposal = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: 'DIGITDIFF',
      currency: this.balance.currency,
      duration: 1,
      duration_unit: 't',
      symbol: symbol,
      barrier: String(predictionDigit)
    };
    this.ws.send(JSON.stringify(proposal));
  }

  handleDigitDifferResult(isWin, profit) {
    const stake = this.digitDifferState.stake;
    const predictionDigit = this.digitDifferState.predictionDigit;

    const message = isWin
      ? `
✅ *Trade Vencedor (Digit Differs)*

🎯 Previsão (diferente de): ${predictionDigit}
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
💰 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
    `
      : `
❌ *Trade Perdedor (Digit Differs)*

🎯 Previsão (diferente de): ${predictionDigit}
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
💸 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
    `;
    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    this.resetDigitDifferState();
  }

  resetDigitDifferState() {
    if (this.digitDifferState.timeoutId) {
      clearTimeout(this.digitDifferState.timeoutId);
      this.digitDifferState.timeoutId = null;
    }

    this.digitDifferState.isActive = false;
    this.digitDifferState.currentSymbol = null;
    this.digitDifferState.predictionDigit = null;
    this.digitDifferState.stake = 0;
    this.digitDifferState.contractId = null;

    if (this.isConnected &&
        !this.tradingState.isActive &&
        !this.underOverState.isActive &&
        !this.digitHunterTradeState.isActive &&
        !this.hardTestState?.trade?.isActive) {
      this.notifySearchingStart();
    }
  }

  analyzePatternUnderOver(symbol) {
    const history = this.digitHistory[symbol];
    if (history.length < 10) return { isOpportunity: false };

    const last10 = history.slice(-10).map(d => parseInt(d, 10));
    const high = last10.filter(d => d >= 5).length;
    const low = 10 - high;

    if (high === 10) return { isOpportunity: true, type: 'under' };
    if (low === 10) return { isOpportunity: true, type: 'over' };
    return { isOpportunity: false };
  }

  executeUnderOverTrade(symbol, pattern) {
    if (!this.isConnected) return;

    this.notifySearchingStop();

    this.underOverState.isActive = true;
    this.underOverState.currentSymbol = symbol;

    const stake = 0.35;
    this.underOverState.stake = stake;

    const message = `
🎯 *Entrada Encontrada (Under/Over)*

📊 Ativo: ${this.symbols[symbol].name}
🔢 Últimos 10 dígitos: ${this.digitHistory[symbol].slice(-10).join(' ')}
🎲 Tipo: *${pattern.type.toUpperCase()}*
💵 Entrada: ${this.balance.currency} ${stake.toFixed(2)}
    `;
    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    const contractType = pattern.type === 'under' ? 'DIGITUNDER' : 'DIGITOVER';
    const barrier = pattern.type === 'under' ? '5' : '4';

    const proposal = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: contractType,
      currency: this.balance.currency,
      duration: 1,
      duration_unit: 't',
      symbol: symbol,
      barrier: barrier
    };
    this.ws.send(JSON.stringify(proposal));
  }

  handleUnderOverResult(isWin, profit) {
    const stake = this.underOverState.stake;

    const message = isWin
      ? `
✅ *Trade Vencedor (Under/Over)*

💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
💰 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
    `
      : `
❌ *Trade Perdedor (Under/Over)*

💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
💸 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
    `;
    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    this.resetUnderOverState();
  }

  resetUnderOverState() {
    if (this.underOverState.timeoutId) {
      clearTimeout(this.underOverState.timeoutId);
      this.underOverState.timeoutId = null;
    }

    this.underOverState.isActive = false;
    this.underOverState.currentSymbol = null;
    this.underOverState.stake = 0;
    this.underOverState.contractId = null;

    if (this.isConnected &&
        !this.tradingState.isActive &&
        !this.digitDifferState.isActive &&
        !this.digitHunterTradeState.isActive &&
        !this.hardTestState?.trade?.isActive) {
      this.notifySearchingStart();
    }
  }

  analyzePatternDigitHunter(symbol) {
    const history = this.digitHistory[symbol];
    if (history.length < 4) return { isOpportunity: false };

    const last4 = history.slice(-4);
    const allSame = last4.every(d => d === last4[0]);
    if (!allSame) return { isOpportunity: false };

    const digit = parseInt(last4[0], 10);
    return { isOpportunity: true, symbol, predictionDigit: digit };
  }

  executeDigitHunterTrade(symbol, predictionDigit, pattern) {
    if (!this.isConnected || !this.digitHunterState) return;

    this.notifySearchingStop();

    this.digitHunterTradeState.isActive = true;
    this.digitHunterTradeState.currentSymbol = symbol;
    this.digitHunterTradeState.predictionDigit = predictionDigit;

    const stake = this.digitHunterState.currentStake;
    this.digitHunterTradeState.stake = stake;

    const message = `
🎯 *Entrada DigitHunter*

📊 Ativo: ${this.symbols[symbol].name}
🔁 Últimos 4 dígitos iguais: ${predictionDigit}${predictionDigit}${predictionDigit}${predictionDigit}
🎯 Previsão: *DIGITMATCH ${predictionDigit}*
💵 Entrada: ${this.balance.currency} ${stake.toFixed(2)}
    `;
    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    const proposal = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: 'DIGITMATCH',
      currency: this.balance.currency,
      duration: 1,
      duration_unit: 't',
      symbol: symbol,
      barrier: String(predictionDigit)
    };
    this.ws.send(JSON.stringify(proposal));

    this.digitHunterState.inSequence = pattern.isSequence || false;
    this.digitHunterState.lastSymbol = symbol;
    this.digitHunterState.targetDigit = predictionDigit;
  }

  handleDigitHunterResult(isWin, profit) {
    if (!this.digitHunterState) {
      this.resetDigitHunterTradeState();
      this.notifySearchingStart();
      return;
    }

    const stake = this.digitHunterTradeState.stake;
    const digit = this.digitHunterTradeState.predictionDigit;

    this.digitHunterState.sessionTrades.push({ isWin, profit });
    this.digitHunterState.sessionProfit += profit;

    if (isWin) {
      this.digitHunterState.currentStake = this.digitHunterState.initialStake;
      this.digitHunterState.inSequence = false;
      this.digitHunterState.lastSymbol = null;
      this.digitHunterState.targetDigit = null;

      const message = `
✅ *Trade Vencedor (DigitHunter)*

🎯 Dígito: *${digit}*
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
💰 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📊 Lucro da Sessão DigitHunter: ${this.balance.currency} ${this.digitHunterState.sessionProfit.toFixed(2)}
      `;
      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

      const summary = this.generateSummary();
      this.bot.sendMessage(this.chatId, summary, { parse_mode: 'Markdown' });

      this.disconnect();
      if (this.sessionManager) this.sessionManager.stopSession(this.chatId);

    } else {
      let nextStake = this.digitHunterState.currentStake * 1.12;
      nextStake = Math.round(nextStake * 100) / 100;
      this.digitHunterState.currentStake = nextStake;

      const message = `
❌ *Trade Perdedor (DigitHunter)*

🎯 Dígito: *${digit}*
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
💸 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}

🔁 *Recuperação DigitHunter*
➡️ Próxima stake (1.12x): ${this.balance.currency} ${nextStake.toFixed(2)}
      `;
      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

      this.digitHunterState.inSequence = true;
    }

    this.resetDigitHunterTradeState();
  }

  resetDigitHunterTradeState() {
    if (this.digitHunterTradeState.timeoutId) {
      clearTimeout(this.digitHunterTradeState.timeoutId);
      this.digitHunterTradeState.timeoutId = null;
    }

    this.digitHunterTradeState.isActive = false;
    this.digitHunterTradeState.currentSymbol = null;
    this.digitHunterTradeState.predictionDigit = null;
    this.digitHunterTradeState.stake = 0;
    this.digitHunterTradeState.contractId = null;

    if (this.isConnected &&
        !this.tradingState.isActive &&
        !this.digitDifferState.isActive &&
        !this.underOverState.isActive &&
        !this.hardTestState?.trade?.isActive) {
      this.notifySearchingStart();
    }
  }

  // ================= HARDTEST (MODO SILENCIOSO COM CONFIGURAÇÕES DINÂMICAS) =================

  initHardTestCycle() {
    if (!this.hardTestState) return;

    this.hardTestState.cycleNumber += 1;
    this.hardTestState.cycleBaseBalance = this.balance.current;
    this.hardTestState.cycleTargetProfit = this.balance.current * (this.hardTestState.cycleGoalPercentage / 100);
    this.hardTestState.cycleProfitAccumulated = 0;
    this.hardTestState.cycleTradesCount = 0;
    this.hardTestState.lossesInARow = 0;

    let stake = this.balance.current * 0.005;
    if (stake < 0.35) stake = 0.35;
    stake = Math.round(stake * 100) / 100;

    this.hardTestState.baseStake = stake;
    this.hardTestState.currentStake = stake;

    // Mensagem de INÍCIO do ciclo
    this.bot.sendMessage(this.chatId, `
🚀 *HardTest - Ciclo #${this.hardTestState.cycleNumber} Iniciado*

💰 Saldo Inicial: ${this.balance.currency} ${this.hardTestState.cycleBaseBalance.toFixed(2)}
🎯 Meta do Ciclo: +${this.hardTestState.cycleTargetProfit.toFixed(2)} USD (+${this.hardTestState.cycleGoalPercentage}%)
💵 Stake Base: ${this.balance.currency} ${stake.toFixed(2)}
🔁 Máx. Recuperações: ${this.hardTestState.maxRecoveries}

_Operações em modo silencioso. Resumo será enviado ao final do ciclo._
    `.trim(), { parse_mode: 'Markdown' });
  }

  executeHardTestTrade(symbol) {
    if (!this.isConnected || !this.hardTestState) return;

    const digit = Math.floor(Math.random() * 10);
    const stake = this.hardTestState.currentStake;

    this.hardTestState.trade.isActive = true;
    this.hardTestState.trade.symbol = symbol;
    this.hardTestState.trade.predictionDigit = digit;
    this.hardTestState.trade.stake = stake;

    // SEM mensagem de entrada aqui (modo silencioso)

    const proposal = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: 'DIGITMATCH',
      currency: this.balance.currency,
      duration: 1,
      duration_unit: 't',
      symbol: symbol,
      barrier: String(digit)
    };
    this.ws.send(JSON.stringify(proposal));
  }

  handleHardTestResult(isWin, profit) {
    if (!this.hardTestState) {
      this.resetHardTestTradeState();
      return;
    }

    this.hardTestState.cycleProfitAccumulated += profit;
    this.hardTestState.cycleTradesCount += 1;

    if (isWin) {
      this.hardTestState.lossesInARow = 0;
      this.hardTestState.currentStake = this.hardTestState.baseStake;

      // Verifica se atingiu meta do ciclo
      if (this.hardTestState.cycleProfitAccumulated >= this.hardTestState.cycleTargetProfit) {
        this.hardTestState.winCycles += 1;

        // Mensagem de RESUMO (meta atingida)
        this.bot.sendMessage(this.chatId, `
✅ *HardTest - Ciclo #${this.hardTestState.cycleNumber} Finalizado*

🎯 Meta de ${this.hardTestState.cycleGoalPercentage}% atingida neste ciclo.

📊 *Resumo do Ciclo*
• Entradas: ${this.hardTestState.cycleTradesCount}
• Lucro/Prejuízo: ${this.hardTestState.cycleProfitAccumulated.toFixed(2)} USD
• Saldo Inicial: ${this.hardTestState.cycleBaseBalance.toFixed(2)} USD
• Saldo Final Estimado: ${this.balance.current.toFixed(2)} USD

📊 *Histórico de Ciclos:*
✅ Vitórias: ${this.hardTestState.winCycles}
❌ Derrotas: ${this.hardTestState.lossCycles}

_Aguardando 10 segundos para iniciar novo ciclo..._
        `.trim(), { parse_mode: 'Markdown' });

        this.hardTestState.isPaused = true;
        this.resetHardTestTradeState();

        setTimeout(() => {
          if (this.hardTestState && this.isConnected) {
            this.hardTestState.isPaused = false;
            this.initHardTestCycle();
          }
        }, 10000);

        return;
      }

      // WIN mas ainda não bateu meta: pausa de 10s
      this.hardTestState.isPaused = true;
      this.resetHardTestTradeState();

      setTimeout(() => {
        if (this.hardTestState) {
          this.hardTestState.isPaused = false;
        }
      }, 10000);

      return;
    }

    // LOSS
    this.hardTestState.lossesInARow += 1;

    if (this.hardTestState.lossesInARow >= this.hardTestState.maxRecoveries) {
      this.hardTestState.lossCycles += 1;

      // Mensagem de RESUMO (máximo de recuperações atingido)
      this.bot.sendMessage(this.chatId, `
✅ *HardTest - Ciclo #${this.hardTestState.cycleNumber} Finalizado*

⚠️ Ciclo encerrado por atingir ${this.hardTestState.maxRecoveries} perdas consecutivas.

📊 *Resumo do Ciclo*
• Entradas: ${this.hardTestState.cycleTradesCount}
• Lucro/Prejuízo: ${this.hardTestState.cycleProfitAccumulated.toFixed(2)} USD
• Saldo Inicial: ${this.hardTestState.cycleBaseBalance.toFixed(2)} USD
• Saldo Final Estimado: ${this.balance.current.toFixed(2)} USD

📊 *Histórico de Ciclos:*
✅ Vitórias: ${this.hardTestState.winCycles}
❌ Derrotas: ${this.hardTestState.lossCycles}

_Aguardando 10 segundos para iniciar novo ciclo..._
      `.trim(), { parse_mode: 'Markdown' });

      this.hardTestState.isPaused = true;
      this.resetHardTestTradeState();

      setTimeout(() => {
        if (this.hardTestState && this.isConnected) {
          this.hardTestState.isPaused = false;
          this.initHardTestCycle();
        }
      }, 10000);

      return;
    }

    // Recuperação com fator 1.13x
    let nextStake = this.hardTestState.currentStake * 1.13;
    nextStake = Math.round(nextStake * 100) / 100;
    this.hardTestState.currentStake = nextStake;

    this.resetHardTestTradeState();
  }

  resetHardTestTradeState() {
    if (!this.hardTestState) return;

    if (this.hardTestState.trade.timeoutId) {
      clearTimeout(this.hardTestState.trade.timeoutId);
    }

    this.hardTestState.trade = {
      isActive: false,
      symbol: null,
      predictionDigit: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    // HardTest NÃO chama notifySearchingStart
  }

  // ================= STATUS / META / ENCERRAMENTO =================

  notifySearchingStop() {
    if (this.sessionManager && typeof this.sessionManager.stopSearchingAnimation === 'function') {
      this.sessionManager.stopSearchingAnimation(this.chatId);
    }
  }

  notifySearchingStart() {
    if (this.sessionManager && typeof this.sessionManager.notifyIdle === 'function') {
      this.sessionManager.notifyIdle(this.chatId);
    }
  }

  addSessionToHistory(isWin, profitLoss) {
    this.sessionHistory.push({
      timestamp: new Date().toISOString(),
      result: isWin ? 'WIN' : 'LOSS',
      profitLoss,
      attempts: this.tradingState.attemptNumber
    });
  }

  checkGoalReached() {
    if (this.strategyMode === 'hardtest') {
      return;
    }

    const growth = this.getGrowthPercentage();
    if (growth >= this.goalPercentage) {
      const summary = this.generateSummary();
      this.bot.sendMessage(this.chatId, summary, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Voltar para Configurações', callback_data: 'back_to_config' }]
          ]
        }
      });
      this.disconnect();
      if (this.sessionManager) this.sessionManager.stopSession(this.chatId);
    }
  }

  checkGlobalLossReached() {
    if (!this.maxGlobalLoss) return;

    const growth = this.getGrowthPercentage();
    if (growth <= -Math.abs(this.maxGlobalLoss)) {
      const summary = this.generateSummaryOnGlobalLoss();
      this.bot.sendMessage(this.chatId, summary, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Voltar para Configurações', callback_data: 'back_to_config' }]
          ]
        }
      });
      this.disconnect();
      if (this.sessionManager) this.sessionManager.stopSession(this.chatId);
    }
  }

  getGrowthPercentage() {
    if (this.balance.initial === 0) return 0;
    return ((this.balance.current - this.balance.initial) / this.balance.initial) * 100;
  }

  getExecutionTime() {
    const elapsed = Date.now() - this.startTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  generateSummary() {
    const profit = this.balance.current - this.balance.initial;
    const growth = this.getGrowthPercentage();
    const executionTime = this.getExecutionTime();

    const winSessions = this.sessionHistory.filter(s => s.result === 'WIN').length;
    const totalSessions = this.sessionHistory.length;
    const winRate = totalSessions > 0 ? (winSessions / totalSessions) * 100 : 0;

    let modeLabel = 'Default';
    if (this.strategyMode === 'ppcp') modeLabel = 'PPCP';
    if (this.strategyMode === 'digithunter') modeLabel = 'DigitHunter';
    if (this.strategyMode === 'hardtest') modeLabel = 'HardTest';

    let hardTestExtra = '';
    if (this.strategyMode === 'hardtest' && this.hardTestState) {
      hardTestExtra = `
📊 *Ciclos HardTest:*
✅ Vitórias: ${this.hardTestState.winCycles}
❌ Derrotas: ${this.hardTestState.lossCycles}
      `;
    }

    return `
🎉 *META ATINGIDA! (${modeLabel})*

⏱ *Tempo de Execução:* ${executionTime}
💰 *Saldo Inicial:* ${this.balance.currency} ${this.balance.initial.toFixed(2)}
💵 *Saldo Final:* ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 *Lucro Total:* ${this.balance.currency} ${profit.toFixed(2)}
📊 *Crescimento:* ${growth.toFixed(2)}%
🎯 *Meta:* ${this.goalPercentage}%

📋 *Total de Sessões:* ${totalSessions}
✅ *Vitórias:* ${winSessions}
❌ *Derrotas:* ${totalSessions - winSessions}
📊 *Taxa de Vitória:* ${winRate.toFixed(2)}%
${hardTestExtra}

✨ Sessão encerrada automaticamente!
    `;
  }

  generateSummaryOnMaxLoss(sessionProfitLoss) {
    const profit = this.balance.current - this.balance.initial;
    const growth = this.getGrowthPercentage();
    const executionTime = this.getExecutionTime();

    const winSessions = this.sessionHistory.filter(s => s.result === 'WIN').length;
    const totalSessions = this.sessionHistory.length;
    const winRate = totalSessions > 0 ? (winSessions / totalSessions) * 100 : 0;

    let hardTestExtra = '';
    if (this.strategyMode === 'hardtest' && this.hardTestState) {
      hardTestExtra = `
📊 *Ciclos HardTest:*
✅ Vitórias: ${this.hardTestState.winCycles}
❌ Derrotas: ${this.hardTestState.lossCycles}
      `;
    }

    return `
🛑 *Sessão Encerrada por Máximo de Loss*

⏱ *Tempo de Execução:* ${executionTime}
💰 *Saldo Inicial:* ${this.balance.currency} ${this.balance.initial.toFixed(2)}
💵 *Saldo Final:* ${this.balance.currency} ${this.balance.current.toFixed(2)}
📉 *Lucro/Prejuízo Total:* ${this.balance.currency} ${profit.toFixed(2)}
📊 *Crescimento:* ${growth.toFixed(2)}%
❌ *Última Sessão:* ${this.balance.currency} ${sessionProfitLoss.toFixed(2)}

📋 *Total de Sessões:* ${totalSessions}
✅ *Vitórias:* ${winSessions}
❌ *Derrotas:* ${totalSessions - winSessions}
📊 *Taxa de Vitória:* ${winRate.toFixed(2)}%
${hardTestExtra}

✨ Sessão encerrada automaticamente!
    `;
  }

  generateSummaryOnGlobalLoss() {
    const profit = this.balance.current - this.balance.initial;
    const growth = this.getGrowthPercentage();
    const executionTime = this.getExecutionTime();

    const winSessions = this.sessionHistory.filter(s => s.result === 'WIN').length;
    const totalSessions = this.sessionHistory.length;
    const winRate = totalSessions > 0 ? (winSessions / totalSessions) * 100 : 0;

    let hardTestExtra = '';
    if (this.strategyMode === 'hardtest' && this.hardTestState) {
      hardTestExtra = `
📊 *Ciclos HardTest:*
✅ Vitórias: ${this.hardTestState.winCycles}
❌ Derrotas: ${this.hardTestState.lossCycles}
      `;
    }

    return `
🚨 *Sessão Encerrada por Max Loss Global*

⏱ *Tempo de Execução:* ${executionTime}
💰 *Saldo Inicial:* ${this.balance.currency} ${this.balance.initial.toFixed(2)}
💵 *Saldo Final:* ${this.balance.currency} ${this.balance.current.toFixed(2)}
📉 *Prejuízo Total:* ${this.balance.currency} ${profit.toFixed(2)}
📊 *Crescimento:* ${growth.toFixed(2)}%
🚨 *Limite Global:* -${Math.abs(this.maxGlobalLoss)}%

📋 *Total de Sessões:* ${totalSessions}
✅ *Vitórias:* ${winSessions}
❌ *Derrotas:* ${totalSessions - winSessions}
📊 *Taxa de Vitória:* ${winRate.toFixed(2)}%
${hardTestExtra}

✨ Sessão encerrada automaticamente!
    `;
  }

  getStatus() {
    const profit = this.balance.current - this.balance.initial;
    const growth = this.getGrowthPercentage();

    const winSessions = this.sessionHistory.filter(s => s.result === 'WIN').length;
    const totalSessions = this.sessionHistory.length;
    const winRate = totalSessions > 0 ? (winSessions / totalSessions) * 100 : 0;

    let hardTestStateForStatus = null;
    if (this.strategyMode === 'hardtest' && this.hardTestState) {
      hardTestStateForStatus = {
        cycleNumber: this.hardTestState.cycleNumber,
        cycleBaseBalance: this.hardTestState.cycleBaseBalance,
        cycleTargetProfit: this.hardTestState.cycleTargetProfit,
        cycleProfitAccumulated: this.hardTestState.cycleProfitAccumulated,
        cycleTradesCount: this.hardTestState.cycleTradesCount,
        baseStake: this.hardTestState.baseStake,
        currentStake: this.hardTestState.currentStake,
        lossesInARow: this.hardTestState.lossesInARow,
        winCycles: this.hardTestState.winCycles,
        lossCycles: this.hardTestState.lossCycles,
        cycleGoalPercentage: this.hardTestState.cycleGoalPercentage,
        maxRecoveries: this.hardTestState.maxRecoveries
      };
    }

    return {
      executionTime: this.getExecutionTime(),
      currency: this.balance.currency,
      initialBalance: this.balance.initial,
      currentBalance: this.balance.current,
      profit,
      growth,
      goalPercentage: this.goalPercentage,
      maxGlobalLoss: this.maxGlobalLoss,
      totalSessions,
      winSessions,
      lossSessions: totalSessions - winSessions,
      winRate,
      isTrading:
        this.tradingState.isActive ||
        this.digitDifferState.isActive ||
        this.underOverState.isActive ||
        this.digitHunterTradeState.isActive ||
        (this.hardTestState?.trade?.isActive ?? false),
      useDigitDifferStrategy: this.useDigitDifferStrategy,
      useUnderOverStrategy: this.useUnderOverStrategy,
      useMartingaleEvenOdd: this.useMartingaleEvenOdd,
      strategyMode: this.strategyMode,
      ppcpState: this.ppcpState,
      digitHunterState: this.digitHunterState,
      hardTestState: hardTestStateForStatus
    };
  }

  disconnect() {
    if (this.tradingState.timeoutId) clearTimeout(this.tradingState.timeoutId);
    if (this.digitDifferState.timeoutId) clearTimeout(this.digitDifferState.timeoutId);
    if (this.underOverState.timeoutId) clearTimeout(this.underOverState.timeoutId);
    if (this.digitHunterTradeState.timeoutId) clearTimeout(this.digitHunterTradeState.timeoutId);
    if (this.hardTestState?.trade?.timeoutId) clearTimeout(this.hardTestState.trade.timeoutId);

    this.tradingState.timeoutId = null;
    this.digitDifferState.timeoutId = null;
    this.underOverState.timeoutId = null;
    this.digitHunterTradeState.timeoutId = null;
    if (this.hardTestState?.trade) this.hardTestState.trade.timeoutId = null;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}