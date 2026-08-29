// メインスクリプト: おすすめ欄・フォロー欄から約10アカウント分の投稿(コメント)と画像を収集します。
// かんたん実行: npm start(対話式)
// 直接実行:    npm run scrape / scrape:recommend / scrape:following
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG } from './config.js';
import { extractTweetsInPage, toOriginalImageUrl, imageExtension } from './extract.js';
import { generateReport } from './report.js';
import { humanScroll, humanPause, jitterSleep } from './humanize.js';
import { isCancelled } from './cancel.js';
import { attachMediaCapture, downloadVideo } from './media.js';
import { launchBrowser } from './browser.js';
import {
  safeGoto,
  waitForContent,
  checkPageState,
  recoverPage,
  withRetry,
  cleanError,
  SessionExpiredError,
} from './resilience.js';

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

// 「開いたまま」にしたブラウザ。アプリ終了時にまとめて片付ける。
export const openedBrowsers = new Set();

export async function closeOpenedBrowsers() {
  for (const b of [...openedBrowsers]) {
    await b.close().catch(() => {});
    openedBrowsers.delete(b);
  }
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

// タブを切り替える。名前で見つからない場合は位置(1番目=おすすめ、2番目=フォロー中)で補正する。
async function switchToTab(page, tabKey) {
  const candidates = CONFIG.tabs[tabKey];
  if (!candidates) throw new Error(`不明なタブ指定です: ${tabKey}(recommend / following のいずれか)`);

  return withRetry(`タブ切り替え (${tabKey})`, async (attempt) => {
    const ok = await waitForContent(page, '[role="tablist"] [role="tab"]', { retries: 2 });
    if (!ok) {
      const { state } = await checkPageState(page);
      await recoverPage(page, state === 'ok' ? 'error' : state, attempt);
      throw new Error('net::ERR_TABLIST_NOT_FOUND');
    }

    // 1) 表示名で探す(日本語UI / 英語UI)
    for (const label of candidates) {
      const tab = page.locator('[role="tablist"] [role="tab"]', { hasText: label }).first();
      if ((await tab.count()) > 0) {
        await tab.click();
        await humanPause(2500, 4000);
        return label;
      }
    }

    // 2) 見つからない場合は位置で補正(X側の表記変更に対応)
    const tabs = page.locator('[role="tablist"] [role="tab"]');
    const count = await tabs.count();
    const index = tabKey === 'following' ? 1 : 0;
    if (count > index) {
      const fallbackLabel = (await tabs.nth(index).innerText().catch(() => '')).trim();
      console.warn(`  [補正] タブ名が変わったようです。${index + 1}番目のタブ「${fallbackLabel}」を使います。`);
      await tabs.nth(index).click();
      await humanPause(2500, 4000);
      return fallbackLabel || `${index + 1}番目のタブ`;
    }

    throw new Error(`タブ「${candidates.join(' / ')}」が見つかりませんでした。ログイン状態を確認してください。`);
  }, { retries: 3 });
}

// 一覧上の投稿カードを、その場でスクリーンショットに撮る。
// 詳細ページは開かず、いま画面にある要素をそのまま画像化するだけ(アクセスは増えない)。
// 成功したら保存先ファイル名(アカウントフォルダからの相対パス)を返す。失敗したら null。
async function screenshotTweetCard(page, tweetId, handle, tabDir) {
  try {
    const loc = page
      .locator(`article[data-testid="tweet"]:has(a[href*="/status/${tweetId}"])`)
      .first();
    if ((await loc.count().catch(() => 0)) === 0) return null;
    const relDir = 'screenshots';
    const dir = join(tabDir, sanitize(handle), relDir);
    mkdirSync(dir, { recursive: true });
    const filename = `${tweetId}.png`;
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
    await humanPause(200, 500);
    await loc.screenshot({ path: join(dir, filename), timeout: 8000 });
    return `${relDir}/${filename}`;
  } catch {
    return null; // 撮れなくても収集は続ける
  }
}

// タイムラインをスクロールしながら、ユニークアカウント数が目標に達するまで投稿を集める
async function collectFromTimeline(page, seenIds, { tabDir = null } = {}) {
  const byAccount = new Map(); // handle -> { displayName, tweets: Map<tweetId, tweet> }
  const seenInRun = new Set();

  let stagnant = 0; // 何も新しく取れなかった連続回数
  let recovered = 0; // 補正を試みた回数

  for (let i = 0; i < CONFIG.maxScrolls; i++) {
    if (isCancelled()) break; // 中止が要求されたら、集めた分を返して終了
    // 抽出中にページが壊れることがあるため、失敗しても続行できるようにする
    let tweets = [];
    try {
      tweets = await page.evaluate(extractTweetsInPage);
    } catch (err) {
      console.warn(`  [補正] 投稿の読み取りに失敗しました: ${cleanError(err)}`);
    }

    const before = seenInRun.size;
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
        // 残すと決めた投稿は、いま画面にあるうちにその場でスクショを撮る
        if (CONFIG.saveScreenshots && tabDir) {
          tweet.screenshot = await screenshotTweetCard(page, tweet.tweetId, tweet.handle, tabDir);
        }
        account.tweets.set(tweet.tweetId, tweet);
      }
    }

    const accountsFull = byAccount.size >= CONFIG.maxAccounts;
    const tweetsFull = [...byAccount.values()].every((a) => a.tweets.size >= CONFIG.maxTweetsPerAccount);
    if (accountsFull && tweetsFull) break;

    // 新しい投稿が取れない状態が続いたら、ページの異常を疑って補正する
    if (seenInRun.size === before) {
      stagnant++;
      if (stagnant >= 3) {
        const { state } = await checkPageState(page);
        if (state === 'login') throw new SessionExpiredError();
        if (state !== 'ok') {
          await recoverPage(page, state, ++recovered);
          stagnant = 0;
          continue;
        }
        // ページは正常だが投稿が増えない = 読み込み待ちか末尾。一度だけ長めに待って様子を見る
        if (stagnant >= 5) {
          if (recovered >= 2) break; // それでもダメなら打ち切り(取得済み分は保存)
          console.warn('  [補正] 新しい投稿が読み込まれません。少し待って再読み込みします...');
          await recoverPage(page, 'error', ++recovered);
          stagnant = 0;
          continue;
        }
      }
    } else {
      stagnant = 0;
    }

    // 人間らしく少しずつスクロール(たまに戻る・止まって読む)
    await humanScroll(page);
  }

  return byAccount;
}

