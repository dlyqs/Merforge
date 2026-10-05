/** Secure native credential storage supplied by the Desktop main process. */
/** Electron safeStorage adapter supplied only by the main-process composition. */
export interface OrganizationCredentialVault {
  /** Whether encryption is available using the OS credential vault. */
  isEncryptionAvailable(): boolean
  /** Linux basic_text is never accepted; other platforms return their secure backend name. */
  getSelectedStorageBackend(): string
  /**
   * Encrypt credentials using the unlocked OS vault.
   * @param text - Native credential envelope.
   * @returns Ciphertext safe for owner-only local persistence.
   */
  encryptString(text: string): Buffer
  /**
   * Decrypt local material; a locked or unavailable vault must throw.
   * @param bytes - Previously encrypted local envelope.
   * @returns Native-only plaintext envelope.
   */
  decryptString(bytes: Buffer): string
}
