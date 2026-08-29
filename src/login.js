// Xへのログインを行い、セッション(Cookie)を保存します。
//  - アカウント情報(パスワード)が登録済みなら自動ログインを試みます
//  - 未登録、または自動ログインが確認画面などで止まったら、手動ログインに切り替わります
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG } from './config.js';
import { authStatePathFor, getActiveAccount, loadSettings } from './settings.js';
import { humanType, humanPause, sleep } from './humanize.js';
import { launchBrowser } from './browser.js';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 手動ログインは5分以内に

// ログイン完了(ホームのタイムライン表示)を待つ
async function waitForLoggedIn(page, timeout) {
  await page.waitForSelector(
    '[data-testid="primaryColumn"] [data-testid="tweet"], [data-testid="SideNav_AccountSwitcher_Button"]',
    { timeout }
  );
}

// アカウント情報を使って自動ログインを試みる。成功可否を返す。
async function tryAutoLogin(page, account) {
  try {
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });
    await humanPause(1000, 2500);

    // 1) ユーザー名/メール/電話
    await page.waitForSelector('input[name="text"]', { timeout: 30000 });
    await humanType(page, 'input[name="text"]', account.username);
    await clickNext(page);
    await humanPause(1200, 2500);

    // 追加の本人確認(ユーザー名の再入力を求められる場合)
    const extra = page.locator('input[data-testid="ocfEnterTextTextInput"], input[name="text"]');
    if ((await extra.count()) > 0 && (await page.locator('input[name="password"]').count()) === 0) {
      await extra.first().fill('');
      await humanType(page, 'input[data-testid="ocfEnterTextTextInput"], input[name="text"]', account.username);
      await clickNext(page);
      await humanPause(1200, 2500);
    }

    // 2) パスワード
    await page.waitForSelector('input[name="password"]', { timeout: 30000 });
    await humanType(page, 'input[name="password"]', account.password);
    // ログインボタン
    const loginBtn = page.locator('[data-testid="LoginForm_Login_Button"]');
    await loginBtn.click();

    // 3) ログイン完了 or 追加画面(2段階認証・パスワード誤り等)を判定
    try {
      await waitForLoggedIn(page, 30000);
      return true;
    } catch {
      const reason = await detectLoginProblem(page);
      if (reason === 'password') {
        console.warn('パスワードが違うようです。登録内容を確認してください(メニュー2で編集できます)。');
        console.log('このまま手動でログインすることもできます...');
      } else if (reason === 'ratelimit') {
        console.warn('ログイン試行が制限されています。時間をおいてからお試しください。');
      } else {
        console.log('追加の認証(2段階認証など)が必要なようです。ブラウザで操作を完了してください...');
      }
      // どの場合も、人が操作すれば続行できるので待つ
      await waitForLoggedIn(page, LOGIN_TIMEOUT_MS);
      return true;
    }
  } catch (err) {
    console.warn(`自動ログインに失敗しました: ${err.message}`);
    return false;
  }
}

// ログインが進まない原因を推定する('password' | 'ratelimit' | 'challenge')
async function detectLoginProblem(page) {
  const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 3000)).catch(() => '');
  if (/パスワードが間違って|Wrong password|正しいパスワード|incorrect password/i.test(text)) return 'password';
  if (/回数が上限|Too many|しばらくしてから|try again later|Rate limit/i.test(text)) return 'ratelimit';
  return 'challenge';
}

async function clickNext(page) {
  // 「次へ」ボタン(日本語/英語UI)。testid が無い場合はテキストで探す。
  const byRole = page.getByRole('button', { name: /次へ|Next/ });
  if ((await byRole.count()) > 0) {
    await byRole.first().click();
    return;
  }
  await page.keyboard.press('Enter');
}

// メインのログイン処理。account を渡すと自動ログインを試みる。
export async function login({ account = null, authStatePath = null, headless = false } = {}) {
  const statePath = authStatePath || CONFIG.authStatePath;
  // 自動ログインでも、確認画面が出たら人が操作できるよう既定は表示する
  const browser = await launchBrowser({ headless });
  const context = await browser.newContext({
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  let success = false;
  if (account && account.password) {
    console.log(`アカウント「${account.label || account.username}」で自動ログインを試みます...`);
    success = await tryAutoLogin(page, account);
  }

  if (!success) {
    console.log('手動でXにログインしてください(ブラウザが開いています)...');
    await page.goto('https://x.com/login').catch(() => {});
    try {
      await waitForLoggedIn(page, LOGIN_TIMEOUT_MS);
      success = true;
    } catch {
      await browser.close();
      throw new Error('ログインがタイムアウトしました。もう一度お試しください。');
    }
  }

  mkdirSync(dirname(statePath), { recursive: true });
  await context.storageState({ path: statePath });
  console.log(`ログイン状態を ${statePath} に保存しました。`);
  await sleep(500);
  await browser.close();
  return statePath;
}

// 直接実行(npm run login): 使用中アカウントでログイン
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = loadSettings();
  const account = getActiveAccount(settings);
  login({ account, authStatePath: authStatePathFor(account) })
    .then(() => console.log('次は npm start で収集を開始できます。'))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
