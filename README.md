# html2json

Converts HTML into a JSON tree **without a DOM parser**: a single-pass, index-based tokenizer plus a tree builder with an explicit stack. There is no recursion, so nesting depth is limited by memory, not by the call stack.

The goals, in order: never crash, behave like a browser on well-formed *and* malformed HTML, and keep every deviation small and documented ([Limitations](#limitations-and-deviations-from-browsers)).

```js
const { html2json } = require("./html2json.js"); // in a browser: the global html2json()

html2json('<p class="intro">Hi <b>there</b></p>');
```

## Quick start

| What                | How                                                                                                                                                                                                                                                                       |
|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Try it in a browser | Open `index.html`. **If the page opens but the sample picker is empty, the browser did not load the script files from disk. Serve the folder instead:** run `python3 -m http.server 8000` in this folder and open `http://localhost:8000` (any static file server works). |
| Run the tests       | `npm test` (the same as `node --test`). Needs Node 20 or newer; there are no dependencies to install.                                                                                                                                                                     |
| Use the parser      | Load `html2json.js` with a `<script>` tag (it defines the global `html2json`), or `require` it in Node.                                                                                                                                                                   |

The page uses plain `<script>` tags, with no modules and no build step, so any static file server is enough. The page itself is described in [The demo page](#the-demo-page).

## Repository structure

```
.
├── index.html                  The demo page: pick or paste HTML and see the JSON
├── html2json.js                The parser. No DOM code and no dependencies; runs in browsers and in Node
├── app.js                      The demo page's logic
├── samples.js                  The sample inputs for the page's picker (73, in 12 groups; the large ones are generated)
├── package.json                Only provides `npm test`; there are no dependencies
├── README.md                   This file
├── html_samples/               The same samples as plain files, one per group (see its own README.md)
│   ├── README.md
│   ├── 01-basics.html
│   ├── 02-elements.html
│   ├── 03-attributes.html
│   ├── 04-raw-text.html
│   ├── 05-foreign-content-svg-math.html
│   ├── 06-tree-repair.html
│   ├── 07-junk-and-stray-brackets.html
│   ├── 08-special-constructs.html
│   ├── 09-truncated-input.html
│   ├── 10-input-edge-cases.html
│   └── 11-maxdepth-option.html
└── tests/                      Run by `npm test`; see Testing
    ├── helpers.js              Shared helpers (not a test file, so the runner skips it)
    ├── html2json.test.js       Expected-output tests, one block per feature
    ├── robustness.test.js      Truncation sweeps, fuzzing, pathological and large inputs
    ├── app.test.js             The page logic and the samples
    └── html-samples.test.js    Keeps html_samples/ in sync with samples.js
```

## API

```js
html2json(htmlText, options = {}) // -> { type: "document", children: [...] }
```

- `htmlText`: the HTML string. A non-string value returns an empty document.
- `options.maxDepth` (optional): limits how deeply elements may nest. The default is no limit. See [Depth limit](#depth-limit).
- **It never throws.** If an internal error ever happens, it is logged with `console.error` and an empty document is returned, never a partial tree.
- It returns a plain object, not a JSON string. Pass it to `JSON.stringify` yourself.

## Output format

### Node types

Every node has a `type`. There are five:

| `type`     | Fields                          | Notes                                                                                    |
|------------|---------------------------------|------------------------------------------------------------------------------------------|
| `document` | `children`                      | Synthetic root, always returned.                                                         |
| `element`  | `tag`, `attributes`, `children` | `tag` is lowercase. `attributes` is an object of strings. `children` is always an array. |
| `text`     | `content`                       | Never empty. Adjacent text is merged into one node.                                      |
| `comment`  | `content`                       | The text between `<!--` and `-->`.                                                       |
| `doctype`  | `content`                       | The text after `<!doctype`, trimmed, case preserved (for example `"html"`).              |

### Example

```js
html2json('<!DOCTYPE html><p class="intro">Hi <b>there</b></p><!-- end -->')
```
```json
{
  "type": "document",
  "children": [
    { "type": "doctype", "content": "html" },
    {
      "type": "element",
      "tag": "p",
      "attributes": { "class": "intro" },
      "children": [
        { "type": "text", "content": "Hi " },
        {
          "type": "element",
          "tag": "b",
          "attributes": {},
          "children": [{ "type": "text", "content": "there" }]
        }
      ]
    },
    { "type": "comment", "content": " end " }
  ]
}
```

### Why this shape

- **A `type` on every node (a discriminated union).** A consumer switches on one field and never has to guess what a node is by checking `typeof node === "string"` or which fields exist. Text is not a special case, and comments and doctype fit without changing the schema. The alternative, plain strings in `children`, is more compact but cannot represent comments and makes every consumer branch on the child's JavaScript type.
- **A synthetic `document` root.** HTML fragments have several top-level nodes (`<p>a</p><p>b</p>`), and a full page has a doctype next to `<html>`. A single root element cannot hold that. A `document` root gives a stable return type and a natural base level for the stack.
- **Comments and doctype are kept.** The goal is a faithful representation. Dropping them later is a one-line filter; recovering them is impossible.
- **`children` is always an array.** Void elements (`<br>`, `<img>`) simply have an empty one, so consumers never null-check.
- **`attributes` is a plain object of strings.** It is the natural JSON form and gives O(1) lookup by name.
  - The object is built safely: duplicates are detected with `Object.hasOwn`, and a `__proto__` attribute is defined with `Object.defineProperty`, so it becomes an ordinary own property and nothing is polluted. The result is identical to what `JSON.parse` would produce, so strict equality checks in test frameworks work normally.
- **Whitespace-only text nodes are preserved.** In `<b>a</b> <i>b</i>` the single space is meaningful. Pretty-printed HTML produces many noise nodes, but filtering them later is trivial and recovering them is not. Whitespace inside content is never trimmed either.
- **Entities are not decoded.** `&amp;` stays `&amp;` in text and in attribute values. Parsing never depends on decoding (an `&lt;` is not a tag, and `&quot;` cannot end a quoted value), so there is no entity table to maintain, and decoding is lossy (`&nbsp;` and a space become indistinguishable). The output is the source, as written.
- **Tag and attribute names are lowercased, values are not.** Names are normalized because correct matching depends on it (`</DIV>` closes `<div>`). Lowercasing is ASCII-only, as in browsers. Values are content and are preserved exactly.

## Parsing rules

Each rule is stated once, here. [How it works](#how-it-works) describes the mechanism that implements them.

### Preprocessing

- A single leading BOM (U+FEFF) is stripped.
- `\r\n` and a lone `\r` become `\n`, as in the HTML specification, so platform line endings do not leak into text.
- Empty input gives an empty document. Whitespace-only input gives one whitespace text node, a direct consequence of preserving whitespace.

### Markup after a less-than sign

| Input                                                                    | Meaning                                                        |
|--------------------------------------------------------------------------|----------------------------------------------------------------|
| `<` + letter                                                             | start tag                                                      |
| `</` + letter                                                            | end tag                                                        |
| `<!--`                                                                   | comment (see [Comments and doctype](#comments-and-doctype))    |
| `<!doctype` (any case)                                                   | doctype (see [Comments and doctype](#comments-and-doctype))    |
| `<![CDATA[`                                                              | dropped, through `]]>` (so an inner `>` does not leak as text) |
| other `<!…`, `<?…`, `</` + non-letter                                    | dropped, through the next `>`                                  |
| anything else (`a < b`, `<<`, `<3`, `<>`, a lone `<` or `</` at the end) | literal text                                                   |

So `<<<div>>>` is the text `<<`, a `div`, and the text `>>`.

### Elements

- **Void elements** always have `children: []`: `area, base, br, col, embed, hr, img, input, link, meta, source, track, wbr`.
- **`/>`** is ignored on ordinary elements, as in HTML: `<div/>` opens a div. It is honored on `svg`, `math` and everything inside them, so `<svg><path/><circle/></svg>` gives siblings.
- **Raw text elements** are `script`, `style`, `textarea` and `title`. Their content is not parsed as markup and becomes a single text child (or none if empty). It ends at a case-insensitive `</name` followed by whitespace, `/` or `>`. Inside `svg` and `math` these four are ordinary elements, so `<svg><title>a<b>c</b></title></svg>` parses the `b`.

### Attributes

- Values can be double-quoted, single-quoted or unquoted. An unquoted value ends at whitespace or `>`, and a `/` inside it belongs to the value (`href=foo/>` has the value `foo/`).
- A valueless attribute (`<input disabled>`) is `""`. HTML itself treats `disabled` and `disabled=""` as identical, and a boolean would make the value type `string | boolean`.
- A duplicate attribute keeps the **first** value, as browsers do, so there is nothing else to preserve. Names are compared after lowercasing, so `ID` and `id` are the same attribute.
- Spaces around `=` are tolerated (`a = "b"`), and attributes may follow a closing quote without whitespace (`a="1"b="2"`).
- **Garbage is skipped.** Where an attribute name is expected, a `=` or a quote cannot start one. The parser skips any run of `=`, then either a quoted string or a run-up to whitespace or `>`, and carries on. So `<div "x" =foo id=1>` keeps `id`.
- Attributes on closing tags are ignored.

### Comments and doctype

- A comment ends at the first `-->` or `--!>`. `<!-->` and `<!--->` are empty comments, and `<!--a--->` has the content `a-`.
- A doctype's content runs to the first `>`, is trimmed, and keeps its case. It is kept wherever it appears.

### Closing tags and tree repair

- A closing tag closes the nearest open element with the same name, and implicitly closes everything opened after it: `<div><span></div>` closes the `span` too.
- A closing tag with no open element of that name is ignored (`</div>text`).
- Two exceptions, as in browsers: a stray `</br>` becomes a `br` element, and a stray `</p>` (no open `p`) becomes an empty `p`. The closing tags of other void elements (`</img>`) are ignored.

### Optional end tags

HTML lets authors omit some end tags. This parser implements a small, deliberate subset. Only the **top of the stack** is checked, and each rule closes at most one element:

| Incoming start tag                                                                                                                                            | Closes first, if it is on top |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| `li`                                                                                                                                                          | `li`                          |
| `dt`, `dd`                                                                                                                                                    | `dt` or `dd`                  |
| `option`                                                                                                                                                      | `option`                      |
| `td`, `th`                                                                                                                                                    | `td` or `th`                  |
| `tr`                                                                                                                                                          | `td` or `th`, then `tr`       |
| `p`, and the block tags `address, article, aside, blockquote, div, dl, fieldset, footer, form, h1`–`h6`, `header, hr, main, nav, ol, pre, section, table, ul` | `p`                           |

So `<ul><li>a<li>b</ul>` gives two sibling items, and `<p>one<p>two<div>x</div>` gives three siblings. Because only the top is checked, legitimate nesting is kept: in `<li>a<ul><li>b</ul>` the inner `li` nests inside the `ul`.

### Depth limit

`options.maxDepth` limits how deeply elements may nest. The default is no limit.

- Depth is the number of open elements, not counting the `document`.
- An element that would be nested deeper is not parsed. Parsing stops, and **the rest of the input, from that tag's `<` on, is kept as one text node** inside the current parent. Nothing is lost, only the structure. The text is the source exactly as written, apart from [preprocessing](#preprocessing).
- Void elements and self-closed `svg`/`math` elements are never pushed, so they never trigger the limit. The [optional end-tag rules](#optional-end-tags) run first, so `<p>a<div>` fits within `maxDepth: 1`.
- A start tag that is unfinished at the end of the input is dropped by the [truncation rule](#truncated-input) before the limit is checked.
- Invalid values (non-number, `NaN`, negative) mean no limit. A fractional value works as its ceiling.

### Truncated input

One rule, matching browsers: **a construct that never finished its opening syntax is dropped; content that already started is kept.**

| At the end of the input                                              | Result                                                   |
|----------------------------------------------------------------------|----------------------------------------------------------|
| `<div`, `<div class="a`, `</div` (an unfinished tag)                 | dropped, along with the rest; the text before it is kept |
| unterminated CDATA, `<?`, `<!foo`                                    | dropped                                                  |
| `<!-- never closed`                                                  | kept as a comment, content to the end                    |
| `<!DOCTYPE html`                                                     | kept as a doctype                                        |
| `<script>…` (and `style`, `textarea`, `title`) without a closing tag | kept, content to the end as a text child                 |
| elements still open                                                  | closed implicitly, children kept                         |
| a lone `<` or `</`                                                   | text                                                     |

## Examples

**Messy input.** `<<div id="a" id='b' hidden>x < y</p>` gives (compact notation):

```
document
├─ text "<"                       the first < starts no tag, so it is text
└─ div { id: "a", hidden: "" }    the duplicate id is ignored; the valueless attribute is ""
   ├─ text "x < y"                a stray < stays in the text
   └─ p { }                       a stray </p> creates an empty p
                                  (the unclosed div is closed at the end)
```

**`maxDepth`.** `html2json("<div><span><b>x</b></span></div>", { maxDepth: 2 })`:

```
document
└─ div
   └─ span
      └─ text "<b>x</b></span></div>"    the rest of the input, exactly as written
```

## How it works

This section describes the mechanism. The rules it implements are in [Parsing rules](#parsing-rules).

### Pipeline

```
html2json(input, options)
  1. validate the input, strip the BOM, normalize line endings      (Preprocessing)
  2. normalize the options                                          (Depth limit)
  3. tokenize(source, builder)    scans the string and reports tokens to the builder
  4. return builder.root
```

All of it runs inside a `try/catch` (see [API](#api)). The **tokenizer** knows nothing about the tree. The **tree builder** owns the stack and never sees raw HTML syntax. The tokenizer calls `builder.text`, `comment`, `doctype`, `startTag` and `endTag`, and the builder answers a start tag with a signal: continue, enter raw text, or stop (the depth limit).

### Tokenizer

It works at the level of whole constructs, not single characters: plain text, comments, raw text and so on are each covered by one `indexOf` jump. Character-by-character states are used only inside tags, where the attribute syntax needs them.

- **DATA state.** Jump to the next `<` and look at the character after it (`classify`, which implements the table in [Markup after a less-than sign](#markup-after-a-less-than-sign)). A `<` that starts no construct stays in the pending text run. Otherwise, the pending text is flushed, so text before a dropped construct is never lost, and the construct is read.
- **Readers.** Each reader (tag, comment, doctype, bogus construct, raw text) returns the position after what it consumed, or `-1` if the construct was unfinished at the end of the input, which drops it along with the rest of the input (see [Truncated input](#truncated-input)).
- **Raw text** is read by searching for `</` with `indexOf` and comparing the following characters to the tag name one by one, case-insensitively, so the input is never lowercased or copied. The terminator itself is left for the normal tag path.

### Attribute state machine

It runs inside a tag, after the tag name. Closing tags run the same machine and discard the result, so `</div class=">">` finds its true end.

| State        | Reads                                | Does                                                                                                     |
|--------------|--------------------------------------|----------------------------------------------------------------------------------------------------------|
| BEFORE_NAME  | whitespace                           | skips                                                                                                    |
|              | `/`                                  | skips; a `/` directly before `>` marks the tag self-closing (used as described in [Elements](#elements)) |
|              | `>`                                  | ends the tag                                                                                             |
|              | `=` or a quote                       | skips one garbage token (the rule is in [Attributes](#attributes))                                       |
|              | anything else                        | starts ATTR_NAME                                                                                         |
| ATTR_NAME    | up to whitespace, `/`, `>` or `=`    | lowercases the name, goes to AFTER_NAME                                                                  |
| AFTER_NAME   | skips whitespace, then looks for `=` | `=` goes to BEFORE_VALUE; otherwise records a valueless attribute and goes back to BEFORE_NAME           |
| BEFORE_VALUE | skips whitespace                     | a quote starts QUOTED; `>` records an empty value and ends the tag; anything else starts UNQUOTED        |
| QUOTED       | `indexOf(quote)`                     | records the slice and goes back to BEFORE_NAME                                                           |
| UNQUOTED     | up to whitespace or `>`              | records the slice and goes back to BEFORE_NAME                                                           |

### Tree builder

State: the `root` (the `document` node), a `stack` of open elements, a `counts` map (tag name to how many of that name are open), and `foreignOpen` (how many `svg`/`math` elements are open). Everything goes through two primitives, `push` and `pop`, so the counters cannot drift.

**Start tag**, in this order:
1. Apply the [optional end-tag rules](#optional-end-tags): a table maps the incoming tag to an ordered list of tag-name sets, and each set pops the top of the stack if it belongs to it.
2. Decide whether the element will be pushed: void elements and `/>` on `svg`/`math` content are leaves (see [Elements](#elements)).
3. Before it would be pushed beyond `maxDepth`, stop (see [Depth limit](#depth-limit)).
4. Append the element to the top of the stack, and push it unless it is a leaf.
5. Signal "raw text follows" if it is a raw text element and no `svg`/`math` is open (`foreignOpen` is 0).

**End tag.** The behavior is in [Closing tags and tree repair](#closing-tags-and-tree-repair). Mechanically, the `counts` map answers "is anything with this name open?" in O(1); if so, the builder pops until the matching element has been popped.

**Text** is appended to the current parent, extending the last child if that is already a text node. That is how adjacent text is merged, including across dropped constructs (`a<?x>b` gives `"ab"`).

### Why a stack, and why no recursion

Nesting is the same problem as matching parentheses: the most recently opened element is the first to close, so a stack is the natural structure. A recursive-descent parser would make the call stack the limit, and a few thousand nested elements would crash it. With an explicit stack, depth is limited only by memory (a 100,000-level input parses fine).

### Complexity and robustness

- **Linear time.** The tokenizer only moves forward. Text, comments, quoted values and raw text are found with `indexOf`; `slice` is used only to extract final values; text runs are tracked as start and end indexes and cut once. Each element is pushed once and popped once.
- **No quadratic traps.** Thanks to the `counts` map, 100,000 stray closing tags cost one lookup each, not a scan of the stack. The only regular expressions are the line-ending normalization (`\r\n?`) and ASCII lowercasing (`[A-Z]+`), and neither can backtrack catastrophically.
- **Guaranteed progress.** Every loop iteration consumes at least one character, so no input can make the parser loop forever.

## Limitations and deviations from browsers

All of these change only the *shape* of the tree for unusual input. None of them can cause a crash.

**Deep trees and recursive consumers.** The parser builds a 100,000-level tree without trouble, but `JSON.stringify`, deep-equal helpers in test frameworks, and any recursive traversal can overflow the engine's call stack on a tree that deep. The safe depth depends on the engine, its stack size and even how warm the JIT is: on the development machine `JSON.stringify` failed at roughly 2,100 nested elements in both Node 22 and Chromium, so do not rely on more than about a thousand. The demo page catches this and says so. If you need output that is safe for recursive consumers, pass `{ maxDepth: N }` (see [Depth limit](#depth-limit)): nothing is lost, because the remainder is kept as text.

**Not a full HTML5 tree builder.** Out of scope:
- Implied `html`, `head`, `body` and `tbody` elements (`<p>hi</p>` stays a single `p`).
- Misnested formatting elements (the "adoption agency" algorithm): in `<b><i></b></i>` the stray `</i>` is ignored, and formatting is not re-opened across paragraphs.
- Foster parenting (stray content inside tables stays where it is).
- Case-sensitive SVG names: everything is lowercased, so `viewBox` becomes `viewbox`.
- `<template>` content fragments (it is an ordinary element) and `<plaintext>`.
- Raw-text treatment of `iframe`, `xmp`, `noembed`, `noframes` and `noscript`. Only the four elements listed in [Elements](#elements) are raw text.
- A browser drops one leading newline right after `<pre>`, `<textarea>` and `<listing>`; here it is preserved.

**Optional end tags are a subset.** Because the [rules](#optional-end-tags) check only the top of the stack, `<li>a<b>bold<li>b` still nests the second `li` inside the `b`, and `<p>a<span>b<p>c` nests the second `p` in the `span`.

**Closing tags have no scope boundaries.** `</div>` closes the nearest open `div` even across a `table`, where browsers would ignore it. A stray `</p>` looks at the whole stack, not just the "button scope" of the HTML specification.

**An unclosed quote swallows markup.** In `<div id="3647></div><span class="x">`, the value of `id` runs to the next `"`, exactly as in browsers. A heuristic recovery would break valid input such as `title="<b>"`.

**Foreign content is simplified.** `/>` is honored, and raw text is switched off, whenever an `svg` or `math` element is open anywhere in the stack. Integration points such as `foreignObject` are not special-cased.

**CDATA, processing instructions (`<?xml ?>`) and bogus `<!foo>` are dropped,** where browsers turn them into comments. A lone `<!` at the end of the input is dropped too.

## Testing

```
npm test
```

It runs 307 tests with Node 20 or newer and no dependencies. The run time depends on the machine but on average it's 2-5 seconds.

- **`tests/html2json.test.js`**: expected-output tests for every rule in [Parsing rules](#parsing-rules), in the order the features were built: input handling, tags and nesting, attributes, special constructs, raw text and foreign content, optional end tags and `maxDepth`. Each area also has scale cases (100k-deep nesting, 200k siblings, 100k attributes on one tag, 100k stray closing tags).
- **`tests/robustness.test.js`**: checks the parser on input nobody wrote by hand.
  - A table of every truncation case, and **every prefix and every suffix** of two realistic documents (also under tight `maxDepth` limits).
  - **Seeded fuzzing**: two generators (random tokens and random characters), 20,000 inputs each, with random `maxDepth` values. It also checks that `\n`, `\r\n` and `\r` line endings give identical results and that parsing is deterministic.
  - 17 pathological or large inputs, each with a time limit: a million `<`, tags that never end, 100k mismatched closers, 100k-deep `<svg>`, a 4 MB realistic document.
- **`tests/app.test.js`**: the page logic and the samples. Every sample must parse into a valid tree, and the stress samples' labels must be true (the "too deep" sample really fails to serialize; the limited one does not).
- **`tests/html-samples.test.js`**: the files in `html_samples/` must match `samples.js` exactly and be valid inputs, and in the "one input" files no sample may swallow another. After changing `samples.js`, regenerate the files with `WRITE_HTML_SAMPLES=1 npm test`.
- **`tests/helpers.js`** holds two helpers used by the other test files:
  - `checkInvariants` validates every output: exact node shapes, lowercase tags, string-only attribute values on normal prototypes, no empty or adjacent text nodes, void elements without children, and the `maxDepth` bounds. It is iterative, so it works on 100k-deep trees.
  - `strictParser` fails a test if the parser's safety net fired. Without it, the `try/catch` that makes the parser crash-proof would also hide bugs behind an empty document and let tests pass.

The robustness tests were also run against deliberately broken versions of the parser (text that never merges, an exception thrown on long comments, tag names not lowercased) to confirm that they fail when they should.

## The demo page

Open it as described in [Quick start](#quick-start); if the sample picker is empty, serve the folder over HTTP.

- **Sample picker:** a grouped dropdown (Basics, Elements, Attributes, Raw text, Foreign content, Tree repair, Junk and stray brackets, Special constructs, Truncated input, Input edge cases, maxDepth option, Stress). **Prev/Next** step through all of them. Choosing a sample converts it immediately. Editing the input switches the picker to "Custom input".
- **Max depth:** an optional field. Empty means no limit. A sample can set it, and it is cleared for samples that do not.
- **Status line:** input size, node count and parse time, plus a note when `maxDepth` is active or the output was shortened.
- **The output area is read-only, not disabled,** so the JSON can be selected and copied.
- **Large and deep results are handled.** Output beyond 2,000,000 characters is truncated for display, with a notice and the full size in the status line. A tree too deep for `JSON.stringify` shows an explanation instead of failing. Both can be seen in the "Stress" samples; entering a Max depth (for example 100 on the 50,000-level sample) makes the deep one displayable.
- Conversion is on demand (the button, choosing a sample, or changing Max depth), not while typing, so huge inputs cannot freeze the page.