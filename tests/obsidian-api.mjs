let handler;
export function setRequestHandler(next) {
  handler = next;
}
export async function requestUrl(options) {
  if (!handler)
    throw new Error("Unexpected network request in an offline test");
  return handler(options);
}
