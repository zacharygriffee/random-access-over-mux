import {connect, serve, injectDependencies} from "./lib/randomAccessOverMux.js";

await injectDependencies();

export {serve, connect};
export default {serve, connect};