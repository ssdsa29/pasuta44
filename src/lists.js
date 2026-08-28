// アカウント一覧(フォロー中・おすすめ)の保存と読み込み。
// 保存先(root)配下の lists/ フォルダに、JSON / TXT / CSV を出力します。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function listsDir(root) {
  return join(root, 'lists');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// accounts: [{ handle, displayName }]
// 戻り値: 保存したファイルパス群
export function saveAccountList(root, baseName, accounts, meta = {}) {
  const dir = listsDir(root);
  mkdirSync(dir, { recursive: true });
  const name = `${baseName}_${timestamp()}`;

  const jsonPath = join(dir, `${name}.json`);
  writeFileSync(jsonPath, JSON.stringify({ ...meta, count: accounts.length, accounts }, null, 2), 'utf8');

  // TXT: 1行1 @handle(移植でそのまま読み込めます)
  const txtPath = join(dir, `${name}.txt`);
  writeFileSync(txtPath, accounts.map((a) => a.handle).join('\n') + '\n', 'utf8');

  // CSV(Excel対応のBOM付き)
  const csvPath = join(dir, `${name}.csv`);
  const rows = ['"handle","displayName"'];
  for (const a of accounts) {
    rows.push(`"${a.handle}","${String(a.displayName ?? '').replaceAll('"', '""')}"`);
  }
  writeFileSync(csvPath, '\ufeff' + rows.join('\n'), 'utf8');

  return { jsonPath, txtPath, csvPath, name };
}

// lists/ にある一覧ファイル(.txt / .json)を新しい順で返す
export function listSavedFiles(root) {
  const dir = listsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.txt') || f.endsWith('.json'))
    .map((f) => ({ file: f, path: join(dir, f) }))
    .sort((a, b) => b.file.localeCompare(a.file));
}

// ファイル(.txt / .json)から @handle の配列を読み込む
export function readHandles(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    const data = JSON.parse(raw);
    const accounts = Array.isArray(data) ? data : data.accounts || [];
    return accounts.map((a) => (typeof a === 'string' ? a : a.handle)).filter(Boolean);
  }
  // TXT: 1行1件。@ や URL 形式も許容する
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '').split(/[/?]/)[0])
    .filter(Boolean);
}
