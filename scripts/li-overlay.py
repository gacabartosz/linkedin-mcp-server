#!/usr/bin/env python3
"""
li-overlay.py — reużywalny generator grafik "nakładka" pod LinkedIn (brand bartoszgaca).

Komponuje: górny pasek akcentu + eyebrow + tytuł + zrzut ekranu (zaokrąglony, w ramce)
+ opcjonalny pasek liczb + stopka z PRZEZROCZYSTYM logo i handle.

Brand (navy/cyan) i logo są stałymi na górze pliku — łatwo podmienić.
WAŻNE: logo MUSI być przezroczyste. Domyślnie gaca-icon-512.png (RGBA, prawdziwa alpha).
NIE używać ~/.agents/brands/bartoszgaca/logo.png — ma białe tło.

Przykład:
  /opt/homebrew/bin/python3 scripts/li-overlay.py \
    --screenshot ~/output/personal/fb-zasiegi/fb-stats-raw.png \
    --title "Czy da się zwiększyć zasięgi na FB?" \
    --highlight-word "zasięgi" \
    --eyebrow "AUTOMATYZACJA  •  EFEKT PO 14 DNIACH" \
    --stat-left "195 894" --stat-left-label "wyświetleń" \
    --stat-right "↑ 247 867%" \
    --out ~/output/personal/fb-zasiegi/li-fb-zasiegi.png
"""
import argparse
import os
import sys
from PIL import Image, ImageDraw, ImageFont

# ── Brand (bartoszgaca) ───────────────────────────────────────────────────────
NAVY = (26, 58, 92)      # #1a3a5c
NAVY_DARK = (18, 42, 68) # #122a44 (dół gradientu)
CYAN = (0, 180, 216)     # #00b4d8
WHITE = (255, 255, 255)
MUTE = (150, 176, 200)
SEP = (60, 90, 120)

# Logo: ZAWSZE przezroczyste. Mark (kwadrat) + handle tekstem obok = czysty lockup.
LOGO_PATH = os.path.expanduser(
    "~/projects/personal/bartoszgaca.pl/assets/gaca/gaca-icon-512.png"
)
HANDLE = "bartoszgaca.pl"

# Fonty z pełnym wsparciem polskich znaków
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"

PAD = 70


def font(path, size):
    return ImageFont.truetype(path, size)


def wrap(draw, text, fnt, max_w):
    """Zawijanie tekstu do max szerokości; zwraca listę linii."""
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_title(draw, lines, fnt, x, y, line_h, highlight_word):
    """Rysuje tytuł linia po linii; opcjonalnie podświetla jedno słowo na cyan."""
    for line in lines:
        if highlight_word and highlight_word in line:
            cx = x
            for i, tok in enumerate(line.split(" ")):
                word = tok + (" " if i < len(line.split(" ")) - 1 else "")
                col = CYAN if tok.strip(",.?!:") == highlight_word else WHITE
                draw.text((cx, y), word, font=fnt, fill=col)
                cx += draw.textlength(word, font=fnt)
        else:
            draw.text((x, y), line, font=fnt, fill=WHITE)
        y += line_h
    return y


def paste_logo(img, x, y, target_h, draw=None, chip=False):
    """Wkleja PRZEZROCZYSTE logo z maską alpha. Zwraca szerokość wklejonego logo.
    chip=True → rysuje jasny zaokrąglony kafelek pod logo (granatowa ikona ginie
    na granatowym tle → na białym kafelku jest wyraźna)."""
    try:
        logo = Image.open(LOGO_PATH).convert("RGBA")
    except Exception as e:
        print(f"WARN: nie mogę wczytać logo {LOGO_PATH}: {e}", file=sys.stderr)
        return 0
    w = int(logo.width * target_h / logo.height)
    logo = logo.resize((w, target_h), Image.LANCZOS)
    if chip and draw is not None:
        m = max(10, int(target_h * 0.22))  # margines kafelka wokół logo
        draw.rounded_rectangle([x - m, y - m, x + w + m, y + target_h + m],
                               radius=int(target_h * 0.42), fill=WHITE)
    img.paste(logo, (x, y), logo)  # 3. arg = maska alpha → brak białego tła
    return w


