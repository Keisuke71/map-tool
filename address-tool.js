const ADDRESS_TOOL_STORAGE_KEY = "addressToolCsvInputV1";
const MUNICIPALITY_FILTER_STORAGE_KEY = "addressToolMunicipalityFilterV1";
const BOUNDARY_DATASET_STORAGE_KEY = "addressToolBoundaryDatasetV1";
const REQUIRED_COLUMNS = ["pref", "city", "ward", "oaza_cho", "machiaza_type", "chome_number"];
const MAX_PERSISTED_CSV_LENGTH = 150000;

const csvInput = document.getElementById("csv-input");
const csvDropZone = document.getElementById("csv-drop-zone");
const municipalityFilterInput = document.getElementById("municipality-filter");
const boundaryDatasetSelect = document.getElementById("boundary-dataset-select");
const extractTabButton = document.getElementById("extract-tab-btn");
const duplicateTabButton = document.getElementById("duplicate-tab-btn");
const extractPanel = document.getElementById("extract-panel");
const duplicatePanel = document.getElementById("duplicate-panel");
const column1Output = document.getElementById("column1-output");
const column2Output = document.getElementById("column2-output");
const column3Output = document.getElementById("column3-output");
const abrOnlyOutput = document.getElementById("abr-only-output");
const boundaryOnlyOutput = document.getElementById("boundary-only-output");
const statusEl = document.getElementById("status");
const processedCountEl = document.getElementById("processed-count");
const outputCountEl = document.getElementById("output-count");
const abrOnlyCountEl = document.getElementById("abr-only-count");
const boundaryOnlyCountEl = document.getElementById("boundary-only-count");
const duplicateInput = document.getElementById("duplicate-input");
const duplicateOutput = document.getElementById("duplicate-output");
const duplicateStatusEl = document.getElementById("duplicate-status");
const duplicateTotalCountEl = document.getElementById("duplicate-total-count");
const duplicateAddressCountEl = document.getElementById("duplicate-address-count");
const duplicateExtraCountEl = document.getElementById("duplicate-extra-count");
const boundaryDatasetCache = new Map();
const boundaryDatasetPendingLoads = new Map();

function normalizeValue(value) {
    return value == null ? "" : String(value).trim();
}

function normalizeMunicipalityName(value) {
    return normalizeValue(value).replace(/[\s　]+/g, "");
}

function parseMunicipalityFilters(value) {
    return Array.from(new Set(
        normalizeValue(value)
            .split(/[\r\n,、;；]+/)
            .map((part) => normalizeMunicipalityName(part))
            .filter(Boolean)
    ));
}

