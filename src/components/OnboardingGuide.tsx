import { useEffect, useState } from 'react';
import { GUIDE_STEPS, loadGuide, completeGuide, setGuideDismissed, type GuideState } from '../lib/onboarding';
import { toast } from './Toast';
export function OnboardingGuide({ revision, chapterVisible }: { revision: number; chapterVisible: boolean }) {
  const [state, setState] = useState<GuideState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let alive = true; void (async () => {
    await completeGuide('open');
    if (chapterVisible) await completeGuide('chapter');
    const next = await loadGuide(); if (alive) { setState(next); setError(''); }
  })().catch(reason => { if (alive) setError('引导进度未保存：' + String(reason)); }); return () => { alive = false; }; }, [chapterVisible]);
  useEffect(() => { let alive = true; void loadGuide().then(value => { if (alive) setState(value); }).catch(error => toast(String(error), 'err')); return () => { alive = false; }; }, [revision]);
  if (!state && !error || state?.dismissed) return null;
  if (!state) return <p role="alert">{error}</p>;
  const finished = GUIDE_STEPS.every(([step]) => state.completed.includes(step));
  return <div className="onboarding-guide" aria-label="示例书五步引导">
    <span>{finished ? '五步已完成，可以回书架开始自己的作品。' : '示例书 · 可以安全修改或删除'}</span>
    {error && <span role="alert">{error}</span>}
    <ol>{GUIDE_STEPS.map(([id, label]) => <li key={id}>{state.completed.includes(id) ? '✓ ' : '○ '}{label}</li>)}</ol>
    <button className="link-btn" onClick={() => void setGuideDismissed(true).then(setState).catch(error => toast(String(error), 'err'))}>{finished ? '完成并收起' : '跳过并不再显示'}</button>
  </div>;
}
