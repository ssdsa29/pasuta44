// かんたん実行モード(普通のアプリのようなメニュー画面)。
// start.bat をダブルクリックするか、npm start で起動します。
//   1. 収集を開始(投稿・画像・コメント)
//   2. ログインアカウント管理(ユーザー名・パスワードの追加/編集/削除/切替)
//   3. 保存先フォルダの設定
//   4. フォロー中アカウントを出力
//   5. おすすめ欄のアカウントを収集
//   6. アカウントを移植(一覧を安全にフォロー)
//   7. 複数アカウント同時表示(マルチビュー)
//   8. 終了(シャットダウン)
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { CONFIG } from './config.js';
import { login } from './login.js';
import { runScrape } from './scrape.js';
import { pickFolderDialog } from './pickFolder.js';
import { exportFollowing, collectRecommendAccounts, followAccounts } from './follows.js';
import { saveAccountList, listSavedFiles, readHandles } from './lists.js';
import { SessionExpiredError, RateLimitedError, FollowLimitError, cleanError } from './resilience.js';
import {
  openMultiView,
  gotoAll,
  reloadAll,
  statusAll,
  closeAll,
  checkLoginAll,
  detectScreenSize,
} from './multiview.js';
import {
  loadSettings,
  saveSettings,
  getActiveAccount,
  authStatePathFor,
  accountDisplayName,
} from './settings.js';

// 入力を行キューで管理する(パイプ実行でも1行も取りこぼさないため)。
// 対話中に届いた行はキューに溜め、質問を出すたびに1行ずつ取り出す。
const rl = createInterface({ input: stdin });
const lineQueue = [];
const waiters = [];
let inputClosed = false;

rl.on('line', (line) => {
  const w = waiters.shift();
  if (w) w(line);
  else lineQueue.push(line);
});
rl.on('close', () => {
  inputClosed = true;
  while (waiters.length) waiters.shift()('');
});

function ask(q) {
  stdout.write(q);
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  if (inputClosed) return Promise.resolve('');
  return new Promise((res) => waiters.push(res));
}

async function askDefault(q, def) {
  const a = (await ask(`${q} [${def}]: `)).trim();
  return a === '' ? String(def) : a;
}

async function askYesNo(q, defaultYes = true) {
  const a = (await ask(`${q} (${defaultYes ? 'Y/n' : 'y/N'}): `)).trim();
  if (a === '') return defaultYes;
  return /^y/i.test(a);
}

function openInBrowser(path) {
  const abs = resolve(path);
  const cmd =
    process.platform === 'darwin' ? `open "${abs}"`
    : process.platform === 'win32' ? `start "" "${abs}"`
    : `xdg-open "${abs}"`;
  exec(cmd, () => {});
}

