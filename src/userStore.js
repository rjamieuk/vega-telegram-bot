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
    if (this.users[chatId]) {
      this.users[chatId] = { ...this.users[chatId], ...updates };
      this.saveUsers();
    }
  }

  deleteUser(chatId) {
    delete this.users[chatId];
    this.saveUsers();
  }

  getAllUsers() {
    return this.users;
  }
  // Adicione esses métodos no userStore.js

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