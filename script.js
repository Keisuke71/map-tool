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
const STORAGE_KEY_TOWN_BOUNDARY_VISIBLE = "townBoundaryVisibleV1";
const STORAGE_KEY_SEARCH_AREA_RECT_VISIBLE = "searchAreaRectVisibleV1";
const STORAGE_KEY_REF_MAP_SYNC = "referenceMapSyncEnabledV1";
const STORAGE_KEY_REFERENCE_ONLY_MODE = "referenceOnlyModeV1";


let apiKey = localStorage.getItem(STORAGE_KEY_API);
let isAutoRadiusEnabled = localStorage.getItem(STORAGE_KEY_AUTO_RADIUS) !== "false"; // デフォルトON
let layoutMode = localStorage.getItem(STORAGE_KEY_LAYOUT) || "layout-horizontal";
let isTownBoundaryVisible = localStorage.getItem(STORAGE_KEY_TOWN_BOUNDARY_VISIBLE) !== "false";
let isSearchAreaRectVisible = localStorage.getItem(STORAGE_KEY_SEARCH_AREA_RECT_VISIBLE) !== "false";
let isRefMapSyncEnabled = localStorage.getItem(STORAGE_KEY_REF_MAP_SYNC) !== "false";
let isReferenceOnlyMode = localStorage.getItem(STORAGE_KEY_REFERENCE_ONLY_MODE) === "true";

let map, refMap, marker, refMarker, circle, refCircle, boundsRect, refBoundsRect, geocoder;
let currentRadius = 300;
let listData = [];
let addressColumnIndex = Number(localStorage.getItem(STORAGE_KEY_ADDRESS_COL)) || 0;
let outputColumnIndex = Number(localStorage.getItem(STORAGE_KEY_OUTPUT_COL)) || 4;
let currentListRowIndex = Number(localStorage.getItem(STORAGE_KEY_CURRENT_ROW));
if (!Number.isInteger(currentListRowIndex) || currentListRowIndex < 0) currentListRowIndex = -1;
let isListModeEnabled = localStorage.getItem(STORAGE_KEY_LIST_MODE_ENABLED) !== "false";
let sidebarWidth = Number(localStorage.getItem(STORAGE_KEY_SIDEBAR_WIDTH)) || 280;
let townBoundaryLayer = null;
let townBoundaryLayerDatasetKey = "";
let activeTownBoundaryData = null;
let activeTownBoundaryDatasetKey = "";
let townBoundaryDataStatus = "unloaded";
let selectedTownBoundaryKeyCodes = new Set();
let currentTownBoundaryLabel = "";
let currentSearchArea = null;
let calculationLogs = [];
let geocodeRequestToken = 0;
let geocodeCandidateApplyToken = 0;
let currentGeocodeAddress = "";
let currentGeocodeQuery = "";
let currentGeocodeCandidates = [];
let currentGeocodeCandidateIndex = -1;
let pendingGeocodeAddress = "";
let lastRefMapQuery = "";
let lastRefMapEmbedUrl = "";
let refMapRefreshTimer = null;
let refMapOverlayFrame = null;
let refMapViewOverride = null;
let isSynchronizingMapViews = false;
let mapViewSyncFrame = null;
let pendingMapViewSync = null;
let programmaticMapSyncTargets = new WeakMap();
let refMapRevealTimer = null;
let refMapLiveViewToken = 0;

const RADIUS_PRESETS = [50, 100, 300, 500, 1000];
const EARTH_RADIUS_METERS = 6378137;
const CALCULATION_LOG_LIMIT = 80;
const REF_MAP_SETTLED_REFRESH_DELAY = 120;
const REF_MAP_REVEAL_AFTER_LOAD_DELAY = 40;

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

function appendCalculationLog(message, tone = "info") {
    calculationLogs.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        time: new Date(),
        message,
        tone
    });

    if (calculationLogs.length > CALCULATION_LOG_LIMIT) {
        calculationLogs = calculationLogs.slice(0, CALCULATION_LOG_LIMIT);
    }

    renderCalculationLogs();
}

function clearCalculationLogs() {
    calculationLogs = [];
    renderCalculationLogs();
}

function renderCalculationLogs() {
    const container = document.getElementById("calc-log-list");
    if (!container) return;

    container.innerHTML = "";

    if (!calculationLogs.length) {
        const empty = document.createElement("div");
        empty.className = "calc-log-empty";
        empty.textContent = "検索や半径計算のログをここに表示します。";
        container.appendChild(empty);
        return;
    }

    calculationLogs.forEach((entry) => {
        const item = document.createElement("div");
        item.className = `calc-log-entry is-${entry.tone}`;

        const time = document.createElement("div");
        time.className = "calc-log-time";
        time.textContent = entry.time.toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });

        const message = document.createElement("div");
        message.className = "calc-log-message";
        message.textContent = entry.message;

        item.appendChild(time);
        item.appendChild(message);
        container.appendChild(item);
    });
}

