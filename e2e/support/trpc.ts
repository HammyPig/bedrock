/**
 * A successful tRPC response body for a single procedure call.
 *
 * The client uses `httpBatchStreamLink`, whose body is newline-delimited JSON
 * describing a tree of resolved values by index rather than a plain envelope.
 * The frame layout below was captured from a real mutation; only the last line
 * carries the payload. If a tRPC upgrade changes the encoding, this function is
 * the single place to repair.
 */
export function trpcStreamResponse(data: unknown): string {
  return (
    [
      JSON.stringify({ json: { "0": [[0], [null, 0, 0]] } }),
      JSON.stringify({ json: [0, 0, [[{ result: 0 }], ["result", 0, 1]]] }),
      JSON.stringify({ json: [1, 0, [[{ data: 0 }], ["data", 0, 2]]] }),
      JSON.stringify({ json: [2, 0, [[data]]] }),
    ].join("\n") + "\n"
  );
}
