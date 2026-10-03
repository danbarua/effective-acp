# effective-acp

The Agent Client Protocol on Effect 4. What is built, and its rules, is in `src/MODEL.md`; where
Effect fits and where it does not, in `src/EFFECT-FIT.md`. `README.md` lists the modules.

## Commands

- `bun run check`: typecheck, lint, every rule has a test (`check:rules`), and tests. Run it before
  committing.
- `bun run acp:schema`: regenerate `src/schema/*.gen.ts` from the installed SDK's JSON Schemas. Do not
  edit the generated files by hand.
- Don't pipe `bun test`: redirect its output to a file under `logs/` and read the file. Run commands
  whose output goes to a file with `FORCE_COLOR=0 NO_COLOR=1`.

## Rules

- `effect` is a peer dependency: the library imports `effect` and nothing else at run time. The
  ACP SDK is for tests and the generator only.
- Each rule in `src/MODEL.md` has an id, and at least one test whose name starts with it.

## Effect source

`node_modules/effect/src` is the source of the installed version; start at its `index.ts`. Effect's
repository at the installed version's tag (`effect@<version>` on GitHub) has the tests and docs.
