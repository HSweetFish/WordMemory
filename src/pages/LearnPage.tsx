import { useEffect } from 'react';
import StudySession from '@/components/study/StudySession';
import { useSession } from '@/stores/session';

/** 学习页：今日新词学习流 */
export default function LearnPage() {
  const reset = useSession((s) => s.reset);

  // 离开页面时重置会话，下次进入自动重新开始
  useEffect(() => () => reset(), [reset]);

  return (
    <div>
      <StudySession mode="learn" />
    </div>
  );
}
