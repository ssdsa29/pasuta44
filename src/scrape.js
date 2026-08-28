// メインスクリプト: おすすめ欄・フォロー欄から約10アカウント分の投稿(コメント)と画像を収集します。
// かんたん実行: npm start(対話式)
// 直接実行:    npm run scrape / scrape:recommend / scrape:following
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG } from './config.js';
import { extractTweetsInPage, toOriginalImageUrl, imageExtension } from './extract.js';
import { generateReport } from './report.js';
import { humanScroll, humanPause } from './humanize.js';

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

function sanitize(name) {
  return name.replace(/[^\w.-]/g, '_');
}

// 過去の実行で取得済みの投稿IDを読み書きする(差分取得用)
function loadSeenIds(seenPath) {
  if (!CONFIG.skipSeen) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(seenPath, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveSeenIds(seenIds, seenPath) {
  if (!CONFIG.skipSeen) return;
  mkdirSync(dirname(seenPath), { recursive: true });
  writeFileSync(seenPath, JSON.stringify([...seenIds]), 'utf8');
}

function matchesKeywords(text) {
  if (!CONFIG.keywords?.length) return true;
  return CONFIG.keywords.some((kw) => text.includes(kw));
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
async function collectFromTimeline(page, seenIds) {
  const byAccount = new Map(); // handle -> { displayName, tweets: Map<tweetId, tweet> }
  const seenInRun = new Set();

  for (let i = 0; i < CONFIG.maxScrolls; i++) {
    const tweets = await page.evaluate(extractTweetsInPage);
    for (const tweet of tweets) {
      if (seenInRun.has(tweet.tweetId)) continue;
      seenInRun.add(tweet.tweetId);
      if (seenIds.has(tweet.tweetId)) continue; // 過去に取得済み
      if (!matchesKeywords(tweet.text)) continue;

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

    // 人間らしく少しずつスクロール(たまに戻る・止まって読む)
    await humanScroll(page);
  }

  return byAccount;
}

// 投稿詳細ページを開いてリプライ(コメント)を収集する
async function fetchReplies(page, tweet) {
  try {
    await page.goto(tweet.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 20000 });
    await humanPause(1500, 3000);

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
      await humanScroll(page);
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

async function scrapeTab(page, tabKey, runDir, seenIds) {
  console.log(`\n===== タブ「${tabKey}」の収集を開始 =====`);
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  const tabLabel = await switchToTab(page, tabKey);
  console.log(`タブ「${tabLabel}」に切り替えました。スクロールしながら収集します...`);

  const byAccount = await collectFromTimeline(page, seenIds);
  console.log(`${byAccount.size} アカウント分の投稿を検出しました。`);

  const tabDir = join(runDir, tabKey);
  const summary = [];
  const tabData = [];

  for (const [handle, account] of byAccount) {
    const dirName = sanitize(handle);
    const accountDir = join(tabDir, dirName);
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
      seenIds.add(tweet.tweetId);
      await humanPause(1200, 3000);
    }

    const accountData = { handle, displayName: account.displayName, dirName, tab: tabKey, tweets };
    writeFileSync(join(accountDir, 'tweets.json'), JSON.stringify(accountData, null, 2), 'utf8');
    summary.push({ handle, displayName: account.displayName, tweetCount: tweets.length });
    tabData.push(accountData);
  }

  writeFileSync(join(tabDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`タブ「${tabKey}」完了: ${summary.length} アカウントを ${tabDir} に保存しました。`);
  return tabData;
}

// 収集の本体。overrides で CONFIG の値を上書きできる(対話モードから利用)。
// 戻り値: { runDir, htmlPath, csvPath, totalAccounts }
export async function runScrape({
  tabs = ['recommend', 'following'],
  overrides = {},
  authStatePath = null,
  outputDir = null,
} = {}) {
  Object.assign(CONFIG, overrides);
  const statePath = authStatePath || CONFIG.authStatePath;
  const outDir = outputDir || CONFIG.outputDir;

  if (!existsSync(statePath)) {
    throw new Error(`認証情報 (${statePath}) が見つかりません。先にログインしてください。`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(outDir, timestamp);
  mkdirSync(runDir, { recursive: true });

  const seenPath = join(outDir, 'seen.json');
  const seenIds = loadSeenIds(seenPath);
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    // 通常は自動検出。環境変数 CHROMIUM_PATH でブラウザ実行ファイルを指定可能
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    storageState: statePath,
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const dataByTab = {};
  try {
    for (const tabKey of tabs) {
      dataByTab[tabKey] = await scrapeTab(page, tabKey, runDir, seenIds);
    }
  } finally {
    saveSeenIds(seenIds, seenPath);
    // 次回もログイン状態を使い回せるよう、セッションを更新して保存
    await context.storageState({ path: statePath }).catch(() => {});
    await browser.close();
  }

  const { htmlPath, csvPath } = generateReport(runDir, dataByTab);
  const totalAccounts = Object.values(dataByTab).reduce((n, a) => n + a.length, 0);
  console.log(`\nすべて完了しました。`);
  console.log(`  結果フォルダ : ${runDir}`);
  console.log(`  レポート     : ${htmlPath} (ブラウザで開けます)`);
  console.log(`  CSV          : ${csvPath}`);
  return { runDir, htmlPath, csvPath, totalAccounts };
}

// 直接実行されたときだけCLIとして動く
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScrape(parseArgs()).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
