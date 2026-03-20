const ADDRESS_TOOL_STORAGE_KEY = "addressToolCsvInputV1";
const EXPECTED_HEADER = ["lg_code", "machiaza_id", "machiaza_type", "pref"];

const csvInput = document.getElementById("csv-input");
const column1Output = document.getElementById("column1-output");
const column2Output = document.getElementById("column2-output");
const column3Output = document.getElementById("column3-output");
const statusEl = document.getElementById("status");
const processedCountEl = document.getElementById("processed-count");
const outputCountEl = document.getElementById("output-count");

const REQUIRED_COLUMNS = ["pref", "city", "ward", "oaza_cho", "machiaza_type", "chome_number"];

function restoreInput() {
    const saved = localStorage.getItem(ADDRESS_TOOL_STORAGE_KEY);
    if (saved && csvInput) {
        csvInput.value = saved;
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

function formatChome(type, chomeNumber) {
    if (normalizeValue(type) !== "2") return "";
    const normalized = normalizeValue(chomeNumber);
    if (!normalized) return "";
    return `${normalized}丁目`;
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

function extractAddresses() {
    const rawText = csvInput.value.trim();
    localStorage.setItem(ADDRESS_TOOL_STORAGE_KEY, csvInput.value);

    if (!rawText) {
        column1Output.value = "";
        column2Output.value = "";
        column3Output.value = "";
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
        const detailed = [];
        const cityLevel = [];
        const chomeColumn = [];

        dataRows.forEach((row) => {
            const pref = normalizeValue(row[indexMap.pref]);
            const city = normalizeValue(row[indexMap.city]);
            const ward = normalizeValue(row[indexMap.ward]);
            const oazaCho = normalizeValue(row[indexMap.oaza_cho]);
            const machiazaType = normalizeValue(row[indexMap.machiaza_type]);
            const chomeNumber = normalizeValue(row[indexMap.chome_number]);

            const cityAddress = joinAddressParts([pref, city, ward]);
            const detailedAddress = joinAddressParts([pref, city, ward, oazaCho, formatChome(machiazaType, chomeNumber)]);
            const chomeValue = formatChomeColumn(machiazaType);

            if (!cityAddress && !detailedAddress) return;

            detailed.push(detailedAddress);
            cityLevel.push(cityAddress);
            chomeColumn.push(chomeValue);
        });

        column1Output.value = detailed.join("\n");
        column2Output.value = cityLevel.join("\n");
        column3Output.value = chomeColumn.join("\n");
        setCounts(dataRows.length, detailed.length);
        setStatus(`住所を抽出しました（${detailed.length}件）。`, "success");
    } catch (error) {
        column1Output.value = "";
        column2Output.value = "";
        column3Output.value = "";
        setCounts(0, 0);
        setStatus(error.message || "抽出に失敗しました。", "error");
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
    const lines1 = column1Output.value;
    const lines2 = column2Output.value;
    const lines3 = column3Output.value;

    if (!lines1 && !lines2 && !lines3) {
        setStatus("先に住所を抽出してください。", "error");
        return;
    }

    const col1 = lines1.split("\n");
    const col2 = lines2.split("\n");
    const col3 = lines3.split("\n");
    const maxLength = Math.max(col1.length, col2.length, col3.length);
    const tsv = Array.from(
        { length: maxLength },
        (_, index) => `${col1[index] || ""}\t${col2[index] || ""}\t${col3[index] || ""}`
    ).join("\n");

    copyText(tsv, "抽出結果をスプレッドシート貼り付け用にコピーしました。");
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
    column1Output.value = "";
    column2Output.value = "";
    column3Output.value = "";
    localStorage.removeItem(ADDRESS_TOOL_STORAGE_KEY);
    setCounts(0, 0);
    setStatus("入力と結果をクリアしました。", "success");
}

document.getElementById("extract-btn").addEventListener("click", extractAddresses);
document.getElementById("copy-results-btn").addEventListener("click", copyResults);
document.getElementById("copy-column1-btn").addEventListener("click", () => copyColumn(column1Output, "1列目"));
document.getElementById("copy-column2-btn").addEventListener("click", () => copyColumn(column2Output, "2列目"));
document.getElementById("copy-column3-btn").addEventListener("click", () => copyColumn(column3Output, "3列目"));
document.getElementById("clear-btn").addEventListener("click", clearAll);

document.addEventListener("DOMContentLoaded", restoreInput);
