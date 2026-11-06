/**
 * 这个文件放交易页筛选栏用的一个带标题的下拉框。
 * 有哪些选项、选了之后怎么筛，由交易页自己定。
 * 没有特别的决定。
 */
"use client";

/**
 * 这个组件画一个上面带标题的下拉框。
 * 用户选了一项，就把那一项的值交给 `onChange`。
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}>) {
  return (
    <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
      {label}
      <select
        className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
