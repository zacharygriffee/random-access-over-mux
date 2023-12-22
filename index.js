import cenc from "compact-encoding";
import ProtomuxRPC from "protomux-rpc";
import FramedStream from "framed-stream";

import {
    capabilityEncoding,
    offsetBinaryEncoding,
    offsetSizeEncoding,
    statEncoding
} from "./lib/messages.js";

const symbol = Symbol.for["random access over mux"];

class RandomAccessOverMux {
    ras;
    rpc;
    capability;
    isServer;
    _stream;

    get mux() {
        return this.rpc.mux;
    }

    get [symbol]() {
        return true;
    }

    static serve(streamOrMux, rasFactory, config = {}) {
        if (!(this instanceof RandomAccessOverMux)) {
            return RandomAccessOverMux.serve.call(new RandomAccessOverMux(), streamOrMux, rasFactory, config);
        }
        const {
            noFrame = false,
            bits
        } = config;

        if (streamOrMux[symbol]) {
            streamOrMux = streamOrMux.mux;
        }

        this._stream = streamOrMux.isProtomux || noFrame ? streamOrMux : new FramedStream(streamOrMux, {bits});
        this.ras = rasFactory(streamOrMux, config);
        this.isServer = true;
        return setupChannel.call(this, config);
    }

    static connect(streamOrMux, config = {}) {
        if (!(this instanceof RandomAccessOverMux)) {
            return RandomAccessOverMux.connect.call(new RandomAccessOverMux(), streamOrMux, config);
        }
        const {
            noFrame = false,
            bits
        } = config;

        if (streamOrMux[symbol]) {
            streamOrMux = streamOrMux.mux;
        }

        this._stream = streamOrMux.isProtomux || noFrame ? streamOrMux : new FramedStream(streamOrMux, {bits});
        this.isServer = false;
        return setupChannel.call(this, config);
    }

    open(cb = () => Promise.resolve()) {
        return this.opened.then(cb);
    }

    read(offset, size, callback) {
        const start = this.isServer ? Promise.resolve() : this.open();
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }

        start.then(
            () => {
                if (this.capability.readable) {
                    if (this.isServer) {
                        this.ras.read(offset, size, callback);
                    } else {
                        this.rpc.request("read", {
                            offset: offset, size: size
                        }, {
                            requestEncoding: offsetSizeEncoding,
                            responseEncoding: cenc.binary
                        }).then(callback.bind(this, null)).catch(callback);
                    }
                } else {
                    callback(new Error("Not readable"));
                }
            }
        );

        return p;
    }

    write(offset, buffer, callback) {
        const start = this.isServer ? Promise.resolve() : this.open();
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }
        start.then(
            () => {
                if (this.capability.writable) {
                    if (this.isServer) {
                        this.ras.write(offset, buffer, callback);
                    } else {
                        this.rpc.request("write", {
                            offset, buffer
                        }, {
                            requestEncoding: offsetBinaryEncoding,
                            responseEncoding: cenc.none
                        }).then(callback.bind(this, null)).catch(callback);
                    }
                } else {
                    callback(new Error("Not writable"));
                }
            }
        );
        return p;
    }

    del(offset, size, callback) {
        const start = this.isServer ? Promise.resolve() : this.open();
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }
        start.then(
            () => {
                if (this.capability.deletable) {
                    if (this.isServer) {
                        this.ras.del(offset, size, callback);
                    } else {
                        this.rpc.request("del", {
                            offset, size
                        }, {
                            requestEncoding: offsetSizeEncoding,
                            responseEncoding: cenc.none
                        }).then(callback.bind(this, null)).catch(callback)
                    }
                } else {
                    callback(new Error("Not deletable"));
                }
            }
        );
        return p;
    }

    stat(callback) {
        const start = this.isServer ? Promise.resolve() : this.open();
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }
        start.then(
            () => {
                if (this.capability.statable) {
                    if (this.isServer) {
                        this.ras.stat(callback);
                    } else {
                        this.rpc.request("stat", undefined, {
                            requestEncoding: cenc.none,
                            responseEncoding: statEncoding
                        }).then(callback.bind(this, null)).catch(callback);
                    }
                } else {
                    callback(new Error("Not stateable"));
                    throw new Error("Not statable");
                }
            }
        );
        return p;
    }

    truncate(offset, callback) {
        const start = this.isServer ? Promise.resolve() : this.open();
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }
        start.then(
            () => {
                if (this.capability.truncatable) {
                    if (this.isServer) {
                        this.ras.truncate(offset, callback);
                    } else {
                        this.rpc.request("truncate", offset, {
                            requestEncoding: cenc.uint64,
                            responseEncoding: cenc.none
                        }).then(callback.bind(this, null)).catch(callback);
                    }
                } else {
                    callback(new Error("Not truncatable"));
                }
            }
        );
        return p;
    }

    close(callback) {
        const self = this;

        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }

        if (this.isServer) {
            this.ras.close(async () => {
                return _close(null);
            });

        } else {
            this.rpc.request("close", undefined, {
                requestEncoding: cenc.none,
                responseEncoding: cenc.none
            }).then(_close).catch(_close);
        }

        return p;

        async function _close(e) {
            callback(e);
            if (e instanceof Error) self.rpc.destroy(e);
            else await self.rpc.end();
        }
    }
}

