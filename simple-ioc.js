let dependencies = [];
let loadedDependencies = {};

export function addDependencies(deps = []) {
    dependencies = [...deps, ...dependencies];
}

export async function inject(deps = {}, customResolver, useCdn = typeof window !== "undefined") {
    if (customResolver === true) {
        useCdn = true;
        customResolver = undefined;
    }
    if (useCdn === true) return injectCDN(deps, customResolver);

    for (const {specifier, resolver, exports} of dependencies) {
        let library;
        if (deps[specifier]) {
            library = deps[specifier];
            // Override dep resolution
            loadedDependencies[specifier] = library;

            if (exports) {
                if (typeof exports === "string") {
                    loadedDependencies[exports] = library;
                } else {
                    for (const exportAs of Object.values(exports)) {
                        loadedDependencies[exportAs] = library;
                    }
                }
            } else {
                loadedDependencies[specifier] = library;
            }
        } else if (!loadedDependencies[specifier]) {
            // Resolve dep.
            library = await (customResolver || resolver)(specifier);

            if (exports) {
                if (typeof exports === "string") {
                    loadedDependencies[exports] = library;
                } else {
                    for (const [libExport, exportAs] of Object.entries(exports)) {
                        loadedDependencies[exportAs] = library[libExport];
                    }
                }
            } else {
                loadedDependencies[specifier] = library;
            }
        }
    }
    return loadedDependencies;
}

export async function injectCDN(deps = {}, cdnFormatter = specifier => `https://esm.run/${specifier}`) {
    return inject(deps, specifier => import(cdnFormatter(specifier)), false);
}