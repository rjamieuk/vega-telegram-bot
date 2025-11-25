import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class UserStore {
  constructor() {
    this.usersFile = path.join(__dirname, 'users.json');
    this.users = this.loadUsers();
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.usersFile)) {
        const data = fs.readFileSync(this.usersFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
    }
    return {};
  }

  saveUsers() {
    try {
      fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Erro ao salvar usuários:', error);
    }
  }

  getUser(chatId) {
    return this.users[chatId] || null;
  }

  setUser(chatId, userData) {
    this.users[chatId] = { ...this.users[chatId], ...userData };
    this.saveUsers();
  }

  updateUser(chatId, updates) {
    if (!this.users[chatId]) {
      this.users[chatId] = {};
    }
    this.users[chatId] = { ...this.users[chatId], ...updates };
    this.saveUsers();
  }

  deleteUser(chatId) {
    delete this.users[chatId];
    this.saveUsers();
  }

  getAllUsers() {
    return this.users;
  }

  // ========== TOKEN ==========
  getToken(chatId) {
    const user = this.getUser(chatId);
    return user?.token || null;
  }

  setToken(chatId, token) {
    this.updateUser(chatId, { token });
  }

  // ========== STRATEGY MODE ==========
  getStrategyMode(chatId) {
    const user = this.getUser(chatId);
    return user?.strategyMode || 'standard';
  }

  setStrategyMode(chatId, mode) {
    this.updateUser(chatId, { strategyMode: mode });
  }

  // ========== GOAL PERCENTAGE (usado por Default, PPCP, DigitHunter) ==========
  getGoalPercentage(chatId) {
    const user = this.getUser(chatId);
    return user?.goalPercentage ?? 5;
  }

  setGoalPercentage(chatId, percentage) {
    this.updateUser(chatId, { goalPercentage: percentage });
  }

  // ========== MAX GLOBAL LOSS (todas as estratégias) ==========
  getMaxGlobalLoss(chatId) {
    const user = this.getUser(chatId);
    return user?.maxGlobalLoss ?? null;
  }

  setMaxGlobalLoss(chatId, percentage) {
    this.updateUser(chatId, { maxGlobalLoss: percentage });
  }

  // ========== DEFAULT STRATEGY ==========
  getMartingaleEvenOdd(chatId) {
    const user = this.getUser(chatId);
    return user?.useMartingaleEvenOdd ?? false;
  }

  setMartingaleEvenOdd(chatId, value) {
    this.updateUser(chatId, { useMartingaleEvenOdd: value });
  }

  getMaxLosses(chatId) {
    const user = this.getUser(chatId);
    return user?.maxLosses ?? 6;
  }

  setMaxLosses(chatId, value) {
    this.updateUser(chatId, { maxLosses: value });
  }

  getDigitDifferStrategy(chatId) {
    const user = this.getUser(chatId);
    return user?.useDigitDifferStrategy ?? false;
  }

  setDigitDifferStrategy(chatId, value) {
    this.updateUser(chatId, { useDigitDifferStrategy: value });
  }

  getUnderOverStrategy(chatId) {
    const user = this.getUser(chatId);
    return user?.useUnderOverStrategy ?? false;
  }

  setUnderOverStrategy(chatId, value) {
    this.updateUser(chatId, { useUnderOverStrategy: value });
  }

  // ========== PPCP STRATEGY ==========
  getPPCPInitialStake(chatId) {
    const user = this.getUser(chatId);
    return user?.ppcpInitialStake ?? 1.0;
  }

  setPPCPInitialStake(chatId, stake) {
    this.updateUser(chatId, { ppcpInitialStake: stake });
  }

  getPPCPDirection(chatId) {
    const user = this.getUser(chatId);
    return user?.ppcpDirection || 'against';
  }

  setPPCPDirection(chatId, direction) {
    this.updateUser(chatId, { ppcpDirection: direction });
  }

  // ========== DIGITHUNTER STRATEGY ==========
  getDigitHunterInitialStake(chatId) {
    const user = this.getUser(chatId);
    return user?.digitHunterInitialStake ?? 1.0;
  }

  setDigitHunterInitialStake(chatId, stake) {
    this.updateUser(chatId, { digitHunterInitialStake: stake });
  }

  // ========== HARDTEST STRATEGY ==========
  getHardTestCycleGoal(chatId) {
    const user = this.getUser(chatId);
    return user?.hardTestCycleGoal ?? 10;
  }

  setHardTestCycleGoal(chatId, value) {
    this.updateUser(chatId, { hardTestCycleGoal: value });
  }

  getHardTestMaxRecoveries(chatId) {
    const user = this.getUser(chatId);
    return user?.hardTestMaxRecoveries ?? 20;
  }

  setHardTestMaxRecoveries(chatId, value) {
    this.updateUser(chatId, { hardTestMaxRecoveries: value });
  }
}