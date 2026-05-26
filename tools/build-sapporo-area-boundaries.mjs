import fs from "node:fs/promises";
import path from "node:path";

function toHalfWidthDigits(value) {
  return value.replace(/[\uff10-\uff19]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
}

function kanjiNumberToInt(input) {
  const digits = {
    "\u3007": 0,
    "\u96f6": 0,
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9,
  };
  const units = {
    "\u5341": 10,
    "\u767e": 100,
    "\u5343": 1000,
  };

  let total = 0;
  let current = 0;

  for (const char of input) {
    if (char in digits) {
      current = digits[char];
      continue;
    }

    if (char in units) {
      total += (current || 1) * units[char];
      current = 0;
    }
  }

  return total + current;
}

function normalizeChome(name) {
  const halfWidth = toHalfWidthDigits(String(name || "").trim());

  return halfWidth.replace(/([\u3007\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u53430-9]+)\u4e01\u76ee/g, (_, rawNumber) => {
    if (/^[0-9]+$/.test(rawNumber)) {
      return `${Number.parseInt(rawNumber, 10)}\u4e01\u76ee`;
    }

    return `${kanjiNumberToInt(rawNumber)}\u4e01\u76ee`;
  });
}

function normalizeMatchText(value) {
  return normalizeChome(String(value || ""))
    .replace(/\s+/g, "")
    .replace(/\u30f6/g, "\u30b1")
    .replace(/\u4e4b/g, "\u306e")
    .trim();
}

function simplifyFeature(feature) {
  const props = feature.properties || {};
  const prefName = String(props.PREF_NAME || "");
  const cityName = String(props.CITY_NAME || "");
  const townName = String(props.S_NAME || "");
  const townNameArabic = normalizeChome(townName);

  return {
    type: "Feature",
    properties: {
      key_code: String(props.KEY_CODE || ""),
      hcode: Number(props.HCODE || 0),
      pref_name: prefName,
      city_name: cityName,
      town_name: townName,
      town_name_arabic: townNameArabic,
      full_name: `${cityName}${townName}`,
      full_name_arabic: `${cityName}${townNameArabic}`,
      city_name_normalized: normalizeMatchText(cityName),
      town_name_normalized: normalizeMatchText(townName),
      town_name_arabic_normalized: normalizeMatchText(townNameArabic),
      full_name_normalized: normalizeMatchText(`${cityName}${townName}`),
      full_name_arabic_normalized: normalizeMatchText(`${cityName}${townNameArabic}`),
      x_code: Number(props.X_CODE || 0),
      y_code: Number(props.Y_CODE || 0),
    },
    geometry: feature.geometry,
  };
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath || !outputPath) {
    throw new Error("Usage: node tools/build-sapporo-area-boundaries.mjs <input.geojson> <output.geojson>");
  }

  const source = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const features = Array.isArray(source.features) ? source.features : [];

  const transformed = {
    type: "FeatureCollection",
    name: "sapporo_area_boundaries",
    crs_note: "Source GeoPackage coordinates are JGD2011 (EPSG:6668) longitude/latitude and are compatible with EPSG:4326 display.",
    feature_count: features.length,
    generated_at: new Date().toISOString(),
    features: features.map(simplifyFeature),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const serialized = JSON.stringify(transformed);
  await fs.writeFile(outputPath, serialized);

  const jsOutputPath = outputPath.replace(/\.geojson$/i, ".js");
  if (jsOutputPath !== outputPath) {
    await fs.writeFile(jsOutputPath, `window.SAPPORO_AREA_BOUNDARIES = ${serialized};\n`);
  }

  console.log(`Wrote ${features.length} features to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
