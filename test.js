import {test, solo, skip} from "brittle";
import b4a from "b4a";
import cenc from "compact-encoding";
import duplexThrough from "duplex-through";
import RAM from "random-access-memory";
import RAF from "random-access-file";
import {Duplex} from "streamx";
import net from "node:net";
import Protomux from "protomux";
import ProtomuxRPC from "protomux-rpc";
import Hypercore from "hypercore";
import {connect, serve} from "./index.js";
import inject from "./index.ioc.js";
import FramedStream from "framed-stream";
import path, {dirname} from 'path';
import {fileURLToPath} from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));


test("Basic serve and connect", t => {
    t.plan(7);
    const [d1, d2] = duplexThrough();

    serve(d1, () => new RAM());

    const ras = connect(
        d2
    );

    // You could use the open cb ras has.
    // ras.open(() => {
    ras.write(0, b4a.from("hello world"), async (e) => {
        ras.truncate(5, (e) => {
            ras.read(0, 5, (e, buf) => {
                t.is(b4a.toString(buf), "hello");
            })
        });

        ras.stat((e, {size}) => {
            t.is(size, 5);
        });

        try {
            // Trying to read past eof async edition.
            await ras.read(0, 6)
            t.fail("Didn't catch.");
        } catch (e) {
            t.is(e.message, "REQUEST_ERROR: Could not satisfy length", "async read error handled by try...catch");
        }

        // Trying to read past eof callback edition.
        ras.read(0, 6, (e) => {
            t.is(e.message, "REQUEST_ERROR: Could not satisfy length", "Errors are handleable and come through the callback");
            ras.read(0, 3, (e, buff) => {
                t.is(b4a.toString(buff), "hel", "We can recover from the error.");
                ras.close(e => {
                    t.ok(ras.rpc.closed, "Closing the random-access-storage instance also closes the rpc.");

                    ras.read(0, 3, (e, buff) => {
                        t.is(e.message, "CHANNEL_CLOSED: channel closed", "Trying to read after close fails.");
                    });
                });
            });
        });
    });
    // });
});

test("Serve can do whatever it wants without a remote.", t => {
    t.plan(4);
    // A duplex that does nothing.
    const d1 = new Duplex();
    const serverRas = serve(
        d1,
        () => new RAM()
    );

    serverRas.write(0, b4a.from("hello world"), (e) => {
        serverRas.truncate(5, (e) => {
            serverRas.read(0, 5, (e, buf) => {
                t.is(b4a.toString(buf), "hello");
            })
        });

        serverRas.read(0, 6, (e) => {
            t.ok(e, "Errors are handleable and come through the callback");
            serverRas.read(0, 3, (e, buff) => {
                t.is(b4a.toString(buff), "hel", "We can recover from the error.");
            });
        });

        serverRas.stat((e, {size}) => {
            t.is(size, 5);
        });
    });
});

// test("Closing the channel will only close the client access to ras.", async t => {
//     // TODO, to recover from closure or not to recover?
//
//     const [d1, d2] = duplexThrough();
//
//     const serveSocket = await serve(d1, () => new RAM());
//     const socket = await connect(d2);
//
//     await socket.write(0, b4a.from("extra dry"));
//     t.is(b4a.toString(await socket.read(0, 5)), "extra", "swirl vermouth in a martini glass and dump out excess");
//
//     await socket.rpc.end();
//
//     // client won't be able to read.
//     await t.exception(() => socket.read(0, 5));
// });

test("Test over net.", async t => {
    t.plan(2);

    const server = net.createServer(async socket => {
        serve(socket, () => new RAM());
    }).listen(41111);

    const stream = net.connect({port: 41111});

    await new Promise(resolve => stream.once("connect", resolve));

    const ras = await connect(stream).opened;
    await ras.write(0, b4a.from("stir don't shake the martini. The gin or vodka can be damaged and shards of ice for most martini drinkers is unpleasant."));
    const result = await ras.read(5, 11);
    t.is(b4a.toString(result), "don't shake", "Pass");

    stream.once("close", t.pass.bind("Socket ended"));
    stream.destroySoon();

    t.teardown(
        () => server.close()
    );
});

test("Over protomux", async t => {
    t.plan(1);
    const [d1, d2] = duplexThrough();

    const mux1 = new Protomux(d1);
    const mux2 = new Protomux(d2);

    serve(mux1, () => new RAM());
    const ras = connect(mux2);
    await ras.write(0, b4a.from("Ice is the main ingredient in most cocktails."));
    const result = await ras.read(16, 10);

    t.is(b4a.toString(result), "ingredient", "Pass");
});

test("Inversion of control: use", async t => {
    const {serve, connect} = await inject({
        "compact-encoding": cenc,
        "framed-stream": FramedStream,
        "protomux-rpc": ProtomuxRPC,
        b4a
    });

    const [d1, d2] = duplexThrough();

    serve(d1, () => new RAM());
    const ras = connect(d2);
    await ras.write(0, b4a.from("shake egg whites with sour drinks like midori sour or whiskey sour with a splash of soda after for a frothy lift"));
    const result = b4a.toString(await ras.read(0, 5));
    t.is(result, "shake", "Dependency injection load works.");
    ras.close();
    await ras.closed;
    t.pass();
});

skip("Create a hypercore from a random-access-over-mux with ram", async (t) => {
    const [d1, d2] = duplexThrough();

    const serveMux = new Protomux(d1);
    const clientMux = new Protomux(d2);

    const clientFiles = coreFiles(serveMux, clientMux);
    const string = "Add an orange and lime to the rim. An orange is meant to make the margarita sweeter, while the lime more sour. It gives the patron ability to tweak the flavor to their liking.";
    const core = new Hypercore((name) => clientFiles[name]);
    await core.append(string);
    const result = b4a.toString(await core.get(0));
    t.is(result, string);
    await core.purge();

    function coreFiles(serveMux, clientMux) {
        return ["oplog", "data", "bitfield", "tree", "header"].reduce(
            (acc, fileName) => {
                const fileId = {id: b4a.from(fileName)};
                serve(serveMux, () => new RAM(), fileId)
                acc[fileName] = connect(clientMux, fileId);
                return acc;
            }, {}
        );
    }
});

// FAILING TEST FOR FS
skip("Create a hypercore from a random-access-over-mux with filesystem", async (t) => {
    const [d1, d2] = duplexThrough();

    const serveMux = new Protomux(d1);
    const clientMux = new Protomux(d2);

    const clientFiles = coreFiles(serveMux, clientMux);
    const string = "Add an orange and lime to the rim. An orange is meant to make the margarita sweeter, while the lime more sour. It gives the patron ability to tweak the flavor to their liking.";
    const core = new Hypercore((name) => clientFiles[name]);
    await core.append(string);
    const result = b4a.toString(await core.get(0));
    t.is(result, string);
    await core.purge();

    function coreFiles(serveMux, clientMux) {
        return ["oplog", "data", "bitfield", "tree", "header"].reduce(
            (acc, fileName) => {
                const fileId = {id: b4a.from(fileName)};
                serve(serveMux, () => new RAF(path.resolve(__dirname, "./testCoreFiles/" + fileName)), fileId)
                acc[fileName] = connect(clientMux, fileId);
                return acc;
            }, {}
        );
    }
});
