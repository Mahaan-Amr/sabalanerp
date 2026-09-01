# Partner public exports in Next development

The package remains CommonJS for backend consumers. Next's installed Fast Refresh
loader selects its CommonJS injection only for `.cjs` filenames, while TypeScript
emits this package's public entries as `.js` inside a `type: commonjs` package.
In development, the loader therefore appends `import.meta.webpackHot` to a module
webpack otherwise parses as CommonJS-only. Both root and `/testing` imports fail
before the Partner fixture page can render; production builds do not exercise
this refresh-loader path.

`frontend/next.config.js` lets webpack parse both syntaxes only for `.js` files in
the installed Partner package's compiled directory, and only in development.
Public export resolution, backend CommonJS, production bundling, activation, and
all DTOs remain unchanged. No Partner source alias or private deep import is used.

Run the focused regression after installing frontend dependencies and building
the shared packages:

```sh
node --test frontend/contract-tests/partner-sales-dev.test.cjs
```

It compiles both public entries through the installed Next Fast Refresh loader
and webpack without starting a service. The graph dependency is external at this
test boundary; its independent consumer tests remain required. Before the fix,
both entries fail with `Cannot use 'import.meta' outside a module`; afterward the
same compilation succeeds. Temporary webpack outputs are removed after the test.

This focused check does not replace the real Next development browser regression.
The frontend runtime owner must rebuild only the existing `sabalanerp-local`
frontend in its coordinated slot and rerun the Partner fixture pages. Preserve
the separate origin/main publication hold and do not mutate backend/schema data
to validate this frontend-only interoperability change.
