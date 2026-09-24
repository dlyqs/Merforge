/** Render one English persistence document for deterministic artifact checks. */

/** One repository-relative generated file and its complete UTF-8 content. */
export interface PersistenceArtifact {
  readonly path: string
  readonly content: string
}

/**
 * Return the current English reference document.
 * @param _root - checkout root retained for existing generator callers.
 * @param source - repository-relative document path.
 * @param en - complete English Markdown.
 * @param _zh - deprecated translation input retained for existing generator callers.
 * @returns the English document artifact.
 */
export function renderPersistencePair(_root: string, source: string, en: string, _zh: string): PersistenceArtifact[] {
  return [{ path: source, content: en }]
}
