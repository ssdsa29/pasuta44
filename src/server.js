// ブラウザ画面(GUI)を提供するローカルサーバー。
// 起動すると既定のブラウザで操作画面が開きます。外部には公開されません
// (127.0.0.1 のみで待ち受け、同じPCからしかアクセスできません)。
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { login } from './login.js';
import { runScrape } from './scrape.js';
import { pickFolderDialog } from './pickFolder.js';
import { exportFollowing, collectRecommendAccounts, followAccounts } from './follows.js';
import { saveAccountList, listSavedFiles, readHandles } from './lists.js';
import { SessionExpiredError, RateLimitedError, cleanError } from './resilience.js';
import { openMultiView, gotoAll, reloadAll, statusAll, closeAll, checkLoginAll, detectScreenSize } from './multiview.js';
import {
  loadSettings, saveSettings, getActiveAccount, authStatePathFor,
  OPTION_SCHEMA, formatOption, parseOption, warnFor, applyOptions, setOption,
} from './settings.js';
import { runJob, subscribe, getState, cancelJob, log } from './jobs.js';
import { writeLog, readRecentLog, logPath } from './logger.js';

const WEB_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.csv': 'text/csv; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.txt': 'text/plain; charset=utf-8',
};

let settings = loadSettings();
applyOptions(settings, CONFIG);
let multiViews = []; // 同時表示中のウィンドウ

// Xにログインを制限されたら、しばらくは再ログインを受け付けない(短時間の連打で制限が延びるのを防ぐ)
const LOGIN_COOLDOWN_MS = 30 * 60 * 1000; // 30分
let loginCooldownUntil = 0;

const outputRoot = () => settings.outputDir || CONFIG.outputDir;

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function openInBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// 画面に見せる設定一覧
function settingsView() {
  return {
    outputDir: settings.outputDir,
    outputDirLabel: settings.outputDir || `${CONFIG.outputDir}(既定)`,
    options: OPTION_SCHEMA.map((o) => ({
      key: o.key, group: o.group, label: o.label, type: o.type,
      min: o.min, max: o.max, unit: o.unit,
      value: CONFIG[o.key],
      display: formatOption(o, CONFIG[o.key]),
      // 秒で扱う項目は、画面には秒で見せる
      raw: o.unit === 'sec' ? Math.round(CONFIG[o.key] / 1000) : CONFIG[o.key],
    })),
  };
}

function accountsView() {
  return {
    accounts: settings.accounts.map((a, i) => ({
      index: i, label: a.label, username: a.username,
      hasPassword: Boolean(a.password),
      loggedIn: existsSync(authStatePathFor(a)),
      active: i === settings.activeAccount,
    })),
    activeAccount: settings.activeAccount,
    manualLoggedIn: existsSync(authStatePathFor(null)),
  };
}

// 保存済みの一覧ファイル
function listsView() {
  return listSavedFiles(outputRoot())
    .filter((f) => f.file.endsWith('.txt'))
    .slice(0, 30)
    .map((f) => ({ file: f.file, path: f.path, count: safeCount(f.path) }));
}
function safeCount(p) {
  try {
    return readHandles(p).length;
  } catch {
    return 0;
  }
}

// 過去の実行結果(レポートへのリンク用)
async function runsView() {
  const root = outputRoot();
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const runs = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const reportPath = join(root, e.name, 'report.html');
      if (!existsSync(reportPath)) continue;
      const s = await stat(join(root, e.name));
      runs.push({ name: e.name, at: s.mtimeMs, url: `/files/${encodeURIComponent(e.name)}/report.html` });
    }
    return runs.sort((a, b) => b.at - a.at).slice(0, 10);
  } catch {
    return [];
  }
}

// 使用中アカウントのセッションを用意する
async function ensureSession({ force = false } = {}) {
  const account = getActiveAccount(settings);
  const statePath = authStatePathFor(account);
  if (force || !existsSync(statePath)) {
    log(`ログインが必要です。ブラウザを開きます(${account ? account.label || account.username : '手動ログイン'})...`);
    await login({ account, authStatePath: statePath });
    log('ログインしました。');
  }
  return statePath;
}

