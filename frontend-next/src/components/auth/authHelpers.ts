export type AuthFieldErrors<T extends string> = Partial<Record<T, string>>;
export type AuthErrorContext = "generic" | "login" | "signup" | "resend";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PATTERNS = [
  "security purposes",
  "rate limit",
  "too many requests",
  "over_email_send_rate_limit",
  "email rate limit",
  "over request rate limit",
  "429"
];
const ALREADY_REGISTERED_PATTERNS = [
  "already registered",
  "already been registered",
  "user already registered",
  "email address already",
  "email_exists",
  "user_already_exists"
];

type JsonRecord = Record<string, unknown>;

export type AuthErrorDiagnostics = {
  status: number | null;
  code: string | null;
  name: string | null;
  message: string;
  body: unknown;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null;

const readStringField = (record: JsonRecord, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
};

const readNumberField = (record: JsonRecord, keys: string[]): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
};

export function parseAuthError(error: unknown): AuthErrorDiagnostics {
  if (typeof error === "string") {
    return {
      status: null,
      code: null,
      name: null,
      message: error,
      body: null
    };
  }

  if (!isRecord(error)) {
    return {
      status: null,
      code: null,
      name: null,
      message: "Erro desconhecido de autenticacao.",
      body: null
    };
  }

  const status = readNumberField(error, ["status", "statusCode"]);
  const code = readStringField(error, ["code", "error_code", "errorCode"]);
  const name = readStringField(error, ["name"]);
  const message =
    readStringField(error, ["message", "msg", "error_description"]) ??
    "Erro desconhecido de autenticacao.";

  const response = isRecord(error.response) ? error.response : null;
  const body =
    error.body ??
    response?.body ??
    response?.data ??
    response?.error ??
    (isRecord(error.cause) ? error.cause : null);

  return {
    status,
    code,
    name,
    message,
    body
  };
}

const matchesAnyPattern = (value: string, patterns: readonly string[]) =>
  patterns.some((pattern) => value.includes(pattern));

export function isRateLimitAuthError(error: unknown): boolean {
  const parsed = parseAuthError(error);
  const normalizedMessage = parsed.message.toLowerCase();
  const normalizedCode = (parsed.code ?? "").toLowerCase();
  return (
    parsed.status === 429 ||
    matchesAnyPattern(normalizedMessage, RATE_LIMIT_PATTERNS) ||
    matchesAnyPattern(normalizedCode, RATE_LIMIT_PATTERNS)
  );
}

export function logAuthErrorDiagnostics(
  context: string,
  error: unknown,
  extra?: JsonRecord
) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const parsed = parseAuthError(error);

  console.error(`[auth][${context}] supabase error`, {
    status: parsed.status,
    code: parsed.code,
    name: parsed.name,
    message: parsed.message,
    body: parsed.body,
    raw: error,
    ...extra
  });
}

export function validateEmail(value: string): string | null {
  const normalized = value.trim();

  if (!normalized) {
    return "Informe seu email.";
  }

  if (!EMAIL_REGEX.test(normalized)) {
    return "Digite um email valido.";
  }

  return null;
}

export function validatePassword(
  value: string,
  minimumLength = 6
): string | null {
  if (!value) {
    return "Informe sua senha.";
  }

  if (value.length < minimumLength) {
    return `A senha deve ter pelo menos ${minimumLength} caracteres.`;
  }

  return null;
}

export function validateFullName(value: string): string | null {
  const normalized = value.trim();

  if (!normalized) {
    return "Informe seu nome completo.";
  }

  if (normalized.length < 3) {
    return "Digite pelo menos 3 caracteres.";
  }

  if (!normalized.includes(" ")) {
    return "Digite nome e sobrenome.";
  }

  return null;
}

export function mapAuthErrorMessage(
  error: unknown,
  context: AuthErrorContext = "generic"
): string {
  const parsed = parseAuthError(error);
  const normalized = parsed.message.toLowerCase();
  const normalizedCode = (parsed.code ?? "").toLowerCase();
  const codeOrMessage = `${normalizedCode} ${normalized}`.trim();

  if (
    normalized.includes("invalid login") ||
    normalized.includes("invalid credentials")
  ) {
    return "Email ou senha invalidos.";
  }

  if (matchesAnyPattern(codeOrMessage, ALREADY_REGISTERED_PATTERNS)) {
    return "E-mail ja cadastrado. Va em Entrar ou Esqueci meu acesso.";
  }

  if (
    normalized.includes("password") &&
    (normalized.includes("weak") ||
      normalized.includes("at least") ||
      normalized.includes("least"))
  ) {
    return "Senha fraca. Use pelo menos 6 caracteres.";
  }

  if (isRateLimitAuthError(parsed)) {
    if (context === "resend") {
      return "Aguarde cerca de 60s para reenviar.";
    }
    if (context === "signup") {
      return "Aguarde cerca de 60s antes de tentar criar a conta novamente.";
    }
    if (context === "login") {
      return "Muitas tentativas de login. Aguarde alguns segundos e tente novamente.";
    }
    return "Muitas tentativas. Aguarde alguns segundos e tente novamente.";
  }

  if (normalized.includes("invalid email")) {
    return "Digite um e-mail valido.";
  }

  if (normalized.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }

  return parsed.message || "Nao foi possivel concluir a solicitacao.";
}

export function focusFirstInvalidField<T extends string>(
  form: HTMLFormElement | null,
  errors: AuthFieldErrors<T>,
  orderedFields: readonly T[]
) {
  if (!form) {
    return;
  }

  const firstFieldWithError = orderedFields.find((field) =>
    Boolean(errors[field])
  );

  if (!firstFieldWithError) {
    return;
  }

  const field = form.querySelector<HTMLInputElement>(
    `[name="${String(firstFieldWithError)}"]`
  );

  field?.focus();
}
