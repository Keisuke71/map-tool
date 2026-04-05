import argparse
import json
import sqlite3
import struct
from pathlib import Path


def envelope_size(flags: int) -> int:
    indicator = (flags >> 1) & 0b111
    return {
        0: 0,
        1: 32,
        2: 48,
        3: 48,
        4: 64,
    }.get(indicator, 0)


def parse_gpkg_geometry(blob: bytes):
    if blob is None:
        return None
    if len(blob) < 8 or blob[:2] != b"GP":
        raise ValueError("Unsupported GeoPackage geometry header.")

    flags = blob[3]
    header_length = 8 + envelope_size(flags)
    wkb = blob[header_length:]
    geometry, offset = parse_wkb(wkb, 0)

    if offset != len(wkb):
        raise ValueError("Unexpected trailing bytes in WKB payload.")

    return geometry


def parse_wkb(data: bytes, offset: int):
    byte_order = data[offset]
    endian = "<" if byte_order == 1 else ">"
    offset += 1

    geometry_type = struct.unpack_from(f"{endian}I", data, offset)[0]
    offset += 4
    base_type = geometry_type % 1000

    if base_type == 1:
        x, y = struct.unpack_from(f"{endian}dd", data, offset)
        offset += 16
        return {"type": "Point", "coordinates": [x, y]}, offset

    if base_type == 2:
        point_count = struct.unpack_from(f"{endian}I", data, offset)[0]
        offset += 4
        coordinates = []
        for _ in range(point_count):
            x, y = struct.unpack_from(f"{endian}dd", data, offset)
            offset += 16
            coordinates.append([x, y])
        return {"type": "LineString", "coordinates": coordinates}, offset

    if base_type == 3:
        ring_count = struct.unpack_from(f"{endian}I", data, offset)[0]
        offset += 4
        polygon = []
        for _ in range(ring_count):
            point_count = struct.unpack_from(f"{endian}I", data, offset)[0]
            offset += 4
            ring = []
            for _ in range(point_count):
                x, y = struct.unpack_from(f"{endian}dd", data, offset)
                offset += 16
                ring.append([x, y])
            polygon.append(ring)
        return {"type": "Polygon", "coordinates": polygon}, offset

    if base_type == 4:
        part_count = struct.unpack_from(f"{endian}I", data, offset)[0]
        offset += 4
        points = []
        for _ in range(part_count):
            point, offset = parse_wkb(data, offset)
            points.append(point["coordinates"])
        return {"type": "MultiPoint", "coordinates": points}, offset

    if base_type == 5:
        part_count = struct.unpack_from(f"{endian}I", data, offset)[0]
        offset += 4
        lines = []
        for _ in range(part_count):
            line, offset = parse_wkb(data, offset)
            lines.append(line["coordinates"])
        return {"type": "MultiLineString", "coordinates": lines}, offset

    if base_type == 6:
        part_count = struct.unpack_from(f"{endian}I", data, offset)[0]
        offset += 4
        polygons = []
        for _ in range(part_count):
            polygon, offset = parse_wkb(data, offset)
            polygons.append(polygon["coordinates"])
        return {"type": "MultiPolygon", "coordinates": polygons}, offset

    raise ValueError(f"Unsupported WKB geometry type: {geometry_type}")


def resolve_layer_name(connection: sqlite3.Connection, requested_layer: str | None) -> str:
    if requested_layer:
        return requested_layer

    row = connection.execute(
        "SELECT table_name FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name LIMIT 1"
    ).fetchone()
    if not row:
        raise ValueError("No feature layer found in GeoPackage.")

    return row[0]


def main():
    parser = argparse.ArgumentParser(
        description="Export a GeoPackage feature layer to GeoJSON without external GIS dependencies."
    )
    parser.add_argument("input_path", help="Path to the GeoPackage file.")
    parser.add_argument("output_path", help="Path to the GeoJSON file to write.")
    parser.add_argument("--layer", help="Feature layer name. Defaults to the first feature layer.")
    parser.add_argument(
        "--geometry-column",
        help="Geometry column name. Defaults to the layer's GeoPackage geometry column.",
    )
    parser.add_argument(
        "--properties",
        nargs="+",
        default=["KEY_CODE", "PREF_NAME", "CITY_NAME", "S_NAME", "HCODE", "X_CODE", "Y_CODE"],
        help="Property columns to include in the exported GeoJSON.",
    )
    args = parser.parse_args()

    input_path = Path(args.input_path)
    output_path = Path(args.output_path)

    connection = sqlite3.connect(str(input_path))
    connection.row_factory = sqlite3.Row

    try:
        layer_name = resolve_layer_name(connection, args.layer)

        geometry_column = args.geometry_column
        if not geometry_column:
            row = connection.execute(
                "SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?",
                (layer_name,),
            ).fetchone()
            if not row:
                raise ValueError(f"Could not resolve geometry column for layer: {layer_name}")
            geometry_column = row["column_name"]

        quoted_properties = ", ".join(f'"{name}"' for name in args.properties)
        query = f'SELECT {quoted_properties}, "{geometry_column}" FROM "{layer_name}"'

        features = []
        for row in connection.execute(query):
            properties = {name: row[name] for name in args.properties}
            geometry = parse_gpkg_geometry(row[geometry_column])
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": geometry,
                }
            )

        output = {
            "type": "FeatureCollection",
            "name": layer_name,
            "feature_count": len(features),
            "features": features,
        }

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {len(features)} features to {output_path}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
