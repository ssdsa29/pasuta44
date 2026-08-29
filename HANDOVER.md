# 引継ぎ: Krea 2 エージェント駆動画像生成のローカル検証

作成日: 2026-08-29 / 作成: Claude Code（リモートセッション）
**2026-08-29 ローカル検証完了**（Claude Code ローカルセッションにて全成功基準クリア）

## 目的

テクノエッジ連載第73回（西川和久氏、2026/08/27）の手法の再現。
日本語キーワードを投げるだけで、Krea 2用に最適化した英語Promptの生成から
ComfyUI API経由の画像生成・結果確認までを一気通貫で行えるようにする。

記事: https://www.techno-edge.net/article/2026/08/27/5429.html

## 検証結果（2026-08-29、すべて成功）

| # | 成功基準 | 結果 |
|---|---|---|
| 1 | 疎通テスト（赤いリンゴ）で画像が `outputs/` に保存される | ✅ `krea2_00001_.png` Promptどおり |
| 2 | 日本語キーワード→Prompt生成→保存→生成→確認が自動で回る | ✅ 「夏、日本人美女、花火」→ `krea2_00002_.png` |
| 3 | 生成画像がPromptの意図と一致 | ✅ 浴衣・団扇・花火・提灯・縦構図すべて一致 |
| 4 | 差分指示（「衣装を赤に」）で派生が正しく動く | ✅ 衣装のみ変化、他要素保持（`krea2_00003_.png`） |

生成速度: 1024x1536 / 8 steps で**約16秒/枚**（RTX 5070 Ti 16GB、初回ロード込みでも約20秒）。

## ローカル環境の構成（このマシンに導入済み）

- **ComfyUI**: portable v0.34.0 を `C:\claud\ComfyUI_windows_portable\` に展開
  （PyTorch 2.13.0+cu130、RTX 5070 Ti対応）。
  起動は `run_nvidia_gpu.bat`、またはClaude Codeからは `.claude/launch.json` の
  `comfyui` 設定（preview_start）で起動できる
- **モデル**（`ComfyUI\models\` 配下に配置済み、Comfy-Org/Krea-2 より取得）:
  - `diffusion_models/krea2_turbo_fp8_scaled.safetensors`（12.2GB）
  - `text_encoders/qwen3vl_4b_fp8_scaled.safetensors`（4.9GB）
  - `vae/qwen_image_vae.safetensors`（0.2GB）
- **Python**: 3.12.10（winget導入、`%LOCALAPPDATA%\Programs\Python\Python312`）。
  Windowsでは `python3` がStoreスタブに化けるため **`python`** を使うこと（Skillも修正済み）
- **ワークフロー**: `workflows/krea2-t2i-api.json` を同梱済み。UIからのExport (API)は不要
  （ComfyUI公式テンプレートのコア生成パスを抜き出して作成、動作検証済み。
  詳細は `workflows/README.md`）

## 本番の使い方

ComfyUIを起動した状態で、Claude Codeに日本語で指示するだけ:
- 「夏、日本人美女、花火 これで1枚生成して」→ krea2-prompt → krea2-generate が発動
- 「衣装を赤に」「背景を夜景に」などの差分指示にも対応
- グラビア縦構図のデフォルトは 1024x1536。記事同様の掲載用なら長辺1920px指定
- 接続先変更は環境変数 `COMFYUI_SERVER`（デフォルト `http://127.0.0.1:8188`）

## 既知の注意点・ハマりどころ

- `generate.py` はUI用フォーマットのJSONを渡すとエラーメッセージを出して止まる仕様。
  API式JSON（同梱の `krea2-t2i-api.json` 形式）を使うこと
- KSamplerの設定は公式テンプレート準拠で **steps=8 / cfg=1 / euler / simple**。
  負側条件はConditioningZeroOutで、Negative Promptは使わない
  （記事のcfg=0.0とは表記が違うが、cfg=1+ZeroOutが公式テンプレートの構成）
- 潜在画像は公式テンプレートどおり `EmptyLatentImage` 直結でOK（16ch用の特殊ノード不要）
- width/height差し替えは「widthとheight両方の入力を持つノード」全部に適用される
  （同梱ワークフローではEmptyLatentImageのみが該当し、問題なし）
- seedは `seed` / `noise_seed` を持つ全ノードで毎回ランダム化される。固定したい場合は要改修
- history APIのポーリングは2秒間隔・タイムアウトなし。生成が長い場合はそのまま待つ
- LoRAを使う場合: 公式推奨は「RAWで学習してTurboに適用」。ワークフローに
  `LoraLoaderModelOnly` をUNETLoaderとKSamplerの間に挟めばよい（generate.py側の変更不要）。
  公式スタイルLoRA（darkbrush等）は Comfy-Org/Krea-2 の `loras/` にある
