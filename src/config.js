// 設定ファイル: 必要に応じて値を変更してください
export const CONFIG = {
  // 収集するユニークアカウント数(タブごと)
  maxAccounts: 10,

  // 1アカウントあたり保存する最大投稿数
  maxTweetsPerAccount: 5,

  // 各投稿のリプライ(コメント)も取得するか
  fetchReplies: true,

  // 1投稿あたり取得する最大リプライ数
  maxRepliesPerTweet: 10,

  // タイムラインをスクロールする最大回数(無限ループ防止)
  maxScrolls: 30,

  // スクロール間の待機時間(ミリ秒)。ランダムに±50%揺らぎます
  scrollDelayMs: 2000,

  // 過去の実行で取得済みの投稿をスキップするか(差分取得)
  skipSeen: true,

  // キーワード絞り込み(空配列ならすべて取得。いずれかを含む投稿のみ収集)
  keywords: [],

  // 認証状態の保存先(既定。ログインアカウントごとに別ファイルになります)
  authStatePath: 'auth/state.json',

  // 出力先ディレクトリ
  outputDir: 'output',

  // ブラウザを表示するか(デバッグ時は false 推奨)
  headless: true,

  // タブ名の対応(日本語UI / 英語UI 両対応)
  tabs: {
    recommend: ['おすすめ', 'For you', 'For You'],
    following: ['フォロー中', 'Following'],
  },
};
