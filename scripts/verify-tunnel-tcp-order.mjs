/**
 * 复现并判定「平台 TCP 是否损坏字节流」。
 *
 * 背景：Noise 隧道 + HTTP/1.1 都假设底层是一条**未被改动的有序字节流**。
 * 开发者工具（模拟器）36.6.0 的 wx.createTCPSocket 在服务端「零间隔、小分片」连发时
 * 会破坏这个前提：字节总量可能对，但内容在分片边界处错位（甚至少收几百字节），于是
 * Noise 的 AEAD 校验失败、HTTP 帧边界错位，大响应随机报
 * chacha20poly1305: authentication failed。真机走原生 TCP 栈没有这个问题。
 *
 * 关键：这里的校验与「回调如何切分」无关。payload 第 i 个字节由**全局位置 i** 决定，
 * 所以 TCP 只是把多次 write 合并成一个回调（coalescing）也不会被误判成损坏——早期用
 * 「每片一个序号头」的做法会被 coalescing 干扰，已废弃。
 *
 * 用法：
 *   node scripts/verify-tunnel-tcp-order.mjs             # 起服务 + Node 对照
 *   node scripts/verify-tunnel-tcp-order.mjs --print-wx  # 额外打印小程序侧探针
 *
 * 判定：Node 对照必须 firstBad=-1；小程序侧若 firstBad!=-1 或丢字节，就是平台缺陷。
 */

import net from 'node:net';

const PORT = Number(process.env.PORT ?? 8899);
const CHUNK = 1448;
const TOTAL = 200_000;

/** 第 i 个字节的期望值：由全局位置决定，与分片方式无关。 */
function pd(i) {
  return (i * 7919 + (i >> 8) * 13 + ((i >> 16) * 29)) & 0xff;
}

/** 起一个「零间隔、小分片」的定向 payload 服务器。 */
function startServer() {
  return new Promise(resolve => {
    const server = net.createServer(conn => {
      let pos = 0;
      let timer = null;
      timer = setInterval(() => {
        if (pos >= TOTAL) {
          clearInterval(timer);
          conn.end();
          return;
        }
        const n = Math.min(CHUNK, TOTAL - pos);
        const buf = Buffer.alloc(n);
        for (let i = 0; i < n; i += 1) buf[i] = pd(pos + i);
        conn.write(buf);
        pos += n;
      }, 0);
      conn.on('close', () => clearInterval(timer));
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

/** Node 对照：同一台服务器上必须逐字节正确。 */
function nodeControl() {
  return new Promise(resolve => {
    let pos = 0;
    let chunks = 0;
    let firstBad = -1;
    let badGot = -1;
    let badWant = -1;
    const sock = net.connect(PORT, '127.0.0.1');
    sock.on('data', d => {
      const b = new Uint8Array(d);
      chunks += 1;
      for (let j = 0; j < b.length; j += 1) {
        if (firstBad === -1 && b[j] !== pd(pos + j)) {
          firstBad = pos + j;
          badGot = b[j];
          badWant = pd(pos + j);
        }
      }
      pos += b.length;
    });
    sock.on('close', () =>
      resolve({ chunks, bytes: pos, firstBad, badGot, badWant }),
    );
    sock.on('error', err => resolve({ error: err.message }));
  });
}

/** 供小程序 automation_evaluate 使用的探针（单行，无换行）。 */
function wxProbe() {
  return (
    'function(){ return new Promise(function(resolve){ try{ var s=wx.createTCPSocket();' +
    ' if(!s){ resolve("WX NOPORT (quota?)"); return; }' +
    ' function pd(i){ return (i*7919 + (i>>8)*13 + ((i>>16)*29)) & 0xff; }' +
    ' var pos=0, chunks=0, firstBad=-1, badGot=-1, badWant=-1, done=false;' +
    ' s.onConnect(function(){});' +
    ' s.onMessage(function(m){ if(done) return; var b=new Uint8Array(m.message).slice(); chunks++;' +
    ' for(var j=0;j<b.length;j++){ if(firstBad===-1 && b[j]!==pd(pos+j)){ firstBad=pos+j; badGot=b[j]; badWant=pd(pos+j); } }' +
    ' pos+=b.length;' +
    ' if(pos>=' + TOTAL + '){ done=true; resolve("WX chunks="+chunks+" bytes="+pos+" firstBad="+firstBad+" got="+badGot+" want="+badWant); } });' +
    ' s.onError(function(){ if(!done){done=true;resolve("WX ERR");} });' +
    ' s.onClose(function(){ if(!done){done=true;resolve("WX CLOSE chunks="+chunks+" bytes="+pos+" firstBad="+firstBad);} });' +
    ' s.connect({address:"127.0.0.1",port:' + PORT + ',timeout:8000}); }' +
    'catch(e){ resolve("WX THROW "+e.message); } }); }'
  );
}

const server = await startServer();
console.log('pattern server on 127.0.0.1:' + PORT + ' (chunk=' + CHUNK + ', total=' + TOTAL + ')');
const control = await nodeControl();
console.log('node control:', JSON.stringify(control));
if (control.firstBad !== -1 || control.bytes !== TOTAL) {
  console.log('FAIL: 服务器/Node 侧就不干净，先查这条链路，再谈小程序。');
  server.close();
  process.exit(1);
}
console.log('OK: Node 对照逐字节正确，可以用小程序侧探针判定平台行为。');
if (process.argv.includes('--print-wx')) {
  console.log('\nwx probe:\n' + wxProbe() + '\n');
  console.log(
    'cd <项目目录> && wechatide -c dsh automation_evaluate --project <项目绝对路径> --fn-source "<上面的函数>"',
  );
}
server.close();
