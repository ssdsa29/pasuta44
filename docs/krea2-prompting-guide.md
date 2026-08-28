# Krea 2 Prompt作成ガイド（要約版）

公式ガイド（https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md ）と
README を整理したもの。**Krea 2 用の Prompt を作るときは必ずこのファイルを参照すること。**

## 基本ルール

- **自然文（英語）で書く**。SDXL 時代のキーワード区切り（`photo of, 20yo, smile,...`）ではなく、
  ひとつながりの英語の段落として書く。
- **長く詳細な Prompt ほど良い結果**が出る。ただし短い Prompt でも高品質に生成できる。
- **Negative Prompt は不要**（Turbo は CFG 無効で動くため）。
- **文字を画像内に描画したいときは、描画する単語を引用符 `"..."` で囲む**。
- 日本語 Prompt も一応通るが、品質を出すなら英語に展開する。

## Promptに含めるべき要素（この順で組み立てる）

1. **主題**: 誰/何が、何をしているか。人物なら外見・髪型・表情・視線・ポーズを具体的に
2. **服装・小物**: 色・素材・ディテールまで（例: structured black top, gold hoop earrings）
3. **背景・環境**: 場所、背景色、前景/後景の要素と空間関係
4. **ライティング**: soft directional studio lighting / cinematic sunlight / high-key lighting など
5. **構図・カメラ**: medium close-up / low angle portrait / shallow depth of field / macro lens など
6. **スタイル・質感**: film grain, cel-shaded, ligne claire, vintage print, 3D rendered matte など
7. **カラーパレット**: muted earthy palette / vibrant deep blue / solid crimson background など

## 展開時の禁則（公式 expansion ルールより）

- 元の指示にある主題・動作・色・位置関係は**必ず保持**する（勝手に別物にしない）
- ユーザーが示唆していない新しいオブジェクト・人物・動物を**追加しない**
- 服・素材・色を根拠なく過剰に specify しない
- ユーザーが medium を指定したら（photo of / illustration of 等）**その medium を守る**
- 出力は**1段落の英文のみ**。箇条書き・JSON・markdown にしない
- すでに詳細な Prompt が入力されたら、大改造せず軽く磨くだけにする

## 実写グラビア/ポートレート系のテンプレ例

公式サンプルより。この粒度・文体を真似る:

> A close-up portrait of a young East Asian woman with straight black hair, loose
> strands sweeping across her fair skin, and an intense gaze. She wears a light grey
> collared shirt with a black tie. A vibrant bouquet of pink and orange lilies sits in
> the blurred right foreground. The background is a solid, striking crimson red. Soft,
> directional studio lighting highlights her facial features, creating a high-contrast
> composition with a shallow depth of field.

> extreme close-up of a woman's face partially obscured by tousled dark brown hair,
> soft parted lips, cinematic warm lighting, muted earthy color palette, intimate
> portrait photography, macro lens, shallow depth of field, distinct film grain texture

## 推奨生成設定（README より）

| モデル | steps | cfg | 備考 |
|---|---|---|---|
| **Krea 2 Turbo**（推奨） | 8 | 0.0 | mu=1.15。1k〜2k 解像度対応。通常はこちら |
| Krea 2 RAW | 52 | 3.5 | 蒸留なしのベース。LoRA 学習用。最大 1k |

- 解像度は 1024〜2048。16 の倍数に切り上げられる
- LoRA は「RAW で学習して Turbo に適用」が公式推奨
- グラビア縦構図のデフォルトは width=1024 / height=1536（記事の設定に合わせる）
