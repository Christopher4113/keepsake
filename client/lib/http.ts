// Error shape shared with docs/api-writes.yaml and docs/api-reads.yaml: { error: { code, message } }.
const STATUS = { bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409 } as const;
export type ErrorCode = keyof typeof STATUS;

export const apiError = (code: ErrorCode, message: string) =>
  Response.json({ error: { code, message } }, { status: STATUS[code] });
