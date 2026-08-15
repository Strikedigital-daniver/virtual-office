interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
  errorCode?: string;
  errorDescription?: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiJson(
  path: string,
  options: { ticket?: string; body?: unknown } = {},
): Promise<unknown> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.ticket) headers.set("Authorization", `Bearer ${options.ticket}`);
  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {}),
  });
  const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      data?.error?.message ??
        data?.errorDescription ??
        data?.error?.code ??
        data?.errorCode ??
        `${response.status} ${response.statusText}`,
    );
  }
  return data;
}
