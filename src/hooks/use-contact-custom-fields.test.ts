import { afterEach, describe, expect, it, vi } from "vitest";

// Mirrors the Supabase-mock convention in src/lib/auth/account.test.ts:
// mock the client module, hand back a chainable fake, assert on captured
// calls. This hook's write path (writeCustomFieldValue) is a plain async
// function with no React dependency, so it's testable directly — no
// renderHook/jsdom needed (this repo's vitest.config.ts runs with
// environment: "node").

interface BuilderCall {
  table: string;
  method: "upsert" | "delete" | null;
  upsertArgs?: [Record<string, unknown>, Record<string, unknown> | undefined];
  eqArgs: [string, unknown][];
}

function makeClient(opts: { error?: { message: string } | null } = {}) {
  const calls: BuilderCall[] = [];

  function from(table: string) {
    const call: BuilderCall = { table, method: null, eqArgs: [] };
    const builder = {
      upsert(row: Record<string, unknown>, options?: Record<string, unknown>) {
        call.method = "upsert";
        call.upsertArgs = [row, options];
        return builder;
      },
      delete() {
        call.method = "delete";
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      then(
        resolve: (value: { error: unknown }) => void,
        reject: (reason: unknown) => void,
      ) {
        calls.push(call);
        Promise.resolve({ error: opts.error ?? null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return { calls, client: { from } };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => createClient(),
}));

const { writeCustomFieldValue } = await import("./use-contact-custom-fields");

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeCustomFieldValue", () => {
  it("upserts a trimmed non-empty value on the (contact_id, custom_field_id) key", async () => {
    const { client, calls } = makeClient();
    createClient.mockReturnValue(client);

    const ok = await writeCustomFieldValue("contact-1", "field-1", "  כן  ");

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: "contact_custom_values",
      method: "upsert",
      upsertArgs: [
        { contact_id: "contact-1", custom_field_id: "field-1", value: "כן" },
        { onConflict: "contact_id,custom_field_id" },
      ],
    });
  });

  it("deletes the row when the value is empty or whitespace-only", async () => {
    const { client, calls } = makeClient();
    createClient.mockReturnValue(client);

    const ok = await writeCustomFieldValue("contact-1", "field-1", "   ");

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: "contact_custom_values",
      method: "delete",
      eqArgs: [
        ["contact_id", "contact-1"],
        ["custom_field_id", "field-1"],
      ],
    });
  });

  it("returns false when the upsert fails", async () => {
    const { client } = makeClient({ error: { message: "denied" } });
    createClient.mockReturnValue(client);

    const ok = await writeCustomFieldValue("contact-1", "field-1", "value");

    expect(ok).toBe(false);
  });

  it("returns false when the delete fails", async () => {
    const { client } = makeClient({ error: { message: "denied" } });
    createClient.mockReturnValue(client);

    const ok = await writeCustomFieldValue("contact-1", "field-1", "");

    expect(ok).toBe(false);
  });
});
