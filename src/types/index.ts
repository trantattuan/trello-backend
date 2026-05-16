import { FastifyRequest } from 'fastify'

export interface JwtPayload {
  sub: string
  email: string
  jti: string
}

export interface AuthRequest extends FastifyRequest {
  user: JwtPayload
}
