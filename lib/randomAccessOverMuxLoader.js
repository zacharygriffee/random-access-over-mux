import {
    connect as connectSingle,
    injectDependencies as injectForRAOM,
    serve as serveSingle
} from "./randomAccessOverMux.js";
import {addDependencies, inject} from "../simple-ioc.js";
import {setupStream} from "./setupStream.js";

let b4a, FramedStream, ProtomuxRPC, cenc, delegates;

function makeChannelKey(config) {
    return config.protocol + "###" + (config.id ? b4a.toString(config.id) : "");
}

class RandomAccessOverMuxLoader {
    rpc;
    isServer;
    _stream;
    _loadedFiles;

    get loadedFiles() {
        return this._loadedFiles;
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

        const {
            MapClass = Map
        } = config;

        this._loadedFiles = new MapClass();
        this._stream = setupStream(streamOrMux);
        return setupChannel.call(this, config);
    }

    static load(streamOrMux, config = {}) {
        const {
            MapClass = Map
        } = config;

        const loader = connect(streamOrMux, config);
        const _fileLoader = new MapClass();
        return file => {
            const rasDeferer = {loader};
            const id = loader.fileHasher(file);
            const protocol = loader.protocolHandler(file);
            const key = makeChannelKey({id, protocol});
            if (_fileLoader.has(key))
                return _fileLoader.get(key);
            const doLoad = handleLoad.bind(rasDeferer)(file);
            _fileLoader.set(key, doLoad);
            return doLoad;
        }
    }

    unload(fileName, callback) {
        if (!fileName || typeof fileName === "function") {
            fileName = undefined;
            callback = fileName;
        }

        const start = this.isServer ? Promise.resolve() : this.opened;
        let p = undefined;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }


        start.then(
            async () => {
                let key;
                if (fileName) {
                    key = makeChannelKey({
                        id: this.fileHasher(fileName),
                        protocol: this.protocolHandler(fileName)
                    });
                }
                if (this.isServer) {
                    if (key) {
                        let ras = await this._loadedFiles.get(key)
                        ras ? ras.close(callback) : callback(null);
                    } else {
                        for await (const ras of this._loadedFiles.values()) {
                            ras.close(callback);
                        }
                    }
                } else {
                    if (!fileName) throw new Error("Must specify a filename to unload on client side.");
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

    load(fileName, callback, fromRpc = false) {
        const start = this.isServer ? Promise.resolve() : this.opened;
        let p;
        if (!callback) {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        } else {
            const _callback = callback;
            p = new Promise((resolve, reject) => {
                callback = (err, ras) => {
                    _callback(err, ras);
                    err ? reject(err) : resolve(ras);
                }
            });
        }

        let ras;

        const config = {
            id: this.fileHasher(fileName),
            protocol: this.protocolHandler(fileName)
        };

        const key = makeChannelKey(config);
        if (this._loadedFiles.has(key)) {
            try {
                this._loadedFiles.get(key).then(
                    (good, bad) => callback(bad, good)
                )
            } catch (e) {
                callback(e);
            }

            return p;
        }

        const request = start.then(async () => {
            try {
                if (this.isServer) {
                    if (fromRpc) {
                        // An asyncronous connection.
                        return new Promise((resolve) =>
                            this.mux.pair(config, resolve)).then(
                            () => {
                                this.mux.unpair(config);
                                return serveIt.bind(this)();
                            }
                        );
                    } else {
                        return serveIt.bind(this)();
                    }

                    function serveIt() {
                        ras = serveSingle(this.mux, this._rasFactory.bind(this, fileName), config);
                        ras.loader = this;
                        ras.fileHash = config.id;
                        callback(null, ras);
                        ras.closed.then(() => {
                            this._loadedFiles.delete(key);
                        });
                        return ras;
                    }
                } else {
                    return this.rpc.request("load", fileName, {
                        requestEncoding: cenc.utf8,
                        responseEncoding: cenc.bool
                    }).then(
                        async o => {
                            if (!o) return callback(new Error("Failed to load file."));
                            ras = connectSingle(this.mux, config);
                            ras.loader = this;
                            ras.fileHash = config.id;
                            ras.closed.then(() => {
                                this._loadedFiles.delete(key);
                            });
                            callback(null, ras);
                            return ras;
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

        this._loadedFiles.set(key, request);

        return p;
    }
}

function setupChannel(config = {}) {
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
    }, async (fileName) => this.load(fileName, undefined, true) && true);

    this.rpc.respond("unload", {
        requestEncoding: cenc.utf8,
        responseEncoding: cenc.bool
    }, async (fileName) => this.unload(fileName) && true);
}

function handleLoad(file) {
    let setOpened;

    const fileOpened = new Promise((r) => {
        setOpened = r;
    });

    if (this.open) {
        return this
    }

    this.open = function (callback) {
        const self = this;
        let p = undefined;
        if (typeof callback !== "function") {
            p = new Promise(
                (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
            )
        }

        // Wait for dependant to be loaded.
        this.loader.load(file)
            .then(
                ras => {
                    self.ras = ras;

                    delegates(self, "ras")
                        .method("open")
                        .method("close")
                        .method("read")
                        .method("write")
                        .method("truncate")
                        .method("stat")
                        .method("unlink")

                    setOpened(ras);

                    // this ensures the 'delegated ras' open function is called.
                    ras.open(callback)
                }
            )
            .catch(
                e => callback(e)
            )

        return p;
    }

    for (const methodName of ["close", "write", "read", "truncate", "stat", "unlink"]) {
        // defer any acts until ras is available.
        this[methodName] = async function (...args) {
            let callback = args[args.length - 1];
            let p = undefined;
            if (typeof callback !== "function") {
                p = new Promise(
                    (resolve, reject) => callback = (e, v) => e ? reject(e) : resolve(v)
                )
                args.push(callback);
            }

            fileOpened.then(
                () => this[methodName](...args)
            );

            return p;
        }
    }

    this.open();
    return this;
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
    },
    {
        specifier: "delegates",
        resolver: () => import("delegates"),
        exports: {
            default: "delegates"
        }
    }
]);

export async function injectDependencies(deps, customResolver) {
    await injectForRAOM(deps);
    ({b4a, FramedStream, ProtomuxRPC, cenc, delegates} = await inject(deps, customResolver));
}

export const serve = RandomAccessOverMuxLoader.serve;
export const connect = RandomAccessOverMuxLoader.connect;
export const load = RandomAccessOverMuxLoader.load;