import WebSocket from 'ws';

export class DerivClient {
  constructor(token, goalPercentage, maxLosses, chatId, bot, useDigitDifferStrategy = false) {
    this.token = token;
    this.goalPercentage = goalPercentage;
    this.maxLosses = maxLosses ?? 6;
    this.chatId = chatId;
    this.bot = bot;
    this.useDigitDifferStrategy = useDigitDifferStrategy;
    
    this.ws = null;
    this.isConnected = false;
    
    this.balance = { initial: 0, current: 0, currency: 'USD' };
    this.digitHistory = {};
    this.sessionHistory = [];
    this.startTime = Date.now();
    
    // Estado de trading para estratégia Even/Odd (com martingale, sessões, etc.)
    this.tradingState = {
      isActive: false,
      currentSymbol: null,
      currentType: null,
      attemptNumber: 0,
      baseStake: 0,
      currentStake: 0,
      maxAttempts: this.maxLosses,
      contractId: null,
      sessionTrades: []
    };

    // Estado de trading separado para estratégia Digit Differs (sem gale, stake fixo 5%)
    this.digitDifferState = {
      isActive: false,
      currentSymbol: null,
      predictionDigit: null,
      stake: 0,
      contractId: null
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
    }

    if (data.msg_type === 'tick') {
      this.handleTick(data.tick);
    }

    if (data.msg_type === 'proposal' && data.proposal) {
      // A proposta é para Even/Odd ou Digit Differs?
      if (data.echo_req && (data.echo_req.contract_type === 'DIGITEVEN' || data.echo_req.contract_type === 'DIGITODD')) {
        this.buyContract(data.proposal.id, this.tradingState.currentStake);
      } else if (data.echo_req && data.echo_req.contract_type === 'DIGITDIFF') {
        this.buyContract(data.proposal.id, this.digitDifferState.stake);
      }
    }

    if (data.msg_type === 'buy' && data.buy) {
      const contractId = data.buy.contract_id;
      const contractType = data.buy.contract_type;
      
      console.log(`[${this.chatId}] Contrato comprado: ${contractId} (${contractType})`);
      
      // Armazena o contractId no estado correto
      if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') {
        this.tradingState.contractId = contractId;
      } else if (contractType === 'DIGITDIFF') {
        this.digitDifferState.contractId = contractId;
      }
      
      // Subscreve para receber atualizações do contrato
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
        const contractType = poc.contract_type;

        console.log(`[${this.chatId}] Contrato finalizado: ${contractId} (${contractType}) - Profit: ${profit}`);

        // Identifica qual estratégia pelo contract_type
        if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') {
          // Verifica se é o contrato que estamos esperando
          if (this.tradingState.contractId === contractId) {
            console.log(`[${this.chatId}] Processando resultado Even/Odd`);
            this.handleEvenOddTradeResult(profit > 0, profit);
          }
        } else if (contractType === 'DIGITDIFF') {
          // Verifica se é o contrato que estamos esperando
          if (this.digitDifferState.contractId === contractId) {
            console.log(`[${this.chatId}] Processando resultado Digit Differs`);
            this.handleDigitDifferResult(profit > 0, profit);
          }
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

    // Só bloqueia novas oportunidades se já tem trade ativo
    const anyTradeActive = this.tradingState.isActive || this.digitDifferState.isActive;
    if (anyTradeActive) {
      return;
    }
    
    // 1) Oportunidades Even/Odd (lógica original) - PRIORIDADE
    const pattern = this.analyzePatternEvenOdd(symbol);
    if (pattern.isOpportunity) {
      this.executeEvenOddTrade(symbol, pattern.suggestion, pattern);
      return;
    }

    // 2) Oportunidades Digit Differs (se habilitado)
    if (this.useDigitDifferStrategy) {
      const diffPattern = this.analyzePatternDigitDiffer(symbol);
      if (diffPattern.isOpportunity) {
        this.executeDigitDifferTrade(symbol, diffPattern.predictionDigit, diffPattern);
      }
    }
  }

  // --------- ESTRATÉGIA EVEN/ODD (original) ---------
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
    
    if (evenCount === 10) {
      return { type: 'EVEN', count: 10, isOpportunity: true, suggestion: 'odd' };
    } else if (oddCount === 10) {
      return { type: 'ODD', count: 10, isOpportunity: true, suggestion: 'even' };
    }
    
