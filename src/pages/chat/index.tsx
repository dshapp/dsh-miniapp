import React from 'react';
import Taro from '@tarojs/taro';
import { pageParams } from '../../framework/page';
import { indexPageDepth, splitSelectionStore, useWideLayout } from '../../framework/wideLayout';
import { MAIN_ROUTE } from '../../route';
import { PageShell } from '../../ui/pageShell';
import { ChatView } from './chatView';

/** 宽屏下能不能把这页交给首页右栏：本页是栈顶、首页在栈里。返回首页离栈顶的层数。 */
function handoffDepth(): number | undefined {
  const pages = Taro.getCurrentPages();
  if (pages[pages.length - 1]?.route !== MAIN_ROUTE.CHAT) return undefined;
  const depth = indexPageDepth();
  return depth === undefined || depth === 0 ? undefined : depth;
}

/**
 * 会话页：窄屏下整页承载会话视图（见 ./chatView.tsx）。
 *
 * 宽屏下会话视图嵌在首页右栏里，这一页只是过渡：从会话页转成横屏时，把会话交给首页右栏
 * 并退回首页，与安卓端「窄 → 宽时收回并排页」同一口径。首页不在栈里（从分享卡片直接进来）
 * 就没有并排页可回，就地整页显示。
 */
export default function ChatPage(): JSX.Element {
  const params = React.useMemo(() => pageParams(), []);
  const sessionId = params.sessionId ?? '';
  const wide = useWideLayout();
  const [handingOff, setHandingOff] = React.useState(false);

  // 分两步交接：先卸掉本页的会话视图（它退场时会 model.close），下一步再让首页右栏打开同一条。
  // 反过来的话，本页退场的 close 会落在右栏的 open 之后，把右栏刚挂上的交互挂载点摘掉。
  React.useEffect(() => {
    if (wide && sessionId.length > 0 && handoffDepth() !== undefined) setHandingOff(true);
  }, [wide, sessionId]);

  React.useEffect(() => {
    if (!handingOff) return;
    const depth = handoffDepth();
    if (depth === undefined) {
      setHandingOff(false);
      return;
    }
    splitSelectionStore.set(sessionId);
    void Taro.navigateBack({ delta: depth });
  }, [handingOff, sessionId]);

  return <PageShell>{handingOff ? null : <ChatView sessionId={sessionId} />}</PageShell>;
}
