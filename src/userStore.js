import fs from 'fs';
import path from 'path';

export class UserStore {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.filePath = path.join(this.dataDir, 'users.json');
    this.users = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
    
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify({}));
        return {};
      }
    
      const data = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Erro ao carregar users.json:', error);
      return {};
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Erro ao salvar users.json:', error);
    }
  }

  getUser(chatId) {
    return this.users[chatId] || null;
  }

  _ensureUser(chatId) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
  }

  setDerivToken(chatId, token) {
    this._ensureUser(chatId);
    this.users[chatId].derivToken = token;
    this.save();
  }

  setGoalPercentage(chatId, goal) {
    this._ensureUser(chatId);
    this.users[chatId].goalPercentage = goal;
    this.save();
  }

  setMaxLosses(chatId, maxLosses) {
    this._ensureUser(chatId);
    this.users[chatId].maxLosses = maxLosses;
    this.save();
  }

  setMaxGlobalLoss(chatId, maxGlobalLoss) {
    this._ensureUser(chatId);
    this.users[chatId].maxGlobalLoss = maxGlobalLoss;
    this.save();
  }

  setUseDigitDifferStrategy(chatId, value) {
    this._ensureUser(chatId);
    this.users[chatId].useDigitDifferStrategy = !!value;
    this.save();
  }

  setUseUnderOverStrategy(chatId, value) {
    this._ensureUser(chatId);
    this.users[chatId].useUnderOverStrategy = !!value;
    this.save();
  }

  setUseMartingaleEvenOdd(chatId, value) {
    this._ensureUser(chatId);
    this.users[chatId].useMartingaleEvenOdd = !!value;
    this.save();
  }

  // -------- NOVOS CAMPOS PARA PPCP --------

  // 'standard' (padrão antigo) ou 'ppcp'
  setStrategyMode(chatId, mode) {
    this._ensureUser(chatId);
    this.users[chatId].strategyMode = mode === 'ppcp' ? 'ppcp' : 'standard';
    this.save();
  }

  // meta global da PPCP (em %)
  setPpcpGoalPercentage(chatId, goal) {
    this._ensureUser(chatId);
    this.users[chatId].ppcpGoalPercentage = goal;
    this.save();
  }

  // Max Loss Global PPCP (em %)
  setPpcpMaxGlobalLoss(chatId, value) {
    this._ensureUser(chatId);
    this.users[chatId].ppcpMaxGlobalLoss = value;
    this.save();
  }

  // Stake inicial da PPCP
  setPpcpInitialStake(chatId, stake) {
    this._ensureUser(chatId);
    this.users[chatId].ppcpInitialStake = stake;
    this.save();
  }
}