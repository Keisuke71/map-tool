/* =========================================
   APIキー管理と初期化処理
   ========================================= */
const STORAGE_KEY_API = "googleMapsApiKey";
const STORAGE_KEY_AUTO_RADIUS = "autoRadiusEnabled";
const STORAGE_KEY_LAYOUT = "layoutMode";
const STORAGE_KEY_LIST_DATA = "mapToolListDataV1";
const STORAGE_KEY_ADDRESS_COL = "mapToolAddressColumnV1";
const STORAGE_KEY_OUTPUT_COL = "mapToolOutputColumnV1";
const STORAGE_KEY_CURRENT_ROW = "mapToolCurrentRowIndexV1";
const STORAGE_KEY_LIST_MODE_ENABLED = "mapToolListModeEnabledV1";
const STORAGE_KEY_SIDEBAR_WIDTH = "mapToolSidebarWidthV1";
const STORAGE_KEY_EXPERIMENTAL_BOUNDARIES = "experimentalBoundaryOverlayEnabledV1";
const STORAGE_KEY_EXPERIMENTAL_MAP_ID = "experimentalBoundaryMapIdV1";
const STORAGE_KEY_TOWN_BOUNDARY_VISIBLE = "townBoundaryVisibleV1";
const STORAGE_KEY_SEARCH_AREA_RECT_VISIBLE = "searchAreaRectVisibleV1";


let apiKey = localStorage.getItem(STORAGE_KEY_API);
let isAutoRadiusEnabled = localStorage.getItem(STORAGE_KEY_AUTO_RADIUS) !== "false"; // デフォルトON
let layoutMode = localStorage.getItem(STORAGE_KEY_LAYOUT) || "layout-horizontal";
let isExperimentalBoundaryEnabled = localStorage.getItem(STORAGE_KEY_EXPERIMENTAL_BOUNDARIES) === "true";
let experimentalMapId = (localStorage.getItem(STORAGE_KEY_EXPERIMENTAL_MAP_ID) || "").trim();
let isTownBoundaryVisible = localStorage.getItem(STORAGE_KEY_TOWN_BOUNDARY_VISIBLE) !== "false";
let isSearchAreaRectVisible = localStorage.getItem(STORAGE_KEY_SEARCH_AREA_RECT_VISIBLE) !== "false";

let map, marker, circle, boundsRect, geocoder;
let currentRadius = 300;
let listData = [];
let addressColumnIndex = Number(localStorage.getItem(STORAGE_KEY_ADDRESS_COL)) || 0;
let outputColumnIndex = Number(localStorage.getItem(STORAGE_KEY_OUTPUT_COL)) || 4;
let currentListRowIndex = Number(localStorage.getItem(STORAGE_KEY_CURRENT_ROW));
if (!Number.isInteger(currentListRowIndex) || currentListRowIndex < 0) currentListRowIndex = -1;
let isListModeEnabled = localStorage.getItem(STORAGE_KEY_LIST_MODE_ENABLED) !== "false";
let sidebarWidth = Number(localStorage.getItem(STORAGE_KEY_SIDEBAR_WIDTH)) || 280;
let experimentalBoundaryLayers = {};
let experimentalBoundarySelections = {};
let lastGeocodeResult = null;
let townBoundaryLayer = null;
let selectedTownBoundaryKeyCodes = new Set();
let currentTownBoundaryLabel = "";
let currentSearchArea = null;

const HIROSHIMA_CITY_BOUNDARY_DATA = window.HIROSHIMA_CITY_BOUNDARIES || null;

const EXPERIMENTAL_BOUNDARY_CONFIG = [
    {
        key: "postal_code",
        label: "郵便番号境界",
        featureType: "POSTAL_CODE",
        color: "#2f6fed",
        fillOpacity: 0.08,
        strokeOpacity: 0.9,
        strokeWeight: 2
    },
    {
        key: "locality",
        label: "市区町村境界",
        featureType: "LOCALITY",
        color: "#1e7f72",
        fillOpacity: 0.07,
        strokeOpacity: 0.9,
        strokeWeight: 2
    }
];


// ★設定: 回数制限の目安
const QUOTA_LIMITS = {
    DAILY: 300,      // 1日の目安
    MONTHLY: 10000   // 1ヶ月の目安
};

/* =========================================
   回数管理クラス
   ========================================= */
const QuotaManager = {
    storageKey: "googleMapsUsageStats",

    getData: function () {
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        const monthStr = now.toISOString().slice(0, 7);

        let data = JSON.parse(localStorage.getItem(this.storageKey)) || {
            date: todayStr,
            month: monthStr,
            dailyCount: 0,
            monthlyCount: 0
        };

        if (data.date !== todayStr) {
            data.date = todayStr;
            data.dailyCount = 0;
        }
        if (data.month !== monthStr) {
            data.month = monthStr;
            data.monthlyCount = 0;
        }

        return data;
    },

    increment: function () {
        const data = this.getData();
        data.dailyCount++;
        data.monthlyCount++;
        localStorage.setItem(this.storageKey, JSON.stringify(data));
        this.updateDisplay();
    },

    updateDisplay: function () {
        const el = document.getElementById("quota-display");
        if (!el) return;

        const data = this.getData();
        const dailyLeft = QUOTA_LIMITS.DAILY - data.dailyCount;
        const monthlyLeft = QUOTA_LIMITS.MONTHLY - data.monthlyCount;

        const dShow = dailyLeft < 0 ? 0 : dailyLeft;
        const mShow = monthlyLeft < 0 ? 0 : monthlyLeft;

        el.innerHTML = `
            本日残り: <b>${dShow}</b> / ${QUOTA_LIMITS.DAILY}<br>
            今月残り: <b>${mShow}</b> / ${QUOTA_LIMITS.MONTHLY}
        `;
    }
};

