# Fennlo v0

A local generative visual explanation product. One question becomes a concise, point-by-point explanation with a generated image for each point, inside one stable full-screen interface.

Requires Node.js 22.13+ and npm (tested with Node 22.20).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. Production mode:

```sh
npm run build
npm start
```

Copy `.env.example` to `.env` and configure `GEMINI_API_KEY` to enable native generation. The default model is `gemini-3.1-flash-lite-image`; `GEMINI_MODEL`, `GEMINI_IMAGE_SIZE`, `GEMINI_ASPECT_RATIO`, and `FENNLO_MAX_POINTS` are configurable. The default is at most 3 essential images, at 1K, in a single request with TEXT + IMAGE output. The default Lite model supports 1K only. There are no automatic retries, search, stock images, auxiliary paid calls, audio or video generation. Keys stay server-side.

Without a Gemini key, **Development preview** uses authored text examples and clearly marked, non-AI image placeholders. It exercises the same provider → artifact → experience → UI path. These placeholders are deliberately not topic pictures and cannot establish live model accuracy or image quality. The live Gemini adapter has been tested with mocked native API responses; a real key is needed for end-to-end generation verification.

Try these questions through the same input:

- Why do seasons happen?
- How does a CPU execute an instruction?
- How does DNA replication work?

Select a supporting point to bring its image and explanation into focus. Text is native, selectable HTML; mobile uses a scrollable layout. Saved experience URLs reopen in the same anonymous browser session. SQLite records and filesystem artifacts in `data/` survive restart.

The original Owner, VisitorSession, Artifact, Experience and ExperienceNode layers remain intact. `server/providers/gemini.ts` makes one bounded native request and validates interleaved point/image pairs. `server/application/` persists each image through ArtifactService, records content type and provenance, grants access to its originating visitor, then completes the experience. Binary image data never enters React props or ordinary database fields. Failed partial writes are cleaned up. `src/runtime/` interprets validated nodes; the new explanation renderer has no topic-specific frontend code. Existing scene, audio, video and OpenAI adapter infrastructure is retained for compatibility but is dormant in the normal v0 flow.

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

Tests cover native-response parsing, one-call limits, malformed output, private image delivery, artifact rollback, SQLite persistence, a real server process restart, three unrelated question flows, mobile rendering, and the retained legacy media runtime. Browser checks use installed Chrome and an isolated server on port 3001, forced into development mode. The restart test uses port 3002.

Provider contract: [Gemini image generation](https://ai.google.dev/gemini-api/docs/generate-content/image-generation), [configured model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image). The native image model does not support structured JSON output schemas; Fennlo requests simple tagged metadata before each image and validates the result without an extra repair call. If images or point metadata are missing, the experience fails safely rather than displaying a mismatched answer.
