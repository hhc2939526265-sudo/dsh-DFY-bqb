#!/usr/bin/env python3
# 二创加字 helper：用 Pillow 给底图加顶部/底部文字（中文可靠），输出新图。
# 用法: python caption_helper.py <input> <output> <top_text> <bottom_text>
import sys
from PIL import Image, ImageDraw, ImageFont


def load_font(size):
    for candidate in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_text_with_outline(draw, xy, text, font, anchor="mm"):
    x, y = xy
    # 黑色描边 + 白色填充，经典表情包字幕样式
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            if dx or dy:
                draw.text((x + dx, y + dy), text, font=font, fill=(0, 0, 0), anchor=anchor)
    draw.text((x, y), text, font=font, fill=(255, 255, 255), anchor=anchor)


def main():
    if len(sys.argv) != 5:
        print("usage: caption_helper.py <input> <output> <top> <bottom>", file=sys.stderr)
        return 2
    src, dst, top, bottom = sys.argv[1:5]
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    # 动图只处理首帧，避免生成多帧失败
    if getattr(img, "is_animated", False):
        img = img.convert("RGBA")
    font = load_font(max(18, int(h * 0.08)))
    draw = ImageDraw.Draw(img)
    if top:
        draw_text_with_outline(draw, (w // 2, int(h * 0.08)), top, font)
    if bottom:
        draw_text_with_outline(draw, (w // 2, int(h * 0.92)), bottom, font)
    out = img.convert("RGB") if dst.lower().endswith((".jpg", ".jpeg")) else img
    out.save(dst)
    print(dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