function setupServer() {
    if (this.capability.readable) {
        this.rpc.respond("read", {
                requestEncoding: offsetSizeEncoding, // offset and size
                responseEncoding: cenc.binary
            },
            ({
                 offset,
                 size
             }) => new Promise((resolve, reject) => this.read(offset, size, handleCallback(resolve, reject)))
        );
    }

    if (this.capability.writable) {
        this.rpc.respond("write", {
                requestEncoding: offsetBinaryEncoding, // offset and write buffer
                responseEncoding: cenc.none
            },
            ({
                 offset,
                 buffer
             }) => new Promise((resolve, reject) => this.write(offset, buffer, handleCallback(resolve, reject))));
    }

    if (this.capability.deletable) {
        this.rpc.respond("del", {
                requestEncoding: offsetSizeEncoding,
                responseEncoding: cenc.none
            },
            ({
                 offset,
                 size
             }) => new Promise((resolve, reject) => this.del(offset, size, handleCallback(resolve, reject))));
    }

    if (this.capability.truncatable) {
        this.rpc.respond("truncate", {
                requestEncoding: cenc.uint64, // truncation size
                responseEncoding: cenc.none // Whether deletion was successful
            },
            (offset) => new Promise((resolve, reject) => this.truncate(offset, handleCallback(resolve, reject))));
    }

    if (this.capability.statable) {
        this.rpc.respond("stat", {
                requestEncoding: cenc.none,
                responseEncoding: statEncoding
            },
            () => new Promise((resolve, reject) => this.stat(handleCallback(resolve, reject))));
    }

    this.rpc.respond("close", {
            requestEncoding: cenc.none,
            responseEncoding: cenc.none
        },
        () => new Promise((resolve, reject) => this.close(handleCallback(resolve, reject))));

    return this;
}

function setupChannel(config = {}) {
    let handshake;
    const {
        protocol = "randomAccessChannel",
        id,
        timeout = 8000
    } = config;

    const {
        isServer,
        stream
    } = this;

    if (isServer) {
        const {
            readable,
            writable,
            deletable,
            truncatable,
            statable,
        } = this.ras;

        this.capability = {readable, writable, deletable, truncatable, statable};
        handshake = cenc.encode(capabilityEncoding, this.capability);
    } else {
        handshake = cenc.encode(capabilityEncoding, 0);
    }
    // todo
    this._timeout = timeout;
    this.rpc = new ProtomuxRPC(stream, {
        protocol,
        id,
        // temporary handling of encoding due to protomux-rpc bug
        // https://github.com/holepunchto/protomux-rpc/issues/7
        handshakeEncoding: cenc.binary,
        handshake
    });

    if (isServer) setupServer.call(this);

    this.opened = new Promise(resolve => {
        this.rpc.once("open", (hs) => {
            this.capability ||= cenc.decode(capabilityEncoding, hs);
            resolve(this);
        });
    });

    this.closed = new Promise(resolve => {
        this.rpc.once("close", resolve);
    });

    if (isServer) return Promise.resolve(this);
    return this.open().then(() => this);
}

export const serve = RandomAccessOverMux.serve;
export const connect = RandomAccessOverMux.connect;

export default {serve, connect};

function handleCallback(resolve, reject) {
    return (err, value) => err ? reject(err) : resolve(value)
}