// 複数アカウントを同時に表示するマルチビュー。
// アカウントごとに独立したブラウザウィンドウを開き、画面をタイル状に並べます。
// セッションはアカウントごとに分かれているため、同時にログインしたまま操作できます。
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { CONFIG } from './config.js';
import { humanPause } from './humanize.js';
import { cleanError, checkPageState } from './resilience.js';

// 画面(作業領域)のサイズを調べる。取得できなければ一般的なサイズを使う。
export async function detectScreenSize() {
  const fallback = { width: 1920, height: 1080 };
  const run = (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => {
        resolve(err ? null : String(stdout).trim());
      });
    });

  try {
    if (process.platform === 'win32') {
      const ps =
        'Add-Type -AssemblyName System.Windows.Forms; ' +
        '$a=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; ' +
        'Write-Output "$($a.Width)x$($a.Height)"';
      const out = await run('powershell', ['-NoProfile', '-Command', ps]);
      const m = out && out.match(/(\d+)x(\d+)/);
      if (m) return { width: +m[1], height: +m[2] };
    } else if (process.platform === 'darwin') {
      const out = await run('osascript', ['-e', 'tell application "Finder" to get bounds of window of desktop']);
      const nums = out && out.match(/\d+/g);
      if (nums && nums.length >= 4) return { width: +nums[2], height: +nums[3] };
    } else {
      const out = await run('sh', ['-c', "xrandr 2>/dev/null | grep '\\*' | head -1"]);
      const m = out && out.match(/(\d+)x(\d+)/);
      if (m) return { width: +m[1], height: +m[2] };
    }
  } catch {
    // 検出できなければ既定値を使う
  }
  return fallback;
}

// ウィンドウをタイル状に並べる位置とサイズを計算する。
// 5個なら 3列×2行(上段3・下段2)のように、なるべく正方形に近い配置にする。
export function computeGrid(count, screen, columns = null) {
  if (count <= 0) return [];
  // 1〜3個は横一列、4個は2×2、5個以上は3列(5個なら上段3・下段2)
  const cols = columns || (count <= 3 ? count : count === 4 ? 2 : 3);
  const rows = Math.ceil(count / cols);
  const cellW = Math.floor(screen.width / cols);
  const cellH = Math.floor(screen.height / rows);

  const positions = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // 最終行が余る場合は、その行の中で均等に広げる
    const inThisRow = Math.min(cols, count - row * cols);
    const rowW = Math.floor(screen.width / inThisRow);
    positions.push({
      x: col * (inThisRow === cols ? cellW : rowW),
      y: row * cellH,
      width: inThisRow === cols ? cellW : rowW,
      height: cellH,
    });
  }
  return positions;
}

// 1アカウント分のウィンドウを開く
async function openOne(account, statePath, pos, { headless = false } = {}) {
  const browser = await chromium.launch({
    headless,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      `--window-position=${pos.x},${pos.y}`,
      `--window-size=${pos.width},${pos.height}`,
      // 自動操作であることを目立たせない
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const context = await browser.newContext({
    storageState: statePath,
    locale: 'ja-JP',
    // viewport: null でウィンドウサイズにそのまま追従させる
    viewport: headless ? { width: pos.width, height: pos.height } : null,
  });
  const page = await context.newPage();
  return { account, statePath, browser, context, page };
}

// 複数アカウントを同時に開く。
// entries: [{ account, statePath }]
export async function openMultiView(entries, { columns = null, headless = false, screen = null } = {}) {
  const size = screen || (await detectScreenSize());
  const grid = computeGrid(entries.length, size, columns);
  const views = [];

  for (let i = 0; i < entries.length; i++) {
    const { account, statePath } = entries[i];
    const name = account?.label || account?.username || '手動ログイン';
    try {
      const view = await openOne(account, statePath, grid[i], { headless });
      views.push(view);
      console.log(`  [${i + 1}/${entries.length}] ${name} のウィンドウを開きました`);
      // 同時に開きすぎると重いので少しずつ
      await humanPause(600, 1200);
    } catch (err) {
      console.warn(`  [${i + 1}/${entries.length}] ${name} を開けませんでした: ${cleanError(err)}`);
    }
  }
  return views;
}

// 全ウィンドウを指定URLへ移動する(1つ失敗しても他は続行)
export async function gotoAll(views, url) {
  const results = await Promise.allSettled(
    views.map((v) => v.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }))
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { total: views.length, failed };
}

export async function reloadAll(views) {
  const results = await Promise.allSettled(
    views.map((v) => v.page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }))
  );
  return { total: views.length, failed: results.filter((r) => r.status === 'rejected').length };
}

// 各ウィンドウが今どのページを開いているかを返す
export async function statusAll(views) {
  return Promise.all(
    views.map(async (v) => {
      const name = v.account?.label || v.account?.username || '手動ログイン';
      const alive = v.browser.isConnected();
      let url = '(閉じています)';
      if (alive) {
        try {
          url = v.page.url(); // Playwright の url() は同期メソッド
        } catch {
          url = '(取得できません)';
        }
      }
      return { name, alive, url };
    })
  );
}

// 各ウィンドウがきちんとログインできているか確認する。
// 戻り値: [{ name, state }] (state が 'login' なら再ログインが必要)
export async function checkLoginAll(views) {
  return Promise.all(
    views.map(async (v) => {
      const name = v.account?.label || v.account?.username || '手動ログイン';
      if (!v.browser.isConnected()) return { name, state: 'closed' };
      try {
        const { state } = await checkPageState(v.page);
        return { name, state };
      } catch {
        return { name, state: 'unknown' };
      }
    })
  );
}

// 全ウィンドウを閉じる。閉じる前にセッションを保存して次回に活かす。
export async function closeAll(views) {
  for (const v of views) {
    try {
      if (v.browser.isConnected()) {
        await v.context.storageState({ path: v.statePath }).catch(() => {});
        await v.browser.close();
      }
    } catch {
      // 閉じる際の失敗は無視してよい
    }
  }
}
