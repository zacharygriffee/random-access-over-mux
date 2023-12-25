import {
    capabilityEncoding,
    injectDependencies as injectDependenciesForMessages,
    offsetBufferEncoding,
    offsetSizeEncoding,
    statEncoding
} from "./messages.js";
import {addDependencies, inject} from "../simple-ioc.js";

const symbol = Symbol.for["random access over mux"];
let b4a, FramedStream, ProtomuxRPC, cenc;

export class RandomAccessOverMux {
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

        this._stream = setupStream(streamOrMux, config);
        this.ras = rasFactory(streamOrMux, config);
        this.isServer = true;
        return setupChannel.call(this, config);
    }

    static connect(streamOrMux, config = {}) {
        if (!(this instanceof RandomAccessOverMux)) {
            return RandomAccessOverMux.connect.call(new RandomAccessOverMux(), streamOrMux, config);
        }

        this._stream = setupStream(streamOrMux, config);
        this.isServer = false;
        return setupChannel.call(this, config);
    }

    open(callback = noop) {
        return this.opened.then(
            () =>
                this.isServer
                ?
                new Promise((resolve, reject) =>
                    this.ras.open(
                        handleCallback(resolve, reject)
                    ))
                :
                new Promise(
                    async (resolve, reject) => {
                        await this.rpc.request("open", undefined, {
                            requestEncoding: cenc.none,
                            responseEncoding: cenc.none
                        })
                            .catch(e => {
                                // ENOENT needs to have the right code.
                                if (e.message.includes("ENOENT")) {
                                    e.code = "ENOENT"
                                }
                                reject(e);
                            })
                            .then(() => resolve());
                    }
                )
        ).then(() => {
            callback();
        }).catch(callback);
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
                            responseEncoding: cenc.buffer
                        }).then((buff) => callback(null, b4a.from(buff || b4a.alloc(0)))).catch(callback.bind(this));
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
                            requestEncoding: offsetBufferEncoding,
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
                        }).then(o => {
                            return callback.bind(this, null)(o);
                        }).catch(e => callback(e));
                    }
                } else {
                    callback(new Error("Not statable"));
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

    unlink(callback) {
        const start = this.isServer ? Promise.resolve() : this.open();
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }
        start.then(
            () => {
                if (this.isServer) {
                    this.ras.unlink(callback.bind(this));
                } else {
                    if (!this.rpc.closed)
                        this.rpc.event("unlink");
                    callback();
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

function setupStream(stream, {bits = 32, noFrame = false}) {
    if (stream[symbol]) return stream.mux;
    if (stream.isProtomux) return stream;
    return !noFrame && FramedStream ? new FramedStream(stream, {bits}) : stream;
}

function setupServer() {
    this.rpc.respond("open", {
            requestEncoding: cenc.none,
            responseEncoding: cenc.none
        },
        () => new Promise((resolve, reject) => this.open(handleCallback(resolve, reject)))
    );

    if (this.capability.readable) {
        this.rpc.respond("read", {
                requestEncoding: offsetSizeEncoding, // offset and size
                responseEncoding: cenc.buffer
            },
            ({
                 offset,
                 size
             }) => new Promise((resolve, reject) => this.read(offset, size, handleCallback(resolve, reject)))
        );
    }

    if (this.capability.writable) {
        this.rpc.respond("write", {
                requestEncoding: offsetBufferEncoding, // offset and write buffer
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

    this.rpc.respond("unlink", {
            requestEncoding: cenc.none,
            responseEncoding: cenc.none
        },
        () => new Promise((resolve, reject) => this.unlink(handleCallback(resolve, reject))));

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
        _stream
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
    this.rpc = new ProtomuxRPC(_stream, {
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

    return this;
}

export const serve = RandomAccessOverMux.serve;

export const connect = RandomAccessOverMux.connect;

function handleCallback(resolve, reject) {
    return (err, value) => err ? reject(err) : resolve(value)
}

addDependencies([
    {
        specifier: "compact-encoding",
        resolver: () => import("compact-encoding"),
        exports: {
            default: "cenc"
        }
    },
    {
        specifier: "protomux-rpc",
        resolver: () => import("protomux-rpc"),
        exports: {
            default: "ProtomuxRPC"
        }
    },
    {
        specifier: "framed-stream",
        resolver: () => import("framed-stream"),
        exports: {
            default: "FramedStream"
        }
    },
    {
        specifier: "b4a",
        resolver: () => import("b4a"),
        exports: {
            default: "b4a"
        }
    }
]);

export async function injectDependencies(deps, customResolver) {
    await injectDependenciesForMessages(deps);
    ({b4a, FramedStream, ProtomuxRPC, cenc} = await inject(deps, customResolver));
}

function noop() {return null;}