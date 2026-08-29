# 高品質パイプライン（実測メモ）

RTX 5070 Ti 16GB / RAM 32GB / ComfyUI v0.34.0 での実測値。すべて検証済み。

## ワークフロー一覧

| ファイル | 用途 | 出力解像度 | 所要 |
|---|---|---|---|
| `krea2-t2i-api.json` | 基本のt2i | 指定どおり | 16秒 @1024x1536 / 31秒 @1408x2112 |
| `krea2-hq-api.json` | 2K生成→4倍→refine | 入力の2倍 | 297秒 @2816x4224 |
| `krea2-img-refine-api.json` | 既存画像の高解像度化・質感振り直し | 入力の2倍 | 約200秒 |
| `krea2-face-refine-api.json` | 顔だけを検出してリファイン | 入力と同じ | 226秒 @2816x4224 |
| `hunyuan15-i2v-api.json` | 画像→動画（HunyuanVideo 1.5） | 720x1280 | 未実測 |

## 高品質パイプラインの構成

```
Krea 2 Turbo で 1408x2112 生成（8steps, cfg=1, euler/simple）
  → 4x-UltraSharpV2 で4倍（5632x8448）
  → lanczos で0.5倍（2816x4224）★4倍→半分が重要。いきなり2倍より自然
  → VAEEncodeTiled（tile 512 / overlap 64）
  → KSampler denoise 0.30, steps 8（構図を保ったまま質感を足す）
  → VAEDecodeTiled
```

**ポイント**

- ComfyUIでは denoise を下げてもステップ数は減らない（A1111とは挙動が違う）。
  `steps` はそのまま実行される。denoise 0.3 だから steps を増やす、という補正は不要
- latent upscale は使わない。蒸留モデル + cfg=1 では顔が別人化しやすい。
  必ずピクセル空間（ImageUpscaleWithModel → VAEEncode）を通す
- 1パスあたり2倍まで。それ以上を一度にやると構図の反復（顔や手の重複）が出る
- 2048px超では VAEEncodeTiled / VAEDecodeTiled が必須（非tiledはVRAM不足になる）

## アップスケーラー

`models/upscale_models/` に配置済み:

- `4x-UltraSharpV2.safetensors`（DAT2, 133MB）— 実写ポートレートの本命
- `4xFaceUpDAT.safetensors`（DAT, 147MB）— 顔が画面の大半を占める場合

注意: spandrel の core が対応するアーキテクチャのみ読める。**SRFormer系は読めない**
（`spandrel_extra_arches` を別途 pip install しない限り）。DAT / SPAN / RealPLKSR /
HAT / SwinIR / ESRGAN は core 対応なので問題ない。

## 顔リファイン（MediaPipe）

ComfyUI v0.34.0 のコアに顔検出が入っている（カスタムノード不要）:
`LoadMediaPipeFaceLandmarker` → `MediaPipeFaceLandmarker` → `MediaPipeFaceMask`
→ `GrowMask` → `FeatherMask` → `SetLatentNoiseMask` → `KSampler`

検出モデルは `models/detection/mediapipe_face_fp32.safetensors`（5.2MB、
`Comfy-Org/mediapipe` から取得）。`regions` は `"all"` を渡せば通る。

ADetailer/FaceDetailer のような「顔を切り出して拡大してから戻す」処理は
コアだけでは組めない（BoundingBoxをx/y intに分解するノードが無い）。
マスク経由のインペイント方式なら完全自動で動く。

## 「AI臭さ」を消す

原因は生成条件側にある。以下を避ける:

- スタジオ均一光 → **片側からの窓光・曇天光**にする
- 無地のシームレス背景 → 質感のある壁、実在の場所
- 完全な無表情 → わずかな半笑い、視線を外す
- 均一な肌 → **毛穴・色ムラ・鼻まわりの赤み・小さなシミ・無修正**を明示
- 整いすぎた髪 → **後れ毛**を数本指定
- 完全な左右対称 → `natural slight asymmetry` を入れる
- カメラの指定なし → **35mm film, Kodak Portra 400, film grain, halation,
  fast prime lens, slightly imperfect off-center framing**

既存画像に対しては `krea2-img-refine-api.json` を denoise 0.30〜0.55 で適用する。
**0.42前後が最もバランスが良い**（0.30は毛穴が出すぎてざらつく、0.55は顔が変わり始める）。
`--denoise` で上書きできる。

## 動画（HunyuanVideo 1.5）

`models/` に配置済み:

| ファイル | サイズ | 配置先 |
|---|---|---|
| `hunyuanvideo1.5_720p_i2v_cfg_distilled_fp8_scaled.safetensors` | 8.3GB | `diffusion_models/` |
| `hunyuanvideo1.5_1080p_sr_distilled_fp8_scaled.safetensors` | 8.3GB | `diffusion_models/` |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | 9.4GB | `text_encoders/` |
| `byt5_small_glyphxl_fp16.safetensors` | 0.44GB | `text_encoders/` |
| `hunyuanvideo15_vae_fp16.safetensors` | 2.5GB | `vae/` |
| `sigclip_vision_patch14_384.safetensors` | 0.86GB | `clip_vision/` |
| `hunyuanvideo15_latent_upsampler_1080p.safetensors` | 0.2GB | `latent_upscale_models/` |

制約: **1回の生成は最大121フレーム（24fpsで約5秒）**。長尺は複数カットを繋ぐ。
`--length` は 4n+1、`--width`/`--height` は16の倍数。

蒸留版なので cfg=1。shift は 720p i2v で 7。

**ライセンス注意**: HunyuanVideo は商用利用に制限がある。公開・収益化するなら
Wan 2.1 / 2.2（Apache-2.0）に切り替えること。

## 使い方

```bash
# 通常生成
python scripts/generate.py --prompt "..." --width 1024 --height 1536

# 高品質（2K → 2816x4224）
python scripts/generate.py --workflow workflows/krea2-hq-api.json --prompt "..." --width 1408 --height 2112

# 既存画像の質感振り直し
python scripts/generate.py --workflow workflows/krea2-img-refine-api.json --image outputs/foo.png --denoise 0.42 --prompt "..."

# 顔だけリファイン
python scripts/generate.py --workflow workflows/krea2-face-refine-api.json --image outputs/foo.png --prompt "..."

# 画像→動画
python scripts/generate_video.py --image outputs/foo.png --prompt "gentle camera push-in" --length 49
```
