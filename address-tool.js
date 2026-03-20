const ADDRESS_TOOL_STORAGE_KEY = "addressToolCsvInputV1";
const MUNICIPALITY_FILTER_STORAGE_KEY = "addressToolMunicipalityFilterV1";
const REQUIRED_COLUMNS = ["pref", "city", "ward", "oaza_cho", "machiaza_type", "chome_number"];
const MAX_PERSISTED_CSV_LENGTH = 150000;

const csvInput = document.getElementById("csv-input");
const municipalityFilterInput = document.getElementById("municipality-filter");
const column1Output = document.getElementById("column1-output");
const column2Output = document.getElementById("column2-output");
const column3Output = document.getElementById("column3-output");
const statusEl = document.getElementById("status");
const processedCountEl = document.getElementById("processed-count");
const outputCountEl = document.getElementById("output-count");

function normalizeValue(value) {
    return value == null ? "" : String(value).trim();
}

function normalizeMunicipalityName(value) {
    return normalizeValue(value).replace(/[\s　]+/g, "");
}

function setStatus(message, type = "") {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`.trim();
}

function setCounts(processed, output) {
    processedCountEl.textContent = String(processed);
    outputCountEl.textContent = String(output);
}

function getStoredValue(key) {
    try {
        return localStorage.getItem(key);
    } catch (_error) {
        return null;
    }
}

function removeStoredValue(key) {
    try {
        localStorage.removeItem(key);
    } catch (_error) {
        // 何もしない
    }
}

function isQuotaExceededError(error) {
    return error instanceof DOMException && (
        error.name === "QuotaExceededError" ||
        error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        error.code === 22 ||
        error.code === 1014
    );
}

function persistCsvInput(rawCsv) {
    if (!rawCsv) {
        removeStoredValue(ADDRESS_TOOL_STORAGE_KEY);
        return "";
    }

    if (rawCsv.length > MAX_PERSISTED_CSV_LENGTH) {
        removeStoredValue(ADDRESS_TOOL_STORAGE_KEY);
        return "CSVが大きいため入力内容の自動保存をスキップしました。";
    }

    try {
        localStorage.setItem(ADDRESS_TOOL_STORAGE_KEY, rawCsv);
        return "";
    } catch (error) {
        if (isQuotaExceededError(error)) {
            removeStoredValue(ADDRESS_TOOL_STORAGE_KEY);
            return "ブラウザ保存領域が不足しているため入力内容の自動保存をスキップしました。";
        }
        throw error;
    }
}

function persistMunicipalityFilter(filterValue) {
    if (!filterValue) {
        removeStoredValue(MUNICIPALITY_FILTER_STORAGE_KEY);
        return;
    }

    try {
        localStorage.setItem(MUNICIPALITY_FILTER_STORAGE_KEY, filterValue);
    } catch (_error) {
        // フィルター保存に失敗しても抽出処理は継続する
    }
}

function appendStorageNotice(message, notice) {
    return notice ? `${message} ${notice}` : message;
}

function restoreInput() {
    const savedCsv = getStoredValue(ADDRESS_TOOL_STORAGE_KEY);
    const savedFilter = getStoredValue(MUNICIPALITY_FILTER_STORAGE_KEY);

    if (savedCsv && csvInput) {
        csvInput.value = savedCsv;
    }

    if (savedFilter && municipalityFilterInput) {
        municipalityFilterInput.value = savedFilter;
    }
}

function formatChome(type, chomeNumber) {
    if (normalizeValue(type) !== "2") {
        return "";
    }

    const normalizedChomeNumber = normalizeValue(chomeNumber);
    return normalizedChomeNumber ? `${normalizedChomeNumber}丁目` : "";
}

function formatChomeColumn(type) {
    return normalizeValue(type) === "1" ? "丁目" : "";
}

function joinAddressParts(parts) {
    return parts.map(normalizeValue).filter(Boolean).join("");
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const nextChar = text[index + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                cell += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = "";
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                index += 1;
            }
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
            continue;
        }

        cell += char;
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows.filter((currentRow) => currentRow.some((value) => normalizeValue(value) !== ""));
}

function buildColumnIndexMap(headerRow) {
    return headerRow.reduce((indexMap, name, index) => {
        indexMap[normalizeValue(name)] = index;
        return indexMap;
    }, {});
}

function ensureRequiredColumns(indexMap) {
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !Object.prototype.hasOwnProperty.call(indexMap, column));
    if (missingColumns.length > 0) {
        throw new Error(`必要な列が見つかりません: ${missingColumns.join(", ")}`);
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
    if (!normalizedFilter) {
        return true;
    }

    return buildMunicipalityCandidates(pref, city, ward).has(normalizedFilter);
}

function getFilterValue() {
    return municipalityFilterInput ? normalizeValue(municipalityFilterInput.value) : "";
}

function resetOutputs() {
    column1Output.value = "";
    column2Output.value = "";
    column3Output.value = "";
    setCounts(0, 0);
}

function extractAddresses() {
    const rawText = normalizeValue(csvInput.value);
    const municipalityFilter = getFilterValue();
    const storageNotice = persistCsvInput(csvInput.value);

    persistMunicipalityFilter(municipalityFilter);

    if (!rawText) {
        resetOutputs();
        setStatus(appendStorageNotice("CSVを貼り付けてください。", storageNotice), "error");
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

        const dataRows = parsedRows.slice(1);
        const filteredRows = dataRows.filter((row) => matchesMunicipalityFilter(
            municipalityFilter,
            row[indexMap.pref],
            row[indexMap.city],
            row[indexMap.ward]
        ));

        const detailedAddresses = [];
        const municipalityAddresses = [];
        const chomeColumnValues = [];

        filteredRows.forEach((row) => {
            const pref = normalizeValue(row[indexMap.pref]);
            const city = normalizeValue(row[indexMap.city]);
            const ward = normalizeValue(row[indexMap.ward]);
            const oazaCho = normalizeValue(row[indexMap.oaza_cho]);
            const machiazaType = normalizeValue(row[indexMap.machiaza_type]);
            const chomeNumber = normalizeValue(row[indexMap.chome_number]);

            const municipalityAddress = joinAddressParts([pref, city, ward]);
            const detailedAddress = joinAddressParts([
                pref,
                city,
                ward,
                oazaCho,
                formatChome(machiazaType, chomeNumber)
            ]);

            if (!municipalityAddress && !detailedAddress) {
                return;
            }

            detailedAddresses.push(detailedAddress);
            municipalityAddresses.push(municipalityAddress);
            chomeColumnValues.push(formatChomeColumn(machiazaType));
        });

        column1Output.value = detailedAddresses.join("\n");
        column2Output.value = municipalityAddresses.join("\n");
        column3Output.value = chomeColumnValues.join("\n");
        setCounts(filteredRows.length, detailedAddresses.length);
        setStatus(
            appendStorageNotice(
                municipalityFilter
                    ? `「${municipalityFilter}」に一致する住所を抽出しました（${detailedAddresses.length}件）。`
                    : `住所を抽出しました（${detailedAddresses.length}件）。`,
                storageNotice
            ),
            "success"
        );
    } catch (error) {
        resetOutputs();
        setStatus(appendStorageNotice(error.message || "抽出に失敗しました。", storageNotice), "error");
    }
}

function copyText(text, successMessage) {
    navigator.clipboard.writeText(text).then(() => {
        setStatus(successMessage, "success");
    }).catch(() => {
        setStatus("コピーに失敗しました。", "error");
    });
}

function copyResults() {
    const detailedLines = column1Output.value;
    const municipalityLines = column2Output.value;
    const chomeLines = column3Output.value;

    if (!detailedLines && !municipalityLines && !chomeLines) {
        setStatus("先に住所を抽出してください。", "error");
        return;
    }

    const detailedColumns = detailedLines.split("\n");
    const municipalityColumns = municipalityLines.split("\n");
    const chomeColumns = chomeLines.split("\n");
    const maxLength = Math.max(detailedColumns.length, municipalityColumns.length, chomeColumns.length);
    const tsv = Array.from(
        { length: maxLength },
        (_, index) => `${detailedColumns[index] || ""}\t${municipalityColumns[index] || ""}\t${chomeColumns[index] || ""}`
    ).join("\n");

    copyText(tsv, "抽出結果をコピーしました。");
}

function copyColumn(outputEl, columnLabel) {
    const text = outputEl.value;

    if (!text) {
        setStatus(`${columnLabel}にコピーする内容がありません。`, "error");
        return;
    }

    copyText(text, `${columnLabel}をコピーしました。`);
}

function clearAll() {
    csvInput.value = "";
    if (municipalityFilterInput) {
        municipalityFilterInput.value = "";
    }

    resetOutputs();
    removeStoredValue(ADDRESS_TOOL_STORAGE_KEY);
    removeStoredValue(MUNICIPALITY_FILTER_STORAGE_KEY);
    setStatus("入力と結果をクリアしました。", "success");
}

document.getElementById("extract-btn").addEventListener("click", extractAddresses);
document.getElementById("copy-results-btn").addEventListener("click", copyResults);
document.getElementById("copy-column1-btn").addEventListener("click", () => copyColumn(column1Output, "1列目"));
document.getElementById("copy-column2-btn").addEventListener("click", () => copyColumn(column2Output, "2列目"));
document.getElementById("copy-column3-btn").addEventListener("click", () => copyColumn(column3Output, "3列目"));
document.getElementById("clear-btn").addEventListener("click", clearAll);
document.addEventListener("DOMContentLoaded", restoreInput);
