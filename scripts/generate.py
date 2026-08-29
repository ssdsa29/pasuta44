#!/usr/bin/env python3
"""ComfyUI API経由でKrea 2画像生成を実行する。

使い方:
    python3 scripts/generate.py --prompt "英語のPrompt" [--width 1024] [--height 1536]
        [--workflow workflows/krea2-t2i-api.json] [--server http://127.0.0.1:8188]
        [--out outputs]

前提: ComfyUIで動くKrea 2用ワークフローを「API用フォーマットで保存」した
JSONを workflows/ に置いておくこと。プロンプトはタイトルに "positive" を含む
CLIPTextEncode系ノード（無ければ最初のCLIPTextEncode）、width/heightは
それらの入力を持つ最初のノード、seedは毎回ランダムに差し替える。
標準ライブラリのみ使用。
"""

import argparse
import json
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
        sys.exit(
            f"エラー: {path} はUI用フォーマットです。ComfyUIのメニューから"
            "「Export (API)」/「API用フォーマットで保存」で書き出したJSONを使ってください。"
        )
    return wf


def patch_workflow(wf, prompt, width, height, image_name=None, denoise=None):
    text_nodes = []
    for node_id, node in wf.items():
        cls = node.get("class_type", "")
        inputs = node.get("inputs", {})
        title = node.get("_meta", {}).get("title", "").lower()
        if "text" in inputs and "TextEncode" in cls:
            text_nodes.append((node_id, node, title))
        if cls == "LoadImage" and image_name:
            inputs["image"] = image_name
        if denoise is not None and inputs.get("denoise", 1.0) < 1.0:
            inputs["denoise"] = denoise
        if "width" in inputs and "height" in inputs:
            inputs["width"] = width
            inputs["height"] = height
        for key in ("seed", "noise_seed"):
            if key in inputs:
                inputs[key] = random.randint(0, 2**32 - 1)

    if not text_nodes:
        sys.exit("エラー: ワークフロー内にプロンプト入力ノード(TextEncode)が見つかりません。")
    target = next(
        (n for n in text_nodes if "positive" in n[2]),
        next((n for n in text_nodes if "negative" not in n[2]), text_nodes[0]),
    )
    target[1]["inputs"]["text"] = prompt
    return wf


def api(server, path, data=None):
    req = urllib.request.Request(
        server + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        return json.loads(res.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1536)
    ap.add_argument("--workflow", default="workflows/krea2-t2i-api.json")
    ap.add_argument("--server", default=DEFAULT_SERVER)
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--image", help="LoadImageノードに渡す入力画像（face-refine等で使用）")
    ap.add_argument(
        "--denoise", type=float,
        help="refine系ワークフローのKSampler denoiseを上書き（1.0未満のノードのみ対象）",
    )
    args = ap.parse_args()

    image_name = None
    if args.image:
        src = os.path.abspath(args.image)
        if not os.path.isfile(src):
            sys.exit(f"エラー: 画像が見つかりません: {src}")
        os.makedirs(DEFAULT_INPUT_DIR, exist_ok=True)
        image_name = os.path.basename(src)
        dest = os.path.join(DEFAULT_INPUT_DIR, image_name)
        if os.path.abspath(dest) != src:
            shutil.copyfile(src, dest)
        print(f"input image: {image_name}")

    wf = patch_workflow(
        load_workflow(args.workflow), args.prompt, args.width, args.height,
        image_name, args.denoise,
    )

    client_id = str(uuid.uuid4())
    res = api(args.server, "/prompt", {"prompt": wf, "client_id": client_id})
    prompt_id = res["prompt_id"]
    print(f"queued: {prompt_id}")

    while True:
        time.sleep(2)
        history = api(args.server, f"/history/{prompt_id}")
        if prompt_id in history:
            break
    entry = history[prompt_id]
    status = entry.get("status", {})
    if status.get("status_str") == "error":
        sys.exit(f"生成エラー: {json.dumps(status, ensure_ascii=False)[:2000]}")

    os.makedirs(args.out, exist_ok=True)
    saved = []
    for output in entry.get("outputs", {}).values():
        for img in output.get("images", []):
            if img.get("type") == "temp":
                continue
            q = urllib.parse.urlencode(
                {"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img["type"]}
            )
            dest = os.path.join(args.out, img["filename"])
            with urllib.request.urlopen(f"{args.server}/view?{q}", timeout=300) as r, open(dest, "wb") as f:
                f.write(r.read())
            saved.append(dest)
            print(f"saved: {dest}")
    if not saved:
        sys.exit("画像出力が見つかりませんでした。ワークフローにSaveImageノードがあるか確認してください。")


if __name__ == "__main__":
    main()
