(function () {
    const datasetDefinitions = Array.isArray(window.TOWN_BOUNDARY_DATASET_DEFINITIONS)
        ? window.TOWN_BOUNDARY_DATASET_DEFINITIONS
        : [];
    const datasetCache = new Map();
    const pendingLoads = new Map();

    function normalizeLocationName(value) {
        return String(value || "").replace(/\s+/g, "").trim();
    }

    function normalizeAliases(values) {
        return Array.isArray(values)
            ? values.map(normalizeLocationName).filter(Boolean)
            : [];
    }

    function getAddressComponent(result, type) {
        const components = result && Array.isArray(result.address_components) ? result.address_components : [];
        const match = components.find((component) => Array.isArray(component.types) && component.types.includes(type));
        return match ? match.long_name : "";
    }

    function hasMatchingAlias(candidates, aliases) {
        return aliases.some((alias) => candidates.has(alias));
    }

    function resolveDatasetDefinition(result) {
        const prefecture = normalizeLocationName(getAddressComponent(result, "administrative_area_level_1"));
        const locality = normalizeLocationName(getAddressComponent(result, "locality"));
        const adminLevel2 = normalizeLocationName(getAddressComponent(result, "administrative_area_level_2"));
        const localityCandidates = new Set([locality, adminLevel2].filter(Boolean));

        return datasetDefinitions.find((definition) => {
            const definitionPrefecture = normalizeLocationName(definition.prefecture);
            if (!definitionPrefecture || definitionPrefecture !== prefecture) {
                return false;
            }

            const localityAliases = normalizeAliases(definition.localityAliases);
            const adminLevel2Aliases = normalizeAliases(definition.adminLevel2Aliases);

            if (!localityAliases.length && !adminLevel2Aliases.length) {
                return false;
            }

            return hasMatchingAlias(localityCandidates, localityAliases)
                || hasMatchingAlias(localityCandidates, adminLevel2Aliases);
        }) || null;
    }

    function loadDatasetScript(definition) {
        if (datasetCache.has(definition.key)) {
            return Promise.resolve(datasetCache.get(definition.key));
        }

        if (pendingLoads.has(definition.key)) {
            return pendingLoads.get(definition.key);
        }

        const promise = new Promise((resolve, reject) => {
            const existingData = window[definition.globalName];
            if (existingData) {
                datasetCache.set(definition.key, existingData);
                resolve(existingData);
                return;
            }

            const script = document.createElement("script");
            script.src = definition.scriptPath;
            script.async = true;
            script.defer = true;
            script.onload = () => {
                const data = window[definition.globalName];
                if (!data) {
                    reject(new Error(`Town boundary dataset did not register: ${definition.globalName}`));
                    return;
                }

                datasetCache.set(definition.key, data);
                resolve(data);
            };
            script.onerror = () => {
                reject(new Error(`Failed to load town boundary dataset: ${definition.scriptPath}`));
            };
            document.head.appendChild(script);
        }).finally(() => {
            pendingLoads.delete(definition.key);
        });

        pendingLoads.set(definition.key, promise);
        return promise;
    }

    window.TownBoundaryLoader = {
        listDatasets() {
            return datasetDefinitions.slice();
        },
        resolveDatasetDefinition,
        async ensureDatasetForResult(result) {
            const definition = resolveDatasetDefinition(result);
            if (!definition) {
                return { definition: null, data: null };
            }

            const data = await loadDatasetScript(definition);
            return { definition, data };
        }
    };
})();
