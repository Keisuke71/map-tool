const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const address = '徳島県徳島市方上町下中山';
const settle = () => new Promise(resolve => setImmediate(resolve));

class Element {
    constructor(id = '') {
        this.id = id;
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.value = '';
        this.textContent = '';
        this.hidden = false;
        this.style = {};
        this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    dispatch(type, values = {}) {
        const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
        for (const listener of this.listeners[type] || []) listener(event);
        return event;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    get childElementCount() { return this.children.length; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    scrollIntoView() {}
    focus() {}
}

function place(name = address, id = 'exact') {
    return {
        id, formattedAddress: name,
        location: { lat: () => 34, lng: () => 134 },
        viewport: { tag: id }, types: ['political', 'sublocality_level_2'],
        addressComponents: [
            { longText: '徳島県', shortText: '徳島県', types: ['administrative_area_level_1'] },
            { longText: '徳島市', shortText: '徳島市', types: ['locality'] },
            { longText: '下中山', shortText: '下中山', types: ['sublocality_level_2'] }
        ],
        attributions: [{ provider: 'Data provider', providerURI: 'https://example.com/' }]
    };
}

function fixture({ mode = 'text', places = true, ready = true } = {}) {
    const elements = new Map();
    const get = id => {
        if (!elements.has(id)) elements.set(id, new Element(id));
        return elements.get(id);
    };
    const radios = ['text', 'autocomplete'].map(value => Object.assign(new Element(), { value }));
    const storage = new Map([['mapToolPlacesSearchModeV1', mode]]);
    const timers = new Map();
    let timerId = 0;
    const calls = { text: [], predictions: [], details: [], pins: [], boundaries: [], radii: [], ref: [], geocodes: [] };
    const library = {
        Place: { async searchByText(request) { calls.text.push(request); return { places: [place()] }; } },
        AutocompleteSessionToken: class {},
        AutocompleteSuggestion: {
            async fetchAutocompleteSuggestions(request) {
                calls.predictions.push(request);
                return { suggestions: [prediction(place())] };
            }
        }
    };
    function prediction(selectedPlace) {
        return { placePrediction: {
            text: { toString: () => selectedPlace.formattedAddress },
            toPlace: () => ({ ...selectedPlace, async fetchFields(request) { calls.details.push(request); } })
        } };
    }
    const document = new Element('document');
    document.getElementById = get;
    document.querySelectorAll = () => radios;
    document.createElement = () => new Element();
    // Model the real panel's relationship to its list for outside-click tests.
    get('places-autocomplete-panel').appendChild(get('places-predictions'));
    const context = vm.createContext({
        window: {}, document,
        console: { error() {}, log() {} },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
        clearTimeout: id => timers.delete(id),
        URLSearchParams, alert() {},
        google: { maps: { importLibrary: async () => library } },
        calls
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), context);
    vm.runInContext(`
        geocoder = ${ready ? '{}' : 'null'};
        appendCalculationLog = () => {};
        ensureTownBoundaryDataForResult = async result => {
            calls.boundaries.push(result);
            return { available: false, reason: 'loader_unavailable' };
        };
        getSearchAreaAutoRadiusResult = (location, viewport) => ({
            center: location, bounds: viewport, selectedRadius: 100, distance: 80
        });
        setRadius = radius => calls.radii.push(radius);
        placeMarkerAndCircle = location => calls.pins.push(location);
        renderBoundsRect = () => {};
        focusMapsOnResult = () => {};
        setRefMapViewOverride = () => {};
        getRefMapZoom = () => 16;
        updateRefMap = query => calls.ref.push(query);
        updateTownBoundaryOverlay = () => {};
    `, context);
    if (places) vm.runInContext(fs.readFileSync(path.join(root, 'places-tool.js'), 'utf8'), context);
    const html = fs.readFileSync(path.join(root, places ? 'places-tool.html' : 'index.html'), 'utf8');
    for (const match of html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)) {
        vm.runInContext(match[1], context);
    }
    return {
        context, calls, library, get, radios, timers, document, prediction,
        run: code => vm.runInContext(code, context),
        search(query = address) {
            get('address-input').value = query;
            return vm.runInContext('requestGeocodeCandidates(document.getElementById("address-input").value, document.getElementById("address-input").value)', context);
        },
        flushTimers() {
            const callbacks = Array.from(timers.values());
            timers.clear();
            callbacks.forEach(callback => callback());
        }
    };
}

test('text search ranks the exact address, converts components and reuses radius/map processing', async () => {
    const f = fixture();
    f.library.Place.searchByText = async request => {
        f.calls.text.push(request);
        return { places: [place('徳島県徳島市方上町', 'broader'), place()] };
    };
    await f.search();
    assert.equal(f.calls.text[0].textQuery, address);
    assert.equal(f.calls.text[0].language, 'ja');
    assert.ok(f.calls.text[0].fields.includes('viewport'));
    assert.ok(!f.calls.text[0].fields.includes('*'));
    assert.equal(f.run('currentGeocodeCandidates[0].result.place_id'), 'exact');
    assert.equal(f.calls.boundaries[0].address_components[0].long_name, '徳島県');
    assert.equal(f.calls.boundaries[0].geometry.viewport.tag, 'exact');
    assert.deepEqual(f.calls.radii, [100]);
    assert.equal(f.calls.pins.length, 1);
    assert.deepEqual(f.calls.ref, ['place_id:exact']);
    assert.match(f.get('address-match-status-display').textContent, /住所一致: Places/);
    assert.equal(f.get('places-data-attributions').children[0].href, 'https://example.com/');
    f.run('selectRelativeGeocodeCandidate(1)');
    await settle();
    assert.match(f.get('address-match-status-display').textContent, /住所不一致: Places/);
    assert.equal(f.calls.ref.at(-1), 'place_id:broader');
});

test('autocomplete fetches details only on selection and preserves the original address for comparison', async () => {
    const f = fixture({ mode: 'autocomplete' });
    await f.search();
    assert.equal(f.calls.predictions.length, 1);
    assert.equal(f.calls.text.length, 0);
    assert.equal(f.calls.details.length, 0);
    assert.equal(f.calls.pins.length, 0);
    assert.equal(f.get('address-input').attributes['aria-expanded'], 'true');
    const event = f.get('address-input').dispatch('keydown', { key: 'Enter' });
    assert.equal(event.defaultPrevented, true);
    await settle();
    assert.equal(f.calls.details.length, 1);
    assert.equal(f.calls.pins.length, 1);
    assert.equal(f.run('currentGeocodeAddress'), address);
    assert.equal(f.get('places-autocomplete-panel').hidden, true);
});

test('autocomplete sessions are reused while typing and replaced after a selection', async () => {
    const f = fixture({ mode: 'autocomplete' });
    await f.search('徳島県徳島市方上町');
    await f.search();
    assert.equal(f.calls.predictions[0].sessionToken, f.calls.predictions[1].sessionToken);
    f.get('places-predictions').children[0].dispatch('click');
    await settle();
    await f.search();
    assert.notEqual(f.calls.predictions[1].sessionToken, f.calls.predictions[2].sessionToken);
});

test('the search button and Enter use the selected mode without duplicate calls', async () => {
    const f = fixture();
    f.get('address-input').value = address;
    f.get('search-btn').dispatch('click');
    await settle();
    assert.equal(f.calls.text.length, 1);
    f.get('address-input').dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.equal(f.calls.text.length, 2);
    f.radios[1].dispatch('change');
    f.get('search-btn').dispatch('click');
    await settle();
    f.get('address-input').dispatch('keydown', { key: 'Enter' });
    await settle();
    assert.equal(f.calls.predictions.length, 1);
    assert.equal(f.calls.details.length, 1);
});

test('shortened retries use Places and keep the full original address for comparison', async () => {
    const f = fixture();
    await f.search();
    f.get('retry-geocode-without-municipality-btn').dispatch('click');
    await settle();
    assert.equal(f.calls.text[1].textQuery, '方上町下中山');
    assert.equal(f.run('currentGeocodeAddress'), address);
    assert.match(f.get('address-match-status-display').textContent, /住所一致/);
});

test('old text results cannot replace a newer search result', async () => {
    const f = fixture();
    const pending = [];
    f.library.Place.searchByText = request => new Promise(resolve => pending.push({ request, resolve }));
    const first = f.search('旧住所');
    await settle();
    const second = f.search(address);
    await settle();
    pending[1].resolve({ places: [place()] });
    await second;
    pending[0].resolve({ places: [place('旧住所', 'old')] });
    await first;
    assert.equal(f.run('currentGeocodeAddress'), address);
    assert.deepEqual(f.calls.ref, ['place_id:exact']);
});

test('editing the address invalidates pending text and boundary operations', async () => {
    const f = fixture();
    let finishBoundary;
    f.context.finishBoundaryPromise = new Promise(resolve => { finishBoundary = resolve; });
    f.run('ensureTownBoundaryDataForResult = () => finishBoundaryPromise');
    const search = f.search();
    await settle();
    f.get('address-input').value = '別の住所';
    f.get('address-input').dispatch('input');
    finishBoundary({ available: false, reason: 'loader_unavailable' });
    await search;
    assert.equal(f.calls.pins.length, 0);
});

test('mode switching invalidates an in-flight search', async () => {
    const f = fixture();
    let finish;
    f.library.Place.searchByText = () => new Promise(resolve => { finish = resolve; });
    const search = f.search();
    await settle();
    f.radios[1].dispatch('change');
    finish({ places: [place()] });
    await search;
    assert.equal(f.calls.pins.length, 0);
    assert.equal(f.get('search-btn').textContent, '候補を表示');
});

test('Escape/blur invalidate pending autocomplete responses', async () => {
    for (const type of ['keydown', 'blur']) {
        const f = fixture({ mode: 'autocomplete' });
        let finish;
        f.library.AutocompleteSuggestion.fetchAutocompleteSuggestions = () => new Promise(resolve => { finish = resolve; });
        const search = f.search();
        await settle();
        f.get('address-input').dispatch(type, { key: 'Escape' });
        finish({ suggestions: [f.prediction(place())] });
        await search;
        assert.equal(f.get('places-autocomplete-panel').hidden, true);
        assert.equal(f.get('places-predictions').children.length, 0);
    }
});

test('debounce and IME composition avoid premature prediction requests', async () => {
    const f = fixture({ mode: 'autocomplete' });
    const input = f.get('address-input');
    input.value = address;
    input.dispatch('compositionstart');
    input.dispatch('input');
    assert.equal(f.timers.size, 0);
    assert.equal(input.dispatch('keydown', { key: 'Enter' }).defaultPrevented, true);
    input.dispatch('compositionend');
    input.dispatch('input');
    assert.equal(f.timers.size, 1);
    f.flushTimers();
    await settle();
    assert.equal(f.calls.predictions.length, 1);
});

test('blurring after selecting a prediction does not cancel its details request', async () => {
    const f = fixture({ mode: 'autocomplete' });
    let finish;
    const selected = place();
    f.library.AutocompleteSuggestion.fetchAutocompleteSuggestions = async () => ({ suggestions: [{ placePrediction: {
        text: address,
        toPlace: () => ({ ...selected, fetchFields: () => new Promise(resolve => { finish = resolve; }) })
    } }] });
    await f.search();
    f.get('address-input').dispatch('keydown', { key: 'Enter' });
    f.get('address-input').dispatch('blur');
    finish();
    await settle();
    assert.equal(f.calls.pins.length, 1);
});

test('zero results and API rejection are displayed without a stale candidate', async () => {
    const f = fixture();
    await f.search();
    f.library.Place.searchByText = async () => ({ places: [] });
    await f.search();
    assert.equal(f.run('currentGeocodeCandidates.length'), 0);
    assert.match(f.get('address-match-status-display').textContent, /見つかりませんでした/);
    f.library.Place.searchByText = async () => { throw new Error('REQUEST_DENIED'); };
    await f.search();
    assert.equal(f.get('places-search-error').hidden, false);
    assert.match(f.get('places-search-error').textContent, /Places API（新版）/);
    assert.equal(f.run('currentGeocodeCandidates.length'), 0);
});

test('list processing delegates to Places and queued searches wait for map initialization', async () => {
    const f = fixture({ ready: false });
    f.run(`setAddressToMainInput(${JSON.stringify(address)})`);
    assert.equal(f.run('pendingGeocodeAddress'), address);
    assert.equal(f.calls.text.length, 0);
    f.run('geocoder = {}; geocodeAddress()');
    await settle();
    assert.equal(f.calls.text[0].textQuery, address);
    assert.equal(f.calls.pins.length, 1);
});

test('the original page still uses Geocoding with its existing query and labels', async () => {
    const f = fixture({ places: false });
    f.context.mockResult = {
        formatted_address: address, types: [],
        geometry: { location: place().location, viewport: place().viewport }
    };
    f.run(`geocoder = { geocode(request, callback) {
        calls.geocodes.push(request);
        callback([mockResult], 'OK');
    }}; QuotaManager.increment = () => {}`);
    await f.search();
    await settle();
    assert.equal(f.calls.geocodes[0].address, address);
    assert.equal(f.calls.text.length, 0);
    assert.match(f.get('address-match-status-display').textContent, /住所一致: Google マップ/);
    assert.equal(f.calls.pins.length, 1);
});
