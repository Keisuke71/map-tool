const ADDRESS_TOOL_STORAGE_KEY = "addressToolCsvInputV1";
const MUNICIPALITY_FILTER_STORAGE_KEY = "addressToolMunicipalityFilterV1";
const EXPECTED_HEADER = ["lg_code", "machiaza_id", "machiaza_type", "pref"];

const csvInput = document.getElementById("csv-input");
const municipalityFilterInput = document.getElementById("municipality-filter");
const column1Output = document.getElementById("column1-output");
const column2Output = document.getElementById("column2-output");
const statusEl = document.getElementById("status");
const processedCountEl = document.getElementById("processed-count");
const outputCountEl = document.getElementById("output-count");

const REQUIRED_COLUMNS = ["pref", "city", "ward", "oaza_cho", "machiaza_type", "chome_number"];

function restoreInput() {
    const saved = localStorage.getItem(ADDRESS_TOOL_STORAGE_KEY);
    if (saved && csvInput) {
        csvInput.value = saved;
    }

    const savedFilter = localStorage.getItem(MUNICIPALITY_FILTER_STORAGE_KEY);
    if (savedFilter && municipalityFilterInput) {
        municipalityFilterInput.value = savedFilter;
    }
}

function setStatus(message, type = "") {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`.trim();
}

function setCounts(processed, output) {
    processedCountEl.textContent = String(processed);
    outputCountEl.textContent = String(output);
}

function normalizeValue(value) {
    return value == null ? "" : String(value).trim();
}

function normalizeMunicipalityName(value) {
    return normalizeValue(value).replace(/[\s　]+/g, "");
}

function formatChome(type, chomeNumber) {
    if (normalizeValue(type) !== "2") return "";
    const normalized = normalizeValue(chomeNumber);
    if (!normalized) return "";
    return `${normalized}丁目`;
}

function joinAddressParts(parts) {
    return parts.map(normalizeValue).filter(Boolean).join("");
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = "";
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows.filter((currentRow) => currentRow.some((value) => normalizeValue(value) !== ""));
}

function maybeRemoveHeader(rows) {
    if (!rows.length) return rows;
    const firstRow = rows[0].map(normalizeValue);
    const isHeader = EXPECTED_HEADER.every((value, index) => firstRow[index] === value);
    return isHeader ? rows.slice(1) : rows;
}

function buildColumnIndexMap(headerRow) {
    const indexMap = {};
    headerRow.forEach((name, index) => {
        indexMap[normalizeValue(name)] = index;
    });
    return indexMap;
}

function ensureRequiredColumns(indexMap) {
    const missing = REQUIRED_COLUMNS.filter((column) => !Object.prototype.hasOwnProperty.call(indexMap, column));
    if (missing.length) {
        throw new Error(`必要な列が見つかりません: ${missing.join(", ")}`);
    }
}

function buildMunicipalityCandidates(pref, city, ward) {
    const normalizedPref = normalizeMunicipalityName(pref);
    const normalizedCity = normalizeMunicipalityName(city);
    const normalizedWard = normalizeMunicipalityName(ward);
    const candidates = new Set();

    if (normalizedCity) {
        candidates.add(normalizedCity);
    }
    if (normalizedCity && normalizedWard) {
        candidates.add(`${normalizedCity}${normalizedWard}`);
    }
    if (normalizedPref && normalizedCity) {
        candidates.add(`${normalizedPref}${normalizedCity}`);
    }
    if (normalizedPref && normalizedCity && normalizedWard) {
        candidates.add(`${normalizedPref}${normalizedCity}${normalizedWard}`);
    }

    return candidates;
}

function matchesMunicipalityFilter(filterValue, pref, city, ward) {
    const normalizedFilter = normalizeMunicipalityName(filterValue);
    if (!normalizedFilter) return true;

    const candidates = buildMunicipalityCandidates(pref, city, ward);
    return candidates.has(normalizedFilter);
}

function extractAddresses() {
    const rawText = csvInput.value.trim();
    const municipalityFilter = normalizeValue(municipalityFilterInput.value);
    localStorage.setItem(ADDRESS_TOOL_STORAGE_KEY, csvInput.value);
    localStorage.setItem(MUNICIPALITY_FILTER_STORAGE_KEY, municipalityFilter);

    if (!rawText) {
        column1Output.value = "";
        column2Output.value = "";
        setCounts(0, 0);
        setStatus("CSVを貼り付けてください。", "error");
        return;
    }

    try {
        const parsedRows = parseCsv(rawText);
        if (parsedRows.length < 2) {
            throw new Error("ヘッダー行とデータ行を含むCSVを貼り付けてください。");
        }

        const headerRow = parsedRows[0].map(normalizeValue);
        const indexMap = buildColumnIndexMap(headerRow);
        ensureRequiredColumns(indexMap);

        const dataRows = maybeRemoveHeader(parsedRows);
        const filteredRows = dataRows.filter((row) => matchesMunicipalityFilter(
            municipalityFilter,
            row[indexMap.pref],
            row[indexMap.city],
            row[indexMap.ward]
        ));
        const detailed = [];
        const cityLevel = [];

        filteredRows.forEach((row) => {
            const pref = normalizeValue(row[indexMap.pref]);
            const city = normalizeValue(row[indexMap.city]);
            const ward = normalizeValue(row[indexMap.ward]);
            const oazaCho = normalizeValue(row[indexMap.oaza_cho]);
            const machiazaType = normalizeValue(row[indexMap.machiaza_type]);
            const chomeNumber = normalizeValue(row[indexMap.chome_number]);

            const cityAddress = joinAddressParts([pref, city, ward]);
            const detailedAddress = joinAddressParts([pref, city, ward, oazaCho, formatChome(machiazaType, chomeNumber)]);

            if (!cityAddress && !detailedAddress) return;

            detailed.push(detailedAddress);
            cityLevel.push(cityAddress);
        });

        column1Output.value = detailed.join("\n");
        column2Output.value = cityLevel.join("\n");
        setCounts(filteredRows.length, detailed.length);
        setStatus(
            municipalityFilter
                ? `「${municipalityFilter}」に一致する住所を抽出しました（${detailed.length}件）。`
                : `住所を抽出しました（${detailed.length}件）。`,
            "success"
        );
    } catch (error) {
        column1Output.value = "";
        column2Output.value = "";
        setCounts(0, 0);
        setStatus(error.message || "抽出に失敗しました。", "error");
    }
}

function copyResults() {
    const lines1 = column1Output.value;
    const lines2 = column2Output.value;

    if (!lines1 && !lines2) {
        setStatus("先に住所を抽出してください。", "error");
        return;
    }

    const col1 = lines1.split("\n");
    const col2 = lines2.split("\n");
    const maxLength = Math.max(col1.length, col2.length);
    const tsv = Array.from({ length: maxLength }, (_, index) => `${col1[index] || ""}\t${col2[index] || ""}`).join("\n");

    navigator.clipboard.writeText(tsv).then(() => {
        setStatus("抽出結果をスプレッドシート貼り付け用にコピーしました。", "success");
    }).catch(() => {
        setStatus("コピーに失敗しました。", "error");
    });
}

function clearAll() {
    csvInput.value = "";
    municipalityFilterInput.value = "";
    column1Output.value = "";
    column2Output.value = "";
    localStorage.removeItem(ADDRESS_TOOL_STORAGE_KEY);
    localStorage.removeItem(MUNICIPALITY_FILTER_STORAGE_KEY);
    setCounts(0, 0);
    setStatus("入力と結果をクリアしました。", "success");
}

document.getElementById("extract-btn").addEventListener("click", extractAddresses);
document.getElementById("copy-results-btn").addEventListener("click", copyResults);
document.getElementById("clear-btn").addEventListener("click", clearAll);

document.addEventListener("DOMContentLoaded", restoreInput);