/* =========================================
   初期化プロセス
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
    applySavedLayout();
    applySavedSidebarWidth();
    QuotaManager.updateDisplay();
    updateAutoRadiusDisplay();
    updateOverlayVisibilityDisplay();
    updateExperimentalBoundaryUI();
    setTownBoundaryStatus(HIROSHIMA_CITY_BOUNDARY_DATA ? "町丁境界: 待機中" : "町丁境界: データ未読込", HIROSHIMA_CITY_BOUNDARY_DATA ? "muted" : "warning");
    restoreListState();
    applyListModeVisibility();
    initializeSidebarResize();

    if (apiKey) {
        QuotaManager.increment();
        loadGoogleMapsScript(apiKey);
    } else {
        const modal = document.getElementById("api-key-modal");
        if (modal) modal.style.display = "flex";
    }
});

function saveApiKey() {
    const input = document.getElementById("api-key-input");
    const inputKey = input.value.trim();
    if (inputKey) {
        localStorage.setItem(STORAGE_KEY_API, inputKey);
        location.reload();
    } else {
        alert("APIキーを入力してください");
    }
}

function resetApiKey() {
    if (confirm("保存されたAPIキーを削除しますか？\n次回利用時に入力が求められます。")) {
        localStorage.removeItem(STORAGE_KEY_API);
        location.reload();
    }
}

function toggleAutoRadius() {
    isAutoRadiusEnabled = !isAutoRadiusEnabled;
    localStorage.setItem(STORAGE_KEY_AUTO_RADIUS, isAutoRadiusEnabled);
    updateAutoRadiusDisplay();
}

function applySavedLayout() {
    const container = document.getElementById("main-container");
    if (!container) return;

    container.classList.remove("layout-horizontal", "layout-vertical");

    if (layoutMode !== "layout-vertical") {
        layoutMode = "layout-horizontal";
    }

    container.classList.add(layoutMode);
}

function updateAutoRadiusDisplay() {
    const el = document.getElementById("auto-radius-status");
    if (el) {
        el.innerText = isAutoRadiusEnabled ? "ON" : "OFF";
        el.style.color = isAutoRadiusEnabled ? "#27ae60" : "#c0392b";
    }
}

function updateOverlayVisibilityDisplay() {
    const townToggle = document.getElementById("town-boundary-visibility-status");
    const rectToggle = document.getElementById("search-area-rect-visibility-status");

    if (townToggle) {
        townToggle.innerText = isTownBoundaryVisible ? "ON" : "OFF";
        townToggle.style.color = isTownBoundaryVisible ? "#27ae60" : "#c0392b";
    }

    if (rectToggle) {
        rectToggle.innerText = isSearchAreaRectVisible ? "ON" : "OFF";
        rectToggle.style.color = isSearchAreaRectVisible ? "#27ae60" : "#c0392b";
    }
}

function setTownBoundaryStatus(message, tone = "muted") {
    const status = document.getElementById("town-boundary-status-display");
    if (!status) return;

    status.textContent = message;
    status.classList.remove("is-active", "is-warning");

    if (tone === "active") {
        status.classList.add("is-active");
    } else if (tone === "warning") {
        status.classList.add("is-warning");
    }
}

function setExperimentalBoundaryStatus(message, tone = "muted") {
    const status = document.getElementById("boundary-status-display");
    if (!status) return;

    status.textContent = message;
    status.classList.remove("is-active", "is-warning");

    if (tone === "active") {
        status.classList.add("is-active");
    } else if (tone === "warning") {
        status.classList.add("is-warning");
    }
}

function renderBoundsRect() {
    if (boundsRect) {
        boundsRect.setMap(null);
        boundsRect = null;
    }

    if (!map || !currentSearchArea || !isSearchAreaRectVisible) {
        return;
    }

    boundsRect = new google.maps.Rectangle({
        strokeColor: "#0000FF",
        strokeOpacity: 0.5,
        strokeWeight: 2,
        fillOpacity: 0,
        map: map,
        bounds: currentSearchArea,
        clickable: false,
        zIndex: 1
    });
}

function refreshTownBoundaryVisibilityState() {
    applyTownBoundaryStyles();

    if (!HIROSHIMA_CITY_BOUNDARY_DATA) {
        setTownBoundaryStatus("町丁境界: データ未読込", "warning");
        return;
    }

    if (!selectedTownBoundaryKeyCodes.size) {
        setTownBoundaryStatus("町丁境界: 待機中");
        return;
    }

    if (!isTownBoundaryVisible) {
        setTownBoundaryStatus(`町丁境界: ${currentTownBoundaryLabel || "一致あり"} 非表示`, "warning");
        return;
    }

    setTownBoundaryStatus(`町丁境界: ${currentTownBoundaryLabel || "一致あり"} を表示中`, "active");
}

function toggleTownBoundaryVisibility() {
    isTownBoundaryVisible = !isTownBoundaryVisible;
    localStorage.setItem(STORAGE_KEY_TOWN_BOUNDARY_VISIBLE, String(isTownBoundaryVisible));
    updateOverlayVisibilityDisplay();
    refreshTownBoundaryVisibilityState();
}

function toggleSearchAreaRectVisibility() {
    isSearchAreaRectVisible = !isSearchAreaRectVisible;
    localStorage.setItem(STORAGE_KEY_SEARCH_AREA_RECT_VISIBLE, String(isSearchAreaRectVisible));
    updateOverlayVisibilityDisplay();
    renderBoundsRect();
}

function updateExperimentalBoundaryUI() {
    const toggle = document.getElementById("experimental-boundary-status");
    const note = document.getElementById("experimental-boundary-note");
    const mapIdInput = document.getElementById("experimental-map-id-input");

    if (toggle) {
        toggle.textContent = isExperimentalBoundaryEnabled ? "ON" : "OFF";
        toggle.classList.toggle("is-on", isExperimentalBoundaryEnabled);
        toggle.classList.toggle("is-off", !isExperimentalBoundaryEnabled);
    }

    if (mapIdInput) {
        mapIdInput.value = experimentalMapId;
    }

    if (!note) return;

    if (!isExperimentalBoundaryEnabled) {
        note.textContent = "実験機能は OFF です。必要なときだけ ON にしてください。";
        setExperimentalBoundaryStatus("境界ポリゴン: OFF");
        return;
    }

    if (!experimentalMapId) {
        note.textContent = "Map ID が未設定です。Cloud Console で作成した Map ID を保存してから使ってください。";
        setExperimentalBoundaryStatus("境界ポリゴン: Map ID 未設定", "warning");
        return;
    }

    note.textContent = "設定変更後は再読み込みして、Map ID 側で Postal Code と Locality の境界レイヤーを有効にしてください。";
    setExperimentalBoundaryStatus("境界ポリゴン: 待機中", "warning");
}

function reloadForExperimentalBoundaryChange() {
    location.reload();
}

function toggleExperimentalBoundaryMode() {
    isExperimentalBoundaryEnabled = !isExperimentalBoundaryEnabled;
    localStorage.setItem(STORAGE_KEY_EXPERIMENTAL_BOUNDARIES, String(isExperimentalBoundaryEnabled));
    updateExperimentalBoundaryUI();
    reloadForExperimentalBoundaryChange();
}

function saveExperimentalMapId() {
    const input = document.getElementById("experimental-map-id-input");
    experimentalMapId = input ? input.value.trim() : "";
    localStorage.setItem(STORAGE_KEY_EXPERIMENTAL_MAP_ID, experimentalMapId);
    updateExperimentalBoundaryUI();

    if (isExperimentalBoundaryEnabled) {
        reloadForExperimentalBoundaryChange();
    }
}

function applySavedSidebarWidth() {
    const clampedWidth = Math.min(Math.max(sidebarWidth, 220), Math.floor(window.innerWidth * 0.48) || 520);
    sidebarWidth = clampedWidth;
    document.documentElement.style.setProperty("--sidebar-width", `${clampedWidth}px`);
}

function initializeSidebarResize() {
    const sidebar = document.getElementById("list-sidebar");
    const resizer = document.getElementById("list-sidebar-resizer");
    if (!sidebar || !resizer) return;

    let startX = 0;
    let startWidth = sidebarWidth;

    const onPointerMove = (event) => {
        const maxWidth = Math.max(220, Math.floor(window.innerWidth * 0.48));
        const nextWidth = Math.min(Math.max(startWidth + (event.clientX - startX), 220), maxWidth);
        sidebarWidth = nextWidth;
        document.documentElement.style.setProperty("--sidebar-width", `${nextWidth}px`);
    };

    const onPointerUp = () => {
        sidebar.classList.remove("is-resizing");
        localStorage.setItem(STORAGE_KEY_SIDEBAR_WIDTH, String(sidebarWidth));
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        setTimeout(() => { if (map) google.maps.event.trigger(map, "resize"); }, 100);
    };

    resizer.addEventListener("pointerdown", (event) => {
        if (window.innerWidth <= 960) return;
        startX = event.clientX;
        startWidth = sidebarWidth;
        sidebar.classList.add("is-resizing");
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    });

    window.addEventListener("resize", () => {
        applySavedSidebarWidth();
    });
}

function loadGoogleMapsScript(key) {
    if (window.google && window.google.maps) return;

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry&callback=initMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        alert("APIキーが間違っているか、制限されています。\n設定からキーを削除して再入力してください。");
    };
    document.head.appendChild(script);
}

/* =========================================
   Google Maps 初期化
   ========================================= */
