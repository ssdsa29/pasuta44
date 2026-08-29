// 画面(GUI)サーバーのテスト。実際にサーバーを起動してAPIを叩きます。
// Xへの接続やブラウザ起動は不要です。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 設定ファイルを汚さないよう、一時フォルダで実行する
const work = mkdtempSync(join(tmpdir(), 'x-gui-test-'));
process.chdir(work);

const { startServer } = await import(new URL('../src/server.js', import.meta.url).href);
const { url, server } = await startServer({ open: false });

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  NG   ${name}`); }
};
const api = async (path, body) => {
  const res = await fetch(url.replace(/\/$/, '') + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

console.log('\n[A] 画面の配信');
const page = await fetch(url);
const html = await page.text();
check('操作画面が返る', page.status === 200 && html.includes('X 収集ツール'));
check('画面にすべてのタブがある', ['ホーム', 'フォロー', '同時表示', 'アカウント', '設定'].every((t) => html.includes(t)));

console.log('\n[B] 状態の取得');
let r = await api('/api/state');
check('状態を取得できる', r.status === 200);
const keys = r.data.settings.options.map((o) => o.key);
check('主要な設定項目がそろっている',
  ['maxAccounts', 'fetchReplies', 'saveVideos', 'maxVideoMB', 'saveComments', 'maxFollowsPerRun',
   'followDelayMinMs', 'maxParallelViews', 'headless', 'speedFactor'].every((k) => keys.includes(k)));
check('設定項目に重複がない', new Set(keys).size === keys.length);
check('実行中でない', r.data.job.running === false);
check('アカウントは空から始まる', r.data.accounts.length === 0);

console.log('\n[C] 設定の変更');
r = await api('/api/settings/option', { key: 'maxAccounts', value: '25' });
check('設定を変更できる', r.status === 200 && r.data.settings.options.find((o) => o.key === 'maxAccounts').value === 25);
check('設定ファイルに保存される', JSON.parse(await import('node:fs').then((fs) => fs.readFileSync('config/settings.json', 'utf8'))).options.maxAccounts === 25);

r = await api('/api/settings/option', { key: 'maxAccounts', value: '9999' });
check('範囲外は拒否する', r.status === 400 && r.data.error.includes('範囲'));
r = await api('/api/settings/option', { key: 'maxAccounts', value: 'abc' });
check('数字でない値は拒否する', r.status === 400);
r = await api('/api/settings/option', { key: 'なにこれ', value: '1' });
check('存在しない項目は拒否する', r.status === 400);

r = await api('/api/settings/option', { key: 'maxFollowsPerRun', value: '200' });
check('危険な値は確認を求める', r.data.needConfirm === true && r.data.warning.includes('リスク'));
r = await api('/api/state');
check('  確認前は変更されない', r.data.settings.options.find((o) => o.key === 'maxFollowsPerRun').value === 20);
r = await api('/api/settings/option', { key: 'maxFollowsPerRun', value: '200', confirm: true });
check('  確認すれば反映される', r.data.settings.options.find((o) => o.key === 'maxFollowsPerRun').value === 200);

r = await api('/api/settings/option', { key: 'followDelayMinMs', value: '90' });
check('最短が最長を超えると確認を求める', r.data.needConfirm === true);
r = await api('/api/settings/option', { key: 'followDelayMinMs', value: '90', confirm: true });
const opts = r.data.settings.options;
check('秒で入力でき、最短>最長は自動調整される',
  opts.find((o) => o.key === 'followDelayMinMs').raw === 90 && opts.find((o) => o.key === 'followDelayMaxMs').raw === 90);

r = await api('/api/settings/reset', {});
check('既定値に戻せる', r.data.settings.options.find((o) => o.key === 'maxAccounts').value === 10);

console.log('\n[D] アカウント管理');
r = await api('/api/accounts/add', { label: 'テスト1', username: 'user1', password: 'pw' });
check('アカウントを追加できる', r.data.accounts.length === 1 && r.data.accounts[0].hasPassword === true);
check('  最初のアカウントが使用中になる', r.data.accounts[0].active === true);
r = await api('/api/accounts/add', { username: '' });
check('ユーザー名が空なら拒否する', r.status === 400);
await api('/api/accounts/add', { label: 'テスト2', username: 'user2' });
r = await api('/api/accounts/select', { index: 1 });
check('使用アカウントを切り替えられる', r.data.accounts[1].active === true);
r = await api('/api/accounts/update', { index: 1, label: '名前変更' });
check('アカウントを編集できる', r.data.accounts[1].label === '名前変更');
r = await api('/api/accounts/delete', { index: 1 });
check('アカウントを削除できる', r.data.accounts.length === 1);
r = await api('/api/accounts/delete', { index: 99 });
check('存在しないアカウントの削除は拒否する', r.status === 400);
check('パスワードは画面に返さない', JSON.stringify(r.data).includes('pw') === false);

console.log('\n[E] 実行の受付');
r = await api('/api/run/なにこれ', {});
check('不明な操作は拒否する', r.status === 400);
r = await api('/api/run/migrate', {});
await new Promise((res) => setTimeout(res, 300));
r = await api('/api/state');
check('対象が空の移植は失敗として記録される', r.data.job.error?.includes('対象') === true);
r = await api('/api/multiview/goto', { target: 'x' });
check('ウィンドウ未表示なら操作を断る', r.status === 400);
r = await api('/api/cancel', {});
check('実行していなければ中止は何もしない', r.data.ok === false);

console.log('\n[F] ファイル配信の安全性');
mkdirSync(join(work, 'output', 'run1'), { recursive: true });
writeFileSync(join(work, 'output', 'run1', 'report.html'), '<h1>レポート</h1>');
writeFileSync(join(work, 'secret.txt'), 'himitsu');
let f = await fetch(url + 'files/run1/report.html');
check('保存先のレポートは表示できる', f.status === 200 && (await f.text()).includes('レポート'));
f = await fetch(url + 'files/' + encodeURIComponent('../secret.txt'));
check('保存先の外は読ませない', f.status === 403 || f.status === 404);
f = await fetch(url + 'files/../../etc/passwd');
check('パスをさかのぼる要求も防ぐ', f.status === 403 || f.status === 404);

r = await api('/api/state');
check('結果一覧にレポートが並ぶ', r.data.runs.some((x) => x.name === 'run1'));

console.log('\n[G] 進捗のリアルタイム配信');
const es = await fetch(url + 'api/events', { headers: { Accept: 'text/event-stream' } });
check('進捗の配信につながる', es.status === 200 && es.headers.get('content-type').includes('event-stream'));
es.body.cancel();


console.log('\n[K] 動画の配信(早送り対応)');
mkdirSync(join(work, 'output', 'run1', 'recommend', 'alice', 'videos'), { recursive: true });
const videoPath = join(work, 'output', 'run1', 'recommend', 'alice', 'videos', 'a_1.mp4');
writeFileSync(videoPath, Buffer.alloc(1000, 7)); // 1000バイトのダミー動画
let vf = await fetch(url + 'files/run1/recommend/alice/videos/a_1.mp4');
check('動画を配信できる', vf.status === 200);
check('  形式が動画として伝わる', vf.headers.get('content-type') === 'video/mp4');
check('  早送りできると伝える', vf.headers.get('accept-ranges') === 'bytes');
vf.body?.cancel();

vf = await fetch(url + 'files/run1/recommend/alice/videos/a_1.mp4', { headers: { Range: 'bytes=100-199' } });
check('途中から再生(範囲指定)に応える', vf.status === 206);
check('  返す範囲が正しい', vf.headers.get('content-range') === 'bytes 100-199/1000');
check('  返すデータ量が正しい', (await vf.arrayBuffer()).byteLength === 100);

vf = await fetch(url + 'files/run1/recommend/alice/videos/a_1.mp4', { headers: { Range: 'bytes=900-' } });
check('末尾までの範囲指定に応える', vf.status === 206 && (await vf.arrayBuffer()).byteLength === 100);

vf = await fetch(url + 'files/run1/recommend/alice/videos/a_1.mp4', { headers: { Range: 'bytes=5000-6000' } });
check('おかしな範囲は正しく断る', vf.status === 416);
vf.body?.cancel();

console.log('\n[H] エラーの記録');
const { writeLog, readRecentLog } = await import(new URL('../src/logger.js', import.meta.url).href);
writeLog('テストの記録です');
writeLog('テストの警告です', 'warn');
writeLog('テストのエラーです', 'error');
check('記録ファイルが作られる', existsSync(join(work, 'logs', 'app.log')));
const logText = readRecentLog(50);
check('情報・注意・エラーが区別して残る',
  logText.includes('[情報] テストの記録です') && logText.includes('[注意]') && logText.includes('[エラー]'));
check('日時が入っている', /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(logText));

r = await api('/api/log');
check('画面から記録を読める', r.status === 200 && String(r.data.text ?? '').includes('テストのエラーです'));
check('記録ファイルの場所が分かる', String(r.data.path ?? '').endsWith('app.log'));

console.log('\n[I] 想定外のエラーでもアプリが落ちない');
// 実際に捕捉されない例外を投げてみる
process.emit('uncaughtException', new Error('わざと起こしたエラー'));
process.emit('unhandledRejection', new Error('わざと起こした未処理エラー'));
await new Promise((res) => setTimeout(res, 200));
r = await api('/api/state');
check('例外のあともサーバーが応答する', r.status === 200);
check('例外が記録に残る', readRecentLog(80).includes('わざと起こしたエラー'));

console.log('\n[J] ジョブの失敗が記録に残る');
await api('/api/run/migrate', {});
await new Promise((res) => setTimeout(res, 400));
check('失敗したジョブが記録される', readRecentLog(80).includes('アカウント移植 が失敗しました'));
r = await api('/api/state');
check('画面に前回の失敗が残る', typeof r.data.job.error === 'string' && r.data.job.error.length > 0);

server.close();
rmSync(work, { recursive: true, force: true });
console.log(`\n=== 画面サーバー: ${pass} 件成功 / ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
