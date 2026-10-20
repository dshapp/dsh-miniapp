import path from 'node:path';
import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import devConfig from './dev';
import prodConfig from './prod';

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'webpack5'>(async (merge, { command, mode }) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'dsh-miniapp',
    date: '2026-1-1',
    designWidth: 375,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: ['@tarojs/plugin-html'],
    defineConstants: {},
    copy: {
      // theme.json 要原样进 dist 根目录：app.json 的 themeLocation 以它为相对路径，
      // darkmode:true 而缺这个文件时微信会直接校验失败。
      patterns: [{ from: 'src/theme.json', to: 'dist/theme.json' }],
      options: {},
    },
    framework: 'react',
    compiler: {
      type: 'webpack5',
      prebundle: {
        enable: false,
      },
    },
    cache: {
      enable: false,
    },
    mini: {
      // marked 发行包含 ES2022 class fields，微信上传校验解析不了，需走 babel 转译。
      compile: {
        include: [(modulePath: string) => /[\\/]node_modules[\\/]marked[\\/]/.test(modulePath)],
      },
      postcss: {
        pxtransform: {
          enable: true,
          config: {
            selectorBlackList: ['nut-'],
          },
        },
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
      miniCssExtractPluginOption: {
        ignoreOrder: true,
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin);
        // marked 在模块加载时就用 \p{P}\p{S} 拼 'u' 正则，安卓微信的 JS 引擎不支持 Unicode
        // 属性转义，会话页一加载 marked 就抛 SyntaxError、整页白屏。构建期展开成显式区间，
        // 详见 config/expandUnicodePropertyLoader.cjs。
        chain.module
          .rule('marked-unicode-property')
          .test(/[\\/]node_modules[\\/]marked[\\/].*\.(c|m)?js$/)
          .enforce('pre')
          .use('expand-unicode-property')
          .loader(path.resolve(__dirname, 'expandUnicodePropertyLoader.cjs'));
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      output: {
        filename: 'js/[name].[hash:8].js',
        chunkFilename: 'js/[name].[chunkhash:8].js',
      },
      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[hash].css',
        chunkFilename: 'css/[name].[chunkhash].css',
      },
      postcss: {
        pxtransform: {
          enable: true,
          config: {
            selectorBlackList: ['nut-'],
          },
        },
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
      webpackChain(chain) {
        chain.resolve.plugin('tsconfig-paths').use(TsconfigPathsPlugin);
      },
    },
  };
  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig);
  }
  return merge({}, baseConfig, prodConfig);
});