// ---- ログインアカウント管理 -----------------------------------------------
async function manageAccounts(settings) {
  for (;;) {
    console.log('\n--- ログインアカウント管理 ---');
    if (settings.accounts.length === 0) {
      console.log('(登録されているアカウントはありません)');
    } else {
      settings.accounts.forEach((acc, i) => {
        const active = i === settings.activeAccount ? ' ← 使用中' : '';
        console.log('  ' + accountDisplayName(acc, i) + active);
      });
    }
    console.log('\n  a=追加  e=編集  d=削除  s=使用アカウント切替  b=戻る');
    const choice = (await ask('選択: ')).trim().toLowerCase();

    if (choice === 'a') {
      const label = (await ask('表示名(任意): ')).trim();
      const username = (await ask('ユーザー名 / メール / 電話番号: ')).trim();
      const password = (await ask('パスワード(空欄なら手動ログイン): ')).trim();
      if (!username) {
        console.log('ユーザー名が空のため中止しました。');
        continue;
      }
      settings.accounts.push({ label, username, password });
      if (settings.activeAccount < 0) settings.activeAccount = settings.accounts.length - 1;
      saveSettings(settings);
      console.log('追加しました。');
    } else if (choice === 'e') {
      const idx = parseInt(await ask('編集する番号: '), 10) - 1;
      const acc = settings.accounts[idx];
      if (!acc) {
        console.log('番号が正しくありません。');
        continue;
      }
      acc.label = (await askDefault('表示名', acc.label || '')).trim();
      acc.username = (await askDefault('ユーザー名/メール/電話', acc.username || '')).trim();
      const pw = (await ask('パスワード(空Enter=変更しない): ')).trim();
      if (pw !== '') acc.password = pw;
      saveSettings(settings);
      console.log('更新しました。');
    } else if (choice === 'd') {
      const idx = parseInt(await ask('削除する番号: '), 10) - 1;
      if (!settings.accounts[idx]) {
        console.log('番号が正しくありません。');
        continue;
      }
      settings.accounts.splice(idx, 1);
      if (settings.activeAccount >= settings.accounts.length) {
        settings.activeAccount = settings.accounts.length - 1;
      }
      saveSettings(settings);
      console.log('削除しました。');
    } else if (choice === 's') {
      const idx = parseInt(await ask('使用する番号(0=手動ログイン): '), 10) - 1;
      if (idx === -1 || settings.accounts[idx]) {
        settings.activeAccount = idx;
        saveSettings(settings);
        console.log('使用アカウントを変更しました。');
      } else {
        console.log('番号が正しくありません。');
      }
    } else if (choice === 'b' || choice === '') {
      return;
    }
  }
}

// ---- 保存先フォルダの設定 --------------------------------------------------
async function chooseOutputDir(settings) {
  console.log('\n--- 保存先フォルダの設定 ---');
  console.log(`現在の保存先: ${settings.outputDir || `${CONFIG.outputDir}(既定)`}`);
  console.log('  1=フォルダ選択ダイアログを開く  2=手入力  3=既定に戻す  b=戻る');
  const choice = (await ask('選択: ')).trim().toLowerCase();

  if (choice === '1') {
    console.log('フォルダ選択ダイアログを開いています...');
    const picked = await pickFolderDialog();
    if (picked) {
      settings.outputDir = picked;
      saveSettings(settings);
      console.log(`保存先を ${picked} に設定しました。`);
    } else {
      console.log('選択がキャンセルされたか、ダイアログを開けませんでした。手入力をお試しください。');
    }
  } else if (choice === '2') {
    const p = (await ask('保存先フォルダのフルパス: ')).trim();
    if (p) {
      settings.outputDir = p;
      saveSettings(settings);
      console.log(`保存先を ${p} に設定しました。`);
    }
  } else if (choice === '3') {
    settings.outputDir = '';
    saveSettings(settings);
    console.log('保存先を既定に戻しました。');
  }
}

// 保存先ルート
function outputRoot(settings) {
  return settings.outputDir || CONFIG.outputDir;
}

// 使用中アカウントのセッションを用意する(無ければログイン)。statePath を返す。
async function ensureSession(settings, { force = false } = {}) {
  const account = getActiveAccount(settings);
  const statePath = authStatePathFor(account);
  if (force || !existsSync(statePath)) {
    console.log('\nログインが必要です。ブラウザを開きます...');
    if (account) console.log(`使用アカウント: ${account.label || account.username}`);
    else console.log('手動ログインモード(アカウント未登録)');
    await login({ account, authStatePath: statePath });
  }
  return statePath;
}

// セッション切れを検知したら自動で再ログインし、処理をやり直す。
// fn には毎回そのときの statePath が渡される。
async function withSessionRecovery(settings, fn) {
  let statePath = await ensureSession(settings);
  try {
    return await fn(statePath);
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) throw err;
    console.warn('\n[補正] ログインセッションが切れていました。再ログインしてやり直します...');
    statePath = await ensureSession(settings, { force: true });
    return await fn(statePath);
  }
}

