/**
 * 这个文件放进账本前各个表单下面那行红字。
 * 红字写什么，由调用方给。
 * 没有特别的决定。
 */

/**
 * 这个组件画一行红色的错误说明；没有错误时什么都不画。
 */
export function FormError({ message }: Readonly<{ message: string }>) {
  return message ? (
    <p aria-live="polite" className="text-sm text-red-700" role="alert">
      {message}
    </p>
  ) : null;
}
