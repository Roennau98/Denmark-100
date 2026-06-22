#!/usr/bin/env python3
"""Geocode the Danish sights from the poster via OpenStreetMap Nominatim.

Outputs data/places.json with accurate coordinates. Respects Nominatim's
usage policy (<=1 request/sec, descriptive User-Agent).
"""
import json
import time
import sys
import urllib.parse
import urllib.request

# name | region | category | nominatim query
# Categories: slot, kirke, natur, museum, strand, by, taarn, sevaerdighed, forlystelse
PLACES = """
Den Lille Havfrue|København, Sjælland|sevaerdighed|The Little Mermaid statue, Copenhagen, Denmark
Dodekalitten|Lolland|sevaerdighed|Dodekalitten, Denmark
Botanisk Have|København, Sjælland|natur|Botanical Garden, Copenhagen, Denmark
H.C. Andersens Barndomshjem|Odense, Fyn|museum|H.C. Andersens Barndomshjem, Odense, Denmark
Rundetårn|København, Sjælland|taarn|Rundetaarn, Copenhagen, Denmark
Dybbøl Mølle|Sønderborg, Jylland|sevaerdighed|Dybbøl Mølle, Denmark
Skovtårnet (Camp Adventure)|Haslev, Sjælland|taarn|Camp Adventure Tower, Denmark
Nyhavn|København, Sjælland|sevaerdighed|Nyhavn, Copenhagen, Denmark
Ekkodalen|Bornholm|natur|Ekkodalen, Bornholm, Denmark
Ribe Domkirke|Ribe, Jylland|kirke|Ribe Cathedral, Denmark
Amalienborg|København, Sjælland|slot|Amalienborg, Copenhagen, Denmark
Jellingstenene|Jelling, Jylland|sevaerdighed|Jelling Stones, Denmark
Sneglehuset|Thyborøn, Jylland|sevaerdighed|Sneglehuset, Thyborøn, Denmark
Rosenborg Slot|København, Sjælland|slot|Rosenborg Castle, Copenhagen, Denmark
Den Gamle By|Aarhus, Jylland|museum|Den Gamle By, Aarhus, Denmark
Mennesket ved Havet|Esbjerg, Jylland|sevaerdighed|Men at Sea Mennesket ved Havet, Esbjerg, Denmark
Himmelbjerget|Ry, Jylland|natur|Himmelbjerget, Denmark
Aarhus Rådhus|Aarhus, Jylland|sevaerdighed|Aarhus City Hall, Denmark
Stevns Klint|Stevns, Sjælland|natur|Stevns Klint, Denmark
Råbjerg Mile|Skagen, Jylland|natur|Råbjerg Mile, Denmark
Danmarks Jernbanemuseum|Odense, Fyn|museum|Danmarks Jernbanemuseum, Odense, Denmark
Koldinghus|Kolding, Jylland|slot|Koldinghus, Denmark
Operaen|København, Sjælland|sevaerdighed|Copenhagen Opera House, Denmark
Bakken|Klampenborg, Sjælland|forlystelse|Dyrehavsbakken, Klampenborg, Denmark
Christiansborg Slot|København, Sjælland|slot|Christiansborg Palace, Copenhagen, Denmark
Vikingeskibsmuseet|Roskilde, Sjælland|museum|Viking Ship Museum, Roskilde, Denmark
Helligdomsklipperne|Bornholm|natur|Helligdomsklipperne, Bornholm, Denmark
Rold Skov|Himmerland, Jylland|natur|Rold Skov, Denmark
Egeskov Slot|Kværndrup, Fyn|slot|Egeskov Castle, Denmark
Tivoli|København, Sjælland|forlystelse|Tivoli Gardens, Copenhagen, Denmark
Nyborg Slot|Nyborg, Fyn|slot|Nyborg Castle, Denmark
Aalborgtårnet|Aalborg, Jylland|taarn|Aalborgtaarnet, Aalborg, Denmark
Arken|Ishøj, Sjælland|museum|ARKEN Museum of Modern Art, Ishøj, Denmark
Frederiksborg Slot|Hillerød, Sjælland|slot|Frederiksborg Castle, Hillerød, Denmark
Kronborg Slot|Helsingør, Sjælland|slot|Kronborg Castle, Helsingør, Denmark
Marmorkirken|København, Sjælland|kirke|Marble Church Frederik's Church, Copenhagen, Denmark
Grundtvigs Kirke|København, Sjælland|kirke|Grundtvig's Church, Copenhagen, Denmark
Den Blå Planet|Kastrup, Sjælland|museum|Den Blå Planet National Aquarium Denmark, Kastrup
Kastellet|København, Sjælland|sevaerdighed|Kastellet, Copenhagen, Denmark
Hammershus|Bornholm|slot|Hammershus, Bornholm, Denmark
GeoCenter Møns Klint|Møn, Sjælland|natur|GeoCenter Møns Klint, Denmark
Tirpitz|Blåvand, Jylland|museum|Tirpitz Museum, Blåvand, Denmark
Legoland|Billund, Jylland|forlystelse|Legoland Billund, Denmark
Marselisborg Slot|Aarhus, Jylland|slot|Marselisborg Palace, Aarhus, Denmark
Vor Frelsers Kirke|København, Sjælland|kirke|Church of Our Saviour, Copenhagen, Denmark
Christiania|København, Sjælland|sevaerdighed|Freetown Christiania, Copenhagen, Denmark
Den Fynske Landsby|Odense, Fyn|museum|Den Fynske Landsby, Odense, Denmark
Vor Frue Kirke|Kalundborg, Sjælland|kirke|Vor Frue Kirke, Kalundborg, Denmark
Spøttrup Borg|Salling, Jylland|slot|Spøttrup Borg, Denmark
Æbelø|Fyn|natur|Æbelø, Denmark
Legoland Billund Resort||skip|skip
Fyns Hoved|Fyn|natur|Fyns Hoved, Denmark
Fregatten Jylland|Ebeltoft, Jylland|museum|Fregatten Jylland, Ebeltoft, Denmark
Glyptoteket|København, Sjælland|museum|Ny Carlsberg Glyptotek, Copenhagen, Denmark
Tystrup-Bavelse|Sjælland|natur|Tystrup Sø, Denmark
Løkken Strand|Løkken, Jylland|strand|Løkken, Denmark
Faxe Kalkbrud|Faxe, Sjælland|natur|Faxe Kalkbrud, Denmark
Lille Vildmose|Himmerland, Jylland|natur|Lille Vildmose, Denmark
Den Tilsandede Kirke|Skagen, Jylland|kirke|The Buried Church Skagen, Denmark
Faaborg|Fyn|by|Faaborg, Denmark
Storebæltsbroen|Sjælland/Fyn|sevaerdighed|Great Belt Bridge, Denmark
Museet for Søfart|Helsingør, Sjælland|museum|Maritime Museum of Denmark, Helsingør, Denmark
Frederiksværk|Sjælland|by|Frederiksværk, Denmark
Dueodde Strand|Bornholm|strand|Dueodde, Bornholm, Denmark
Rubjerg Knude Fyr|Lønstrup, Jylland|taarn|Rubjerg Knude Lighthouse, Denmark
Det Kongelige Teater|København, Sjælland|sevaerdighed|Royal Danish Theatre, Copenhagen, Denmark
ARoS|Aarhus, Jylland|museum|ARoS Aarhus Kunstmuseum, Denmark
Nationalpark Vadehavet|Jylland|natur|Wadden Sea National Park, Denmark
H.C. Andersens Hus|Odense, Fyn|museum|H.C. Andersens Hus, Odense, Denmark
Grundtvig||skip|skip
Den Genfundne Bro|Brædstrup, Jylland|sevaerdighed|Den Genfundne Bro, Denmark
Kalø Slotsruin|Djursland, Jylland|slot|Kalø Slotsruin, Denmark
Louisiana|Humlebæk, Sjælland|museum|Louisiana Museum of Modern Art, Humlebæk, Denmark
Den Gamle Lillebæltsbro|Middelfart, Jylland|sevaerdighed|Gamle Lillebæltsbro, Denmark
Mønsted Kalkgruber|Mønsted, Jylland|natur|Mønsted Kalkgruber, Denmark
Møns Klint|Møn, Sjælland|natur|Møns Klint, Denmark
Grenen|Skagen, Jylland|natur|Grenen, Skagen, Denmark
Lakolk Strand|Rømø, Jylland|strand|Lakolk, Rømø, Denmark
Østerlars Rundkirke|Bornholm|kirke|Østerlars Kirke, Bornholm, Denmark
Middelaldercentret|Nykøbing Falster, Lolland|museum|Middelaldercentret, Nykøbing Falster, Denmark
Skjoldungernes Land|Roskilde, Sjælland|natur|Nationalpark Skjoldungernes Land, Denmark
"""


