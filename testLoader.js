import {test, solo} from "brittle";
import {serve, connect, load} from "./loader.js";
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
});

test("Create a hypercore from a random-access-over-mux/loader with ram", async (t) => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveMux = new Protomux(d1);
    const clientMux = new Protomux(d2);

    serve(serveMux, file => folder(file), {
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
});

test("Load 1", async t => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveLoader = serve(d1, (fileName) => folder(fileName));
    const helloWorldFile = await serveLoader.load("helloWorld.txt");
    await helloWorldFile.write(0, b4a.from("hello"));

    const loader = load(d2, "helloWorld.txt");
    t.is(b4a.toString(await loader.read(0, 5)), "hello", "defer the loading into the open function of the random-access-storage instance.");
});

test("Load 2", async t => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveLoader = serve(d1, (fileName) => folder(fileName));
    const helloWorldFile = await serveLoader.load("helloWorld.txt");
    await helloWorldFile.write(0, b4a.from("hello"));

    const loader = load.bind(null, d2);

    t.is(b4a.toString(await loader("helloWorld.txt").read(0, 5)), "hello", "defer the loading into the open function of the random-access-storage instance.");
});