// ---- 収集を開始 ------------------------------------------------------------
async function startScrape(settings) {
  const statePath = await ensureSession(settings);

  // かんたん設定(Enterで既定値)
  console.log('\n--- 収集設定(Enterで既定値)---');
  const tabChoice = await askDefault('収集する欄 1=両方 2=おすすめのみ 3=フォロー中のみ', '1');
  const tabs = tabChoice === '2' ? ['recommend'] : tabChoice === '3' ? ['following'] : ['recommend', 'following'];
  const maxAccounts = parseInt(await askDefault('アカウント数(タブごと)', CONFIG.maxAccounts), 10) || CONFIG.maxAccounts;
  const fetchReplies = await askYesNo('リプライ(コメント)も取得しますか?', true);
  const skipSeen = await askYesNo('取得済みの投稿はスキップしますか?', true);
  const kw = (await ask('キーワード絞り込み(スペース区切り、空欄=なし): ')).trim();
  const keywords = kw ? kw.split(/\s+/) : [];

  console.log('\n収集を開始します。人間らしい速度で動くため、少し時間がかかります...');
  const { htmlPath, runDir, totalAccounts, failures } = await runScrape({
    tabs,
    authStatePath: statePath,
    outputDir: settings.outputDir || null,
    overrides: { maxAccounts, fetchReplies, skipSeen, keywords },
    // 収集中にセッションが切れたら、自動で再ログインして続きから再開する
    onSessionExpired: () => ensureSession(settings, { force: true }),
  });

  if (totalAccounts === 0) {
    // 失敗が原因なのか、単に新着が無いだけなのかを区別して伝える
    const tabFailed = failures?.some((f) => f.type === 'tab' || f.type === 'session');
    if (tabFailed) {
      console.log('\n収集に失敗したため、投稿を取得できませんでした。');
      console.log('  ネットワーク接続とログイン状態を確認して、もう一度お試しください。');
      console.log(`  詳細: ${runDir}/errors.json`);
    } else {
      console.log('\n新しく取得できた投稿はありませんでした(取得済みスキップ中の可能性)。');
      console.log(`リセットするには ${runDir} と同じ保存先の seen.json を削除してください。`);
    }
  } else {
    if (failures?.length) {
      console.log(`\n一部取得できなかったものがあります(${failures.length} 件)。詳細は errors.json をご覧ください。`);
    }
    console.log('完了しました。レポートをブラウザで開きます...');
    openInBrowser(htmlPath);
  }
}

// ---- フォロー中アカウントを出力 -------------------------------------------
async function exportFollowingFlow(settings) {
  console.log('\n使用中アカウントの「フォロー中」一覧を取得します。少し時間がかかります...');
  const { owner, accounts } = await withSessionRecovery(settings, (statePath) => exportFollowing(statePath));
  if (accounts.length === 0) {
    console.log('フォロー中アカウントが取得できませんでした。');
    return;
  }
  const saved = saveAccountList(outputRoot(settings), `following_${owner}`, accounts, { source: 'following', owner });
  console.log(`\n${accounts.length} 件を保存しました:`);
  console.log(`  一覧(移植用): ${saved.txtPath}`);
  console.log(`  JSON/CSV     : ${saved.jsonPath}`);
  console.log('この一覧はメニュー「6. アカウントを移植」で別アカウントにフォローできます。');
}

// ---- おすすめ欄のアカウントを収集 -----------------------------------------
async function collectRecommendFlow(settings) {
  const max = parseInt(await askDefault('収集するアカウント数', 50), 10) || 50;
  console.log('\nおすすめ欄をスクロールしてアカウントを収集します...');
  const accounts = await withSessionRecovery(settings, (statePath) =>
    collectRecommendAccounts(statePath, { max })
  );
  if (accounts.length === 0) {
    console.log('アカウントが取得できませんでした。');
    return;
  }
  const saved = saveAccountList(outputRoot(settings), 'recommend_accounts', accounts, { source: 'recommend' });
  console.log(`\n${accounts.length} アカウントを保存しました:`);
  console.log(`  一覧(移植用): ${saved.txtPath}`);
  console.log(`  JSON/CSV     : ${saved.jsonPath}`);
  console.log('この一覧はメニュー「6. アカウントを移植」で別アカウントにフォローできます。');
}

