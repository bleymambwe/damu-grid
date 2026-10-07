"""Cut a small Kenya basemap out of Natural Earth 1:50m data (public domain).

    python -I tools/build_map.py <ne_50m_admin_0_countries.geojson> <ne_50m_lakes.geojson> web/data/kenya_map.json

Keeps Kenya and its neighbours inside a bounding box, plus the lakes there,
rounds coordinates to 3 decimals and drops near-duplicate points.
"""

import json
import sys

BBOX = (32.5, -6.0, 43.0, 6.0)  # lon_min, lat_min, lon_max, lat_max
NEIGHBOURS = {"KEN", "UGA", "TZA", "ETH", "SOM", "SSD", "SDS"}


def in_box(ring):
    return any(BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3] for x, y in ring)


def thin(ring, tol=0.015):
    out = [ring[0]]
    for x, y in ring[1:]:
        px, py = out[-1]
        if abs(x - px) + abs(y - py) >= tol:
            out.append([x, y])
    if out[-1] != ring[-1]:
        out.append(ring[-1])
    return [[round(x, 3), round(y, 3)] for x, y in out]


def rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [p[0] for p in geom["coordinates"]]
    return []


def main(countries_path, lakes_path, out_path):
    countries = json.load(open(countries_path, encoding="utf-8"))
    lakes = json.load(open(lakes_path, encoding="utf-8"))
    out = {"bbox": BBOX, "source": "Natural Earth 1:50m (public domain)", "countries": [], "lakes": []}
    for f in countries["features"]:
        iso = f["properties"].get("ADM0_A3") or f["properties"].get("ISO_A3")
        if iso in NEIGHBOURS:
            rs = [thin(r) for r in rings(f["geometry"]) if in_box(r)]
            out["countries"].append({"iso": iso, "name": f["properties"].get("NAME"), "rings": rs})
    for f in lakes["features"]:
        rs = [thin(r, 0.01) for r in rings(f["geometry"]) if in_box(r)]
        if rs:
            out["lakes"].append({"name": f["properties"].get("name"), "rings": rs})
    json.dump(out, open(out_path, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"{len(out['countries'])} countries, {len(out['lakes'])} lakes -> {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
