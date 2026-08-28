// 収集結果からHTMLレポートとCSVを生成する
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAB_LABELS = { recommend: 'おすすめ', following: 'フォロー中' };

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function csvCell(s) {
  return `"${String(s ?? '').replaceAll('"', '""')}"`;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ja-JP');
  } catch {
    return iso;
  }
}

// dataByTab: { recommend: [accountData...], following: [...] }
// accountData: { handle, displayName, tab, tweets: [{ tweetId, url, datetime, text, savedImages, replies }] }
export function generateReport(runDir, dataByTab) {
  const sections = [];

  for (const [tabKey, accounts] of Object.entries(dataByTab)) {
    const tabLabel = TAB_LABELS[tabKey] ?? tabKey;
    const accountBlocks = accounts.map((account) => {
      const tweetCards = account.tweets.map((tweet) => {
        const images = (tweet.savedImages ?? [])
          .map((f) => {
            const src = `${tabKey}/${account.dirName}/images/${encodeURIComponent(f)}`;
            return `<a href="${src}" target="_blank"><img src="${src}" loading="lazy" alt=""></a>`;
          })
          .join('');
        const replies = (tweet.replies ?? [])
          .map(
            (r) =>
              `<li><b>@${escapeHtml(r.handle)}</b> ${escapeHtml(r.text)}</li>`
          )
          .join('');
        const repliesBlock = replies
          ? `<details><summary>リプライ ${tweet.replies.length}件</summary><ul class="replies">${replies}</ul></details>`
          : '';
        return `<div class="tweet">
          <div class="meta"><a href="${escapeHtml(tweet.url)}" target="_blank">${formatDate(tweet.datetime)}</a></div>
          <p class="text">${escapeHtml(tweet.text)}</p>
          <div class="images">${images}</div>
          ${repliesBlock}
        </div>`;
      });
      return `<section class="account">
        <h3>${escapeHtml(account.displayName ?? '')} <span class="handle">@${escapeHtml(account.handle)}</span></h3>
        ${tweetCards.join('')}
      </section>`;
    });
    sections.push(`<h2>${escapeHtml(tabLabel)}(${accounts.length}アカウント)</h2>${accountBlocks.join('')}`);
  }

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>X 収集レポート</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 16px; line-height: 1.6; }
  h1 { font-size: 1.4rem; }
  h2 { border-bottom: 2px solid #1d9bf0; padding-bottom: 4px; margin-top: 2em; }
  .account { border: 1px solid #8884; border-radius: 12px; padding: 12px 16px; margin: 16px 0; }
  .account h3 { margin: 0 0 8px; }
  .handle { color: #888; font-weight: normal; font-size: 0.9em; }
  .tweet { border-top: 1px solid #8883; padding: 10px 0; }
  .meta a { color: #1d9bf0; text-decoration: none; font-size: 0.85em; }
  .text { white-space: pre-wrap; margin: 4px 0; }
  .images { display: flex; flex-wrap: wrap; gap: 6px; }
  .images img { max-width: 180px; max-height: 180px; border-radius: 8px; object-fit: cover; }
  details { margin-top: 6px; }
  summary { cursor: pointer; color: #1d9bf0; font-size: 0.9em; }
  .replies { font-size: 0.9em; padding-left: 1.2em; }
</style>
</head>
<body>
<h1>X 収集レポート</h1>
<p>生成日時: ${escapeHtml(new Date().toLocaleString('ja-JP'))}</p>
${sections.join('')}
</body>
</html>`;

  const htmlPath = join(runDir, 'report.html');
  writeFileSync(htmlPath, html, 'utf8');

  // CSV(Excelで文字化けしないようBOM付きUTF-8)
  const rows = [['タブ', 'アカウント', '表示名', '投稿ID', 'URL', '投稿日時', '本文', '画像ファイル', 'リプライ数'].map(csvCell).join(',')];
  for (const [tabKey, accounts] of Object.entries(dataByTab)) {
    for (const account of accounts) {
      for (const tweet of account.tweets) {
        rows.push(
          [
            TAB_LABELS[tabKey] ?? tabKey,
            account.handle,
            account.displayName,
            tweet.tweetId,
            tweet.url,
            tweet.datetime,
            tweet.text,
            (tweet.savedImages ?? []).join(' '),
            (tweet.replies ?? []).length,
          ]
            .map(csvCell)
            .join(',')
        );
      }
    }
  }
  const csvPath = join(runDir, 'tweets.csv');
  writeFileSync(csvPath, '\ufeff' + rows.join('\n'), 'utf8');

  return { htmlPath, csvPath };
}
