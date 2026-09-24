/** Artifacts written by persistence reference generators. */

/** One repository-relative generated file and its complete UTF-8 content. */
export interface PersistenceArtifact {
  readonly path: string
  readonly content: string
}

/**
 * Return the current English reference document.
 * @param source - repository-relative document path.
 * @param content - complete English Markdown.
 * @returns the document artifact.
 */
export function renderPersistenceDocument(source: string, content: string): PersistenceArtifact[] {
  return [{ path: source, content }]
}
