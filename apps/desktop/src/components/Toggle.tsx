import { useState } from "react";

export function Toggle({
  checked,
  disabled = false,
  onChange,
  ariaLabel,
}: {
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  ariaLabel?: string;
}) {
  const [internalChecked, setInternalChecked] = useState(false);
  const isControlled = checked !== undefined;
  const isChecked = isControlled ? checked : internalChecked;

  function handleToggle() {
    if (disabled) return;
    const nextChecked = !isChecked;
    if (!isControlled) setInternalChecked(nextChecked);
    onChange?.(nextChecked);
  }

  return <button type="button" className={`toggle${isChecked ? " on" : ""}`} onClick={handleToggle} role="switch" aria-checked={isChecked} aria-label={ariaLabel} disabled={disabled} />;
}
