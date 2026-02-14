/* =========================================
   APIキー管理と初期化処理
   ========================================= */
const STORAGE_KEY_API = "googleMapsApiKey";
const STORAGE_KEY_AUTO_RADIUS = "autoRadiusEnabled";

let apiKey = localStorage.getItem(STORAGE_KEY_API);
let isAutoRadiusEnabled = localStorage.getItem(STORAGE_KEY_AUTO_RADIUS) !== "false"; // デフォルトON

let map, marker, circle, boundsRect, geocoder;
let currentRadius = 300;

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
    QuotaManager.updateDisplay();
    updateAutoRadiusDisplay();

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
    if (container.classList.contains("layout-horizontal")) {
        container.classList.replace("layout-horizontal", "layout-vertical");
    } else {
        container.classList.replace("layout-vertical", "layout-horizontal");
    }
    setTimeout(() => { if (map) google.maps.event.trigger(map, "resize"); }, 100);
}

window.deleteApiKey = resetApiKey;