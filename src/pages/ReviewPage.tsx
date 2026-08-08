import { useEffect } from 'react';
import StudySession from '@/components/study/StudySession';
import { useSession } from '@/stores/session';

/** 复习页：FSRS 到期单词复习 */
export default function ReviewPage() {
  const reset = useSession((s) => s.reset);

  useEffect(() => () => reset(), [reset]);

  return (
    <div>
      <StudySession mode="review" />
    </div>
  );
}
