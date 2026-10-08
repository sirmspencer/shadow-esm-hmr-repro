# shadow-cljs: hot reload fails for npm dependencies that ship ES modules

*Written with LLM assistance.*

Hot reload of any npm dependency whose output is an ES module fails with
`TypeError: Cannot redefine property: <exportName>`. The recompile succeeds, then
applying it in the browser throws, so the page silently keeps serving the previous
version.

Reproduced on shadow-cljs 3.5.3. The relevant code is unchanged on master
(3.5.5 at time of writing).

## Layout

This reproduction is two repositories, mirroring the common setup of a TypeScript
library consumed by a ClojureScript application.

| Repo | Role |
|---|---|
| `min-component-library` | TypeScript library, emits ESM with named exports |
| `shadow-esm-hmr-repro` | shadow-cljs `:target :browser` app that consumes it |

## Prerequisites

- Java 11 or newer
- Clojure CLI (`clojure`)
- Node.js and npm

## Setup

The application links the library by relative path, so the two repositories must be
cloned as siblings in the same parent directory.

```sh
git clone https://github.com/sirmspencer/min-component-library.git
git clone https://github.com/sirmspencer/shadow-esm-hmr-repro.git
```

Build the library:

```sh
cd min-component-library
npm install
npm run build          # tsc, emits build/index.js as ESM
```

Install and start the application:

```sh
cd ../shadow-esm-hmr-repro
npm install            # links ../min-component-library
npm run build:watch
```

Wait for `[:app] Build completed.`, then open http://localhost:9411

The npm scripts wrap the Clojure CLI rather than calling the `shadow-cljs` binary, so
that `deps.edn` stays the single source of the shadow-cljs version. That is what makes
the `:local` override below work without a second, possibly conflicting version pinned
in `package.json`.

| Script | Purpose |
|---|---|
| `npm run build:watch` | watch build against the released shadow-cljs in `deps.edn` |
| `npm run build:watch:local` | same, but against a local shadow-cljs checkout |
| `npm run build:release` | release build |
| `npm run clear-cache` | remove `.shadow-cljs` and `public/js` |

The page shows `v1`.

## Reproduce

With the watch still running and the page open:

1. In `min-component-library/src/index.ts`, change `label` from `"v1"` to `"v2"`

2. Rebuild the library:

   ```sh
   cd min-component-library && npx tsc
   ```

3. Bump the library's `package.json` modification time:

   ```sh
   touch min-component-library/package.json
   ```

   This step is required. `shadow.cljs.devtools.server.reload-npm` only invalidates a
   dependency's files when that package's `package.json` modification time changes, so
   editing JavaScript alone is never noticed. The poller runs on a two second delay.

### Expected

The page updates to `v2`.

### Actual

The page still shows `v1`. shadow-cljs reports a successful recompile, and the browser
console reports:

```
TypeError: Cannot redefine property: describe
Failed to load repro/core.cljs TypeError: Cannot redefine property: describe
reload-failed Error: Failed to load repro/core.cljs: Cannot redefine property: describe
```

### Automated

`probe.js` performs all three steps against a headless browser and prints the verdict:

```sh
cd shadow-esm-hmr-repro
npm install playwright && npx playwright install chromium
node probe.js v2
```

## Cause

`ShadowESModuleRewriter.addExport` builds each export as

```java
IR.objectlit(
        IR.stringKey("enumerable", IR.trueNode()), IR.stringKey("get", getterFunction));
```

`Object.defineProperties` defaults `configurable` to `false`, so every named export
becomes permanently non-redefinable. The generated wrapper:

```js
shadow$provide.module$node_modules$$ms$min_component_library$build$index =
  function(require, module, exports) {
    Object.defineProperties(exports, {__esModule:{enumerable:!0, value:!0},
      describe:{enumerable:!0, get:function() { return describe; }},
      label:{enumerable:!0, get:function() { return "v1"; }}});
  };
```

Hot reload re-runs that factory against the same `exports` object, and redefining a
non-configurable property throws. The semantics in isolation:

```js
const a = {};
Object.defineProperties(a, {X: {enumerable: true, get: () => 1}});
Object.defineProperties(a, {X: {enumerable: true, get: () => 2}});
// TypeError: Cannot redefine property: X
```

## Fix

Add `configurable: true` to the generated descriptor. With that change this
reproduction hot reloads correctly and repeatedly, with no console errors.

`__esModule` does not need changing. It is a data property redefined with an identical
descriptor, which the specification permits as a no-op, which is why the error always
names a real export rather than `__esModule`.

## Verifying a local fix

`deps.edn` carries a `:local` alias that swaps in a local shadow-cljs checkout. Point it
at your checkout, then:

```sh
cd <shadow-cljs checkout>
lein javac                 # required: tools.deps does not compile shadow-cljs's Java sources

cd <shadow-esm-hmr-repro>
npm run build:watch:local
```

shadow-cljs's own `deps.edn` expects the compiled classes in `target/classes`, which is
why `lein javac` is needed before a `:local/root` dependency will work.
