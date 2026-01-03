/* =========================================
   APIキー管理と初期化処理
   ========================================= */
let apiKey = localStorage.getItem("googleMapsApiKey"); // 保存されたキーを読み込む
let map, marker, circle, boundsRect, geocoder;
let currentRadius = 300;

// ページ読み込み時に実行
document.addEventListener("DOMContentLoaded", () => {
    if (apiKey) {
        // キーがあれば地図APIを読み込む
        loadGoogleMapsScript(apiKey);
    } else {
        // キーがなければ入力画面を表示
        document.getElementById("api-key-modal").style.display = "flex";
    }
});

// 入力されたAPIキーを保存してリロード
function saveApiKey() {
    const inputKey = document.getElementById("api-key-input").value.trim();
    if (inputKey) {
        localStorage.setItem("googleMapsApiKey", inputKey);
        location.reload(); // 再読み込みして反映
    } else {
        alert("APIキーを入力してください");
    }
}

// APIキーを削除する（設定メニュー用）
function resetApiKey() {
    if(confirm("保存されたAPIキーを削除しますか？\n次回利用時に入力が求められます。")) {
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

    // 初回の参照用地図を表示（初期位置）
    updateRefMap("東京都千代田区富士見2丁目");

    // メニュー外クリックで閉じる処理
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
    document.querySelectorAll('.radius-btn').forEach(btn => btn.classList.remove('active'));
    const impBtn = document.getElementById('impossible-btn');
    if (impBtn) impBtn.classList.add('active');
    document.getElementById("output-text").value = "ジオ付与不可能（消防出動情報向けのメッセージです）";
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

// 右側の参照用マップを更新（保存されたapiKeyを使用）
function updateRefMap(query) {
    const frame = document.getElementById("ref-frame");
    // apiKey変数はローカルストレージから読み込まれているため、そのまま使えます
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