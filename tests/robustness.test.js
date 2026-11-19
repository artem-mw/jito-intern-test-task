"use strict";

/**
 * Robustness tests: truncation, invariants on every output, seeded fuzzing
 * and pathological inputs. Every parse here also asserts that html2json did
 * not hit its internal safety net (which would hide a bug behind an empty
 * document).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { strictParser, checkInvariants } = require("./helpers.js");

const doc = (...children) => ({ type: "document", children });
const text = (content) => ({ type: "text", content });
const comment = (content) => ({ type: "comment", content });
const doctype = (content) => ({ type: "doctype", content });
const el = (tag, children = [], attributes = {}) => ({ type: "element", tag, attributes, children });

/** Small deterministic PRNG, so a failing fuzz case can be reproduced. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* ---------------------------------------------------------------------- */
/* Truncation (contract §11)                                               */
/* ---------------------------------------------------------------------- */

describe("truncation at EOF", () => {
    const cases = [
        // unfinished tags are dropped, the text before them is kept
        ["<div", doc()],
        ["<div class=\"a", doc()],
        ["<div class='a", doc()],
        ["<div class=a", doc()],
        ["<div id=", doc()],
        ['<div id="', doc()],
        ["a<div class='a", doc(text("a"))],
        ["</div", doc()],
        ["<b>x</b", doc(el("b", [text("x")]))],
        // unterminated bogus constructs are dropped
        ["<![CDATA[ x", doc()],
        ["t<![CDATA[x", doc(text("t"))],
        ["<?xml", doc()],
        ["<!foo", doc()],
        // kept, with content to EOF
        ["<!-- never closed", doc(comment(" never closed"))],
        ["<!DOCTYPE html", doc(doctype("html"))],
        ["<script>a<b", doc(el("script", [text("a<b")]))],
        ["<style>x", doc(el("style", [text("x")]))],
        ["<textarea>y</p>", doc(el("textarea", [text("y</p>")]))],
        ["<title>z", doc(el("title", [text("z")]))],
        ["<script>x</script", doc(el("script", [text("x</script")]))],
        // open elements are closed implicitly, with their children kept
        ["<div><span>a", doc(el("div", [el("span", [text("a")])]))],
        ["<p>a<!--c", doc(el("p", [text("a"), comment("c")]))],
        // a lone < or </ is text
        ["<", doc(text("<"))],
        ["a<", doc(text("a<"))],
        ["</", doc(text("</"))],
    ];

    for (const [html, expected] of cases) {
        it(`handles ${JSON.stringify(html)}`, (t) => {
            const parse = strictParser(t);
            assert.deepEqual(parse(html), expected);
        });
    }
});

describe("every prefix and suffix of realistic documents", () => {
    const DOCS = {
        "task example": `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Sample HTML</title>
    <link rel="stylesheet" href="styles.css">
    <style>body > p { color: red; }</style>
</head>
<body>
    <!-- navigation -->
    <nav><ul>
        <li><a href="#home">Home</a></li>
        <li><a href='#about' class=nav>About</a></li>
    </ul></nav>
    <main><section id="home"><h2>Home</h2><p>The home &amp; about section.</p></section></main>
    <footer><p>&copy; 2024 My Website</p></footer>
    <script src="script.js">if (a < b && c > d) { x = "</p>"; }</script>
</body>
</html>
`,
        messy: `<<<div>>> a < b <p>one<p>two <ul><li>a<li>b</ul><table><tr><td>a<td>b<tr><td>c</table> <!-- c --><![CDATA[ x > y ]]><?xml v?><!foo> <svg><path d="M0 0"/><title>t<b>x</b></title></svg> <script>if (a < b) { x = "</div>"; }</script><textarea><b>&amp;</textarea> <a href=foo/ b = "c" d='e' disabled __proto__=1 "x" =y>t</a></br></p>\r\n<!--->x<!---->y<!--a--!>z`,
    };

    for (const [name, source] of Object.entries(DOCS)) {
        it(`parses every prefix of the ${name} without internal errors`, (t) => {
            const parse = strictParser(t);
            for (let i = 0; i <= source.length; i++) {
                checkInvariants(parse(source.slice(0, i)));
            }
        });

        it(`parses every suffix of the ${name} without internal errors`, (t) => {
            const parse = strictParser(t);
            for (let i = 0; i <= source.length; i++) {
                checkInvariants(parse(source.slice(i)));
            }
        });

        it(`parses every prefix of the ${name} under tight depth limits`, (t) => {
            const parse = strictParser(t);
            for (const maxDepth of [0, 1, 2, 3]) {
                for (let i = 0; i <= source.length; i += 3) {
                    checkInvariants(parse(source.slice(0, i), { maxDepth }), maxDepth);
                }
            }
        });
    }
});

/* ---------------------------------------------------------------------- */
/* Seeded fuzzing                                                          */
/* ---------------------------------------------------------------------- */