/* =========================================
   初期化プロセス
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
    applySavedLayout();
    applySavedSidebarWidth();
    renderCalculationLogs();
    QuotaManager.updateDisplay();
    updateAutoRadiusDisplay();
    updateOverlayVisibilityDisplay();
    updateReferenceMapSyncDisplay();
    updateReferenceOnlyDisplay();
    refreshTownBoundaryVisibilityState();
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

    container.classList.remove("layout-horizontal", "layout-vertical", "reference-only-mode");

    if (layoutMode !== "layout-vertical") {
        layoutMode = "layout-horizontal";
    }

    container.classList.add(layoutMode);
    container.classList.toggle("reference-only-mode", isReferenceOnlyMode);
}

function updateReferenceOnlyDisplay() {
    const status = document.getElementById("reference-only-status");
    if (!status) return;

    status.innerText = isReferenceOnlyMode ? "参照のみ" : "2画面";
    status.style.color = isReferenceOnlyMode ? "#27ae60" : "#2c3e50";
}

function resizeVisibleMaps() {
    if (!window.google || !google.maps) return;
    if (map) google.maps.event.trigger(map, "resize");
    if (refMap) {
        google.maps.event.trigger(refMap, "resize");
        if (isReferenceOnlyMode) {
            syncWorkMapFromReferenceMap();
        } else {
            syncReferenceMapFromWorkMap();
        }
        syncReferenceSelectionOverlays();
    }
    renderReferenceMarkerOverlay();
}

function resizeVisibleMapsSoon(delay = 100) {
    setTimeout(resizeVisibleMaps, delay);
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

function updateReferenceMapSyncDisplay() {
    const syncToggle = document.getElementById("ref-map-sync-status");
    const status = document.getElementById("ref-map-status-display");

    if (syncToggle) {
        syncToggle.innerText = isRefMapSyncEnabled ? "ON" : "OFF";
        syncToggle.style.color = isRefMapSyncEnabled ? "#27ae60" : "#c0392b";
    }

    if (status) {
        const modeLabel = refMap ? "透明操作" : "埋め込み";
        const syncLabel = isRefMapSyncEnabled ? "同期ON" : "同期OFF";
        const overlayLabel = isRefMapSyncEnabled ? "ピン・円表示" : "ピン・円非表示";
        status.textContent = `参照マップ: ${modeLabel} / ${syncLabel} / ${overlayLabel}`;
        status.classList.toggle("is-active", isRefMapSyncEnabled);
    }
}

function toggleReferenceMapSync() {
    isRefMapSyncEnabled = !isRefMapSyncEnabled;
    localStorage.setItem(STORAGE_KEY_REF_MAP_SYNC, String(isRefMapSyncEnabled));
    if (!isRefMapSyncEnabled) {
        hideReferenceLiveMapImmediately();
    }
    updateReferenceMapSyncDisplay();
    scheduleRefMapRefresh(0);
    syncReferenceMapFromWorkMap();
    syncReferenceSelectionOverlays();
    renderBoundsRect();
    renderReferenceMarkerOverlay();
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

function renderBoundsRect() {
    if (boundsRect) {
        boundsRect.setMap(null);
        boundsRect = null;
    }

    if (refBoundsRect) {
        refBoundsRect.setMap(null);
        refBoundsRect = null;
    }

    if (!map || !currentSearchArea || !isSearchAreaRectVisible) {
        return;
    }

    const rectOptions = {
        strokeColor: "#1473e6",
        strokeOpacity: 0.85,
        strokeWeight: 3,
        fillColor: "#1473e6",
        fillOpacity: 0.06,
        bounds: currentSearchArea,
        clickable: false,
        zIndex: 1
    };

    boundsRect = new google.maps.Rectangle({
        ...rectOptions,
        map: map
    });

    if (refMap && isRefMapSyncEnabled) {
        refBoundsRect = new google.maps.Rectangle({
            ...rectOptions,
            map: refMap
        });
    }
}

function refreshTownBoundaryVisibilityState() {
    applyTownBoundaryStyles();

    if (!hasLoadedTownBoundaryData()) {
        if (townBoundaryDataStatus === "loading") {
            setTownBoundaryStatus("町丁境界: データ読込中...", "warning");
            return;
        }

        if (townBoundaryDataStatus === "unavailable") {
            setTownBoundaryStatus("町丁境界: 対応データなし", "warning");
            return;
        }

        if (townBoundaryDataStatus === "error") {
            setTownBoundaryStatus("町丁境界: 読込失敗", "warning");
            return;
        }

        setTownBoundaryStatus("町丁境界: 未読込");
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
        resizeVisibleMapsSoon();
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
        resizeVisibleMaps();
    });
}

function loadGoogleMapsScript(key) {
    if (window.google && window.google.maps) return;

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=geometry&callback=initMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        alert("APIキーが間違っているか、制限されています。\n設定からキーを削除して再入力してください。");
    };
    document.head.appendChild(script);
}

function buildMapOptions(center, overrides = {}) {
    const options = {
        zoom: 15,
        center,
        mapTypeId: 'roadmap',
        streetViewControl: false,
        clickableIcons: false,
        fullscreenControl: false,
        mapTypeControl: true
    };

    return {
        ...options,
        ...overrides
    };
}

function setReferenceMapDirectMode(isDirect) {
    const refArea = document.getElementById("ref-area");
    if (refArea) {
        refArea.classList.toggle("is-direct-reference-map", Boolean(isDirect));
    }
    updateReferenceMapSyncDisplay();
}

function setReferenceLiveMapVisible(isVisible) {
    const refArea = document.getElementById("ref-area");
    if (!refArea) return;

    refArea.classList.toggle("is-map-moving", Boolean(isVisible));
}

function showReferenceLiveMapDuringInteraction() {
    if (!refMap || !isRefMapSyncEnabled) return;

    refMapLiveViewToken += 1;
    if (refMapRevealTimer) {
        clearTimeout(refMapRevealTimer);
        refMapRevealTimer = null;
    }
    if (refMapRefreshTimer) {
        clearTimeout(refMapRefreshTimer);
        refMapRefreshTimer = null;
    }
    setReferenceLiveMapVisible(true);
}

function revealReferenceFrame(delay = REF_MAP_REVEAL_AFTER_LOAD_DELAY, token = refMapLiveViewToken) {
    if (refMapRevealTimer) {
        clearTimeout(refMapRevealTimer);
    }

    refMapRevealTimer = setTimeout(() => {
        refMapRevealTimer = null;
        if (token !== refMapLiveViewToken) return;
        setReferenceLiveMapVisible(false);
    }, Math.max(0, delay));
}

function hideReferenceLiveMapImmediately() {
    refMapLiveViewToken += 1;
    if (refMapRevealTimer) {
        clearTimeout(refMapRevealTimer);
        refMapRevealTimer = null;
    }
    setReferenceLiveMapVisible(false);
}

function mapsHaveSameView(sourceMap, targetMap) {
    const sourceCenter = sourceMap && sourceMap.getCenter ? sourceMap.getCenter() : null;
    const targetCenter = targetMap && targetMap.getCenter ? targetMap.getCenter() : null;
    const sourceZoom = sourceMap && sourceMap.getZoom ? sourceMap.getZoom() : null;
    const targetZoom = targetMap && targetMap.getZoom ? targetMap.getZoom() : null;

    if (!sourceCenter || !targetCenter || !Number.isFinite(sourceZoom) || !Number.isFinite(targetZoom)) {
        return false;
    }

    return sourceZoom === targetZoom
        && Math.abs(sourceCenter.lat() - targetCenter.lat()) < 0.0000001
        && Math.abs(sourceCenter.lng() - targetCenter.lng()) < 0.0000001;
}

function markProgrammaticMapSync(targetMap) {
    if (!targetMap) return;

    const token = (programmaticMapSyncTargets.get(targetMap) || 0) + 1;
    programmaticMapSyncTargets.set(targetMap, token);

    setTimeout(() => {
        if (programmaticMapSyncTargets.get(targetMap) === token) {
            programmaticMapSyncTargets.delete(targetMap);
        }
    }, 300);
}

function consumeProgrammaticMapSync(targetMap) {
    if (!targetMap || !programmaticMapSyncTargets.has(targetMap)) return false;

    programmaticMapSyncTargets.delete(targetMap);
    return true;
}

function isProgrammaticMapSync(targetMap) {
    return Boolean(targetMap && programmaticMapSyncTargets.has(targetMap));
}

function syncMapView(sourceMap, targetMap) {
    if (!isRefMapSyncEnabled || isSynchronizingMapViews || !sourceMap || !targetMap) return;

    const center = sourceMap.getCenter();
    const zoom = sourceMap.getZoom();
    if (!center || !Number.isFinite(zoom) || mapsHaveSameView(sourceMap, targetMap)) return;

    markProgrammaticMapSync(targetMap);
    isSynchronizingMapViews = true;
    try {
        if (typeof targetMap.moveCamera === "function") {
            targetMap.moveCamera({ center, zoom });
        } else {
            targetMap.setCenter(center);
            targetMap.setZoom(zoom);
        }
    } finally {
        isSynchronizingMapViews = false;
    }
}

function syncReferenceMapFromWorkMap() {
    syncMapView(map, refMap);
}

function syncWorkMapFromReferenceMap() {
    syncMapView(refMap, map);
}

function scheduleMapViewSync(sourceMap, targetMap) {
    if (!isRefMapSyncEnabled || !sourceMap || !targetMap) return;

    pendingMapViewSync = { sourceMap, targetMap };
    if (mapViewSyncFrame) return;

    mapViewSyncFrame = requestAnimationFrame(() => {
        const sync = pendingMapViewSync;
        pendingMapViewSync = null;
        mapViewSyncFrame = null;
        if (sync) syncMapView(sync.sourceMap, sync.targetMap);
    });
}

function cancelScheduledMapViewSync() {
    pendingMapViewSync = null;
    if (!mapViewSyncFrame) return;

    cancelAnimationFrame(mapViewSyncFrame);
    mapViewSyncFrame = null;
}

function scheduleReferenceMapSyncFromWorkMap() {
    scheduleMapViewSync(map, refMap);
}

function scheduleWorkMapSyncFromReferenceMap() {
    scheduleMapViewSync(refMap, map);
}

function focusMapOnResult(targetMap, bounds, location) {
    if (!targetMap || !location) return;

    markProgrammaticMapSync(targetMap);

    if (bounds) {
        targetMap.fitBounds(bounds);
        targetMap.panTo(location);
        return;
    }

    targetMap.setCenter(location);
    targetMap.setZoom(16);
}

function focusMapsOnResult(bounds, location) {
    cancelScheduledMapViewSync();
    focusMapOnResult(map, bounds, location);
    focusMapOnResult(refMap, bounds, location);
}

function clearReferenceSelectionOverlays() {
    if (refMarker) refMarker.setMap(null);
    if (refCircle) refCircle.setMap(null);
}

function updateMarkerFromReferenceMap(latLng) {
    if (!isRefMapSyncEnabled || !latLng) return;

    if (!marker) {
        placeMarkerAndCircle(latLng);
    } else {
        resetImpossibleState();
        marker.setPosition(latLng);
        updateCirclePosition(latLng);
        generateOutput(latLng);
    }

    scheduleReferenceMarkerOverlayRender();
}

function syncReferenceSelectionOverlays() {
    if (!refMap) return;

    if (!isRefMapSyncEnabled || !marker || !circle) {
        clearReferenceSelectionOverlays();
        return;
    }

    const position = marker.getPosition();
    if (!position) {
        clearReferenceSelectionOverlays();
        return;
    }

    if (!refMarker) {
        refMarker = new google.maps.Marker({
            position,
            map: refMap,
            draggable: true,
            zIndex: google.maps.Marker.MAX_ZINDEX + 1
        });

        refMarker.addListener("dragend", (event) => {
            updateMarkerFromReferenceMap(event.latLng);
        });
    } else {
        refMarker.setPosition(position);
        refMarker.setMap(refMap);
    }

    const radius = circle.getRadius ? circle.getRadius() : currentRadius;

    if (!refCircle) {
        refCircle = new google.maps.Circle({
            strokeColor: "#FF0000",
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: "#FF0000",
            fillOpacity: 0.2,
            map: refMap,
            center: position,
            radius,
            clickable: false
        });
    } else {
        refCircle.setCenter(position);
        refCircle.setRadius(radius);
        refCircle.setMap(refMap);
    }
}

function initializeReferenceMap(initialPos) {
    const refMapElement = document.getElementById("ref-map");
    if (!refMapElement) {
        setReferenceMapDirectMode(false);
        return;
    }

    setReferenceMapDirectMode(true);
    refMap = new google.maps.Map(refMapElement, buildMapOptions(initialPos, {
        disableDefaultUI: true,
        keyboardShortcuts: false,
        gestureHandling: "greedy"
    }));
    updateReferenceMapSyncDisplay();

    refMap.addListener("click", (event) => {
        if (!isRefMapSyncEnabled || !event.latLng) return;
        placeMarkerAndCircle(event.latLng);
        scheduleReferenceMarkerOverlayRender();
    });

    const syncWorkMapView = () => {
        if (isProgrammaticMapSync(refMap)) {
            scheduleReferenceMarkerOverlayRender();
            return;
        }
        if (isSynchronizingMapViews || mapsHaveSameView(refMap, map)) {
            scheduleReferenceMarkerOverlayRender();
            return;
        }
        showReferenceLiveMapDuringInteraction();
        scheduleWorkMapSyncFromReferenceMap();
        scheduleReferenceMarkerOverlayRender();
    };

    refMap.addListener("center_changed", syncWorkMapView);
    refMap.addListener("zoom_changed", syncWorkMapView);
    refMap.addListener("idle", () => {
        if (consumeProgrammaticMapSync(refMap)) {
            syncReferenceSelectionOverlays();
            return;
        }
        syncWorkMapFromReferenceMap();
        if (isRefMapSyncEnabled) {
            scheduleRefMapRefresh(REF_MAP_SETTLED_REFRESH_DELAY);
        }
        syncReferenceSelectionOverlays();
    });
}

/* =========================================
   Google Maps 初期化
   ========================================= */
