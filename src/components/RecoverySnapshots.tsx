import { useEffect, useState } from 'react';
import { listSnapshots, type SnapshotInfo } from '../lib/snapshots';
import { Modal } from './Modal';
import { SnapshotPreview } from './SnapshotPreview';
export function RecoverySnapshots({ root, dirName, onClose }: { root: string; dirName: string; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null), [error, setError] = useState(''), [name, setName] = useState('');
  useEffect(() => { let alive = true; void listSnapshots(root, dirName).then(result => { if (alive) setSnapshots(result); }).catch(reason => { if (alive) setError(String(reason)); }); return () => { alive = false; }; }, [root, dirName]);
  return <><Modal title="作品尚未打开 · 只读查看备份" width={640} onClose={onClose}><p>当前目录无法正常读取，仍可检查已有快照。此入口只预览，不恢复、不创建文件。</p>
    {error && <p role="alert">{error}</p>}{!snapshots && !error && <p>校验备份目录…</p>}{snapshots?.length === 0 && <p>没有找到可显示的快照。</p>}
    {snapshots?.map(snapshot => <p key={snapshot.name}>{snapshot.name} {snapshot.valid ? <button className="ghost-btn small" onClick={() => setName(snapshot.name)}>只读预览</button> : <span>校验失败：{snapshot.error}</span>}</p>)}
  </Modal>{name && <SnapshotPreview root={root} dirName={dirName} name={name} current={null} onClose={() => setName('')} />}</>;
}
