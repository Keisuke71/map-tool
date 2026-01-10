/* =========================================
   APIキー管理と初期化処理
   ========================================= */
let apiKey = localStorage.getItem("googleMapsApiKey");
let map, marker, circle, boundsRect, geocoder;
let currentRadius = 300;

// ★設定: 回数制限の目安
const QUOTA_LIMITS = {
    DAILY: 300,      // 1日の目安
    MONTHLY: 10000   // 1ヶ月の目安
};

// ページ読み込み時に実行
document.addEventListener("DOMContentLoaded", () => {
    // 画面表示を初期化
    QuotaManager.updateDisplay();

    if (apiKey) {
        // キーがあれば地図APIを読み込む
        // ★ここで「地図表示」分のカウントを行う
        QuotaManager.increment();
        loadGoogleMapsScript(apiKey);
    } else {
        // キーがなければ入力画面を表示
        document.getElementById("api-key-modal").style.display = "flex";
    }
});

/* =========================================
   ★回数管理クラス (新規追加)
   ========================================= */
const QuotaManager = {
    storageKey: "googleMapsUsageStats",

    // データを取得・リセット判定
    getData: function () {
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10); // "2026-01-04"
        const monthStr = now.toISOString().slice(0, 7);  // "2026-01"

        let data = JSON.parse(localStorage.getItem(this.storageKey)) || {
            date: todayStr,
            month: monthStr,
            dailyCount: 0,
            monthlyCount: 0
        };

        // 日替わりリセット
        if (data.date !== todayStr) {
            data.date = todayStr;
            data.dailyCount = 0;
        }
        // 月替わりリセット
        if (data.month !== monthStr) {
            data.month = monthStr;
            data.monthlyCount = 0;
        }

        return data;
    },

    // カウントアップして保存
    increment: function () {
        const data = this.getData();
        data.dailyCount++;
        data.monthlyCount++;
        localStorage.setItem(this.storageKey, JSON.stringify(data));
        this.updateDisplay();
    },

    // 画面表示の更新
    updateDisplay: function () {
        const el = document.getElementById("quota-display");
        if (!el) return;

        const data = this.getData();
        const dailyLeft = QUOTA_LIMITS.DAILY - data.dailyCount;
        const monthlyLeft = QUOTA_LIMITS.MONTHLY - data.monthlyCount;

        // 0未満にならないように調整
        const dShow = dailyLeft < 0 ? 0 : dailyLeft;
        const mShow = monthlyLeft < 0 ? 0 : monthlyLeft;

        el.innerHTML = `
            本日残り: <b>${dShow}</b> / ${QUOTA_LIMITS.DAILY}<br>
            今月残り: <b>${mShow}</b> / ${QUOTA_LIMITS.MONTHLY}
        `;
    }
};

// 入力されたAPIキーを保存してリロード
function saveApiKey() {
    const inputKey = document.getElementById("api-key-input").value.trim();
    if (inputKey) {
        localStorage.setItem("googleMapsApiKey", inputKey);
        location.reload();
    } else {
        alert("APIキーを入力してください");
    }
}

// APIキーを削除する
function resetApiKey() {
    if (confirm("保存されたAPIキーを削除しますか？\n次回利用時に入力が求められます。")) {
        localStorage.removeItem("googleMapsApiKey");
        location.reload();
    }
}

// 動的にGoogle Maps APIを読み込む関数
function loadGoogleMapsScript(key) {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=initMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        alert("APIキーが間違っているか、制限されています。\n設定からキーを削除して再入力してください。");
    };
    document.head.appendChild(script);
}

/* =========================================
   Google Maps 初期化 (callback)
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
            fullscreenControl: false
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

    marker = new google.maps.Marker({ position: latLng, map: map, draggable: true });

    marker.addListener("dragend", (e) => {
        updateCirclePosition(e.latLng);
        generateOutput(e.latLng);
        
        // 右側の参照マップもその座標に更新する（無料）
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
    if (event && event.target) event.target.classList.add('active');

    const impBtn = document.getElementById('impossible-btn');
    if (impBtn) impBtn.classList.remove('active');

    if (circle) {
        circle.setRadius(radius);
        if (marker) generateOutput(marker.getPosition());
    }
}

function setImpossible() {
    // 1. ボタンの見た目をアクティブにする
    document.querySelectorAll('.radius-btn').forEach(btn => btn.classList.remove('active'));
    const impBtn = document.getElementById('impossible-btn');
    if (impBtn) impBtn.classList.add('active');

    // 2. コピーする文章
    const text = "ジオ付与不可能（消防出動情報向けのメッセージです）";

    // 3. 下の入力欄にも一応表示しておく（何がコピーされたか視覚的にわかるようにするため）
    document.getElementById("output-text").value = text;

    // 4. 即座にクリップボードにコピーする処理
    navigator.clipboard.writeText(text).then(() => {
        // 成功したらボタンの見た目を変えて合図する
        const originalText = impBtn.innerText; // 元の文字（"不可"）を記憶
        const originalBg = impBtn.style.backgroundColor;

        impBtn.innerText = "コピー完了!";
        impBtn.style.backgroundColor = "#27ae60"; // 緑色にする
        impBtn.style.border = "1px solid #fff";

        // 1秒後に元の見た目に戻す
        setTimeout(() => {
            impBtn.innerText = originalText;
            impBtn.style.backgroundColor = originalBg;
            impBtn.style.border = "";
        }, 1000);
    }).catch(err => {
        console.error('コピー失敗:', err);
        alert('コピーに失敗しました。ブラウザの権限を確認してください。');
    });
}

function resetImpossibleState() {
    const impBtn = document.getElementById('impossible-btn');
    if (impBtn && impBtn.classList.contains('active')) {
        impBtn.classList.remove('active');
        const radiusBtns = document.querySelectorAll('.radius-group button:not(#impossible-btn)');
        radiusBtns.forEach(btn => {
            let btnRadius = parseInt(btn.innerText);
            if (btn.innerText.includes("km")) btnRadius *= 1000;
            if (btnRadius === currentRadius) btn.classList.add('active');
        });
    }
}

function geocodeAddress() {
    const address = document.getElementById("address-input").value;
    if (!address || !geocoder) return;

    // ★ここで検索実行分のカウントを行う
    QuotaManager.increment();

    geocoder.geocode({ 'address': address }, (results, status) => {
        if (status === 'OK') {
            const result = results[0];
            map.setCenter(result.geometry.location);
            if (boundsRect) boundsRect.setMap(null);
            if (result.geometry.bounds) {
                map.fitBounds(result.geometry.bounds);
                boundsRect = new google.maps.Rectangle({
                    strokeColor: "#0000FF", strokeOpacity: 0.5, strokeWeight: 2,
                    fillOpacity: 0, map: map, bounds: result.geometry.bounds, clickable: false
                });
            } else {
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
        // queryが "lat,lng" の形式か、住所文字列かで出し分け可能ですが、
        // Embed APIは q=パラメータにそのまま入れて自動判別してくれます。
        
        // 正しいEmbed APIのURL形式
        const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${query}`;
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

function copyToClipboard() {
    const copyText = document.getElementById("output-text");
    copyText.select();
    navigator.clipboard.writeText(copyText.value).then(() => {
        const btn = document.getElementById('copy-btn');
        if (btn.dataset.timer) clearTimeout(btn.dataset.timer);

        btn.innerText = "完了!";
        btn.style.backgroundColor = "#28a745";

        const timerId = setTimeout(() => {
            btn.innerText = "コピー";
            btn.style.backgroundColor = "";
            delete btn.dataset.timer;
        }, 1000);
        btn.dataset.timer = timerId;
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