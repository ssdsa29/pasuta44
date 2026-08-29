// フォロー関連の機能:
//  - exportFollowing         … ログイン中アカウントの「フォロー中」一覧を取得
//  - collectRecommendAccounts … おすすめ欄に出てくるアカウントを収集
//  - followAccounts          … 一覧のアカウントを安全に(人間らしい間隔で)フォロー
import { existsSync } from 'node:fs';
import { CONFIG } from './config.js';
import { extractUserCellsInPage, extractTweetsInPage } from './extract.js';
import { humanScroll, humanPause, humanMouseMove, sleep, randInt } from './humanize.js';
import { isCancelled } from './cancel.js';
import {
  safeGoto,
  waitForContent,
  checkPageState,
  recoverPage,
  withRetry,
  cleanError,
  SessionExpiredError,
  FollowLimitError,
} from './resilience.js';
import { launchBrowser } from './browser.js';

// 共通: ログイン済みブラウザを開く
async function openContext(authStatePath) {
  if (!existsSync(authStatePath)) {
    throw new Error(`認証情報 (${authStatePath}) が見つかりません。先にログインしてください。`);
  }
  const browser = await launchBrowser({ headless: CONFIG.headless });
  const context = await browser.newContext({
    storageState: authStatePath,
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  return { browser, context, page };
}

// ログイン中アカウントの @handle を取得(セッション切れならエラーで知らせる)
async function getOwnHandle(page) {
  await safeGoto(page, 'https://x.com/home');
  const ok = await waitForContent(page, '[data-testid="AppTabBar_Profile_Link"]', { retries: 2 });
  if (!ok) {
    const { state } = await checkPageState(page);
    if (state === 'login') throw new SessionExpiredError();
    throw new Error('ログイン中のアカウントを特定できませんでした。');
  }
  const href = await page.getAttribute('[data-testid="AppTabBar_Profile_Link"]', 'href');
  return href ? href.replace(/^\//, '') : null;
}

// おすすめ / フォロー中 タブに切り替える(名前で見つからなければ位置で補正)
async function switchTab(page, tabKey) {
  const candidates = CONFIG.tabs[tabKey] || [];
  return withRetry(`タブ切り替え (${tabKey})`, async (attempt) => {
    const ok = await waitForContent(page, '[role="tablist"] [role="tab"]', { retries: 2 });
    if (!ok) {
      const { state } = await checkPageState(page);
      await recoverPage(page, state === 'ok' ? 'error' : state, attempt);
      throw new Error('net::ERR_TABLIST_NOT_FOUND');
    }
    for (const label of candidates) {
      const tab = page.locator('[role="tablist"] [role="tab"]', { hasText: label }).first();
      if ((await tab.count()) > 0) {
        await tab.click();
        await humanPause(2500, 4000);
        return;
      }
    }
    const tabs = page.locator('[role="tablist"] [role="tab"]');
    const index = tabKey === 'following' ? 1 : 0;
    if ((await tabs.count()) > index) {
      console.warn(`  [補正] タブ名が変わったようです。${index + 1}番目のタブを使います。`);
      await tabs.nth(index).click();
      await humanPause(2500, 4000);
      return;
    }
    throw new Error(`タブ「${candidates.join(' / ')}」が見つかりませんでした。`);
  }, { retries: 3 });
}

// 「フォロー中」一覧を出力する
export async function exportFollowing(authStatePath, { max = CONFIG.maxFollowingExport } = {}) {
  const { browser, context, page } = await openContext(authStatePath);
  try {
    const owner = await getOwnHandle(page);
    if (!owner) throw new Error('ログイン中のアカウントを特定できませんでした。');
    console.log(`@${owner} のフォロー中一覧を取得します...`);

    await safeGoto(page, `https://x.com/${owner}/following`);
    const listed = await waitForContent(page, '[data-testid="UserCell"]', { retries: 3 });
    if (!listed) {
      console.warn('フォロー中の一覧を表示できませんでした(0件の可能性があります)。');
      return { owner, accounts: [] };
    }

    const found = new Map();
    let stagnant = 0;
    let recovered = 0;
    for (let i = 0; i < CONFIG.maxScrolls * 4 && found.size < max; i++) {
      if (isCancelled()) break;
      let cells = [];
      try {
        cells = await page.evaluate(extractUserCellsInPage);
      } catch {
        // 読み取り失敗は次のループで補正する
      }
      const before = found.size;
      for (const c of cells) if (!found.has(c.handle)) found.set(c.handle, c);
      process.stdout.write(`\r  取得済み: ${found.size} 件`);

      if (found.size === before) {
        stagnant++;
        // 増えないときはページ異常を疑い、一度だけ補正してから打ち切る
        if (stagnant >= 4) {
          const { state } = await checkPageState(page);
          if (state === 'login') throw new SessionExpiredError();
          if (state !== 'ok' && recovered < 2) {
            process.stdout.write('\n');
            await recoverPage(page, state, ++recovered);
            stagnant = 0;
            continue;
          }
          break; // 末尾に到達
        }
      } else {
        stagnant = 0;
      }
      await humanScroll(page);
    }
    process.stdout.write('\n');
    await context.storageState({ path: authStatePath }).catch(() => {});
    return { owner, accounts: [...found.values()] };
  } finally {
    await browser.close();
  }
}

// おすすめ欄に出てくるアカウントを収集する
export async function collectRecommendAccounts(authStatePath, { max = 50 } = {}) {
  const { browser, context, page } = await openContext(authStatePath);
  try {
    console.log('おすすめ欄のアカウントを収集します...');
    await safeGoto(page, 'https://x.com/home');
    await switchTab(page, 'recommend');

    const found = new Map();
    let stagnant = 0;
    let recovered = 0;
    for (let i = 0; i < CONFIG.maxScrolls * 2 && found.size < max; i++) {
      if (isCancelled()) break;
      let tweets = [];
      try {
        tweets = await page.evaluate(extractTweetsInPage);
      } catch {
        // 読み取り失敗は次のループで補正する
      }
      const before = found.size;
      for (const t of tweets) {
        if (!found.has(t.handle)) found.set(t.handle, { handle: t.handle, displayName: t.displayName });
      }
      process.stdout.write(`\r  取得済み: ${found.size} アカウント`);

      if (found.size === before) {
        stagnant++;
        if (stagnant >= 5) {
          const { state } = await checkPageState(page);
          if (state === 'login') throw new SessionExpiredError();
          if (state !== 'ok' && recovered < 2) {
            process.stdout.write('\n');
            await recoverPage(page, state, ++recovered);
            stagnant = 0;
            continue;
          }
          break;
        }
      } else {
        stagnant = 0;
      }
      await humanScroll(page);
    }
    process.stdout.write('\n');
    await context.storageState({ path: authStatePath }).catch(() => {});
    return [...found.values()].slice(0, max);
  } finally {
    await browser.close();
  }
}

// フォロー数の制限に達していないか調べる(制限メッセージやダイアログを検知)
async function isFollowLimited(page) {
  const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 4000)).catch(() => '');
  return /フォローできる人数の上限|フォロー数の上限|制限に達しました|unable to follow more people|You are unable to follow|limit of accounts|Rate limit|レート制限/i.test(
    text
  );
}

// 一覧のアカウントを安全にフォローする(人間らしい間隔・件数上限つき)
export async function followAccounts(authStatePath, handles, { max = CONFIG.maxFollowsPerRun, onProgress } = {}) {
  const { browser, context, page } = await openContext(authStatePath);
  const results = [];
  let followed = 0;
  let stoppedBy = null; // 制限やセッション切れで中断した理由
  try {
    // 自分自身は除外
    const me = await getOwnHandle(page);
    const targets = handles.filter((h) => h && h.toLowerCase() !== (me || '').toLowerCase());

    for (const handle of targets) {
      if (followed >= max) break;
      if (isCancelled()) {
        console.log('中止が要求されたため、フォローを止めます(残りは保存されます)。');
        break;
      }
      try {
        const state = await safeGoto(page, `https://x.com/${handle}`);
        await humanPause(1500, 3500);
        await humanMouseMove(page);

        // プロフィールが存在しない/凍結
        if (state === 'notfound') {
          results.push({ handle, status: 'notfound' });
          onProgress?.({ handle, status: 'notfound', followed });
          continue;
        }

        // すでにフォロー中(-unfollow ボタンがある)
        const already = await page.locator('[data-testid="primaryColumn"] [data-testid$="-unfollow"]').count();
        if (already > 0) {
          results.push({ handle, status: 'already' });
          onProgress?.({ handle, status: 'already', followed });
          continue;
        }

        // フォローボタン(プロフィール本体のもの。右カラムのおすすめは除外)
        const followBtn = page.locator('[data-testid="primaryColumn"] [data-testid$="-follow"]').first();
        if ((await followBtn.count()) === 0) {
          // ボタンが無いのはDOM変更の可能性もあるため、一度だけ再読み込みして確認する
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await humanPause(2000, 4000);
          if ((await page.locator('[data-testid="primaryColumn"] [data-testid$="-follow"]').count()) === 0) {
            results.push({ handle, status: 'nobutton' });
            onProgress?.({ handle, status: 'nobutton', followed });
            continue;
          }
        }

        await humanPause(600, 1800);
        await page.locator('[data-testid="primaryColumn"] [data-testid$="-follow"]').first().click();

        // フォロー完了(-unfollow に変化)を確認
        let ok = await page
          .locator('[data-testid="primaryColumn"] [data-testid$="-unfollow"]')
          .first()
          .waitFor({ timeout: 8000 })
          .then(() => true)
          .catch(() => false);

        // 反映されない場合、フォロー制限に達していないか確認する
        if (!ok) {
          const limited = await isFollowLimited(page);
          if (limited) {
            console.warn('\n  [検知] フォロー数の制限に達したようです。安全のためここで中断します。');
            results.push({ handle, status: 'limited' });
            throw new FollowLimitError();
          }
          // 一時的な失敗の可能性 → 再読み込みして1回だけ押し直す
          console.warn(`  [補正] @${handle} のフォローが反映されませんでした。もう一度試します...`);
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await humanPause(2500, 5000);
          const retryBtn = page.locator('[data-testid="primaryColumn"] [data-testid$="-follow"]').first();
          if ((await retryBtn.count()) > 0) {
            await retryBtn.click().catch(() => {});
            ok = await page
              .locator('[data-testid="primaryColumn"] [data-testid$="-unfollow"]')
              .first()
              .waitFor({ timeout: 8000 })
              .then(() => true)
              .catch(() => false);
          } else {
            // ボタンが消えている = 実はフォローできていた
            ok = (await page.locator('[data-testid="primaryColumn"] [data-testid$="-unfollow"]').count()) > 0;
          }
        }

        results.push({ handle, status: ok ? 'followed' : 'failed' });
        if (ok) followed++;
        onProgress?.({ handle, status: ok ? 'followed' : 'failed', followed });

        // 次のフォローまで、安全のため長めにランダム待機
        if (followed < max) {
          const wait = randInt(CONFIG.followDelayMinMs, CONFIG.followDelayMaxMs);
          console.log(`    次まで ${Math.round(wait / 1000)} 秒待機します...`);
          await sleep(wait);
        }
      } catch (err) {
        // 制限・セッション切れは続けても無駄なので中断する
        if (err instanceof FollowLimitError || err instanceof SessionExpiredError) {
          stoppedBy = err;
          break;
        }
        console.warn(`  @${handle} をスキップします: ${cleanError(err)}`);
        results.push({ handle, status: 'error', error: cleanError(err) });
        // 連続で失敗する場合はページかネットワークの異常。少し待ってから続ける
        if (results.slice(-3).every((r) => r.status === 'error')) {
          console.warn('  [補正] 連続で失敗しています。30秒ほど待ってから続けます...');
          await sleep(30000);
        }
      }
    }

    await context.storageState({ path: authStatePath }).catch(() => {});

    // 未処理として残ったアカウント(再実行で続きから処理できる)
    const done = new Set(results.map((r) => r.handle));
    const notProcessed = targets.filter((h) => !done.has(h));

    return { follower: me, results, followedCount: followed, notProcessed, stoppedBy: stoppedBy?.name ?? null };
  } finally {
    await browser.close();
  }
}
