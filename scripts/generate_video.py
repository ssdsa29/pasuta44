#!/usr/bin/env python3
"""ComfyUI API経由でHunyuanVideo 1.5の画像→動画生成を実行する。

使い方:
    python scripts/generate_video.py --image outputs/krea2_00004_.png \
        --prompt "gentle camera push-in, she slowly looks up" \
        [--width 720] [--height 1280] [--length 49] [--steps 20] [--fps 24]
        [--workflow workflows/hunyuan15-i2v-api.json] [--out outputs]

起点画像はComfyUIのinputフォルダへコピーしてから渡す（ComfyUIが同一マシンで
動いている前提）。別マシンのサーバーを使う場合は --upload を付けるとAPI経由で
アップロードする。標準ライブラリのみ使用。
"""

import argparse
import json
import mimetypes
import os
import random
import shutil
import sys
import time
import urllib.parse
import urllib.request
import uuid

DEFAULT_SERVER = os.environ.get("COMFYUI_SERVER", "http://127.0.0.1:8188")
DEFAULT_INPUT_DIR = os.environ.get(
    "COMFYUI_INPUT_DIR", r"C:\claud\ComfyUI_windows_portable\ComfyUI\input"
)


def load_workflow(path):
    with open(path, encoding="utf-8") as f:
        wf = json.load(f)
    if "nodes" in wf:
        sys.exit(f"エラー: {path} はUI用フォーマットです。API式JSONを使ってください。")
    return wf


def upload_image(server, path):
    """ComfyUIの /upload/image へmultipartでPOSTし、サーバー側のファイル名を返す。"""
    name = os.path.basename(path)
    boundary = "----comfyui" + uuid.uuid4().hex
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        data = f.read()
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'.encode(),
        f"Content-Type: {ctype}\r\n\r\n".encode(),
        data,
        f"\r\n--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n',
        f"--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        server + "/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        return json.loads(res.read())["name"]


def patch_workflow(wf, image_name, prompt, width, height, length, steps, fps):
    for node in wf.values():
        cls = node.get("class_type", "")
        inputs = node.get("inputs", {})
        title = node.get("_meta", {}).get("title", "").lower()

        if cls == "LoadImage":
            inputs["image"] = image_name
        if cls == "CLIPTextEncode" and "positive" in title:
            inputs["text"] = prompt
        if "width" in inputs and "height" in inputs:
            if cls == "HunyuanVideo15LatentUpscaleWithModel":
                # 超解像の出力解像度。基準の1.5倍（8の倍数に丸める）
                inputs["width"] = (int(width * 1.5) // 8) * 8
                inputs["height"] = (int(height * 1.5) // 8) * 8
            else:
                inputs["width"] = width
                inputs["height"] = height
        if "length" in inputs:
            inputs["length"] = length
        if cls == "BasicScheduler" and "steps" in inputs:
            # 超解像側のスケジューラは公式既定(8step)のまま
            if "sr" not in title:
                inputs["steps"] = steps
        if cls == "CreateVideo" and "fps" in inputs:
            inputs["fps"] = fps
        for key in ("seed", "noise_seed"):
            if key in inputs:
                inputs[key] = random.randint(0, 2**32 - 1)
    return wf


def api(server, path, data=None):
    req = urllib.request.Request(
        server + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    with urllib.request.urlopen(req, timeout=600) as res:
        return json.loads(res.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True, help="起点画像のパス")
    ap.add_argument("--prompt", required=True, help="動きの英語Prompt")
    ap.add_argument("--width", type=int, default=720)
    ap.add_argument("--height", type=int, default=1280)
    ap.add_argument("--length", type=int, default=49, help="フレーム数。4の倍数+1")
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--fps", type=float, default=24)
    ap.add_argument("--workflow", default="workflows/hunyuan15-i2v-api.json")
    ap.add_argument("--server", default=DEFAULT_SERVER)
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--upload", action="store_true", help="APIでアップロード（別マシン用）")
    args = ap.parse_args()

    if args.length % 4 != 1:
        sys.exit(f"エラー: --length は 4n+1 である必要があります（例 33, 49, 121）。指定値: {args.length}")
    for name, v in (("width", args.width), ("height", args.height)):
        if v % 16 != 0:
            sys.exit(f"エラー: --{name} は16の倍数である必要があります。指定値: {v}")

    src = os.path.abspath(args.image)
    if not os.path.isfile(src):
        sys.exit(f"エラー: 画像が見つかりません: {src}")

    if args.upload:
        image_name = upload_image(args.server, src)
    else:
        os.makedirs(DEFAULT_INPUT_DIR, exist_ok=True)
        image_name = os.path.basename(src)
        dest = os.path.join(DEFAULT_INPUT_DIR, image_name)
        if os.path.abspath(dest) != src:
            shutil.copyfile(src, dest)
    print(f"start image: {image_name}")

    wf = patch_workflow(
        load_workflow(args.workflow), image_name, args.prompt,
        args.width, args.height, args.length, args.steps, args.fps,
    )

    res = api(args.server, "/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
    prompt_id = res["prompt_id"]
    print(f"queued: {prompt_id}  ({args.width}x{args.height}, {args.length}frames, {args.steps}steps)")

    while True:
        time.sleep(5)
        history = api(args.server, f"/history/{prompt_id}")
        if prompt_id in history:
            break
    entry = history[prompt_id]
    status = entry.get("status", {})
    if status.get("status_str") == "error":
        sys.exit(f"生成エラー: {json.dumps(status, ensure_ascii=False)[:3000]}")

    os.makedirs(args.out, exist_ok=True)
    saved = []
    for output in entry.get("outputs", {}).values():
        for item in output.get("videos", []) + output.get("images", []):
            if item.get("type") == "temp":
                continue
            q = urllib.parse.urlencode({
                "filename": item["filename"],
                "subfolder": item.get("subfolder", ""),
                "type": item["type"],
            })
            dest = os.path.join(args.out, os.path.basename(item["filename"]))
            with urllib.request.urlopen(f"{args.server}/view?{q}", timeout=600) as r, \
                    open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            saved.append(dest)
            print(f"saved: {dest}")
    if not saved:
        sys.exit("出力が見つかりませんでした。ワークフローにSaveVideoノードがあるか確認してください。")


if __name__ == "__main__":
    main()
