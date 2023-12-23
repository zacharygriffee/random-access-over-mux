import {serve, connect, injectDependencies} from "./lib/randomAccessOverMux.js";

export default async function inject(deps) {
    await injectDependencies(deps);
    return {
        serve, connect
    }
}