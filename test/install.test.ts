import { describe, expect, it } from "vitest";
import { resolveMcpLauncher } from "../src/cli/_install.ts";

describe("resolveMcpLauncher", () => {
  it("does not pass -y to pnpx", () => {
    expect(resolveMcpLauncher("pnpx")).toEqual({
      command: "pnpx",
      args: ["voipi@latest", "mcp"],
    });
  });

  it("passes -y to npx", () => {
    expect(resolveMcpLauncher("npx")).toEqual({
      command: "npx",
      args: ["-y", "voipi@latest", "mcp"],
    });
  });
});
