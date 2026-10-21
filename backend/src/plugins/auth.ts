import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { hash, verify } from "@node-rs/argon2";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";

export type AuthUser = {
  sub: string;
  email: string;
  role: "admin";
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    verifyAdminPassword: (password: string) => Promise<boolean>;
  }
}

export async function registerAuth(app: FastifyInstance, config: AppConfig): Promise<void> {
  const passwordHash = config.ADMIN_PASSWORD_HASH || await hash(config.ADMIN_PASSWORD);
  if (!config.ADMIN_PASSWORD_HASH) {
    app.log.warn("Senha administrativa lida do ambiente e mantida apenas como hash em memória.");
  }
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: "8h" },
    cookie: { cookieName: "dnawork_session", signed: false },
  });
  app.decorate("verifyAdminPassword", async (password: string) => verify(passwordHash, password));
  app.decorate("authenticate", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, "NAO_AUTENTICADO", "Autenticação necessária.");
    }
    if (request.user.role !== "admin") {
      throw new AppError(403, "ACESSO_NEGADO", "Acesso negado.");
    }
  });
}

export function sessionCookie(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: config.COOKIE_SECURE,
    maxAge: 60 * 60 * 8,
  };
}
