import { APIErrorCode, APIResponseError } from '@notionhq/client';

/** Builds a Notion refusal in the form the SDK throws it: with a code and a status. */
export function notionAnswer(code: APIErrorCode, status: number): APIResponseError {
  return new APIResponseError({
    code,
    status,
    message: `Notion answered ${code}`,
    headers: {},
    rawBodyText: '{}',
    additional_data: undefined,
    request_id: undefined,
  });
}
