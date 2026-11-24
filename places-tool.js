/* Places API (New) adapter for the shared coordinate/map tools in script.js. */
(() => {
    "use strict";

    const MODE_STORAGE_KEY = "mapToolPlacesSearchModeV1";
    const PLACE_FIELDS = ["id", "formattedAddress", "location", "viewport", "addressComponents", "types", "attributions"];
    const input = document.getElementById("address-input");
    const panel = document.getElementById("places-autocomplete-panel");
    const list = document.getElementById("places-predictions");
    const errorDisplay = document.getElementById("places-search-error");
    const usage = { text: 0, autocomplete: 0, details: 0 };
    let mode = localStorage.getItem(MODE_STORAGE_KEY) === "autocomplete" ? "autocomplete" : "text";
    let libraryPromise = null;
    let debounceTimer = null;
    let sessionToken = null;
    let predictions = [];
    let predictionContext = null;
    let activePredictionIndex = -1;
    let isComposing = false;

    function updateUsage() {
        document.getElementById("places-usage-display").textContent =
            `このページの呼出回数: テキスト ${usage.text} / 入力候補 ${usage.autocomplete} / 詳細 ${usage.details}`;
    }

    function clearPredictions() {
        clearTimeout(debounceTimer);
        debounceTimer = null;
        predictions = [];
        predictionContext = null;
        activePredictionIndex = -1;
        list.replaceChildren();
        panel.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    }

    function dismissPredictions() {
        if (mode !== "autocomplete") return;
        // Invalidate a pending suggestion request, but not a selected place's details.
        if (predictionContext || debounceTimer) geocodeRequestToken += 1;
        pendingGeocodeAddress = "";
        clearPredictions();
        sessionToken = null;
    }

    function getLibrary() {
        if (!libraryPromise) {
            libraryPromise = google.maps.importLibrary("places").catch((error) => {
                libraryPromise = null;
                throw error;
            });
        }
        return libraryPromise;
    }

    function showError(error, requestToken) {
        if (requestToken !== geocodeRequestToken) return;
        console.error("Places search failed.", error);
        clearPredictions();
        sessionToken = null;
        resetGeocodeCandidates();
        errorDisplay.textContent = "Places検索に失敗しました。Google CloudでPlaces API（新版）の有効化、APIキーのAPI制限・ウェブサイト制限、請求先・割り当てを確認してください。設定方法は下のリンクから確認できます。";
        errorDisplay.hidden = false;
        setAddressMatchStatus("unavailable", "⚠️ 住所照合: Places検索に失敗しました");
        appendCalculationLog("Places検索失敗: API設定や通信状況を確認してください。", "warning");
    }

    function beginSearch(query, originalAddress, label) {
        const requestToken = ++geocodeRequestToken;
        clearPredictions();
        resetGeocodeCandidates();
        currentGeocodeAddress = originalAddress;
        currentGeocodeQuery = query;
        errorDisplay.hidden = true;
        document.getElementById("calculated-radius-display").textContent = "";
        setAddressMatchStatus("checking", `🔎 住所照合: ${label}中…`);
        appendCalculationLog(`${label}: ${query}`);
        return requestToken;
    }

    function toGeocodeResult(place) {
        if (!place || !place.location) return null;
        return {
            place_id: place.id,
            formatted_address: place.formattedAddress || "",
            types: place.types || [],
            address_components: (place.addressComponents || []).map((component) => ({
                long_name: component.longText || "",
                short_name: component.shortText || "",
                types: component.types || []
            })),
            geometry: { location: place.location, viewport: place.viewport },
            places_attributions: place.attributions || []
        };
    }

    function renderAttributions(result) {
        const container = document.getElementById("places-data-attributions");
        container.replaceChildren();
        for (const attribution of (result && result.places_attributions) || []) {
            const link = document.createElement("a");
            // Never insert API-provided HTML or arbitrary URL schemes into the page.
            if (/^https?:\/\//i.test(attribution.providerURI || "")) {
                link.href = attribution.providerURI;
                link.target = "_blank";
                link.rel = "noreferrer";
            }
            link.textContent = attribution.provider || attribution.providerURI || "";
            if (link.textContent) container.appendChild(link);
        }
        container.hidden = !container.childElementCount;
    }

    async function applyPlaces(places, query, originalAddress, requestToken) {
        if (requestToken !== geocodeRequestToken) return;
        currentGeocodeAddress = originalAddress;
        currentGeocodeQuery = query;
        currentGeocodeCandidates = rankGeocodeCandidates(originalAddress, places.map(toGeocodeResult).filter(Boolean));
        currentGeocodeCandidateIndex = currentGeocodeCandidates.length ? 0 : -1;
        updateGeocodeCandidateControls();
        appendCalculationLog(`Placesの住所候補: ${currentGeocodeCandidates.length}件（一致度順）`, "muted");
        currentGeocodeCandidates.forEach((entry, index) => {
            appendCalculationLog(`候補 ${index + 1}: ${stripGoogleAddressPrefix(entry.result.formatted_address)}`, "muted");
        });
        if (!currentGeocodeCandidates.length) {
            setAddressMatchStatus("unavailable", "⚠️ 住所照合: Placesで座標を持つ住所候補が見つかりませんでした");
            return;
        }
        // Reuse candidate switching, address checking, boundaries, radius and both maps.
        await applyGeocodeCandidate(0, requestToken);
    }

    function setActivePrediction(index) {
        activePredictionIndex = index;
        Array.from(list.children).forEach((item, itemIndex) => {
            item.setAttribute("aria-selected", String(itemIndex === index));
            if (itemIndex === index) {
                input.setAttribute("aria-activedescendant", item.id);
                item.scrollIntoView({ block: "nearest" });
            }
        });
    }

    async function selectPrediction(index, expectedToken) {
        if (!predictionContext || expectedToken !== geocodeRequestToken || !predictions[index]) return;
        const prediction = predictions[index];
        const { query, originalAddress } = predictionContext;
        const requestToken = beginSearch(query, originalAddress, "Placesの選択候補を取得");
        // toPlace carries the prediction's session token into the first fetchFields call.
        sessionToken = null;
        try {
            const place = prediction.toPlace();
            usage.details += 1;
            updateUsage();
            await place.fetchFields({ fields: PLACE_FIELDS });
            await applyPlaces([place], query, originalAddress, requestToken);
        } catch (error) {
            showError(error, requestToken);
        }
    }

    async function fetchPredictions(query, originalAddress, requestToken) {
        // Keep this context while awaiting the network so blur/Escape can cancel it.
        predictionContext = { query, originalAddress, requestToken };
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await getLibrary();
        if (requestToken !== geocodeRequestToken) return;
        if (!sessionToken) sessionToken = new AutocompleteSessionToken();
        usage.autocomplete += 1;
        updateUsage();
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            language: "ja",
            region: "jp",
            includedRegionCodes: ["jp"],
            sessionToken
        });
        if (requestToken !== geocodeRequestToken) return;
        predictions = (suggestions || []).map((item) => item.placePrediction).filter(Boolean);
        list.replaceChildren();
        predictions.forEach((prediction, index) => {
            const item = document.createElement("li");
            item.id = `places-prediction-${requestToken}-${index}`;
            item.setAttribute("role", "option");
            item.textContent = String(prediction.text || "");
            item.addEventListener("pointerdown", (event) => event.preventDefault());
            item.addEventListener("click", () => selectPrediction(index, requestToken));
            list.appendChild(item);
        });
        panel.hidden = !predictions.length;
        input.setAttribute("aria-expanded", String(Boolean(predictions.length)));
        if (predictions.length) {
            setActivePrediction(0);
            setAddressMatchStatus("checking", `🔎 Placesの入力候補: ${predictions.length}件。候補を選択してください`);
        } else {
            setAddressMatchStatus("unavailable", "⚠️ Placesの入力候補がありません。テキスト検索への切り替えや住所の調整をお試しください");
        }
    }

    async function search(query, searchedAddress, isRetry = false) {
        const normalizedQuery = normalizeAddressNumbers(query);
        const originalAddress = String(searchedAddress || normalizedQuery).trim();
        if (!normalizedQuery || !originalAddress) return;
        if (!geocoder) {
            pendingGeocodeAddress = originalAddress;
            setAddressMatchStatus("checking", "🔎 地図の読み込み後にPlacesで検索します…");
            return;
        }
        pendingGeocodeAddress = "";
        const label = mode === "autocomplete" ? "Placesの入力候補を検索" : "Placesのテキスト検索";
        const requestToken = beginSearch(normalizedQuery, originalAddress, label);
        if (isRetry) appendCalculationLog(`市区町村を除いて再検索（元住所: ${originalAddress}）`, "muted");
        try {
            if (mode === "autocomplete") {
                input.focus({ preventScroll: true });
                await fetchPredictions(normalizedQuery, originalAddress, requestToken);
            } else {
                sessionToken = null;
                const { Place } = await getLibrary();
                if (requestToken !== geocodeRequestToken) return;
                usage.text += 1;
                updateUsage();
                const { places } = await Place.searchByText({
                    textQuery: normalizedQuery,
                    fields: PLACE_FIELDS,
                    language: "ja",
                    region: "jp",
                    maxResultCount: 10
                });
                await applyPlaces(places || [], normalizedQuery, originalAddress, requestToken);
            }
        } catch (error) {
            showError(error, requestToken);
        }
    }

    function updateMode() {
        const isAutocomplete = mode === "autocomplete";
        document.querySelectorAll('input[name="places-search-mode"]').forEach((radio) => {
            radio.checked = radio.value === mode;
        });
        input.setAttribute("aria-autocomplete", isAutocomplete ? "list" : "none");
        document.getElementById("search-btn").textContent = isAutocomplete ? "候補を表示" : "テキスト検索";
        document.getElementById("places-search-help").textContent = isAutocomplete
            ? "住所を入力すると候補を表示します。クリック、または上下キーとEnterで選択してください。"
            : "住所を入力し「テキスト検索」を押してください。複数の結果は前候補・次候補で確認できます。";
    }

    window.coordinateSearchProvider = { label: "Places", search, onCandidateChanged: renderAttributions };

    document.querySelectorAll('input[name="places-search-mode"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            mode = radio.value;
            localStorage.setItem(MODE_STORAGE_KEY, mode);
            geocodeRequestToken += 1;
            pendingGeocodeAddress = "";
            clearPredictions();
            sessionToken = null;
            resetGeocodeCandidates();
            errorDisplay.hidden = true;
            updateMode();
            setAddressMatchStatus("idle", "住所照合: 検索方法を切り替えました。住所を検索してください");
        });
    });

    function onInput() {
        geocodeRequestToken += 1;
        pendingGeocodeAddress = "";
        clearPredictions();
        resetGeocodeCandidates();
        errorDisplay.hidden = true;
        if (!input.value.trim()) sessionToken = null;
        setAddressMatchStatus("idle", "住所照合: 入力中の住所を検索してください");
        if (mode !== "autocomplete" || isComposing || !input.value.trim()) return;
        const query = input.value.trim();
        debounceTimer = setTimeout(() => search(query, query), 300);
    }

    input.addEventListener("input", onInput);
    input.addEventListener("compositionstart", () => { isComposing = true; onInput(); });
    input.addEventListener("compositionend", () => { isComposing = false; onInput(); });
    input.addEventListener("blur", dismissPredictions);
    input.addEventListener("keydown", (event) => {
        if (event.isComposing || isComposing || event.keyCode === 229) {
            if (event.key === "Enter") event.preventDefault();
            return;
        }
        if (mode !== "autocomplete") return;
        if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") event.preventDefault();
            dismissPredictions();
        } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && predictions.length) {
            event.preventDefault();
            const offset = event.key === "ArrowDown" ? 1 : -1;
            setActivePrediction((activePredictionIndex + offset + predictions.length) % predictions.length);
        } else if (event.key === "Enter" && predictions.length && !panel.hidden) {
            event.preventDefault();
            selectPrediction(activePredictionIndex, geocodeRequestToken);
        }
    });

    document.addEventListener("pointerdown", (event) => {
        if (!panel.contains(event.target) && event.target !== input) dismissPredictions();
    });

    updateMode();
    updateUsage();
})();