// セッション切れなら1度だけ再ログインしてやり直す
async function withSessionRecovery(fn) {
  let statePath = await ensureSession();
  try {
    return await fn(statePath);
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) throw err;
    log('ログインセッションが切れていました。再ログインしてやり直します...', 'warn');
    statePath = await ensureSession({ force: true });
    return await fn(statePath);
  }
}

// ---- 各機能の実行 ----------------------------------------------------------
const actions = {
  async scrape({ tabs }) {
    const use = Array.isArray(tabs) && tabs.length ? tabs : ['recommend', 'following'];
    settings.lastTabs = use;
    saveSettings(settings);
    const statePath = await ensureSession();
    const r = await runScrape({
      tabs: use,
      authStatePath: statePath,
      outputDir: settings.outputDir || null,
      onSessionExpired: () => ensureSession({ force: true }),
    });
    return {
      totalAccounts: r.totalAccounts,
      failures: r.failures?.length ?? 0,
      reportUrl: `/files/${encodeURIComponent(r.runDir.split(/[\\/]/).pop())}/report.html`,
    };
  },

  async exportFollowing() {
    const { owner, accounts } = await withSessionRecovery((p) => exportFollowing(p));
    if (!accounts.length) return { count: 0 };
    const saved = saveAccountList(outputRoot(), `following_${owner}`, accounts, { source: 'following', owner });
    log(`${accounts.length} 件を保存しました: ${saved.txtPath}`);
    return { count: accounts.length, file: saved.txtPath };
  },

  async collectRecommend({ max }) {
    const limit = Number(max) || CONFIG.maxRecommendAccounts;
    const accounts = await withSessionRecovery((p) => collectRecommendAccounts(p, { max: limit }));
    if (!accounts.length) return { count: 0 };
    const saved = saveAccountList(outputRoot(), 'recommend_accounts', accounts, { source: 'recommend' });
    log(`${accounts.length} アカウントを保存しました: ${saved.txtPath}`);
    return { count: accounts.length, file: saved.txtPath };
  },

  async migrate({ listPath, handles: given }) {
    let handles = [];
    if (listPath) handles = readHandles(listPath);
    else if (typeof given === 'string') {
      handles = given.split(/[\s,]+/).map((h) => h.replace(/^@/, '')).filter(Boolean);
    }
    handles = [...new Set(handles)];
    if (!handles.length) throw new Error('対象のアカウントがありません。');

    log(`対象 ${handles.length} 件 / 1回の上限 ${CONFIG.maxFollowsPerRun} 件 / 間隔 ${CONFIG.followDelayMinMs / 1000}〜${CONFIG.followDelayMaxMs / 1000} 秒`);
    const { follower, results, followedCount, notProcessed, stoppedBy } = await withSessionRecovery((p) =>
      followAccounts(p, handles, {
        onProgress: ({ handle, status, followed }) => {
          const label = { followed: '✓ フォロー', already: '- 既にフォロー済', notfound: '× 存在しない/凍結', nobutton: '× ボタンなし', failed: '× 失敗' }[status] ?? status;
          log(`[${followed}] @${handle} … ${label}`);
        },
      })
    );

    const retry = [...notProcessed, ...results.filter((r) => r.status === 'failed' || r.status === 'error').map((r) => r.handle)];
    let remainingFile = null;
    if (retry.length) {
      const saved = saveAccountList(outputRoot(), 'remaining', retry.map((h) => ({ handle: h, displayName: '' })), { source: 'remaining', reason: stoppedBy || 'upperLimit' });
      remainingFile = saved.txtPath;
      log(`残り ${retry.length} 件を保存しました: ${saved.txtPath}`);
    }
    return { follower, followedCount, stoppedBy, remaining: retry.length, remainingFile };
  },

  async multiview({ indexes }) {
    if (multiViews.length) throw new Error('すでに表示中です。先に閉じてください。');
    let entries;
    if (!settings.accounts.length) {
      entries = [{ account: null, statePath: authStatePathFor(null) }];
    } else {
      const picked = Array.isArray(indexes) && indexes.length
        ? indexes.map((i) => settings.accounts[i]).filter(Boolean)
        : settings.accounts.slice(0, CONFIG.maxParallelViews);
      entries = picked.slice(0, CONFIG.maxParallelViews).map((account) => ({ account, statePath: authStatePathFor(account) }));
    }
    if (!entries.length) throw new Error('表示するアカウントがありません。');

    for (const e of entries) {
      if (!existsSync(e.statePath)) {
        log(`「${e.account?.label || e.account?.username || '手動ログイン'}」はログインが必要です...`);
        await login({ account: e.account, authStatePath: e.statePath });
      }
    }

    const screen = await detectScreenSize();
    log(`画面 ${screen.width}x${screen.height} に ${entries.length} 個のウィンドウを並べます...`);
    multiViews = await openMultiView(entries, { columns: CONFIG.viewColumns, screen });
    if (!multiViews.length) throw new Error('ウィンドウを開けませんでした。');

    const opened = await gotoAll(multiViews, 'https://x.com/home');
    if (opened.failed) log(`${opened.failed} 個のウィンドウでページを読み込めませんでした。`, 'warn');
    const need = (await checkLoginAll(multiViews)).filter((s) => s.state === 'login');
    if (need.length) log(`ログインが切れているアカウント: ${need.map((s) => s.name).join('、')}`, 'warn');
    return { count: multiViews.length };
  },
};

