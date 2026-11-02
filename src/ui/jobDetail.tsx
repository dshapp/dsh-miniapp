import React from 'react';
import Taro from '@tarojs/taro';
import { ScrollView, Text, View } from '@tarojs/components';
import { Strings, fmt, type StringKey } from '../i18n/strings';
import { formatDuration } from '../model/format';
import { parseJobTermination } from '../model/jobs';
import { jobIsLive, jobIsObservable, type JobStatus, type JobView } from '../model/types';
import { getAppModel } from '../state/appModel';
import type { SessionStore } from '../state/sessionStore';
import { useStore } from '../state/store';
import { Icon } from './icon';
import { openCardDetail } from './cardDetail';
import styles from './jobDetail.module.scss';

/*
 * 后台任务详情（对齐 Mac 267bcde 的 JobDetailBody / JobOutputPanel，web 0.1.7 的任务面板）：
 * 字段卡（状态、类型、用时、退出码、信号、剩余原因）+ 实时输出（`job/follow`）+ 停止。
 * 挂进全局卡片详情层；本组件自己订阅 jobsStore 与观察中的输出，所以打开后会跟着刷新。
 */

const STATUS_LABEL: Record<JobStatus, StringKey> = {
  running: 'jobStatusRunning',
  stopping: 'jobStatusStopping',
  completed: 'jobStatusCompleted',
  failed: 'jobStatusFailed',
  killed: 'jobStatusKilled',
};

export function jobStatusLabel(status: JobStatus): string {
  return Strings[STATUS_LABEL[status] ?? 'jobStatusRunning'];
}

export function openJobDetail(store: SessionStore, job: JobView): void {
  openCardDetail({
    icon: 'terminal',
    title: job.label || job.kind,
    copyText: job.label,
    content: <JobDetailBody store={store} jobId={job.id} />,
  });
}

function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Field(props: { label: string; value: string; tone?: 'bad'; mono?: boolean }): JSX.Element {
  const valueClass = [styles.fieldValue, props.mono ? styles.mono : '', props.tone === 'bad' ? styles.bad : '']
    .filter(Boolean)
    .join(' ');
  return (
    <View className={styles.field}>
      <Text className={styles.fieldLabel}>{props.label}</Text>
      <Text className={valueClass} selectable userSelect>
        {props.value}
      </Text>
    </View>
  );
}

function JobDetailBody(props: { store: SessionStore; jobId: string }): JSX.Element {
  const model = getAppModel();
  const jobs = useStore(props.store.jobsStore);
  // 行离开列表后保留最后一次看到的样子，别让详情页突然变空。
  const lastSeen = React.useRef<JobView | undefined>(undefined);
  const found = jobs.find(item => item.id === props.jobId);
  if (found !== undefined) lastSeen.current = found;
  const job = found ?? lastSeen.current;
  const live = job !== undefined && jobIsLive(job);
  const now = useNow(live);
  const [stopState, setStopState] = React.useState<'idle' | 'pending' | 'failed'>('idle');

  // 停止受理之后等 job/list 把它移出 running，按钮随之消失。
  React.useEffect(() => {
    if (job !== undefined && job.status !== 'running' && stopState === 'pending') setStopState('idle');
  }, [job, stopState]);

  if (job === undefined) {
    return <Text className={styles.muted}>{Strings.jobOutputNone}</Text>;
  }

  const stop = (): void => {
    wx.showModal({
      title: Strings.jobStopTitle,
      content: job.label + '\n' + Strings.jobStopMessage,
      confirmText: Strings.jobStopConfirm,
      cancelText: Strings.cancel,
      success: result => {
        if (!result.confirm) return;
        setStopState('pending');
        void model.killJob(props.store.sessionId, job.id).then(ok => {
          if (!ok) setStopState('failed');
        });
      },
    });
  };

  // 进行中时 progress 是实时进度；结束后 detail 才是结束原因，才拆退出码/信号。
  const termination = parseJobTermination(job.progress === undefined ? job.detail : undefined);
  const remainder = job.progress ?? termination.remainder;
  const duration = Math.max(0, (job.finishedAt ?? now) - job.startedAt);

  return (
    <View className={styles.body}>
      <View className={styles.card}>
        <View className={styles.statusRow}>
          {live ? <Icon name='loader-circle' spin className={styles.statusGlyph} /> : null}
          <Text className={styles.statusText}>{jobStatusLabel(job.status)}</Text>
          <View className={styles.spacer} />
          {job.status !== 'running' ? null : stopState === 'pending' ? (
            <Icon name='loader-circle' spin className={styles.statusGlyph} />
          ) : (
            <View className={styles.stopButton} onClick={stop}>
              <Icon name='square' className={styles.stopGlyph} />
              <Text className={styles.stopText}>{Strings.jobStopAction}</Text>
            </View>
          )}
        </View>
        {stopState === 'failed' ? <Text className={styles.bad}>{Strings.jobKillFailed}</Text> : null}
        <Field label={Strings.jobDetailKind} value={job.kind} mono />
        <Field label={Strings.jobDetailDuration} value={formatDuration(duration)} />
        {termination.exitCode === undefined ? null : (
          <Field
            label={Strings.jobDetailExitCode}
            value={String(termination.exitCode)}
            mono
            tone={termination.exitCode === 0 ? undefined : 'bad'}
          />
        )}
        {termination.signal === undefined ? null : (
          <Field label={Strings.jobDetailSignal} value={termination.signal} mono />
        )}
        {remainder === undefined ? null : <Field label={Strings.jobDetailDetail} value={remainder} />}
      </View>
      {jobIsObservable(job) ? <JobOutputPanel sessionId={props.store.sessionId} job={job} /> : null}
    </View>
  );
}

/** 实时输出：在场时打开 `job/follow`，离开时关掉；只留最新 128K 字符，自动贴底。 */
function JobOutputPanel(props: { sessionId: string; job: JobView }): JSX.Element {
  const model = getAppModel();
  const { sessionId, job } = props;
  const observedAll = useStore(model.observedJobStore);
  const observed = observedAll !== undefined && observedAll.sessionId === sessionId && observedAll.jobId === job.id
    ? observedAll
    : undefined;
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    model.observeJob(sessionId, job.id);
    return () => model.stopObservingJob(job.id);
  }, [model, sessionId, job.id]);

  React.useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const text = observed?.text ?? '';
  const streaming = observed?.streaming ?? true;
  return (
    <View className={styles.card}>
      <View className={styles.statusRow}>
        <Text className={styles.outputTitle}>{Strings.jobOutputTitle}</Text>
        {streaming ? <Icon name='loader-circle' spin className={styles.statusGlyph} /> : null}
        <View className={styles.spacer} />
        <View
          className={styles.copyButton}
          onClick={() => {
            void Taro.setClipboardData({ data: job.label }).then(() => setCopied(true));
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} className={styles.stopGlyph} />
          <Text className={styles.copyText}>{copied ? Strings.jobCopied : Strings.jobCopyCommand}</Text>
        </View>
      </View>
      {observed?.gapBefore ? <Text className={styles.muted}>{Strings.jobOutputGap}</Text> : null}
      {observed?.error === undefined ? null : (
        <Text className={styles.bad}>{fmt(Strings.jobOutputError, observed.error)}</Text>
      )}
      <ScrollView
        className={styles.output}
        scrollY
        scrollX
        scrollTop={text.length > 0 ? 1e7 + text.length : 0}
      >
        <Text className={text.length === 0 ? styles.outputEmpty : styles.outputText} userSelect selectable>
          {text.length === 0 ? Strings.jobOutputNone : text}
        </Text>
      </ScrollView>
    </View>
  );
}
