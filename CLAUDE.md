# このリポジトリについて

テクノエッジ連載第73回（西川和久氏）の手法を再現した、エージェント駆動の
Krea 2画像生成環境。日本語キーワード → 最適化Prompt → ComfyUI APIで生成、
までを一気通貫で行う。

## ルール

- **Krea 2のPromptを作るときは、必ず先に `docs/krea2-prompting-guide.md` を読むこと。**
- Prompt作成は `.claude/skills/krea2-prompt/SKILL.md` の手順に従う。
- 画像生成は `.claude/skills/krea2-generate/SKILL.md` の手順に従う
  （`scripts/generate.py` でComfyUI APIを叩く）。
- 使ったPromptは `prompts/` に必ず保存する（元の日本語指示も一緒に）。
- ComfyUIサーバーの接続先は環境変数 `COMFYUI_SERVER`（デフォルト `http://127.0.0.1:8188`）。
- 生成画像は `outputs/` に保存される。生成後は画像を開いて意図どおりか確認する。