// ---- ルーティング ----------------------------------------------------------
async function handleApi(req, res, url) {
  const path = url.pathname;

  if (path === '/api/state') {
    return json(res, {
      job: getState(),
      settings: settingsView(),
      ...accountsView(),
      lists: listsView(),
      runs: await runsView(),
      multiview: { open: multiViews.length, views: multiViews.length ? await statusAll(multiViews) : [] },
      lastTabs: settings.lastTabs,
      platform: process.platform,
    });
  }

  // 進捗のリアルタイム配信
  if (path === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const unsubscribe = subscribe(send);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    return;
  }

  // エラーの記録を画面に返す(GET)
  if (path === '/api/log') return json(res, { path: resolve(logPath), text: readRecentLog(400) });

  if (req.method !== 'POST') return json(res, { error: 'not found' }, 404);
  const body = await readBody(req);

  // --- 設定 ---
  if (path === '/api/settings/option') {
    const opt = OPTION_SCHEMA.find((o) => o.key === body.key);
    if (!opt) return json(res, { error: '不明な設定項目です。' }, 400);
    const parsed = parseOption(opt, body.value);
    if (!parsed.ok) return json(res, { error: parsed.message }, 400);
    const warning = warnFor(opt, parsed.value, CONFIG);
    if (warning && !body.confirm) return json(res, { needConfirm: true, warning });
    setOption(settings, opt, parsed.value, CONFIG);
    saveSettings(settings);
    applyOptions(settings, CONFIG);
    return json(res, { ok: true, settings: settingsView() });
  }

  if (path === '/api/settings/reset') {
    settings.options = {};
    settings.outputDir = '';
    saveSettings(settings);
    const fresh = await import(`./config.js?fresh=${Date.now()}`);
    Object.assign(CONFIG, fresh.CONFIG);
    applyOptions(settings, CONFIG);
    return json(res, { ok: true, settings: settingsView() });
  }

  if (path === '/api/settings/output-dir') {
    if (body.pick) {
      const picked = await pickFolderDialog();
      if (!picked) return json(res, { error: 'フォルダが選択されませんでした。手入力もできます。' }, 400);
      settings.outputDir = picked;
    } else {
      settings.outputDir = String(body.path ?? '').trim();
    }
    saveSettings(settings);
    applyOptions(settings, CONFIG);
    return json(res, { ok: true, settings: settingsView() });
  }

  // --- アカウント ---
  if (path === '/api/accounts/add') {
    const username = String(body.username ?? '').trim();
    if (!username) return json(res, { error: 'ユーザー名を入力してください。' }, 400);
    settings.accounts.push({ label: String(body.label ?? '').trim(), username, password: String(body.password ?? '') });
    if (settings.activeAccount < 0) settings.activeAccount = settings.accounts.length - 1;
    saveSettings(settings);
    return json(res, { ok: true, ...accountsView() });
  }

  if (path === '/api/accounts/update') {
    const acc = settings.accounts[body.index];
    if (!acc) return json(res, { error: 'アカウントが見つかりません。' }, 400);
    if (body.label !== undefined) acc.label = String(body.label).trim();
    if (body.username !== undefined && String(body.username).trim()) acc.username = String(body.username).trim();
    if (body.password) acc.password = String(body.password);
    saveSettings(settings);
    return json(res, { ok: true, ...accountsView() });
  }

  if (path === '/api/accounts/delete') {
    if (!settings.accounts[body.index]) return json(res, { error: 'アカウントが見つかりません。' }, 400);
    settings.accounts.splice(body.index, 1);
    if (settings.activeAccount >= settings.accounts.length) settings.activeAccount = settings.accounts.length - 1;
    saveSettings(settings);
    return json(res, { ok: true, ...accountsView() });
  }

  if (path === '/api/accounts/select') {
    const i = Number(body.index);
    if (i !== -1 && !settings.accounts[i]) return json(res, { error: 'アカウントが見つかりません。' }, 400);
    settings.activeAccount = i;
    saveSettings(settings);
    return json(res, { ok: true, ...accountsView() });
  }

  if (path === '/api/accounts/login') {
    const account = body.index === -1 ? null : settings.accounts[body.index];
    if (body.index !== -1 && !account) return json(res, { error: 'アカウントが見つかりません。' }, 400);
    // 直前にログイン制限を食らっていたら、一定時間は開かせない
    const remain = loginCooldownUntil - Date.now();
    if (remain > 0) {
      const min = Math.ceil(remain / 60000);
      return json(
        res,
        { error: `Xにログインを制限されています。あと約${min}分は空けてください(短時間に何度も試すと制限が延びます)。` },
        429
      );
    }
    runJob('ログイン', () => login({ account, authStatePath: authStatePathFor(account) })).catch((err) => {
      // ログイン制限を検知したらクールダウンを設定する
      if (err instanceof RateLimitedError) {
        loginCooldownUntil = Date.now() + LOGIN_COOLDOWN_MS;
      }
    });
    return json(res, { ok: true });
  }

  // --- 実行 ---
  if (path.startsWith('/api/run/')) {
    const key = path.slice('/api/run/'.length);
    const names = { scrape: '収集', exportFollowing: 'フォロー中の出力', collectRecommend: 'おすすめ収集', migrate: 'アカウント移植', multiview: '同時表示' };
    const action = actions[key];
    if (!action) return json(res, { error: '不明な操作です。' }, 400);
    if (getState().running) return json(res, { error: 'ほかの処理を実行中です。' }, 409);
    runJob(names[key] ?? key, () => action(body)).catch(() => {});
    return json(res, { ok: true });
  }

  if (path === '/api/cancel') return json(res, { ok: cancelJob() });

  // --- 同時表示の操作 ---
  if (path === '/api/multiview/goto') {
    if (!multiViews.length) return json(res, { error: '表示中のウィンドウがありません。' }, 400);
    const input = String(body.target ?? '').trim();
    const target = !input ? 'https://x.com/home'
      : /^https?:\/\//i.test(input) ? input
      : `https://x.com/${input.replace(/^@/, '')}`;
    const r = await gotoAll(multiViews, target);
    return json(res, { ok: true, ...r, target });
  }
  if (path === '/api/multiview/reload') {
    if (!multiViews.length) return json(res, { error: '表示中のウィンドウがありません。' }, 400);
    return json(res, { ok: true, ...(await reloadAll(multiViews)) });
  }
  if (path === '/api/multiview/close') {
    await closeAll(multiViews);
    multiViews = [];
    return json(res, { ok: true });
  }

  if (path === '/api/shutdown') {
    json(res, { ok: true });
    setTimeout(() => shutdown('画面の終了ボタン'), 300);
    return;
  }


  return json(res, { error: 'not found' }, 404);
}

