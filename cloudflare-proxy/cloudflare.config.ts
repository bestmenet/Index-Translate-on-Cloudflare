import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "index-translate-trancy",
		compatibilityDate: "2026-10-21",
		workersDev: true,
		previewUrls: false,
		observability: { enabled: true, headSamplingRate: 0.1, redactQueryString: true },
		entrypoint,
		env: {
			API_KEY: bindings.secret(),
		},
	},
});
