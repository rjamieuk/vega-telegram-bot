import fs from 'fs';
import path from 'path';

export class UserStore {
  constructor(filePath = './data/users.json') {
    this.filePath = filePath;
    this.users = {};
    this.load();
  }

  load() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        this.users = JSON.parse(data);
      }
    } catch (error) {
      console.error('Erro ao carregar users.json:', error);
      this.users = {};
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Erro ao salvar users.json:', error);
    }
  }

  _ensureUser(chatId) {
    if (!this.users[chatId]) {
      this.users[chatId] = {
        token: null,
        goalPercentage: 5,
        maxLosses: 6,
        useDigitDifferStrategy: false,
        useUnderOverStrategy: false,
        useMartingaleEvenOdd: true,
        maxGlobalLoss: null,
        strategyMode: 'standard',
        ppcpInitialStake: 1.0,
        ppcpDirection: 'against',
        digitHunterInitialStake: 1.0
      };
    }
    // Garantir que campos novos existam em usuários antigos
    if (this.users[chatId].strategyMode === undefined) {
      this.users[chatId].strategyMode = 'standard';
    }
    if (this.users[chatId].ppcpInitialStake === undefined) {
      this.users[chatId].ppcpInitialStake = 1.0;
    }
    if (this.users[chatId].ppcpDirection === undefined) {
      this.users[chatId].ppcpDirection = 'against';
    }
    if (this.users[chatId].digitHunterInitialStake === undefined) {
      this.users[chatId].digitHunterInitialStake = 1.0;
    }
  }

  setToken(chatId, token) {
    this._ensureUser(chatId);
    this.users[chatId].token = token;
    this.save();
  }

  getToken(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].token;
  }

  setGoalPercentage(chatId, percentage) {
    this._ensureUser(chatId);
    this.users[chatId].goalPercentage = percentage;
    this.save();
  }

  getGoalPercentage(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].goalPercentage;
  }

  setMaxLosses(chatId, maxLosses) {
    this._ensureUser(chatId);
    this.users[chatId].maxLosses = maxLosses;
    this.save();
  }

  getMaxLosses(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].maxLosses;
  }

  setDigitDifferStrategy(chatId, enabled) {
    this._ensureUser(chatId);
    this.users[chatId].useDigitDifferStrategy = enabled;
    this.save();
  }

  getDigitDifferStrategy(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].useDigitDifferStrategy;
  }

  setUnderOverStrategy(chatId, enabled) {
    this._ensureUser(chatId);
    this.users[chatId].useUnderOverStrategy = enabled;
    this.save();
  }

  getUnderOverStrategy(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].useUnderOverStrategy;
  }

  setMartingaleEvenOdd(chatId, enabled) {
    this._ensureUser(chatId);
    this.users[chatId].useMartingaleEvenOdd = enabled;
    this.save();
  }

  getMartingaleEvenOdd(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].useMartingaleEvenOdd;
  }

  setMaxGlobalLoss(chatId, percentage) {
    this._ensureUser(chatId);
    this.users[chatId].maxGlobalLoss = percentage;
    this.save();
  }

  getMaxGlobalLoss(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].maxGlobalLoss;
  }

  setStrategyMode(chatId, mode) {
    this._ensureUser(chatId);
    this.users[chatId].strategyMode = mode;
    this.save();
  }

  getStrategyMode(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].strategyMode || 'standard';
  }

  setPPCPInitialStake(chatId, stake) {
    this._ensureUser(chatId);
    this.users[chatId].ppcpInitialStake = stake;
    this.save();
  }

  getPPCPInitialStake(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].ppcpInitialStake || 1.0;
  }

  setPPCPDirection(chatId, direction) {
    this._ensureUser(chatId);
    this.users[chatId].ppcpDirection = direction;
    this.save();
  }

  getPPCPDirection(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].ppcpDirection || 'against';
  }

  setDigitHunterInitialStake(chatId, stake) {
    this._ensureUser(chatId);
    this.users[chatId].digitHunterInitialStake = stake;
    this.save();
  }

  getDigitHunterInitialStake(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId].digitHunterInitialStake || 1.0;
  }

  getUser(chatId) {
    this._ensureUser(chatId);
    return this.users[chatId];
  }

  hasToken(chatId) {
    this._ensureUser(chatId);
    return !!this.users[chatId].token;
  }
}