// 収集結果(レポート・画像)を画面に表示するための配信。
// 保存先フォルダの外は読ませない。
async function serveOutputFile(req, res, urlPath) {
  const root = resolve(outputRoot());
  const rel = decodeURIComponent(urlPath.slice('/files/'.length));
  const target = resolve(join(root, rel));
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  const mime = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  let size;
  try {
    size = (await stat(target)).size;
  } catch {
    res.writeHead(404).end('not found');
    return;
  }

  // 動画の早送り(シーク)は Range リクエストで届くので、その範囲だけ返す
  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && size > 0) {
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null && end !== null) {
      start = Math.max(0, size - end); // 末尾から N バイト
      end = size - 1;
    } else {
      start = start ?? 0;
      end = end === null ? size - 1 : Math.min(end, size - 1);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    createReadStream(target, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(target).pipe(res);
}

// 終了処理。ブラウザを閉じてログイン状態を保存してから落とす。
let shuttingDown = false;
async function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  writeLog(`終了します(${reason})`);
  try {
    if (getState().running) {
      cancelJob();
      // 実行中の処理が区切りまで進むのを少しだけ待つ
      for (let i = 0; i < 20 && getState().running; i++) await new Promise((r) => setTimeout(r, 250));
    }
    // 同時表示のウィンドウはログイン状態を保存してから閉じる
    await closeAll(multiViews);
    multiViews = [];
  } catch (err) {
    writeLog(`終了処理でエラー: ${cleanError(err)}`, 'warn');
  }
  process.exit(code);
}

