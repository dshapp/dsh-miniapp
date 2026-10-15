/** 页面路由集中登记：app.config.ts 与各处跳转都从这里取，不写字面量。 */
export const MAIN_ROUTE = {
  INDEX: 'pages/index/index', // 会话列表 / 未配对引导
  CHAT: 'pages/chat/index', // 会话页
  NEW: 'pages/new/index', // 新建会话
  SETTINGS: 'pages/settings/index', // 设置
  ARCHIVED: 'pages/archived/index', // 已归档会话
  PAIRING: 'pages/pairing/index', // 扫码 / 手动配对
  PLUGINS: 'pages/plugins/index', // 插件管理
  AUTOMATIONS: 'pages/automations/index', // 自动化任务
};

export const ROUTES = Object.keys(MAIN_ROUTE).reduce((acc, key) => {
  acc[key as keyof typeof MAIN_ROUTE] = '/' + MAIN_ROUTE[key as keyof typeof MAIN_ROUTE];
  return acc;
}, {} as Record<keyof typeof MAIN_ROUTE, string>);
