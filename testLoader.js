import {test} from "brittle";
import {serve, connect} from "./loader.js";
import duplexThrough from "duplex-through";
import RAM from "random-access-memory";
import b4a from "b4a";
import inject from "./loader.ioc.js";
import cenc from "compact-encoding";
import FramedStream from "framed-stream";
import ProtomuxRPC from "protomux-rpc";

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

test("unloaded by client", async t => {
    const [d1, d2] = duplexThrough();
    const folder = RAM.reusable();

    const serveLoader = serve(d1, (fileName) => folder(fileName));
    const loader = connect(d2);
    const ras = await loader.load("helloWorld.txt");

    await ras.write(0, b4a.from("hello world"));
    t.is(b4a.toString(await ras.read(0, 5)), "hello");

    const serveRas = await serveLoader.load("helloWorld.txt");
    t.is(b4a.toString(await serveRas.read(0, 5)), "hello");

    t.comment("The client can unload their file locally, but won't unload the file for the server.");
    await loader.unload("helloWorld.txt");
    t.ok(await serveRas.read(0, 4), "client doesn't unload the file for the server, just unloads for itself.")
    await t.exception(() => ras.stat(0, 4), "the client gets channel closed");
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