window.initMap = function () {
    geocoder = new google.maps.Geocoder();
    const initialPos = { lat: 35.6999433, lng: 139.7435152 };

    const mapElement = document.getElementById("map");
    if (mapElement) {
        const mapOptions = {
            zoom: 15,
            center: initialPos,
            mapTypeId: 'roadmap',
            streetViewControl: false,
            clickableIcons: false,
            fullscreenControl: false,
            mapTypeControl: true
        };

        if (isExperimentalBoundaryEnabled && experimentalMapId) {
            mapOptions.mapId = experimentalMapId;
        }

        map = new google.maps.Map(mapElement, mapOptions);

        map.addListener("click", (e) => {
            placeMarkerAndCircle(e.latLng);
        });
    }

    updateRefMap("東京都千代田区富士見2丁目");

    initializeTownBoundaryLayer();
    ensureExperimentalBoundaryLayers();

    document.addEventListener('click', function (event) {
        const menu = document.getElementById("settings-menu");
        const btn = document.getElementById("settings-btn");
        if (menu && btn && !btn.contains(event.target) && !menu.contains(event.target)) {
            menu.classList.remove('show');
        }
    });
};

/* =========================================
   メイン機能
   ========================================= */
function toHalfWidthDigits(value) {
    return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
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
        "九": 9
    };
    const units = {
        "十": 10,
        "百": 100,
        "千": 1000
    };

    let total = 0;
    let current = 0;

    for (const char of String(input || "")) {
        if (Object.prototype.hasOwnProperty.call(digits, char)) {
            current = digits[char];
            continue;
        }

        if (Object.prototype.hasOwnProperty.call(units, char)) {
            total += (current || 1) * units[char];
            current = 0;
        }
    }

    return total + current;
}

