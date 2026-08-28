# ワークフローの用意

`scripts/generate.py` は、ここに置いた **ComfyUIのAPI式JSON** を読み込んで生成します。
ノード構成は環境（使うカスタムノードやLoRA）によって違うので、自分のComfyUIから
書き出したものを置いてください。

## 手順

1. ComfyUIでKrea 2の画像生成が普通にできるワークフローを組む
   （ComfyUI公式のKrea 2テンプレートがあればそれをベースにするのが早い。
   モデルは Krea 2 **Turbo** 推奨: steps=8, cfg=0.0, mu=1.15）。
2. 設定 → 「開発者モード（Dev mode）」を有効にする。
3. メニューの **「Export (API)」（API用フォーマットで保存）** でJSONを書き出す。
4. `workflows/krea2-t2i-api.json` という名前でここに保存する。

## generate.py が差し替える場所

- **Prompt**: `_meta.title` に `positive` を含む TextEncode ノード。
  見つからなければ最初の TextEncode ノード。ポジティブ側のノードのタイトルを
  ComfyUI上で「positive」にリネームしておくと確実です。
- **width / height**: `width` と `height` 入力を持つノード（EmptyLatentImage等）。
- **seed**: `seed` / `noise_seed` 入力を持つノードすべて（毎回ランダム）。

保存には SaveImage ノードが必要です（Preview だけだと画像を取得できません）。
