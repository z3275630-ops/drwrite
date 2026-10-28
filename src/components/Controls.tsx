import { Children, createContext, isValidElement, useContext, type FieldsetHTMLAttributes, type ReactNode, type ReactElement } from 'react';
import * as Select from '@radix-ui/react-select';

const DisabledControls = createContext(false);
export function ControlGroup({ children, disabled, className = '', ...rest }: FieldsetHTMLAttributes<HTMLFieldSetElement>) {
  const inherited = useContext(DisabledControls);
  return <DisabledControls.Provider value={!!disabled || inherited}>
    <fieldset {...rest} disabled={!!disabled || inherited} className={'tool-group ' + className}>{children}</fieldset>
  </DisabledControls.Provider>;
}
interface SelectChange { target: { value: string } }
const EMPTY_VALUE = '__drwrite_empty_option__';
type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };
function textContent(value: ReactNode): string {
  return Children.toArray(value).map(child => isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : String(child)).join('');
}
export function selectOptionValue(option: ReactElement<OptionProps>): string {
  return option.props.value === undefined ? textContent(option.props.children).replace(/\s+/g, ' ').trim() : String(option.props.value);
}
/** Radix owns keyboard/focus/positioning; the wrapper preserves existing option/value handlers. */
export function UiSelect({ value, onChange, children, disabled, className = '', id, title, name, 'aria-label': label }: {
  value?: string | number; onChange: (event: SelectChange) => void; children: ReactNode; disabled?: boolean;
  className?: string; id?: string; title?: string; name?: string; 'aria-label'?: string;
}) {
  const inherited = useContext(DisabledControls);
  const options = Children.toArray(children).filter(isValidElement<OptionProps>);
  const hasEmpty = options.some(option => selectOptionValue(option) === '');
  const selected = String(value ?? '');
  return <Select.Root value={!selected && hasEmpty ? EMPTY_VALUE : selected} onValueChange={next => onChange({ target: { value: next === EMPTY_VALUE ? '' : next } })} disabled={disabled || inherited || !options.length} name={name}>
    <Select.Trigger className={'ui-select ' + className} id={id} title={title} aria-label={label}>
      <Select.Value placeholder="请选择" />
      <Select.Icon className="ui-select-caret"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content className="ui-select-menu" position="popper" sideOffset={6} collisionPadding={12}>
      <Select.ScrollUpButton className="ui-select-scroll" aria-label="向上滚动">⌃</Select.ScrollUpButton>
      <Select.Viewport className="ui-select-options">{options.map((option, index) => {
        const optionValue = selectOptionValue(option);
        return <Select.Item key={optionValue || index} value={optionValue || EMPTY_VALUE} disabled={option.props.disabled} className="ui-select-option">
          <Select.ItemIndicator className="ui-select-check">✓</Select.ItemIndicator><Select.ItemText>{option.props.children}</Select.ItemText>
        </Select.Item>;
      })}</Select.Viewport>
      <Select.ScrollDownButton className="ui-select-scroll" aria-label="向下滚动">⌄</Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>;
}
