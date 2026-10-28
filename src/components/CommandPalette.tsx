import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Modal } from './Modal';
import { toast } from './Toast';

export interface CommandItem { id: string; title: string; keywords?: string[]; run: () => void | Promise<void>; disabled?: string }
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]') && !document.querySelector('[cmdk-root]')) return;
      if (!event.isComposing && event.keyCode !== 229 && !event.defaultPrevented && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}
export function CommandPalette({ commands, onClose }: { commands: CommandItem[]; onClose: () => void }) {
  return <Modal title="查找功能" onClose={onClose} width={540}>
    <Command label="查找功能" loop>
      <Command.Input autoFocus placeholder="输入功能名称，例如：备份、章纲、导出" />
      <Command.List>
        <Command.Empty>没有匹配功能</Command.Empty>
        {commands.map(command => <Command.Item key={command.id} value={command.title} keywords={command.keywords}
          disabled={!!command.disabled} onSelect={() => { onClose(); requestAnimationFrame(() => { void Promise.resolve().then(command.run).catch(error => toast('操作未完成：' + String(error), 'err')); }); }}>
          <span>{command.title}</span>{command.disabled && <small>{command.disabled}</small>}
        </Command.Item>)}
      </Command.List>
    </Command>
    <p className="hint-text">↑ ↓ 选择 · Enter 执行 · Esc 退出 · Ctrl+K 打开</p>
  </Modal>;
}