def geocode(query):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1, "countrycodes": "dk"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "danmark100-poster-app/1.0 (personal project)"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    if not data:
        return None
    r = data[0]
    return float(r["lat"]), float(r["lon"])


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


def main():
    results = []
    failed = []
    seen = set()
    lines = [l for l in PLACES.strip().splitlines() if l.strip()]
    for i, line in enumerate(lines):
        parts = line.split("|")
        if len(parts) != 4:
            continue
        name, region, category, query = [p.strip() for p in parts]
        if category == "skip":
            continue
        slug = slugify(name)
        if slug in seen:
            continue
        seen.add(slug)
        try:
            coords = geocode(query)
        except Exception as e:
            coords = None
            print(f"  ! error {name}: {e}", file=sys.stderr)
        if coords is None:
            failed.append(name)
            print(f"[{i+1}/{len(lines)}] FAILED: {name}  ({query})")
        else:
            lat, lng = coords
            in_dk = 54.4 <= lat <= 57.9 and 7.8 <= lng <= 15.3
            results.append({
                "id": slug,
                "name": name,
                "region": region,
                "category": category,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "needsReview": not in_dk,
            })
            flag = "  <-- OUTSIDE DK, REVIEW" if not in_dk else ""
            print(f"[{i+1}/{len(lines)}] {name}: {lat:.5f},{lng:.5f}{flag}")
        time.sleep(1.1)

    results.sort(key=lambda x: x["name"].lower())
    with open("data/places.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(results)} places to data/places.json")
    if failed:
        print(f"FAILED ({len(failed)}): " + ", ".join(failed))


if __name__ == "__main__":
    main()
