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

  setDerivToken(chatId, token) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
    this.users[chatId].derivToken = token;
    this.save();
  }

  setGoalPercentage(chatId, goal) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
    this.users[chatId].goalPercentage = goal;
    this.save();
  }

  setMaxLosses(chatId, maxLosses) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
    this.users[chatId].maxLosses = maxLosses;
    this.save();
  }

  setMaxGlobalLoss(chatId, maxGlobalLoss) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
    this.users[chatId].maxGlobalLoss = maxGlobalLoss;
    this.save();
  }

  setUseDigitDifferStrategy(chatId, value) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
    this.users[chatId].useDigitDifferStrategy = !!value;
    this.save();
  }

  setUseUnderOverStrategy(chatId, value) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
    this.users[chatId].useUnderOverStrategy = !!value;
    this.save();
  }

  setUseMartingaleEvenOdd(chatId, value) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
    this.users[chatId].useMartingaleEvenOdd = !!value;
    this.save();
  }
}