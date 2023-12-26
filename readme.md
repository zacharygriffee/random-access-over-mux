# random-access-over-mux

---
---

### `!! Alpha  Stage !!`

Transmit any [random-access-storage (ras)](https://www.npmjs.com/package/random-access-storage#random-access-storage) derived instance over a stream or [protomux](https://github.com/holepunchto/protomux/#protomux) connection. 

Roadmap and Current state:

- No reconnect logic yet. Once either the file or rpc is closed, have to recreate both the serve and client side.
- No firewall or middlewares yet.
- Be able to set readonly or writeonly or even stat-only
- Suspend not yet supported

> Although planned, there is no security protocols currently. Only use this between secure mediums and only over secure transports.

### Why not [hypercore](https://github.com/holepunchto/hypercore)?

I needed connection between two very trusted endpoints (web workers for example) in a web browser and the underlying
secret stream [hypercore](https://github.com/holepunchto/hypercore) depends on doesn't work in web browser without relay.

---
---

## Installation

```sh
npm install random-access-over-mux --save
```

## Single File Example

```ecmascript 6
import net from "node:net";
import {serve, connect} from "random-access-over-mux";
import RAM from "random-access-memory";
// import RAF from "random-access-file";
// import RAI from "@zacharygriffee/random-access-idb";

const server = net.createServer(async socket => {
    // Serve the file. 
    serve(socket,() => new RAM(), {
        protocol: "rac/bartender/reference",
        id: b4a.from("martiniTips.txt")
    });
    
    // serve another file. You can also access the file from server side too.
    const ras = serve(socket,() => new RAM(), {
        protocol: "rac/bartender/reference",
        id: b4a.from("muddling.txt")
    });

    await ras.write(0, b4a.from("Roll the muddler over the mash with the fat part of your hand, don't just smash like a mad-person"));

    ras.read(0, 4, (error, buffer) => b4a.toString(buffer)); // Roll
}).listen(41111);

const stream = net.connect({port: 41111});
await new Promise(resolve => stream.once("connect", resolve));

// ras Operates just like a random-access-storage instance, but remote.
const ras = connect(stream, {
    protocol: "rac/bartender/reference",
    id: b4a.from("martiniTips.txt")
});

await ras.write(0, b4a.from("stir, don't shake the martini. The gin or vodka can be damaged and shards of ice for most martini drinkers is unpleasant."));
// Notice, random-access-over-mux functions can be invoked by callback or promise.
const result = await ras.read(5, 11); // don't shake

stream.destroySoon();

```

# File API

`import {serve, connect} from  "random-access-over-mux";`

To understand what random-access-over-mux is about, you should [read about the random-access api](https://www.npmjs.com/package/random-access-storage#random-access-storage)
. This library simply wraps the api to be served over any stream.

### Both sides have nearly same api

### `ras = serve(stream, randomAccessFactory, [config])`
### `ras = connect(stream, [config])`

`stream` Can be really any stream, socket, another random-access-over-mux instance or a [protomux](https://github.com/holepunchto/protomux/#protomux). Since my use-case this api will encounter unframed streams more 
than framed, I decided to auto-frame the stream with [framed-stream](https://github.com/holepunchto/framed-stream#framed-stream). Set `config.noFrame=true` if you pass in a framed stream.

`randomAccessFactory=(mux, config) => {}` A function that returns a [random-access](https://www.npmjs.com/package/random-access-storage#random-access-storage) instance. Serve side only argument.
 
`config` 

- `protocol=randomAccessChannel` Optional protocol name. 
- `id`  Optional binary ID to identify this file / RPC channel
- `noFrame=false` If non-protomux stream is passed, will auto frame the stream unless this is set to true.
- `bits=32` When noFrame=false, this will be the size each frame will be in bits. See [framed-stream](https://github.com/holepunchto/framed-stream#framed-stream)
- coming soon: `timeout=8000` When the other side doesn't respond, close the connection at this timeout.

### `await ras.opened`

The channel and random-access-storage is opened.

### `await ras.closed`

The channel and random-access-storage is closed. 

> Currently, you need to recreate the serve/connect pair to reopen. 
> This will probably change.

### Methods
- **new** `RandomAccessOverMux instance = await ras.open()` |  `ras.open((error) => {})`
- `data = await ras.read(offset, size)` | `ras.read(offset, size, (error, data) => {})`
- `await ras.write(offset, buff)` | `ras.write(offset, buff, (error) => {})`
- `await ras.del(offset, size)` | `ras.del(offset, size, (error) => {})`
- `await ras.truncate(offset)` | `ras.truncate(offset, (error) => {})`
- `stat = await ras.stat()` | `ras.stat(offset, (error, stat) => {})`
- `close = await ras.close()` | `ras.close((error) => {})`
- `await ras.unlink()` | `ras.unlink((error) => {})`

### Properties

### `protomux = ras.mux`

Get the underlying muxor handling the random-access rpc connection where you can pass it to other libraries that use mux.

### `protomux-rpc = ras.rpc`

You may [add your own rpc](https://github.com/holepunchto/protomux-rpc#protomux-rpc) methods and make your own requests as long as they don't conflict with
already defined ones (e.g. write, read, stat, truncate, del, close).

### `{} = ras.capability`

Get all the capabilities of the ras, on either side.

```text
{
    readable
    writable
    deletable
    truncatable
    statable
}
```

### `bool = ras.isServer`

Whether the ras is the server or not.

### `string=ras.protocol` 
The protocol that the protomux-rpc is using
### `buffer=ras.id` 
The id the protomux-rpc is using. If created by loader, this is also the hash of the file.

# Loader API

`import {serve, connect} from  "random-access-over-mux/loader";`

### Both sides have nearly same api

### `loader = serve(stream, fileFactory, [config])`
### `loader = connect(stream, [config])`

`fileFactory=(fileName, mux, config) => {}` is different from the randomAccessFactory argument from file api. This will receive a 'fileName' as the first argument for you
to create a file from.

#### In addition to config in the 'file api' section the following configuration is available

`config.fileHasher=(fileName) => b4a.from(fileName)` When a file is requested, this function will turn the fileName into a hash for the id of the channel. By default,
the hasher just converts the fileName into it's buffer representation.

`config.protocolHandler=(fileName) => 'randomAccessChannel'` When a file is requested, this function will turn the fileName into a protocol for the protomux channel
handling the underlying rpc. By default, it uses 'randomAccessChannel' as the protocol name.

### Methods

`raom = await loader.load(fileName) | loader.load(fileName, (err, raom) => {})`

This will load the file on the server side, and will return the random-access-over-mux instance where the file API above takes over.

`returns` a random-access-over-mux instance see file api

`await loader.unload(fileName) | loader.unload(fileName, (err) => {})`

- Called by the serve loader, will unload the file for both server and client.
- Called by the connect loader, will unload the file for client only. The loader.serve will still be able to operate on it, and other loader.connect can connect.


## Loader Example

```ecmascript 6
import {connect, serve} from "random-access-over-mux/loader";
import RAM from "random-access-memory";
// Create a 'ram folder' that acts like a folder of files.
// You could use random-access-file or @zacharygriffee/random-access-idb
// Or any other random access library you find.
const folder = RAM.reusable();

const serveLoader = serve(d1, (fileName) => folder(fileName));
const clientLoader = connect(d2);

// Load a file on either side
// Returns a random-access-over-mux instance (see single file example above)
const ras = await clientLoader.load("wineTastingTips.txt"); 
await ras.write(0, b4a.from("Don't like wine? You're probably drinking it wrong. Aerate your wine, sip it like a hot coffee, roll it around in the glass to vastly improve your wine drinking experience."));
const serveRas = await serveLoader.load("wineTastingTips.txt");
await serveRas.read(52, 6); // Aerate

// if you unload on server side.
await serveLoader.unload("wineTastingTips.txt");
// No longer available on client and server side

// if you unload on client side
await clientLoader.unload("wineTastingTips.txt");

// No longer available on client side but the server and other clients can still access.
```



## Using this repo to test inversion of control (IoC) techniques.

I am also using this library to test out some inversion of control techniques to reduce duplication of code. Many of my libraries
I am using the same libraries over and over again bloating my pages. And bundlers have a problem dealing with this.

I have attached a simple method of IoC for this library for now, but I have plans for a more complex way of handling dependencies.
I plan on supporting both the IoC and traditional methods of load on my libraries.

### Example IoC
```ecmascript 6
    import inject from "random-access-over-mux/ioc";
//  import inject from "random-access-over-mux/loader/ioc";
    // Lets say you have these libraries already loaded elsewhere
    import b4a from "b4a";
    import cenc from "compact-encoding";
    
    const {serve, connect} = await inject({
        ["compact-encoding"]: cenc,
        b4a: b4a
    });
    
    // then proceed to use serve and connect 
    // just like the exammple at the top of this readme
    serve(mux1, () => new RAM);
    const ras = connect(mux2)
    await ras.write(0, b4a.from("use real cherries not maraschino cherries in your old fashion"));
    ras.close();
    
```
## Test it

```sh
npm test
```

Distributed under the MIT license. See ``LICENSE`` for more information.