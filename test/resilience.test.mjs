// 失敗検知と自動補正のテスト。実行: npm test
// ネットワークやXへの接続は不要です(すべて手元で完結します)。
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkPageState,
  withRetry,
  isRetryableError,
  SessionExpiredError,
  FollowLimitError,
} from '../src/resilience.js';
import { classifyLoginPage } from '../src/login.js';

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  NG   ${name}`);
  }
};

const mockPage = (info) => ({ evaluate: async () => info });
const base = { url: 'https://x.com/home', text: '', hasNav: true, hasLoginBtn: false, hasTweet: true, hasUserCell: false };

// ---- 1. ページ状態の検知 ---------------------------------------------------
console.log('\n[1] ページ状態の検知');
check(
  'セッション切れ(ログイン画面)',
  (await checkPageState(mockPage({ ...base, url: 'https://x.com/i/flow/login', hasNav: false, hasLoginBtn: true, hasTweet: false }))).state === 'login'
);
check(
  'レート制限',
  (await checkPageState(mockPage({ ...base, text: 'Rate limit exceeded', hasTweet: false }))).state === 'ratelimit'
);
check(
  '存在しない/凍結アカウント',
  (await checkPageState(mockPage({ ...base, text: 'このアカウントは存在しません', hasTweet: false }))).state === 'notfound'
);
check(
  'エラー画面(再試行ボタン)',
  (await checkPageState(mockPage({ ...base, text: '問題が発生しました。再試行', hasTweet: false }))).state === 'error'
);
check(
  '中身が空(DOM変更の疑い)',
  (await checkPageState(mockPage({ ...base, hasNav: false, hasTweet: false }))).state === 'empty'
);
check('正常なページ', (await checkPageState(mockPage(base))).state === 'ok');
check(
  'ページ評価に失敗しても落ちない',
  (await checkPageState({ evaluate: async () => { throw new Error('destroyed'); } })).state === 'unknown'
);

// ---- 2. 再試行すべきエラーの判定 -------------------------------------------
console.log('\n[2] 再試行の判定');
check('通信エラーは再試行する', isRetryableError(new Error('net::ERR_CONNECTION_RESET at https://x.com')));
check('タイムアウトは再試行する', isRetryableError(new Error('Timeout 30000ms exceeded')));
check('それ以外は再試行しない', !isRetryableError(new Error('想定外の失敗')));

// ---- 2b. ログイン画面の文言から問題を見分ける ------------------------------
console.log('\n[2b] ログイン画面の判定');
check('ログイン制限を検知', classifyLoginPage('ログインを一時的に制限しました。しばらくしてからやりなおしてください。') === 'ratelimit');
check('英語のレート制限も検知', classifyLoginPage('Too many login attempts. Try again later.') === 'ratelimit');
check('凍結も制限扱い', classifyLoginPage('Your account is suspended') === 'ratelimit');
check('パスワード誤りを検知', classifyLoginPage('パスワードが間違っています') === 'password');
check('通常のログイン画面は問題なし', classifyLoginPage('電話番号 またはメールアドレス') === null);
check('空文字でも落ちない', classifyLoginPage('') === null);
check('null でも落ちない', classifyLoginPage(null) === null);

// ---- 3. 自動再試行の動作 ---------------------------------------------------
console.log('\n[3] 自動再試行');
let calls = 0;
const value = await withRetry(
  'テスト',
  async () => {
    calls++;
    if (calls < 3) throw new Error('net::ERR_CONNECTION_RESET');
    return 'ok';
  },
  { retries: 4, baseMs: 10 }
);
check('一時的な失敗のあと成功する', value === 'ok' && calls === 3);

calls = 0;
let thrown = null;
try {
  await withRetry('テスト', async () => { calls++; throw new SessionExpiredError(); }, { retries: 4, baseMs: 10 });
} catch (e) { thrown = e; }
check('セッション切れは即座に通知(再試行しない)', thrown instanceof SessionExpiredError && calls === 1);

calls = 0;
thrown = null;
try {
  await withRetry('テスト', async () => { calls++; throw new FollowLimitError(); }, { retries: 4, baseMs: 10 });
} catch (e) { thrown = e; }
check('フォロー制限は即座に通知(再試行しない)', thrown instanceof FollowLimitError && calls === 1);

calls = 0;
thrown = null;
try {
  await withRetry('テスト', async () => { calls++; throw new Error('net::ERR_CONNECTION_RESET'); }, { retries: 3, baseMs: 10 });
} catch (e) { thrown = e; }
check('上限まで試して、直らなければ失敗を返す', thrown !== null && calls === 3);

// ---- 4. セッション切れからの復旧(index.js と同じ流れ)---------------------
console.log('\n[4] セッション切れからの自動復旧');
async function withSessionRecovery(ensureSession, fn) {
  let statePath = await ensureSession(false);
  try {
    return await fn(statePath);
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) throw err;
    statePath = await ensureSession(true);
    return await fn(statePath);
  }
}
let logins = 0;
let attempts = 0;
const ensure = async (force) => { logins++; return force ? 'new' : 'old'; };
const recovered = await withSessionRecovery(ensure, async (p) => {
  attempts++;
  if (p === 'old') throw new SessionExpiredError();
  return '完了';
});
check('再ログインして処理をやり直す', recovered === '完了' && logins === 2 && attempts === 2);

attempts = 0;
thrown = null;
try {
  await withSessionRecovery(ensure, async () => { attempts++; throw new SessionExpiredError(); });
} catch (e) { thrown = e; }
check('直らなければ通知し、無限ループしない', thrown instanceof SessionExpiredError && attempts === 2);

// ---- 5. 画像ダウンロードの補正 ---------------------------------------------
console.log('\n[5] 画像ダウンロードの自動補正');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// src/scrape.js の downloadImage と同じ手順
async function downloadImage(url, destPath, { retries = 3 } = {}) {
  for (const target of [...new Set([url, url.replace(/name=orig/, 'name=large')])]) {
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
        if (/HTTP 4[0-9]{2}/.test(msg) && !/HTTP 429/.test(msg)) break;
        if (attempt < retries) await sleep(30);
      }
    }
  }
  return false;
}

const hits = { flaky: 0, orig: 0 };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/flaky') {
    hits.flaky++;
    if (hits.flaky < 3) { res.writeHead(500); return res.end(); }
    res.writeHead(200); return res.end('IMAGE');
  }
  if (u.pathname === '/origfail') {
    hits.orig++;
    if (u.searchParams.get('name') === 'orig') { res.writeHead(404); return res.end(); }
    res.writeHead(200); return res.end('LARGE');
  }
  if (u.pathname === '/empty') { res.writeHead(200); return res.end(''); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const dir = join(tmpdir(), `x-scraper-test-${process.pid}`);
mkdirSync(dir, { recursive: true });

check(
  '一時的な失敗は待って取り直す',
  (await downloadImage(`http://127.0.0.1:${port}/flaky?name=orig`, join(dir, 'a.jpg'))) === true &&
    readFileSync(join(dir, 'a.jpg'), 'utf8') === 'IMAGE' &&
    hits.flaky === 3
);
check(
  '最高画質が無ければ画質を下げて取得する',
  (await downloadImage(`http://127.0.0.1:${port}/origfail?name=orig`, join(dir, 'b.jpg'))) === true &&
    readFileSync(join(dir, 'b.jpg'), 'utf8') === 'LARGE' &&
    hits.orig === 2 // 404は1回で見切りをつける
);
check('空ファイルは失敗として記録する', (await downloadImage(`http://127.0.0.1:${port}/empty?name=orig`, join(dir, 'c.jpg'))) === false);