function normalizeChomeNumbers(value) {
    return toHalfWidthDigits(String(value || "").trim()).replace(/([〇零一二三四五六七八九十百千0-9]+)丁目/g, (_, rawNumber) => {
        if (/^[0-9]+$/.test(rawNumber)) {
            return `${Number.parseInt(rawNumber, 10)}丁目`;
        }

        return `${kanjiNumberToInt(rawNumber)}丁目`;
    });
}

function normalizeTownBoundaryText(value) {
    return normalizeChomeNumbers(String(value || ""))
        .replace(/\s+/g, "")
        .replace(/ヶ/g, "ケ")
        .replace(/之/g, "の")
        .trim();
}

function getTownBoundaryStyle(feature) {
    const keyCode = String(feature.getProperty("key_code") || "");

    if (!isTownBoundaryVisible || !selectedTownBoundaryKeyCodes.has(keyCode)) {
        return {
            clickable: false,
            visible: false,
            strokeOpacity: 0,
            strokeWeight: 0,
            fillOpacity: 0
        };
    }

    return {
        clickable: false,
        visible: true,
        strokeColor: "#D35400",
        strokeOpacity: 0.95,
        strokeWeight: 3,
        fillColor: "#F39C12",
        fillOpacity: 0.18,
        zIndex: 4
    };
}

function applyTownBoundaryStyles() {
    if (!townBoundaryLayer) return;
    townBoundaryLayer.setStyle((feature) => getTownBoundaryStyle(feature));
}

function clearTownBoundarySelection(keepStatus = false) {
    selectedTownBoundaryKeyCodes = new Set();
    currentTownBoundaryLabel = "";
    applyTownBoundaryStyles();

    if (!keepStatus) {
        setTownBoundaryStatus(HIROSHIMA_CITY_BOUNDARY_DATA ? "町丁境界: 待機中" : "町丁境界: データ未読込", HIROSHIMA_CITY_BOUNDARY_DATA ? "muted" : "warning");
    }
}

function initializeTownBoundaryLayer() {
    if (!map) return false;

    if (!HIROSHIMA_CITY_BOUNDARY_DATA || !Array.isArray(HIROSHIMA_CITY_BOUNDARY_DATA.features)) {
        setTownBoundaryStatus("町丁境界: データ未読込", "warning");
        return false;
    }

    if (townBoundaryLayer) {
        return true;
    }

    townBoundaryLayer = new google.maps.Data({ map: map });
    townBoundaryLayer.addGeoJson(HIROSHIMA_CITY_BOUNDARY_DATA);
    applyTownBoundaryStyles();
    refreshTownBoundaryVisibilityState();
    return true;
}

function buildTownBoundaryCityCandidates(result) {
    const locality = getAddressComponent(result, "locality");
    const adminLevel2 = getAddressComponent(result, "administrative_area_level_2");
    const ward = getAddressComponent(result, "sublocality_level_1") || getAddressComponent(result, "administrative_area_level_3");
    const candidates = new Set();

    [locality, adminLevel2].filter(Boolean).forEach((baseName) => {
        const normalizedBase = normalizeTownBoundaryText(baseName);
        if (normalizedBase) candidates.add(normalizedBase);

        if (ward) {
            const combined = normalizeTownBoundaryText(`${baseName}${ward}`);
            if (combined) candidates.add(combined);
        }
    });

    return candidates;
}

function buildTownBoundarySearchTexts(result) {
    const addressInput = document.getElementById("address-input");
    const candidates = new Set();
    const sourceValues = [
        addressInput ? addressInput.value : "",
        result && result.formatted_address ? result.formatted_address : ""
    ];

    sourceValues.forEach((value) => {
        const normalized = normalizeTownBoundaryText(value);
        if (normalized) candidates.add(normalized);
    });

    return candidates;
}

function findTownBoundaryMatches(result) {
    if (!HIROSHIMA_CITY_BOUNDARY_DATA || !Array.isArray(HIROSHIMA_CITY_BOUNDARY_DATA.features)) {
        return [];
    }

    const cityCandidates = buildTownBoundaryCityCandidates(result);
    const searchTexts = buildTownBoundarySearchTexts(result);

    if (!searchTexts.size) {
        return [];
    }

    let bestScore = 0;
    let matches = [];

    HIROSHIMA_CITY_BOUNDARY_DATA.features.forEach((feature) => {
        const props = feature.properties || {};
        const cityNameNormalized = String(props.city_name_normalized || "");

        if (cityCandidates.size && cityNameNormalized && !cityCandidates.has(cityNameNormalized)) {
            return;
        }

        const candidateNames = [
            String(props.full_name_normalized || ""),
            String(props.full_name_arabic_normalized || ""),
            cityNameNormalized && props.town_name_normalized ? `${cityNameNormalized}${props.town_name_normalized}` : "",
            cityNameNormalized && props.town_name_arabic_normalized ? `${cityNameNormalized}${props.town_name_arabic_normalized}` : ""
        ].filter(Boolean);

        let featureScore = 0;

        searchTexts.forEach((text) => {
            candidateNames.forEach((candidateName) => {
                if (text.includes(candidateName)) {
                    featureScore = Math.max(featureScore, candidateName.length);
                }
            });
        });

        if (!featureScore) {
            return;
        }

        if (featureScore > bestScore) {
            bestScore = featureScore;
            matches = [feature];
            return;
        }

        if (featureScore === bestScore) {
            matches.push(feature);
        }
    });

    return matches;
}

