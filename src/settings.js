// アプリ設定(ログインアカウント・保存先など)の読み書き。
// 設定は config/settings.json に保存します(.gitignore 済み。GitHubには上がりません)。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SETTINGS_PATH = 'config/settings.json';

const DEFAULTS = {
  // ログインアカウント一覧: { label, username, password }
  //  label    … 表示用の名前(空ならusernameを使用)
  //  username … Xのユーザー名/メール/電話番号
  //  password … パスワード(自動ログイン用。ローカルにのみ保存)
  accounts: [],
  // 現在使用するアカウントのインデックス(-1 = 手動ログイン)
  activeAccount: -1,
  // 保存先ディレクトリ(空なら既定の output/)
  outputDir: '',
};

export function loadSettings() {
  try {
    const data = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

// 使用中アカウントを返す(なければ null = 手動ログイン)
export function getActiveAccount(settings) {
  const i = settings.activeAccount;
  if (i < 0 || i >= settings.accounts.length) return null;
  return settings.accounts[i];
}

// アカウントごとにセッション(Cookie)ファイルを分ける
export function authStatePathFor(account) {
  if (!account) return 'auth/state.json';
  const key = (account.username || account.label || 'default').replace(/[^\w.-]/g, '_');
  return join('auth', `state_${key}.json`);
}

export function accountDisplayName(account, index) {
  const name = account.label || account.username || '(名称未設定)';
  return `${index + 1}. ${name}${account.password ? '' : '(パスワード未設定=手動ログイン)'}`;
}
