import { useEffect } from 'react';
import StudySession from '@/components/study/StudySession';
import { useSession } from '@/stores/session';

/** 随机抽查页：从已学单词中随机抽取，检验长期记忆（不受排程到期限制） */
export default function RandomPage() {
  const reset = useSession((s) => s.reset);

  useEffect(() => () => reset(), [reset]);

  return (
    <div>
      <StudySession mode="random" />
    </div>
  );
}