server.close();
rmSync(dir, { recursive: true, force: true });

// ---- 6. マルチビューのタイル配置 -------------------------------------------
console.log('\n[6] 複数アカウント同時表示のウィンドウ配置');
const { computeGrid } = await import('../src/multiview.js');
const screen = { width: 1920, height: 1080 };

const overlaps = (g) => {
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) {
      const a = g[i], b = g[j];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) return true;
    }
  }
  return false;
};
const inScreen = (g) =>
  g.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.width <= screen.width && p.y + p.height <= screen.height);

for (const n of [1, 2, 3, 4, 5, 6]) {
  const g = computeGrid(n, screen);
  check(`${n}個: 枚数どおり・重なりなし・画面内に収まる`, g.length === n && !overlaps(g) && inScreen(g));
}

const five = computeGrid(5, screen);
check('5個は上段3・下段2に並ぶ', five.filter((p) => p.y === 0).length === 3 && five.filter((p) => p.y > 0).length === 2);
check('5個の下段は横幅いっぱいに広がる', five[3].width === 960 && five[4].x === 960);
check('0個を指定しても落ちない', computeGrid(0, screen).length === 0);

// ---- 7. 設定(アプリ内から変更できる項目)-----------------------------------
console.log('\n[7] アプリ内設定の保存と反映');
const { OPTION_SCHEMA, parseOption, formatOption, applyOptions, setOption, warnFor } = await import('../src/settings.js');

