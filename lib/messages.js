import {makeCapabilityFlags, unmakeCapabilityFlags} from "./capability.js";
import {inject} from "../simple-ioc.js";

function main({cenc}) {
    capabilityEncoding = {
        preencode(state, flags = {}) {
            cenc.uint8.preencode(state, makeCapabilityFlags(flags));
        },
        encode(state, flags = {}) {
            cenc.uint8.encode(state, makeCapabilityFlags(flags));
        },
        decode(buff) {
            return unmakeCapabilityFlags(cenc.uint8.decode(buff));
        }
    };
    offsetSizeEncoding = {
        preencode(state, {offset, size}) {
            cenc.uint64.preencode(state, offset);
            cenc.uint64.preencode(state, size);
        },
        encode(state, {offset, size}) {
            cenc.uint64.encode(state, offset);
            cenc.uint64.encode(state, size);
        },
        decode(buff) {
            if (!buff || buff.byteLength === 0) return {};
            const offset = cenc.uint64.decode(buff);
            const size = cenc.uint64.decode(buff);
            return {
                offset,
                size
            };
        }
    };
    offsetBufferEncoding = {
        preencode(state, {offset, buffer}) {
            cenc.uint64.preencode(state, offset);
            cenc.buffer.preencode(state, buffer);
        },
        encode(state, {offset, buffer}) {
            cenc.uint64.encode(state, offset);
            cenc.buffer.encode(state, buffer);
        },
        decode(buff) {
            if (!buff || buff.byteLength === 0) return {};
            const offset = cenc.uint64.decode(buff);
            const buffer = cenc.buffer.decode(buff);
            return {
                offset, buffer
            }
        }
    };
    offsetEncoding = cenc.uint64;
    statEncoding = cenc.json;
}

export async function injectDependencies(deps = {}) {
    await inject(deps).then(main);
}

export let capabilityEncoding, offsetSizeEncoding, offsetBufferEncoding, offsetEncoding, statEncoding;
