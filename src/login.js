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
import { RateLimitedError } from './resilience.js';
import { isCancelled } from './cancel.js';

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000; // 手動ログインは15分以内に(2段階認証や確認画面に時間がかかるため)

// ログイン画面に出ている文言から、待っても解決しない問題を見分ける。
// 'ratelimit' … Xがログインを一時的に制限している(待つしかない/これ以上試すと逆効果)
// 'password'  … パスワードが違う
// null        … 特に問題なし(処理中 / 追加認証の途中など)
export function classifyLoginPage(text) {
  const t = String(text || '');
  if (/ログインを一時的に制限|一時的にロック|Too many|しばらくしてから|try again later|Rate limit|凍結されています|Suspended/i.test(t)) {
    return 'ratelimit';
  }
  if (/パスワードが間違って|Wrong password|正しいパスワード|incorrect password/i.test(t)) {
    return 'password';
  }
  return null;
}

// ログイン成功を待つ。待っている間、次の3つも見張って、待ち続けずに抜ける:
//   - 「一時的に制限」などの、待っても解決しない状態
//   - 画面から「中止」が押されたとき
//   - ログイン用のウィンドウが閉じられたとき
export async function waitForLoginOutcome(page, timeout) {
  const SUCCESS =
    '[data-testid="primaryColumn"] [data-testid="tweet"], [data-testid="SideNav_AccountSwitcher_Button"]';
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error('ログインを中止しました。');
    if (page.isClosed()) throw new Error('ログイン用のウィンドウが閉じられました。');

    // 成功要素が出れば完了
    try {
      await page.waitForSelector(SUCCESS, { timeout: 3000 });
      return;
    } catch {
      // まだ出ていない。制限文言が出ていないか確認する
    }
    if (page.isClosed()) throw new Error('ログイン用のウィンドウが閉じられました。');
    const text = await page
      .evaluate(() => (document.body?.innerText || '').slice(0, 3000))
      .catch(() => null);
    // ページを読めない = ウィンドウが閉じられた/壊れた
    if (text === null && page.isClosed()) {
      throw new Error('ログイン用のウィンドウが閉じられました。');
    }
    if (classifyLoginPage(text ?? '') === 'ratelimit') {
      throw new RateLimitedError(
        'Xがログインを一時的に制限しています。30分〜1時間ほど空けてから、1回だけログインし直してください(短時間に何度も試すと制限が延びます)。'
      );
    }
  }
  throw new Error('ログインがタイムアウトしました。もう一度お試しください。');
}

// 旧名の互換(自動ログインの一部で使用)
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
      // 人が操作すれば続行できるので待つ。ただし制限文言が出たら待たずに中断する。
      await waitForLoginOutcome(page, LOGIN_TIMEOUT_MS);
      return true;
    }
  } catch (err) {
    // ログイン制限は手動で試しても同じく弾かれるので、握りつぶさず上へ伝える
    if (err instanceof RateLimitedError) throw err;
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
    try {
      success = await tryAutoLogin(page, account);
    } catch (err) {
      await browser.close().catch(() => {});
      throw err; // ログイン制限など、待っても解決しないエラー
    }
  }

  if (!success) {
    console.log('手動でXにログインしてください(ブラウザが開いています)...');
    await page.goto('https://x.com/login').catch(() => {});
    try {
      await waitForLoginOutcome(page, LOGIN_TIMEOUT_MS);
      success = true;
    } catch (err) {
      // ウィンドウが既に閉じられている場合もあるので、失敗しても気にしない
      await browser.close().catch(() => {});
      // 中止・制限・ウィンドウを閉じた、はそのまま理由を伝える
      throw err;
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