// 投稿詳細ページを開いてリプライ(コメント)を収集する
async function fetchReplies(page, tweet) {
  try {
    await safeGoto(page, tweet.url);
    const ok = await waitForContent(page, 'article[data-testid="tweet"]', { retries: 2, timeout: 20000 });
    if (!ok) {
      console.warn(`  リプライを取得できませんでした(投稿が削除された可能性): ${tweet.url}`);
      return [];
    }
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
            commentId: item.tweetId,
            parentTweetId: tweet.tweetId,
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
    // セッション切れは上位で再ログインするため、そのまま投げる
    if (err instanceof SessionExpiredError) throw err;
    console.warn(`  リプライ取得に失敗しました (${tweet.url}): ${cleanError(err)}`);
    return [];
  }
}

// 画像をダウンロードする。失敗したら少し待って再試行し、
// それでもダメなら画質を落として(orig→large)取得を試みる。
async function downloadImage(url, destPath, { retries = 3 } = {}) {
  const attemptUrls = [url, url.replace(/name=orig/, 'name=large')];

  for (const target of [...new Set(attemptUrls)]) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(target, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) throw new Error('空のファイル');
        await writeFile(destPath, buf);
        return true;
      } catch (err) {
        const msg = String(err.message ?? err);
        // 404など、再試行しても無駄なものは次の画質へ
        if (/HTTP 4[0-9]{2}/.test(msg) && !/HTTP 429/.test(msg)) break;
        if (attempt < retries) {
          await sleep(1500 * 2 ** (attempt - 1));
        } else {
          console.warn(`  画像のダウンロードに失敗しました (${target}): ${msg}`);
        }
      }
    }
  }
  return false;
}