    return { type: 'MIXED', count: 0, isOpportunity: false };
  }

  executeEvenOddTrade(symbol, tradeType, patternInfo) {
    if (!this.isConnected) return;
    
    // Recalcula baseStake no início de cada sessão
    if (this.tradingState.attemptNumber === 0) {
      let base = this.balance.current * 0.005;
      if (base < 0.5) base = 0.5;
      this.tradingState.baseStake = Math.round(base * 100) / 100;
    }
    
    this.tradingState.isActive = true;
    this.tradingState.currentSymbol = symbol;
    this.tradingState.currentType = tradeType;
    this.tradingState.currentStake = this.calculateStakeEvenOdd();
    
    const message = `
🎯 *Oportunidade Detectada (Even/Odd)!*

📊 Ativo: ${this.symbols[symbol].name}
🔢 Padrão: 10x ${tradeType === 'even' ? 'ÍMPARES' : 'PARES'}
💰 Entrada: ${tradeType.toUpperCase()}
💵 Stake: ${this.balance.currency} ${this.tradingState.currentStake.toFixed(2)}
🔄 Tentativa: ${this.tradingState.attemptNumber + 1}/${this.tradingState.maxAttempts}
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
    const stake = this.tradingState.baseStake * Math.pow(2, this.tradingState.attemptNumber);
    return Math.round(stake * 100) / 100;
  }

  buyContract(proposalId, stakeAmount) {
    this.ws.send(JSON.stringify({
      buy: proposalId,
      price: stakeAmount
    }));
  }

  handleEvenOddTradeResult(isWin, profit) {
    console.log(`[${this.chatId}] handleEvenOddTradeResult - isWin: ${isWin}, profit: ${profit}`);
    
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
      
    } else if (this.tradingState.attemptNumber >= this.tradingState.maxAttempts) {
      this.addSessionToHistory(false, sessionProfitLoss);
      
      const summary = this.generateSummaryOnMaxLoss(sessionProfitLoss);
      this.bot.sendMessage(this.chatId, summary, { parse_mode: 'Markdown' });
      
      this.resetTradingStateEvenOdd();
      this.disconnect();
      
    } else {
      // Martingale continua
      const message = `
❌ *Trade Perdido (Even/Odd)*

🔄 Tentando novamente com stake dobrado...
💵 Próximo Stake: ${this.balance.currency} ${this.calculateStakeEvenOdd().toFixed(2)}
🔢 Tentativa: ${this.tradingState.attemptNumber + 1}/${this.tradingState.maxAttempts}
      `;
      
      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      
      // Reseta apenas o contractId para permitir nova compra
      this.tradingState.contractId = null;
      
      setTimeout(() => {
        this.executeEvenOddTrade(this.tradingState.currentSymbol, this.tradingState.currentType, {});
      }, 1000);
    }
  }

  resetTradingStateEvenOdd() {
    console.log(`[${this.chatId}] Resetando estado Even/Odd`);
    this.tradingState = {
      isActive: false,
      currentSymbol: null,
      currentType: null,
      attemptNumber: 0,
      baseStake: 0,
      currentStake: 0,
      maxAttempts: this.maxLosses,
      contractId: null,
      sessionTrades: []
    };
  }

  // --------- ESTRATÉGIA DIGIT DIFFERS (4 DÍGITOS) ---------
  analyzePatternDigitDiffer(symbol) {
    const history = this.digitHistory[symbol];
    
    if (history.length < 10) {
      return { isOpportunity: false };
    }

    const last10 = history.slice(-10);
    const last4OfLast10 = last10.slice(-4);
    
    // Verifica se os 4 últimos são iguais
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

    // 5% do capital, sem gale
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
    console.log(`[${this.chatId}] handleDigitDifferResult - isWin: ${isWin}, profit: ${profit}`);
    
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

    // Independente de win ou loss, só volta a observar
    this.resetDigitDifferState();
  }

  resetDigitDifferState() {
    console.log(`[${this.chatId}] Resetando estado Digit Differs`);
    this.digitDifferState = {
      isActive: false,
      currentSymbol: null,
      predictionDigit: null,
      stake: 0,
      contractId: null
    };
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
      this.bot.sendMessage(this.chatId, summary, { parse_mode: 'Markdown' });
      this.disconnect();
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
    
    return `
🎉 *META ATINGIDA!*

⏱ *Tempo de Execução:* ${executionTime}
💰 *Saldo Inicial:* ${this.balance.currency} ${this.balance.initial.toFixed(2)}
💵 *Saldo Final:* ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 *Lucro Total:* ${this.balance.currency} ${profit.toFixed(2)}
📊 *Crescimento:* ${growth.toFixed(2)}%
🎯 *Meta:* ${this.goalPercentage}%

📋 *Total de Sessões (Even/Odd):* ${totalSessions}
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
🛑 *Sessão Encerrada por Máximo de Loss (Even/Odd)*

⏱ *Tempo de Execução:* ${executionTime}
💰 *Saldo Inicial:* ${this.balance.currency} ${this.balance.initial.toFixed(2)}
💵 *Saldo Final:* ${this.balance.currency} ${this.balance.current.toFixed(2)}
📉 *Lucro/Prejuízo Total:* ${this.balance.currency} ${profit.toFixed(2)}
📊 *Crescimento:* ${growth.toFixed(2)}%
❌ *Última Sessão:* ${this.balance.currency} ${sessionProfitLoss.toFixed(2)}

📋 *Total de Sessões (Even/Odd):* ${totalSessions}
✅ *Vitórias:* ${winSessions}
❌ *Derrotas:* ${totalSessions - winSessions}
📊 *Taxa de Vitória:* ${winRate.toFixed(2)}%

Use /session para iniciar uma nova sessão quando desejar.
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
      totalSessions: totalSessions,
      winSessions: winSessions,
      lossSessions: totalSessions - winSessions,
      winRate: winRate,
      isTrading: this.tradingState.isActive || this.digitDifferState.isActive,
      useDigitDifferStrategy: this.useDigitDifferStrategy
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}