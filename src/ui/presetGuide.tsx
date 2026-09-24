import React from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { Strings } from '../i18n/strings';
import { localizedGuideText, parseGuideSections, type PresetGuide } from '../model/presetGuide';
import { Icon } from './icon';
import { Sheet } from './sheets';
import styles from './presetGuide.module.scss';

/**
 * 内置预设的模式说明弹层（对齐 web `PresetGuideDialog` / Mac `PresetGuideSheet`）：
 * 一句引导 +「模式说明 / 如何使用」两页；用法页的示例任务可一键复制。
 */
export function PresetGuideSheet(props: {
  open: boolean;
  title: string;
  guide: PresetGuide | undefined;
  onClose: () => void;
}): JSX.Element {
  const [page, setPage] = React.useState<'explanation' | 'usage'>('explanation');
  const [copied, setCopied] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (!props.open) {
      setPage('explanation');
      setCopied(undefined);
    }
  }, [props.open]);
  const guide = props.guide;
  if (guide === undefined) return <View />;
  const sections = parseGuideSections(localizedGuideText(page === 'explanation' ? guide.explanation : guide.usage));
  return (
    <Sheet
      open={props.open}
      title={props.title}
      onClose={props.onClose}
      maxHeight='640px'
      bodyScrollKey={page}
      header={
        <View className={styles.header}>
          <Text className={styles.intro}>{localizedGuideText(guide.intro)}</Text>
          <View className={styles.segments}>
            {(['explanation', 'usage'] as const).map(key => (
              <Text
                key={key}
                className={key === page ? styles.segment + ' ' + styles.segmentActive : styles.segment}
                onClick={() => setPage(key)}
              >
                {key === 'explanation' ? Strings.presetGuideExplanation : Strings.presetGuideUsage}
              </Text>
            ))}
          </View>
        </View>
      }
    >
      <View className={styles.body}>
        {sections.map(section => (
          <View key={section.title} className={styles.section}>
            <View className={styles.sectionHead}>
              <Text className={styles.sectionTitle}>{section.title}</Text>
              {page === 'usage' ? <Text className={styles.sectionBadge}>{Strings.presetGuideExampleTask}</Text> : null}
            </View>
            {section.lines.map(line =>
              line.startsWith('> ') ? (
                <View key={line} className={styles.example}>
                  <Text className={styles.exampleText} selectable userSelect>
                    {line.slice(2)}
                  </Text>
                  <View
                    className={styles.copy}
                    onClick={() => {
                      const task = line.slice(2);
                      void Taro.setClipboardData({ data: task }).then(() => setCopied(task));
                    }}
                  >
                    <Icon name={copied === line.slice(2) ? 'check' : 'copy'} className={styles.copyGlyph} />
                    <Text className={styles.copyText}>
                      {copied === line.slice(2) ? Strings.presetGuideCopied : Strings.presetGuideCopy}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text
                  key={line}
                  className={page === 'usage' ? styles.paragraph + ' ' + styles.paragraphMuted : styles.paragraph}
                  selectable
                  userSelect
                >
                  {line}
                </Text>
              ),
            )}
          </View>
        ))}
      </View>
    </Sheet>
  );
}
