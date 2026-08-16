# Review Workspace Performance Fixtures

These fixtures are generated at test runtime by
`tests/e2e/support/reviewPerformanceFixture.ts` so the performance suite has no
network dependency and does not carry large checked-in test data.

The helper creates deterministic Git repositories with:

- 50, 500, or 1000 modified small text files under `small-files/`
- one tracked `z-large-diff.txt` file with a deterministic 2 MiB text change,
  exercising Main's capped large-patch detection without making that file the
  initially selected diff

The Playwright metrics JSON is a reproducible renderer-side performance artifact.
It records data observable from the fixture, renderer DOM, and browser performance
timeline:

- `schemaVersion`
- SHA-256 of the complete deterministic `git diff --no-ext-diff` output
- expected fixture shape
- rendered review DOM file block count
- user-action durations measured by the test harness
- Review `performance.measure` durations
- Review React commit markers
- long-task count, maximum duration, count over 200 ms, and total blocking time
  during the five-second scroll sample

It does not directly report Main-process snapshot IPC timing, whole-process CPU,
or memory usage. Those require separate Main-process or operating-system
instrumentation.

The DOM file-block count is the currently rendered review-window count. The
test hard-limits it to 60, so it stays independent of the number of changed
files after scrolling or other interactions.
