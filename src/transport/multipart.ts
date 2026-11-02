/**
 * 0.1.7 的二进制 RPC 应答（`multipart/form-data`）解码。
 *
 * 0.1.7 起，结果里带原生字节的 Remote 方法（目前手机端只用到 `workspaceFiles/readBytes`）
 * 不再把字节 base64 进 JSON，而是整条应答改成 multipart：
 *
 *   - `metadata` 字段：普通的 server-response 信封，字节所在的位置先填 `null`，
 *     另带 `attachments: [{ path, codec: 'bytes', part }]`；
 *   - `bytes-<n>` 字段：每个附件的原始字节。
 *
 * 这里把字节按 `path` 放回信封（编码成 base64 字符串，维持 0.1.6 及更早的 `data` 形状），
 * 上层 RPC 解码与分片落盘逻辑因此不用分两套。对照主机
 * `packages/client/connection/src/client/rpc.ts#parseBinaryResponse`。
 */
import { bytesToUtf8, toBase64, utf8ToBytes } from './tunnel/crypto/bytes';
import { parseJson, type JsonValue } from '../model/json';
import { internalError } from './types';

/** 从 content-type 取 multipart 边界；不是 multipart/form-data 时返回 undefined。 */
export function multipartBoundary(contentType: string | undefined): string | undefined {
  if (contentType === undefined) return undefined;
  const [media, ...params] = contentType.split(';');
  if (media.trim().toLowerCase() !== 'multipart/form-data') return undefined;
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq < 0) continue;
    if (param.slice(0, eq).trim().toLowerCase() !== 'boundary') continue;
    let value = param.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const last = haystack.length - needle.length;
  outer: for (let i = from; i <= last; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function partName(headerText: string): string | undefined {
  for (const line of headerText.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon < 0 || line.slice(0, colon).trim().toLowerCase() !== 'content-disposition') continue;
    const match = /;\s*name="([^"]*)"/i.exec(line.slice(colon + 1)) ?? /;\s*name=([^;\s]+)/i.exec(line.slice(colon + 1));
    if (match !== null) return match[1];
  }
  return undefined;
}

/** 按边界切出每个字段的原始字节；结构不对就抛。 */
export function parseMultipart(body: Uint8Array, boundary: string): Map<string, Uint8Array> {
  const delimiter = utf8ToBytes('--' + boundary);
  const headerEnd = utf8ToBytes('\r\n\r\n');
  const fields = new Map<string, Uint8Array>();
  let cursor = indexOf(body, delimiter, 0);
  if (cursor < 0) throw internalError('bad multipart response: no boundary');
  for (;;) {
    cursor += delimiter.length;
    // 结束分隔符 `--boundary--`。
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break;
    // 分隔符后必须是 CRLF。
    if (body[cursor] !== 0x0d || body[cursor + 1] !== 0x0a) throw internalError('bad multipart response: framing');
    cursor += 2;
    const headersAt = indexOf(body, headerEnd, cursor);
    if (headersAt < 0) throw internalError('bad multipart response: headers');
    const name = partName(bytesToUtf8(body.subarray(cursor, headersAt)));
    const contentStart = headersAt + headerEnd.length;
    const next = indexOf(body, delimiter, contentStart);
    if (next < 0) throw internalError('bad multipart response: unterminated part');
    // 内容与下一个分隔符之间隔着一个 CRLF。
    const contentEnd = next >= 2 && body[next - 2] === 0x0d && body[next - 1] === 0x0a ? next - 2 : next;
    if (name === undefined || fields.has(name)) throw internalError('bad multipart response: fields');
    fields.set(name, body.subarray(contentStart, contentEnd));
    cursor = next;
  }
  return fields;
}

/**
 * 把 multipart 二进制应答还原成一条 server-response 的 JSON 文本，交回给
 * `unwrapServerResponse` 统一处理（rpcId 校验、ok/error 分支都在那里）。
 *
 * 字节被编码成 base64 字符串放回 `result.value` 下 `path` 指向的位置。
 */
export function decodeBinaryResponse(body: Uint8Array, boundary: string): string {
  const fields = parseMultipart(body, boundary);
  const metadataBytes = fields.get('metadata');
  if (metadataBytes === undefined) throw internalError('bad multipart response: metadata');
  fields.delete('metadata');
  const envelope = parseJson(bytesToUtf8(metadataBytes));
  if (envelope === undefined || envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw internalError('bad multipart response: metadata is not an object');
  }
  const attachments = envelope.attachments;
  delete envelope.attachments;
  const result = envelope.result;
  if (Array.isArray(attachments) && result !== null && typeof result === 'object' && !Array.isArray(result)) {
    const root: { [key: string]: JsonValue } = { value: result.value ?? null };
    for (const attachment of attachments) {
      if (attachment === null || typeof attachment !== 'object' || Array.isArray(attachment)) {
        throw internalError('bad multipart response: attachment');
      }
      const part = attachment.part;
      const path = attachment.path;
      if (typeof part !== 'string' || !Array.isArray(path) || attachment.codec !== 'bytes') {
        throw internalError('bad multipart response: attachment');
      }
      const data = fields.get(part);
      if (data === undefined) throw internalError('bad multipart response: missing part');
      fields.delete(part);
      let parent: JsonValue = root;
      let key: string | number = 'value';
      for (const segment of path) {
        const child: JsonValue | undefined = Array.isArray(parent)
          ? (typeof key === 'number' ? parent[key] : undefined)
          : (parent !== null && typeof parent === 'object' ? parent[String(key)] : undefined);
        if (child === undefined || child === null || typeof child !== 'object') {
          throw internalError('bad multipart response: path');
        }
        if (typeof segment !== 'string' && typeof segment !== 'number') throw internalError('bad multipart response: path');
        parent = child;
        key = segment;
      }
      const encoded = toBase64(data);
      if (Array.isArray(parent) && typeof key === 'number') parent[key] = encoded;
      else if (parent !== null && typeof parent === 'object' && !Array.isArray(parent)) parent[String(key)] = encoded;
      else throw internalError('bad multipart response: path');
    }
    result.value = root.value;
  }
  return JSON.stringify(envelope);
}
