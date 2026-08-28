// エラーと動作の記録をファイルに残す。
// 画面や黒いウィンドウを閉じても、あとから原因を確認できるようにするためのもの。
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = 'logs';
const LOG_FILE = join(LOG_DIR, 'app.log');
const OLD_FILE = join(LOG_DIR, 'app-old.log');
const MAX_BYTES = 2 * 1024 * 1024; // 2MB を超えたら1世代だけ残して切り替える

export const logPath = LOG_FILE;

function rotateIfNeeded() {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_BYTES) {
      renameSync(LOG_FILE, OLD_FILE);
    }
  } catch {
    // 切り替えに失敗しても記録は続ける
  }
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// level: 'info' | 'warn' | 'error'
export function writeLog(text, level = 'info') {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    const tag = level === 'error' ? 'エラー' : level === 'warn' ? '注意' : '情報';
    appendFileSync(LOG_FILE, `[${stamp()}] [${tag}] ${String(text).replace(/\n/g, '\n    ')}\n`, 'utf8');
  } catch {
    // 記録できなくてもアプリは止めない
  }
}

// 直近のログを読み出す(画面表示用)
export function readRecentLog(lines = 300) {
  try {
    return readFileSync(LOG_FILE, 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}
