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

// ---- 結果 ------------------------------------------------------------------
console.log(`\n=== ${pass} 件成功 / ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