// ---- アカウントを移植(一覧を安全にフォロー)------------------------------
async function migrateFlow(settings) {
  // 1) フォロー元の一覧を選ぶ
  const files = listSavedFiles(outputRoot(settings));
  let handles = [];
  console.log('\n--- アカウントの移植(一覧を安全にフォロー)---');
  if (files.length > 0) {
    console.log('保存済みの一覧:');
    files.slice(0, 15).forEach((f, i) => console.log(`  ${i + 1}. ${f.file}`));
    console.log('  0. 手入力(@handleをスペース/改行区切りで貼り付け)');
    const pick = (await ask('番号を選択: ')).trim();
    const idx = parseInt(pick, 10) - 1;
    if (files[idx]) {
      handles = readHandles(files[idx].path);
    } else {
      const pasted = (await ask('@handle を入力: ')).trim();
      handles = pasted.split(/[\s,]+/).map((h) => h.replace(/^@/, '')).filter(Boolean);
    }
  } else {
    console.log('保存済みの一覧がありません。先に「5」や「6」で一覧を作成するか、手入力してください。');
    const pasted = (await ask('@handle を入力(スペース区切り): ')).trim();
    handles = pasted.split(/[\s,]+/).map((h) => h.replace(/^@/, '')).filter(Boolean);
  }

  // 重複除去
  handles = [...new Set(handles)];
  if (handles.length === 0) {
    console.log('対象アカウントがありません。');
    return;
  }

  // 2) フォローする側(移植先)のアカウントを確認
  const active = getActiveAccount(settings);
  console.log(`\nフォローを実行するアカウント(移植先): ${active ? active.label || active.username : '手動ログイン中のアカウント'}`);
  console.log('別のアカウントに移植したい場合は、一度メニューに戻り「2」で使用アカウントを切り替えてください。');
  console.log(`対象: ${handles.length} 件 / 1回の上限: ${CONFIG.maxFollowsPerRun} 件 / 間隔: ${CONFIG.followDelayMinMs / 1000}〜${CONFIG.followDelayMaxMs / 1000}秒`);
  console.log('⚠️ 短時間に大量フォローするとアカウント制限のリスクがあります。安全のため上限と間隔を設けています。');

  const ok = await askYesNo(`このアカウントで最大 ${Math.min(handles.length, CONFIG.maxFollowsPerRun)} 件フォローを実行しますか?`, false);
  if (!ok) {
    console.log('中止しました。');
    return;
  }

  console.log('\nフォローを開始します(人間らしい間隔で進めます)...');
  const labels = {
    followed: '✓ フォロー',
    already: '- 既にフォロー済',
    notfound: '× 存在しない/凍結',
    nobutton: '× フォローボタンなし(鍵アカウント等)',
    failed: '× 失敗(あとで再実行してください)',
  };
  const { follower, results, followedCount, notProcessed, stoppedBy } = await withSessionRecovery(
    settings,
    (statePath) =>
      followAccounts(statePath, handles, {
        onProgress: ({ handle, status, followed }) => {
          console.log(`  [${followed}] @${handle} … ${labels[status] ?? status}`);
        },
      })
  );

  const counts = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  console.log(`\n完了しました(実行アカウント: @${follower || '?'})`);
  console.log(`  新規フォロー: ${followedCount} 件`);
  console.log(`  内訳: ${JSON.stringify(counts)}`);

  if (stoppedBy === 'FollowLimitError') {
    console.log('\n⚠️ Xのフォロー制限に達したため、途中で中断しました。');
    console.log('   数時間〜1日ほど時間をおいてから、残りを再実行してください。');
  }

  // 未処理・失敗した分を保存して、次回そこから再開できるようにする
  const retryHandles = [
    ...notProcessed,
    ...results.filter((r) => r.status === 'failed' || r.status === 'error').map((r) => r.handle),
  ];
  if (retryHandles.length > 0) {
    const saved = saveAccountList(
      outputRoot(settings),
      'remaining',
      retryHandles.map((h) => ({ handle: h, displayName: '' })),
      { source: 'remaining', reason: stoppedBy || 'upperLimit' }
    );
    console.log(`\n残り ${retryHandles.length} 件を保存しました: ${saved.txtPath}`);
    console.log('  時間をおいて「6」を実行し、この一覧を選ぶと続きからフォローできます。');
  }
}

