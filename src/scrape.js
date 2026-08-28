// メインスクリプト: おすすめ欄・フォロー欄から約10アカウント分の投稿(コメント)と画像を収集します。
// 実行: npm run scrape            (両方のタブ)
//       npm run scrape:recommend  (おすすめのみ)
//       npm run scrape:following  (フォロー中のみ)
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG } from './config.js';
import { extractTweetsInPage, toOriginalImageUrl, imageExtension } from './extract.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const tabsIdx = args.indexOf('--tabs');
  let tabs = ['recommend', 'following'];
  if (tabsIdx !== -1 && args[tabsIdx + 1]) {
    tabs = args[tabsIdx + 1].split(',').map((t) => t.trim());
  }
  return { tabs };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 検出対策として待機時間に±50%の揺らぎを入れる
function jitteredDelay() {
  const base = CONFIG.scrollDelayMs;
  return sleep(base * (0.5 + Math.random()));
}

function sanitize(name) {
  return name.replace(/[^\w.-]/g, '_');
}

async function switchToTab(page, tabKey) {
  const candidates = CONFIG.tabs[tabKey];
  if (!candidates) throw new Error(`不明なタブ指定です: ${tabKey}(recommend / following のいずれか)`);
  await page.waitForSelector('[role="tablist"] [role="tab"]', { timeout: 30000 });
  for (const label of candidates) {
    const tab = page.locator('[role="tablist"] [role="tab"]', { hasText: label }).first();
    if ((await tab.count()) > 0) {
      await tab.click();
      await sleep(3000);
      return label;
    }
  }
  throw new Error(`タブ「${candidates.join(' / ')}」が見つかりませんでした。ログイン状態を確認してください。`);
}

// タイムラインをスクロールしながら、ユニークアカウント数が目標に達するまで投稿を集める
async function collectFromTimeline(page) {
  const byAccount = new Map(); // handle -> { displayName, tweets: Map<tweetId, tweet> }
  const seenTweetIds = new Set();

  for (let i = 0; i < CONFIG.maxScrolls; i++) {
    const tweets = await page.evaluate(extractTweetsInPage);
    for (const tweet of tweets) {
      if (seenTweetIds.has(tweet.tweetId)) continue;
      seenTweetIds.add(tweet.tweetId);

      let account = byAccount.get(tweet.handle);
      if (!account) {
        if (byAccount.size >= CONFIG.maxAccounts) continue;
        account = { displayName: tweet.displayName, tweets: new Map() };
        byAccount.set(tweet.handle, account);
      }
      if (account.tweets.size < CONFIG.maxTweetsPerAccount) {
        account.tweets.set(tweet.tweetId, tweet);
      }
    }

    const accountsFull = byAccount.size >= CONFIG.maxAccounts;
    const tweetsFull = [...byAccount.values()].every((a) => a.tweets.size >= CONFIG.maxTweetsPerAccount);
    if (accountsFull && tweetsFull) break;

    await page.mouse.wheel(0, 2500);
    await jitteredDelay();
  }

  return byAccount;
}

// 投稿詳細ページを開いてリプライ(コメント)を収集する
async function fetchReplies(page, tweet) {
  try {
    await page.goto(tweet.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 });
    await sleep(2000);

    const replies = [];
    const seen = new Set([tweet.tweetId]);
    for (let i = 0; i < 3 && replies.length < CONFIG.maxRepliesPerTweet; i++) {
      const items = await page.evaluate(extractTweetsInPage);
      for (const item of items) {
        if (seen.has(item.tweetId)) continue;
        seen.add(item.tweetId);
        if (replies.length < CONFIG.maxRepliesPerTweet) {
          replies.push({
            handle: item.handle,
            displayName: item.displayName,
            text: item.text,
            datetime: item.datetime,
            url: item.url,
            images: item.images.map(toOriginalImageUrl),
          });
        }
      }
      if (replies.length >= CONFIG.maxRepliesPerTweet) break;
      await page.mouse.wheel(0, 2000);
      await jitteredDelay();
    }
    return replies;
  } catch (err) {
    console.warn(`  リプライ取得に失敗しました (${tweet.url}): ${err.message}`);
    return [];
  }
}

async function downloadImage(url, destPath) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buf);
    return true;
  } catch (err) {
    console.warn(`  画像のダウンロードに失敗しました (${url}): ${err.message}`);
    return false;
  }
}

async function scrapeTab(page, tabKey, runDir) {
  console.log(`\n===== タブ「${tabKey}」の収集を開始 =====`);
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  const tabLabel = await switchToTab(page, tabKey);
  console.log(`タブ「${tabLabel}」に切り替えました。スクロールしながら収集します...`);

  const byAccount = await collectFromTimeline(page);
  console.log(`${byAccount.size} アカウント分の投稿を検出しました。`);

  const tabDir = join(runDir, tabKey);
  const summary = [];

  for (const [handle, account] of byAccount) {
    const accountDir = join(tabDir, sanitize(handle));
    const imagesDir = join(accountDir, 'images');
    mkdirSync(imagesDir, { recursive: true });

    const tweets = [];
    for (const tweet of account.tweets.values()) {
      console.log(`@${handle}: ${tweet.url}`);

      const imageUrls = tweet.images.map(toOriginalImageUrl);
      const savedImages = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const ext = imageExtension(tweet.images[i]);
        const filename = `${tweet.tweetId}_${i + 1}.${ext}`;
        if (await downloadImage(imageUrls[i], join(imagesDir, filename))) {
          savedImages.push(filename);
        }
      }

      const record = {
        tweetId: tweet.tweetId,
        url: tweet.url,
        datetime: tweet.datetime,
        text: tweet.text,
        imageUrls,
        savedImages,
      };

      if (CONFIG.fetchReplies) {
        record.replies = await fetchReplies(page, tweet);
        for (let r = 0; r < record.replies.length; r++) {
          const reply = record.replies[r];
          for (let i = 0; i < reply.images.length; i++) {
            const ext = imageExtension(reply.images[i]);
            const filename = `${tweet.tweetId}_reply${r + 1}_${i + 1}.${ext}`;
            if (await downloadImage(reply.images[i], join(imagesDir, filename))) {
              savedImages.push(filename);
            }
          }
        }
      }

      tweets.push(record);
      await jitteredDelay();
    }

    const accountData = { handle, displayName: account.displayName, tab: tabKey, tweets };
    writeFileSync(join(accountDir, 'tweets.json'), JSON.stringify(accountData, null, 2), 'utf8');
    summary.push({ handle, displayName: account.displayName, tweetCount: tweets.length });
  }

  writeFileSync(join(tabDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`タブ「${tabKey}」完了: ${summary.length} アカウントを ${tabDir} に保存しました。`);
}

async function main() {
  const { tabs } = parseArgs();

  if (!existsSync(CONFIG.authStatePath)) {
    console.error(`認証情報 (${CONFIG.authStatePath}) が見つかりません。先に npm run login を実行してください。`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(CONFIG.outputDir, timestamp);
  mkdirSync(runDir, { recursive: true });

  const browser = await chromium.launch({ headless: CONFIG.headless });
  const context = await browser.newContext({
    storageState: CONFIG.authStatePath,
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    for (const tabKey of tabs) {
      await scrapeTab(page, tabKey, runDir);
    }
    console.log(`\nすべて完了しました。結果: ${runDir}`);
  } finally {
    // 次回もログイン状態を使い回せるよう、セッションを更新して保存
    await context.storageState({ path: CONFIG.authStatePath }).catch(() => {});
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
