/**
 * 交给微信原生图片预览（Taro.previewImage）的一组地址。
 *
 * 转写里的图片点开后要能双指放大，这由微信自己的预览组件负责；我们只决定「这一组」
 * 有哪些图：同一条消息 / 同一个工具结果里已经取到本地路径的那几张，按显示顺序，
 * 这样在预览里可以左右滑到同组的其它图。还没取到的（骨架、失败）直接跳过；
 * 被点的那张一定在内，即使同组登记还没赶上它。
 */
export function previewUrls(paths: ReadonlyArray<string | undefined>, current: string): string[] {
  const urls: string[] = [];
  for (const path of paths) {
    if (path === undefined || path.length === 0 || urls.includes(path)) continue;
    urls.push(path);
  }
  if (!urls.includes(current)) urls.push(current);
  return urls;
}
