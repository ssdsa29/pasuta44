// 実行中の処理を「中止」するための共有フラグ。
// 長い処理(収集・フォロー)はループの区切りで isCancelled() を見て、
// 中止が要求されていれば、そこまでの結果を保存して安全に抜けます。
let cancelled = false;

export function requestCancel() {
  cancelled = true;
}

export function resetCancel() {
  cancelled = false;
}

export function isCancelled() {
  return cancelled;
}
