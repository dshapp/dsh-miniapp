import { jget, str, type JsonElement } from './json';
import type { ContentBlock, ToolChatData } from './chatNode';

/**
 * 图片块协议（对齐 Android model/ImageBlocks.kt 与 Web
 * `ui-tool/tool/models/image-card-model.js`）。
 *
 * 线上形状：
 *   {"type":"image","attachment":{
 *      "attachmentId":"sha256:...", "mediaType":"image/png",
 *      "bytes":56549, "width":1080, "height":2400, "name":"emu1.png",
 *      "originalDimensions":{"width":..,"height":..}}}
 *
 * 字节不走消息体：图片由 host 落盘，客户端拿整份引用去 session/attachment 换 base64（0.2.2 起
 * 只给 attachmentId 会被网关拒绝）。
 */

/** 一张持久化图片块可以声明的媒体类型；其余一律拒绝。 */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** read_image 写给模型的那封信封：没有这个形状的文本块，就不是一次规范的图片读取。 */
const IMAGE_ENVELOPE = /^<path>[^\n]*<\/path>\n<type>image<\/type>\n<content>\n[\s\S]*\n<\/content>$/;

export interface ImageAttachmentRef {
  attachmentId: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
  name?: string;
  originalDimensions?: { width: number; height: number };
}

/** 正整数 JSON 数字（字符串数字不算）。 */
function positiveInteger(value: JsonElement | undefined): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) return undefined;
  return value;
}

function jsonString(value: JsonElement | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 宽松解码一份 attachment：只要 attachmentId 是非空字符串就给引用。 */
export function decodeImageRef(attachment: JsonElement | undefined): ImageAttachmentRef | undefined {
  if (attachment === undefined || attachment === null || Array.isArray(attachment) || typeof attachment !== 'object') {
    return undefined;
  }
  const attachmentId = jsonString(jget(attachment, 'attachmentId'));
  if (attachmentId === undefined || attachmentId.length === 0) return undefined;
  const original = jget(attachment, 'originalDimensions');
  const originalWidth = positiveInteger(jget(original, 'width'));
  const originalHeight = positiveInteger(jget(original, 'height'));
  return {
    attachmentId,
    mediaType: jsonString(jget(attachment, 'mediaType')) ?? 'image/png',
    bytes: positiveInteger(jget(attachment, 'bytes')) ?? 0,
    width: positiveInteger(jget(attachment, 'width')) ?? 0,
    height: positiveInteger(jget(attachment, 'height')) ?? 0,
    name: jsonString(jget(attachment, 'name')),
    originalDimensions:
      originalWidth !== undefined && originalHeight !== undefined
        ? { width: originalWidth, height: originalHeight }
        : undefined,
  };
}

/**
 * 按顺序收紧结果里的每个 image 块：任一处不合法就整体回落（返回 undefined），
 * 而不是画一半的相册。
 */
export function imageReferences(content: ContentBlock[]): ImageAttachmentRef[] | undefined {
  const refs: ImageAttachmentRef[] = [];
  for (const block of content) {
    if (block.kind !== 'image') continue;
    const attachment = block.attachment;
    if (attachment === undefined || attachment === null || Array.isArray(attachment) || typeof attachment !== 'object') {
      return undefined;
    }
    const attachmentId = jsonString(jget(attachment, 'attachmentId'));
    if (attachmentId === undefined || attachmentId.length === 0) return undefined;
    const mediaType = jsonString(jget(attachment, 'mediaType'));
    if (mediaType === undefined || !IMAGE_MEDIA_TYPES.has(mediaType)) return undefined;
    const bytes = positiveInteger(jget(attachment, 'bytes'));
    const width = positiveInteger(jget(attachment, 'width'));
    const height = positiveInteger(jget(attachment, 'height'));
    if (bytes === undefined || width === undefined || height === undefined) return undefined;
    const nameElement = jget(attachment, 'name');
    const name = nameElement === undefined || nameElement === null ? undefined : jsonString(nameElement);
    if (nameElement !== undefined && nameElement !== null && name === undefined) return undefined;
    const original = jget(attachment, 'originalDimensions');
    if (original !== undefined && original !== null) {
      const originalWidth = positiveInteger(jget(original, 'width'));
      const originalHeight = positiveInteger(jget(original, 'height'));
      if (originalWidth === undefined || originalHeight === undefined) return undefined;
    }
    refs.push({
      attachmentId,
      mediaType,
      bytes,
      width,
      height,
      name,
      originalDimensions: (() => {
        const ow = positiveInteger(jget(original, 'width'));
        const oh = positiveInteger(jget(original, 'height'));
        return original === undefined || original === null || ow === undefined || oh === undefined
          ? undefined
          : { width: ow, height: oh };
      })(),
    });
  }
  return refs.length > 0 ? refs : undefined;
}

/** 不校验、只取能解的图片引用；用于通用工具结果里的图片回退。 */
export function lenientImageRefs(content: ContentBlock[]): ImageAttachmentRef[] {
  return content
    .filter(block => block.kind === 'image')
    .map(block => decodeImageRef(block.attachment))
    .filter((ref): ref is ImageAttachmentRef => ref !== undefined);
}

/** 拼起结果里所有文本块，并要求其中至少有一个是信封形状。 */
export function imageTexts(content: ContentBlock[]): string | undefined {
  const parts: string[] = [];
  let sawEnvelope = false;
  for (const block of content) {
    if (block.kind !== 'text') continue;
    if (IMAGE_ENVELOPE.test(block.text)) sawEnvelope = true;
    parts.push(block.text);
  }
  return sawEnvelope && parts.length > 0 ? parts.join('\n') : undefined;
}

/** 结果只含本卡片消费得了的文本/图片块，否则回落通用卡。 */
function fullyRendered(content: ContentBlock[]): boolean {
  return content.every(block => block.kind === 'text' || block.kind === 'image');
}

export interface ImageCard {
  path: string;
  images: ImageAttachmentRef[];
  text: string;
}

/** 从工具参数里读一个字符串字段；参数不是合法 JSON 就当作没有。 */
function callArgString(argsRaw: string, key: string): string | undefined {
  if (argsRaw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(argsRaw) as JsonElement;
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return undefined;
    return jsonString(jget(parsed, key));
  } catch {
    return undefined;
  }
}

/** 一次已结算的 read_image 调用收成图片卡，不合格返回 undefined。 */
export function readImageCard(call: ToolChatData): ImageCard | undefined {
  const result = call.result;
  if (result === undefined || result.isError) return undefined;
  if (call.name !== 'read_image') return undefined;
  const filePath = callArgString(call.argsRaw, 'file_path');
  if (filePath === undefined || filePath.trim().length === 0) return undefined;
  const metaPath = str(jget(result.meta, 'path'));
  const path = metaPath !== undefined && metaPath.length > 0
    ? metaPath
    : call.parentCallId !== undefined
      ? filePath
      : undefined;
  if (path === undefined) return undefined;
  if (!fullyRendered(result.content)) return undefined;
  const refs = imageReferences(result.content);
  if (refs === undefined) return undefined;
  const text = imageTexts(result.content);
  if (text === undefined) return undefined;
  return { path, images: refs, text };
}
