// 動画の取得。
// X の動画は画面上では blob: になっていて直接は落とせないため、
// ページ自身が読み込んでいる通信内容(JSON)から本当の動画URLを拾います。
// (公式APIのキーは使いません。ブラウザが受け取ったものを読むだけです)
import { writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';

// JSON を再帰的にたどって、動画つきメディアを集める。
// X の構造変更に強いよう「video_info.variants を持つ物」を手がかりにする。
export function collectMediaFromJson(node, into = new Map(), depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return into;

  if (Array.isArray(node)) {
    for (const item of node) collectMediaFromJson(item, into, depth + 1);
    return into;
  }

  const variants = node.video_info?.variants;
  if (Array.isArray(variants)) {
    // expanded_url は https://x.com/<user>/status/<id>/video/1 の形なので投稿IDが取れる
    const m = String(node.expanded_url ?? '').match(/status\/(\d+)/);
    const tweetId = m ? m[1] : null;
    if (tweetId) {
      const best = pickBestVariant(variants);
      if (best) {
        const list = into.get(tweetId) ?? [];
        // 同じ動画を重複して登録しない
        if (!list.some((v) => v.url === best.url)) {
          list.push({
            url: best.url,
            kind: best.kind,
            bitrate: best.bitrate,
            type: node.type === 'animated_gif' ? 'gif' : 'video',
            thumbnail: node.media_url_https ?? null,
            durationMs: node.video_info?.duration_millis ?? null,
          });
        }
        into.set(tweetId, list);
      }
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'video_info') continue;
    collectMediaFromJson(node[key], into, depth + 1);
  }
  return into;
}

// 画質の候補から最適なものを選ぶ。
// mp4 が1つでもあればその中で最高画質。mp4 が無ければ m3u8(そのままでは保存できない)。
export function pickBestVariant(variants) {
  const mp4 = variants
    .filter((v) => v?.content_type === 'video/mp4' && typeof v.url === 'string')
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  if (mp4.length) return { url: mp4[0].url, bitrate: mp4[0].bitrate ?? 0, kind: 'mp4' };

  const hls = variants.find((v) => v?.content_type === 'application/x-mpegURL' && typeof v.url === 'string');
  if (hls) return { url: hls.url, bitrate: 0, kind: 'hls' };
  return null;
}

// ページの通信を監視して、動画URLを集め続ける
export function attachMediaCapture(page) {
  const byTweetId = new Map();

  const onResponse = async (response) => {
    try {
      const url = response.url();
      // 投稿データが返ってくる通信だけを見る
      if (!/graphql|\/i\/api\//i.test(url)) return;
      const type = response.headers()['content-type'] ?? '';
      if (!type.includes('json')) return;
      const data = await response.json();
      collectMediaFromJson(data, byTweetId);
    } catch {
      // 読めない応答は無視してよい(暗号化・中断など)
    }
  };

  page.on('response', onResponse);
  return {
    byTweetId,
    get(tweetId) {
      return byTweetId.get(tweetId) ?? [];
    },
    detach() {
      page.off('response', onResponse);
    },
  };
}

// 動画をダウンロードする。大きすぎるものは設定の上限で弾く。
// 戻り値: { ok, skipped, reason, bytes }
export async function downloadVideo(url, destPath, { maxBytes = 100 * 1024 * 1024, retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // 事前にサイズが分かる場合は、大きすぎればダウンロードしない
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared && declared > maxBytes) {
        return { ok: false, skipped: true, reason: `サイズ超過 (${Math.round(declared / 1024 / 1024)}MB)`, bytes: declared };
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('空のファイル');
      if (buf.length > maxBytes) {
        return { ok: false, skipped: true, reason: `サイズ超過 (${Math.round(buf.length / 1024 / 1024)}MB)`, bytes: buf.length };
      }
      await writeFile(destPath, buf);
      return { ok: true, bytes: buf.length };
    } catch (err) {
      const msg = String(err.message ?? err);
      if (/HTTP 4[0-9]{2}/.test(msg) && !/HTTP 429/.test(msg)) {
        return { ok: false, reason: msg };
      }
      if (attempt === retries) return { ok: false, reason: msg };
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }
  return { ok: false, reason: '不明' };
}

export function fileSizeMB(path) {
  try {
    return Math.round((statSync(path).size / 1024 / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}
