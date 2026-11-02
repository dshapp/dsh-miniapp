/**
 * 隧道层验证脚本：\`npm run verify:tunnel\`。
 *
 * 三件事，全部离线、可重复：
 *   1. 纯 TS 的 crypto 对 RFC 向量（SHA-256/SHA-1/HMAC、ChaCha20-Poly1305、X25519）；
 *   2. 本机握手自证：Noise_IK 发起方（本项目实现）对真实桥接的 IK 响应方；
 *   3. 隧道端到端：Noise + HTTP/1.1 + WebSocket 跑通（含 keep-alive 与分片重组）。
 *
 * 第 2、3 步需要 /Users/user/dshapp/dsh-mobile-bridge 的源码（同一台机器上开发时的邻居
 * 目录）；找不到就只跑第 1 步，并明确说明跳过了什么——不假装验证过。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BUILD = mkdtempSync(join(tmpdir(), 'dsh-tunnel-'));
const BRIDGE = '/Users/user/dshapp/dsh-mobile-bridge';

let pass = 0;
let fail = 0;
const skip = [];

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    return;
  }
  fail += 1;
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' :: ' + detail));
}

function run(command, args, options) {
  return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...options });
}

function compile(entries, outDir, extra = []) {
  run('npx', ['tsc', ...entries, '--rootDir', 'src', '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020', '--moduleResolution', 'node', '--skipLibCheck', ...extra]);
}

console.log('1) crypto RFC vectors');
compile([
  'src/transport/tunnel/crypto/bytes.ts',
  'src/transport/tunnel/crypto/sha.ts',
  'src/transport/tunnel/crypto/chacha.ts',
  'src/transport/tunnel/crypto/x25519.ts',
], BUILD);
const vectors = readFileSync(join(BUILD, 'transport/tunnel/crypto/bytes.js'), 'utf8');
void vectors;
const { sha256, sha1, hmacSha256 } = await import(join(BUILD, 'transport/tunnel/crypto/sha.js'));
const { seal, open } = await import(join(BUILD, 'transport/tunnel/crypto/chacha.js'));
const { x25519 } = await import(join(BUILD, 'transport/tunnel/crypto/x25519.js'));
const { fromHex, toHex, utf8ToBytes } = await import(join(BUILD, 'transport/tunnel/crypto/bytes.js'));

check('sha256(abc)', toHex(sha256(utf8ToBytes('abc'))) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check('sha1(abc)', toHex(sha1(utf8ToBytes('abc'))) === 'a9993e364706816aba3e25717850c26c9cd0d89d');
check('hmac rfc4231-1', toHex(hmacSha256(fromHex('0b'.repeat(20)), utf8ToBytes('Hi There'))) === 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
const key = fromHex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
const nonce = fromHex('070000004041424344454647');
const aad = fromHex('50515253c0c1c2c3c4c5c6c7');
const plaintext = utf8ToBytes("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
const sealed = seal(key, nonce, aad, plaintext);
check('chacha aead tag', toHex(sealed.slice(plaintext.length)) === '1ae10b594f09e26a7e902ecbd0600691');
check('chacha aead open', toHex(open(key, nonce, aad, sealed)) === toHex(plaintext));
let tamperRejected = false;
try {
  const bad = sealed.slice();
  bad[0] ^= 1;
  open(key, nonce, aad, bad);
} catch {
  tamperRejected = true;
}
check('chacha rejects tamper', tamperRejected);
check('x25519 rfc7748-1', toHex(x25519(fromHex('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4'), fromHex('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'))) === 'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');

if (!existsSync(join(BRIDGE, 'src/noise.ts'))) {
  skip.push('Noise interop + tunnel end-to-end (dsh-mobile-bridge not found at ' + BRIDGE + ')');
} else {
  console.log('2) Noise_IK interop against the real bridge responder');
  const bridgeOut = join(BUILD, 'bridge');
  execFileSync('npx', ['tsc', 'src/noise.ts', '--outDir', bridgeOut, '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node', '--skipLibCheck'], { cwd: BRIDGE, encoding: 'utf8', stdio: 'pipe' });
  compile(['src/transport/tunnel/noise.ts'], join(BUILD, 'mine'));
  const mine = await import(join(BUILD, 'mine/transport/tunnel/noise.js'));
  const theirs = await import(join(bridgeOut, 'noise.js'));

  let seed = 1;
  const rng = (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[i] = seed & 0xff;
    }
    return out;
  };
  const bridgeStatic = theirs.generateKeyPair();
  const phoneStatic = mine.generateKeyPair(rng);
  const prologue = new Uint8Array(37);
  prologue.set([0x44, 0x53, 0x48, 0x43], 0);
  prologue[4] = 1;
  prologue.set(rng(32), 5);

  const initiator = new mine.InitiatorHandshake(phoneStatic, bridgeStatic.publicKey, prologue, rng);
  const token = rng(32);
  const msg1 = initiator.writeMessage1(token);
  const responder = new theirs.Handshake({ pattern: 'IK', initiator: false, staticKey: bridgeStatic, prologue: Buffer.from(prologue) });
  check('responder recovers pairing token', Buffer.from(responder.read(Buffer.from(msg1))).equals(Buffer.from(token)));
  initiator.readMessage2(new Uint8Array(responder.write(Buffer.alloc(0))));
  check('handshake completes', initiator.complete);
  const send = initiator.split();
  const receive = responder.split();
  const message = Buffer.from('phone -> bridge');
  check('transport phone->bridge', Buffer.from(receive.decrypt(Buffer.from(send.encrypt(new Uint8Array(message))))).equals(message));
  const reply = Buffer.from('bridge -> phone');
  check('transport bridge->phone', Buffer.from(send.decrypt(new Uint8Array(receive.encrypt(reply)))).equals(reply));

  console.log('3) tunnel end-to-end (HTTP/1.1 + WebSocket)');
  compile([
    'src/transport/tunnel/stream.ts',
    'src/transport/tunnel/http.ts',
    'src/transport/tunnel/websocket.ts',
    'src/transport/tunnel/socket.ts',
    'src/transport/tunnel/random.ts',
  ], join(BUILD, 'tunnel'));
  const { dialTunnel } = await import(join(BUILD, 'tunnel/transport/tunnel/stream.js'));
  const { TunnelHttpClient } = await import(join(BUILD, 'tunnel/transport/tunnel/http.js'));
  const { TunnelWebSocket } = await import(join(BUILD, 'tunnel/transport/tunnel/websocket.js'));

  const net = await import('node:net');
  const nodeCrypto = await import('node:crypto');
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n, 0); return b; };
  class Reader {
    constructor() { this.buf = Buffer.alloc(0); this.ended = false; this.waiter = null; }
    push(d) { this.buf = Buffer.concat([this.buf, d]); this.notify(); }
    end() { this.ended = true; this.notify(); }
    notify() { const w = this.waiter; this.waiter = null; if (w) w(); }
    async read(n) { while (this.buf.length < n) { if (this.ended) throw new Error('closed'); await new Promise(r => { this.waiter = r; }); } const o = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return o; }
    async readLine() { for (;;) { const i = this.buf.indexOf(0x0a); if (i >= 0) { const l = this.buf.subarray(0, i).toString('utf8').replace(/\r$/, ''); this.buf = this.buf.subarray(i + 1); return l; } if (this.ended) throw new Error('closed'); await new Promise(r => { this.waiter = r; }); } }
  }
  let connections = 0;
  const server = net.createServer(async (socket) => {
    connections += 1;
    const raw = new Reader();
    socket.on('data', (d) => raw.push(d));
    socket.on('close', () => raw.end());
    socket.on('error', () => raw.end());
    try {
      const preamble = await raw.read(37);
      const hs = new theirs.Handshake({ pattern: 'IK', initiator: false, staticKey: bridgeStatic, prologue: preamble });
      const head = await raw.read(2);
      hs.read(await raw.read(head.readUInt16BE(0)));
      const m2 = hs.write(Buffer.alloc(0));
      socket.write(Buffer.concat([u16(m2.length), m2]));
      const transport = hs.split();
      const plain = new Reader();
      (async () => { try { for (;;) { const hh = await raw.read(2); plain.push(transport.decrypt(await raw.read(hh.readUInt16BE(0)))); } } catch { plain.end(); } })();
      const send = (buf) => { const s = transport.encrypt(Buffer.from(buf)); socket.write(Buffer.concat([u16(s.length), s])); };
      for (;;) {
        const line = await plain.readLine();
        const match = /^(\S+) (\S+) HTTP\/1\.1$/.exec(line);
        if (!match) return;
        const headers = {};
        for (;;) { const l = await plain.readLine(); if (l.length === 0) break; const c = l.indexOf(':'); headers[l.slice(0, c).toLowerCase()] = l.slice(c + 1).trim(); }
        let body = Buffer.alloc(0);
        if (headers['content-length']) body = Buffer.from(await plain.read(parseInt(headers['content-length'], 10)));
        if (headers['upgrade'] === 'websocket') {
          const accept = nodeCrypto.createHash('sha1').update(headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
          send('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
          await plain.read(2).then(async (hh) => {
            let len = hh[1] & 0x7f;
            if (len === 126) len = (await plain.read(2)).readUInt16BE(0);
            const mask = await plain.read(4);
            const payload = Buffer.from(await plain.read(len));
            for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
          });
          const first = Buffer.from('part1');
          const second = Buffer.from('part2');
          send(Buffer.concat([Buffer.from([0x01, first.length]), first]));
          send(Buffer.concat([Buffer.from([0x80, second.length]), second]));
          continue;
        }
        // GET 没有请求体，不能直接 JSON.parse 空串（会抛错并把连接丢在这里）。
        const parsed = body.length === 0 ? undefined : JSON.parse(body.toString('utf8'));
        const value = parsed === undefined ? match[2] : parsed.method;
        const response = Buffer.from(JSON.stringify({ type: 'server-response', rpcId: parsed === undefined ? 'r' : parsed.rpcId, result: { ok: true, value } }));
        send(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: ' + response.length + '\r\n\r\n'), response]));
      }
    } catch {
      // 连接收尾
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  // 真机/devtools 的 TCP 是任意切分的，所以这里故意按小片投递，覆盖分片重组。
  // 关键：切分必须**串行**投递（一条 Promise 链），否则不同 data 事件的切分循环会
  // 交错，把字节顺序打乱——那是测试自身的 bug，不是被测量的行为。
  const FRAGMENT = 7;
  class Factory {
    connect(address, p, timeout, handlers) {
      return new Promise((resolve) => {
        let outgoing = Promise.resolve();
        const sock = net.connect({ host: address, port: p }, () => resolve({
          write: (b) => {
            const buf = Buffer.from(b);
            outgoing = outgoing.then(() => new Promise((done) => {
              let i = 0;
              const step = () => {
                if (i >= buf.length) return done();
                sock.write(buf.subarray(i, Math.min(i + FRAGMENT, buf.length)));
                i += FRAGMENT;
                setImmediate(step);
              };
              step();
            }));
          },
          close: () => sock.destroy(),
        }));
        let incoming = Promise.resolve();
        sock.on('data', (d) => {
          incoming = incoming.then(() => new Promise((done) => {
            let i = 0;
            const step = () => {
              if (i >= d.length) return done();
              handlers.onData(new Uint8Array(d.subarray(i, Math.min(i + FRAGMENT, d.length))));
              i += FRAGMENT;
              setImmediate(step);
            };
            step();
          }));
        });
        sock.on('close', () => handlers.onClose());
        sock.on('error', (e) => handlers.onClose(e));
      });
    }
  }
  const factory = new Factory();
  const deviceKey = mine.generateKeyPair(rng);
  const stream = await dialTunnel({ factory, address: '127.0.0.1', port, bridgeKey: bridgeStatic.publicKey, deviceKey, pairingToken: token, random: rng });
  const http = new TunnelHttpClient(stream, 'mobile.dsh');
  const first = await http.request({ method: 'POST', path: '/api/session/list', body: Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'session/list', payload: { args: {} } })) });
  check('rpc over tunnel', first.status === 200 && JSON.parse(Buffer.from(first.body).toString('utf8')).result.value === 'session/list');
  await http.request({ method: 'GET', path: '/api/one' });
  await http.request({ method: 'GET', path: '/api/two' });
  check('http keep-alive reuses connection', connections === 1, 'connections=' + connections);

  const wsStream = await dialTunnel({ factory, address: '127.0.0.1', port, bridgeKey: bridgeStatic.publicKey, deviceKey, random: rng });
  const frames = [];
  const ws = await TunnelWebSocket.connect({ stream: wsStream, path: '/api/remote.mux', host: 'mobile.dsh', random: rng, handlers: { onText: (t) => frames.push(t), onClose: () => undefined } });
  ws.sendText('{}');
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('websocket fragmented reassembly', frames.includes('part1part2'), JSON.stringify(frames));
  ws.close();
  server.close();
}

console.log('\npass=' + pass + ' fail=' + fail);
for (const note of skip) console.log('SKIPPED: ' + note);
process.exit(fail === 0 ? 0 : 1);
