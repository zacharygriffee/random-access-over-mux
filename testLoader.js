import {test, solo} from "brittle";
import {connect, load, serve} from "./loader.js";
import duplexThrough from "duplex-through";
import RAM from "random-access-memory";
import b4a from "b4a";
import inject from "./loader.ioc.js";
import cenc from "compact-encoding";
import FramedStream from "framed-stream";
import ProtomuxRPC from "protomux-rpc";
import Protomux from "protomux";
import Hypercore from "hypercore";

test("Basic Loader", async t => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveLoader = serve(d1, (fileName) => folder(fileName));
    const loader = connect(d2);
    const ras = await loader.load("helloWorld.txt");

    await ras.write(0, b4a.from("hello world"));
    t.is(b4a.toString(await ras.read(0, 5)), "hello");
    let {size} = await ras.stat();
    t.is(size, 11);
    t.is(b4a.toString(await ras.read(0, size)), "hello world");
    await ras.write(size, b4a.from("!!!"));
    ({size} = await ras.stat());
    t.is(b4a.toString(await ras.read(0, size)), "hello world!!!");

    const serveRas = await serveLoader.load("helloWorld.txt");
    t.is(b4a.toString(await serveRas.read(0, size)), "hello world!!!");

    t.comment("When the server unloads the file, it will unload for both the server and the client.");
    await serveLoader.unload("helloWorld.txt");

    await t.exception(() => serveRas.read(0, size), "cannot read file after unload initiated by server side. server gets 'closed'");
    await t.exception(() => ras.stat(0, size), "the client gets channel closed");
});


test("Inversion of control: use", async t => {
    const {serve, connect} = await inject({
        "compact-encoding": cenc,
        "framed-stream": FramedStream,
        "protomux-rpc": ProtomuxRPC,
        b4a
    });

    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveLoader = serve(d1, (fileName) => folder(fileName));
    const loader = connect(d2);
    const ras = await loader.load("helloWorld.txt");

    await ras.write(0, b4a.from("hello world"));
    t.is(b4a.toString(await ras.read(0, 5)), "hello");

    await serveLoader.unload();
    t.teardown(async () => {
        for await (const channel of serveLoader.mux) {
            channel.close();
        }
    })
});

test("Create a hypercore from a random-access-over-mux/loader with ram (connect api)", async (t) => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveMux = new Protomux(d1);
    const clientMux = new Protomux(d2);

    const served = serve(serveMux, file => folder(file), {
        protocolHandler: (fileName) => {
            return "drink/tips/hypercore"
        }
    });

    const loader = connect(clientMux, {
        protocolHandler: (fileName) => {
            return "drink/tips/hypercore"
        }
    });

    const string = "Add an orange and lime to the rim. An orange is meant to make the margarita sweeter, while the lime more sour. It gives the patron ability to tweak the flavor to their liking.";
    let files = {};

    for await (const fileName of ["oplog", "data", "bitfield", "header", "tree", "signatures", "key", "secret_key"]) {
        files[fileName] = await loader.load(fileName);
    }

    const core = new Hypercore((name) => files[name]);
    await core.append(string);
    const result = b4a.toString(await core.get(0));
    t.is(result, string);
    await core.purge();

    t.teardown(async () => {
        for await (const channel of served.mux) {
            channel.close();
        }
        for await (const channel of loader.mux) {
            channel.close();
        }
        await core.close();
    })
});

test("Load", async t => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveLoader = serve(d1, (fileName) => folder(fileName));
    const helloWorldFile = await serveLoader.load("helloWorld.txt");
    await helloWorldFile.write(0, b4a.from("hello"));

    const loader = load(d2);

    t.is(b4a.toString(await loader("helloWorld.txt").read(0, 5)), "hello", "defer the loading into the open function of the random-access-storage instance.");
    t.teardown(async () => {
        for await (const channel of serveLoader.mux) {
            channel.close();
        }
    })
});