// ---- 複数アカウントを同時表示 ---------------------------------------------
async function multiViewFlow(settings) {
  console.log('\n--- 複数アカウントを同時に表示 ---');

  // 表示するアカウントを決める(登録済みアカウント、無ければ手動ログイン分)
  let entries;
  if (settings.accounts.length === 0) {
    console.log('アカウントが未登録のため、手動ログインのセッションを1つ表示します。');
    console.log('複数アカウントを並べたい場合は、メニュー「2」で登録してください。');
    entries = [{ account: null, statePath: authStatePathFor(null) }];
  } else {
    settings.accounts.forEach((acc, i) => console.log('  ' + accountDisplayName(acc, i)));
    const limit = CONFIG.maxParallelViews;
    const input = await askDefault(
      `表示するアカウントの番号(スペース区切り、最大${limit}件。空Enter=先頭から${limit}件)`,
      'すべて'
    );
    let picked;
    if (input === 'すべて') {
      picked = settings.accounts.slice(0, limit);
    } else {
      picked = input
        .split(/[\s,]+/)
        .map((n) => settings.accounts[parseInt(n, 10) - 1])
        .filter(Boolean)
        .slice(0, limit);
    }
    if (picked.length === 0) {
      console.log('表示するアカウントがありません。');
      return;
    }
    entries = picked.map((account) => ({ account, statePath: authStatePathFor(account) }));
  }

  // セッションが無いアカウントは先にログインしておく
  for (const e of entries) {
    if (!existsSync(e.statePath)) {
      const name = e.account?.label || e.account?.username || '手動ログイン';
      console.log(`\n「${name}」はログインが必要です。ブラウザを開きます...`);
      await login({ account: e.account, authStatePath: e.statePath });
    }
  }

  const screen = await detectScreenSize();
  console.log(`\n画面サイズ ${screen.width}x${screen.height} に ${entries.length} 個のウィンドウを並べます...`);
  const views = await openMultiView(entries, { columns: CONFIG.viewColumns, screen });

  if (views.length === 0) {
    console.log('ウィンドウを開けませんでした。');
    return;
  }

  // 全ウィンドウをホームに移動して表示を揃える
  const opened = await gotoAll(views, 'https://x.com/home');
  console.log(`\n${views.length} 個のウィンドウを表示しました。各ウィンドウは自由に操作できます。`);
  if (opened.failed > 0) {
    console.warn(`  ※ ${opened.failed} 個のウィンドウでページを読み込めませんでした(ネットワークをご確認ください)。`);
  }

  // ログインが切れているアカウントがあれば知らせる
  const loginStates = await checkLoginAll(views);
  const needLogin = loginStates.filter((s) => s.state === 'login');
  if (needLogin.length > 0) {
    console.warn(`  ※ ログインが切れているアカウント: ${needLogin.map((s) => s.name).join('、')}`);
    console.warn('    そのウィンドウで直接ログインするか、閉じてからメニュー「2」で設定してください。');
  }

  // 表示中の操作メニュー
  for (;;) {
    console.log('\n--- 表示中の操作 ---');
    console.log('  1. 全ウィンドウをホームに移動');
    console.log('  2. 全ウィンドウを指定のユーザー/URLへ移動');
    console.log('  3. 全ウィンドウを再読み込み');
    console.log('  4. 各ウィンドウの状態を表示');
    console.log('  5. 閉じてメニューに戻る');
    const choice = (await ask('番号を入力: ')).trim();

    if (choice === '1') {
      const { failed } = await gotoAll(views, 'https://x.com/home');
      console.log(failed ? `移動しました(${failed} 件失敗)` : '全ウィンドウをホームに移動しました。');
    } else if (choice === '2') {
      const input = (await ask('@ユーザー名 または URL: ')).trim();
      if (!input) continue;
      const url = /^https?:\/\//i.test(input)
        ? input
        : `https://x.com/${input.replace(/^@/, '')}`;
      const { failed } = await gotoAll(views, url);
      console.log(failed ? `${url} へ移動しました(${failed} 件失敗)` : `全ウィンドウを ${url} へ移動しました。`);
    } else if (choice === '3') {
      const { failed } = await reloadAll(views);
      console.log(failed ? `再読み込みしました(${failed} 件失敗)` : '全ウィンドウを再読み込みしました。');
    } else if (choice === '4') {
      const list = await statusAll(views);
      list.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} … ${s.alive ? s.url : '(閉じています)'}`));
    } else if (choice === '5' || choice === '' || inputClosed) {
      break;
    }
  }

  console.log('\nウィンドウを閉じています(ログイン状態は保存されます)...');
  await closeAll(views);
  console.log('閉じました。');
}

// ---- メインメニュー --------------------------------------------------------
async function main() {
  console.log('======================================');
  console.log(' X タイムライン自動収集ツール');
  console.log('======================================');

  const settings = loadSettings();

  for (;;) {
    const active = getActiveAccount(settings);
    console.log('\n==== メニュー ====');
    console.log(`  使用アカウント: ${active ? active.label || active.username : '手動ログイン'}`);
    console.log(`  保存先: ${settings.outputDir || `${CONFIG.outputDir}(既定)`}`);
    console.log('  1. 収集を開始(投稿・画像・コメント)');
    console.log('  2. ログインアカウント管理');
    console.log('  3. 保存先フォルダの設定');
    console.log('  4. フォロー中アカウントを出力');
    console.log('  5. おすすめ欄のアカウントを収集');
    console.log('  6. アカウントを移植(一覧を安全にフォロー)');
    console.log(`  7. ${CONFIG.maxParallelViews}アカウント同時表示(マルチビュー)`);
    console.log('  8. 終了');
    const choice = (await ask('番号を入力: ')).trim();

    try {
      if (choice === '1') {
        await startScrape(settings);
      } else if (choice === '2') {
        await manageAccounts(settings);
      } else if (choice === '3') {
        await chooseOutputDir(settings);
      } else if (choice === '4') {
        await exportFollowingFlow(settings);
      } else if (choice === '5') {
        await collectRecommendFlow(settings);
      } else if (choice === '6') {
        await migrateFlow(settings);
      } else if (choice === '7') {
        await multiViewFlow(settings);
      } else if (choice === '8' || choice.toLowerCase() === 'q' || inputClosed) {
        console.log('終了します。お疲れさまでした。');
        break;
      } else {
        console.log('1〜8 の番号を入力してください。');
      }
    } catch (err) {
      // 失敗の種類に応じて、次にどうすればよいかを案内する
      if (err instanceof SessionExpiredError) {
        console.error('\nログインセッションが切れており、再ログインにも失敗しました。');
        console.error('「2」でアカウント情報(パスワード)を確認するか、もう一度お試しください。');
      } else if (err instanceof RateLimitedError) {
        console.error('\nXのレート制限に達しました。30分〜1時間ほど時間をおいて再実行してください。');
      } else if (err instanceof FollowLimitError) {
        console.error('\nフォロー数の上限に達しました。時間をおいて再実行してください。');
      } else {
        console.error(`\nエラー: ${cleanError(err)}`);
        console.error('もう一度試しても直らない場合は、ネットワーク接続とログイン状態をご確認ください。');
      }
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(`\nエラー: ${err.message ?? err}`);
  rl.close();
  process.exit(1);
});
