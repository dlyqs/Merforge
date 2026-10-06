/** Shared background preview preserves complete source text in expandable sections. */

/**
 * Keep introductory sections visible while retaining later details for inline expansion.
 * @param text - Creator-owned plain text or Markdown background.
 * @returns Background and goal preview followed by optional remaining sections.
 */
export function sharedContextView(text: string): { preview: string; more: string } {
  const headings = [...text.matchAll(/^\s*(?:#{1,6}\s+)?(?:\d+[、.．]\s*)?(?:\*\*)?([^\n]+)$/gm)]
  const chinese = /^(决策|约束|限制|相关资源|资源|预期结果|交付|范围)(?:\*\*)?(?:\s*[:：]|\s*$)/
  const english = /^(Decisions|Constraints|Resources|Expected outcome|Deliverables|Scope)(?:\*\*)?(?:\s*:|\s*$)/i
  const split = headings.find(match => chinese.test(match[1] ?? '') || english.test(match[1] ?? ''))?.index
  if (split !== undefined && split > 0) return { preview: text.slice(0, split).trim(), more: text.slice(split).trim() }
  const paragraphs = text.split(/\n\s*\n/)
  return { preview: paragraphs.slice(0, 2).join('\n\n'), more: paragraphs.slice(2).join('\n\n') }
}
