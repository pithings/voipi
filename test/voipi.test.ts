import { describe, expect, it } from "vitest";
import { VoiPi } from "../src/voipi.ts";
import { BaseVoiceProvider, type AudioData } from "../src/_provider.ts";

class StubProvider extends BaseVoiceProvider {
  name = "stub";
  async synthesize(): Promise<AudioData> {
    return { data: Buffer.alloc(0) };
  }
}

describe("VoiPi constructor — providers normalization", () => {
  const stub = () => new StubProvider();

  it("uses given factory when providers is set", async () => {
    const v = new VoiPi({ providers: [stub] });
    expect((await v.resolveProvider()).name).toBe("stub");
  });

  it("falls back to defaults when providers is undefined", () => {
    const v = new VoiPi();
    expect(v).toBeInstanceOf(VoiPi);
  });

  it("falls back to defaults when providers is empty", () => {
    const v = new VoiPi({ providers: [] });
    expect(v).toBeInstanceOf(VoiPi);
  });

  it("falls back to defaults when providers contains only nullish/empty/'auto'", () => {
    // @ts-expect-error — exercising runtime tolerance for invalid inputs
    const v = new VoiPi({ providers: ["", null, undefined, "auto"] });
    expect(v).toBeInstanceOf(VoiPi);
  });

  it("filters nullish/empty/'auto' entries but keeps valid ones", async () => {
    // @ts-expect-error — exercising runtime tolerance for invalid inputs
    const v = new VoiPi({ providers: ["", "auto", stub, null] });
    expect((await v.resolveProvider()).name).toBe("stub");
  });
});
