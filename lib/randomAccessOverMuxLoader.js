import {
    serve as serveSingle,
    connect as connectSingle,
    injectDependencies as injectForRAOM
} from "./randomAccessOverMux.js";
import {addDependencies, inject} from "../simple-ioc.js";
import {setupStream} from "./setupStream.js";

let b4a, FramedStream, ProtomuxRPC, cenc;

class RandomAccessOverMuxLoader {
    rpc;
    isServer;
    _stream;
    _loadedFiles;

    get loadedFiles() {
        if (this.isServer) {
            return this._loadedFiles;
        } else {
            throw new Error("Only available on server for now.")
        }
    }

    get mux() {
        return this.rpc.mux;
    }

    static serve(streamOrMux, rasFactory, config = {}) {
        if (!(this instanceof RandomAccessOverMuxLoader)) {
            return RandomAccessOverMuxLoader.serve.call(new RandomAccessOverMuxLoader(), streamOrMux, rasFactory, config);
        }

        const {
            MapClass = Map
        } = config;

        this._loadedFiles = new MapClass();
        this._stream = setupStream(streamOrMux, config);
        this.isServer = true;
        this._rasFactory = rasFactory;

        return setupChannel.call(this, config);
    }

    static connect(streamOrMux, config = {}) {
        if (!(this instanceof RandomAccessOverMuxLoader)) {
            return RandomAccessOverMuxLoader.connect.call(new RandomAccessOverMuxLoader(), streamOrMux, config);
        }

        this._stream = setupStream(streamOrMux);
        return setupChannel.call(this, config);
    }

    unload(fileName, callback) {
        const start = this.isServer ? Promise.resolve() : this.opened;
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }

        start.then(
            async () => {
                if (this.isServer) {
                    let ras = this._loadedFiles.get(fileName)
                    ras ? ras.close(callback) : callback(null);
                } else {
                    this.rpc.request("unload", fileName, {
                        requestEncoding: cenc.utf8,
                        responseEncoding: cenc.bool
                    })
                        .then(() => callback(null, true))
                        .catch(e => callback(e))
                }
            }
        );

        return p;
    }

    load(fileName, callback) {
        const start = this.isServer ? Promise.resolve() : this.opened;
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }

        const config = {
            id: this.fileHasher(fileName),
            protocol: this.protocolHandler(fileName)
        };

        let ras;
        start.then(async () => {
            try {
                if (this.isServer) {
                    if (this._loadedFiles.has(fileName)) {
                        return callback(null, this._loadedFiles.get(fileName));
                    }
                    // An asyncronous connection.
                    this.mux.pair(config, () => {
                        ras = serveSingle(this.mux, this._rasFactory.bind(this, fileName), config);
                        ras.loader = this;
                        ras.fileHash = config.id;
                        callback(null, ras);
                        this._loadedFiles.set(fileName, ras);
                        ras.closed.then(() => {
                            this._loadedFiles.delete(fileName);
                        });
                    });
                } else {
                    this.rpc.request("load", fileName, {
                        requestEncoding: cenc.utf8,
                        responseEncoding: cenc.bool
                    }).then(
                        async o => {
                            if (!o)  return callback(new Error("Failed to load file."));
                            ras = connectSingle(this.mux, config);
                            ras.loader = this;
                            ras.fileHash = config.id;
                            callback(null, ras);
                        }
                    ).catch(
                        e => {
                            callback(e);
                        }
                    );
                }
            } catch (e) {
                callback(e, false);
            }
        });

        return p;
    }
}

function setupChannel(config = {})
{
    const {
        protocol = "randomAccessChannelLoader",
        id,
        fileHasher = (fileName) => b4a.from(fileName),
        protocolHandler = (fileName) => "randomAccessChannel",
        handshake,
        handshakeEncoding
    } = config;

    const {
        isServer,
        _stream
    } = this;

    this.fileHasher = fileHasher.bind(this);
    this.protocolHandler = protocolHandler.bind(this);

    this.rpc = new ProtomuxRPC(_stream, {
        id,
        protocol,
        handshake,
        handshakeEncoding
    });

    if (isServer) setupServer.call(this);

    this.opened = new Promise((resolve) => {
        this.rpc.once("open", () => {
            return resolve()
        });
    });

    this.closed = new Promise((resolve) => {
        this.rpc.once("close", resolve)
    });

    return this;
}

function setupServer() {
    this.rpc.respond("load", {
        requestEncoding: cenc.utf8,
        responseEncoding: cenc.bool
    }, async (fileName) => this.load(fileName) && true);

    this.rpc.respond("unload", {
        requestEncoding: cenc.utf8,
        responseEncoding: cenc.bool
    }, async (fileName) => this.unload(fileName) && true);
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
    await injectForRAOM(deps);
    ({b4a, FramedStream, ProtomuxRPC, cenc} = await inject(deps, customResolver));
}

export const serve = RandomAccessOverMuxLoader.serve;
export const connect = RandomAccessOverMuxLoader.connect;