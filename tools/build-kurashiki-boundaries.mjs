import fs from "node:fs/promises";
import path from "node:path";

function toHalfWidthDigits(value) {
  return value.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
}

function kanjiNumberToInt(input) {
  const digits = {
    "〇": 0,
    "零": 0,
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
  };
  const units = {
    "十": 10,
    "百": 100,
    "千": 1000,
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

  return halfWidth.replace(/([〇零一二三四五六七八九十百千0-9]+)丁目/g, (_, rawNumber) => {
    if (/^[0-9]+$/.test(rawNumber)) {
      return `${Number.parseInt(rawNumber, 10)}丁目`;
    }

    return `${kanjiNumberToInt(rawNumber)}丁目`;
  });
}

function normalizeMatchText(value) {
  return normalizeChome(String(value || ""))
    .replace(/\s+/g, "")
    .replace(/ヶ/g, "ケ")
    .replace(/之/g, "の")
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
    throw new Error("Usage: node tools/build-kurashiki-boundaries.mjs <input.geojson> <output.geojson>");
  }

  const source = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const features = Array.isArray(source.features) ? source.features : [];

  const transformed = {
    type: "FeatureCollection",
    name: "kurashiki_city_boundaries",
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
    await fs.writeFile(jsOutputPath, `window.KURASHIKI_CITY_BOUNDARIES = ${serialized};\n`);
  }

  console.log(`Wrote ${features.length} features to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
