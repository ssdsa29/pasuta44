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
  // アプリ内で変更した設定値(CONFIG の既定値を上書きする)
  options: {},
  // 前回選んだ収集対象タブ(次回の既定になります)
  lastTabs: null,
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

// ---------------------------------------------------------------------------
// アプリ内から編集できる設定項目の定義。
// ここに1行足すだけで、設定メニューに項目が増えます。
//   key   … CONFIG のキー名
//   type  … 'number' | 'decimal' | 'boolean' | 'keywords' | 'columns'
//   min/max … 数値の許容範囲(範囲外は入力し直しになります)
// ---------------------------------------------------------------------------
export const OPTION_SCHEMA = [
  // --- 収集 ---
  { key: 'maxAccounts', group: '収集', label: '収集するアカウント数(タブごと)', type: 'number', min: 1, max: 200 },
  { key: 'maxTweetsPerAccount', group: '収集', label: '1アカウントあたりの投稿数', type: 'number', min: 1, max: 100 },
  { key: 'fetchReplies', group: '収集', label: 'リプライ(コメント)も取得する', type: 'boolean' },
  { key: 'maxRepliesPerTweet', group: '収集', label: '1投稿あたりのリプライ取得数', type: 'number', min: 1, max: 100 },
  { key: 'saveVideos', group: '収集', label: '動画も保存する', type: 'boolean' },
  { key: 'maxVideoMB', group: '収集', label: '動画1本あたりの上限(MB)', type: 'number', min: 1, max: 2000 },
  { key: 'saveComments', group: '収集', label: 'コメントを単体でも保存する', type: 'boolean' },
  { key: 'skipSeen', group: '収集', label: '取得済みの投稿はスキップする', type: 'boolean' },
  { key: 'keywords', group: '収集', label: 'キーワード絞り込み', type: 'keywords' },
  { key: 'maxRecommendAccounts', group: '収集', label: 'おすすめ欄から集めるアカウント数', type: 'number', min: 1, max: 500 },
  { key: 'maxScrolls', group: '収集', label: '最大スクロール回数', type: 'number', min: 1, max: 500 },

  // --- フォロー ---
  { key: 'maxFollowsPerRun', group: 'フォロー', label: '1回にフォローする上限(件)', type: 'number', min: 1, max: 400, warnOver: 50 },
  { key: 'followDelayMinMs', group: 'フォロー', label: 'フォロー間隔の最短(秒)', type: 'number', min: 1, max: 3600, unit: 'sec', warnUnder: 10 },
  { key: 'followDelayMaxMs', group: 'フォロー', label: 'フォロー間隔の最長(秒)', type: 'number', min: 1, max: 3600, unit: 'sec' },
  { key: 'maxFollowingExport', group: 'フォロー', label: 'フォロー中一覧の最大取得数', type: 'number', min: 1, max: 20000 },

  // --- 表示・動作 ---
  { key: 'maxParallelViews', group: '表示・動作', label: '同時表示するウィンドウ数', type: 'number', min: 1, max: 12, warnOver: 6 },
  { key: 'viewColumns', group: '表示・動作', label: 'タイル配置の列数', type: 'columns' },
  { key: 'headless', group: '表示・動作', label: 'ブラウザを隠して実行する', type: 'boolean' },
  { key: 'speedFactor', group: '表示・動作', label: '動作の速さ(1.0=標準/大きいほど慎重)', type: 'decimal', min: 0.2, max: 5 },
];

// 保存されている値を画面表示用の文字列にする
export function formatOption(opt, value) {
  switch (opt.type) {
    case 'boolean':
      return value ? 'はい' : 'いいえ';
    case 'keywords':
      return value?.length ? value.join(' ') : '(なし=すべて取得)';
    case 'columns':
      return value == null ? '自動' : `${value} 列`;
    case 'decimal':
      return `${value}`;
    default:
      return opt.unit === 'sec' ? `${Math.round(value / 1000)} 秒` : `${value}`;
  }
}

// 入力文字列を設定値に変換する。
// 戻り値: { ok: true, value } または { ok: false, message }
export function parseOption(opt, input) {
  const raw = String(input ?? '').trim();

  if (opt.type === 'boolean') {
    if (/^(y|yes|はい|1|true|on)$/i.test(raw)) return { ok: true, value: true };
    if (/^(n|no|いいえ|0|false|off)$/i.test(raw)) return { ok: true, value: false };
    return { ok: false, message: 'はい(y) か いいえ(n) を入力してください。' };
  }

  if (opt.type === 'keywords') {
    if (raw === '' || raw === 'なし') return { ok: true, value: [] };
    return { ok: true, value: raw.split(/[\s,]+/).filter(Boolean) };
  }

  if (opt.type === 'columns') {
    if (raw === '' || /^(自動|auto|0)$/i.test(raw)) return { ok: true, value: null };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 6) return { ok: false, message: '1〜6 の数字、または「自動」を入力してください。' };
    return { ok: true, value: n };
  }

  const num = Number(raw);
  if (raw === '' || !Number.isFinite(num)) return { ok: false, message: '数字を入力してください。' };
  if (opt.type === 'number' && opt.unit !== 'sec' && !Number.isInteger(num)) {
    return { ok: false, message: '整数を入力してください。' };
  }
  if (num < opt.min || num > opt.max) {
    return { ok: false, message: `${opt.min}〜${opt.max} の範囲で入力してください。` };
  }
  // 秒で入力してもらった値はミリ秒で保存する
  return { ok: true, value: opt.unit === 'sec' ? Math.round(num * 1000) : num };
}

// 変更しようとしている値に注意点があれば警告文を返す(なければ null)
export function warnFor(opt, value, all) {
  if (opt.warnOver && value > opt.warnOver) {
    return `⚠️ ${opt.warnOver} を超える設定はアカウント制限のリスクが高まります。`;
  }
  if (opt.warnUnder && opt.unit === 'sec' && value / 1000 < opt.warnUnder) {
    return `⚠️ ${opt.warnUnder} 秒未満の間隔はアカウント制限のリスクが高まります。`;
  }
  // フォロー間隔は 最短 <= 最長 に保つ
  if (opt.key === 'followDelayMinMs' && value > all.followDelayMaxMs) {
    return '⚠️ 最短が最長より長いため、最長も同じ値に合わせます。';
  }
  if (opt.key === 'followDelayMaxMs' && value < all.followDelayMinMs) {
    return '⚠️ 最長が最短より短いため、最短も同じ値に合わせます。';
  }
  return null;
}

// 保存済みの設定値を CONFIG に反映する(アプリ起動時と設定変更時に呼ぶ)
export function applyOptions(settings, CONFIG) {
  for (const opt of OPTION_SCHEMA) {
    const v = settings.options?.[opt.key];
    if (v !== undefined) CONFIG[opt.key] = v;
  }
  if (settings.outputDir) CONFIG.outputDir = settings.outputDir;
  return CONFIG;
}

// 1項目を保存する(最短/最長の整合性もここで保つ)
export function setOption(settings, opt, value, CONFIG) {
  settings.options = settings.options || {};
  settings.options[opt.key] = value;

  if (opt.key === 'followDelayMinMs' && value > (settings.options.followDelayMaxMs ?? CONFIG.followDelayMaxMs)) {
    settings.options.followDelayMaxMs = value;
  }
  if (opt.key === 'followDelayMaxMs' && value < (settings.options.followDelayMinMs ?? CONFIG.followDelayMinMs)) {
    settings.options.followDelayMinMs = value;
  }
  return settings;
}
