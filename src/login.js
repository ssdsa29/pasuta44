// 初回セットアップ用: ブラウザを開いて手動でXにログインし、セッションを保存します。
// 実行: npm run login (npm start からも自動で呼ばれます)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG } from './config.js';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5分以内にログインしてください

export async function login() {
  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  console.log('ブラウザが開きます。Xにログインしてください...');
  await page.goto('https://x.com/login');

  // ホームのタイムラインが表示されたらログイン完了とみなす
  try {
    await page.waitForSelector('[data-testid="primaryColumn"] [data-testid="tweet"], [data-testid="SideNav_AccountSwitcher_Button"]', {
      timeout: LOGIN_TIMEOUT_MS,
    });
  } catch {
    await browser.close();
    throw new Error('ログインがタイムアウトしました。もう一度実行してください。');
  }

  mkdirSync(dirname(CONFIG.authStatePath), { recursive: true });
  await context.storageState({ path: CONFIG.authStatePath });
  console.log(`ログイン状態を ${CONFIG.authStatePath} に保存しました。`);
  await browser.close();
}

// 直接実行されたときだけCLIとして動く
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  login()
    .then(() => console.log('次は npm start で収集を開始できます。'))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