const byKey = (k) => OPTION_SCHEMA.find((o) => o.key === k);

// 入力の解釈
check('数値: 正しい値を受け付ける', parseOption(byKey('maxAccounts'), '25').value === 25);
check('数値: 範囲外を拒否する', parseOption(byKey('maxAccounts'), '999').ok === false);
check('数値: 文字を拒否する', parseOption(byKey('maxAccounts'), 'abc').ok === false);
check('数値: 小数を拒否する', parseOption(byKey('maxAccounts'), '2.5').ok === false);
check('はい/いいえ: y を true に', parseOption(byKey('fetchReplies'), 'y').value === true);
check('はい/いいえ: いいえ を false に', parseOption(byKey('fetchReplies'), 'いいえ').value === false);
check('はい/いいえ: 不正な入力を拒否', parseOption(byKey('fetchReplies'), 'ほげ').ok === false);
check('秒→ミリ秒に変換して保存', parseOption(byKey('followDelayMinMs'), '30').value === 30000);
check('キーワード: 空白区切りで配列に', JSON.stringify(parseOption(byKey('keywords'), '猫 犬').value) === '["猫","犬"]');
check('キーワード: 「なし」で解除', parseOption(byKey('keywords'), 'なし').value.length === 0);
check('列数: 「自動」を null に', parseOption(byKey('viewColumns'), '自動').value === null);
check('列数: 範囲外を拒否', parseOption(byKey('viewColumns'), '9').ok === false);
check('小数: 動作の速さを受け付ける', parseOption(byKey('speedFactor'), '1.5').value === 1.5);

// 表示形式
check('表示: 秒に戻して見せる', formatOption(byKey('followDelayMinMs'), 30000) === '30 秒');
check('表示: 真偽値を日本語に', formatOption(byKey('fetchReplies'), true) === 'はい');
check('表示: 未設定のキーワード', formatOption(byKey('keywords'), []).includes('なし'));

// 危険な値の警告
check('多すぎるフォロー数に警告', warnFor(byKey('maxFollowsPerRun'), 100, {}) !== null);
check('短すぎる間隔に警告', warnFor(byKey('followDelayMinMs'), 3000, {}) !== null);
check('安全な値には警告しない', warnFor(byKey('maxFollowsPerRun'), 20, {}) === null);

// 保存と CONFIG への反映
const cfg = { maxAccounts: 10, followDelayMinMs: 25000, followDelayMaxMs: 60000, outputDir: 'output' };
const st = { options: {}, outputDir: '' };
setOption(st, byKey('maxAccounts'), 30, cfg);
applyOptions(st, cfg);
check('変更した値が CONFIG に反映される', cfg.maxAccounts === 30);

