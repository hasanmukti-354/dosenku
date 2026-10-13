import { describe, expect, it } from "vitest";
import { readSupabasePublicEnv } from "./env";

describe("readSupabasePublicEnv", () => {
  it("mengembalikan url dan key yang sudah di-trim", () => {
    expect(
      readSupabasePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: " https://abc.supabase.co ",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      }),
    ).toEqual({ url: "https://abc.supabase.co", publishableKey: "sb_publishable_x" });
  });

  it("menyebut semua env yang belum diisi", () => {
    expect(() => readSupabasePublicEnv({})).toThrow(
      "Env belum diisi: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("menganggap string berisi spasi sebagai belum diisi", () => {
    expect(() =>
      readSupabasePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "   ",
      }),
    ).toThrow("Env belum diisi: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  });
});
