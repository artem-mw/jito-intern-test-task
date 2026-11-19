# html_samples

The HTML inputs used to test `html2json`, as plain files you can open, read and paste into `index.html`. There is one file per sample group, and the same samples are in the page's picker (`samples.js`).

| File                               | Group                       | Samples | How to use it                                  |
|------------------------------------|-----------------------------|---------|------------------------------------------------|
| `01-basics.html`                   | Basics                      | 6       | one input                                      |
| `02-elements.html`                 | Elements                    | 5       | one input                                      |
| `03-attributes.html`               | Attributes                  | 9       | one input                                      |
| `04-raw-text.html`                 | Raw text                    | 7       | one input                                      |
| `05-foreign-content-svg-math.html` | Foreign content (svg, math) | 4       | one input                                      |
| `06-tree-repair.html`              | Tree repair                 | 11      | independent cases                              |
| `07-junk-and-stray-brackets.html`  | Junk and stray brackets     | 4       | one input                                      |
| `08-special-constructs.html`       | Special constructs          | 6       | one input                                      |
| `09-truncated-input.html`          | Truncated input             | 8       | independent cases                              |
| `10-input-edge-cases.html`         | Input edge cases            | 2 of 3  | one input, starts with a BOM                   |
| `11-maxdepth-option.html`          | maxDepth option             | 3       | independent cases, each with its own Max depth |

## File format

Each sample is preceded by a delimiter line:

```
<!-- ===== Label of the sample ===== -->
...the sample, exactly as in samples.js...
```

A single sample is everything between one delimiter line and the next. Each file also starts with a comment that says how to use it. (The delimiter and header lines are ordinary HTML comments, so they stay out of the way when a file is pasted as an input.)

**"One input"** files can be pasted whole: their samples are all self-contained, so converting the file converts every sample at once and none affects another. A sample that leaves an element open (`<<<div>>>`, in the junk group) is placed last so that it cannot swallow the others.

**"Independent cases"** files cannot be pasted whole, because the samples would interfere. Some deliberately leave elements open (`<div><p>one<span>two`), every truncation sample ends in the middle of a construct, and each `maxDepth` sample needs its own value in the **Max depth** field (the delimiter line gives it, for example `[Max depth: 2]`). Paste one case at a time. For the truncated ones, copy the sample without the line break after it, because the sample must be the very end of the input.

## What is not stored as a file

- **Stress samples** (50,000-level nesting, a 1.5 MB document, 5,000 attributes on one tag, 100,000 stray closing tags, ...). They are generated on demand by `samples.js` and can be loaded from the "Stress" group of the picker. Some would be over a megabyte.
- **The empty-input sample.** It is the empty string, so there is no text to store. It is the first item of "Input edge cases" in the picker and is covered by the tests.

`10-input-edge-cases.html` is special: the bytes themselves are the sample. It starts with a real byte order mark (which the parser strips) followed by `<p>text</p>` and a whitespace-only text (`"   \n\t  "`), so it has no header comment.

## Keeping the files in sync

The files are generated from `samples.js`, and `tests/html-samples.test.js` fails if they ever differ. To regenerate them after changing `samples.js`:

```
WRITE_HTML_SAMPLES=1 npm test
```