/**
 * 图片块协议：逐条对照安卓 ImageProtocolTest（断言对着 Web 的 image-card-model 与主机日志形状）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeImageRef, imageReferences, imageTexts, lenientImageRefs, readImageCard } from '../../src/model/imageCards';
import { decodeContentBlock } from '../../src/model/chatNode';
import { SessionStore } from '../../src/state/sessionStore';
import type { ContentBlock, ToolChatData } from '../../src/model/chatNode';

/** read_image 写给模型的那封信封（主机 formatImageReadOutput 的原样）。 */
const ENVELOPE =
  '<path>/tmp/emu1.png</path>\n<type>image</type>\n<content>\nimage/png image, 1080x2400 px, 56549 bytes\n</content>';

const IMAGE_JSON = {
  type: 'image',
  attachment: {
    attachmentId: 'sha256:8a2213d9', mediaType: 'image/png', bytes: 56549,
    width: 1080, height: 2400, name: 'emu1.png',
    originalDimensions: { width: 2160, height: 4800 },
  },
};

const block = (json: unknown): ContentBlock => decodeContentBlock(json as never);
const image = () => block(IMAGE_JSON);
const envelopeText = () => block({ type: 'text', text: ENVELOPE });
/** 按字符串替换造一份变体，用来验证严格校验。 */
const mutated = (from: string, to: string): ContentBlock =>
  block(JSON.parse(JSON.stringify(IMAGE_JSON).replace(from, to)));

test('单个 attachment 宽松解码', () => {
  const ref = decodeImageRef((image() as { attachment: unknown }).attachment as never);
  assert.equal(ref?.attachmentId, 'sha256:8a2213d9');
  assert.equal(ref?.mediaType, 'image/png');
  assert.equal(ref?.bytes, 56549);
  assert.equal(ref?.width, 1080);
  assert.equal(ref?.height, 2400);
  assert.equal(ref?.name, 'emu1.png');
  assert.equal(ref?.originalDimensions?.width, 2160);
  // 只有 attachmentId 也认（web contentParts 不做字段校验）。
  const bare = decodeImageRef({ attachmentId: 'sha256:beef' } as never);
  assert.equal(bare?.mediaType, 'image/png');
  assert.equal(bare?.bytes, 0);
  // 没有 attachmentId / 不是对象：不给引用。
  assert.equal(decodeImageRef({ mediaType: 'image/png' } as never), undefined);
  assert.equal(decodeImageRef([1, 2] as never), undefined);
  assert.equal(decodeImageRef(undefined), undefined);
});

test('imageReferences 逐字段严格校验，任一不合规整体回落', () => {
  assert.equal(imageReferences([block({ type: 'text', text: 'x' }), image()])?.length, 1);
  assert.equal(imageReferences([mutated('image/png', 'image/tiff')]), undefined);
  assert.equal(imageReferences([mutated('"bytes":56549', '"bytes":0')]), undefined);
  assert.equal(imageReferences([mutated('"width":1080', '"width":"1080"')]), undefined);
  assert.equal(imageReferences([mutated('"width":2160', '"width":-3')]), undefined);
  assert.equal(imageReferences([mutated('"name":"emu1.png"', '"name":7')]), undefined);
  assert.equal(imageReferences([block({ type: 'text', text: 'x' })]), undefined);
  // 宽松回退仍然认得出能解的那张。
  assert.equal(lenientImageRefs([block({ type: 'image', attachment: { attachmentId: 'sha256:beef' } })]).length, 1);
});

test('imageTexts 要求信封形状', () => {
  assert.ok(imageTexts([envelopeText(), image()])?.startsWith('<path>/tmp/emu1.png</path>'));
  assert.equal(imageTexts([block({ type: 'text', text: 'just text' }), image()]), undefined);
});

test('readImageCard 的根调用 / 嵌套调用路径口径', () => {
  const result = { seq: 9, time: 0, content: [envelopeText(), image()], isError: false };
  const root = {
    callId: 'c1', name: 'read_image', argsRaw: '{"file_path":"/tmp/emu1.png"}',
    turn: 1, step: 0, startSeq: 8, time: 0, result,
  } as unknown as ToolChatData;
  // 根调用：标签只能来自 presentationMeta.path。
  assert.equal(readImageCard(root), undefined);
  assert.equal(readImageCard({ ...root, result: { ...result, meta: { path: '/tmp/emu1.png' } } } as ToolChatData)?.path, '/tmp/emu1.png');
  // 嵌套调用不落 meta：退回调用自己的 file_path。
  const nested = { ...root, parentCallId: 'c1-root' } as ToolChatData;
  assert.equal(readImageCard(nested)?.path, '/tmp/emu1.png');
  assert.equal(readImageCard(nested)?.images.length, 1);
  // 失败结果、别的工具名、缺 file_path：都没有图片卡。
  assert.equal(readImageCard({ ...nested, result: { ...result, isError: true } } as ToolChatData), undefined);
  assert.equal(readImageCard({ ...nested, name: 'read' } as ToolChatData), undefined);
  assert.equal(readImageCard({ ...nested, argsRaw: '{"path":"/tmp/x"}' } as ToolChatData), undefined);
  // 结果里混进本卡片消费不了的块（后置钩子追加的 reasoning）时回落通用卡。
  const extra = { ...result, content: [...result.content, block({ type: 'reasoning', text: 'hmm' })] };
  assert.equal(readImageCard({ ...nested, result: extra } as ToolChatData), undefined);
});

test('tool/ptc-dispatch* 投影成嵌套 read_image 子调用', () => {
  const store = new SessionStore('session-test');
  const ev = (type: string, seq: number, data: unknown) => ({ type, seq, time: 0, data }) as never;
  store.apply(ev('tool/call', 1, { turn: 1, step: 0, callId: 'c1', name: 'run_code', arguments: '{"code":"read_image"}' }), undefined);
  const sub = { rootCallId: 'c1', parentCallId: 'c1', subCallId: 'c1:ptc:1', name: 'read_image', arguments: { file_path: '/tmp/emu1.png' } };
  store.apply(ev('tool/ptc-dispatch-start', 2, sub), undefined);
  store.apply(ev('tool/ptc-dispatch', 3, { ...sub, isError: false, content: [{ type: 'text', text: ENVELOPE }, IMAGE_JSON] }), undefined);
  const root = store.nodes.find(node => node.kind === 'tool') as { data: ToolChatData } | undefined;
  assert.equal(root?.data.name, 'run_code');
  const child = root?.data.subCalls?.[0];
  assert.equal(child?.name, 'read_image');
  assert.equal(imageReferences(child!.result!.content)?.length, 1);
  assert.equal(readImageCard(child!)?.path, '/tmp/emu1.png');
});
