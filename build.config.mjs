import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/providers/macos.ts",
        "./src/providers/edge-tts.ts",
        "./src/providers/google-tts.ts",
        "./src/providers/piper.ts",
        "./src/providers/browser.ts",
        "./src/cli/index.ts",
      ],
    },
  ],
});
