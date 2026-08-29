// Xの公式アーカイブ(設定 → データのアーカイブをダウンロード)から、
// フォロー中・フォロワーの一覧を取り出します。
//
// この方法はXの正規機能で手に入れたファイルを読むだけなので、
// タイムラインの自動収集とは違い、アカウントに負担をかけません。
//
// アーカイブの data/following.js は、次のような形をしています:
//   window.YTD.following.part0 = [ { "following" : {
//     "accountId" : "1111111111111111111",
//     "userLink" : "https://twitter.com/intent/user?user_id=1111111111111111111" } } ]
//
// 数値IDしか入っていないため、@ユーザー名は
//   https://x.com/i/user/<ID>
// を開くと本人のプロフィールに切り替わる仕組みを使って調べます。
// このときログインしていないブラウザを使うので、あなたのアカウントは一切使いません。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser } from './browser.js';

// window.YTD.xxx.partN = [...] という形のファイルから、中のJSONを取り出す
export function parseArchiveJs(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('=');
  if (start === -1) return [];
  const body = raw.slice(start + 1).trim().replace(/;\s*$/, '');
  try {
    const data = JSON.parse(body);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// following.js / follower.js の中身から、アカウントIDの一覧を取り出す
export function extractAccountIds(text) {
  const ids = [];
  for (const entry of parseArchiveJs(text)) {
    // { following: {...} } / { follower: {...} } のどちらでも拾えるようにする
    const inner = entry?.following ?? entry?.follower ?? entry;
    const id = inner?.accountId ?? inner?.userId;
    if (typeof id === 'string' && /^\d+$/.test(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

// アーカイブのフォルダ(またはその中のファイル)から、目的のファイルを探す。
// zipを展開したフォルダを渡しても、data/following.js を渡しても動くようにする。
export function findArchiveFile(pathInput, kind = 'following') {
  if (!existsSync(pathInput)) return null;
  // ファイルを直接指定された場合
  if (!isDirectory(pathInput)) return pathInput;

  const names = kind === 'follower'
    ? ['follower.js', 'followers.js']
    : ['following.js', 'followings.js'];
  // フォルダ直下 → data/ の順に探す
  for (const dir of [pathInput, join(pathInput, 'data')]) {
    if (!existsSync(dir) || !isDirectory(dir)) continue;
    const files = readdirSync(dir);
    for (const name of names) {
      const hit = files.find((f) => f.toLowerCase() === name);
      if (hit) return join(dir, hit);
    }
  }
  return null;
}

function isDirectory(p) {
  try {
    return readdirSync(p) !== undefined;
  } catch {
    return false;
  }
}

// 転送先のURLから @ユーザー名 を取り出す
export function handleFromUrl(url) {
  const m = String(url ?? '').match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  if (!m) return null;
  // ユーザー名ではないページ(404やログイン画面など)は除く
  const reserved = new Set([
    'i', 'intent', 'home', 'search', 'settings', 'login', 'explore',
    'notifications', 'messages', '404', 'account', 'tos', 'privacy', 'signup',
  ]);
  return reserved.has(m[1].toLowerCase()) ? null : m[1];
}

// 数値IDひとつを @ユーザー名 に変換する。
// x.com/i/user/<ID> を開くと、本人のプロフィールに切り替わるので、
// 切り替わった先のURLから名前を読み取る。ログインは不要。
export async function lookupHandle(page, accountId, { timeoutMs = 25000 } = {}) {
  try {
    await page.goto(`https://x.com/i/user/${encodeURIComponent(accountId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    // プロフィールへ切り替わるのを待つ(切り替わるとURLが @名前 になる)
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const handle = handleFromUrl(page.url());
      if (handle) return { ok: true, handle };
      // 見つからないアカウントの場合はその旨が表示される
      const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 600)).catch(() => '');
      if (/このアカウントは存在しません|アカウントは凍結されています|doesn’t exist|doesn't exist|Account suspended/i.test(text)) {
        return { ok: false, reason: '見つかりません(削除/凍結)' };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { ok: false, reason: '時間内に確認できませんでした' };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err).split('\n')[0].slice(0, 80) };
  }
}

// アーカイブのファイルを読み、すべてのIDを @ユーザー名 に変換する。
// 変換にはログインしていないブラウザを使うので、あなたのアカウントは一切使わない。
// 続けて開きすぎないよう、1件ごとに少し間を置く。
export async function convertArchiveList(pathInput, {
  kind = 'following',
  delayMs = 2500,
  onProgress = null,
  isCancelled = () => false,
} = {}) {
  const file = findArchiveFile(pathInput, kind);
  if (!file) {
    throw new Error(
      `${kind === 'follower' ? 'follower.js' : 'following.js'} が見つかりませんでした。` +
      'アーカイブを展開したフォルダ、または data フォルダの中のファイルを指定してください。'
    );
  }

  const ids = extractAccountIds(readFileSync(file, 'utf8'));
  if (!ids.length) throw new Error(`${file} からアカウントを読み取れませんでした。`);

  // ログインしていないブラウザを1つ開いて、そこで順番に調べる
  const browser = await launchBrowser({ headless: true });
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const accounts = [];
  const failures = [];
  try {
    for (let i = 0; i < ids.length; i++) {
      if (isCancelled()) break;
      const id = ids[i];
      const r = await lookupHandle(page, id);
      if (r.ok) accounts.push({ handle: r.handle, displayName: '', accountId: id });
      else failures.push({ accountId: id, reason: r.reason });

      onProgress?.({ done: i + 1, total: ids.length, handle: r.handle ?? null, id });
      // 最後の1件のあとは待たない
      if (i < ids.length - 1 && delayMs > 0) {
        await new Promise((r2) => setTimeout(r2, delayMs + Math.floor(Math.random() * 1200)));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { file, total: ids.length, accounts, failures };
}
