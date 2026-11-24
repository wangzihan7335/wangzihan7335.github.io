interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 34, className = '' }: BrandMarkProps) {
  return (
    <span
      className={`brand-mark ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" width={size} height={size} role="img">
        <path
          d="M10.5 39.5c-.7-12.4-.2-23.7.8-31"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
          opacity="0.28"
        />
        <path
          d="M12.5 39.2c8.4.4 16.8.3 24.7-.2"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
          opacity="0.28"
        />
        <path
          d="M15 36h6.8v-6.7h6.8v-6.7h6.8V15.8"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="37.3" cy="12.2" r="2" fill="#a74f38" />
      </svg>
    </span>
  );
}

export function BrandWordmark({ compact = false }: { compact?: boolean }) {
  if (compact) return null;
  return (
    <span className="brand-wordmark">
      <strong>拾阶</strong>
      <small>algorithm notes</small>
    </span>
  );
}