function setStatus(message, type = "") {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`.trim();
}

function setCounts(processed, output) {
    processedCountEl.textContent = String(processed);
    outputCountEl.textContent = String(output);
}

function setDuplicateStatus(message, type = "") {
    if (!duplicateStatusEl) {
        return;
    }

    duplicateStatusEl.textContent = message;
    duplicateStatusEl.className = `status ${type}`.trim();
}

function setDuplicateCounts(totalCount, duplicateAddressCount, duplicateExtraCount) {
    if (duplicateTotalCountEl) {
        duplicateTotalCountEl.textContent = String(totalCount);
    }

    if (duplicateAddressCountEl) {
        duplicateAddressCountEl.textContent = String(duplicateAddressCount);
    }

    if (duplicateExtraCountEl) {
        duplicateExtraCountEl.textContent = String(duplicateExtraCount);
    }
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

function persistBoundaryDatasetSelection(datasetKey) {
    if (!datasetKey) {
        removeStoredValue(BOUNDARY_DATASET_STORAGE_KEY);
        return;
    }

    try {
        localStorage.setItem(BOUNDARY_DATASET_STORAGE_KEY, datasetKey);
    } catch (_error) {
        // 保存に失敗しても操作は継続する
    }
}

function appendStorageNotice(message, notice) {
    return notice ? `${message} ${notice}` : message;
}

function setDropZoneActive(isActive) {
    if (!csvDropZone) {
        return;
    }

    csvDropZone.classList.toggle("is-dragover", Boolean(isActive));
}

function readCsvFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(typeof reader.result === "string" ? reader.result : "");
        };
        reader.onerror = () => {
            reject(new Error("CSVファイルの読み込みに失敗しました。"));
        };
        reader.readAsText(file, "utf-8");
    });
}

async function loadCsvFile(file) {
    if (!file) {
        setStatus("CSVファイルを選択してください。", "error");
        return;
    }

    const fileName = normalizeValue(file.name);
    if (fileName && !/\.csv$/i.test(fileName) && normalizeValue(file.type) !== "text/csv") {
        setStatus("CSVファイルをドロップしてください。", "error");
        return;
    }

    try {
        const fileText = await readCsvFile(file);
        csvInput.value = fileText;
        const storageNotice = persistCsvInput(fileText);
        resetOutputs();
        resetComparisonOutputs();
        setStatus(
            appendStorageNotice(
                fileName ? `CSVファイル「${fileName}」を読み込みました。` : "CSVファイルを読み込みました。",
                storageNotice
            ),
            "success"
        );
    } catch (error) {
        setStatus(error.message || "CSVファイルの読み込みに失敗しました。", "error");
    }
}

function handleDropZoneDragOver(event) {
    event.preventDefault();
    setDropZoneActive(true);
}

function handleDropZoneDragLeave(event) {
    if (!csvDropZone || csvDropZone.contains(event.relatedTarget)) {
        return;
    }

    setDropZoneActive(false);
}

function handleDropZoneDrop(event) {
    event.preventDefault();
    setDropZoneActive(false);

    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) {
        setStatus("ドロップされたファイルを確認できませんでした。", "error");
        return;
    }

    loadCsvFile(files[0]);
}

function restoreInput() {
    const savedCsv = getStoredValue(ADDRESS_TOOL_STORAGE_KEY);
    const savedFilter = getStoredValue(MUNICIPALITY_FILTER_STORAGE_KEY);
    const savedDatasetKey = getStoredValue(BOUNDARY_DATASET_STORAGE_KEY);

    if (savedCsv && csvInput) {
        csvInput.value = savedCsv;
    }

    if (savedFilter && municipalityFilterInput) {
        municipalityFilterInput.value = savedFilter;
    }

    if (savedDatasetKey && boundaryDatasetSelect) {
        boundaryDatasetSelect.value = savedDatasetKey;
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
    return normalizeValue(type) === "2" ? "" : "丁目";
}

function joinAddressParts(parts) {
    return parts.map(normalizeValue).filter(Boolean).join("");
}

function normalizeTownNameWithoutOazaAza(value) {
    let normalized = normalizeValue(value);

    while (/^(大字|字)/.test(normalized)) {
        normalized = normalized.replace(/^(大字|字)/, "");
    }

    return normalized;
}

function normalizeAddressComparisonKey(value) {
    return normalizeValue(value).replace(/[\s　]+/g, "");
}

function sortAddressRows(rows) {
    return rows
        .slice()
        .sort((a, b) => normalizeValue(a.detailedAddress).localeCompare(normalizeValue(b.detailedAddress), "ja"));
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
    const normalizedFilters = parseMunicipalityFilters(filterValue);
    if (!normalizedFilters.length) {
        return true;
    }

    const candidates = buildMunicipalityCandidates(pref, city, ward);
    return normalizedFilters.some((normalizedFilter) => candidates.has(normalizedFilter));
}

function getFilterValue() {
    return municipalityFilterInput ? normalizeValue(municipalityFilterInput.value) : "";
}

function switchToolTab(tabName) {
    const isDuplicateTab = tabName === "duplicate";

    if (extractTabButton) {
        extractTabButton.classList.toggle("is-active", !isDuplicateTab);
    }

    if (duplicateTabButton) {
        duplicateTabButton.classList.toggle("is-active", isDuplicateTab);
    }

    if (extractPanel) {
        extractPanel.classList.toggle("is-active", !isDuplicateTab);
    }

    if (duplicatePanel) {
        duplicatePanel.classList.toggle("is-active", isDuplicateTab);
    }
}

function setComparisonCounts(abrOnlyCount, boundaryOnlyCount) {
    if (abrOnlyCountEl) {
        abrOnlyCountEl.textContent = String(abrOnlyCount);
    }

    if (boundaryOnlyCountEl) {
        boundaryOnlyCountEl.textContent = String(boundaryOnlyCount);
    }
}

function getBoundaryDatasetDefinitions() {
    return Array.isArray(window.TOWN_BOUNDARY_DATASET_DEFINITIONS)
        ? window.TOWN_BOUNDARY_DATASET_DEFINITIONS.slice()
        : [];
}

function populateBoundaryDatasetSelect() {
    if (!boundaryDatasetSelect) {
        return;
    }

    const currentValue = normalizeValue(boundaryDatasetSelect.value);
    const definitions = getBoundaryDatasetDefinitions()
        .sort((a, b) => normalizeValue(a.label).localeCompare(normalizeValue(b.label), "ja"));

    boundaryDatasetSelect.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "境界データを選択してください";
    boundaryDatasetSelect.appendChild(placeholderOption);

    definitions.forEach((definition) => {
        const option = document.createElement("option");
        option.value = definition.key;
        option.textContent = definition.label || definition.key;
        boundaryDatasetSelect.appendChild(option);
    });

    if (currentValue && definitions.some((definition) => definition.key === currentValue)) {
        boundaryDatasetSelect.value = currentValue;
    }
}

function findBoundaryDatasetDefinitionByKey(datasetKey) {
    return getBoundaryDatasetDefinitions().find((definition) => definition.key === datasetKey) || null;
}

function ensureBoundaryDataset(definition) {
    if (!definition || !definition.key || !definition.scriptPath || !definition.globalName) {
        return Promise.reject(new Error("境界データ定義が不正です。"));
    }

    const existingData = window[definition.globalName];
    if (existingData) {
        boundaryDatasetCache.set(definition.key, existingData);
        return Promise.resolve(existingData);
    }

    if (boundaryDatasetCache.has(definition.key)) {
        return Promise.resolve(boundaryDatasetCache.get(definition.key));
    }

    if (boundaryDatasetPendingLoads.has(definition.key)) {
        return boundaryDatasetPendingLoads.get(definition.key);
    }

    const pending = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = definition.scriptPath;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            const loadedData = window[definition.globalName];
            if (!loadedData) {
                reject(new Error(`境界データが登録されませんでした: ${definition.globalName}`));
                return;
            }

            boundaryDatasetCache.set(definition.key, loadedData);
            resolve(loadedData);
        };
        script.onerror = () => {
            reject(new Error(`境界データの読込に失敗しました: ${definition.scriptPath}`));
        };
        document.head.appendChild(script);
    }).finally(() => {
        boundaryDatasetPendingLoads.delete(definition.key);
    });

    boundaryDatasetPendingLoads.set(definition.key, pending);
    return pending;
}

function splitCityAndWard(cityName) {
    const normalizedCityName = normalizeValue(cityName);
    const match = normalizedCityName.match(/^(.*?市)(.+区)$/);

    if (!match) {
        return { city: normalizedCityName, ward: "" };
    }

    return { city: match[1], ward: match[2] };
}

function getBoundaryTownName(properties) {
    return normalizeValue(
        properties && (properties.town_name_arabic || properties.town_name || properties.full_name_arabic || properties.full_name)
    );
}

function getBoundaryRecordKey(properties) {
    const keyCode = normalizeValue(properties && properties.key_code);
    if (keyCode) {
        return keyCode;
    }

    return [
        normalizeValue(properties && properties.pref_name),
        normalizeValue(properties && properties.city_name),
        getBoundaryTownName(properties)
    ].join("|");
}

function buildBoundaryAddressRows(features, municipalityFilter) {
    const uniqueRows = new Map();

    features.forEach((feature) => {
        const properties = feature && feature.properties ? feature.properties : {};
        const pref = normalizeValue(properties.pref_name);
        const cityName = normalizeValue(properties.city_name);
        const townName = getBoundaryTownName(properties);

        if (!pref && !cityName && !townName) {
            return;
        }

        const { city, ward } = splitCityAndWard(cityName);
        if (!matchesMunicipalityFilter(municipalityFilter, pref, city, ward)) {
            return;
        }

        const recordKey = getBoundaryRecordKey(properties);
        if (uniqueRows.has(recordKey)) {
            return;
        }

        uniqueRows.set(recordKey, {
            detailedAddress: joinAddressParts([pref, cityName, townName]),
            detailedAddressWithoutOazaAza: joinAddressParts([pref, cityName, normalizeTownNameWithoutOazaAza(townName)]),
            municipalityAddress: joinAddressParts([pref, cityName]),
            chomeColumnValue: townName.includes("丁目") ? "" : "丁目"
        });
    });

    return sortAddressRows(
        Array.from(uniqueRows.values())
            .filter((row) => row.detailedAddress || row.municipalityAddress)
    );
}

function resetOutputs() {
    column1Output.value = "";
    column1Output.dataset.withoutOazaAza = "";
    column2Output.value = "";
    column3Output.value = "";
    setCounts(0, 0);
}

function resetComparisonOutputs() {
    if (abrOnlyOutput) {
        abrOnlyOutput.value = "";
    }

    if (boundaryOnlyOutput) {
        boundaryOnlyOutput.value = "";
    }

    setComparisonCounts(0, 0);
}

function resetDuplicateOutputs() {
    if (duplicateOutput) {
        duplicateOutput.value = "";
    }

    setDuplicateCounts(0, 0, 0);
    setDuplicateStatus("", "");
}

function setMainOutputs(rows, processedCount) {
    column1Output.value = rows.map((row) => row.detailedAddress).join("\n");
    column1Output.dataset.withoutOazaAza = rows
        .map((row) => row.detailedAddressWithoutOazaAza || row.detailedAddress)
        .join("\n");
    column2Output.value = rows.map((row) => row.municipalityAddress).join("\n");
    column3Output.value = rows.map((row) => row.chomeColumnValue).join("\n");
    setCounts(processedCount, rows.length);
}

function setComparisonOutputs(abrOnlyRows, boundaryOnlyRows) {
    if (abrOnlyOutput) {
        abrOnlyOutput.value = abrOnlyRows.map((row) => row.detailedAddress).join("\n");
    }

    if (boundaryOnlyOutput) {
        boundaryOnlyOutput.value = boundaryOnlyRows.map((row) => row.detailedAddress).join("\n");
    }

    setComparisonCounts(abrOnlyRows.length, boundaryOnlyRows.length);
}

function parseDuplicateInputLines(rawText) {
    return normalizeValue(rawText)
        .split(/\r?\n/)
        .map((line) => normalizeValue(line))
        .filter(Boolean);
}

function buildCsvAddressRows(rawText, municipalityFilter) {
    const normalizedText = normalizeValue(rawText);
    if (!normalizedText) {
        throw new Error("CSVを貼り付けてください。");
    }

    const parsedRows = parseCsv(normalizedText);
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

    const rows = [];

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

        rows.push({
            detailedAddress,
            detailedAddressWithoutOazaAza: joinAddressParts([
                pref,
                city,
                ward,
                normalizeTownNameWithoutOazaAza(oazaCho),
                formatChome(machiazaType, chomeNumber)
            ]),
            municipalityAddress,
            chomeColumnValue: formatChomeColumn(machiazaType)
        });
    });

    return {
        filteredRowCount: filteredRows.length,
        rows
    };
}

function buildUniqueAddressRows(rows) {
    const uniqueRows = new Map();

    rows.forEach((row) => {
        const comparisonKey = normalizeAddressComparisonKey(row && row.detailedAddress);
        if (!comparisonKey || uniqueRows.has(comparisonKey)) {
            return;
        }

        uniqueRows.set(comparisonKey, row);
    });

    return uniqueRows;
}

async function buildAllBoundaryAddressRows(municipalityFilter) {
    const definitions = getBoundaryDatasetDefinitions();
    const results = await Promise.all(definitions.map(async (definition) => {
        const data = await ensureBoundaryDataset(definition);
        const features = Array.isArray(data && data.features) ? data.features : [];
        return {
            definition,
            rows: buildBoundaryAddressRows(features, municipalityFilter)
        };
    }));

    const matchedDefinitions = results.filter((result) => result.rows.length > 0);
    const uniqueRows = new Map();

    matchedDefinitions.forEach((result) => {
        result.rows.forEach((row) => {
            const comparisonKey = normalizeAddressComparisonKey(row.detailedAddress);
            if (!comparisonKey || uniqueRows.has(comparisonKey)) {
                return;
            }

            uniqueRows.set(comparisonKey, row);
        });
    });

    return {
        labels: matchedDefinitions.map((result) => result.definition.label || result.definition.key),
        rows: sortAddressRows(Array.from(uniqueRows.values()))
    };
}

function extractAddresses() {
    const rawText = normalizeValue(csvInput.value);
    const municipalityFilter = getFilterValue();
    const storageNotice = persistCsvInput(csvInput.value);

    persistMunicipalityFilter(municipalityFilter);

    if (!rawText) {
        resetOutputs();
        resetComparisonOutputs();
        setStatus(appendStorageNotice("CSVを貼り付けてください。", storageNotice), "error");
        return;
    }

    try {
        const { filteredRowCount, rows } = buildCsvAddressRows(rawText, municipalityFilter);
        setMainOutputs(rows, filteredRowCount);
        resetComparisonOutputs();
        setStatus(
            appendStorageNotice(
                municipalityFilter
                    ? `「${municipalityFilter}」に一致する住所を抽出しました（${rows.length}件）。`
                    : `住所を抽出しました（${rows.length}件）。`,
                storageNotice
            ),
            "success"
        );
    } catch (error) {
        resetOutputs();
        resetComparisonOutputs();
        setStatus(appendStorageNotice(error.message || "抽出に失敗しました。", storageNotice), "error");
    }
}

async function buildAddressesFromBoundaryDataset() {
    const selectedDatasetKey = boundaryDatasetSelect ? normalizeValue(boundaryDatasetSelect.value) : "";
    const municipalityFilter = getFilterValue();
    const definition = findBoundaryDatasetDefinitionByKey(selectedDatasetKey);

    persistMunicipalityFilter(municipalityFilter);
    persistBoundaryDatasetSelection(selectedDatasetKey);

    if (!definition) {
        setStatus("境界データを選択してください。", "error");
        return;
    }

    setStatus(`境界データ「${definition.label || definition.key}」を読み込んでいます...`);

    try {
        const data = await ensureBoundaryDataset(definition);
        const features = Array.isArray(data && data.features) ? data.features : [];
        const rows = buildBoundaryAddressRows(features, municipalityFilter);

        if (!rows.length) {
            resetOutputs();
            resetComparisonOutputs();
            setStatus(
                municipalityFilter
                    ? `境界データ「${definition.label || definition.key}」内に「${municipalityFilter}」に一致する住所がありません。`
                    : `境界データ「${definition.label || definition.key}」から作成できる住所がありません。`,
                "error"
            );
            return;
        }

        setMainOutputs(rows, rows.length);
        resetComparisonOutputs();
        setStatus(
            municipalityFilter
                ? `境界データ「${definition.label || definition.key}」から「${municipalityFilter}」に一致する住所を作成しました（${rows.length}件）。`
                : `境界データ「${definition.label || definition.key}」から住所を作成しました（${rows.length}件）。`,
            "success"
        );
    } catch (error) {
        resetOutputs();
        resetComparisonOutputs();
        setStatus(error.message || "境界データからの作成に失敗しました。", "error");
    }
}

async function compareWithExistingBoundaryData() {
    const rawText = normalizeValue(csvInput.value);
    const municipalityFilter = getFilterValue();
    const storageNotice = persistCsvInput(csvInput.value);

    persistMunicipalityFilter(municipalityFilter);

    if (!rawText) {
        resetComparisonOutputs();
        setStatus(appendStorageNotice("比較するには先にCSVを貼り付けてください。", storageNotice), "error");
        return;
    }

    if (!municipalityFilter) {
        resetComparisonOutputs();
        setStatus(appendStorageNotice("比較するには抽出対象の市町村名を入力してください。", storageNotice), "error");
        return;
    }

    setStatus(`「${municipalityFilter}」のABR住所一覧と既存境界データを比較しています...`);

    try {
        const csvResult = buildCsvAddressRows(rawText, municipalityFilter);
        const abrRows = sortAddressRows(Array.from(buildUniqueAddressRows(csvResult.rows).values()));
        if (!abrRows.length) {
            resetComparisonOutputs();
            setStatus(
                appendStorageNotice(`CSV内に「${municipalityFilter}」に一致する住所がありません。`, storageNotice),
                "error"
            );
            return;
        }

        const boundaryResult = await buildAllBoundaryAddressRows(municipalityFilter);
        const boundaryRows = boundaryResult.rows;
        const abrMap = buildUniqueAddressRows(abrRows);
        const boundaryMap = buildUniqueAddressRows(boundaryRows);
        const abrOnlyRows = sortAddressRows(
            Array.from(abrMap.entries())
                .filter(([comparisonKey]) => !boundaryMap.has(comparisonKey))
                .map(([, row]) => row)
        );
        const boundaryOnlyRows = sortAddressRows(
            Array.from(boundaryMap.entries())
                .filter(([comparisonKey]) => !abrMap.has(comparisonKey))
                .map(([, row]) => row)
        );

        setComparisonOutputs(abrOnlyRows, boundaryOnlyRows);

        const sourceLabel = boundaryResult.labels.length
            ? `既存データ: ${boundaryResult.labels.join(" / ")}`
            : "既存データ側に一致する境界データはありませんでした";
        setStatus(
            appendStorageNotice(
                `比較が完了しました。ABRのみ ${abrOnlyRows.length}件 / 既存データのみ ${boundaryOnlyRows.length}件。${sourceLabel}。`,
                storageNotice
            ),
            "success"
        );
    } catch (error) {
        resetComparisonOutputs();
        setStatus(appendStorageNotice(error.message || "差分比較に失敗しました。", storageNotice), "error");
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

function copyColumn1WithoutOazaAza() {
    const text = normalizeValue(column1Output.dataset.withoutOazaAza);

    if (!text) {
        setStatus("1列目にコピーする内容がありません。", "error");
        return;
    }

    copyText(text, "1列目（大字・字なし）をコピーしました。");
}

function checkDuplicates() {
    const rawText = duplicateInput ? duplicateInput.value : "";
    const lines = parseDuplicateInputLines(rawText);

    if (!lines.length) {
        resetDuplicateOutputs();
        setDuplicateStatus("住所一覧を貼り付けてください。", "error");
        return;
    }

    const counts = new Map();
    lines.forEach((line) => {
        counts.set(line, (counts.get(line) || 0) + 1);
    });

    const duplicateEntries = Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .sort((a, b) => {
            if (b[1] !== a[1]) {
                return b[1] - a[1];
            }

            return a[0].localeCompare(b[0], "ja");
        });
    const duplicateExtraCount = duplicateEntries.reduce((sum, [, count]) => sum + (count - 1), 0);

    if (duplicateOutput) {
        duplicateOutput.value = duplicateEntries
            .map(([address, count]) => `${address}\t${count}件`)
            .join("\n");
    }

    setDuplicateCounts(lines.length, duplicateEntries.length, duplicateExtraCount);
    setDuplicateStatus(
        duplicateEntries.length
            ? `重複を検出しました。重複住所数 ${duplicateEntries.length}件 / 重複行数 ${duplicateExtraCount}件。`
            : "重複は見つかりませんでした。",
        "success"
    );
}

function copyDuplicateResults() {
    const text = duplicateOutput ? normalizeValue(duplicateOutput.value) : "";

    if (!text) {
        setDuplicateStatus("コピーする重複一覧がありません。", "error");
        return;
    }

    copyText(text, "重複一覧をコピーしました。");
    setDuplicateStatus("重複一覧をコピーしました。", "success");
}

function clearDuplicateChecker() {
    if (duplicateInput) {
        duplicateInput.value = "";
    }

    resetDuplicateOutputs();
    setDuplicateStatus("重複チェックをクリアしました。", "success");
}

function clearAll() {
    csvInput.value = "";
    if (municipalityFilterInput) {
        municipalityFilterInput.value = "";
    }
    if (boundaryDatasetSelect) {
        boundaryDatasetSelect.value = "";
    }

    resetOutputs();
    resetComparisonOutputs();
    removeStoredValue(ADDRESS_TOOL_STORAGE_KEY);
    removeStoredValue(MUNICIPALITY_FILTER_STORAGE_KEY);
    removeStoredValue(BOUNDARY_DATASET_STORAGE_KEY);
    setStatus("入力と結果をクリアしました。", "success");
}

function initializeAddressTool() {
    populateBoundaryDatasetSelect();
    restoreInput();
    switchToolTab("extract");
    resetDuplicateOutputs();

    if (csvDropZone) {
        csvDropZone.addEventListener("dragenter", () => setDropZoneActive(true));
        csvDropZone.addEventListener("dragover", handleDropZoneDragOver);
        csvDropZone.addEventListener("dragleave", handleDropZoneDragLeave);
        csvDropZone.addEventListener("drop", handleDropZoneDrop);
    }
}

document.getElementById("extract-btn").addEventListener("click", extractAddresses);
document.getElementById("build-from-boundary-btn").addEventListener("click", buildAddressesFromBoundaryDataset);
document.getElementById("compare-btn").addEventListener("click", compareWithExistingBoundaryData);
document.getElementById("copy-results-btn").addEventListener("click", copyResults);
document.getElementById("copy-column1-btn").addEventListener("click", () => copyColumn(column1Output, "1列目"));
document.getElementById("copy-column1-without-oaza-btn").addEventListener("click", copyColumn1WithoutOazaAza);
document.getElementById("copy-column2-btn").addEventListener("click", () => copyColumn(column2Output, "2列目"));
document.getElementById("copy-column3-btn").addEventListener("click", () => copyColumn(column3Output, "3列目"));
document.getElementById("copy-abr-only-btn").addEventListener("click", () => copyColumn(abrOnlyOutput, "ABR差分"));
document.getElementById("copy-boundary-only-btn").addEventListener("click", () => copyColumn(boundaryOnlyOutput, "既存データ差分"));
document.getElementById("clear-btn").addEventListener("click", clearAll);
document.getElementById("check-duplicates-btn").addEventListener("click", checkDuplicates);
document.getElementById("copy-duplicate-results-btn").addEventListener("click", copyDuplicateResults);
document.getElementById("clear-duplicate-btn").addEventListener("click", clearDuplicateChecker);
if (extractTabButton) {
    extractTabButton.addEventListener("click", () => switchToolTab("extract"));
}
if (duplicateTabButton) {
    duplicateTabButton.addEventListener("click", () => switchToolTab("duplicate"));
}
if (boundaryDatasetSelect) {
    boundaryDatasetSelect.addEventListener("change", () => {
        persistBoundaryDatasetSelection(boundaryDatasetSelect.value);
    });
}
document.addEventListener("DOMContentLoaded", initializeAddressTool);
