export type AuthFieldErrors<T extends string> = Partial<Record<T, string>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function mapAuthErrorMessage(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login")) {
    return "Email ou senha invalidos.";
  }

  if (normalized.includes("already registered")) {
    return "Este email ja esta cadastrado.";
  }

  if (normalized.includes("password")) {
    return "Senha fraca. Use pelo menos 6 caracteres.";
  }

  if (normalized.includes("security purposes") || normalized.includes("rate limit")) {
    return "Aguarde alguns segundos antes de reenviar.";
  }

  return message;
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
