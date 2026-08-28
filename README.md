# krea2-agent-setup

テクノエッジ連載「生成AIグラビアをグラビアカメラマンが作るとどうなる？第73回」
（西川和久氏、2026/08/27）で紹介されていた **エージェント駆動の画像生成** を、
Claude Codeでそのまま使える形にしたセットアップ。

記事: https://www.techno-edge.net/article/2026/08/27/5429.html

「夏、日本人美女、祭り これをKrea 2用のPromptへ」のような日本語キーワードを
Claude Codeに投げるだけで、Krea 2公式ガイドに沿った英語Promptの生成から、
ComfyUI API経由の画像生成・結果確認までを一気通貫で行う。

## 構成

| パス | 役割 |
|---|---|
| `docs/krea2-prompting-guide.md` | Krea 2公式Promptガイドの要約md（記事の「その2」に相当） |
| `docs/krea2-system-prompt.txt` | 公式のPrompt展開用System Prompt（記事の「その1」用。LM Studio等にコピペ） |
| `.claude/skills/krea2-prompt/` | 日本語キーワード→Krea 2用Promptを作るSkill |
| `.claude/skills/krea2-generate/` | ComfyUI APIで生成→画像確認まで行うSkill |
| `scripts/generate.py` | ComfyUI API呼び出しスクリプト（標準ライブラリのみ） |
| `workflows/` | ComfyUIのAPI式ワークフローJSONを置く場所（手順は中のREADME） |
| `prompts/` | 生成に使ったPromptの保存先（管理・派生用） |
| `outputs/` | 生成画像の保存先 |

## 必要なもの

1. **ComfyUI + Krea 2 Turbo** が動くマシン（要GPU。モデルはHugging Faceの
   `krea/Krea-2-Turbo`。steps=8 / cfg=0 で1k〜2k解像度）
2. **Claude Code**（ローカルで、ComfyUIに届くネットワークから起動する）

## セットアップ

```bash
# 1. ComfyUIでKrea 2のワークフローを組み、API式JSONで書き出して配置
#    （詳細は workflows/README.md）
cp <書き出したJSON> workflows/krea2-t2i-api.json

# 2. ComfyUIサーバーの場所を指定（デフォルトは http://127.0.0.1:8188）
export COMFYUI_SERVER=http://192.168.1.10:8188

# 3. このリポジトリでClaude Codeを起動して、日本語で指示するだけ
claude
> 夏、日本人美女、花火 これで1枚生成して
> 衣装を赤に
> 背景を夜景に
```

ComfyUIを使わない場合でも、Prompt作成だけなら
「◯◯◯ これをKrea 2用のPromptへ」でSkillが動く。できたPromptを
Krea公式サイトやfal.aiに貼れば生成できる。
