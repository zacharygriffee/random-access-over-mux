import {
    connect,
    serve,
    injectDependencies
} from "./lib/randomAccessOverMuxLoader.js";

await injectDependencies();

export {serve, connect};
export default {serve, connect};