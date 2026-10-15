import React from 'react';
import { useStore } from '../state/store';
import { getAppModel } from '../state/appModel';
import { useInterval, useVisibility } from '../framework/hook';

/**
 * 管理页的刷新节奏（对齐安卓 `ManagementRefresh`）：页面在前台时进页就读一次、之后每 15 秒读一次，
 * 收到对应的主机广播（如 `plugin-manager/changed`）立即重读；只复用已有的 $events，不另开订阅。
 */
export function useManagementRefresh(eventName: string, refresh: () => void): void {
  const [visible, setVisible] = React.useState(true);
  const ref = React.useRef(refresh);
  ref.current = refresh;
  useVisibility(
    () => {
      setVisible(true);
      ref.current();
    },
    () => setVisible(false),
  );
  useInterval(() => ref.current(), visible ? 15_000 : 0);
  const event = useStore(getAppModel().managementEventStore);
  React.useEffect(() => {
    if (event?.name === eventName && visible) ref.current();
  }, [event, eventName, visible]);
}

/** 管理调用的错误文案：主机给的 message 优先。 */
export function managementError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}
