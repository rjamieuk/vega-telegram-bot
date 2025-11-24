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

    // --------- MODO ESTRATÉGIA ---------
    this.strategyMode = options.mode === 'ppcp'
      ? 'ppcp'
      : options.mode === 'digithunter'
        ? 'digithunter'
        : 'standard';

    if (this.strategyMode === 'ppcp') {
      // PPCP não usa DigitDiff/UnderOver, nem martingale padrão
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
        direction: options.ppcpDirection || 'against' // 'against' ou 'favor'
      };

      this.digitHunterState = null;

    } else if (this.strategyMode === 'digithunter') {
      // DigitHunter: não usa Even/Odd nem Under/Over, nem martingale padrão
      this.useDigitDifferStrategy = false;
      this.useUnderOverStrategy = false;
      this.useMartingaleEvenOdd = false;
      this.ppcpState = null;

      this.digitHunterState = {
        initialStake: options.digitHunterInitialStake || 1.0,
        currentStake: options.digitHunterInitialStake || 1.0,
        inSequence: false,     // se está repetindo matches para recuperar
        targetDigit: null,     // dígito que estamos caçando (0-9)
        lastSymbol: null,      // ativo onde entrou
        sessionProfit: 0,
        sessionTrades: []
      };

    } else {
      // Modo padrão (Default)
      this.useDigitDifferStrategy = useDigitDifferStrategy;
      this.useUnderOverStrategy = useUnderOverStrategy;
      this.useMartingaleEvenOdd = useMartingaleEvenOdd;
      this.ppcpState = null;
      this.digitHunterState = null;
    }

    this.ws = null;
    this.isConnected = false;

    this.balance = { initial: 0, current: 0, currency: 'USD' };
    this.digitHistory = {};
    this.sessionHistory = [];
    this.startTime = Date.now();

    // Estado de trading para Even/Odd
    this.tradingState = {
      isActive: false,
      currentSymbol: null,
      currentType: null, // 'even' | 'odd'
      attemptNumber: 0,
      baseStake: 0,
      currentStake: 0,
      maxAttempts: this.maxLosses,
      contractId: null,
      sessionTrades: [],
      timeoutId: null
    };

    // Estado de trading separado para Digit Differs
    this.digitDifferState = {
      isActive: false,
      currentSymbol: null,
      predictionDigit: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    // Estado de trading para Under/Over
    this.underOverState = {
      isActive: false,
      currentSymbol: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    // Estado de trading para DigitHunter (digit matches)
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
      const proposalId = data.proposal.id;
      const contractType = data.proposal.contract_type;

      console.log(
        `[${this.chatId}] Proposta recebida: ${proposalId} (${contractType}), ask_price: ${data.proposal.ask_price}`
      );

      this.ws.send(JSON.stringify({
        buy: proposalId,
        price: data.proposal.ask_price
      }));
    }

    if (data.msg_type === 'buy' && data.buy) {
      const contractId = data.buy.contract_id;
      const contractType = data.buy.contract_type;

      console.log(
        `[${this.chatId}] ✅ Contrato comprado: ${contractId} (${contractType}) ` +
        `| estados: EvenOdd.isActive=${this.tradingState.isActive}, ` +
        `DigitDiff.isActive=${this.digitDifferState.isActive}, ` +
        `UnderOver.isActive=${this.underOverState.isActive}, ` +
        `DigitHunter.isActive=${this.digitHunterTradeState.isActive}`
      );

      if (this.tradingState.isActive &&
          !this.digitDifferState.isActive &&
          !this.underOverState.isActive &&
          !this.digitHunterTradeState.isActive) {

        this.tradingState.contractId = contractId;
        console.log(`[${this.chatId}] 🔵 Armazenado contractId Even/Odd: ${contractId}`);

        this.tradingState.timeoutId = setTimeout(() => {
          console.log(
            `[${this.chatId}] ⚠️ TIMEOUT: Contrato ${contractId} (Even/Odd) não retornou resultado em 15s`
          );
          this.bot.sendMessage(
            this.chatId,
            `⚠️ *Timeout no contrato Even/Odd*\n\n` +
            `O contrato ${contractId} não retornou resultado.\n` +
            `Resetando estado para continuar operando...`,
            { parse_mode: 'Markdown' }
          );
          this.resetTradingStateEvenOdd();
        }, 15000);

      } else if (this.digitDifferState.isActive &&
                 !this.tradingState.isActive &&
                 !this.underOverState.isActive &&
                 !this.digitHunterTradeState.isActive) {

        this.digitDifferState.contractId = contractId;
        console.log(`[${this.chatId}] 🟣 Armazenado contractId Digit Differs: ${contractId}`);

        this.digitDifferState.timeoutId = setTimeout(() => {
          console.log(
            `[${this.chatId}] ⚠️ TIMEOUT: Contrato ${contractId} (DigitDiff) não retornou resultado em 15s`
          );
          this.bot.sendMessage(
            this.chatId,
            `⚠️ *Timeout no contrato Digit Differs*\n\n` +
            `O contrato ${contractId} não retornou resultado.\n` +
            `Resetando estado para continuar operando...`,
            { parse_mode: 'Markdown' }
          );
          this.resetDigitDifferState();
        }, 15000);

      } else if (this.underOverState.isActive &&
                 !this.tradingState.isActive &&
                 !this.digitDifferState.isActive &&
                 !this.digitHunterTradeState.isActive) {

        this.underOverState.contractId = contractId;
        console.log(`[${this.chatId}] 🟠 Armazenado contractId Under/Over: ${contractId}`);

        this.underOverState.timeoutId = setTimeout(() => {
          console.log(
            `[${this.chatId}] ⚠️ TIMEOUT: Contrato ${contractId} (UnderOver) não retornou resultado em 15s`
          );
          this.bot.sendMessage(
            this.chatId,
            `⚠️ *Timeout no contrato Under/Over*\n\n` +
            `O contrato ${contractId} não retornou resultado.\n` +
            `Resetando estado para continuar operando...`,
            { parse_mode: 'Markdown' }
          );
          this.resetUnderOverState();
        }, 15000);

      } else if (this.digitHunterTradeState.isActive &&
                 !this.tradingState.isActive &&
                 !this.digitDifferState.isActive &&
                 !this.underOverState.isActive) {

        this.digitHunterTradeState.contractId = contractId;
        console.log(`[${this.chatId}] 🟥 Armazenado contractId DigitHunter: ${contractId}`);

        this.digitHunterTradeState.timeoutId = setTimeout(() => {
          console.log(
            `[${this.chatId}] ⚠️ TIMEOUT: Contrato ${contractId} (DigitHunter) não retornou resultado em 15s`
          );
          this.bot.sendMessage(
            this.chatId,
            `⚠️ *Timeout no contrato DigitHunter*\n\n` +
            `O contrato ${contractId} não retornou resultado.\n` +
            `Resetando estado para continuar operando...`,
            { parse_mode: 'Markdown' }
          );
          this.resetDigitHunterTradeState();
        }, 15000);

      } else {
        console.log(
          `[${this.chatId}] ⚠️ BUY recebido mas não há estratégia claramente ativa. ` +
          `EvenOdd.isActive=${this.tradingState.isActive}, ` +
          `DigitDiff.isActive=${this.digitDifferState.isActive}, ` +
          `UnderOver.isActive=${this.underOverState.isActive}, ` +
          `DigitHunter.isActive=${this.digitHunterTradeState.isActive}`
        );
      }

      this.ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: contractId,
        subscribe: 1
      }));
    }

    if (data.msg_type === 'proposal_open_contract') {
      const poc = data.proposal_open_contract;

      console.log(`[${this.chatId}] 📨 proposal_open_contract recebido:`, {
        contract_id: poc.contract_id,
        contract_type: poc.contract_type,
        is_sold: poc.is_sold,
        status: poc.status,
        profit: poc.profit,
        evenOddContractId: this.tradingState.contractId,
        digitDifferContractId: this.digitDifferState.contractId,
        underOverContractId: this.underOverState.contractId,
        digitHunterContractId: this.digitHunterTradeState.contractId
      });

      if (poc && poc.is_sold) {
        const profit = parseFloat(poc.profit);
        const contractId = poc.contract_id;

        console.log(`[${this.chatId}] 🏁 Contrato finalizado: ${contractId} - Profit: ${profit}`);

        if (this.tradingState.contractId === contractId) {
          console.log(`[${this.chatId}] ✅ Processando resultado Even/Odd`);

          if (this.tradingState.timeoutId) {
            clearTimeout(this.tradingState.timeoutId);
            this.tradingState.timeoutId = null;
          }

          this.handleEvenOddTradeResult(profit > 0, profit);

        } else if (this.digitDifferState.contractId === contractId) {
          console.log(`[${this.chatId}] ✅ Processando resultado Digit Differs`);

          if (this.digitDifferState.timeoutId) {
            clearTimeout(this.digitDifferState.timeoutId);
            this.digitDifferState.timeoutId = null;
          }

          this.handleDigitDifferResult(profit > 0, profit);

        } else if (this.underOverState.contractId === contractId) {
          console.log(`[${this.chatId}] ✅ Processando resultado Under/Over`);

          if (this.underOverState.timeoutId) {
            clearTimeout(this.underOverState.timeoutId);
            this.underOverState.timeoutId = null;
          }

          this.handleUnderOverResult(profit > 0, profit);

        } else if (this.digitHunterTradeState.contractId === contractId) {
          console.log(`[${this.chatId}] ✅ Processando resultado DigitHunter`);

          if (this.digitHunterTradeState.timeoutId) {
            clearTimeout(this.digitHunterTradeState.timeoutId);
            this.digitHunterTradeState.timeoutId = null;
          }

          this.handleDigitHunterResult(profit > 0, profit);

        } else {
          console.log(
            `[${this.chatId}] ⚠️ Contrato ${contractId} não corresponde a nenhum estado ativo`
          );
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
    if (this.digitHistory[symbol].length > 10) {
      this.digitHistory[symbol].shift();
    }

    const anyTradeActive =
      this.tradingState.isActive ||
      this.digitDifferState.isActive ||
      this.underOverState.isActive ||
      this.digitHunterTradeState.isActive;

    if (anyTradeActive) {
      return;
    }

    // -------- MODO PPCP: se está em sequência (Even/Odd), entra imediatamente --------
    if (this.strategyMode === 'ppcp' && this.ppcpState.inSequence) {
      const lastSymbol = this.ppcpState.lastSymbol;
      const lastType = this.ppcpState.lastType;

      if (lastSymbol && lastType) {
        console.log(
          `[${this.chatId}] PPCP em sequência: entrando imediatamente em ${lastSymbol} ${lastType}`
        );
        this.executeEvenOddTrade(lastSymbol, lastType, { isSequence: true });
        return;
      }
    }

    // -------- MODO DIGITHUNTER: se está em sequência, entra imediatamente (digit matches) --------
    if (this.strategyMode === 'digithunter' &&
        this.digitHunterState &&
        this.digitHunterState.inSequence &&
        this.digitHunterState.lastSymbol &&
        this.digitHunterState.targetDigit !== null) {

      console.log(
        `[${this.chatId}] DigitHunter em sequência: entrando imediatamente em ${this.digitHunterState.lastSymbol} digit ${this.digitHunterState.targetDigit}`
      );
      this.executeDigitHunterTrade(
        this.digitHunterState.lastSymbol,
        this.digitHunterState.targetDigit,
        { isSequence: true }
      );
      return;
    }

    // ===================== ROTEAMENTO POR MODO =====================

    // 1) Modo DIGITHUNTER: só faz a lógica DigitHunter
    if (this.strategyMode === 'digithunter') {
      const dhPattern = this.analyzePatternDigitHunter(symbol);
      if (dhPattern.isOpportunity) {
        this.executeDigitHunterTrade(symbol, dhPattern.predictionDigit, dhPattern);
      }
      return;
    }

    // 2) Modo PPCP: usa apenas Even/Odd com lógica de direção
    if (this.strategyMode === 'ppcp') {
      const pattern = this.analyzePatternEvenOdd(symbol);
      if (pattern.isOpportunity) {
        this.executeEvenOddTrade(symbol, pattern.suggestion, pattern);
      }
      return;
    }

    // 3) Modo STANDARD (Default): Even/Odd, Under/Over, DigitDiffers

    // 3.1) Oportunidades Even/Odd
    const pattern = this.analyzePatternEvenOdd(symbol);
    if (pattern.isOpportunity) {
      this.executeEvenOddTrade(symbol, pattern.suggestion, pattern);
      return;
    }

    // 3.2) Oportunidades Under/Over (se habilitado)
    if (this.useUnderOverStrategy) {
      const underOverPattern = this.analyzePatternUnderOver(symbol);
      if (underOverPattern.isOpportunity) {
        this.executeUnderOverTrade(symbol, underOverPattern);
        return;
      }
    }

    // 3.3) Oportunidades Digit Differs (se habilitado)
    if (this.useDigitDifferStrategy) {
      const diffPattern = this.analyzePatternDigitDiffer(symbol);
      if (diffPattern.isOpportunity) {
        this.executeDigitDifferTrade(symbol, diffPattern.predictionDigit, diffPattern);
      }
    }
  }

  // --------- ESTRATÉGIA EVEN/ODD (standard + PPCP) ---------
  analyzePatternEvenOdd(symbol) {
    const history = this.digitHistory[symbol];

    if (history.length < 10) {
      return { type: 'Coletando', count: history.length, isOpportunity: false };
    }

    const last10 = history.slice(-10);
    let evenCount = 0;
    let oddCount = 0;

    last10.forEach(digit => {
      if (parseInt(digit) % 2 === 0) evenCount++;
      else oddCount++;
    });

    // -------- LÓGICA DE DIREÇÃO (PPCP) --------
    if (this.strategyMode === 'ppcp') {
      const direction = this.ppcpState.direction;

      if (evenCount === 10) {
        if (direction === 'favor') {
          return { type: 'EVEN', count: 10, isOpportunity: true, suggestion: 'even' };
        } else {
          return { type: 'EVEN', count: 10, isOpportunity: true, suggestion: 'odd' };
        }
      } else if (oddCount === 10) {
        if (direction === 'favor') {
          return { type: 'ODD', count: 10, isOpportunity: true, suggestion: 'odd' };
        } else {
          return { type: 'ODD', count: 10, isOpportunity: true, suggestion: 'even' };
        }
      }
    } else {
      // Modo padrão: sempre vai contra
      if (evenCount === 10) {
        return { type: 'EVEN', count: 10, isOpportunity: true, suggestion: 'odd' };
      } else if (oddCount === 10) {
        return { type: 'ODD', count: 10, isOpportunity: true, suggestion: 'even' };
      }
    }

    return { type: 'MIXED', count: 0, isOpportunity: false };
  }

  executeEvenOddTrade(symbol, tradeType, patternInfo) {
    if (!this.isConnected) return;

    this.notifySearchingStop();

    // -------- MODO PPCP --------
    if (this.strategyMode === 'ppcp') {
      const stake = this.ppcpState.currentStake;

      this.tradingState.isActive = true;
      this.tradingState.currentSymbol = symbol;
      this.tradingState.currentType = tradeType;
      this.tradingState.currentStake = stake;

      this.ppcpState.lastSymbol = symbol;
      this.ppcpState.lastType = tradeType;

      const isSequence = patternInfo.isSequence || false;

      const message = isSequence
        ? `
🔄 *Entrada em Sequência (PPCP)*

📊 Ativo: ${this.symbols[symbol].name}
💰 Entrada: ${tradeType.toUpperCase()}
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
📌 Modo: Recuperação ativa
        `
        : `
🎯 *Oportunidade Detectada (PPCP)*

📊 Ativo: ${this.symbols[symbol].name}
🔢 Padrão: 10x ${patternInfo.type}
💰 Entrada: ${tradeType.toUpperCase()}
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
📌 Modo: PPCP
        `;

      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

      const proposal = {
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: tradeType === 'even' ? 'DIGITEVEN' : 'DIGITODD',
        currency: this.balance.currency,
        duration: 1,
        duration_unit: 't',
        symbol: symbol
      };

      this.ws.send(JSON.stringify(proposal));
      return;
    }

    // -------- MODO PADRÃO --------
    if (this.tradingState.attemptNumber === 0) {
      let base = this.balance.current * 0.005;
      if (base < 0.5) base = 0.5;
      this.tradingState.baseStake = Math.round(base * 100) / 100;
    }

    this.tradingState.isActive = true;
    this.tradingState.currentSymbol = symbol;
    this.tradingState.currentType = tradeType;
    this.tradingState.currentStake = this.calculateStakeEvenOdd();

    const martingaleStatus = this.useMartingaleEvenOdd ? '✅ Ativo' : '❌ Desativado';

    const message = `
🎯 *Oportunidade Detectada (Even/Odd)!*

📊 Ativo: ${this.symbols[symbol].name}
🔢 Padrão: 10x ${tradeType === 'even' ? 'ÍMPARES' : 'PARES'}
💰 Entrada: ${tradeType.toUpperCase()}
💵 Stake: ${this.balance.currency} ${this.tradingState.currentStake.toFixed(2)}
🔄 Martingale: ${martingaleStatus}
${this.useMartingaleEvenOdd ? `🔢 Tentativa: ${this.tradingState.attemptNumber + 1}/${this.tradingState.maxAttempts}` : ''}
    `;

    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    const proposal = {
      proposal: 1,
      amount: this.tradingState.currentStake,
      basis: 'stake',
      contract_type: tradeType === 'even' ? 'DIGITEVEN' : 'DIGITODD',
      currency: this.balance.currency,
      duration: 1,
      duration_unit: 't',
      symbol: symbol
    };

    this.ws.send(JSON.stringify(proposal));
  }

  calculateStakeEvenOdd() {
    if (this.useMartingaleEvenOdd) {
      const stake = this.tradingState.baseStake * Math.pow(2, this.tradingState.attemptNumber);
      return Math.round(stake * 100) / 100;
    } else {
      let stake = this.balance.current * 0.005;
      if (stake < 0.5) stake = 0.5;
      return Math.round(stake * 100) / 100;
    }
  }

  handleEvenOddTradeResult(isWin, profit) {
    console.log(`[${this.chatId}] handleEvenOddTradeResult - isWin: ${isWin}, profit: ${profit}`);

    // --------- MODO PPCP ---------
    if (this.strategyMode === 'ppcp') {
      const stake = this.tradingState.currentStake;
      this.ppcpState.sessionTrades.push({
        stake,
        profit,
        isWin
      });

      this.ppcpState.sessionProfit += profit;
      const sessionProfit = this.ppcpState.sessionProfit;

      if (isWin) {
        if (sessionProfit >= 0.01) {
          this.addSessionToHistory(true, sessionProfit);

          const message = `
✅ *Trade Vencedor (PPCP)*

💰 Lucro da Sessão: ${this.balance.currency} ${sessionProfit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%

📌 Sessão encerrada com sucesso.
🔁 Próxima sessão iniciará com stake inicial ${this.balance.currency} ${this.ppcpState.initialStake.toFixed(2)}.
          `;

          this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

          this.ppcpState.currentStake = this.ppcpState.initialStake;
          this.ppcpState.sessionTrades = [];
          this.ppcpState.sessionProfit = 0;
          this.ppcpState.inSequence = false;
          this.ppcpState.lastSymbol = null;
          this.ppcpState.lastType = null;

          this.resetTradingStateEvenOdd();
        } else {
          const nextStake = Math.round(stake * 1.94 * 100) / 100;
          this.ppcpState.currentStake = nextStake;
          this.ppcpState.inSequence = true;

          const message = `
✅ *Trade Vencedor (PPCP)*

💰 Lucro da Sessão: ${this.balance.currency} ${sessionProfit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%

➡️ Próxima stake: ${this.balance.currency} ${nextStake.toFixed(2)}
ℹ️ Entrando em sequência para completar recuperação.
          `;

          this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

          this.tradingState.isActive = false;
          this.tradingState.contractId = null;
          if (this.tradingState.timeoutId) {
            clearTimeout(this.tradingState.timeoutId);
            this.tradingState.timeoutId = null;
          }
        }
      } else {
        const nextStake = Math.round(stake * 1.5 * 100) / 100;
        this.ppcpState.currentStake = nextStake;
        this.ppcpState.inSequence = true;

        const message = `
❌ *Trade Perdido (PPCP)*

💸 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💰 Lucro da Sessão: ${this.balance.currency} ${sessionProfit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%

➡️ Próxima stake: ${this.balance.currency} ${nextStake.toFixed(2)}
ℹ️ Sistema de recuperação ativo. Entrando em sequência.
        `;

        this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

        this.tradingState.isActive = false;
        this.tradingState.contractId = null;
        if (this.tradingState.timeoutId) {
          clearTimeout(this.tradingState.timeoutId);
          this.tradingState.timeoutId = null;
        }
      }

      return;
    }

    // --------- MODO PADRÃO ---------
    this.tradingState.sessionTrades.push({
      attemptNumber: this.tradingState.attemptNumber + 1,
      stake: this.tradingState.currentStake,
      profit: profit,
      isWin: isWin
    });

    this.tradingState.attemptNumber++;

    const sessionProfitLoss = this.tradingState.sessionTrades.reduce((sum, t) => sum + t.profit, 0);

    if (isWin) {
      this.addSessionToHistory(true, sessionProfitLoss);

      const message = `
✅ *Trade Vencedor (Even/Odd)!*

💰 Lucro da Sessão: ${this.balance.currency} ${sessionProfitLoss.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%
      `;

      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      this.resetTradingStateEvenOdd();

    } else {
      if (this.useMartingaleEvenOdd) {
        if (this.tradingState.attemptNumber >= this.tradingState.maxAttempts) {
          this.addSessionToHistory(false, sessionProfitLoss);

          const summary = this.generateSummaryOnMaxLoss(sessionProfitLoss);
          this.bot.sendMessage(this.chatId, summary, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '⚙️ Voltar para Configurações', callback_data: 'back_to_config' }]
              ]
            }
          });

          this.resetTradingStateEvenOdd();
          this.disconnect();

          if (this.sessionManager) {
            this.sessionManager.stopSession(this.chatId);
          }

        } else {
          const message = `
❌ *Trade Perdido (Even/Odd)*

🔄 Tentando novamente com stake dobrado...
💵 Próximo Stake: ${this.balance.currency} ${this.calculateStakeEvenOdd().toFixed(2)}
🔢 Tentativa: ${this.tradingState.attemptNumber + 1}/${this.tradingState.maxAttempts}
          `;

          this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

          this.tradingState.contractId = null;

          setTimeout(() => {
            this.executeEvenOddTrade(this.tradingState.currentSymbol, this.tradingState.currentType, {});
          }, 1000);
        }
      } else {
        const message = `
❌ *Trade Perdido (Even/Odd)*

💸 Perda: ${this.balance.currency} ${Math.abs(profit).toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%

ℹ️ Martingale desativado - continuando a observar oportunidades...
        `;

        this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        this.resetTradingStateEvenOdd();
      }
    }
  }

  resetTradingStateEvenOdd() {
    console.log(`[${this.chatId}] Resetando estado Even/Odd`);

    if (this.tradingState.timeoutId) {
      clearTimeout(this.tradingState.timeoutId);
    }

    this.tradingState = {
      isActive: false,
      currentSymbol: null,
      currentType: null,
      attemptNumber: 0,
      baseStake: this.tradingState.baseStake || 0,
      currentStake: 0,
      maxAttempts: this.maxLosses,
      contractId: null,
      sessionTrades: [],
      timeoutId: null
    };

    if (this.isConnected &&
        !this.digitDifferState.isActive &&
        !this.underOverState.isActive &&
        !this.digitHunterTradeState.isActive) {
      this.notifySearchingStart();
    }
  }

  // --------- DIGIT DIFFERS (DEFAULT) ---------
  analyzePatternDigitDiffer(symbol) {
    const history = this.digitHistory[symbol];

    if (history.length < 10) {
      return { isOpportunity: false };
    }

    const last10 = history.slice(-10);
    const last4OfLast10 = last10.slice(-4);

    if (last4OfLast10[0] === last4OfLast10[1] &&
        last4OfLast10[1] === last4OfLast10[2] &&
        last4OfLast10[2] === last4OfLast10[3]) {
      const digit = last4OfLast10[3];
      return {
        isOpportunity: true,
        predictionDigit: digit,
        repetitionCount: 4,
        sequence: last10.join(',')
      };
    }

    return { isOpportunity: false };
  }

  executeDigitDifferTrade(symbol, predictionDigit, patternInfo) {
    if (!this.isConnected) return;
    if (this.strategyMode !== 'standard') return;

    this.notifySearchingStop();

    let stake = this.balance.current * 0.05;
    if (stake < 0.5) stake = 0.5;
    stake = Math.round(stake * 100) / 100;

    this.digitDifferState.isActive = true;
    this.digitDifferState.currentSymbol = symbol;
    this.digitDifferState.predictionDigit = predictionDigit;
    this.digitDifferState.stake = stake;

    const message = `
🎯 *Oportunidade Detectada (Digit Differs)!*

📊 Ativo: ${this.symbols[symbol].name}
🔢 Sequência: ${patternInfo.sequence}
🎲 Últimos 4 dígitos: *${predictionDigit}, ${predictionDigit}, ${predictionDigit}, ${predictionDigit}*
💰 Entrada: *DIGITDIFF* (diferente de ${predictionDigit})
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
    `;

    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    const proposal = {
      proposal: 1,
      amount: this.digitDifferState.stake,
      basis: 'stake',
      contract_type: 'DIGITDIFF',
      currency: this.balance.currency,
      duration: 1,
      duration_unit: 't',
      symbol: symbol,
      barrier: predictionDigit
    };

    this.ws.send(JSON.stringify(proposal));
  }

  handleDigitDifferResult(isWin, profit) {
    console.log(
      `[${this.chatId}] handleDigitDifferResult - isWin: ${isWin}, profit: ${profit}`
    );

    const message = isWin
      ? `
✅ *Trade Vencedor (Digit Differs)!*

💰 Lucro: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%
      `
      : `
❌ *Trade Perdido (Digit Differs)*

💸 Perda: ${this.balance.currency} ${Math.abs(profit).toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%
      `;

    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    this.resetDigitDifferState();
  }

  resetDigitDifferState() {
    console.log(`[${this.chatId}] Resetando estado Digit Differs`);

    if (this.digitDifferState.timeoutId) {
      clearTimeout(this.digitDifferState.timeoutId);
    }

    this.digitDifferState = {
      isActive: false,
      currentSymbol: null,
      predictionDigit: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    if (this.isConnected &&
        !this.tradingState.isActive &&
        !this.underOverState.isActive &&
        !this.digitHunterTradeState.isActive) {
      this.notifySearchingStart();
    }
  }

  // --------- UNDER/OVER (DEFAULT) ---------
  analyzePatternUnderOver(symbol) {
    const history = this.digitHistory[symbol];

    if (history.length < 10) {
      return { isOpportunity: false };
    }

    const last10 = history.slice(-10);
    const allAbove6 = last10.every(digit => parseInt(digit) > 6);

    if (allAbove6) {
      return {
        isOpportunity: true,
        sequence: last10.join(',')
      };
    }

    return { isOpportunity: false };
  }

  executeUnderOverTrade(symbol, patternInfo) {
    if (!this.isConnected) return;
    if (this.strategyMode !== 'standard') return;

    this.notifySearchingStop();

    let stake = this.balance.current * 0.01;
    if (stake < 0.5) stake = 0.5;
    stake = Math.round(stake * 100) / 100;

    this.underOverState.isActive = true;
    this.underOverState.currentSymbol = symbol;
    this.underOverState.stake = stake;

    const message = `
🎯 *Oportunidade Detectada (Under/Over)!*

📊 Ativo: ${this.symbols[symbol].name}
🔢 Sequência: ${patternInfo.sequence}
📉 Todos os 10 dígitos > 6 (7, 8, 9)
💰 Entrada: *DIGITUNDER 7*
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
    `;

    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

    const proposal = {
      proposal: 1,
      amount: this.underOverState.stake,
      basis: 'stake',
      contract_type: 'DIGITUNDER',
      currency: this.balance.currency,
      duration: 1,
      duration_unit: 't',
      symbol: symbol,
      barrier: '7'
    };

    this.ws.send(JSON.stringify(proposal));
  }

  handleUnderOverResult(isWin, profit) {
    console.log(
      `[${this.chatId}] handleUnderOverResult - isWin: ${isWin}, profit: ${profit}`
    );

    const message = isWin
      ? `
✅ *Trade Vencedor (Under/Over)!*

💰 Lucro: ${this.balance.currency} ${profit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%
      `
      : `
❌ *Trade Perdido (Under/Over)*

💸 Perda: ${this.balance.currency} ${Math.abs(profit).toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%
      `;

    this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    this.resetUnderOverState();
  }

  resetUnderOverState() {
    console.log(`[${this.chatId}] Resetando estado Under/Over`);

    if (this.underOverState.timeoutId) {
      clearTimeout(this.underOverState.timeoutId);
    }

    this.underOverState = {
      isActive: false,
      currentSymbol: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    if (this.isConnected &&
        !this.tradingState.isActive &&
        !this.digitDifferState.isActive &&
        !this.digitHunterTradeState.isActive) {
      this.notifySearchingStart();
    }
  }

  // ============ DIGITHUNTER (4x mesmo dígito -> DIGITMATCH com recover 1.13x) ============

  analyzePatternDigitHunter(symbol) {
    const history = this.digitHistory[symbol];

    if (history.length < 4) {
      return { isOpportunity: false };
    }

    const last4 = history.slice(-4);

    if (last4[0] === last4[1] &&
        last4[1] === last4[2] &&
        last4[2] === last4[3]) {
      const digit = last4[3];
      return {
        isOpportunity: true,
        predictionDigit: digit,
        sequence: last4.join(',')
      };
    }

    return { isOpportunity: false };
  }

  executeDigitHunterTrade(symbol, predictionDigit, patternInfo) {
    if (!this.isConnected) return;
    if (this.strategyMode !== 'digithunter') return;

    this.notifySearchingStop();

    const stake = this.digitHunterState
      ? this.digitHunterState.currentStake
      : 1.0;

    this.digitHunterTradeState.isActive = true;
    this.digitHunterTradeState.currentSymbol = symbol;
    this.digitHunterTradeState.predictionDigit = predictionDigit;
    this.digitHunterTradeState.stake = stake;

    if (this.digitHunterState) {
      this.digitHunterState.targetDigit = predictionDigit;
      this.digitHunterState.lastSymbol = symbol;
    }

    const isSequence = patternInfo.isSequence || false;

    const message = isSequence
      ? `
🔄 *Entrada em Sequência (DigitHunter)*

📊 Ativo: ${this.symbols[symbol].name}
🎯 Dígito Alvo: *${predictionDigit}*
💰 Entrada: *DIGITMATCH ${predictionDigit}*
💵 Stake: ${this.balance.currency} ${stake.toFixed(2)}
📌 Recuperação ativa (fator 1.13x)
      `
      : `
🎯 *Oportunidade Detectada (DigitHunter)!*

📊 Ativo: ${this.symbols[symbol].name}
🔢 Sequência: ${patternInfo.sequence}
🎯 Dígito Alvo: *${predictionDigit}* (4x seguidas)
💰 Entrada: *DIGITMATCH ${predictionDigit}*
💵 Stake Inicial: ${this.balance.currency} ${stake.toFixed(2)}
📌 Estratégia DigitHunter (recuperação 1.13x)
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
  }

  handleDigitHunterResult(isWin, profit) {
    console.log(
      `[${this.chatId}] handleDigitHunterResult - isWin: ${isWin}, profit: ${profit}`
    );

    const stake = this.digitHunterTradeState.stake;
    const digit = this.digitHunterTradeState.predictionDigit;

    if (!this.digitHunterState) {
      // fallback de segurança
      this.resetDigitHunterTradeState();
      this.notifySearchingStart();
      return;
    }

    this.digitHunterState.sessionTrades.push({
      stake,
      profit,
      isWin
    });

    this.digitHunterState.sessionProfit += profit;
    const sessionProfit = this.digitHunterState.sessionProfit;

    if (isWin) {
      // Em DigitHunter, ao acertar, encerra a sessão DigitHunter e volta stake ao inicial
      this.addSessionToHistory(sessionProfit >= 0, sessionProfit);

      const message = `
✅ *Trade Vencedor (DigitHunter)!*

🎯 Dígito: *${digit}*
💰 Lucro da Sessão DigitHunter: ${this.balance.currency} ${sessionProfit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%

📌 Sessão DigitHunter encerrada.
🔁 Próxima sessão iniciará com stake inicial ${this.balance.currency} ${this.digitHunterState.initialStake.toFixed(2)}.
      `;

      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

      this.digitHunterState.currentStake = this.digitHunterState.initialStake;
      this.digitHunterState.inSequence = false;
      this.digitHunterState.targetDigit = null;
      this.digitHunterState.lastSymbol = null;
      this.digitHunterState.sessionProfit = 0;
      this.digitHunterState.sessionTrades = [];

      this.resetDigitHunterTradeState();

    } else {
      // LOSS -> insiste em matches com fator 1.13x
      const nextStakeRaw = this.digitHunterState.currentStake * 1.13;
      const nextStake = Math.round(nextStakeRaw * 100) / 100;
      this.digitHunterState.currentStake = nextStake;
      this.digitHunterState.inSequence = true;

      const message = `
❌ *Trade Perdido (DigitHunter)*

🎯 Dígito: *${digit}*
💸 Resultado: ${this.balance.currency} ${profit.toFixed(2)}
💰 Lucro da Sessão DigitHunter: ${this.balance.currency} ${sessionProfit.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%

➡️ Próxima stake (fator 1.13x): ${this.balance.currency} ${nextStake.toFixed(2)}
ℹ️ Continuando DigitMATCH no mesmo dígito até acertar.
      `;

      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });

      this.resetDigitHunterTradeState();

      // Próxima entrada será feita pelo handleTick, pois inSequence = true
    }
  }

  resetDigitHunterTradeState() {
    console.log(`[${this.chatId}] Resetando estado DigitHunter (trade)`);

    if (this.digitHunterTradeState.timeoutId) {
      clearTimeout(this.digitHunterTradeState.timeoutId);
    }

    this.digitHunterTradeState = {
      isActive: false,
      currentSymbol: null,
      predictionDigit: null,
      stake: 0,
      contractId: null,
      timeoutId: null
    };

    if (this.isConnected &&
        !this.tradingState.isActive &&
        !this.digitDifferState.isActive &&
        !this.underOverState.isActive &&
        (!this.digitHunterState || !this.digitHunterState.inSequence)) {
      this.notifySearchingStart();
    }
  }

  // --------- HELPERS PARA ANIMAÇÃO DE BUSCA ---------
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

  // --------- FUNÇÕES COMUNS ---------
  addSessionToHistory(isWin, profitLoss) {
    this.sessionHistory.push({
      timestamp: new Date().toISOString(),
      result: isWin ? 'WIN' : 'LOSS',
      profitLoss: profitLoss,
      attempts: this.tradingState.attemptNumber
    });
  }

  checkGoalReached() {
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

      if (this.sessionManager) {
        this.sessionManager.stopSession(this.chatId);
      }
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

      if (this.sessionManager) {
        this.sessionManager.stopSession(this.chatId);
      }
    }
  }

  getGrowthPercentage() {
    if (this.balance.initial === 0) return 0;
    return ((this.balance.current - this.balance.initial) / this.balance.initial) * 100;
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

✨ Sessão encerrada automaticamente!
    `;
  }

  getExecutionTime() {
    const elapsed = Date.now() - this.startTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  getStatus() {
    const profit = this.balance.current - this.balance.initial;
    const growth = this.getGrowthPercentage();
    const winSessions = this.sessionHistory.filter(s => s.result === 'WIN').length;
    const totalSessions = this.sessionHistory.length;
    const winRate = totalSessions > 0 ? (winSessions / totalSessions) * 100 : 0;

    return {
      executionTime: this.getExecutionTime(),
      currency: this.balance.currency,
      initialBalance: this.balance.initial,
      currentBalance: this.balance.current,
      profit: profit,
      growth: growth,
      goalPercentage: this.goalPercentage,
      maxGlobalLoss: this.maxGlobalLoss,
      totalSessions: totalSessions,
      winSessions: winSessions,
      lossSessions: totalSessions - winSessions,
      winRate: winRate,
      isTrading:
        this.tradingState.isActive ||
        this.digitDifferState.isActive ||
        this.underOverState.isActive ||
        this.digitHunterTradeState.isActive,
      useDigitDifferStrategy: this.useDigitDifferStrategy,
      useUnderOverStrategy: this.useUnderOverStrategy,
      useMartingaleEvenOdd: this.useMartingaleEvenOdd,
      strategyMode: this.strategyMode,
      ppcpState: this.ppcpState,
      digitHunterState: this.digitHunterState
    };
  }

  disconnect() {
    if (this.tradingState.timeoutId) {
      clearTimeout(this.tradingState.timeoutId);
    }
    if (this.digitDifferState.timeoutId) {
      clearTimeout(this.digitDifferState.timeoutId);
    }
    if (this.underOverState.timeoutId) {
      clearTimeout(this.underOverState.timeoutId);
    }
    if (this.digitHunterTradeState.timeoutId) {
      clearTimeout(this.digitHunterTradeState.timeoutId);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}