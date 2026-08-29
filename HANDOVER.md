# 引継ぎ: Krea 2 エージェント駆動画像生成のローカル検証

作成日: 2026-08-29 / 作成: Claude Code（リモートセッション）
ローカルでこのリポジトリを開いたClaude Code（または人間）向けの引継ぎ文書。

## 目的

テクノエッジ連載第73回（西川和久氏、2026/08/27）の手法の再現。
日本語キーワードを投げるだけで、Krea 2用に最適化した英語Promptの生成から
ComfyUI API経由の画像生成・結果確認までを一気通貫で行えるようにする。

記事: https://www.techno-edge.net/article/2026/08/27/5429.html

## 現在の状態（済んでいること）

ブランチ `claude/image-generation-implementation-fbrlsv`（コミット 725fdf7）に一式push済み。

- `docs/krea2-prompting-guide.md` — Krea 2公式Promptガイドの要約md。
  公式リポジトリ https://github.com/krea-ai/krea-2 の docs/prompting.md と READMEから
  2026-08-29 に取得・整理したもの。Prompt作成時は必ずこれを参照する運用（CLAUDE.mdに記載済み）
- `docs/krea2-system-prompt.txt` — 公式expansion.txtの原文。LM StudioやComfyUIの
  LLMノードに貼る用（記事の「その1」方式）。エージェント運用では通常使わない
- `.claude/skills/krea2-prompt/SKILL.md` — 日本語キーワード→英語Prompt生成Skill
- `.claude/skills/krea2-generate/SKILL.md` — ComfyUI APIで生成→Vision確認→リトライのSkill
- `scripts/generate.py` — ComfyUI API呼び出し（Python標準ライブラリのみ、依存なし）。
  構文チェックとpatch_workflow（Prompt/width/height/seed差し替えロジック）の単体テストは実施済み。
  **実際のComfyUIサーバーに対する疎通・生成テストは未実施**（リモート環境からは届かないため）
- `prompts/`（Prompt保存先）、`outputs/`（画像出力先、gitignore済み）

## 残作業（ローカルでやること）

1. **ComfyUI + Krea 2 Turbo の準備**
   - モデル: Hugging Face `krea/Krea-2-Turbo`（推奨設定 steps=8 / cfg=0.0 / mu=1.15、1k〜2k解像度）
   - ComfyUIでKrea 2のt2iワークフローを組み、普通に1枚生成できることを確認
2. **ワークフローJSONの配置**（詳細手順は `workflows/README.md`）
   - ComfyUIの設定でDevモードを有効化 → 「Export (API)」でJSON書き出し
   - `workflows/krea2-t2i-api.json` として保存
   - ポジティブ側のTextEncodeノードのタイトルをComfyUI上で「positive」にしておくと確実
   - SaveImageノードが必要（Previewのみだと画像を取得できない）
3. **接続先の設定**
   - ComfyUIが同一マシンならデフォルト（`http://127.0.0.1:8188`）でOK
   - 別マシンなら `export COMFYUI_SERVER=http://<IP>:8188`
4. **疎通テスト**
   ```bash
   python3 scripts/generate.py --prompt "a red apple on a wooden table, soft window light" --width 1024 --height 1024
   ```
   `outputs/` にPNGが保存されれば成功
5. **本番の使い方**: Claude Codeに日本語で指示するだけ
   - 「夏、日本人美女、花火 これで1枚生成して」→ krea2-prompt → krea2-generate が発動
   - 「衣装を赤に」「背景を夜景に」などの差分指示にも対応
   - グラビア縦構図のデフォルトは 1024x1536。記事同様の掲載用なら長辺1920px指定

## 既知の注意点・ハマりどころ

- `generate.py` はUI用フォーマットのJSONを渡すとエラーメッセージを出して止まる仕様。
  必ず「Export (API)」のJSONを使うこと
- width/height差し替えは「widthとheight両方の入力を持つ最初に見つかったノード」全部に適用される。
  Krea 2用カスタムノードが独自の解像度指定を持つ場合は `patch_workflow()` の調整が必要かもしれない
  （ここが未検証部分の本丸。動かなければノード構成のJSONを見て合わせる）
- seedは `seed` / `noise_seed` を持つ全ノードで毎回ランダム化される。固定したい場合は要改修
- history APIのポーリングは2秒間隔・タイムアウトなし。生成が長い場合はそのまま待つ
- Krea 2はNegative Prompt不要（Turboはcfg=0）。ガイド要約md参照
- LoRAを使う場合: 公式推奨は「RAWで学習してTurboに適用」。ワークフローに
  LoRAローダーを入れてExportし直せば、generate.py側の変更は不要のはず

## 検証で確認してほしいこと（成功基準）

1. 疎通テストのPromptで画像が `outputs/` に保存される
2. 日本語キーワード指示だけで、Prompt生成→保存（prompts/）→生成→画像確認まで自動で回る
3. 生成画像がPromptの意図（主題・衣装・背景・構図）と一致している
4. 差分指示（「衣装を赤に」等）で前回Promptからの派生が正しく動く

問題があれば `scripts/generate.py` と `workflows/README.md` を直し、このファイルの
「既知の注意点」を更新してcommitすること。
