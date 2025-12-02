import React from "react";
import { WidgetProps } from "@rjsf/utils";

export const SafeTextareaWidget: React.FC<WidgetProps> = ({
  value = "",
  onChange,
  options,
  disabled,
  readonly,
  autofocus,
  placeholder,
  id,
  label,
  required,
  rawErrors,
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };

  return (
    <textarea
      id={id}
      value={value as string}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readonly}
      autoFocus={autofocus}
      onChange={handleChange}
      aria-label={label}
      aria-required={required}
      aria-invalid={Array.isArray(rawErrors) && rawErrors.length > 0}
      rows={(options as any)?.rows ?? 3}
    />
  );
};
