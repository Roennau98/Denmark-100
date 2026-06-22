#!/usr/bin/env python3
"""Write the final app icon (Denmark line-art + incorporated 100) to
icons/icon.svg, plus a verification page at several real icon sizes."""
P = open("/tmp/dk_path.txt").read()
FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif"

def icon(fill_opacity):
    fill = "rgba(255,255,255,%s)" % fill_opacity if fill_opacity else "none"
    return (
        '<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Danmark 100">\n'
        '  <rect width="512" height="512" rx="104" fill="#c8102e"/>\n'
        '  <text x="256" y="452" font-family="' + FONT + '" font-weight="800" font-size="142" '
        'fill="#ffffff" text-anchor="middle" letter-spacing="2">100</text>\n'
        '  <path d="' + P + '" fill="' + fill + '" stroke="#ffffff" stroke-width="7" '
        'stroke-linejoin="round" stroke-linecap="round"/>\n'
        '</svg>'
    )

# Final chosen: pure line drawing (no fill) — a true "stregtegning".
FINAL = icon(0.0)
open("/Users/kasperronnau/danmark-100/icons/icon.svg", "w").write(FINAL)
print("wrote icons/icon.svg")

def sized(svg, size):
    return svg.replace("<svg ", "<svg width='%d' height='%d' " % (size, size), 1)

def at(svg, size):
    return ("<div style='text-align:center'><div>" + sized(svg, size) +
            "</div><small>" + str(size) + "px</small></div>")

final, nofill = FINAL, icon(0.14)
row_final = "".join(at(final, s) for s in (512, 180, 80, 48, 32, 16))
row_nofill = "".join(at(nofill, s) for s in (180, 80, 48, 32))
home_app = "<div class='app'>" + sized(final, 84) + "<div>Danmark 100</div></div>"

html = (
    "<!doctype html><meta charset='utf-8'><style>"
    "body{font-family:" + FONT + ";background:#eef1f4;margin:0;padding:28px}"
    "h3{color:#333}.strip{display:flex;align-items:flex-end;gap:22px;flex-wrap:wrap;"
    "background:#fff;padding:20px;border-radius:14px;margin-bottom:24px}small{color:#666}"
    ".home{display:flex;gap:20px;background:linear-gradient(160deg,#5b7fb4,#33507c);"
    "padding:26px;border-radius:24px;width:max-content}"
    ".home .app{text-align:center;color:#fff;font-size:12px}"
    ".home .app svg{display:block;border-radius:22px;box-shadow:0 6px 16px rgba(0,0,0,.3);margin-bottom:6px}"
    "</style><body>"
    "<h3>Endeligt ikon (ren streg) — i app-ikon-størrelser</h3>"
    "<div class='strip'>" + row_final + "</div>"
    "<h3>Til sammenligning: med svag fyld</h3>"
    "<div class='strip'>" + row_nofill + "</div>"
    "<h3>På en hjemmeskærm</h3>"
    "<div class='home'>" + home_app + home_app + "</div>"
    "</body>"
)
open("/Users/kasperronnau/danmark-100/_icon_final.html", "w").write(html)
print("wrote _icon_final.html")