// 予期しないエラーでも、記録を残してアプリは動かし続ける
function installErrorHandlers() {
  process.on('uncaughtException', (err) => {
    writeLog(`想定外のエラー: ${err?.stack || err}`, 'error');
    log(`想定外のエラーが発生しました: ${cleanError(err)}(記録: ${logPath})`, 'error');
  });
  process.on('unhandledRejection', (reason) => {
    writeLog(`処理されなかったエラー: ${reason?.stack || reason}`, 'error');
    log(`エラーが発生しました: ${cleanError(reason)}(記録: ${logPath})`, 'error');
  });
  // Ctrl+C、ウィンドウを閉じる、タスク終了 のいずれでも後片付けしてから終わる
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try {
      process.on(sig, () => shutdown(sig));
    } catch {
      // その環境にないシグナルは無視
    }
  }
}

export async function startServer({ port = 0, open = true } = {}) {
  installErrorHandlers();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (url.pathname.startsWith('/files/')) return await serveOutputFile(req, res, url.pathname);

      const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
      const target = resolve(join(WEB_DIR, file));
      if (target !== resolve(WEB_DIR) && !target.startsWith(resolve(WEB_DIR) + sep)) {
        return res.writeHead(403).end('forbidden');
      }
      let data;
      try {
        data = await readFile(target);
      } catch {
        return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()] ?? 'text/plain; charset=utf-8' });
      res.end(data);
    } catch (err) {
      writeLog(`リクエスト処理でエラー (${url.pathname}): ${err?.stack || err}`, 'error');
      if (!res.headersSent) json(res, { error: cleanError(err) }, 500);
      else res.end();
    }
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actualPort = server.address().port;
  const url = `http://127.0.0.1:${actualPort}/`;
  console.log('======================================');
  console.log(' X タイムライン自動収集ツール');
  console.log('======================================');
  console.log(`操作画面: ${url}`);
  console.log(`記録ファイル: ${resolve(logPath)}`);
  writeLog(`起動しました(${url})`);
  console.log('(このウィンドウは開いたままにしてください。終了は画面の「終了」ボタンです)');
  if (open) openInBrowser(url);
  return { server, url, port: actualPort };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startServer({ open: process.env.NO_OPEN !== '1' }).catch((err) => {
    console.error(cleanError(err));
    process.exit(1);
  });
}
