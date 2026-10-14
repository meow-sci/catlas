import type { ReactNode } from "react";
export function Field({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
}) {
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      <div className="number-input">
        <input
          aria-label={label}
          aria-invalid={
            !Number.isFinite(value) ||
            (min !== undefined && value < min) ||
            (max !== undefined && value > max)
          }
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            if (e.target.value !== "" && Number.isFinite(Number(e.target.value)))
              onChange(Number(e.target.value));
          }}
        />
        {unit && <em>{unit}</em>}
      </div>
    </label>
  );
}
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  unit = "",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="slider-field">
      <span>
        {label}
        <output>
          {Number(value.toFixed(3))}
          {unit}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <label className="field color-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <code>{value.toUpperCase()}</code>
      </div>
    </label>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: boolean;
  onChange: (b: boolean) => void;
  description?: string;
}) {
  return (
    <label className="toggle-field">
      <div>
        <span>{label}</span>
        {description && <small>{description}</small>}
      </div>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function Section({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <section className="control-section">
      <h3>{title}</h3>
      {description && <p className="section-description">{description}</p>}
      {children}
    </section>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