function updateTownBoundaryOverlay(result) {
    if (!initializeTownBoundaryLayer()) {
        return false;
    }

    const matches = findTownBoundaryMatches(result);
    clearTownBoundarySelection(true);

    if (!matches.length) {
        setTownBoundaryStatus("町丁境界: 該当なし", "warning");
        return false;
    }

    selectedTownBoundaryKeyCodes = new Set(matches.map((feature) => String(feature.properties && feature.properties.key_code ? feature.properties.key_code : "")));
    applyTownBoundaryStyles();

    const names = [...new Set(matches.map((feature) => {
        const props = feature.properties || {};
        return String(props.full_name_arabic || props.full_name || "");
    }).filter(Boolean))];
    currentTownBoundaryLabel = names.slice(0, 2).join(" / ");
    refreshTownBoundaryVisibilityState();
    return true;
}

function clearExperimentalBoundaryLayers() {
    EXPERIMENTAL_BOUNDARY_CONFIG.forEach((config) => {
        const layer = experimentalBoundaryLayers[config.key];
        if (layer) layer.style = null;
        experimentalBoundarySelections[config.key] = new Set();
    });
}

function ensureExperimentalBoundaryLayers() {
    if (!map) return false;

    if (!isExperimentalBoundaryEnabled) {
        clearExperimentalBoundaryLayers();
        setExperimentalBoundaryStatus("境界ポリゴン: OFF");
        return false;
    }

    if (!experimentalMapId) {
        clearExperimentalBoundaryLayers();
        setExperimentalBoundaryStatus("境界ポリゴン: Map ID 未設定", "warning");
        return false;
    }

    if (typeof map.getFeatureLayer !== "function" || !google.maps.FeatureType) {
        clearExperimentalBoundaryLayers();
        setExperimentalBoundaryStatus("境界ポリゴン: この地図では未対応", "warning");
        return false;
    }

    let availableCount = 0;

    EXPERIMENTAL_BOUNDARY_CONFIG.forEach((config) => {
        const featureType = google.maps.FeatureType[config.featureType];
        if (!featureType) return;

        const layer = map.getFeatureLayer(featureType);
        experimentalBoundaryLayers[config.key] = layer;
        experimentalBoundarySelections[config.key] = experimentalBoundarySelections[config.key] || new Set();

        if (layer && layer.isAvailable) {
            availableCount += 1;
        }
    });

    if (!availableCount) {
        clearExperimentalBoundaryLayers();
        setExperimentalBoundaryStatus("境界ポリゴン: Map ID 側で境界レイヤー未有効", "warning");
        return false;
    }

    return true;
}

function applyExperimentalBoundaryStyles() {
    EXPERIMENTAL_BOUNDARY_CONFIG.forEach((config) => {
        const layer = experimentalBoundaryLayers[config.key];
        const placeIds = experimentalBoundarySelections[config.key];

        if (!layer || !layer.isAvailable || !(placeIds instanceof Set) || placeIds.size === 0) {
            if (layer) layer.style = null;
            return;
        }

        layer.style = (options) => {
            const placeId = options && options.feature ? options.feature.placeId : null;
            if (!placeIds.has(placeId)) return null;

            return {
                strokeColor: config.color,
                strokeOpacity: config.strokeOpacity,
                strokeWeight: config.strokeWeight,
                fillColor: config.color,
                fillOpacity: config.fillOpacity
            };
        };
    });
}

function getAddressComponent(result, type) {
    const components = result && Array.isArray(result.address_components) ? result.address_components : [];
    const match = components.find((component) => Array.isArray(component.types) && component.types.includes(type));
    return match ? match.long_name : "";
}

function buildExperimentalBoundaryQueries(result) {
    const country = getAddressComponent(result, "country");
    const adminAreaLevel1 = getAddressComponent(result, "administrative_area_level_1");
    const locality = getAddressComponent(result, "locality") || getAddressComponent(result, "administrative_area_level_2");
    const postalCode = getAddressComponent(result, "postal_code");
    const queries = [];

    if (postalCode) {
        queries.push({
            key: "postal_code",
            textQuery: [postalCode, country].filter(Boolean).join(", ")
        });
    }

    if (locality) {
        queries.push({
            key: "locality",
            textQuery: [locality, adminAreaLevel1, country].filter(Boolean).join(", ")
        });
    }

    return queries;
}

async function lookupExperimentalBoundaryPlaceId(config, textQuery, locationBias) {
    const { Place } = await google.maps.importLibrary("places");
    const request = {
        textQuery,
        fields: ["id"],
        language: "ja",
        region: "JP"
    };

    if (locationBias) {
        request.locationBias = locationBias;
    }

    const { places } = await Place.searchByText(request);
    return Array.isArray(places) && places[0] && places[0].id ? places[0].id : null;
}

async function updateExperimentalBoundaryOverlays(result) {
    lastGeocodeResult = result;

    if (!ensureExperimentalBoundaryLayers()) {
        return;
    }

    clearExperimentalBoundaryLayers();

    const queries = buildExperimentalBoundaryQueries(result);
    if (!queries.length) {
        setExperimentalBoundaryStatus("境界ポリゴン: 検索候補なし", "warning");
        return;
    }

    const locationBias = result && result.geometry ? result.geometry.location : null;
    const shownLabels = [];

    try {
        for (const query of queries) {
            const config = EXPERIMENTAL_BOUNDARY_CONFIG.find((item) => item.key === query.key);
            const layer = config ? experimentalBoundaryLayers[config.key] : null;

            if (!config || !layer || !layer.isAvailable) {
                continue;
            }

            const placeId = await lookupExperimentalBoundaryPlaceId(config, query.textQuery, locationBias);
            if (!placeId) {
                continue;
            }

            experimentalBoundarySelections[config.key].add(placeId);
            shownLabels.push(config.label);
        }
    } catch (error) {
        console.error("Experimental boundary lookup failed.", error);
        clearExperimentalBoundaryLayers();
        const detail = error && error.message ? ` (${error.message})` : "";
        setExperimentalBoundaryStatus(`境界ポリゴン: Places API (New) 設定要確認${detail}`, "warning");
        return;
    }

    applyExperimentalBoundaryStyles();

    if (shownLabels.length) {
        setExperimentalBoundaryStatus(`境界ポリゴン: ${shownLabels.join(" / ")} を表示中`, "active");
    } else {
        setExperimentalBoundaryStatus("境界ポリゴン: 該当境界なし", "warning");
    }
}

