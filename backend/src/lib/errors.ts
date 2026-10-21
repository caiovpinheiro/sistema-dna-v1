export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function migrationRequired(missing: string[]): AppError {
  return new AppError(
    503,
    "MIGRACAO_PENDENTE",
    "A base ainda não tem as extensões da V1. Aplique as migrations propostas depois da aprovação.",
    { pendencias: missing },
  );
}
