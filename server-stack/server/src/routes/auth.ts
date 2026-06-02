import { Router, Request, Response } from 'express'
import {
  adminUsername,
  adminPassword,
  createSession,
  getSessionFromRequest,
  isAuthConfigured,
  revokeSession,
  verifyCredentials
} from '../auth.js'

export function createAuthRouter(): Router {
  const router = Router()

  router.get('/session', (req: Request, res: Response) => {
    if (!isAuthConfigured()) {
      res.json({ authenticated: true, authRequired: false })
      return
    }

    const session = getSessionFromRequest(req)
    if (!session) {
      res.status(401).json({ authenticated: false, authRequired: true })
      return
    }

    res.json({
      authenticated: true,
      authRequired: true,
      username: session.username
    })
  })

  router.post('/login', (req: Request, res: Response) => {
    if (!adminPassword()) {
      res.status(503).json({ error: 'ADMIN_PASSWORD is not configured' })
      return
    }

    const body = req.body as { username?: string; password?: string }
    const username = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!verifyCredentials(username, password)) {
      res.status(401).json({ error: 'Invalid username or password' })
      return
    }

    const { token, expiresAt } = createSession(adminUsername())
    res.json({ token, expiresAt, username: adminUsername() })
  })

  router.post('/logout', (req: Request, res: Response) => {
    const auth = req.headers.authorization ?? ''
    if (auth.startsWith('Bearer ')) {
      revokeSession(auth.slice(7).trim())
    }
    res.json({ ok: true })
  })

  return router
}
