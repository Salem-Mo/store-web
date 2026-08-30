import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

// scrypt hash format: scrypt$<salt_hex>$<hash_hex>$<N_log>  (N=16384, r=8, p=1)
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPin(pin: string, stored: string): boolean {
  try {
    if (!stored?.startsWith('scrypt$')) {
      // legacy fallback: compare plaintext (for migration only) then rehash upstream
      return false
    }
    const [, salt, hashHex] = stored.split('$')
    if (!salt || !hashHex) return false
    const derived = scryptSync(pin, salt, 64).toString('hex')
    const a = Buffer.from(hashHex, 'hex')
    const b = Buffer.from(derived, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function isStrongPin(pin: string): boolean {
  if (!pin || pin.length < 6) return false
  if (/^(0+|1+|123456|000000)$/.test(pin)) return false
  return true
}
