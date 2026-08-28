# X タイムライン自動収集ツール

X(旧Twitter)の **おすすめ欄** と **フォロー欄** から、公式APIを使わずに
投稿テキスト(コメント)と画像を自動で収集するツールです。
Playwright によるブラウザ自動操作で、タブごとに **約10アカウント分** の投稿を取得します。

> ⚠️ **注意**: 自動化ツールによる収集は X の利用規約に抵触する可能性があり、
> アカウントが制限・凍結されるリスクがあります。自己責任で、自分のアカウントに対して、
> 節度ある頻度でご利用ください。収集したデータの取り扱いは各自の責任で行ってください。

## セットアップ

```bash
npm install
npx playwright install chromium   # 初回のみ(ブラウザ本体の取得)
```

## 使い方

### 1. ログイン(初回のみ)

```bash
npm run login
```

ブラウザが開くので、手動で X にログインしてください。
ログインが完了すると、セッションが `auth/state.json` に保存されます
(このファイルは `.gitignore` 済みで、コミットされません)。

### 2. 収集の実行

```bash
npm run scrape              # おすすめ + フォロー中 の両方
npm run scrape:recommend    # おすすめ欄のみ
npm run scrape:following    # フォロー欄のみ
```

タイムラインを自動スクロールしながら、タブごとにユニークな約10アカウント分の
投稿を集め、テキスト・画像・(設定次第で)リプライを保存します。

## 出力

```
output/
└── 2026-08-28T12-00-00/        # 実行日時
    ├── recommend/              # おすすめ欄
    │   ├── summary.json        # 収集したアカウント一覧
    │   └── <アカウント名>/
    │       ├── tweets.json     # 投稿テキスト・リプライ・画像URLなど
    │       └── images/         # ダウンロードした画像(最高画質)
    └── following/              # フォロー欄(同じ構成)
```

`tweets.json` の例:

```json
{
  "handle": "example_user",
  "displayName": "サンプル",
  "tab": "recommend",
  "tweets": [
    {
      "tweetId": "1234567890",
      "url": "https://x.com/example_user/status/1234567890",
      "datetime": "2026-08-28T10:00:00.000Z",
      "text": "投稿本文...",
      "imageUrls": ["https://pbs.twimg.com/media/xxx?format=jpg&name=orig"],
      "savedImages": ["1234567890_1.jpg"],
      "replies": [
        { "handle": "reply_user", "text": "リプライ本文...", "images": [] }
      ]
    }
  ]
}
```

## 設定

`src/config.js` で変更できます:

| 設定 | 既定値 | 説明 |
|---|---|---|
| `maxAccounts` | `10` | タブごとに収集するアカウント数 |
| `maxTweetsPerAccount` | `5` | 1アカウントあたり保存する投稿数 |
| `fetchReplies` | `true` | 各投稿のリプライ(コメント)も取得するか |
| `maxRepliesPerTweet` | `10` | 1投稿あたりのリプライ取得数 |
| `maxScrolls` | `30` | タイムラインの最大スクロール回数 |
| `scrollDelayMs` | `2000` | スクロール間の基本待機時間(±50%の揺らぎあり) |
| `headless` | `true` | `false` にするとブラウザの動作を目視できます |

## 仕組み

- `src/login.js` — 手動ログインでセッション(Cookie)を保存
- `src/scrape.js` — ホーム画面でタブを切り替え、スクロールしながら投稿を収集
- `src/extract.js` — DOM から投稿ID・本文・投稿日時・画像URLを抽出(広告は除外)
- 画像は `name=orig`(オリジナル画質)に変換してダウンロード
- 待機時間にランダムな揺らぎを入れ、過度なアクセスを避けています

## トラブルシューティング

- **「認証情報が見つかりません」** → 先に `npm run login` を実行してください
- **「タブが見つかりませんでした」** → セッション切れの可能性。再度 `npm run login` してください
- **動作を確認したい** → `src/config.js` の `headless` を `false` にして実行