// 最短 > 最長 になったら自動でそろえる
setOption(st, byKey('followDelayMinMs'), 90000, cfg);
applyOptions(st, cfg);
check('最短が最長を超えたら最長も合わせる', cfg.followDelayMaxMs === 90000 && cfg.followDelayMinMs === 90000);

// 保存先の反映
st.outputDir = '/tmp/mydir';
applyOptions(st, cfg);
check('保存先が CONFIG に反映される', cfg.outputDir === '/tmp/mydir');

// 既定に戻す
const cfg2 = { maxAccounts: 10 };
applyOptions({ options: {}, outputDir: '' }, cfg2);
check('設定が空なら既定値のまま', cfg2.maxAccounts === 10);

check('すべての設定項目が編集可能(スキーマに定義あり)', OPTION_SCHEMA.length >= 16);

// 隠して実行は自動操作とみなされやすいので警告する
check('隠して実行に警告', warnFor(byKey('headless'), true, {}) !== null);
check('表示して実行には警告しない', warnFor(byKey('headless'), false, {}) === null);

// BAN対策の「間」設定と警告
check('アカウント切替の間隔が設定できる', byKey('betweenAccountsMs') !== undefined);
check('コメントを開く間隔が設定できる', byKey('betweenRepliesMs') !== undefined);
check('短すぎる収集間隔に警告', warnFor(byKey('betweenRepliesMs'), 1000, {}) !== null);
check('十分な収集間隔には警告しない', warnFor(byKey('betweenRepliesMs'), 6000, {}) === null);

// 「間」を作るヘルパー: 0 なら待たずにすぐ返る
const { jitterSleep } = await import('../src/humanize.js');
const t0 = Date.now();
await jitterSleep(0);
check('間隔0なら待たない', Date.now() - t0 < 50);


// ---- 7.5 動画URLの取り出し -------------------------------------------------
console.log('\n[7] 動画URLの取り出しとビューアのデータ作り');
const { collectMediaFromJson, pickBestVariant } = await import('../src/media.js');


