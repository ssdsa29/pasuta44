// 失敗の検知と自動補正(リトライ・回復処理)。
// 通信エラー、Xのエラー画面、レート制限、セッション切れ、DOM変更などを検知して
// 可能なものは自動で復旧し、復旧できないものは種類の分かるエラーとして投げます。
import { sleep, randInt, humanPause } from './humanize.js';

// --- 種類の分かるエラー -----------------------------------------------------
export class SessionExpiredError extends Error {
  constructor(msg = 'ログインセッションが切れています(再ログインが必要です)') {
    super(msg);
    this.name = 'SessionExpiredError';
  }
}

export class RateLimitedError extends Error {
  constructor(msg = 'Xのレート制限に達しました(時間をおいて再実行してください)') {
    super(msg);
    this.name = 'RateLimitedError';
  }
}

export class FollowLimitError extends Error {
  constructor(msg = 'フォロー数の上限に達しました(時間をおいて再実行してください)') {
    super(msg);
    this.name = 'FollowLimitError';
  }
}

// エラーメッセージを読みやすく整える(色コードや長い付随情報を取り除く)
export function cleanError(err) {
  return String(err?.message ?? err)
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')
    .slice(0, 2)
    .join(' ')
    .trim();
}

// 再試行して回復が見込める通信エラーか判定する
export function isRetryableError(err) {
  const m = String(err?.message ?? err);
  return /net::ERR_|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NETWORK|ERR_EMPTY_RESPONSE|ERR_ABORTED|Timeout .* exceeded|timeout|Navigation failed|frame was detached|Target closed|Execution context was destroyed/i.test(
    m
  );
}

// 指数バックオフ付きの再試行。復旧できなければ最後のエラーを投げる。
export async function withRetry(label, fn, { retries = 3, baseMs = 2000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      // 種類の分かるエラーは再試行しても無駄なのでそのまま投げる
      if (err instanceof SessionExpiredError || err instanceof FollowLimitError) throw err;
      if (attempt >= retries || !isRetryableError(err)) throw err;

      const wait = baseMs * 2 ** (attempt - 1) + randInt(0, 1000);
      console.warn(`  [再試行 ${attempt}/${retries - 1}] ${label}: ${cleanError(err)}`);
      console.warn(`    ${Math.round(wait / 1000)} 秒待って、もう一度試します...`);
      onRetry?.(attempt, err);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// --- ページの状態を検知する -------------------------------------------------
// 戻り値: 'ok' | 'login' | 'ratelimit' | 'error' | 'notfound' | 'empty' | 'unknown'
export async function checkPageState(page) {
  const info = await page
    .evaluate(() => {
      const has = (sel) => !!document.querySelector(sel);
      return {
        url: location.href,
        text: (document.body?.innerText || '').slice(0, 4000),
        hasNav:
          has('[data-testid="AppTabBar_Profile_Link"]') ||
          has('[data-testid="SideNav_AccountSwitcher_Button"]'),
        hasLoginBtn: has('[data-testid="loginButton"]') || has('[data-testid="LoginForm_Login_Button"]'),
        hasTweet: has('article[data-testid="tweet"]'),
        hasUserCell: has('[data-testid="UserCell"]'),
      };
    })
    .catch(() => null);

  if (!info) return { state: 'unknown', info: null };
  const { url, text, hasNav, hasLoginBtn, hasTweet, hasUserCell } = info;

  // セッション切れ / 未ログイン
  if (/\/(login|i\/flow\/login)/.test(url) || (hasLoginBtn && !hasNav)) {
    return { state: 'login', info };
  }
  // レート制限
  if (/Rate limit exceeded|レート制限|Too many requests|リクエストが多すぎ/i.test(text)) {
    return { state: 'ratelimit', info };
  }
  // アカウントが存在しない / 凍結
  if (/このアカウントは存在しません|アカウントは凍結されています|doesn’t exist|doesn't exist|Account suspended|アカウントは削除されました/i.test(text)) {
    return { state: 'notfound', info };
  }
  // 一時的なエラー画面(再試行ボタンが出るもの)
  if (/問題が発生しました|Something went wrong|再試行|Try again|やり直してください|読み込めませんでした/i.test(text)) {
    return { state: 'error', info };
  }
  // 中身が空(DOM変更や読み込み失敗の可能性)
  if (!hasTweet && !hasUserCell && !hasNav) {
    return { state: 'empty', info };
  }
  return { state: 'ok', info };
}

// 検知した状態からの自動回復を試みる。回復不能なら種類の分かるエラーを投げる。
export async function recoverPage(page, state, attempt = 1) {
  if (state === 'login') throw new SessionExpiredError();

  if (state === 'ratelimit') {
    // レート制限は待つしかない。回を追うごとに長く待つ(1分→2分→4分、最大10分)
    const wait = Math.min(60000 * 2 ** (attempt - 1), 600000) + randInt(0, 15000);
    console.warn(`  [補正] レート制限を検知しました。${Math.round(wait / 60000)} 分ほど待機します...`);
    await sleep(wait);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await humanPause(2000, 4000);
    return true;
  }

  if (state === 'error' || state === 'empty' || state === 'unknown') {
    console.warn(`  [補正] ページの読み込みに失敗(${state})。回復を試みます...`);
    // Xの「再試行」ボタンがあれば押す
    const retryBtn = page.locator('[role="button"]', { hasText: /再試行|Retry|やり直す/ }).first();
    if ((await retryBtn.count().catch(() => 0)) > 0) {
      await retryBtn.click().catch(() => {});
      await humanPause(2500, 5000);
    } else {
      await sleep(randInt(2000, 5000));
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await humanPause(2500, 5000);
    }
    return true;
  }

  return false;
}

// ページ遷移(失敗時は再試行し、エラー画面なら回復してから再確認する)
export async function safeGoto(page, url, { retries = 3, expect = null } = {}) {
  return withRetry(`ページを開く (${url})`, async (attempt) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await humanPause(800, 2000);

    let { state } = await checkPageState(page);
    if (state !== 'ok' && state !== 'notfound') {
      await recoverPage(page, state, attempt);
      ({ state } = await checkPageState(page));
      // 回復後もエラーなら、通信エラー扱いにして withRetry に再試行させる
      if (state !== 'ok' && state !== 'notfound') {
        throw new Error(`net::ERR_PAGE_STATE (${state}) at ${url}`);
      }
    }

    // 期待する要素があるなら、その出現も確認する
    if (expect) {
      await page.waitForSelector(expect, { timeout: 30000 });
    }
    return state;
  }, { retries });
}

// 要素の出現を待つ(出なければ状態を確認し、回復してから再試行する)
export async function waitForContent(page, selector, { retries = 3, timeout = 30000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.waitForSelector(selector, { timeout });
      return true;
    } catch (err) {
      const { state } = await checkPageState(page);
      if (state === 'login') throw new SessionExpiredError();
      if (state === 'notfound') return false;
      if (attempt >= retries) {
        console.warn(`  [警告] 要素が見つかりませんでした(${selector})。ページ状態: ${state}`);
        return false;
      }
      await recoverPage(page, state === 'ok' ? 'error' : state, attempt);
    }
  }
  return false;
}
