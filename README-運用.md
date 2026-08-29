# 日常の操作

デスクトップから使う場合は、このフォルダの `.bat` をダブルクリックする。

| ファイル | 動作 |
|---|---|
| **start.bat** | ComfyUI を起動する（約50秒）。作業を始めるとき |
| **stop.bat** | ComfyUI を停止する。処理中なら確認を出す |
| **status.bat** | サーバーの状態と制作の進捗をまとめて表示 |
| **preview.bat** | 生成済み動画を連結して再生する |

## PCを再起動・シャットダウンするとき

1. `status.bat` で「実行中 0 / 待機 0」を確認する
2. `stop.bat` を実行する
3. 再起動する

**処理が動いている場合は `stop.bat` が確認を出す。** そのまま止めると
生成中のカットは失われるが、完了済みのカットは全て残る。
中断しても `batch_videos.py` は生成済みをスキップするので、
次回 start してから同じコマンドを実行すれば続きから再開できる。

## 保存されるもの／されないもの

**残る（ディスク上）**
- 生成した動画 `outputs/videos/`
- キーフレーム `outputs/keyframes/`
- 台本・仕様書・スクリプト（gitでコミット済み）
- ダウンロードしたモデル（ComfyUI 側）

**失われる（メモリ上）**
- ComfyUI がVRAMに読み込んだモデル → 次回起動時に読み直すだけ
- キューに入っていた未処理のジョブ → 再実行すればよい

つまり **ComfyUI はいつ落としても状態を失わない。**

## 作業を再開する手順

```
start.bat をダブルクリック
   ↓ 50秒待つ
status.bat で進捗を確認
   ↓
続きのコマンドを実行
```

## よく使うコマンド

プロジェクトフォルダで実行する（`cd C:\claud\krea2`）。

```bash
# 進捗
python scripts/status.py
python scripts/status.py --watch      # 15秒ごとに自動更新

# キーフレーム生成
python scripts/batch_keyframes.py --np-only     # 人物なしカット
python scripts/batch_keyframes.py --cuts C05,C06

# 動画生成
python scripts/batch_videos.py --ready          # キーフレームがある全部
python scripts/batch_videos.py --cuts C05

# プレビュー
python scripts/preview.py
python scripts/preview.py --act 1               # 第1幕だけ

# 看板などに文字を焼き込む
python scripts/compose_text.py --image outputs/keyframes/C08.png \
    --text 青梅西署 --box 428,575,168,610 --vertical --preview
```

どのフォルダから実行しても動く（スクリプトが自動でプロジェクトルートに移動する）。