function placeMarkerAndCircle(latLng) {
    resetImpossibleState();

    if (marker) marker.setMap(null);
    if (circle) circle.setMap(null);

    marker = new google.maps.Marker({
        position: latLng,
        map: map,
        draggable: true,
        zIndex: google.maps.Marker.MAX_ZINDEX + 1
    });

    marker.addListener("dragend", (e) => {
        updateCirclePosition(e.latLng);
        generateOutput(e.latLng);
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        updateRefMap(`${lat},${lng}`);
    });

    drawCircle(latLng);
    generateOutput(latLng);
}

function drawCircle(center) {
    if (circle) circle.setMap(null);
    circle = new google.maps.Circle({
        strokeColor: "#FF0000", strokeOpacity: 0.8, strokeWeight: 2,
        fillColor: "#FF0000", fillOpacity: 0.2, map: map, center: center,
        radius: currentRadius, clickable: false
    });
}

function updateCirclePosition(latLng) {
    if (circle) circle.setCenter(latLng);
}

function setRadius(radius) {
    currentRadius = radius;
    document.querySelectorAll('.radius-btn').forEach(btn => btn.classList.remove('active'));

    const btns = document.querySelectorAll('.radius-btn');
    btns.forEach(btn => {
        let btnVal = parseInt(btn.innerText);
        if (btn.innerText.includes("km")) btnVal *= 1000;

        if (btnVal === radius) {
            btn.classList.add('active');
        }
    });

    const impBtn = document.getElementById('impossible-btn');
    if (impBtn) impBtn.classList.remove('active');

    if (circle) {
        circle.setRadius(radius);
        if (marker) generateOutput(marker.getPosition());
    }
}

// 不可ボタン
function setImpossible() {
    document.querySelectorAll('.radius-btn').forEach(btn => btn.classList.remove('active'));
    const impBtn = document.getElementById('impossible-btn');
    if (impBtn) impBtn.classList.add('active');

    const text = "ジオ付与不可能（消防出動情報向けのメッセージです）";
    document.getElementById("output-text").value = text;

    navigator.clipboard.writeText(text).then(() => {
        if (impBtn.dataset.timer) clearTimeout(impBtn.dataset.timer);

        impBtn.innerText = "コピー完了!";
        impBtn.style.backgroundColor = "#27ae60";
        impBtn.style.border = "1px solid #fff";

        const timerId = setTimeout(() => {
            impBtn.innerText = "不可";
            impBtn.style.backgroundColor = "";
            impBtn.style.border = "";
            delete impBtn.dataset.timer;
        }, 1000);

        impBtn.dataset.timer = timerId;
    }).catch(err => {
        console.error('コピー失敗:', err);
    });
}

function resetImpossibleState() {
    const impBtn = document.getElementById('impossible-btn');
    if (impBtn && impBtn.classList.contains('active')) {
        impBtn.classList.remove('active');
        impBtn.innerText = "不可";
        impBtn.style.backgroundColor = "";

        const radiusBtns = document.querySelectorAll('.radius-group button:not(#impossible-btn)');
        radiusBtns.forEach(btn => {
            let btnRadius = parseInt(btn.innerText);
            if (btn.innerText.includes("km")) btnRadius *= 1000;
            if (btnRadius === currentRadius) btn.classList.add('active');
        });
    }
}

// ★修正版: 住所検索 (広めの半径計算)
function geocodeAddress() {
    const address = document.getElementById("address-input").value;
    const calcDisplay = document.getElementById("calculated-radius-display");

    if (!address || !geocoder) return;

    if (calcDisplay) calcDisplay.innerText = "";

    QuotaManager.increment();

    geocoder.geocode({ 'address': address }, (results, status) => {
        if (status === 'OK') {
            const result = results[0];
            const location = result.geometry.location;
            lastGeocodeResult = result;
            currentSearchArea = null;

            // 厳密な範囲(bounds)があれば優先
            const searchArea = result.geometry.bounds || result.geometry.viewport;

            // ★修正: 広めの半径計算 (全体が入るようにする)
            if (isAutoRadiusEnabled && searchArea) {
                // 北東の「角」までの距離を測ることで、四角全体をカバーする
                const corner = searchArea.getNorthEast();
                const distance = Math.round(google.maps.geometry.spherical.computeDistanceBetween(location, corner));

                const presets = [50, 100, 300, 500, 1000];
                let bestRadius = 1000;

                for (let r of presets) {
                    if (r >= distance) {
                        bestRadius = r;
                        break;
                    }
                }
                if (distance > 1000) bestRadius = 1000;

                setRadius(bestRadius);

                if (calcDisplay) {
                    calcDisplay.innerText = `検出範囲(対角): ${distance}m → ${bestRadius}mを設定`;
                }
            } else {
                if (calcDisplay && isAutoRadiusEnabled) {
                    calcDisplay.innerText = "範囲データなし";
                }
            }

            placeMarkerAndCircle(location);

            if (marker) {
                marker.setZIndex(google.maps.Marker.MAX_ZINDEX + 1);
            }

            // 青枠の描画
            if (searchArea) {
                currentSearchArea = searchArea;
                renderBoundsRect();
                map.fitBounds(searchArea);
                map.panTo(location);
            } else {
                renderBoundsRect();
                map.setCenter(location);
                map.setZoom(16);
            }

            updateRefMap(address);
            const hasTownBoundaryMatch = updateTownBoundaryOverlay(result);
            if (!hasTownBoundaryMatch) {
                void updateExperimentalBoundaryOverlays(result);
            }

        } else {
            alert('検索できませんでした: ' + status);
        }
    });
}

