// タイムライン/詳細ページのDOMから投稿データを抽出するヘルパー

// ページ内で実行される抽出関数(page.evaluate に渡す)
export function extractTweetsInPage() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  const results = [];

  for (const article of articles) {
    // 広告(プロモーション)投稿はスキップ
    const labels = Array.from(article.querySelectorAll('span')).map((s) => s.textContent?.trim());
    if (labels.includes('広告') || labels.includes('Ad') || labels.includes('Promoted')) continue;

    // 投稿URLと投稿ID(time要素を含むstatusリンクが本体の永続リンク)
    let url = null;
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      if (a.querySelector('time')) {
        url = a.getAttribute('href');
        break;
      }
    }
    if (!url) continue;
    const match = url.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!match) continue;
    const [, handle, tweetId] = match;

    // 表示名
    const userName = article.querySelector('[data-testid="User-Name"]');
    let displayName = null;
    if (userName) {
      const nameLink = userName.querySelector('a');
      displayName = nameLink?.textContent?.trim() ?? null;
    }

    // 本文(コメント)
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText : '';

    // 投稿日時
    const timeEl = article.querySelector('time');
    const datetime = timeEl?.getAttribute('datetime') ?? null;

    // 画像(プロフィールアイコンは除外し、投稿写真のみ)
    const images = [];
    for (const img of article.querySelectorAll('[data-testid="tweetPhoto"] img')) {
      const src = img.getAttribute('src');
      if (src && src.includes('pbs.twimg.com/media/')) images.push(src);
    }

    results.push({ tweetId, handle, displayName, url: `https://x.com${url}`, datetime, text, images });
  }
  return results;
}

// ユーザー一覧(フォロー中・フォロワー・おすすめユーザー)のセルから
// アカウント情報を抽出する(page.evaluate に渡す)
export function extractUserCellsInPage() {
  const cells = document.querySelectorAll('[data-testid="UserCell"]');
  const results = [];
  for (const cell of cells) {
    // @handle(@から始まるspan)を探す
    let handle = null;
    for (const s of cell.querySelectorAll('span')) {
      const t = s.textContent && s.textContent.trim();
      if (t && /^@[A-Za-z0-9_]+$/.test(t)) {
        handle = t.slice(1);
        break;
      }
    }
    if (!handle) continue;

    // 表示名(プロフィールリンクのテキスト先頭行)
    let displayName = null;
    const nameLink = cell.querySelector(`a[href="/${handle}"]`);
    if (nameLink) {
      const first = (nameLink.innerText || '').split('\n')[0].trim();
      if (first && !first.startsWith('@')) displayName = first;
    }

    results.push({ handle, displayName });
  }
  return results;
}

// 画像URLを最高画質(orig)に変換する
export function toOriginalImageUrl(src) {
  try {
    const u = new URL(src);
    u.searchParams.set('name', 'orig');
    return u.toString();
  } catch {
    return src;
  }
}

// 画像URLからファイル拡張子を推定する
export function imageExtension(src) {
  try {
    const u = new URL(src);
    const format = u.searchParams.get('format');
    if (format) return format;
    const m = u.pathname.match(/\.(\w+)$/);
    if (m) return m[1];
  } catch {
    // fall through
  }
  return 'jpg';
}
