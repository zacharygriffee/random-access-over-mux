import {
    connect,
    serve,
    injectDependencies,
    load
} from "./lib/randomAccessOverMuxLoader.js";

await injectDependencies();

export {serve, connect, load};
export default {serve, connect, load};