window.initMap = function () {
    geocoder = new google.maps.Geocoder();
    const initialPos = { lat: 35.6999433, lng: 139.7435152 };

    const mapElement = document.getElementById("map");
    if (mapElement) {
        map = new google.maps.Map(mapElement, buildMapOptions(initialPos));
        initializeReferenceMap(initialPos);
        syncReferenceMapFromWorkMap();

        const syncReferenceMapView = () => {
            if (isProgrammaticMapSync(map)) {
                scheduleReferenceMarkerOverlayRender();
                return;
            }
            if (isReferenceOnlyMode) {
                scheduleReferenceMarkerOverlayRender();
                return;
            }
            if (isSynchronizingMapViews || mapsHaveSameView(map, refMap)) {
                scheduleReferenceMarkerOverlayRender();
                return;
            }
            if (isRefMapSyncEnabled) {
                showReferenceLiveMapDuringInteraction();
                scheduleReferenceMapSyncFromWorkMap();
            }
            scheduleReferenceMarkerOverlayRender();
        };

        map.addListener("click", (e) => {
            placeMarkerAndCircle(e.latLng);
        });

        map.addListener("center_changed", syncReferenceMapView);
        map.addListener("zoom_changed", syncReferenceMapView);

        map.addListener("idle", () => {
            if (consumeProgrammaticMapSync(map)) {
                renderReferenceMarkerOverlay();
                return;
            }
            if (isRefMapSyncEnabled) {
                if (isReferenceOnlyMode) {
                    syncWorkMapFromReferenceMap();
                } else {
                    syncReferenceMapFromWorkMap();
                }
                syncReferenceSelectionOverlays();
                scheduleRefMapRefresh(REF_MAP_SETTLED_REFRESH_DELAY);
            }
            renderReferenceMarkerOverlay();
        });
    }

    updateRefMap("東京都千代田区富士見2丁目");

    if (pendingGeocodeAddress) {
        pendingGeocodeAddress = "";
        geocodeAddress();
    }

    refreshTownBoundaryVisibilityState();

    document.addEventListener('click', function (event) {
        const settingsMenu = document.getElementById("settings-menu");
        const settingsBtn = document.getElementById("settings-btn");
        const docsMenu = document.getElementById("docs-menu");
        const docsBtn = document.getElementById("docs-btn");

        const clickedSettings = settingsMenu && settingsBtn
            && (settingsBtn.contains(event.target) || settingsMenu.contains(event.target));
        const clickedDocs = docsMenu && docsBtn
            && (docsBtn.contains(event.target) || docsMenu.contains(event.target));

        if (!clickedSettings && !clickedDocs) {
            closeToolbarMenus();
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

function stripGoogleAddressPrefix(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/^\s*(?:日本|Japan)\s*[、,]?\s*/i, "")
        .replace(/^\s*〒?\s*\d{3}\s*[-‐‑‒–—―ー−]?\s*\d{4}\s*/, "")
        .trim();
}

function normalizeAddressForComparison(value) {
    return normalizeChomeNumbers(stripGoogleAddressPrefix(value))
        .normalize("NFKC")
        .replace(/[‐‑‒–—―−]/g, "-")
        .replace(/[\s　、,]/g, "")
        .replace(/ヶ/g, "ケ")
        .replace(/之/g, "の")
        .trim();
}

function setAddressMatchStatus(state, message, details = "") {
    const status = document.getElementById("address-match-status-display");
    if (!status) return;

    status.classList.remove("is-idle", "is-checking", "is-match", "is-mismatch", "is-unavailable");
    status.classList.add(`is-${state}`);
    status.textContent = message;
    status.title = details;
}

function updateAddressMatchStatus(searchedAddress, result) {
    const googleAddress = stripGoogleAddressPrefix(result && result.formatted_address);
    const normalizedSearchedAddress = normalizeAddressForComparison(searchedAddress);
    const normalizedGoogleAddress = normalizeAddressForComparison(googleAddress);

    if (!normalizedSearchedAddress || !normalizedGoogleAddress) {
        setAddressMatchStatus(
            "unavailable",
            "⚠️ 住所照合: Google マップの住所を確認できませんでした",
            `検索住所: ${searchedAddress || "（空欄）"}\nGoogle住所: ${googleAddress || "（取得できませんでした）"}`
        );
        return false;
    }

    const isMatch = normalizedSearchedAddress === normalizedGoogleAddress;
    const details = `検索住所: ${searchedAddress}\nGoogle住所: ${googleAddress}`;

    if (isMatch) {
        setAddressMatchStatus(
            "match",
            "✅ 住所一致: Google マップの住所と一致しています",
            details
        );
    } else {
        setAddressMatchStatus(
            "mismatch",
            `❌ 住所不一致: Google マップでは「${googleAddress}」です`,
            details
        );
    }

    return isMatch;
}

function stripAdministrativeAddressPrefix(value) {
    return normalizeAddressForComparison(value)
        .replace(/^(?:日本|Japan)/i, "")
        .replace(/^.*?(?:都|道|府|県)/, "")
        .replace(/^.*?(?:市|区|町|村)/, "");
}

function buildMunicipalityStrippedGeocodeQuery(value) {
    const normalized = normalizeAddressForComparison(value)
        .replace(/^(?:日本|Japan)/i, "")
        .replace(/^.*?(?:都|道|府|県)/, "");
    const municipalityPatterns = [
        /^.+?市.+?区/,
        /^.+?郡.+?[町村]/,
        /^.+?[市区町村]/
    ];

    for (const pattern of municipalityPatterns) {
        const match = normalized.match(pattern);
        if (!match) continue;
        return normalized.slice(match[0].length).trim();
    }

    return "";
}

function extractDistinctiveAddressTerms(value) {
    const localAddress = stripAdministrativeAddressPrefix(value)
        .replace(/[〇零一二三四五六七八九十百千]+(?:丁目|番地|番|号|条|線)/g, " ")
        .replace(/[0-9]+(?:丁目|番地|番|号|条|線)?/g, " ")
        .replace(/(?:丁目|番地|番|号|条|線)/g, " ")
        .replace(/[-ー]/g, " ");

    const terms = localAddress.match(/[一-龠々ヶケぁ-んァ-ヶー]+/g) || [];
    return [...new Set(terms.filter((term) => term.length >= 2))];
}

function getGeocodeCandidateSearchText(result) {
    const componentText = result && Array.isArray(result.address_components)
        ? result.address_components.map((component) => component.long_name || "").join("")
        : "";

    return normalizeAddressForComparison(
        `${result && result.formatted_address ? result.formatted_address : ""}${componentText}`
    );
}

function getCommonPrefixLength(a, b) {
    const limit = Math.min(a.length, b.length);
    let length = 0;

    while (length < limit && a[length] === b[length]) {
        length += 1;
    }

    return length;
}

function scoreGeocodeCandidate(searchedAddress, result) {
    const normalizedSearchedAddress = normalizeAddressForComparison(searchedAddress);
    const normalizedGoogleAddress = normalizeAddressForComparison(result && result.formatted_address);
    const candidateSearchText = getGeocodeCandidateSearchText(result);
    const searchedLocalAddress = stripAdministrativeAddressPrefix(searchedAddress);
    const candidateLocalAddress = stripAdministrativeAddressPrefix(result && result.formatted_address);
    let score = 0;

    if (normalizedSearchedAddress && normalizedSearchedAddress === normalizedGoogleAddress) {
        score += 100000;
    } else if (normalizedSearchedAddress && normalizedGoogleAddress.includes(normalizedSearchedAddress)) {
        score += 80000;
    } else if (normalizedGoogleAddress && normalizedSearchedAddress.includes(normalizedGoogleAddress)) {
        score += 30000;
    }

    score += getCommonPrefixLength(normalizedSearchedAddress, normalizedGoogleAddress) * 100;
    score += getCommonPrefixLength(searchedLocalAddress, candidateLocalAddress) * 300;

    // 「神居」のような市区町村名より後ろの固有語を重視し、欠ける候補を降格する。
    extractDistinctiveAddressTerms(searchedAddress).forEach((term) => {
        score += candidateSearchText.includes(term) ? 6000 + term.length * 100 : -12000;
    });

    if (result && result.partial_match) {
        score -= 25000;
    }

    return score;
}

function rankGeocodeCandidates(searchedAddress, results) {
    return (Array.isArray(results) ? results : [])
        .filter((result) => result && result.geometry && result.geometry.location)
        .map((result, originalIndex) => ({
            result,
            originalIndex,
            score: scoreGeocodeCandidate(searchedAddress, result)
        }))
        .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
}

function updateGeocodeCandidateControls() {
    const controls = document.getElementById("geocode-candidate-controls");
    const count = document.getElementById("geocode-candidate-count");
    const address = document.getElementById("geocode-candidate-address");
    const previousButton = document.getElementById("prev-geocode-candidate-btn");
    const nextButton = document.getElementById("next-geocode-candidate-btn");
    const retryButton = document.getElementById("retry-geocode-without-municipality-btn");
    const candidateCount = currentGeocodeCandidates.length;
    const hasSelection = candidateCount > 0
        && currentGeocodeCandidateIndex >= 0
        && currentGeocodeCandidateIndex < candidateCount;
    const selectedEntry = hasSelection ? currentGeocodeCandidates[currentGeocodeCandidateIndex] : null;
    const selectedResult = selectedEntry ? selectedEntry.result : null;

    if (controls) controls.hidden = !hasSelection;
    if (count) {
        count.textContent = hasSelection
            ? `候補 ${currentGeocodeCandidateIndex + 1} / ${candidateCount}`
            : "候補 0 / 0";
    }
    if (address) {
        const partialMatchLabel = selectedResult && selectedResult.partial_match ? "（部分一致）" : "";
        address.textContent = selectedResult
            ? `${stripGoogleAddressPrefix(selectedResult.formatted_address)}${partialMatchLabel}`
            : "";
        address.title = address.textContent;
    }
    if (previousButton) previousButton.disabled = !hasSelection || currentGeocodeCandidateIndex <= 0;
    if (nextButton) nextButton.disabled = !hasSelection || currentGeocodeCandidateIndex >= candidateCount - 1;
    if (retryButton) {
        const retryQuery = buildMunicipalityStrippedGeocodeQuery(currentGeocodeAddress);
        const isSameQuery = normalizeAddressForComparison(retryQuery) === normalizeAddressForComparison(currentGeocodeQuery);
        retryButton.disabled = !hasSelection || !retryQuery || isSameQuery;
        retryButton.title = retryQuery && !isSameQuery
            ? `「${retryQuery}」で再検索します`
            : "この短縮住所では再検索済みです";
    }
}

function resetGeocodeCandidates() {
    geocodeCandidateApplyToken += 1;
    currentGeocodeAddress = "";
    currentGeocodeQuery = "";
    currentGeocodeCandidates = [];
    currentGeocodeCandidateIndex = -1;
    updateGeocodeCandidateControls();
}

function selectRelativeGeocodeCandidate(offset) {
    if (!Number.isInteger(offset) || !currentGeocodeCandidates.length) return;

    const nextIndex = currentGeocodeCandidateIndex + offset;
    if (nextIndex < 0 || nextIndex >= currentGeocodeCandidates.length) return;

    applyGeocodeCandidate(nextIndex, geocodeRequestToken).catch((error) => {
        console.error("Geocode candidate apply failed.", error);
        appendCalculationLog("候補の切り替えに失敗しました。", "warning");
    });
}

function retryGeocodeWithoutMunicipalityPrefix() {
    const addressInput = document.getElementById("address-input");
    const originalAddress = currentGeocodeAddress || (addressInput ? addressInput.value.trim() : "");
    const retryQuery = buildMunicipalityStrippedGeocodeQuery(originalAddress);

    if (!retryQuery) {
        appendCalculationLog("市区町村までを除いた再検索語を作成できませんでした。", "warning");
        return;
    }

    if (normalizeAddressForComparison(retryQuery) === normalizeAddressForComparison(currentGeocodeQuery)) {
        appendCalculationLog(`短縮住所「${retryQuery}」では再検索済みです。`, "muted");
        return;
    }

    requestGeocodeCandidates(retryQuery, originalAddress, true);
}

function hasLoadedTownBoundaryData() {
    return Boolean(activeTownBoundaryData && Array.isArray(activeTownBoundaryData.features));
}

function clearTownBoundaryLayer() {
    if (townBoundaryLayer) {
        townBoundaryLayer.setMap(null);
        townBoundaryLayer = null;
    }

    townBoundaryLayerDatasetKey = "";
}

function applyTownBoundaryDataset(definition, data) {
    const nextDatasetKey = definition && definition.key ? String(definition.key) : "";
    const datasetChanged = nextDatasetKey !== activeTownBoundaryDatasetKey;

    activeTownBoundaryData = data;
    activeTownBoundaryDatasetKey = nextDatasetKey;
    townBoundaryDataStatus = hasLoadedTownBoundaryData() ? "ready" : "unloaded";

    if (datasetChanged) {
        clearTownBoundarySelection(true);
        clearTownBoundaryLayer();
    }
}

function resetTownBoundaryData(status = "unloaded") {
    activeTownBoundaryData = null;
    activeTownBoundaryDatasetKey = "";
    townBoundaryDataStatus = status;
    clearTownBoundarySelection(true);
    clearTownBoundaryLayer();
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
        refreshTownBoundaryVisibilityState();
    }
}

function initializeTownBoundaryLayer() {
    if (!map) return false;

    if (!hasLoadedTownBoundaryData()) {
        refreshTownBoundaryVisibilityState();
        return false;
    }

    if (townBoundaryLayer && townBoundaryLayerDatasetKey === activeTownBoundaryDatasetKey) {
        return true;
    }

    clearTownBoundaryLayer();
    townBoundaryLayer = new google.maps.Data({ map: map });
    townBoundaryLayer.addGeoJson(activeTownBoundaryData);
    townBoundaryLayerDatasetKey = activeTownBoundaryDatasetKey;
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

function buildTownBoundaryTownSearchTexts(cityCandidates, searchTexts) {
    const candidates = new Set();

    if (!cityCandidates.size) {
        return candidates;
    }

    searchTexts.forEach((text) => {
        cityCandidates.forEach((cityName) => {
            const cityIndex = text.indexOf(cityName);

            if (cityIndex < 0) {
                return;
            }

            const townName = text.slice(cityIndex + cityName.length);

            if (townName) {
                candidates.add(townName);
            }
        });
    });

    return candidates;
}

function findTownBoundaryMatches(result) {
    if (!hasLoadedTownBoundaryData()) {
        return [];
    }

    const cityCandidates = buildTownBoundaryCityCandidates(result);
    const searchTexts = buildTownBoundarySearchTexts(result);
    const townSearchTexts = buildTownBoundaryTownSearchTexts(cityCandidates, searchTexts);

    if (!searchTexts.size) {
        return [];
    }

    let bestScore = 0;
    let matches = [];

    activeTownBoundaryData.features.forEach((feature) => {
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
        const townCandidateNames = [
            String(props.town_name_normalized || ""),
            String(props.town_name_arabic_normalized || "")
        ].filter(Boolean);

        let featureScore = 0;

        searchTexts.forEach((text) => {
            candidateNames.forEach((candidateName) => {
                if (text.includes(candidateName)) {
                    featureScore = Math.max(featureScore, 10000 + candidateName.length);
                }
            });
        });

        townSearchTexts.forEach((townText) => {
            if (townText.length < 3) {
                return;
            }

            townCandidateNames.forEach((candidateName) => {
                if (candidateName.includes(townText)) {
                    featureScore = Math.max(featureScore, 5000 + townText.length);
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

function updateTownBoundaryOverlay(result, matchedFeatures = null) {
    if (!initializeTownBoundaryLayer()) {
        return false;
    }

    const matches = Array.isArray(matchedFeatures) ? matchedFeatures : findTownBoundaryMatches(result);
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

function getAddressComponent(result, type) {
    const components = result && Array.isArray(result.address_components) ? result.address_components : [];
    const match = components.find((component) => Array.isArray(component.types) && component.types.includes(type));
    return match ? match.long_name : "";
}

async function ensureTownBoundaryDataForResult(result) {
    const loader = window.TownBoundaryLoader;
    if (!loader || typeof loader.ensureDatasetForResult !== "function") {
        resetTownBoundaryData("error");
        refreshTownBoundaryVisibilityState();
        return { available: false, reason: "loader_unavailable" };
    }

    const resolvedDefinition = typeof loader.resolveDatasetDefinition === "function"
        ? loader.resolveDatasetDefinition(result)
        : null;

    if (!resolvedDefinition) {
        resetTownBoundaryData("unavailable");
        refreshTownBoundaryVisibilityState();
        return { available: false, reason: "not_configured" };
    }

    if (resolvedDefinition.key === activeTownBoundaryDatasetKey && hasLoadedTownBoundaryData()) {
        initializeTownBoundaryLayer();
        return {
            available: true,
            definition: resolvedDefinition,
            data: activeTownBoundaryData,
            cached: true
        };
    }

    townBoundaryDataStatus = "loading";
    refreshTownBoundaryVisibilityState();

    try {
        const loaded = await loader.ensureDatasetForResult(result);
        if (!loaded || !loaded.definition || !loaded.data) {
            resetTownBoundaryData("unavailable");
            refreshTownBoundaryVisibilityState();
            return { available: false, reason: "not_configured" };
        }

        applyTownBoundaryDataset(loaded.definition, loaded.data);
        initializeTownBoundaryLayer();
        return {
            available: true,
            definition: loaded.definition,
            data: loaded.data,
            cached: false
        };
    } catch (error) {
        console.error("Town boundary dataset load failed.", error);
        resetTownBoundaryData("error");
        refreshTownBoundaryVisibilityState();
        return { available: false, reason: "load_failed", error };
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
        resetImpossibleState();
        updateCirclePosition(e.latLng);
        generateOutput(e.latLng);
        scheduleReferenceMarkerOverlayRender();
    });

    drawCircle(latLng);
    generateOutput(latLng);
    syncReferenceSelectionOverlays();
}

function drawCircle(center) {
    if (circle) circle.setMap(null);
    circle = new google.maps.Circle({
        strokeColor: "#FF0000", strokeOpacity: 0.8, strokeWeight: 2,
        fillColor: "#FF0000", fillOpacity: 0.2, map: map, center: center,
        radius: currentRadius, clickable: false
    });
    renderReferenceMarkerOverlay();
    syncReferenceSelectionOverlays();
}

function updateCirclePosition(latLng) {
    if (circle) circle.setCenter(latLng);
    renderReferenceMarkerOverlay();
    syncReferenceSelectionOverlays();
}

function getRadiusLabel(radius) {
    return radius >= 1000 ? `${radius / 1000}km` : `${radius}m`;
}

function choosePresetRadius(distance) {
    for (const radius of RADIUS_PRESETS) {
        if (radius >= distance) {
            return radius;
        }
    }

    return 1000;
}

function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function isCoordinatePair(pair) {
    return Array.isArray(pair)
        && pair.length >= 2
        && typeof pair[0] === "number"
        && typeof pair[1] === "number";
}

function coordinatesAreSame(a, b) {
    return isCoordinatePair(a) && isCoordinatePair(b) && a[0] === b[0] && a[1] === b[1];
}

function collectGeoJsonRings(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) {
        return [];
    }

    if (geometry.type === "Polygon") {
        return geometry.coordinates.filter((ring) => Array.isArray(ring) && ring.every(isCoordinatePair));
    }

    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.flatMap((polygon) => (
            Array.isArray(polygon)
                ? polygon.filter((ring) => Array.isArray(ring) && ring.every(isCoordinatePair))
                : []
        ));
    }

    return [];
}

function getCoordinatePairKey(pair) {
    return `${pair[0]},${pair[1]}`;
}

function collectTownBoundaryVertices(matches) {
    const vertices = [];
    const seen = new Set();
    let ringCount = 0;

    matches.forEach((feature) => {
        const rings = collectGeoJsonRings(feature && feature.geometry);
        ringCount += rings.length;

        rings.forEach((ring) => {
            const limit = coordinatesAreSame(ring[0], ring[ring.length - 1])
                ? Math.max(ring.length - 1, 0)
                : ring.length;

            for (let i = 0; i < limit; i += 1) {
                const pair = ring[i];
                if (!isCoordinatePair(pair)) continue;

                const key = getCoordinatePairKey(pair);
                if (seen.has(key)) continue;
                seen.add(key);
                vertices.push({ lng: pair[0], lat: pair[1] });
            }
        });
    });

    return { vertices, ringCount };
}

function getLocalProjectionOrigin(vertices) {
    const sums = vertices.reduce((acc, vertex) => {
        acc.lat += vertex.lat;
        acc.lng += vertex.lng;
        return acc;
    }, { lat: 0, lng: 0 });

    return {
        lat: sums.lat / vertices.length,
        lng: sums.lng / vertices.length
    };
}

function projectLatLngToLocalMeters(lat, lng, origin) {
    const latRad = lat * Math.PI / 180;
    const lngRad = lng * Math.PI / 180;
    const originLatRad = origin.lat * Math.PI / 180;
    const originLngRad = origin.lng * Math.PI / 180;

    return {
        x: EARTH_RADIUS_METERS * (lngRad - originLngRad) * Math.cos(originLatRad),
        y: EARTH_RADIUS_METERS * (latRad - originLatRad)
    };
}

function unprojectLocalMetersToLatLng(point, origin) {
    const originLatRad = origin.lat * Math.PI / 180;
    const lat = origin.lat + (point.y / EARTH_RADIUS_METERS) * 180 / Math.PI;
    const lng = origin.lng + (point.x / (EARTH_RADIUS_METERS * Math.cos(originLatRad))) * 180 / Math.PI;
    return new google.maps.LatLng(lat, lng);
}

function shuffleArray(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function getSquaredDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function isPointInsideCircle(point, circle) {
    if (!circle) return false;
    return getSquaredDistance(point, circle) <= (circle.r * circle.r) + 1e-6;
}

function makeCircleFromTwoPoints(a, b) {
    const center = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
    };

    return {
        ...center,
        r: Math.sqrt(getSquaredDistance(a, center)),
        supportSize: 2
    };
}

function makeCircleFromThreePoints(a, b, c) {
    const d = 2 * (
        a.x * (b.y - c.y)
        + b.x * (c.y - a.y)
        + c.x * (a.y - b.y)
    );

    if (Math.abs(d) < 1e-9) {
        return null;
    }

    const ux = (
        (a.x * a.x + a.y * a.y) * (b.y - c.y)
        + (b.x * b.x + b.y * b.y) * (c.y - a.y)
        + (c.x * c.x + c.y * c.y) * (a.y - b.y)
    ) / d;
    const uy = (
        (a.x * a.x + a.y * a.y) * (c.x - b.x)
        + (b.x * b.x + b.y * b.y) * (a.x - c.x)
        + (c.x * c.x + c.y * c.y) * (b.x - a.x)
    ) / d;

    const center = { x: ux, y: uy };
    return {
        ...center,
        r: Math.sqrt(getSquaredDistance(a, center)),
        supportSize: 3
    };
}

function crossProduct(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function makeCircleWithTwoBoundaryPoints(points, p, q) {
    let circle = makeCircleFromTwoPoints(p, q);
    let left = null;
    let right = null;

    points.forEach((r) => {
        if (isPointInsideCircle(r, circle)) return;

        const cross = crossProduct(p, q, r);
        const candidate = makeCircleFromThreePoints(p, q, r);
        if (!candidate) return;

        if (cross > 0) {
            if (!left || crossProduct(p, q, candidate) > crossProduct(p, q, left)) {
                left = candidate;
            }
        } else if (cross < 0) {
            if (!right || crossProduct(p, q, candidate) < crossProduct(p, q, right)) {
                right = candidate;
            }
        }
    });

    if (!left && !right) return circle;
    if (!left) return right;
    if (!right) return left;
    return left.r <= right.r ? left : right;
}

function computeMinimumEnclosingCircle(points) {
    if (!points.length) return null;

    let circle = null;
    const shuffled = shuffleArray(points);

    shuffled.forEach((point, i) => {
        if (circle && isPointInsideCircle(point, circle)) {
            return;
        }

        circle = { x: point.x, y: point.y, r: 0, supportSize: 1 };

        for (let j = 0; j < i; j += 1) {
            const q = shuffled[j];
            if (isPointInsideCircle(q, circle)) continue;

            circle = makeCircleFromTwoPoints(point, q);

            for (let k = 0; k < j; k += 1) {
                const r = shuffled[k];
                if (isPointInsideCircle(r, circle)) continue;
                circle = makeCircleWithTwoBoundaryPoints(shuffled.slice(0, j + 1), point, q);
            }
        }
    });

    return circle;
}

function buildBoundsFromVertices(vertices) {
    const bounds = new google.maps.LatLngBounds();
    vertices.forEach((vertex) => {
        bounds.extend(new google.maps.LatLng(vertex.lat, vertex.lng));
    });
    return bounds;
}

function getTownBoundaryAutoRadiusResult(location, matches) {
    if (!Array.isArray(matches) || !matches.length) {
        return null;
    }

    const { vertices, ringCount } = collectTownBoundaryVertices(matches);
    if (!vertices.length) {
        return null;
    }

    const projectionOrigin = getLocalProjectionOrigin(vertices);
    const projectedPoints = vertices.map((vertex) => ({
        ...vertex,
        ...projectLatLngToLocalMeters(vertex.lat, vertex.lng, projectionOrigin)
    }));

    const minCircle = computeMinimumEnclosingCircle(projectedPoints);
    if (!minCircle) {
        return null;
    }

    const center = unprojectLocalMetersToLatLng(minCircle, projectionOrigin);
    let maxDistance = 0;
    let farthestVertex = null;

    vertices.forEach((vertex) => {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(
            center,
            new google.maps.LatLng(vertex.lat, vertex.lng)
        );
        if (distance > maxDistance) {
            maxDistance = distance;
            farthestVertex = vertex;
        }
    });

    const roundedDistance = Math.round(maxDistance);
    const stats = {
        features: matches.length,
        rings: ringCount,
        vertices: vertices.length,
        supportSize: minCircle.supportSize || 0,
        centerShift: location ? Math.round(google.maps.geometry.spherical.computeDistanceBetween(location, center)) : 0,
        farthestVertex
    };
    return {
        center,
        distance: roundedDistance,
        selectedRadius: choosePresetRadius(roundedDistance),
        isImpossible: roundedDistance > 1000,
        bounds: buildBoundsFromVertices(vertices),
        stats: {
            ...stats
        }
    };
}

function getLatLngBoundsCorners(bounds) {
    if (!bounds || typeof bounds.getNorthEast !== "function" || typeof bounds.getSouthWest !== "function") {
        return [];
    }

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    if (!northEast || !southWest) {
        return [];
    }

    const northWest = new google.maps.LatLng(northEast.lat(), southWest.lng());
    const southEast = new google.maps.LatLng(southWest.lat(), northEast.lng());
    return [northEast, northWest, southEast, southWest];
}

function getSearchAreaAutoRadiusResult(location, searchArea) {
    if (!searchArea || typeof searchArea.getCenter !== "function") {
        return null;
    }

    const center = searchArea.getCenter() || location;
    if (!center) {
        return null;
    }

    const corners = getLatLngBoundsCorners(searchArea);
    const maxDistance = corners.reduce((max, corner) => {
        const distance = google.maps.geometry.spherical.computeDistanceBetween(center, corner);
        return Math.max(max, distance);
    }, 0);
    const roundedDistance = Math.round(maxDistance);

    return {
        center,
        distance: roundedDistance,
        selectedRadius: choosePresetRadius(roundedDistance),
        isImpossible: roundedDistance > 1000,
        bounds: searchArea,
        stats: {
            centerShift: location ? Math.round(google.maps.geometry.spherical.computeDistanceBetween(location, center)) : 0
        }
    };
}

function getImpossibleOutputText() {
    return "ジオ付与不可能（消防出動情報向けのメッセージです）";
}

function normalizeImpossibleButton() {
    const impBtn = document.getElementById('impossible-btn');
    if (!impBtn) return null;

    if (impBtn.dataset.timer) {
        clearTimeout(Number(impBtn.dataset.timer));
        delete impBtn.dataset.timer;
    }

    impBtn.innerText = "不可";
    impBtn.style.backgroundColor = "";
    impBtn.style.border = "";
    return impBtn;
}

function activateImpossibleSelection() {
    document.querySelectorAll('.radius-btn').forEach(btn => btn.classList.remove('active'));
    const impBtn = normalizeImpossibleButton();
    if (impBtn) impBtn.classList.add('active');

    const output = document.getElementById("output-text");
    if (output) {
        output.value = getImpossibleOutputText();
    }
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
    renderReferenceMarkerOverlay();
    syncReferenceSelectionOverlays();
}

// 不可ボタン
function setImpossible() {
    activateImpossibleSelection();
    const impBtn = document.getElementById('impossible-btn');
    const text = getImpossibleOutputText();

    navigator.clipboard.writeText(text).then(() => {
        if (!impBtn) return;
        if (impBtn.dataset.timer) clearTimeout(Number(impBtn.dataset.timer));

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
        normalizeImpossibleButton();

        const radiusBtns = document.querySelectorAll('.radius-group button:not(#impossible-btn)');
        radiusBtns.forEach(btn => {
            let btnRadius = parseInt(btn.innerText);
            if (btn.innerText.includes("km")) btnRadius *= 1000;
            if (btnRadius === currentRadius) btn.classList.add('active');
        });
    }
}

async function applyGeocodeCandidate(candidateIndex, requestToken = geocodeRequestToken) {
    if (requestToken !== geocodeRequestToken) return;
    if (candidateIndex < 0 || candidateIndex >= currentGeocodeCandidates.length) return;

    const entry = currentGeocodeCandidates[candidateIndex];
    const result = entry && entry.result;
    if (!result || !result.geometry || !result.geometry.location) return;

    const applyToken = ++geocodeCandidateApplyToken;
    const address = currentGeocodeAddress;
    const calcDisplay = document.getElementById("calculated-radius-display");
    const location = result.geometry.location;
    const selectedAddress = stripGoogleAddressPrefix(result.formatted_address) || "（住所なし）";
    currentGeocodeCandidateIndex = candidateIndex;
    currentSearchArea = null;
    updateGeocodeCandidateControls();
    updateAddressMatchStatus(address, result);
    if (calcDisplay) calcDisplay.innerText = "";
    appendCalculationLog(
        `候補 ${candidateIndex + 1}/${currentGeocodeCandidates.length} を適用: ${selectedAddress}`,
        candidateIndex === 0 ? "active" : "muted"
    );

    // 厳密な範囲(bounds)があれば優先
    const searchArea = result.geometry.bounds || result.geometry.viewport;
    const townBoundaryLoadResult = await ensureTownBoundaryDataForResult(result);
    if (requestToken !== geocodeRequestToken || applyToken !== geocodeCandidateApplyToken) return;

    if (townBoundaryLoadResult.available && townBoundaryLoadResult.definition && !townBoundaryLoadResult.cached) {
        appendCalculationLog(`町丁境界データ読込: ${townBoundaryLoadResult.definition.label || townBoundaryLoadResult.definition.key}`, "muted");
    } else if (!townBoundaryLoadResult.available && townBoundaryLoadResult.reason === "not_configured") {
        appendCalculationLog("町丁境界データなし: この地域は未対応です。", "muted");
    } else if (!townBoundaryLoadResult.available && townBoundaryLoadResult.reason !== "loader_unavailable") {
        appendCalculationLog("町丁境界データを使えないため、境界照合をスキップします。", "warning");
    }

    const townBoundaryMatches = townBoundaryLoadResult.available ? findTownBoundaryMatches(result) : [];
    let autoRadiusResult = null;
    let placementLocation = location;
    let mapFocusBounds = searchArea;

    if (isAutoRadiusEnabled) {
        if (townBoundaryMatches.length) {
            const names = townBoundaryMatches
                .map((feature) => String(feature.properties && (feature.properties.full_name_arabic || feature.properties.full_name) || ""))
                .filter(Boolean);
            appendCalculationLog(`町丁境界一致: ${names.slice(0, 3).join(" / ")}${names.length > 3 ? " ほか" : ""}`);
        } else {
            appendCalculationLog("町丁境界一致なし: bounds/viewport へフォールバック", "muted");
        }

        autoRadiusResult = getTownBoundaryAutoRadiusResult(location, townBoundaryMatches);

        if (autoRadiusResult) {
            placementLocation = autoRadiusResult.center;
            mapFocusBounds = autoRadiusResult.bounds || searchArea;
            setRadius(autoRadiusResult.selectedRadius);
            const stats = autoRadiusResult.stats || {};
            appendCalculationLog(
                `町丁境界から最小包含円を計算: feature ${stats.features || 0}件 / ring ${stats.rings || 0} / vertex ${stats.vertices || 0} / 支持点 ${stats.supportSize || 0}`,
                "active"
            );
            appendCalculationLog(
                `中心補正: 初期ジオから ${stats.centerShift || 0}m 移動して最小包含円の中心を採用`,
                "active"
            );
            if (calcDisplay) {
                calcDisplay.innerText = autoRadiusResult.isImpossible
                    ? `町丁境界(必要半径): ${autoRadiusResult.distance}m → 不可を選択 / 円は1kmを表示`
                    : `町丁境界(必要半径): ${autoRadiusResult.distance}m → ${getRadiusLabel(autoRadiusResult.selectedRadius)}を設定`;
            }
            appendCalculationLog(
                autoRadiusResult.isImpossible
                    ? `判定結果: 必要半径 ${autoRadiusResult.distance}m のため不可。円は 1km を表示`
                    : `判定結果: 必要半径 ${autoRadiusResult.distance}m → ${getRadiusLabel(autoRadiusResult.selectedRadius)}`,
                autoRadiusResult.isImpossible ? "warning" : "active"
            );
        } else if (searchArea) {
            autoRadiusResult = getSearchAreaAutoRadiusResult(location, searchArea);
            placementLocation = autoRadiusResult.center || location;
            mapFocusBounds = autoRadiusResult.bounds || searchArea;
            setRadius(autoRadiusResult.selectedRadius);
            if (calcDisplay) {
                calcDisplay.innerText = autoRadiusResult.isImpossible
                    ? `検索範囲(必要半径): ${autoRadiusResult.distance}m → 不可を選択 / 円は1kmを表示`
                    : `検索範囲(必要半径): ${autoRadiusResult.distance}m → ${getRadiusLabel(autoRadiusResult.selectedRadius)}を設定`;
            }
            appendCalculationLog(
                `フォールバック判定: bounds/viewport の中心を採用。四隅までの必要半径 ${autoRadiusResult.distance}m → ${getRadiusLabel(autoRadiusResult.selectedRadius)}`,
                autoRadiusResult.isImpossible ? "warning" : "muted"
            );
        } else if (calcDisplay) {
            calcDisplay.innerText = "範囲データなし";
            appendCalculationLog("範囲データがないため自動半径は更新されませんでした。", "warning");
        }
    } else {
        appendCalculationLog("自動半径計算は OFF のため、現在の半径設定を維持します。", "muted");
    }

    placeMarkerAndCircle(placementLocation);
    if (autoRadiusResult && autoRadiusResult.isImpossible) {
        activateImpossibleSelection();
    }

    if (marker) {
        marker.setZIndex(google.maps.Marker.MAX_ZINDEX + 1);
    }

    // 青枠の描画
    if (mapFocusBounds) {
        currentSearchArea = mapFocusBounds;
        renderBoundsRect();
        focusMapsOnResult(mapFocusBounds, placementLocation);
    } else {
        renderBoundsRect();
        focusMapsOnResult(null, placementLocation);
    }

    setRefMapViewOverride(placementLocation, getRefMapZoom() || 16);
    const refMapQuery = currentGeocodeCandidates.length > 1 && result.formatted_address
        ? result.formatted_address
        : address;
    updateRefMap(refMapQuery);
    updateTownBoundaryOverlay(result, townBoundaryMatches);
}

function requestGeocodeCandidates(query, searchedAddress, isRetry = false) {
    const normalizedQuery = String(query || "").trim();
    const comparisonAddress = String(searchedAddress || normalizedQuery).trim();
    const calcDisplay = document.getElementById("calculated-radius-display");

    if (!normalizedQuery || !comparisonAddress) return;

    resetGeocodeCandidates();
    currentGeocodeAddress = comparisonAddress;
    currentGeocodeQuery = normalizedQuery;
    setAddressMatchStatus(
        "checking",
        isRetry
            ? `🔎 住所照合: 「${normalizedQuery}」で再検索中…`
            : "🔎 住所照合: Google マップの候補を確認中…"
    );

    if (!geocoder) {
        pendingGeocodeAddress = comparisonAddress;
        return;
    }

    pendingGeocodeAddress = "";

    if (calcDisplay) calcDisplay.innerText = "";
    appendCalculationLog(
        isRetry
            ? `市区町村を除いて再検索: ${normalizedQuery}（元住所: ${comparisonAddress}）`
            : `検索開始: ${normalizedQuery}`
    );

    QuotaManager.increment();
    const requestToken = ++geocodeRequestToken;

    geocoder.geocode({ 'address': normalizedQuery }, (results, status) => {
        if (requestToken !== geocodeRequestToken) return;

        if (status === 'OK' && Array.isArray(results) && results.length) {
            currentGeocodeAddress = comparisonAddress;
            currentGeocodeQuery = normalizedQuery;
            currentGeocodeCandidates = rankGeocodeCandidates(comparisonAddress, results);
            currentGeocodeCandidateIndex = currentGeocodeCandidates.length ? 0 : -1;
            updateGeocodeCandidateControls();

            appendCalculationLog(`住所候補: ${currentGeocodeCandidates.length}件（一致度順）`, "muted");
            currentGeocodeCandidates.slice(0, 5).forEach((entry, index) => {
                const candidateAddress = stripGoogleAddressPrefix(entry.result.formatted_address) || "（住所なし）";
                const partialMatchLabel = entry.result.partial_match ? " / 部分一致" : "";
                appendCalculationLog(
                    `候補 ${index + 1}: ${candidateAddress}${partialMatchLabel}`,
                    index === 0 ? "active" : "muted"
                );
            });

            if (!currentGeocodeCandidates.length) {
                setAddressMatchStatus(
                    "unavailable",
                    "⚠️ 住所照合: 座標を持つ候補がありませんでした",
                    `検索住所: ${comparisonAddress}\nGoogleへの検索語: ${normalizedQuery}`
                );
                return;
            }

            applyGeocodeCandidate(0, requestToken).catch((error) => {
                console.error("Initial geocode candidate apply failed.", error);
                appendCalculationLog("先頭候補の適用に失敗しました。", "warning");
            });
            return;
        }

        resetGeocodeCandidates();
        appendCalculationLog(`検索失敗: ${status}`, "warning");
        setAddressMatchStatus(
            "unavailable",
            "⚠️ 住所照合: 検索に失敗したため確認できませんでした",
            `検索住所: ${comparisonAddress}\nGoogleへの検索語: ${normalizedQuery}\nGoogle Maps status: ${status}`
        );
        alert('検索できませんでした: ' + status);
    });
}

// ★修正版: 住所検索 (広めの半径計算)
function geocodeAddress() {
    const addressInput = document.getElementById("address-input");
    const address = addressInput ? addressInput.value.trim() : "";

    if (!address) return;
    requestGeocodeCandidates(address, address, false);
}

function getReferenceViewMap() {
    return isReferenceOnlyMode && refMap ? refMap : map;
}

function getRefMapZoom() {
    const viewMap = getReferenceViewMap();
    if (!viewMap) return null;

    const zoom = viewMap.getZoom();
    if (!Number.isFinite(zoom)) return null;
    return Math.min(Math.max(Math.round(zoom), 0), 21);
}

function setRefMapViewOverride(center, zoom = null) {
    if (!center) return;

    const normalizedZoom = Number.isFinite(zoom)
        ? Math.min(Math.max(Math.round(zoom), 0), 21)
        : null;

    refMapViewOverride = {
        center,
        zoom: normalizedZoom
    };
}

function formatRefMapCenter(center) {
    if (!center) return "";
    return `${center.lat().toFixed(7)},${center.lng().toFixed(7)}`;
}

function buildRefMapUrl(query) {
    if (!apiKey || !query) return "";

    const params = new URLSearchParams({
        key: apiKey,
        q: query
    });

    const viewMap = getReferenceViewMap();
    if (isRefMapSyncEnabled && viewMap) {
        const view = refMapViewOverride || {};
        const center = formatRefMapCenter(view.center || viewMap.getCenter());
        const zoom = Number.isFinite(view.zoom) ? view.zoom : getRefMapZoom();
        if (center) params.set("center", center);
        if (Number.isFinite(zoom)) params.set("zoom", String(zoom));
    }

    return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
}

function renderRefMap() {
    const frame = document.getElementById("ref-frame");
    if (!frame || !apiKey || !lastRefMapQuery) return;

    if (!frame.dataset.overlayListenerAttached) {
        frame.addEventListener("load", () => {
            const revealToken = Number(frame.dataset.revealToken || refMapLiveViewToken);
            setTimeout(() => {
                renderReferenceMarkerOverlay();
                revealReferenceFrame(0, revealToken);
            }, REF_MAP_REVEAL_AFTER_LOAD_DELAY);
        });
        frame.dataset.overlayListenerAttached = "true";
    }

    const embedUrl = buildRefMapUrl(lastRefMapQuery);
    if (embedUrl && embedUrl !== lastRefMapEmbedUrl) {
        frame.dataset.revealToken = String(refMapLiveViewToken);
        frame.src = embedUrl;
        lastRefMapEmbedUrl = embedUrl;
    } else {
        revealReferenceFrame(REF_MAP_REVEAL_AFTER_LOAD_DELAY);
    }
    refMapViewOverride = null;
    renderReferenceMarkerOverlay();
}

function scheduleRefMapRefresh(delay = 0) {
    if (refMapRefreshTimer) {
        clearTimeout(refMapRefreshTimer);
    }

    refMapRefreshTimer = setTimeout(() => {
        refMapRefreshTimer = null;
        renderRefMap();
    }, Math.max(0, delay));
}

function updateRefMap(query) {
    lastRefMapQuery = query || lastRefMapQuery;

    scheduleRefMapRefresh(0);
    scheduleReferenceMarkerOverlayRender();
}

function scheduleReferenceMarkerOverlayRender() {
    if (refMapOverlayFrame) return;

    refMapOverlayFrame = requestAnimationFrame(() => {
        refMapOverlayFrame = null;
        renderReferenceMarkerOverlay();
    });
}

function projectLatLngToWorldPoint(lat, lng) {
    const siny = clampNumber(Math.sin(lat * Math.PI / 180), -0.9999, 0.9999);
    return {
        x: 256 * (0.5 + lng / 360),
        y: 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI))
    };
}

function projectLatLngToRefMapPixel(latLng, center, zoom, rect) {
    const markerPoint = projectLatLngToWorldPoint(latLng.lat(), latLng.lng());
    const centerPoint = projectLatLngToWorldPoint(center.lat(), center.lng());
    const scale = 2 ** zoom;

    return {
        x: (markerPoint.x - centerPoint.x) * scale + rect.width / 2,
        y: (markerPoint.y - centerPoint.y) * scale + rect.height / 2
    };
}

function getMetersPerPixel(lat, zoom) {
    return Math.cos(lat * Math.PI / 180) * 2 * Math.PI * EARTH_RADIUS_METERS / (256 * (2 ** zoom));
}

function ensureReferenceOverlayElements(overlay) {
    let radiusCircle = overlay.querySelector(".ref-radius-circle");
    let pin = overlay.querySelector(".ref-marker-pin");

    if (!radiusCircle) {
        radiusCircle = document.createElement("div");
        radiusCircle.className = "ref-radius-circle";
        overlay.appendChild(radiusCircle);
    }

    if (!pin) {
        pin = document.createElement("div");
        pin.className = "ref-marker-pin";
        overlay.appendChild(pin);
    }

    return { radiusCircle, pin };
}

function setReferenceOverlayVisible(elements, isVisible) {
    const display = isVisible ? "block" : "none";
    elements.radiusCircle.style.display = display;
    elements.pin.style.display = display;
}

function renderReferenceMarkerOverlay() {
    const overlay = document.getElementById("ref-marker-overlay");
    if (!overlay) return;

    const elements = ensureReferenceOverlayElements(overlay);

    if (!isRefMapSyncEnabled || !map || !marker || !circle) {
        setReferenceOverlayVisible(elements, false);
        return;
    }

    const viewMap = getReferenceViewMap();
    const center = viewMap ? viewMap.getCenter() : null;
    const zoom = getRefMapZoom();
    const markerPosition = marker.getPosition();
    if (!center || !markerPosition || !Number.isFinite(zoom)) {
        setReferenceOverlayVisible(elements, false);
        return;
    }

    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        setReferenceOverlayVisible(elements, false);
        return;
    }

    const pixel = projectLatLngToRefMapPixel(markerPosition, center, zoom, rect);
    const metersPerPixel = getMetersPerPixel(markerPosition.lat(), zoom);
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
        setReferenceOverlayVisible(elements, false);
        return;
    }

    const radiusPx = currentRadius / metersPerPixel;
    const padding = Math.max(radiusPx, 24);
    const isOutside = pixel.x < -padding
        || pixel.x > rect.width + padding
        || pixel.y < -padding
        || pixel.y > rect.height + padding;
    if (isOutside) {
        setReferenceOverlayVisible(elements, false);
        return;
    }

    elements.radiusCircle.style.left = `${pixel.x}px`;
    elements.radiusCircle.style.top = `${pixel.y}px`;
    elements.radiusCircle.style.width = `${radiusPx * 2}px`;
    elements.radiusCircle.style.height = `${radiusPx * 2}px`;
    elements.pin.style.left = `${pixel.x}px`;
    elements.pin.style.top = `${pixel.y}px`;
    setReferenceOverlayVisible(elements, true);
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

function closeToolbarMenus() {
    const settingsMenu = document.getElementById("settings-menu");
    const docsMenu = document.getElementById("docs-menu");
    if (settingsMenu) settingsMenu.classList.remove("show");
    if (docsMenu) docsMenu.classList.remove("show");
}

function toggleDocsMenu() {
    const menu = document.getElementById("docs-menu");
    const settingsMenu = document.getElementById("settings-menu");
    if (!menu) return;
    if (settingsMenu) settingsMenu.classList.remove("show");
    menu.classList.toggle("show");
}

function toggleSettings() {
    const menu = document.getElementById("settings-menu");
    const docsMenu = document.getElementById("docs-menu");
    if (!menu) return;
    if (docsMenu) docsMenu.classList.remove("show");
    menu.classList.toggle("show");
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

    resizeVisibleMapsSoon();
}

function toggleReferenceOnlyMode() {
    isReferenceOnlyMode = !isReferenceOnlyMode;
    localStorage.setItem(STORAGE_KEY_REFERENCE_ONLY_MODE, String(isReferenceOnlyMode));
    applySavedLayout();
    updateReferenceOnlyDisplay();

    resizeVisibleMapsSoon();
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
    resizeVisibleMapsSoon();
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
    geocodeAddress();
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
