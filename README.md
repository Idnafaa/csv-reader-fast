# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Idnafaa/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Idnafaa/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A dependency-free CSV reader (`solve.js`, with `main.ts` as the harness driver) that returns exactly what
csv-reader 1.0.0 returns for every `{text, header}` input — the same `columns`, `rows` and broken-row
`errors` — while reading several times faster. It makes one left-to-right pass over char codes: plain fields
are scanned to the next comma, LF or CR and cut out with a single slice; quoted fields find their closing
quote by jumping quote to quote with `indexOf`, then count lines and fold CR/CRLF to LF (and undouble
quotes) in one walk, staying a single slice when nothing needs folding. Stray CRs, junk after a closing
quote, quotes that never close, blank and stray-CR-only lines, and short/long rows all follow the reference
policy, in the reference error order.

Validation: differential testing against csv-reader 1.0.0 on about 270,000 generated cases — exhaustive
short strings over quotes, CR, LF and commas, random character soup, structured broken rows, and mutations
of the practice files — plus the kit's six practice cases, all identical. On the practice set locally it
reads roughly 5–7× faster than the reference.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=01tnmm85&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
