import {serve, connect, load, injectDependencies} from "./lib/randomAccessOverMuxLoader.js";

export default async function inject(deps) {
    await injectDependencies(deps);
    return {
        serve, connect, load
    }
}