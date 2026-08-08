interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * 品牌 Logo：浅蓝渐变圆角方块 + 白色单词卡图形（释义线一条浅蓝、一条橙色点缀）。
 * 与 public/favicon.svg、PWA 图标保持同一图形语言（单词卡 + 两条释义线）。
 */
export default function Logo({ size = 30, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="词忆"
    >
      <defs>
        <linearGradient id="wm-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#wm-logo-g)" />
      <rect x="14" y="12" width="36" height="40" rx="8" fill="#ffffff" />
      <rect x="21" y="23" width="22" height="4.5" rx="2.25" fill="#7dd3fc" />
      <rect x="21" y="33" width="22" height="4.5" rx="2.25" fill="#fb923c" />
    </svg>
  );
}
