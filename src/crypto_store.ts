import crypto from "crypto";
import os from "os";

/**
 * Derives a machine-unique 256-bit encryption key.
 *
 * The key is deterministically generated from stable hardware/OS identifiers:
 *   hostname + username + platform + cpu-model
 *
 * SHA-256 is used here as a key-derivation function (KDF) to produce a
 * consistent 32-byte key. The key is never stored — it is regenerated on
 * every launch from the same machine context.
 *
 * Actual encryption uses AES-256-GCM (authenticated encryption).
 */
function deriveMachineKey(): Buffer {
    const cpuModel = os.cpus()[0]?.model || "unknown-cpu";
    const fingerprint = [
        os.hostname(),
        os.userInfo().username,
        process.platform,
        cpuModel,
        // Fixed app salt — prevents cross-app key reuse
        "agent-cli-v1-salt-7f2a9c",
    ].join("|");

    return crypto.createHash("sha256").update(fingerprint, "utf8").digest();
}

const MACHINE_KEY = deriveMachineKey();
const ENC_PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a prefixed base64 string: "enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encryptSecret(plaintext: string): string {
    if (!plaintext) return plaintext;
    // Already encrypted — don't double-encrypt
    if (plaintext.startsWith(ENC_PREFIX)) return plaintext;

    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv(ALGORITHM, MACHINE_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
    return ENC_PREFIX + Buffer.from(payload).toString("base64");
}

/**
 * Decrypts a value previously encrypted by encryptSecret().
 * Falls through gracefully for legacy plaintext values.
 */
export function decryptSecret(value: string): string {
    if (!value) return value;
    // Legacy plaintext — return as-is (will be re-encrypted on next save)
    if (!value.startsWith(ENC_PREFIX)) return value;

    try {
        const encoded = value.slice(ENC_PREFIX.length);
        const payload = Buffer.from(encoded, "base64").toString("utf8");
        const [ivHex, tagHex, cipherHex] = payload.split(":");
        if (!ivHex || !tagHex || !cipherHex) return "";

        const iv = Buffer.from(ivHex, "hex");
        const tag = Buffer.from(tagHex, "hex");
        const ciphertext = Buffer.from(cipherHex, "hex");

        const decipher = crypto.createDecipheriv(ALGORITHM, MACHINE_KEY, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
        // Decryption failed — key mismatch or corrupted value
        return "";
    }
}

/**
 * Returns true if the value is an encrypted secret (already processed).
 */
export function isEncrypted(value: string): boolean {
    return typeof value === "string" && value.startsWith(ENC_PREFIX);
}