def build(args):
    W, H = (int(v) for v in args.size.lower().split("x"))
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)

    # gradient navy → navy_dark
    for yy in range(H):
        t = yy / H
        c = tuple(int(NAVY[i] * (1 - t) + NAVY_DARK[i] * t) for i in range(3))
        d.line([(0, yy), (W, yy)], fill=c)

    # górny pasek akcentu
    d.rectangle([0, 0, W, 10], fill=CYAN)

    y = 70
    # eyebrow
    if args.eyebrow:
        d.text((PAD, y), args.eyebrow.upper(), font=font(FONT_BOLD, 30), fill=CYAN)
        y += 50

    # tytuł (auto-wrap)
    tf = font(FONT_BOLD, args.title_size)
    line_h = int(args.title_size * 1.18)
    lines = wrap(d, args.title, tf, W - 2 * PAD)
    y = draw_title(d, lines, tf, PAD, y, line_h, args.highlight_word)

    # zrzut ekranu — zaokrąglony, w ramce cyan
    shot = Image.open(args.screenshot).convert("RGB")
    tw = W - 2 * PAD
    th = int(shot.height * tw / shot.width)
    shot = shot.resize((tw, th), Image.LANCZOS)
    rad = 28
    mask = Image.new("L", (tw, th), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, tw, th], radius=rad, fill=255)
    sx = (W - tw) // 2
    sy = y + 30
    img.paste(shot, (sx, sy), mask)
    d.rounded_rectangle([sx - 3, sy - 3, sx + tw + 3, sy + th + 3],
                        radius=rad, outline=CYAN, width=4)
    cursor = sy + th

    # pasek liczb (opcjonalny)
    if args.stat_left or args.stat_right:
        by = cursor + 34
        bf = font(FONT_BOLD, 54)
        sf = font(FONT_REG, 30)
        if args.stat_left:
            d.text((PAD, by), args.stat_left, font=bf, fill=WHITE)
            wlen = d.textlength(args.stat_left, font=bf)
            if args.stat_left_label:
                d.text((PAD + wlen + 18, by + 22), args.stat_left_label, font=sf, fill=MUTE)
        if args.stat_right:
            pl = d.textlength(args.stat_right, font=bf)
            d.text((W - PAD - pl, by), args.stat_right, font=bf, fill=CYAN)

    # stopka: separator + przezroczyste logo + handle
    fy = H - 86
    d.line([(PAD, fy - 22), (W - PAD, fy - 22)], fill=SEP, width=2)
    paste_logo(img, PAD, fy, 54, draw=d, chip=args.logo_chip)
    hf = font(FONT_BOLD, 30)
    d.text((W - PAD - d.textlength(HANDLE, font=hf), fy + 12), HANDLE, font=hf, fill=WHITE)

    out = os.path.expanduser(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, quality=95)
    print(f"SAVED {out} {img.size}")
    return out


def main():
    ap = argparse.ArgumentParser(description="Generator grafik nakładka pod LinkedIn (brand bartoszgaca).")
    ap.add_argument("--screenshot", required=True, help="ścieżka do surowego zrzutu ekranu")
    ap.add_argument("--title", required=True, help="tytuł (auto-wrap do 2+ linii)")
    ap.add_argument("--eyebrow", default="", help="mały nagłówek nad tytułem")
    ap.add_argument("--highlight-word", default="", help="słowo w tytule podświetlone na cyan")
    ap.add_argument("--stat-left", default="", help="lewa duża liczba (np. 195 894)")
    ap.add_argument("--stat-left-label", default="", help="podpis pod/obok lewej liczby")
    ap.add_argument("--stat-right", default="", help="prawa liczba na cyan (np. wzrost procentowy)")
    ap.add_argument("--logo-chip", action="store_true", help="jasny kafelek pod logo (widoczność na ciemnym tle)")
    ap.add_argument("--title-size", type=int, default=76, help="rozmiar fontu tytułu")
    ap.add_argument("--size", default="1080x1350", help="WxH, domyślnie 1080x1350 (4:5)")
    ap.add_argument("--out", default="~/output/personal/li-overlay.png", help="ścieżka wynikowa PNG")
    args = ap.parse_args()
    build(args)


if __name__ == "__main__":
    main()
