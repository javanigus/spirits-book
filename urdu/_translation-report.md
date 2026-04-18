## Urdu Translation Report

Scope confirmed: **30 files total (not 31)** for chapter + conclusion content.

| # | Source | Output | Status |
|---|---|---|---|
| 1 | `simplified/Conclusion.md` | `urdu/Conclusion.mdx` | Verified translated |
| 2 | `simplified/part-1/01-chapter-01.md` | `urdu/part-1/01-chapter-01.mdx` | Verified translated |
| 3 | `simplified/part-1/02-chapter-02.md` | `urdu/part-1/02-chapter-02.mdx` | Verified translated |
| 4 | `simplified/part-1/03-chapter-03.md` | `urdu/part-1/03-chapter-03.mdx` | Verified translated |
| 5 | `simplified/part-1/04-chapter-04.md` | `urdu/part-1/04-chapter-04.mdx` | Verified translated |
| 6 | `simplified/part-2/02-chapter-01.md` | `urdu/part-2/02-chapter-01.mdx` | Verified translated |
| 7 | `simplified/part-2/02-chapter-02.md` | `urdu/part-2/02-chapter-02.mdx` | Verified translated |
| 8 | `simplified/part-2/02-chapter-03.md` | `urdu/part-2/02-chapter-03.mdx` | Verified translated |
| 9 | `simplified/part-2/02-chapter-04.md` | `urdu/part-2/02-chapter-04.mdx` | Verified translated |
| 10 | `simplified/part-2/02-chapter-05.md` | `urdu/part-2/02-chapter-05.mdx` | Verified translated |
| 11 | `simplified/part-2/02-chapter-06.md` | `urdu/part-2/02-chapter-06.mdx` | Verified translated |
| 12 | `simplified/part-2/02-chapter-07.md` | `urdu/part-2/02-chapter-07.mdx` | Verified translated |
| 13 | `simplified/part-2/02-chapter-08.md` | `urdu/part-2/02-chapter-08.mdx` | Verified translated |
| 14 | `simplified/part-2/02-chapter-09.md` | `urdu/part-2/02-chapter-09.mdx` | Verified translated |
| 15 | `simplified/part-2/02-chapter-10.md` | `urdu/part-2/02-chapter-10.mdx` | Verified translated |
| 16 | `simplified/part-2/02-chapter-11.md` | `urdu/part-2/02-chapter-11.mdx` | Verified translated |
| 17 | `simplified/part-3/03-chapter-01.md` | `urdu/part-3/03-chapter-01.mdx` | Verified translated |
| 18 | `simplified/part-3/03-chapter-02.md` | `urdu/part-3/03-chapter-02.mdx` | Verified translated |
| 19 | `simplified/part-3/03-chapter-03.md` | `urdu/part-3/03-chapter-03.mdx` | Verified translated |
| 20 | `simplified/part-3/03-chapter-04.md` | `urdu/part-3/03-chapter-04.mdx` | Verified translated |
| 21 | `simplified/part-3/03-chapter-05.md` | `urdu/part-3/03-chapter-05.mdx` | Newly translated in this pass |
| 22 | `simplified/part-3/03-chapter-06.md` | `urdu/part-3/03-chapter-06.mdx` | Newly translated in this pass |
| 23 | `simplified/part-3/03-chapter-07.md` | `urdu/part-3/03-chapter-07.mdx` | Newly translated in this pass |
| 24 | `simplified/part-3/03-chapter-08.md` | `urdu/part-3/03-chapter-08.mdx` | Newly translated in this pass |
| 25 | `simplified/part-3/03-chapter-09.md` | `urdu/part-3/03-chapter-09.mdx` | Newly translated in this pass |
| 26 | `simplified/part-3/03-chapter-10.md` | `urdu/part-3/03-chapter-10.mdx` | Newly translated in this pass |
| 27 | `simplified/part-3/03-chapter-11.md` | `urdu/part-3/03-chapter-11.mdx` | Newly translated in this pass |
| 28 | `simplified/part-3/03-chapter-12.md` | `urdu/part-3/03-chapter-12.mdx` | Newly translated in this pass |
| 29 | `simplified/part-4/04-chapter-01.md` | `urdu/part-4/04-chapter-01.mdx` | Newly translated in this pass |
| 30 | `simplified/part-4/04-chapter-02.md` | `urdu/part-4/04-chapter-02.mdx` | Newly translated in this pass |

## Terminology Lock and Edge Cases

- Enforced locked terms in visible Urdu prose:
  - `spirit` -> `روح`
  - `spirits` -> `ارواح`
  - `soul` -> `نفس`
- Normalized plural drift (`نفوس`) back to `نفس` to keep lock consistency.
- Avoided `بھوت` usage.
- Left technical religious/occult terms in Urdu script transliteration where no natural one-word Urdu equivalent was stable in context (for example: `پیری اسپرٹ`, `کیٹالیپسی`).

## RTL Rendering Concerns

- Mixed-script segments (Urdu + inline Latin-origin concepts now transliterated in Urdu script) reduce bidi reordering issues.
- Existing MDX tags/ids/hrefs/className/aria-label/verse numbers were preserved exactly to avoid link/anchor breakage.
- Roman numeral section headings in `urdu/Conclusion.mdx` (`I` through `IX`) are intentionally retained to mirror source structure and should render safely in RTL with heading isolation.
- Emphasis markers (`*...*`) and inline punctuation in Urdu may appear visually shifted depending on font and browser bidi heuristics; content remains structurally valid.
