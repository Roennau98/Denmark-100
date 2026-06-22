#!/usr/bin/env python3
"""Second pass: geocode the entries that failed in pass 1, using Danish
queries, with hand-verified manual fallback coordinates. Merges into
data/places.json."""
import json
import time
import urllib.parse
import urllib.request

# name | region | category | danish query | fallback_lat | fallback_lng
FAILED = [
    ("Den Lille Havfrue", "København, Sjælland", "sevaerdighed", "Den Lille Havfrue, Langelinie, København", 55.692854, 12.599228),
    ("Jellingstenene", "Jelling, Jylland", "sevaerdighed", "Jellingstenene, Jelling", 55.756070, 9.419060),
    ("Mennesket ved Havet", "Esbjerg, Jylland", "sevaerdighed", "Mennesket ved Havet, Esbjerg", 55.530280, 8.400600),
    ("Aarhus Rådhus", "Aarhus, Jylland", "sevaerdighed", "Aarhus Rådhus", 56.151190, 10.202900),
    ("Nyborg Slot", "Nyborg, Fyn", "slot", "Nyborg Slot", 55.310600, 10.787600),
    ("Aalborgtårnet", "Aalborg, Jylland", "taarn", "Aalborgtårnet", 57.043180, 9.908400),
    ("Arken", "Ishøj, Sjælland", "museum", "Arken Museum for Moderne Kunst, Ishøj", 55.611630, 12.307000),
    ("Marmorkirken", "København, Sjælland", "kirke", "Frederiks Kirke Marmorkirken, København", 55.684800, 12.593300),
    ("Grundtvigs Kirke", "København, Sjælland", "kirke", "Grundtvigs Kirke, Bispebjerg", 55.718700, 12.533500),
    ("Den Blå Planet", "Kastrup, Sjælland", "museum", "Den Blå Planet, Kastrup", 55.631500, 12.655400),
    ("Tirpitz", "Blåvand, Jylland", "museum", "Tirpitz, Blåvand", 55.556200, 8.089200),
    ("Marselisborg Slot", "Aarhus, Jylland", "slot", "Marselisborg Slot, Aarhus", 56.134500, 10.206400),
    ("Den Tilsandede Kirke", "Skagen, Jylland", "kirke", "Den Tilsandede Kirke, Skagen", 57.716700, 10.553300),
    ("Museet for Søfart", "Helsingør, Sjælland", "museum", "M/S Museet for Søfart, Helsingør", 56.037200, 12.613500),
    ("Det Kongelige Teater", "København, Sjælland", "sevaerdighed", "Det Kongelige Teater, Kongens Nytorv", 55.679750, 12.585600),
    ("ARoS", "Aarhus, Jylland", "museum", "ARoS Aarhus Kunstmuseum", 56.153300, 10.199400),
    ("Lakolk Strand", "Rømø, Jylland", "strand", "Lakolk, Rømø", 55.151200, 8.513500),
    ("Middelaldercentret", "Nykøbing Falster, Lolland", "museum", "Middelaldercentret, Nykøbing Falster", 54.757600, 11.863200),
]


def slugify(name):
    out = []
    for ch in name.lower():
        if ch == "æ":
            out.append("ae")
        elif ch == "ø":
            out.append("oe")
        elif ch == "å":
            out.append("aa")
        elif ch.isalnum() and ch.isascii():
            out.append(ch)
        elif ch in " -/.":
            out.append("-")
    s = "".join(out)
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-")


def geocode(query):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1, "countrycodes": "dk"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "danmark100-poster-app/1.0 (personal project)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return None
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"])


def main():
    with open("data/places.json", encoding="utf-8") as f:
        places = json.load(f)
    existing = {p["id"] for p in places}

    for name, region, category, query, flat, flng in FAILED:
        slug = slugify(name)
        if slug in existing:
            continue
        coords = geocode(query)
        time.sleep(1.1)
        used_fallback = False
        if coords is None:
            lat, lng = flat, flng
            used_fallback = True
        else:
            lat, lng = coords
            # sanity: if Nominatim result is >25km from our known fallback, trust fallback
            if abs(lat - flat) > 0.25 or abs(lng - flng) > 0.4:
                lat, lng = flat, flng
                used_fallback = True
        tag = " (fallback)" if used_fallback else ""
        print(f"{name}: {lat:.5f},{lng:.5f}{tag}")
        places.append({
            "id": slug,
            "name": name,
            "region": region,
            "category": category,
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "needsReview": False,
        })

    places.sort(key=lambda x: x["name"].lower())
    with open("data/places.json", "w", encoding="utf-8") as f:
        json.dump(places, f, ensure_ascii=False, indent=2)
    print(f"\nTotal places now: {len(places)}")


if __name__ == "__main__":
    main()
