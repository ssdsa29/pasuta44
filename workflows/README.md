# ワークフローの用意

`scripts/generate.py` は、ここに置いた **ComfyUIのAPI式JSON** を読み込んで生成します。

**`krea2-t2i-api.json` は検証済みのものを同梱済み**（2026-08-29、ComfyUI v0.34.0で動作確認）。
ComfyUI公式のKrea 2 Turboテンプレート（Comfy-Org/workflow_templates の
`image_krea2_turbo_t2i.json`）からコア生成パスのみを抜き出したもの:
UNETLoader → CLIPTextEncode(positive) → KSampler(steps=8, cfg=1, euler, simple)
→ VAEDecode → SaveImage。負側条件はConditioningZeroOut（Negative Prompt不使用）。
LoRAやLLMによるPrompt拡張ノードは含まない（拡張はClaude側で行うため）。

ノード構成を変えたい場合（LoRA追加等）は、以下の手順で自分のComfyUIから
書き出したものに差し替えてください。

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
