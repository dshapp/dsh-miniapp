/**
 * Node 测试用的模块解析钩子。
 *
 * 源码里的相对导入不带扩展名（webpack/Taro 会补），Node 的 ESM 解析不会补，
 * 于是直接 import 源码会 ERR_MODULE_NOT_FOUND。这里按 .ts / .tsx / /index.ts 依次补。
 * 类型擦除由 Node 自带（v22.6+ 的 type stripping）负责，不引入任何编译依赖。
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      try {
        return next(spec, ctx);
      } catch (err) {
        const base = ctx.parentURL ? new URL(spec, ctx.parentURL) : pathToFileURL(spec);
        for (const ext of ['.ts', '.tsx', '/index.ts']) {
          const candidate = fileURLToPath(base) + ext;
          if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
        throw err;
      }
    }
    return next(spec, ctx);
  },
});
