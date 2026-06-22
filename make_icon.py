#!/usr/bin/env python3
"""Convert the Denmark geojson into a simplified SVG line-art path for the app
icon. Keeps the recognizable landmasses (Jutland, Zealand, Funen, Lolland,
Langeland, Bornholm) and projects them into a 512x512 viewBox."""
import json
import math

VIEW = 512
PAD = 64

dk = json.load(open("/tmp/dk_only.geojson"))
polys = dk["geometry"]["coordinates"]  # MultiPolygon: list of polygons, each [outer, holes...]
polys = sorted(polys, key=lambda poly: -len(poly[0]))

# Keep the big, recognizable pieces + Bornholm (far SE, lng > 14).
kept = []
for poly in polys:
    ring = poly[0]
    minlng = min(p[0] for p in ring)
    if len(ring) >= 12 or minlng > 14:
        kept.append(ring)

# Bounding box across kept rings
all_pts = [p for ring in kept for p in ring]
minlng = min(p[0] for p in all_pts); maxlng = max(p[0] for p in all_pts)
minlat = min(p[1] for p in all_pts); maxlat = max(p[1] for p in all_pts)
latmid = (minlat + maxlat) / 2
kx = math.cos(math.radians(latmid))

pw = (maxlng - minlng) * kx
ph = (maxlat - minlat)
scale = (VIEW - 2 * PAD) / max(pw, ph)
offx = (VIEW - pw * scale) / 2
offy = (VIEW - ph * scale) / 2

def project(lng, lat):
    x = offx + (lng - minlng) * kx * scale
    y = offy + (maxlat - lat) * scale
    return round(x, 1), round(y, 1)

subpaths = []
for ring in kept:
    pts = [project(lng, lat) for lng, lat in ring]
    d = "M" + " L".join(f"{x},{y}" for x, y in pts) + "Z"
    subpaths.append(d)

path_d = " ".join(subpaths)
with open("/tmp/dk_path.txt", "w") as f:
    f.write(path_d)

# Reference points to help place the "100"
print("kept landmasses:", len(kept))
print("bbox lng", round(minlng, 2), round(maxlng, 2), "lat", round(minlat, 2), round(maxlat, 2))
for name, lng, lat in [
    ("Baltic gap (Zealand<->Bornholm)", 13.65, 55.35),
    ("North Sea (W of Jutland)", 7.6, 55.6),
    ("center", (minlng + maxlng) / 2, latmid),
    ("Bornholm", 14.9, 55.15),
    ("Copenhagen", 12.57, 55.68),
]:
    print(f"  {name}: {project(lng, lat)}")
print("path length (chars):", len(path_d))
