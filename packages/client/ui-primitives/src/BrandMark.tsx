import type { IconProps } from './icons/props.ts'

/** Product name displayed by the temporary wordmark. */
export const BRAND_NAME = 'Merforge'

/** Native dimensions of the replaceable Merforge mark. */
export const BRAND_MARK_VIEWBOX = { width: 24, height: 24 }

/** Filled M artwork shared by the mark and wordmark. */
export const BRAND_MARK_PATH = 'M3 20V4h3l6 8 6-8h3v16h-4V10l-5 7-5-7v10Z'

/**
 * Render the temporary Merforge M mark using the surrounding text color.
 * @param props.size - square size in pixels; defaults to 24.
 * @param props.className - class supplied by the owning surface.
 * @returns decorative SVG; pair with product text for accessibility.
 */
export function BrandMark({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={BRAND_MARK_PATH} fill="currentColor" />
    </svg>
  )
}
