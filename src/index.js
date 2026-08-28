// かんたん実行モード: npm start だけで、ログイン確認 → 質問に答える → 収集 → レポート表示まで行います。
// すべての質問は Enter だけでおすすめ設定になります。
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { CONFIG } from './config.js';
import { login } from './login.js';
import { runScrape } from './scrape.js';

// ターミナル以外(パイプ実行など)では質問せず、すべておすすめ設定で動く
const interactive = stdin.isTTY === true;
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;
const rlClosed = rl ? new Promise((res) => rl.once('close', () => res(null))) : Promise.resolve(null);

async function ask(question, defaultValue) {
  if (!rl) return String(defaultValue);
  // 入力が途中で閉じられたら既定値で続行する
  const answer = await Promise.race([rl.question(`${question} [${defaultValue}]: `), rlClosed]);
  if (answer === null) return String(defaultValue);
  return answer.trim() === '' ? String(defaultValue) : answer.trim();
}

async function askYesNo(question, defaultYes = true) {
  const answer = await ask(question, defaultYes ? 'Y/n' : 'y/N');
  if (answer === 'Y/n' || answer === 'y/N') return defaultYes;
  return /^y/i.test(answer);
}

// レポートを既定のブラウザで開く(失敗しても無視)
function openInBrowser(path) {
  const abs = resolve(path);
  const cmd =
    process.platform === 'darwin' ? `open "${abs}"`
    : process.platform === 'win32' ? `start "" "${abs}"`
    : `xdg-open "${abs}"`;
  exec(cmd, () => {});
}

async function main() {
  console.log('======================================');
  console.log(' X タイムライン自動収集ツール');
  console.log(' (Enterキーだけでおすすめ設定で動きます)');
  console.log('======================================\n');

  // 1. ログイン確認(未ログインなら自動でログイン画面を開く)
  if (!existsSync(CONFIG.authStatePath)) {
    console.log('初回実行のため、まずXへのログインが必要です。');
    console.log('ブラウザが開いたら、手動でログインしてください。\n');
    await login();
    console.log('');
  }

  // 2. かんたん設定(全部Enterでおすすめ設定)
  const tabChoice = await ask('収集する欄は? 1=両方 2=おすすめのみ 3=フォロー中のみ', '1');
  const tabs = tabChoice === '2' ? ['recommend'] : tabChoice === '3' ? ['following'] : ['recommend', 'following'];

  const maxAccounts = parseInt(await ask('収集するアカウント数(タブごと)', CONFIG.maxAccounts), 10) || CONFIG.maxAccounts;
  const fetchReplies = await askYesNo('各投稿のリプライ(コメント)も取得しますか?', true);
  const skipSeen = await askYesNo('前回までに取得済みの投稿はスキップしますか?', true);
  const keywordInput = await ask('キーワードで絞り込み(スペース区切り)', 'なし');
  const keywords = keywordInput === 'なし' ? [] : keywordInput.split(/\s+/);

  rl?.close();

  console.log('\n収集を開始します。しばらくお待ちください...');
  const { htmlPath, totalAccounts } = await runScrape({
    tabs,
    overrides: { maxAccounts, fetchReplies, skipSeen, keywords },
  });

  if (totalAccounts === 0) {
    console.log('\n新しく取得できた投稿はありませんでした。');
    console.log('(取得済みスキップが有効な場合、output/seen.json を削除すると最初から取得できます)');
  } else {
    console.log('\nレポートをブラウザで開きます...');
    openInBrowser(htmlPath);
  }
}

main().catch((err) => {
  console.error(`\nエラー: ${err.message ?? err}`);
  process.exit(1);
});
