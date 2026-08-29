// 収集結果から「タイムライン再現ビューア」(report.html) と CSV を作る。
// ビューアは単体のHTMLで、ダブルクリックでも開けます。
//  - タイムライン: 収集した投稿とコメントを、その時刻の並びで再現
//  - 画像ギャラリー / 動画ギャラリー: メディアだけを一覧
//  - アカウント・種別・並び順・キーワードで絞り込み
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAB_LABELS = { recommend: 'おすすめ', following: 'フォロー中', manual: '自分で見た' };

function csvCell(s) {
  return `"${String(s ?? '').replaceAll('"', '""')}"`;
}

// ビューアに埋め込むデータを組み立てる
export function buildViewData(dataByTab, comments = []) {
  const accounts = new Map();
  const items = [];

  for (const [tabKey, list] of Object.entries(dataByTab)) {
    for (const account of list ?? []) {
      const key = account.handle;
      if (!accounts.has(key)) {
        accounts.set(key, { handle: account.handle, displayName: account.displayName ?? '', tabs: [] });
      }
      if (!accounts.get(key).tabs.includes(tabKey)) accounts.get(key).tabs.push(tabKey);

      const base = `${tabKey}/${account.dirName}`;
      for (const t of account.tweets ?? []) {
        items.push({
          id: t.tweetId,
          kind: 'post',
          tab: tabKey,
          handle: account.handle,
          displayName: account.displayName ?? '',
          datetime: t.datetime ?? null,
          text: t.text ?? '',
          screenshot: t.screenshot ? `${base}/${t.screenshot}` : null,
          url: t.url,
          images: (t.savedImages ?? []).map((f) => `${base}/images/${f}`),
          videos: (t.savedVideos ?? [])
            .filter((v) => v && v.file)
            .map((v) => ({ src: `${base}/videos/${v.file}`, type: v.type, durationMs: v.durationMs })),
          missingVideos: (t.savedVideos ?? []).filter((v) => v && !v.file).length,
          replyCount: (t.replies ?? []).length,
        });
      }
    }
  }

  // コメントも同じ並びに混ぜられるようにする
  for (const c of comments) {
    const base = `${c.tab}/${c.dirName}`;
    items.push({
      id: c.commentId,
      kind: 'comment',
      tab: c.tab,
      handle: c.handle,
      displayName: c.displayName ?? '',
      datetime: c.datetime ?? null,
      text: c.text ?? '',
      url: c.url,
      parentUrl: c.parentUrl,
      onAccount: c.account, // どのアカウントの投稿へのコメントか
      images: (c.savedImages ?? []).map((f) => `${base}/images/${f}`),
      videos: (c.savedVideos ?? [])
        .filter((v) => v && v.file)
        .map((v) => ({ src: `${base}/videos/${v.file}`, type: v.type, durationMs: v.durationMs })),
      missingVideos: 0,
      replyCount: 0,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    tabLabels: TAB_LABELS,
    accounts: [...accounts.values()].sort((a, b) => a.handle.localeCompare(b.handle)),
    items,
  };
}

export function generateReport(runDir, dataByTab, comments = []) {
  const view = buildViewData(dataByTab, comments);
  const htmlPath = join(runDir, 'report.html');
  writeFileSync(htmlPath, renderHtml(view), 'utf8');

  // 投稿のCSV
  const rows = [['種別', 'タブ', 'アカウント', '表示名', 'ID', 'URL', '投稿日時', '本文', 'スクショ', '画像数', '動画数', 'コメント数']
    .map(csvCell).join(',')];
  for (const it of view.items) {
    rows.push([
      it.kind === 'post' ? '投稿' : 'コメント',
      TAB_LABELS[it.tab] ?? it.tab,
      it.handle, it.displayName, it.id, it.url, it.datetime, it.text, it.screenshot ?? '',
      it.images.length, it.videos.length, it.replyCount,
    ].map(csvCell).join(','));
  }
  const csvPath = join(runDir, 'tweets.csv');
  writeFileSync(csvPath, '﻿' + rows.join('\n'), 'utf8');

  return { htmlPath, csvPath };
}

function renderHtml(view) {
  // </script> や特殊な改行文字でHTMLが壊れないようにしておく
  const data = JSON.stringify(view)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>X タイムライン再現</title>
<style>
  :root{--bg:#f6f8fa;--panel:#fff;--text:#16202a;--muted:#5b6b7c;--line:#dfe6ee;--brand:#1d9bf0;
        --shadow:0 1px 3px rgba(16,32,48,.08)}
  @media (prefers-color-scheme:dark){:root{--bg:#0f1720;--panel:#17212b;--text:#e6edf3;--muted:#8ba0b3;
        --line:#25323f;--shadow:0 1px 3px rgba(0,0,0,.4)}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);line-height:1.6;
       font-family:"Segoe UI","Yu Gothic UI",system-ui,-apple-system,sans-serif}
  header{background:var(--panel);border-bottom:1px solid var(--line);padding:12px 16px;position:sticky;top:0;z-index:20}
  h1{margin:0 0 10px;font-size:16px}
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  select,input[type=search]{background:var(--bg);color:var(--text);border:1px solid var(--line);
       border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit}
  .modes{display:flex;gap:2px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:2px}
  .modes button{border:0;background:transparent;color:var(--muted);padding:5px 14px;border-radius:6px;
       cursor:pointer;font-size:13px;font-weight:600}
  .modes button.on{background:var(--brand);color:#fff}
  .count{color:var(--muted);font-size:13px;margin-left:auto}
  .chk{display:flex;align-items:center;gap:5px;font-size:13px;color:var(--muted);cursor:pointer;
       border:1px solid var(--line);border-radius:8px;padding:5px 10px}
  main{max-width:640px;margin:0 auto;padding:16px}
  main.wide{max-width:1200px}
  .post{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;
        margin-bottom:12px;box-shadow:var(--shadow)}
  .who{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:14px}
  .who b{font-size:15px}
  .who .handle,.who .time{color:var(--muted);font-size:13px}
  .who .time{margin-left:auto}
  .chip{font-size:11px;border:1px solid var(--line);border-radius:99px;padding:1px 8px;color:var(--muted)}
  .chip.comment{border-color:var(--brand);color:var(--brand)}
  .text{white-space:pre-wrap;margin:8px 0 0;font-size:15px}
  .shot{display:block;width:100%;margin-top:10px;border:1px solid var(--line);border-radius:10px;cursor:zoom-in}
  .media{display:grid;gap:6px;margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
  .media img,.media video{width:100%;border-radius:10px;background:#0002;display:block;max-height:420px;object-fit:cover}
  .media.one{grid-template-columns:1fr}
  .meta{margin-top:8px;font-size:12px;color:var(--muted);display:flex;gap:12px;flex-wrap:wrap}
  .meta a{color:var(--brand);text-decoration:none}
  .gallery{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
  .cell{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}
  .cell img,.cell video{width:100%;height:170px;object-fit:cover;display:block;background:#0002}
  .cell .cap{padding:6px 8px;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .empty{text-align:center;color:var(--muted);padding:60px 20px}
  .group-head{margin:22px 0 10px;font-size:14px;font-weight:700;border-bottom:2px solid var(--brand);padding-bottom:4px}
  dialog{border:0;border-radius:12px;padding:0;background:transparent;max-width:96vw;max-height:96vh}
  dialog::backdrop{background:rgba(0,0,0,.8)}
  dialog img,dialog video{max-width:96vw;max-height:88vh;border-radius:10px;display:block}
  dialog .bar{color:#fff;font-size:13px;padding:8px 4px;display:flex;gap:12px}
  dialog .bar a{color:#8ecdff}
</style>
</head>
<body>
<header>
  <h1>X タイムライン再現 <span class="count" id="genAt"></span></h1>
  <div class="toolbar">
    <div class="modes" id="modes">
      <button data-mode="timeline" class="on">タイムライン</button>
      <button data-mode="images">画像だけ</button>
      <button data-mode="videos">動画だけ</button>
    </div>
    <select id="account"><option value="">すべてのアカウント</option></select>
    <label class="chk" title="そのアカウントの投稿に付いたコメントも一緒に表示します">
      <input type="checkbox" id="withReplies"> 宛てのコメントも含む
    </label>
    <select id="kind">
      <option value="">投稿とコメント</option>
      <option value="post">投稿だけ</option>
      <option value="comment">コメントだけ</option>
    </select>
    <select id="tab">
      <option value="">すべての欄</option>
      <option value="recommend">おすすめ欄</option>
      <option value="following">フォロー欄</option>
      <option value="manual">自分で見た</option>
    </select>
    <select id="sort">
      <option value="new">新しい順</option>
      <option value="old">古い順</option>
      <option value="account">アカウントごと</option>
    </select>
    <input type="search" id="q" placeholder="本文・アカウントを検索">
    <span class="count" id="count"></span>
  </div>
</header>
<main id="main"></main>
<dialog id="viewer"><div id="viewerBody"></div><div class="bar" id="viewerBar"></div></dialog>

<script>
const DATA = ${data};
const $ = (s) => document.querySelector(s);
let mode = 'timeline';

document.getElementById('genAt').textContent =
  '作成: ' + new Date(DATA.generatedAt).toLocaleString('ja-JP');

// アカウントの選択肢
for (const a of DATA.accounts) {
  const o = document.createElement('option');
  o.value = a.handle;
  o.textContent = (a.displayName ? a.displayName + ' ' : '') + '@' + a.handle;
  $('#account').appendChild(o);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
};
const fmtDur = (ms) => {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function filtered() {
  const acc = $('#account').value, kind = $('#kind').value, tab = $('#tab').value;
  const q = $('#q').value.trim().toLowerCase();
  const withReplies = $('#withReplies').checked;
  let list = DATA.items.filter((it) => {
    // アカウント絞り込み。「宛てのコメントも含む」なら、その人の投稿へのコメントも残す
    if (acc && !(it.handle === acc || (withReplies && it.onAccount === acc))) return false;
    if (kind && it.kind !== kind) return false;
    if (tab && it.tab !== tab) return false;
    if (q) {
      const hay = (String(it.text) + ' ' + it.handle + ' ' + it.displayName).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (mode === 'images' && it.images.length === 0) return false;
    if (mode === 'videos' && it.videos.length === 0) return false;
    return true;
  });
  const sort = $('#sort').value;
  const t = (it) => (it.datetime ? new Date(it.datetime).getTime() : 0);
  if (sort === 'new') list.sort((a, b) => t(b) - t(a));
  else if (sort === 'old') list.sort((a, b) => t(a) - t(b));
  else list.sort((a, b) => a.handle.localeCompare(b.handle) || t(b) - t(a));
  return list;
}

function mediaHtml(it) {
  const parts = [];
  for (const v of it.videos) {
    parts.push('<video src="' + esc(v.src) + '" controls preload="metadata" playsinline></video>');
  }
  for (const src of it.images) {
    parts.push('<img src="' + esc(src) + '" loading="lazy" alt="">');
  }
  if (!parts.length) return '';
  const one = parts.length === 1 ? ' one' : '';
  return '<div class="media' + one + '">' + parts.join('') + '</div>';
}

function postHtml(it) {
  const chips = [];
  if (it.kind === 'comment') chips.push('<span class="chip comment">コメント</span>');
  chips.push('<span class="chip">' + esc(DATA.tabLabels[it.tab] ?? it.tab) + '</span>');
  const meta = [];
  if (it.url) meta.push('<a href="' + esc(it.url) + '" target="_blank">Xで開く</a>');
  if (it.kind === 'comment' && it.parentUrl) meta.push('<a href="' + esc(it.parentUrl) + '" target="_blank">元の投稿</a>');
  if (it.replyCount) meta.push('コメント ' + it.replyCount + '件');
  if (it.images.length) meta.push('画像 ' + it.images.length + '枚');
  if (it.videos.length) meta.push('動画 ' + it.videos.length + '本');
  if (it.missingVideos) meta.push('保存できなかった動画 ' + it.missingVideos + '本');
  // スクショがあれば本文の代わりにそれを見せる(画像はスクショに写っているので重複表示しない)
  const shot = it.screenshot
    ? '<img class="shot" src="' + esc(it.screenshot) + '" loading="lazy" alt="投稿のスクリーンショット">'
    : '';
  return '<article class="post">'
    + '<div class="who"><b>' + esc(it.displayName || it.handle) + '</b>'
    + '<span class="handle">@' + esc(it.handle) + '</span>' + chips.join('')
    + '<span class="time">' + esc(fmtTime(it.datetime)) + '</span></div>'
    + (it.text ? '<p class="text">' + esc(it.text) + '</p>' : '')
    + shot
    + (it.screenshot ? '' : mediaHtml(it))
    // 各項目を span で包む(そうしないと横の間隔が空かない)
    + (meta.length ? '<div class="meta">' + meta.map((m) => '<span>' + m + '</span>').join('') + '</div>' : '')
    + '</article>';
}

function galleryHtml(list, type) {
  const cells = [];
  for (const it of list) {
    const items = type === 'videos' ? it.videos : it.images;
    for (const m of items) {
      const src = type === 'videos' ? m.src : m;
      const label = '@' + it.handle + '　' + fmtTime(it.datetime)
        + (type === 'videos' && m.durationMs ? '　' + fmtDur(m.durationMs) : '');
      const media = type === 'videos'
        ? '<video src="' + esc(src) + '" preload="metadata" muted></video>'
        : '<img src="' + esc(src) + '" loading="lazy" alt="">';
      cells.push('<div class="cell" data-src="' + esc(src) + '" data-type="' + type
        + '" data-url="' + esc(it.url ?? '') + '" data-cap="' + esc(label) + '">'
        + media + '<div class="cap">' + esc(label) + '</div></div>');
    }
  }
  if (!cells.length) return '';
  return '<div class="gallery">' + cells.join('') + '</div>';
}

function render() {
  const list = filtered();
  const main = $('#main');
  main.classList.toggle('wide', mode !== 'timeline');

  if (mode === 'timeline') {
    const sort = $('#sort').value;
    if (sort === 'account') {
      const groups = new Map();
      for (const it of list) {
        if (!groups.has(it.handle)) groups.set(it.handle, []);
        groups.get(it.handle).push(it);
      }
      main.innerHTML = [...groups.entries()].map(([h, items]) =>
        '<h2 class="group-head">@' + esc(h) + '（' + items.length + '件）</h2>'
        + items.map(postHtml).join('')).join('') || emptyHtml();
    } else {
      main.innerHTML = list.map(postHtml).join('') || emptyHtml();
    }
    $('#count').textContent = list.length + ' 件';
  } else {
    const html = galleryHtml(list, mode);
    main.innerHTML = html || emptyHtml();
    const n = (main.querySelectorAll('.cell') || []).length;
    $('#count').textContent = n + (mode === 'videos' ? ' 本' : ' 枚');
  }
}

function emptyHtml() {
  return '<div class="empty">条件に合うものがありません。<br>絞り込みを変えてみてください。</div>';
}

// ギャラリーのクリックで拡大表示
$('#main').addEventListener('click', (e) => {
  // タイムラインのスクショをクリックしたら拡大
  const shot = e.target.closest('.shot');
  if (shot) {
    $('#viewerBody').innerHTML = '<img src="' + esc(shot.getAttribute('src')) + '" alt="">';
    $('#viewerBar').innerHTML = '<a href="' + esc(shot.getAttribute('src')) + '" target="_blank">元ファイル</a>';
    $('#viewer').showModal();
    return;
  }
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const src = cell.dataset.src, type = cell.dataset.type;
  $('#viewerBody').innerHTML = type === 'videos'
    ? '<video src="' + esc(src) + '" controls autoplay playsinline></video>'
    : '<img src="' + esc(src) + '" alt="">';
  $('#viewerBar').innerHTML = esc(cell.dataset.cap)
    + (cell.dataset.url ? ' <a href="' + esc(cell.dataset.url) + '" target="_blank">Xで開く</a>' : '')
    + ' <a href="' + esc(src) + '" target="_blank">元ファイル</a>';
  $('#viewer').showModal();
});
$('#viewer').addEventListener('click', (e) => { if (e.target.id === 'viewer') $('#viewer').close(); });
$('#viewer').addEventListener('close', () => { $('#viewerBody').innerHTML = ''; });

$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  mode = b.dataset.mode;
  document.querySelectorAll('#modes button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
for (const id of ['account', 'kind', 'tab', 'sort', 'withReplies']) $('#' + id).addEventListener('change', render);
$('#q').addEventListener('input', render);

render();
</script>
</body>
</html>`;
}
