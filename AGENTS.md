# Project workflow

- The user requested on 2026-10-25 that `main` be the unified working branch and source of truth.
- Start by checking the working tree, current branch, and all local and remote branch tips. Do not infer project progress from the current checkout alone.
- Work on `main` by default. Do not create or continue a feature branch unless the user explicitly requests one or an isolated investigation requires it; bring completed, verified changes back to `main`.
- Preserve uncommitted user work. Never reset or force-push shared history. Do not delete branches without the user's request.
- Fetch remote updates before integrating or pushing. If `main` has advanced, reconcile changes and rerun relevant checks before pushing.
- Use Node 22 for the existing test suite. Run the relevant tests and both frontend builds when editing shared editor or Shopify widget code. A frontend build does not validate Shopify Function WASM, deployment, or checkout end to end.
- Report the resulting commit and distinguish local changes, remote pushes, and production deployments.
