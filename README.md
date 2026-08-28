# X タイムライン自動収集ツール

X(旧Twitter)の **おすすめ欄** と **フォロー欄** から、公式APIを使わずに
投稿テキスト(コメント)と画像を自動で収集するツールです。
Playwright によるブラウザ自動操作で、タブごとに **約10アカウント分** の投稿を取得します。

> ⚠️ **注意**: 自動化ツールによる収集は X の利用規約に抵触する可能性があり、
> アカウントが制限・凍結されるリスクがあります。自己責任で、自分のアカウントに対して、
> 節度ある頻度でご利用ください。収集したデータの取り扱いは各自の責任で行ってください。

## かんたんな使い方(これだけでOK)

```bash
npm run setup   # 初回のみ(依存関係とブラウザの取得)
npm start       # あとはこれだけ
```

`npm start` を実行すると:

1. **初回は自動でログイン画面が開く** → 手動で X にログインするだけ
   (セッションは `auth/state.json` に保存され、次回からは不要。コミットもされません)
2. いくつか質問が出ますが、**すべて Enter キーだけでおすすめ設定** で動きます
3. 収集が終わると **HTMLレポートが自動でブラウザに開きます**

質問で変えられること: 収集する欄(おすすめ/フォロー中)、アカウント数、
リプライ取得の有無、取得済みスキップ、キーワード絞り込み。

### コマンドで直接実行したい場合

```bash
npm run scrape              # おすすめ + フォロー中 の両方(質問なし)
npm run scrape:recommend    # おすすめ欄のみ
npm run scrape:following    # フォロー欄のみ
npm run login               # ログインだけやり直す
```

## 機能

- **API不使用**: Playwright のブラウザ自動操作で収集(日本語/英語UI対応、広告除外)
- **約10アカウント分** の投稿テキスト・画像(最高画質)・リプライを収集
- **HTMLレポート自動生成**: 収集結果を1ページで見られる `report.html` を生成し自動で開く
- **CSV出力**: `tweets.csv`(Excel対応・BOM付きUTF-8)も同時に生成
- **差分取得**: 取得済みの投稿は次回スキップ(`output/seen.json` を削除でリセット)
- **キーワード絞り込み**: 指定した語を含む投稿だけを収集

## 出力

```
output/
├── seen.json                   # 取得済み投稿ID(差分取得用)
└── 2026-08-28T12-00-00/        # 実行日時
    ├── report.html             # HTMLレポート(自動で開きます)
    ├── tweets.csv              # CSV(Excelでそのまま開けます)
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

ふだんは `npm start` の質問で足りますが、細かい調整は `src/config.js` で変更できます:

| 設定 | 既定値 | 説明 |
|---|---|---|
| `maxAccounts` | `10` | タブごとに収集するアカウント数 |
| `maxTweetsPerAccount` | `5` | 1アカウントあたり保存する投稿数 |
| `fetchReplies` | `true` | 各投稿のリプライ(コメント)も取得するか |
| `maxRepliesPerTweet` | `10` | 1投稿あたりのリプライ取得数 |
| `skipSeen` | `true` | 取得済み投稿をスキップ(差分取得) |
| `keywords` | `[]` | キーワード絞り込み(空=すべて) |
| `maxScrolls` | `30` | タイムラインの最大スクロール回数 |
| `scrollDelayMs` | `2000` | スクロール間の基本待機時間(±50%の揺らぎあり) |
| `headless` | `true` | `false` にするとブラウザの動作を目視できます |

## 仕組み

- `src/index.js` — かんたん実行モード(`npm start`)。ログイン確認→質問→収集→レポート表示
- `src/login.js` — 手動ログインでセッション(Cookie)を保存
- `src/scrape.js` — ホーム画面でタブを切り替え、スクロールしながら投稿を収集
- `src/extract.js` — DOM から投稿ID・本文・投稿日時・画像URLを抽出(広告は除外)
- `src/report.js` — HTMLレポートとCSVの生成
- 画像は `name=orig`(オリジナル画質)に変換してダウンロード
- 待機時間にランダムな揺らぎを入れ、過度なアクセスを避けています

## トラブルシューティング

- **「認証情報が見つかりません」** → `npm start` を実行(自動でログイン画面が開きます)
- **「タブが見つかりませんでした」** → セッション切れの可能性。`npm run login` でログインし直してください
- **新しい投稿が取得できない** → 差分取得が効いています。`output/seen.json` を削除すると最初から取得します
- **動作を確認したい** → `src/config.js` の `headless` を `false` にして実行
- **ブラウザが見つからない** → `npx playwright install chromium` を実行、または環境変数 `CHROMIUM_PATH` で実行ファイルを指定
