/**
 * Encryption helper for sensitive data (e.g., OpenAI API keys).
 * 
 * Uses Node's built-in crypto module with AES-256-GCM.
 */

import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // For GCM, this is 12, but we'll use 16 for compatibility
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get encryption key from environment variable.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ONBOARDING_SECRET;
  if (!secret) {
    throw new Error(
      "ONBOARDING_SECRET environment variable is not set. " +
      "Please set it to a secure random string (at least 32 characters)."
    );
  }

  // Derive a 32-byte key from the secret using SHA-256
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext string.
 * 
 * @param plain Plaintext to encrypt
 * @returns Encrypted string (base64 encoded, format: iv:salt:tag:ciphertext)
 */
export function encryptSecret(plain: string): string {
  if (!plain || typeof plain !== "string") {
    throw new Error("Plaintext must be a non-empty string");
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const salt = randomBytes(SALT_LENGTH);

  // Derive key from secret + salt
  const derivedKey = pbkdf2Sync(key, salt, 100000, KEY_LENGTH, "sha512");

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  
  let encrypted = cipher.update(plain, "utf8", "base64");
  encrypted += cipher.final("base64");
  
  const tag = cipher.getAuthTag();

  // Combine iv:salt:tag:encrypted
  return `${iv.toString("base64")}:${salt.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypt an encrypted string.
 * 
 * @param cipher Encrypted string (format: iv:salt:tag:ciphertext)
 * @returns Decrypted plaintext
 */
export function decryptSecret(cipher: string): string {
  if (!cipher || typeof cipher !== "string") {
    throw new Error("Ciphertext must be a non-empty string");
  }

  const parts = cipher.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid ciphertext format. Expected format: iv:salt:tag:ciphertext");
  }

  const [ivBase64, saltBase64, tagBase64, encrypted] = parts;

  const key = getEncryptionKey();
  const iv = Buffer.from(ivBase64, "base64");
  const salt = Buffer.from(saltBase64, "base64");
  const tag = Buffer.from(tagBase64, "base64");

  // Derive key from secret + salt (same as encryption)
  const derivedKey = pbkdf2Sync(key, salt, 100000, KEY_LENGTH, "sha512");

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

