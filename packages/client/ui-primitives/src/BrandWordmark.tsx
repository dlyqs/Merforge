import type { IconProps } from './icons/props.ts'
import { BRAND_MARK_PATH, BRAND_NAME } from './BrandMark.tsx'

/** Display options for the Merforge wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading M mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the temporary Merforge wordmark.
 * @param props.size - height in pixels; defaults to 24.
 * @param props.className - class supplied by the owning surface.
 * @param props.includeMark - whether to include the leading M mark.
 * @returns decorative SVG with a system-font product name.
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 142 : 114
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 142 24' : '28 0 114 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && <path d={BRAND_MARK_PATH} fill="currentColor" />}
      <text x="28" y="18" fill="currentColor" fontFamily="system-ui, sans-serif" fontSize="21" fontWeight="600">{BRAND_NAME}</text>
    </svg>
  )
}
