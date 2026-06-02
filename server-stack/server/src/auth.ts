import { randomBytes, timingSafeEqual } from 'crypto'
import type { NextFunction, Request, Response } from 'express'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface Session {
  username: string
  expiresAt: number
}

const sessions = new Map<string, Session>()

export function adminUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || 'admin'
}

export function adminPassword(): string | undefined {
  const p = process.env.ADMIN_PASSWORD?.trim()
  return p || undefined
}

function legacyApiKey(): string | undefined {
  const k = process.env.ADMIN_API_KEY?.trim()
  return k || undefined
}

export function isAuthConfigured(): boolean {
  return !!adminPassword() || !!legacyApiKey()
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = adminUsername()
  const expectedPass = adminPassword()
  if (!expectedPass) return false

  const userBuf = Buffer.from(username)
  const passBuf = Buffer.from(password)
  const expectedUserBuf = Buffer.from(expectedUser)
  const expectedPassBuf = Buffer.from(expectedPass)

  if (userBuf.length !== expectedUserBuf.length || passBuf.length !== expectedPassBuf.length) {
    return false
  }

  return (
    timingSafeEqual(userBuf, expectedUserBuf) &&
    timingSafeEqual(passBuf, expectedPassBuf)
  )
}

export function createSession(username: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + SESSION_TTL_MS
  sessions.set(token, { username, expiresAt })
  return { token, expiresAt }
}

export function revokeSession(token: string): void {
  sessions.delete(token)
}

function pruneExpired(): void {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token)
  }
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.authorization ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  return token || null
}

function isValidSession(token: string): Session | null {
  pruneExpired()
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(token)
    return null
  }
  return session
}

export function getSessionFromRequest(req: Request): Session | null {
  const token = bearerToken(req)
  if (!token) return null
  return isValidSession(token)
}

export function isAuthorizedRequest(req: Request): boolean {
  const token = bearerToken(req)
  if (!token) return false

  const apiKey = legacyApiKey()
  if (apiKey && token === apiKey) return true

  return isValidSession(token) !== null
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const password = adminPassword()
  const apiKey = legacyApiKey()

  if (!password && !apiKey) {
    next()
    return
  }

  if (isAuthorizedRequest(req)) {
    next()
    return
  }

  res.status(401).json({ error: 'Unauthorized' })
}
