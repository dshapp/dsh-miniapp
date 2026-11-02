import { bool, encodeJson, jget, parseJson, str, type JsonValue } from '../model/json';
import { ApiException, internalError, type RpcError } from './types';

export interface ClientRequest {
  type: 'client-request';
  rpcId: string;
  method: string;
  payload: { args: JsonValue };
}

export interface ServerResponse {
  type: string;
  rpcId: string;
  result: { ok: boolean; value?: JsonValue; error?: RpcError };
}

let counter = 0;

/** 与 Android 的 UUID 等价，小程序里没必要用 crypto。 */
export function newRpcId(): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}

export function buildClientRequest(method: string, args: JsonValue | undefined): ClientRequest {
  return { type: 'client-request', rpcId: newRpcId(), method, payload: { args: args ?? {} } };
}

export function encodeClientRequest(request: ClientRequest): string {
  return encodeJson(request as unknown as JsonValue);
}

/** 解析 server-response 信封；结构不对就按传输失败抛。 */
export function unwrapServerResponse(text: string, expectedRpcId: string): JsonValue {
  const parsed = parseJson(text);
  if (parsed === undefined) throw internalError('bad response: not JSON');
  const type = str(jget(parsed, 'type'));
  if (type !== 'server-response' && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    // 容忍缺省 type 的实现：只要带 result 就按服务端应答处理。
    if (jget(parsed, 'result') === undefined) throw internalError('bad response: missing result');
  }
  const rpcId = str(jget(parsed, 'rpcId'));
  if (rpcId !== undefined && rpcId !== expectedRpcId) throw internalError('rpcId mismatch');
  const result = jget(parsed, 'result');
  if (result === undefined) throw internalError('bad response: missing result');
  if (bool(jget(result, 'ok')) !== true) {
    const error = jget(result, 'error');
    const code = str(jget(error, 'code')) ?? 'internal';
    const message = str(jget(error, 'message')) ?? 'unknown error';
    throw new ApiException({ code, message, details: jget(error, 'details') });
  }
  return jget(result, 'value') ?? null;
}

/** 上传接口的应答形如 { ok, value:{receiptId}, error }。 */
export function unwrapUploadReceipt(text: string): string {
  const parsed = parseJson(text);
  if (parsed === undefined) throw internalError('bad upload response');
  if (bool(jget(parsed, 'ok')) !== true) {
    const error = jget(parsed, 'error');
    throw new ApiException({
      code: str(jget(error, 'code')) ?? 'internal',
      message: str(jget(error, 'message')) ?? 'upload failed',
    });
  }
  const receiptId = str(jget(jget(parsed, 'value'), 'receiptId'));
  if (receiptId === undefined) throw internalError('upload receipt missing');
  return receiptId;
}