describe("fuzzing", () => {
    const CHUNKS = [
        "<", ">", "/", "!", "?", "-", "--", "=", '"', "'", "[", "]", " ", "\n", "\t",
        "\r", "\r\n", "\f", "a", "b", "x", "1", "é", "😀", "&amp;", "<!--", "-->",
        "--!>", "<![CDATA[", "]]>", "<!DOCTYPE html>", "<!doctype", "</", "<div",
        "<div>", "</div>", "<p>", "</p>", "<li>", "<ul>", "</ul>", "<br>", "</br>",
        "<br/>", "<script>", "</script>", "</SCRIPT", "<style>", "<title>",
        "<textarea>", "<svg>", "</svg>", "<svg/>", "<path/>", "<td>", "<tr>",
        "<table>", "<option>", "<dt>", "class=", "id=x", "__proto__=1",
        "constructor", "\uFEFF", "\0",
    ];
    const CHARS = `<>/!?-=\"' \n\r\tab[]`;
    const DEPTHS = [Infinity, undefined, 0, 1, 2, 3, 5];

    function randomFromChunks(random) {
        const count = 1 + Math.floor(random() * 60);
        let out = "";
        for (let i = 0; i < count; i++) out += CHUNKS[Math.floor(random() * CHUNKS.length)];
        return out;
    }

    function randomFromChars(random) {
        const count = Math.floor(random() * 80);
        let out = "";
        for (let i = 0; i < count; i++) out += CHARS[Math.floor(random() * CHARS.length)];
        return out;
    }

    for (const [name, generate, seed] of [
        ["token soup", randomFromChunks, 0xc0ffee],
        ["character soup", randomFromChars, 0xbadf00d],
    ]) {
        it(`never fails internally and always satisfies the invariants (${name})`, (t) => {
            const parse = strictParser(t);
            const random = mulberry32(seed);

            for (let i = 0; i < 20_000; i++) {
                const input = generate(random);
                const depth = DEPTHS[Math.floor(random() * DEPTHS.length)];
                const options = depth === undefined ? undefined : { maxDepth: depth };

                const result = parse(input, options);
                try {
                    checkInvariants(result, depth === undefined ? Infinity : depth);
                } catch (error) {
                    error.message += `\n  iteration ${i}, seed ${seed}, options ${JSON.stringify(options)}\n  input: ${JSON.stringify(input)}`;
                    throw error;
                }
            }
        });

        it(`gives the same result for \\n, \\r\\n and \\r line endings (${name})`, (t) => {
            const parse = strictParser(t);
            const random = mulberry32(seed + 1);

            for (let i = 0; i < 5_000; i++) {
                const input = generate(random).replace(/\r/g, "");
                const expected = JSON.stringify(parse(input));
                assert.equal(JSON.stringify(parse(input.replace(/\n/g, "\r\n"))), expected, JSON.stringify(input));
                assert.equal(JSON.stringify(parse(input.replace(/\n/g, "\r"))), expected, JSON.stringify(input));
            }
        });

        it(`is deterministic and does not mutate shared state between calls (${name})`, (t) => {
            const parse = strictParser(t);
            const random = mulberry32(seed + 2);
            for (let i = 0; i < 2_000; i++) {
                const input = generate(random);
                assert.equal(JSON.stringify(parse(input)), JSON.stringify(parse(input)));
            }
        });
    }
});

/* ---------------------------------------------------------------------- */
/* Pathological and large inputs                                           */
/* ---------------------------------------------------------------------- */

describe("pathological and large inputs", () => {
    const LIMIT_MS = 3000;

    const SAMPLE = `<div class="card" id=c1>
  <h2>Title &amp; more</h2>
  <p>Some <b>bold</b> and <i>italic</i> text<br>with a break.</p>
  <!-- a comment -->
  <ul><li>one<li>two<li>three</ul>
  <img src="a.png" alt='x' disabled>
</div>
`;

    const CASES = {
        "1M '<' characters": () => "<".repeat(1_000_000),
        "300k '<a ' (a tag that never ends)": () => "<a ".repeat(300_000),
        "100k '<!--' (unterminated comment full of dashes)": () => "<!--".repeat(100_000),
        "300k '<!' (bogus, never terminated)": () => "<!".repeat(300_000),
        "100k '<![CDATA[' (never terminated)": () => "<![CDATA[".repeat(100_000),
        "300k '</a ' (closing tag that never ends)": () => "</a ".repeat(300_000),
        "300k '<a b=\"' (alternating quotes)": () => '<a b="'.repeat(300_000),
        "100k '<a><b></a>' (mismatched closers)": () => "<a><b></a>".repeat(100_000),
        "100k '<a><b>' then 100k '</a>'": () => "<a><b>".repeat(100_000) + "</a>".repeat(100_000),
        "300k '-->' (stray terminators)": () => "-->".repeat(300_000),
        "300k '<p>' (flat siblings)": () => "<p>".repeat(300_000),
        "100k '<svg>' (deep foreign content)": () => "<svg>".repeat(100_000),
        "100k '<svg><title>x' (deep, no raw text)": () => "<svg><title>x".repeat(100_000),
        "100k '<br/>'": () => "<br/>".repeat(100_000),
        "2M spaces": () => " ".repeat(2_000_000),
        "500k text pieces split by ignored tags": () => "a</x>".repeat(500_000),
        "a 4 MB realistic document": () => SAMPLE.repeat(Math.ceil(4_000_000 / SAMPLE.length)),
    };

    for (const [name, build] of Object.entries(CASES)) {
        it(`finishes quickly on ${name}`, (t) => {
            const parse = strictParser(t);
            const input = build();

            const start = Date.now();
            const result = parse(input);
            const elapsed = Date.now() - start;

            assert.ok(elapsed < LIMIT_MS, `took ${elapsed} ms`);
            checkInvariants(result);
        });
    }

    it("merges 500k text pieces into a single text node", (t) => {
        const parse = strictParser(t);
        const result = parse("a</x>".repeat(500_000));
        assert.equal(result.children.length, 1);
        assert.equal(result.children[0].content.length, 500_000);
    });

    it("keeps the large realistic document's structure intact", (t) => {
        const parse = strictParser(t);
        const copies = 1000;
        const result = parse(SAMPLE.repeat(copies));
        // each copy: div + the whitespace text node after it
        assert.equal(result.children.length, copies * 2);
        assert.equal(result.children[0].tag, "div");
        assert.deepEqual(result.children[0].attributes, { class: "card", id: "c1" });
    });
});