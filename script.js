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


let apiKey = localStorage.getItem(STORAGE_KEY_API);
let isAutoRadiusEnabled = localStorage.getItem(STORAGE_KEY_AUTO_RADIUS) !== "false"; // デフォルトON
let layoutMode = localStorage.getItem(STORAGE_KEY_LAYOUT) || "layout-horizontal";

let map, marker, circle, boundsRect, geocoder;
let currentRadius = 300;
let listData = [];
let addressColumnIndex = Number(localStorage.getItem(STORAGE_KEY_ADDRESS_COL)) || 0;
let outputColumnIndex = Number(localStorage.getItem(STORAGE_KEY_OUTPUT_COL)) || 4;
let currentListRowIndex = Number(localStorage.getItem(STORAGE_KEY_CURRENT_ROW));
if (!Number.isInteger(currentListRowIndex) || currentListRowIndex < 0) currentListRowIndex = -1;


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
    QuotaManager.updateDisplay();
    updateAutoRadiusDisplay();
    restoreListState();

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
        map = new google.maps.Map(mapElement, {
            zoom: 15,
            center: initialPos,
            mapTypeId: 'roadmap',
            streetViewControl: false,
            clickableIcons: false,
            fullscreenControl: false,
            mapTypeControl: true
        });

        map.addListener("click", (e) => {
            placeMarkerAndCircle(e.latLng);
        });
    }

    updateRefMap("東京都千代田区富士見2丁目");

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
            if (boundsRect) boundsRect.setMap(null);
            if (searchArea) {
                boundsRect = new google.maps.Rectangle({
                    strokeColor: "#0000FF",
                    strokeOpacity: 0.5,
                    strokeWeight: 2,
                    fillOpacity: 0,
                    map: map,
                    bounds: searchArea,
                    clickable: false,
                    zIndex: 1
                });

                map.fitBounds(searchArea);
                map.panTo(location);
            } else {
                map.setCenter(location);
                map.setZoom(16);
            }

            updateRefMap(address);

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

        const originalText = "コピー";
        // ボタンIDで色を分岐
        const originalBg = (btn.id === "header-copy-btn") ? "#e67e22" : "#e74c3c";

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

function setAddressToMainInput(address) {
    const input = document.getElementById("address-input");
    if (!input) return;
    input.value = address;
    if (geocoder) geocodeAddress();
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

    currentListRowIndex = nextIndex;
    const address = getCellValue(listData[nextIndex], addressColumnIndex);
    setAddressToMainInput(address);
    updateListStatus();
    persistListState();
    setListMessage(`行${nextIndex + 1}の住所をセットしました。`, "success");
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

function copyUpdatedTsv() {
    if (!listData.length) {
        setListMessage("コピーできる一覧データがありません。", "error");
        return;
    }

    const tsv = rowsToTsv(listData);
    navigator.clipboard.writeText(tsv).then(() => {
        setListMessage("更新済み一覧をコピーしました。", "success");
    }).catch((error) => {
        console.error("TSVコピー失敗", error);
        setListMessage("コピーに失敗しました。", "error");
    });
}
