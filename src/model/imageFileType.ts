/**
 * 按扩展名判定这是不是图片（对齐 Android model/ImageFileType.kt，与 Web
 * `classifyFileType` 的图片集合一致）。
 *
 * 图片链接绝不能拿文本渲染：转写里的图片提及要走图片查看器，其余文件才进文本预览。
 */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif',
]);

/** 从路径里取出扩展名（不含点，小写）；取不到就是空串（对齐 Android extensionOf）。 */
export function fileExtension(path: string): string {
  const clean = path.split('?')[0]?.split('#')[0] ?? path;
  // 先取文件名：目录名里的点（/tmp/v1.2/README）不是扩展名，
  // 首字符就是点的隐藏文件（.png）也没有扩展名。
  const name = clean.slice(Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function isImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(path));
}
