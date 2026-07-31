export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