function updateRefMap(query) {
    const frame = document.getElementById("ref-frame");
    if (frame && apiKey) {
        const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodeURIComponent(query)}`;
        frame.src = embedUrl;
    }
}

function generateOutput(latLng) {
    const lat = latLng.lat();
    const lng = latLng.lng();
    let radiusText = currentRadius >= 1000 ? (currentRadius / 1000) + "km" : currentRadius + "m";
    const text = `{${lat}, ${lng}}で${radiusText}ピン（消防出動情報向けのメッセージです）`;
    document.getElementById("output-text").value = text;
}

// ★修正版: コピーボタン (引数対応)
function copyToClipboard(triggerBtn) {
    const copyText = document.getElementById("output-text");

    // 引数がない場合は既存の下ボタンを対象にする
    const btn = triggerBtn || document.getElementById('copy-btn');

    copyText.select();
    navigator.clipboard.writeText(copyText.value).then(() => {
        if (btn.dataset.timer) clearTimeout(btn.dataset.timer);

        const originalText = btn.dataset.originalText || btn.innerText;
        const originalBg = btn.dataset.originalBg || window.getComputedStyle(btn).backgroundColor;

        btn.dataset.originalText = originalText;
        btn.dataset.originalBg = originalBg;

        btn.innerText = "完了!";
        btn.style.backgroundColor = "#27ae60";

        const timerId = setTimeout(() => {
            btn.innerText = originalText;
            btn.style.backgroundColor = originalBg;
            delete btn.dataset.timer;
        }, 1000);

        btn.dataset.timer = timerId;
    }).catch(err => {
        console.error('コピー失敗:', err);
    });
}

function toggleSettings() {
    const menu = document.getElementById("settings-menu");
    if (menu) menu.classList.toggle("show");
}

function toggleLayout() {
    const container = document.getElementById("main-container");
    if (!container) return;

    if (container.classList.contains("layout-horizontal")) {
        layoutMode = "layout-vertical";
    } else {
        layoutMode = "layout-horizontal";
    }

    localStorage.setItem(STORAGE_KEY_LAYOUT, layoutMode);
    applySavedLayout();

    setTimeout(() => { if (map) google.maps.event.trigger(map, "resize"); }, 100);
}

window.deleteApiKey = resetApiKey;

function applyListModeVisibility() {
    const panel = document.getElementById("list-panel");
    const sidebar = document.getElementById("list-sidebar");
    const toggle = document.getElementById("list-mode-toggle");
    const actions = document.getElementById("list-actions");
    if (panel) panel.classList.toggle("hidden", !isListModeEnabled);
    if (sidebar) sidebar.classList.toggle("list-mode-off", !isListModeEnabled);
    if (actions) actions.classList.toggle("hidden", !isListModeEnabled);
    if (toggle) toggle.checked = isListModeEnabled;
}

function setListModeEnabled(enabled) {
    isListModeEnabled = Boolean(enabled);
    localStorage.setItem(STORAGE_KEY_LIST_MODE_ENABLED, String(isListModeEnabled));
    applyListModeVisibility();
    setTimeout(() => { if (map) google.maps.event.trigger(map, "resize"); }, 100);
}

function parseTsvToRows(tsvText) {
    const normalized = tsvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.trim()) return [];
    return normalized.split("\n").map(line => line.split("\t"));
}

function rowsToTsv(rows) {
    return rows.map(row => row.join("\t")).join("\n");
}

function getColumnIndexFromInput(inputId, label) {
    const el = document.getElementById(inputId);
    const value = Number(el ? el.value : NaN);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${label}は1以上の整数を入力してください`);
    }
    return value - 1;
}

function setListMessage(message, type = "") {
    const el = document.getElementById("list-message");
    if (!el) return;
    el.className = type;
    el.textContent = message;
}

function getCellValue(row, index) {
    if (!Array.isArray(row) || index < 0 || index >= row.length) return "";
    return (row[index] || "").trim();
}

function isPendingRow(row) {
    const address = getCellValue(row, addressColumnIndex);
    const output = getCellValue(row, outputColumnIndex);
    return Boolean(address) && !output;
}

function updateListStatus() {
    const total = listData.length;
    const pending = listData.filter(isPendingRow).length;

    const totalEl = document.getElementById("total-rows-display");
    const pendingEl = document.getElementById("pending-rows-display");
    const rowEl = document.getElementById("current-row-display");
    const addrEl = document.getElementById("current-address-display");

    if (totalEl) totalEl.textContent = String(total);
    if (pendingEl) pendingEl.textContent = String(pending);

    if (currentListRowIndex >= 0 && listData[currentListRowIndex]) {
        if (rowEl) rowEl.textContent = String(currentListRowIndex + 1);
        if (addrEl) addrEl.textContent = getCellValue(listData[currentListRowIndex], addressColumnIndex) || "-";
    } else {
        if (rowEl) rowEl.textContent = "-";
        if (addrEl) addrEl.textContent = "-";
    }
}

function persistListState() {
    localStorage.setItem(STORAGE_KEY_LIST_DATA, JSON.stringify(listData));
    localStorage.setItem(STORAGE_KEY_ADDRESS_COL, String(addressColumnIndex));
    localStorage.setItem(STORAGE_KEY_OUTPUT_COL, String(outputColumnIndex));
    localStorage.setItem(STORAGE_KEY_CURRENT_ROW, String(currentListRowIndex));
}