// 1つの投稿(またはコメント)についた動画をまとめて保存する
async function saveVideosFor(id, media, videosDir, prefix, failures, sourceUrl) {
  const found = media?.get(id) ?? [];
  const saved = [];
  for (let i = 0; i < found.length; i++) {
    const v = found[i];
    if (v.kind !== 'mp4') {
      // 生放送などの形式は、そのままでは保存できないのでURLだけ記録する
      console.warn(`    動画を保存できない形式でした(URLのみ記録): ${sourceUrl}`);
      failures.push({ type: 'video', reason: '保存できない形式(HLS)', url: v.url, tweetUrl: sourceUrl });
      saved.push({ file: null, url: v.url, kind: v.kind, type: v.type, durationMs: v.durationMs, thumbnail: v.thumbnail });
      continue;
    }
    const filename = `${prefix}_${i + 1}.mp4`;
    const r = await downloadVideo(v.url, join(videosDir, filename), {
      maxBytes: (CONFIG.maxVideoMB ?? 100) * 1024 * 1024,
    });
    if (r.ok) {
      console.log(`    動画を保存しました: ${filename} (${Math.round((r.bytes / 1024 / 1024) * 10) / 10}MB)`);
      saved.push({ file: filename, url: v.url, kind: 'mp4', type: v.type, durationMs: v.durationMs, thumbnail: v.thumbnail });
    } else {
      console.warn(`    動画を保存できませんでした(${r.reason}): ${sourceUrl}`);
      failures.push({ type: 'video', reason: r.reason, url: v.url, tweetUrl: sourceUrl });
      saved.push({ file: null, url: v.url, kind: 'mp4', type: v.type, durationMs: v.durationMs, thumbnail: v.thumbnail, skipped: true });
    }
  }
  return saved;
}

