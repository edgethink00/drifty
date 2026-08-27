import { describe, expect, it, vi } from "vitest";

import { fallbackDisplayName, saveOwnProfile } from "./profileService";

describe("profile display-name fallback", () => {
  it("prefers an explicitly saved account display name", () => {
    expect(fallbackDisplayName(
      "email-handle@example.com",
      "123e4567-e89b-12d3-a456-426614174000",
      { displayName: "  Public Name  ", full_name: "Provider Name" },
    )).toBe("Public Name");
  });

  it("uses the email handle before an implicit provider real name", () => {
    expect(fallbackDisplayName(
      "email-handle@example.com",
      "123e4567-e89b-12d3-a456-426614174000",
      { full_name: "Provider Name" },
    )).toBe("email-handle");
  });

  it("does not expose implicit provider real-name metadata", () => {
    expect(fallbackDisplayName(
      null,
      "123e4567-e89b-12d3-a456-426614174000",
      { name: "Provider Name" },
    )).toBe("member-lqwovz");
  });

  it("gives email-less accounts a stable non-brand alias without exposing the auth id", () => {
    const userId = "123e4567-e89b-12d3-a456-426614174000";
    const alias = fallbackDisplayName(null, userId);

    expect(alias).toBe("member-lqwovz");
    expect(alias).not.toContain(userId.slice(0, 6));
    expect(fallbackDisplayName()).toBe("member");
  });

  it("bounds account and email fallbacks to the profile schema limit", () => {
    expect(fallbackDisplayName(null, null, { displayName: "가".repeat(65) })).toHaveLength(64);
    expect(fallbackDisplayName(`${"a".repeat(65)}@example.com`)).toHaveLength(64);
  });

  it("resolves a blank profile name from the authenticated user at write time", async () => {
    const upsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            public_id: "profile-1",
            display_name: "email-handle",
            bio: "",
            avatar_url: "",
            website_url: "",
            github_url: "",
            linkedin_url: "",
            timezone: "UTC",
            is_public: true,
            updated_at: "2026-08-27T00:00:00.000Z",
          },
          error: null,
        }),
      }),
    });
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "123e4567-e89b-12d3-a456-426614174000",
              email: "email-handle@example.com",
              user_metadata: { full_name: "Provider Name" },
            },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({ upsert }),
      rpc: vi.fn(),
    } as unknown as NonNullable<Parameters<typeof saveOwnProfile>[1]>;

    const result = await saveOwnProfile({ display_name: "   ", timezone: "UTC" }, client);

    expect(result.success).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "email-handle" }),
      { onConflict: "user_id" },
    );
  });
});