test("Load chaos", async t => {
    // todo, add more chaos
    t.plan(8);
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    serve(d1, (fileName) => folder(fileName));
    const loader = load(d2);

    const null_testi = b4a.toString(b4a.fill(b4a.allocUnsafe(10), "\0")) + "testi";

    await loader("hello.txt").write(0,b4a.from("power overwhelming"));
    await loader("world.txt").write(10,b4a.from("testings"));
    const data1 = b4a.toString(await loader("hello.txt").read(0, 6));
    const data2 = b4a.toString(await loader("world.txt").read(0, 15));

    t.is(data1, "power ");
    t.is(data2, null_testi);

    console.log("data11", data1);
    console.log("data22", data2);

    loader("hello.txt").write(0,b4a.from("power overwhelming"), (e) => {
        loader("world.txt").write(10, b4a.from("testings"), async e => {
             loader("hello.txt").read(0, 6, (e, buf) => {
                 t.is(b4a.toString(buf), "power ");
             });

             loader("world.txt").read(0, 15, (e, buf) => {
                 t.is(b4a.toString(buf), null_testi);
             })

            await loader("hello.txt").write(0,b4a.from("power overwhelming"));
            await loader("world.txt").write(10,b4a.from("testings"));
            const data1 = b4a.toString(await loader("hello.txt").read(0, 6));
            const data2 = b4a.toString(await loader("world.txt").read(0, 15));

            t.is(data1, "power ");
            t.is(data2, null_testi);

            loader("hello.txt").read(0, 6, (e, buf) => {
                t.is(b4a.toString(buf), "power ");
            });

            loader("world.txt").read(0, 15, (e, buf) => {
                t.is(b4a.toString(buf), null_testi);
            })
        });
    });
});

test("Create a hypercore from a random-access-over-mux/loader with ram (load api)", async (t) => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveMux = new Protomux(d1);
    const clientMux = new Protomux(d2);

    serve(serveMux, file => {
        return folder(file);
    }, {
        protocolHandler(fileName) {
            return "drink/tips/hypercore"
        }
    });

    const string = "Pour a glass of your favorite bourbon, light a piece of wood enough for it to smoke, and cover both together under a metal bowl or pan to add some smokiness to your favorite bourbon.";
    const fileMaker = load(clientMux, {
        protocolHandler(fileName) {
            return "drink/tips/hypercore"
        }
    });

    const core = new Hypercore(fileMaker);

    await core.append(b4a.from(string));
    const result = b4a.toString(await core.get(0), "utf8", 30, 37);
    t.is(result, "bourbon");
    t.teardown(
        () => core.close()
    );
});

test("1000 files", async t => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    serve(d1, file => {
        return folder(file);
    });

    const fileMaker = load(d2);

    console.time("first");
    for (let i = 0; i < 1000; i++) {
        const file = fileMaker("hello" + i + ".txt");
        await file.write(
            0, b4a.from("hello" + i)
        );
        const {size} = await file.stat();
        const buf = await file.read(
            0, size
        );
        console.log(
            b4a.toString(buf)
        );
    }
    console.timeEnd("first");
    console.time("second");
    for (let i = 0; i < 1000; i++) {
        const file = fileMaker("hello" + i + ".txt");
        await file.write(
            0, b4a.from("hello" + i)
        );
        const {size} = await file.stat();
        const buf = await file.read(
            0, size
        );
        console.log(
            b4a.toString(buf)
        );
    }
    console.timeEnd("second");
});

solo("Test protomux channel speeds", async a => {
    const [d1, d2] = duplexThrough();
    const mux1 = new Protomux(d1);
    const mux2 = new Protomux(d2);

    let muxId = 0;
    const openCount = {
        0: 0,
        1: 0,
        2: 0
    };

    let makeFinished, finished;
    finished =  new Promise(resolve => makeFinished = resolve);

    console.time("total");
    console.time("first");
    create1000Channels(mux1);
    console.timeEnd("first");
    console.time("second");
    create1000Channels(mux2);
    console.timeEnd("second");
    console.timeEnd("total");

    await finished;
    console.log("Completed", openCount);

    function create1000Channels(mux, id = muxId++) {
        const channels = [];
        for (let i = 0; i < 1000; i++) {
            const protocol = "thousandChannelTest" + i
            channels[i] = mux.createChannel({
                protocol,
                handshake: cenc.string,
                onopen(hs) {
                    openCount[id]++;
                    if (muxId >= 2) makeFinished();
                    console.log("fromMuxId:", muxId, "channel# ", i, " from ", id, " got ", hs);
                }
            });

            mux.pair(protocol, () => {
                if (!channels[i].opened) {
                    channels[i].open("fromMuxId:", muxId, " from channel: " + id + " number " + i)
                }
            });

            channels[i].open("mux#" + muxId);
        }
    }

    await new Promise(resolve => setTimeout(resolve, 10000000));
});