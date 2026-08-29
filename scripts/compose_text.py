#!/usr/bin/env python3
r"""生成画像の看板・掲示に、実フォントで日本語テキストを合成する。

Krea 2 は日本語の漢字を安定して描けない（4文字でも崩れる）。
そのため「無地の看板」を生成し、後から実フォントで文字を焼き込む。

使い方:
    python scripts/compose_text.py --image outputs/keyframes/C08.png \
        --text 青梅西署 --box 300,150,120,700 --vertical

    --box は x,y,幅,高さ（元画像のピクセル座標）
    --vertical で縦書き。省略すると横書き
    --preview を付けると合成位置に赤枠を描いた確認用画像も出す
"""

import argparse
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow が必要です: pip install pillow")

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\BIZ-UDGothicB.ttc",
    r"C:\Windows\Fonts\YuGothB.ttc",
    r"C:\Windows\Fonts\msgothic.ttc",
    r"C:\Windows\Fonts\meiryob.ttc",
]


def pick_font(path=None):
    for p in ([path] if path else []) + FONT_CANDIDATES:
        if p and os.path.isfile(p):
            return p
    sys.exit("日本語フォントが見つかりません。--font で指定してください。")


def fit_size(font_path, text, box_w, box_h, vertical):
    """箱に収まる最大のフォントサイズを二分探索で求める。"""
    lo, hi, best = 8, max(box_w, box_h) * 2, 8
    n = len(text)
    while lo <= hi:
        mid = (lo + hi) // 2
        f = ImageFont.truetype(font_path, mid)
        if vertical:
            # 縦書きは1文字の高さ x 文字数
            a, b, c, d = f.getbbox("国")
            w, h = (c - a), (d - b) * n
        else:
            a, b, c, d = f.getbbox(text)
            w, h = (c - a), (d - b)
        if w <= box_w and h <= box_h:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--box", required=True, help="x,y,幅,高さ")
    ap.add_argument("--vertical", action="store_true")
    ap.add_argument("--color", default="#141414")
    ap.add_argument("--font")
    ap.add_argument("--out")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    x, y, bw, bh = (int(v) for v in args.box.split(","))
    font_path = pick_font(args.font)
    size = fit_size(font_path, args.text, bw, bh, args.vertical)
    font = ImageFont.truetype(font_path, size)

    im = Image.open(args.image).convert("RGB")
    d = ImageDraw.Draw(im)

    if args.vertical:
        a, b, c, dd = font.getbbox("国")
        ch_h = dd - b
        gap = (bh - ch_h * len(args.text)) / (len(args.text) + 1)
        for i, ch in enumerate(args.text):
            ca, cb, cc, cd = font.getbbox(ch)
            cx = x + (bw - (cc - ca)) / 2 - ca
            cy = y + gap * (i + 1) + ch_h * i - cb
            d.text((cx, cy), ch, font=font, fill=args.color)
    else:
        a, b, c, dd = font.getbbox(args.text)
        d.text((x + (bw - (c - a)) / 2 - a, y + (bh - (dd - b)) / 2 - b),
               args.text, font=font, fill=args.color)

    out = args.out or args.image
    im.save(out)
    print(f"合成: {args.text}  font={os.path.basename(font_path)} size={size}  -> {out}")

    if args.preview:
        pv = Image.open(args.image).convert("RGB")
        ImageDraw.Draw(pv).rectangle([x, y, x + bw, y + bh], outline="red", width=6)
        p = os.path.splitext(out)[0] + "_box.png"
        pv.save(p)
        print(f"確認用: {p}")


if __name__ == "__main__":
    main()