// Xの実際の応答に近い形のデータ
const sample = {
  data: { threaded_conversation: { instructions: [{ entries: [
    { content: { itemContent: { tweet_results: { result: {
      rest_id: '1111',
      legacy: {
        full_text: '動画つき投稿',
        extended_entities: { media: [{
          type: 'video',
          media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1111/img/thumb.jpg',
          expanded_url: 'https://x.com/someone/status/1111/video/1',
          video_info: {
            duration_millis: 30500,
            variants: [
              { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' },
              { bitrate: 256000, content_type: 'video/mp4', url: 'https://video.twimg.com/low.mp4' },
              { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/high.mp4' },
              { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/mid.mp4' },
            ],
          },
        }] },
      },
    } } } } },
    { content: { itemContent: { tweet_results: { result: {
      rest_id: '2222',
      legacy: { extended_entities: { media: [{
        type: 'animated_gif',
        media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/2222.jpg',
        expanded_url: 'https://x.com/someone/status/2222/video/1',
        video_info: { variants: [{ bitrate: 0, content_type: 'video/mp4', url: 'https://video.twimg.com/gif.mp4' }] },
      }] } },
    } } } } },
    // 画像だけの投稿(動画として拾ってはいけない)
    { content: { itemContent: { tweet_results: { result: {
      rest_id: '3333',
      legacy: { extended_entities: { media: [{
        type: 'photo', media_url_https: 'https://pbs.twimg.com/media/photo.jpg',
        expanded_url: 'https://x.com/someone/status/3333/photo/1',
      }] } },
    } } } } },
  ] }] } },
};

console.log('  [動画URLの抽出]');
const found = collectMediaFromJson(sample);
check('動画つき投稿を見つける', found.has('1111'));
check('最高画質のmp4を選ぶ', found.get('1111')?.[0]?.url === 'https://video.twimg.com/high.mp4');
check('  ビットレートも記録する', found.get('1111')?.[0]?.bitrate === 2176000);
check('再生時間を記録する', found.get('1111')?.[0]?.durationMs === 30500);
check('サムネイルを記録する', String(found.get('1111')?.[0]?.thumbnail).includes('thumb.jpg'));
check('GIFも動画として扱う', found.get('2222')?.[0]?.type === 'gif');
check('画像だけの投稿は動画にしない', !found.has('3333'));
check('拾った投稿は2件だけ', found.size === 2);

console.log('  [画質の選択]');
check('mp4が無ければm3u8を返す', pickBestVariant([{content_type:'application/x-mpegURL',url:'a.m3u8'}])?.kind === 'hls');
check('候補が無ければnull', pickBestVariant([]) === null);
check('壊れた候補でも落ちない', pickBestVariant([null, {}, {content_type:'video/mp4'}]) === null);

console.log('  [異常なデータでも落ちない]');
check('null', collectMediaFromJson(null).size === 0);
check('循環しない深いデータ', collectMediaFromJson({a:{b:{c:{d:{e:{}}}}}}).size === 0);
const deep = {}; let cur = deep;
for (let i=0;i<200;i++) { cur.next = {}; cur = cur.next; }
check('極端に深い入れ子でも止まる', collectMediaFromJson(deep).size === 0);
check('同じ動画を重複登録しない', (() => {
  const m = collectMediaFromJson(sample); collectMediaFromJson(sample, m);
  return m.get('1111').length === 1;
})());


// ビューア用データの組み立て
const { buildViewData } = await import('../src/report.js');
const view = buildViewData(
  { recommend: [{ handle: 'alice', displayName: 'アリス', dirName: 'alice', tab: 'recommend', tweets: [
    { tweetId: '1', url: 'u1', datetime: '2026-08-29T10:00:00Z', text: 'あ', screenshot: 'screenshots/1.png',
      savedImages: ['a.jpg'], savedVideos: [{ file: 'v.mp4', type: 'video', durationMs: 5000 }], replies: [{}] },
    { tweetId: '2', url: 'u2', datetime: '2026-08-29T09:00:00Z', text: 'い',
      savedImages: [], savedVideos: [{ file: null, url: 'x.m3u8' }] },
  ] }] },
  [{ commentId: '9', parentTweetId: '1', parentUrl: 'u1', account: 'alice', handle: 'bob', displayName: 'ボブ',
     text: 'こめんと', datetime: '2026-08-29T10:30:00Z', url: 'u9', dirName: 'alice', tab: 'recommend',
     savedImages: ['c.jpg'], savedVideos: [] }]
);
check('投稿とコメントが同じ並びに入る', view.items.length === 3);
check('コメントに印がつく', view.items.filter((i) => i.kind === 'comment').length === 1);
check('画像の場所が正しく組み立てられる', view.items[0].images[0] === 'recommend/alice/images/a.jpg');
check('スクショの場所が正しく組み立てられる', view.items[0].screenshot === 'recommend/alice/screenshots/1.png');
check('スクショが無い投稿は null', view.items[1].screenshot === null);
check('動画の場所が正しく組み立てられる', view.items[0].videos[0].src === 'recommend/alice/videos/v.mp4');
check('保存できなかった動画は数だけ記録', view.items[1].missingVideos === 1 && view.items[1].videos.length === 0);
check('コメントは元の投稿とひも付く', view.items[2].onAccount === 'alice' && view.items[2].parentUrl === 'u1');
check('アカウント一覧が作られる', view.accounts.length === 1 && view.accounts[0].handle === 'alice');

// ---- 結果 ------------------------------------------------------------------
console.log(`\n=== ${pass} 件成功 / ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
