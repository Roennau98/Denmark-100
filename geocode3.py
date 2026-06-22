#!/usr/bin/env python3
"""Bring the dataset in line with the official beenposter list of 100 sights:
remove wrong entries, rename a few, and geocode the 28 missing ones.
Writes the final data/places.json with exactly 100 places."""
import json
import time
import urllib.parse
import urllib.request

REMOVE_IDS = {
    "den-blaa-planet", "faaborg", "frederiksvaerk", "geocenter-moens-klint",
    "lakolk-strand", "marselisborg-slot", "middelaldercentret",
}

# id -> new name (id will be regenerated from the new name)
RENAME = {
    "himmelbjerget": "Himmelbjergtårnet",
    "danmarks-jernbanemuseum": "Jernbanemuseet",
    "aros": "ARoS Kunstmuseum",
    "louisiana": "Louisiana Museum",
    "arken": "Arken Museum",
    "skovtaarnet-camp-adventure": "Skovtårnet",
}

# name | region | category | query | fallback "lat,lng" (or empty)
NEW = """
De 6 Glemte Kæmper|Vestegnen, Sjælland|sevaerdighed|Teilum Trolden Hvidovre|55.6300,12.3800
Mols Bjerge|Djursland, Jylland|natur|Nationalpark Mols Bjerge|56.2300,10.5500
Den Uendelige Bro|Aarhus, Jylland|sevaerdighed|Den Uendelige Bro Aarhus|56.1180,10.2430
Jægersborg Dyrehave|Klampenborg, Sjælland|natur|Jægersborg Dyrehave|55.7870,12.5660
Valdemars Slot|Tåsinge, Fyn|slot|Valdemars Slot Tåsinge|55.0220,10.6160
Bunkermuseum Hanstholm|Hanstholm, Jylland|museum|Museumscenter Hanstholm|57.1187,8.6036
Fjordenhus|Vejle, Jylland|sevaerdighed|Fjordenhus Vejle|55.7093,9.5447
Muldyrbunkerne|Hanstholm, Jylland|sevaerdighed|Muldyrbunkerne Hanstholm|
Ejer Bavnehøj|Skanderborg, Jylland|natur|Ejer Bavnehøj|55.9756,9.8347
Det Gamle Rådhus|Ribe, Jylland|sevaerdighed|Det Gamle Rådhus Ribe|
Opalsøen|Bornholm|natur|Opalsøen Bornholm|55.2970,14.7660
Moesgaard Museum|Aarhus, Jylland|museum|Moesgaard Museum|56.0856,10.2356
Fredericia Vold|Fredericia, Jylland|sevaerdighed|Fredericia Vold|55.5650,9.7520
Anholt Fyr|Anholt, Jylland|taarn|Anholt Fyr|56.7130,11.6520
Nyboder|København, Sjælland|sevaerdighed|Nyboder København|55.6890,12.5910
Bulbjerg|Thy, Jylland|natur|Bulbjerg|57.1456,9.0186
Maribo Domkirke|Maribo, Lolland|kirke|Maribo Domkirke|54.7760,11.4990
Røsnæs Fyr|Kalundborg, Sjælland|taarn|Røsnæs Fyr|55.7453,10.8700
Klitmøller Strand|Thy, Jylland|strand|Klitmøller|57.0330,8.4760
Jomfru Ane Gade|Aalborg, Jylland|sevaerdighed|Jomfru Ane Gade Aalborg|57.0480,9.9180
Fængslet|Horsens, Jylland|museum|Fængslet Horsens|55.8656,9.8460
Bispehuen|Bornholm|natur|Bispehuen Bornholm|
Store Tårn|Christiansø, Bornholm|taarn|Store Tårn Christiansø|55.3185,15.1870
Læsø Saltsyderi|Læsø, Jylland|sevaerdighed|Læsø Saltsyderi|57.2330,11.0300
Gedser Odde|Falster|natur|Gedser Odde|54.5574,11.9670
Svanninge Bakker|Fyn|natur|Svanninge Bakker|55.1180,10.2750
Nationalmuseet|København, Sjælland|museum|Nationalmuseet København|55.6745,12.5755
Skulpturparken Blokhus|Blokhus, Jylland|sevaerdighed|Skulpturparken Blokhus|57.2520,9.5830
"""


def slugify(name):
    out = []
    for ch in name.lower():
        if ch == "æ": out.append("ae")
        elif ch == "ø": out.append("oe")
        elif ch == "å": out.append("aa")
        elif ch.isalnum() and ch.isascii(): out.append(ch)
        elif ch in " -/.": out.append("-")
    s = "".join(out)
    while "--" in s: s = s.replace("--", "-")
    return s.strip("-")


def geocode(query):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1, "countrycodes": "dk"})
    req = urllib.request.Request(url, headers={"User-Agent": "danmark100-poster-app/1.0 (personal project)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return None
    return (float(data[0]["lat"]), float(data[0]["lon"])) if data else None


def main():
    places = json.load(open("data/places.json", encoding="utf-8"))
    # 1) fjern forkerte
    places = [p for p in places if p["id"] not in REMOVE_IDS]
    # 2) omdøb
    for p in places:
        if p["id"] in RENAME:
            p["name"] = RENAME[p["id"]]
            p["id"] = slugify(p["name"])
    have = {p["id"] for p in places}

    # 3) tilføj de manglende
    failed = []
    for line in [l for l in NEW.strip().splitlines() if l.strip()]:
        name, region, category, query, fb = (line.split("|") + [""])[:5]
        name, region, category, query, fb = name.strip(), region.strip(), category.strip(), query.strip(), fb.strip()
        slug = slugify(name)
        if slug in have:
            continue
        coords = geocode(query)
        time.sleep(1.1)
        fallback = None
        if fb:
            la, lo = fb.split(",")
            fallback = (float(la), float(lo))
        used = ""
        if coords is None:
            if fallback: coords, used = fallback, " (fallback)"
            else: failed.append(name); print(f"FAILED: {name}  ({query})"); continue
        else:
            lat, lng = coords
            in_dk = 54.4 <= lat <= 58.0 and 8.0 <= lng <= 15.3
            if not in_dk or (fallback and (abs(lat - fallback[0]) > 0.3 or abs(lng - fallback[1]) > 0.5)):
                if fallback: coords, used = fallback, " (fallback)"
                elif not in_dk: failed.append(name); print(f"FAILED(outside DK): {name} {lat},{lng}"); continue
        places.append({
            "id": slug, "name": name, "region": region, "category": category,
            "lat": round(coords[0], 6), "lng": round(coords[1], 6), "needsReview": False,
        })
        have.add(slug)
        print(f"{name}: {coords[0]:.5f},{coords[1]:.5f}{used}")

    places.sort(key=lambda x: x["name"].lower())
    json.dump(places, open("data/places.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nTOTAL: {len(places)} places")
    if failed:
        print("STILL FAILED: " + ", ".join(failed))


if __name__ == "__main__":
    main()