// 入れ子になったデータの中から、最初に見つかったアカウント名(screen_name)を取り出す
export function findScreenName(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 8) return null;
  if (typeof data.screen_name === 'string') return data.screen_name;
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object') {
      const found = findScreenName(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// 収集が終わったあと、ブラウザを開いたままにして「あなたの操作」を記録する。
// あなたがスクロールして見た投稿を、そのつど画像とスクリーンショットで残し、
// フォローした相手も控えておく。ブラウザを閉じるか「中止」で終わる。
async function watchManual(page, runDir, seenIds, failures, followed) {
  const tabKey = 'manual';
  const tabDir = join(runDir, tabKey);
  const byHandle = new Map(); // handle -> accountData
  const recorded = new Set();

  console.log('\n===== 見守りを始めます =====');
  console.log('ブラウザはこのまま操作できます。見た投稿と保存した画像を記録します。');
  console.log('終わるときは、ブラウザを閉じるか、画面の「中止」を押してください。');

  while (!isCancelled() && !page.isClosed()) {
    let tweets = [];
    try {
      tweets = await page.evaluate(extractTweetsInPage);
    } catch {
      if (page.isClosed()) break;
      await sleep(1500);
      continue;
    }

    for (const tweet of tweets) {
      if (isCancelled() || page.isClosed()) break;
      if (recorded.has(tweet.tweetId)) continue;
      recorded.add(tweet.tweetId);
      if (seenIds.has(tweet.tweetId)) continue;
      if (!matchesKeywords(tweet.text)) continue;

      try {
        const dirName = sanitize(tweet.handle);
        const imagesDir = join(tabDir, dirName, 'images');
        mkdirSync(imagesDir, { recursive: true });

        const shot = CONFIG.saveScreenshots
          ? await screenshotTweetCard(page, tweet.tweetId, tweet.handle, tabDir)
          : null;

        const imageUrls = tweet.images.map(toOriginalImageUrl);
        const savedImages = [];
        for (let i = 0; i < imageUrls.length; i++) {
          const filename = `${tweet.tweetId}_${i + 1}.${imageExtension(tweet.images[i])}`;
          if (await downloadImage(imageUrls[i], join(imagesDir, filename))) savedImages.push(filename);
          else failures.push({ type: 'image', url: imageUrls[i], tweetUrl: tweet.url });
        }

        if (!byHandle.has(tweet.handle)) {
          byHandle.set(tweet.handle, {
            handle: tweet.handle, displayName: tweet.displayName, dirName, tab: tabKey, tweets: [],
          });
        }
        byHandle.get(tweet.handle).tweets.push({
          tweetId: tweet.tweetId,
          url: tweet.url,
          datetime: tweet.datetime,
          screenshot: shot,
          imageUrls,
          savedImages,
          savedVideos: [],
        });
        seenIds.add(tweet.tweetId);
        console.log(`  [見守り] @${tweet.handle} の投稿を記録しました（${savedImages.length} 枚）`);

        // 記録した分をそのつど書き出す(途中で閉じても残るように)
        const acc = byHandle.get(tweet.handle);
        writeFileSync(join(tabDir, dirName, 'tweets.json'), JSON.stringify(acc, null, 2), 'utf8');
      } catch (err) {
        if (page.isClosed()) break;
        failures.push({ type: 'manual', url: tweet.url, error: cleanError(err) });
      }
    }

    // 見ている邪魔をしないよう、少し待ってから次を確認する
    await sleep(2000);
  }

  if (followed.size) {
    mkdirSync(tabDir, { recursive: true });
    writeFileSync(join(tabDir, 'followed.json'), JSON.stringify([...followed], null, 2), 'utf8');
    console.log(`  [見守り] あなたがフォローしたアカウント ${followed.size} 件を記録しました。`);
  }
  console.log('見守りを終わります。');
  return [...byHandle.values()];
}

async function scrapeTab(page, tabKey, runDir, seenIds, failures, media, comments) {
  console.log(`\n===== タブ「${tabKey}」の収集を開始 =====`);
  await safeGoto(page, 'https://x.com/home');
  const tabLabel = await switchToTab(page, tabKey);
  console.log(`タブ「${tabLabel}」に切り替えました。スクロールしながら収集します...`);

  const tabDir = join(runDir, tabKey);
  const byAccount = await collectFromTimeline(page, seenIds, { tabDir });
  console.log(`${byAccount.size} アカウント分の投稿を検出しました。`);

  const summary = [];
  const tabData = [];

  for (const [handle, account] of byAccount) {
    const dirName = sanitize(handle);
    const accountDir = join(tabDir, dirName);
    const imagesDir = join(accountDir, 'images');
    const videosDir = join(accountDir, 'videos');
    mkdirSync(imagesDir, { recursive: true });
    if (CONFIG.saveVideos) mkdirSync(videosDir, { recursive: true });

    const tweets = [];
    for (const tweet of account.tweets.values()) {
      if (isCancelled()) break;
      console.log(`@${handle}: ${tweet.url}`);

      // 1件の失敗で全体が止まらないよう、投稿ごとに保護する
      try {
        const imageUrls = tweet.images.map(toOriginalImageUrl);
        const savedImages = [];
        let imageFailed = 0;
        for (let i = 0; i < imageUrls.length; i++) {
          const ext = imageExtension(tweet.images[i]);
          const filename = `${tweet.tweetId}_${i + 1}.${ext}`;
          if (await downloadImage(imageUrls[i], join(imagesDir, filename))) {
            savedImages.push(filename);
          } else {
            imageFailed++;
            failures.push({ type: 'image', url: imageUrls[i], tweetUrl: tweet.url });
          }
        }
        if (imageFailed > 0) console.warn(`    画像 ${imageFailed} 件を取得できませんでした(記録に残します)。`);

        const record = {
          tweetId: tweet.tweetId,
          url: tweet.url,
          datetime: tweet.datetime,
          // 本文はスクリーンショットに残す。テキストは保存しない(後でローカルLLMが画像から読み取る想定)。
          screenshot: tweet.screenshot ?? null,
          imageUrls,
          savedImages,
          savedVideos: [],
        };

        if (CONFIG.saveScreenshots && !record.screenshot) {
          failures.push({ type: 'screenshot', tweetUrl: tweet.url });
        }

        if (CONFIG.fetchReplies) {
          // 詳細ページを次々に開くのは自動化とみなされやすいので、開く前に少し間を置く
          await jitterSleep(CONFIG.betweenRepliesMs);
          // コメントは投稿を開いたときに取得する(このとき動画URLも一緒に集まる)
          record.replies = await fetchReplies(page, tweet);
        }

        // 動画の保存(投稿本体)
        if (CONFIG.saveVideos) {
          record.savedVideos = await saveVideosFor(tweet.tweetId, media, videosDir, `${tweet.tweetId}`, failures, tweet.url);
        }

        // コメントのメディアは、コメント自身に紐づけて保存する
        if (CONFIG.fetchReplies) {
          for (let r = 0; r < record.replies.length; r++) {
            const reply = record.replies[r];
            reply.savedImages = [];
            for (let i = 0; i < reply.images.length; i++) {
              const ext = imageExtension(reply.images[i]);
              const filename = `c${reply.commentId}_${i + 1}.${ext}`;
              if (await downloadImage(reply.images[i], join(imagesDir, filename))) {
                reply.savedImages.push(filename);
              }
            }
            reply.savedVideos = CONFIG.saveVideos
              ? await saveVideosFor(reply.commentId, media, videosDir, `c${reply.commentId}`, failures, reply.url)
              : [];
            if (CONFIG.saveComments) {
              comments.push({
                commentId: reply.commentId,
                parentTweetId: tweet.tweetId,
                parentUrl: tweet.url,
                account: handle,
                handle: reply.handle,
                displayName: reply.displayName,
                text: reply.text,
                datetime: reply.datetime,
                url: reply.url,
                dirName,
                tab: tabKey,
                savedImages: reply.savedImages,
                savedVideos: reply.savedVideos,
              });
            }
          }
        }

        tweets.push(record);
        seenIds.add(tweet.tweetId);
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err; // 再ログインは上位で行う
        console.warn(`    この投稿の取得に失敗したのでスキップします: ${cleanError(err)}`);
        failures.push({ type: 'tweet', url: tweet.url, error: cleanError(err) });
      }
      await humanPause(1200, 3000);
    }

    const accountData = { handle, displayName: account.displayName, dirName, tab: tabKey, tweets };
    writeFileSync(join(accountDir, 'tweets.json'), JSON.stringify(accountData, null, 2), 'utf8');
    summary.push({ handle, displayName: account.displayName, tweetCount: tweets.length });
    tabData.push(accountData);

    // 次のアカウントへ移る前に、人間らしい「間」を置く(まとめて一気に処理しない)
    if (!isCancelled()) await jitterSleep(CONFIG.betweenAccountsMs);
  }

  writeFileSync(join(tabDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`タブ「${tabKey}」完了: ${summary.length} アカウントを ${tabDir} に保存しました。`);
  return tabData;
}

// 収集の本体。overrides で CONFIG の値を上書きできる(対話モードから利用)。
// onSessionExpired: セッション切れ時に呼ばれ、再ログイン後の認証ファイルのパスを返す関数
// 戻り値: { runDir, htmlPath, csvPath, totalAccounts, failures }
export async function runScrape({
  tabs = ['recommend', 'following'],
  overrides = {},
  authStatePath = null,
  outputDir = null,
  onSessionExpired = null,
} = {}) {
  Object.assign(CONFIG, overrides);
  let statePath = authStatePath || CONFIG.authStatePath;
  const outDir = outputDir || CONFIG.outputDir;

  if (!existsSync(statePath)) {
    throw new Error(`認証情報 (${statePath}) が見つかりません。先にログインしてください。`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(outDir, timestamp);
  mkdirSync(runDir, { recursive: true });

  const seenPath = join(outDir, 'seen.json');
  const seenIds = loadSeenIds(seenPath);
  const dataByTab = {};
  const failures = [];
  const comments = []; // コメント単体の記録
  const remaining = [...tabs];
  let reloginLeft = onSessionExpired ? 1 : 0; // 自動再ログインは1回まで

  while (remaining.length > 0) {
    // 通常は付属ブラウザを自動検出。CHROMIUM_PATH での指定や、起動不能時の
    // Chrome/Edge への切り替えは launchBrowser 側で行う
    const browser = await launchBrowser({ headless: CONFIG.headless });
    const context = await browser.newContext({
      storageState: statePath,
      locale: 'ja-JP',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    // ページの通信から動画URLを拾い続ける
    const media = CONFIG.saveVideos ? attachMediaCapture(page) : null;
    let sessionExpired = false;

    // あなたが手でフォローした相手を控えておく。
    // フォロー時の通信の「返事」に相手のアカウント名が入っているので、そこから拾う。
    const followed = new Set();
    page.on('response', async (res) => {
      if (!/CreateFriendship|\/friendships\/create/i.test(res.url())) return;
      try {
        const body = await res.json();
        const name = findScreenName(body);
        if (name) followed.add(name);
      } catch {
        // 読み取れなくても操作の邪魔はしない
      }
    });

    try {
      while (remaining.length > 0) {
        if (isCancelled()) {
          console.log('中止が要求されたため、ここまでの結果を保存します。');
          break;
        }
        const tabKey = remaining[0];
        try {
          dataByTab[tabKey] = await scrapeTab(page, tabKey, runDir, seenIds, failures, media, comments);
        } catch (err) {
          if (err instanceof SessionExpiredError) throw err;
          // このタブは失敗しても、他のタブと既に集めた分は活かす
          console.warn(`\nタブ「${tabKey}」の収集に失敗しました: ${cleanError(err)}`);
          failures.push({ type: 'tab', tab: tabKey, error: cleanError(err) });
          dataByTab[tabKey] = dataByTab[tabKey] ?? [];
        }
        remaining.shift();
        // 次のタブに移る前にも少し間を置く
        if (remaining.length > 0 && !isCancelled()) await jitterSleep(CONFIG.betweenAccountsMs);
      }

      // 収集が終わってもブラウザを開いたままにして、あなたの操作を記録する
      if (CONFIG.keepBrowserOpen && !CONFIG.headless && !isCancelled() && !page.isClosed()) {
        dataByTab.manual = await watchManual(page, runDir, seenIds, failures, followed);
      }
    } catch (err) {
      if (err instanceof SessionExpiredError && reloginLeft > 0) {
        sessionExpired = true;
      } else {
        saveSeenIds(seenIds, seenPath);
        await context.storageState({ path: statePath }).catch(() => {});
        await browser.close();
        throw err;
      }
    } finally {
      media?.detach();
      saveSeenIds(seenIds, seenPath);
      if (!sessionExpired) await context.storageState({ path: statePath }).catch(() => {});
      // 「開いたままにする」設定のときは閉じない(そのまま自分で操作できる)。
      // 閉じ忘れにならないよう、アプリ終了時に片付けられるよう控えておく。
      const keepOpen = CONFIG.keepBrowserOpen && !CONFIG.headless && !sessionExpired;
      if (keepOpen && browser.isConnected()) {
        openedBrowsers.add(browser);
        browser.on('disconnected', () => openedBrowsers.delete(browser));
        console.log('\nブラウザは開いたままにしています。そのままご覧いただけます。');
      } else {
        await browser.close().catch(() => {});
      }
    }

    if (sessionExpired) {
      reloginLeft--;
      console.warn('\n[補正] ログインセッションが切れていました。再ログインして続きから再開します...');
      failures.push({ type: 'session', error: 'セッション切れのため再ログインしました' });
      statePath = (await onSessionExpired()) || statePath;
    }
  }

  if (CONFIG.saveComments && comments.length) {
    writeFileSync(join(runDir, 'comments.json'), JSON.stringify(comments, null, 2), 'utf8');
  }
  const { htmlPath, csvPath } = generateReport(runDir, dataByTab, comments);
  const totalAccounts = Object.values(dataByTab).reduce((n, a) => n + a.length, 0);

  // 失敗があれば記録に残す(あとで確認・再取得できるように)
  if (failures.length > 0) {
    writeFileSync(join(runDir, 'errors.json'), JSON.stringify(failures, null, 2), 'utf8');
  }

  console.log(`\nすべて完了しました。`);
  console.log(`  結果フォルダ : ${runDir}`);
  console.log(`  レポート     : ${htmlPath} (ブラウザで開けます)`);
  console.log(`  CSV          : ${csvPath}`);
  if (comments.length) console.log(`  コメント     : ${join(runDir, 'comments.json')}(${comments.length} 件)`);
  if (failures.length > 0) {
    const counts = failures.reduce((m, f) => ((m[f.type] = (m[f.type] || 0) + 1), m), {});
    console.log(`  取得できなかったもの: ${JSON.stringify(counts)} → ${join(runDir, 'errors.json')}`);
  }
  return { runDir, htmlPath, csvPath, totalAccounts, failures, comments: comments.length };
}

// 直接実行されたときだけCLIとして動く
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScrape(parseArgs()).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
