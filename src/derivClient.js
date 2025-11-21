import WebSocket from 'ws';

export class DerivClient {
  constructor(token, goalPercentage, maxLosses, chatId, bot) {
    this.token = token;
    this.goalPercentage = goalPercentage;
    this.maxLosses = maxLosses ?? 6;
    this.chatId = chatId;
    this.bot = bot;
    
    this.ws = null;
    this.isConnected = false;
    
    this.balance = { initial: 0, current: 0, currency: 'USD' };
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
      sessionTrades: []
    };
    
    // CORRIGIDO: Adicionados Volatility 30 e 90 com 3 casas decimais
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

    if (data.msg_type === 'proposal' && this.tradingState.isActive && data.proposal) {
      this.buyContract(data.proposal.id);
    }

    if (data.msg_type === 'buy' && data.buy) {
      this.tradingState.contractId = data.buy.contract_id;
      this.ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: this.tradingState.contractId,
        subscribe: 1
      }));
    }

    if (data.msg_type === 'proposal_open_contract') {
      if (data.proposal_open_contract && data.proposal_open_contract.is_sold) {
        const profit = parseFloat(data.proposal_open_contract.profit);
        this.handleTradeResult(profit > 0, profit);
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
    
    const pattern = this.analyzePattern(symbol);
    
    if (pattern.isOpportunity && !this.tradingState.isActive) {
      this.executeTrade(symbol, pattern.suggestion);
    }
  }

  analyzePattern(symbol) {
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

  executeTrade(symbol, tradeType) {
    if (!this.isConnected) return;
    
    if (this.tradingState.baseStake === 0) {
      let base = this.balance.current * 0.005;
      if (base < 0.5) base = 0.5;
      this.tradingState.baseStake = Math.round(base * 100) / 100;
    }
    
    this.tradingState.isActive = true;
    this.tradingState.currentSymbol = symbol;
    this.tradingState.currentType = tradeType;
    this.tradingState.currentStake = this.calculateStake();
    
    const message = `
🎯 *Oportunidade Detectada!*

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

  calculateStake() {
    const stake = this.tradingState.baseStake * Math.pow(2, this.tradingState.attemptNumber);
    return Math.round(stake * 100) / 100;
  }

  buyContract(proposalId) {
    this.ws.send(JSON.stringify({
      buy: proposalId,
      price: this.tradingState.currentStake
    }));
  }

  handleTradeResult(isWin, profit) {
    this.tradingState.sessionTrades.push({
      attemptNumber: this.tradingState.attemptNumber + 1,
      stake: this.tradingState.currentStake,
      profit: profit,
      isWin: isWin
    });
    
    this.tradingState.attemptNumber++;
    
    const sessionProfitLoss = this.tradingState.sessionTrades.reduce((sum, t) => sum + t.profit, 0);
    
    if (isWin) {
      // CORRIGIDO: Adiciona sessão ao histórico ANTES de resetar
      this.addSessionToHistory(true, sessionProfitLoss);
      
      const message = `
✅ *Trade Vencedor!*

💰 Lucro da Sessão: ${this.balance.currency} ${sessionProfitLoss.toFixed(2)}
💵 Saldo Atual: ${this.balance.currency} ${this.balance.current.toFixed(2)}
📈 Crescimento: ${this.getGrowthPercentage().toFixed(2)}%
🎯 Meta: ${this.goalPercentage}%
      `;
      
      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      this.resetTradingState();
      
    } else if (this.tradingState.attemptNumber >= this.tradingState.maxAttempts) {
      // CORRIGIDO: Adiciona sessão ao histórico ANTES de resetar
      this.addSessionToHistory(false, sessionProfitLoss);
      
      const summary = this.generateSummaryOnMaxLoss(sessionProfitLoss);
      this.bot.sendMessage(this.chatId, summary, { parse_mode: 'Markdown' });
      
      this.resetTradingState();
      this.disconnect();
      
    } else {
      const message = `
❌ *Trade Perdido*

🔄 Tentando novamente com stake dobrado...
💵 Próximo Stake: ${this.balance.currency} ${this.calculateStake().toFixed(2)}
🔢 Tentativa: ${this.tradingState.attemptNumber + 1}/${this.tradingState.maxAttempts}
      `;
      
      this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      
      setTimeout(() => {
        this.executeTrade(this.tradingState.currentSymbol, this.tradingState.currentType);
      }, 500);
    }
  }

  resetTradingState() {
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
      isTrading: this.tradingState.isActive
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