function restoreListState() {
    const addressColInput = document.getElementById("address-column-input");
    const outputColInput = document.getElementById("output-column-input");
    const tsvInput = document.getElementById("list-tsv-input");

    if (addressColInput) addressColInput.value = String(addressColumnIndex + 1);
    if (outputColInput) outputColInput.value = String(outputColumnIndex + 1);

    const raw = localStorage.getItem(STORAGE_KEY_LIST_DATA);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                listData = parsed.map(row => Array.isArray(row) ? row.map(cell => cell == null ? "" : String(cell)) : []);
                if (tsvInput) tsvInput.value = rowsToTsv(listData);
            }
        } catch (error) {
            console.error("一覧データ復元失敗", error);
        }
    }

    if (currentListRowIndex >= listData.length) currentListRowIndex = -1;
    updateListStatus();
}

function loadTsvList() {
    try {
        const tsvInput = document.getElementById("list-tsv-input");
        const rawText = tsvInput ? tsvInput.value : "";
        const parsedRows = parseTsvToRows(rawText);

        if (!parsedRows.length) {
            setListMessage("貼り付けデータが空です。", "error");
            return;
        }

        addressColumnIndex = getColumnIndexFromInput("address-column-input", "住所列番号");
        outputColumnIndex = getColumnIndexFromInput("output-column-input", "出力列番号");

        listData = parsedRows;
        currentListRowIndex = -1;

        persistListState();
        updateListStatus();
        setListMessage(`一覧を読み込みました（${listData.length}行）`, "success");
    } catch (error) {
        setListMessage(error.message || "一覧読み込みに失敗しました", "error");
    }
}

function findNextPendingRow(startIndex) {
    for (let i = Math.max(0, startIndex); i < listData.length; i++) {
        if (isPendingRow(listData[i])) return i;
    }
    return -1;
}

function findPreviousAddressRow(startIndex) {
    for (let i = Math.min(startIndex, listData.length - 1); i >= 0; i--) {
        if (getCellValue(listData[i], addressColumnIndex)) return i;
    }
    return -1;
}

function setAddressToMainInput(address) {
    const input = document.getElementById("address-input");
    if (!input) return;
    input.value = address;
    if (geocoder) geocodeAddress();
}

function showListRow(rowIndex, message) {
    if (rowIndex < 0 || !listData[rowIndex]) return false;

    currentListRowIndex = rowIndex;
    const address = getCellValue(listData[rowIndex], addressColumnIndex);
    setAddressToMainInput(address);
    updateListStatus();
    persistListState();
    setListMessage(message || `行${rowIndex + 1}の住所をセットしました。`, "success");
    return true;
}

function showNextPendingAddress() {
    if (!listData.length) {
        setListMessage("先に一覧を読み込んでください。", "error");
        return;
    }

    const start = currentListRowIndex >= 0 ? currentListRowIndex + 1 : 0;
    const nextIndex = findNextPendingRow(start);

    if (nextIndex === -1) {
        currentListRowIndex = -1;
        updateListStatus();
        persistListState();
        setListMessage("未処理の住所はありません。", "success");
        return;
    }

    showListRow(nextIndex);
}

function showPreviousAddressRow() {
    if (!listData.length) {
        setListMessage("先に一覧を読み込んでください。", "error");
        return;
    }

    const start = currentListRowIndex >= 0 ? currentListRowIndex - 1 : listData.length - 1;
    const previousIndex = findPreviousAddressRow(start);

    if (previousIndex === -1) {
        setListMessage("これ以上戻れる住所行はありません。", "error");
        return;
    }

    showListRow(previousIndex, `行${previousIndex + 1}に戻りました。必要に応じて編集して再反映してください。`);
}

function ensureRowLength(row, length) {
    while (row.length < length) row.push("");
}

function applyOutputToCurrentRow() {
    if (!listData.length || currentListRowIndex < 0 || !listData[currentListRowIndex]) {
        setListMessage("対象行がありません。先に未処理住所を表示してください。", "error");
        return false;
    }

    const outputText = document.getElementById("output-text");
    const outputValue = outputText ? outputText.value.trim() : "";
    if (!outputValue) {
        setListMessage("出力文が空です。地図操作後に反映してください。", "error");
        return false;
    }

    const row = listData[currentListRowIndex];
    ensureRowLength(row, outputColumnIndex + 1);
    row[outputColumnIndex] = outputValue;

    const tsvInput = document.getElementById("list-tsv-input");
    if (tsvInput) tsvInput.value = rowsToTsv(listData);

    persistListState();
    updateListStatus();
    setListMessage(`行${currentListRowIndex + 1}に反映しました。`, "success");
    return true;
}

function applyOutputAndMoveNext() {
    const applied = applyOutputToCurrentRow();
    if (!applied) return;
    showNextPendingAddress();
}

function copyOutputColumnOnly() {
    if (!listData.length) {
        setListMessage("コピーできる一覧データがありません。", "error");
        return;
    }

    const outputLines = listData.map((row) => {
        if (!Array.isArray(row) || outputColumnIndex < 0 || outputColumnIndex >= row.length) return "";
        const value = row[outputColumnIndex];
        return value == null ? "" : String(value);
    });

    const text = outputLines.join("\n");
    navigator.clipboard.writeText(text).then(() => {
        setListMessage("出力列のみをコピーしました。", "success");
    }).catch((error) => {
        console.error("出力列コピー失敗", error);
        setListMessage("コピーに失敗しました。", "error");
    });
}
