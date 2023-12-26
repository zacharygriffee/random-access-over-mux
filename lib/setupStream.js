import {addDependencies, inject} from "../simple-ioc.js";
import {injectDependencies as injectDependenciesForMessages} from "./messages.js";

let FramedStream;

export function setupStream(stream, {bits = 32, noFrame = false} = {}) {
    if (stream.mux) return stream.mux;
    if (stream.isProtomux) return stream;
    return !noFrame && FramedStream ? new FramedStream(stream, {bits}) : stream;
}

addDependencies([
    {
        specifier: "framed-stream",
        resolver: () => import("framed-stream"),
        exports: {
            default: "FramedStream"
        }
    }
]);

export async function injectDependencies(deps, customResolver) {
    await injectDependenciesForMessages(deps);
    ({FramedStream} = await inject(deps, customResolver));
}
