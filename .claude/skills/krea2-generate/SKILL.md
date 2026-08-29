---
name: krea2-generate
description: Krea 2でComfyUI API経由の画像生成を実行する。「生成して」「画像にして」「〜の画像を作って」と言われたら、krea2-promptでPromptを作った上でこのスキルで生成する。
---

# Krea 2 画像生成（ComfyUI API）

前提:
- ComfyUIサーバーが起動していること。接続先は環境変数 `COMFYUI_SERVER`
  （未設定なら `http://127.0.0.1:8188`）。
- `workflows/krea2-t2i-api.json` にKrea 2用ワークフロー（API式JSON）があること。
  無ければ `workflows/README.md` の手順をユーザーに案内する。

手順:
1. Promptがまだ無ければ、先に krea2-prompt スキルの手順で作る。
2. 生成を実行する:
   ```
   python scripts/generate.py --prompt "<英語Prompt>" --width 1024 --height 1536
   ```
   （Windowsでは `python3` はStoreスタブに化けることがあるため `python` を使う。
   通らなければフルパス `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`）
   デフォルトはグラビア縦構図の 1024x1536。ユーザー指定があればそれに従う
   （長辺1920pxなど。16の倍数に丸める。上限2048）。
3. 出力は `outputs/` に保存される。生成した画像ファイルをReadで開いて内容を確認し、
   Promptの意図（主題・衣装・背景・構図）と合っているかチェックする。
4. 意図と違う場合はPromptを修正して再生成（リトライは2回まで。それ以上はユーザーに相談）。
5. 最終的に使ったPromptを `prompts/` に保存し、画像パスとともにユーザーへ報告する。
