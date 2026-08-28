// フォロー関連の機能:
//  - exportFollowing         … ログイン中アカウントの「フォロー中」一覧を取得
//  - collectRecommendAccounts … おすすめ欄に出てくるアカウントを収集
//  - followAccounts          … 一覧のアカウントを安全に(人間らしい間隔で)フォロー
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { CONFIG } from './config.js';
import { extractUserCellsInPage, extractTweetsInPage } from './extract.js';
import { humanScroll, humanPause, humanMouseMove, sleep, randInt } from './humanize.js';

// 共通: ログイン済みブラウザを開く
async function openContext(authStatePath) {
  if (!existsSync(authStatePath)) {
    throw new Error(`認証情報 (${authStatePath}) が見つかりません。先にログインしてください。`);
  }
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    storageState: authStatePath,
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  return { browser, context, page };
}

// ログイン中アカウントの @handle を取得
async function getOwnHandle(page) {
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="AppTabBar_Profile_Link"]', { timeout: 30000 });
  const href = await page.getAttribute('[data-testid="AppTabBar_Profile_Link"]', 'href');
  return href ? href.replace(/^\//, '') : null;
}

// おすすめ / フォロー中 タブに切り替える
async function switchTab(page, tabKey) {
  const candidates = CONFIG.tabs[tabKey] || [];
  await page.waitForSelector('[role="tablist"] [role="tab"]', { timeout: 30000 });
  for (const label of candidates) {
    const tab = page.locator('[role="tablist"] [role="tab"]', { hasText: label }).first();
    if ((await tab.count()) > 0) {
      await tab.click();
      await sleep(3000);
      return;
    }
  }
  throw new Error(`タブ「${candidates.join(' / ')}」が見つかりませんでした。`);
}

// 「フォロー中」一覧を出力する
export async function exportFollowing(authStatePath, { max = CONFIG.maxFollowingExport } = {}) {
  const { browser, context, page } = await openContext(authStatePath);
  try {
    const owner = await getOwnHandle(page);
    if (!owner) throw new Error('ログイン中のアカウントを特定できませんでした。');
    console.log(`@${owner} のフォロー中一覧を取得します...`);

    await page.goto(`https://x.com/${owner}/following`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="UserCell"]', { timeout: 30000 });

    const found = new Map();
    let stagnant = 0;
    for (let i = 0; i < CONFIG.maxScrolls * 4 && found.size < max; i++) {
      const cells = await page.evaluate(extractUserCellsInPage);
      const before = found.size;
      for (const c of cells) if (!found.has(c.handle)) found.set(c.handle, c);
      process.stdout.write(`\r  取得済み: ${found.size} 件`);
      if (found.size === before) {
        if (++stagnant >= 4) break; // これ以上増えない=末尾に到達
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
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await switchTab(page, 'recommend');

    const found = new Map();
    let stagnant = 0;
    for (let i = 0; i < CONFIG.maxScrolls * 2 && found.size < max; i++) {
      const tweets = await page.evaluate(extractTweetsInPage);
      const before = found.size;
      for (const t of tweets) {
        if (!found.has(t.handle)) found.set(t.handle, { handle: t.handle, displayName: t.displayName });
      }
      process.stdout.write(`\r  取得済み: ${found.size} アカウント`);
      if (found.size === before) {
        if (++stagnant >= 5) break;
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

// 一覧のアカウントを安全にフォローする(人間らしい間隔・件数上限つき)
export async function followAccounts(authStatePath, handles, { max = CONFIG.maxFollowsPerRun, onProgress } = {}) {
  const { browser, context, page } = await openContext(authStatePath);
  const results = [];
  let followed = 0;
  try {
    // 自分自身は除外
    const me = await getOwnHandle(page);
    const targets = handles.filter((h) => h && h.toLowerCase() !== (me || '').toLowerCase());

    for (const handle of targets) {
      if (followed >= max) break;
      try {
        await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded' });
        await humanPause(1500, 3500);
        await humanMouseMove(page);

        // プロフィールが存在しない/凍結
        const notFound = await page.locator('text=/このアカウントは存在しません|アカウントは凍結|doesn.t exist|account suspended/i').count();
        if (notFound > 0) {
          results.push({ handle, status: 'notfound' });
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
          results.push({ handle, status: 'nobutton' });
          continue;
        }

        await humanPause(600, 1800);
        await followBtn.click();
        // フォロー完了(-unfollow に変化)を確認
        const ok = await page
          .locator('[data-testid="primaryColumn"] [data-testid$="-unfollow"]')
          .first()
          .waitFor({ timeout: 8000 })
          .then(() => true)
          .catch(() => false);

        results.push({ handle, status: ok ? 'followed' : 'clicked' });
        followed++;
        onProgress?.({ handle, status: ok ? 'followed' : 'clicked', followed });

        // 次のフォローまで、安全のため長めにランダム待機
        if (followed < max) {
          const wait = randInt(CONFIG.followDelayMinMs, CONFIG.followDelayMaxMs);
          console.log(`    次まで ${Math.round(wait / 1000)} 秒待機します...`);
          await sleep(wait);
        }
      } catch (err) {
        results.push({ handle, status: 'error', error: err.message });
      }
    }

    await context.storageState({ path: authStatePath }).catch(() => {});
    return { follower: me, results, followedCount: followed };
  } finally {
    await browser.close();
  }
}
