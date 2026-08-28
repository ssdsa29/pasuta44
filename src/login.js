// 初回セットアップ用: ブラウザを開いて手動でXにログインし、セッションを保存します。
// 実行: npm run login
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG } from './config.js';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5分以内にログインしてください

async function main() {
  const browser = await chromium.launch({ headless: false });
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
    console.error('ログインがタイムアウトしました。もう一度 npm run login を実行してください。');
    await browser.close();
    process.exit(1);
  }

  mkdirSync(dirname(CONFIG.authStatePath), { recursive: true });
  await context.storageState({ path: CONFIG.authStatePath });
  console.log(`ログイン状態を ${CONFIG.authStatePath} に保存しました。`);
  console.log('次は npm run scrape で収集を開始できます。');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
