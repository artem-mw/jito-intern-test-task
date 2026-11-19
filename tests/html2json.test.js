"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { html2json } = require("../html2json.js");

const EMPTY = { type: "document", children: [] };
const doc = (...children) => ({ type: "document", children });
const text = (content) => ({ type: "text", content });

describe("step 1: skeleton", () => {
    describe("empty and non-string input", () => {
        it("returns an empty document for an empty string", () => {
            assert.deepEqual(html2json(""), EMPTY);
        });

        it("returns an empty document for non-string input", () => {
            for (const value of [null, undefined, 42, true, {}, [], () => {}, Symbol("x")]) {
                assert.deepEqual(html2json(value), EMPTY);
            }
        });

        it("returns a fresh document on every call", () => {
            const a = html2json("");
            const b = html2json("");
            assert.notEqual(a, b);
            a.children.push(text("x"));
            assert.deepEqual(b, EMPTY);
        });
    });

    describe("whitespace", () => {
        it("keeps whitespace-only input as one text node", () => {
            assert.deepEqual(html2json("   "), doc(text("   ")));
            assert.deepEqual(html2json(" \t\n "), doc(text(" \t\n ")));
        });
    });

    describe("BOM", () => {
        it("strips a single leading BOM", () => {
            assert.deepEqual(html2json("\uFEFFabc"), doc(text("abc")));
        });

        it("returns an empty document for a BOM-only input", () => {
            assert.deepEqual(html2json("\uFEFF"), EMPTY);
        });

        it("strips only one BOM and only at the start", () => {
            assert.deepEqual(html2json("\uFEFF\uFEFFa"), doc(text("\uFEFFa")));
            assert.deepEqual(html2json("a\uFEFFb"), doc(text("a\uFEFFb")));
        });
    });

    describe("line endings", () => {
        it("normalizes \\r\\n to \\n", () => {
            assert.deepEqual(html2json("a\r\nb"), doc(text("a\nb")));
        });

        it("normalizes a lone \\r to \\n", () => {
            assert.deepEqual(html2json("a\rb"), doc(text("a\nb")));
        });

        it("handles mixed and repeated endings", () => {
            assert.deepEqual(html2json("a\r\r\n\n\r\nb"), doc(text("a\n\n\n\nb")));
        });

        it("leaves \\n-only input untouched", () => {
            assert.deepEqual(html2json("a\nb"), doc(text("a\nb")));
        });

        it("strips the BOM before normalizing", () => {
            assert.deepEqual(html2json("\uFEFF\r\n"), doc(text("\n")));
        });
    });

    describe("options", () => {
        it("accepts missing and invalid options without throwing", () => {
            for (const options of [undefined, null, 5, "x", [], {}, { maxDepth: NaN }, { maxDepth: -1 }, { maxDepth: "3" }, { maxDepth: null }]) {
                assert.deepEqual(html2json("a", options), doc(text("a")));
            }
        });

        it("accepts valid maxDepth values", () => {
            for (const maxDepth of [0, 1, 1.5, 1000, Infinity]) {
                assert.deepEqual(html2json("a", { maxDepth }), doc(text("a")));
            }
        });
    });

    describe("safety net", () => {
        it("logs the error and returns an empty document when something throws", (t) => {
            const logged = t.mock.method(console, "error", () => {});
            const hostile = {
                get maxDepth() {
                    throw new Error("boom");
                },
            };

            assert.deepEqual(html2json("a", hostile), EMPTY);
            assert.equal(logged.mock.callCount(), 1);
            assert.equal(logged.mock.calls[0].arguments[1].message, "boom");
        });
    });

    describe("scale", () => {
        it("handles a large input quickly", () => {
            const big = "x\r\n".repeat(1_000_000);
            const start = Date.now();
            const result = html2json(big);
            assert.equal(result.children.length, 1);
            assert.equal(result.children[0].content.length, 2_000_000);
            assert.ok(Date.now() - start < 2000);
        });
    });
});

/* ---------------------------------------------------------------------- */
/* Step 2: builder and basic tokenizer                                     */
/* ---------------------------------------------------------------------- */

const el = (tag, children = [], attributes = {}) => ({
    type: "element",
    tag,
    attributes,
    children,
});

/** Depth of a tree that is a single chain of first children (iterative). */
function chainDepth(node) {
    let depth = 0;
    while (node.children && node.children.length > 0) {
        node = node.children[0];
        depth++;
    }
    return depth;
}

describe("step 2: tags and tree building", () => {
    describe("regular elements", () => {
        it("parses a simple element", () => {
            assert.deepEqual(html2json("<div>content</div>"), doc(el("div", [text("content")])));
        });

        it("parses nesting and mixed content", () => {
            assert.deepEqual(
                html2json("<div><span>a</span>b</div>"),
                doc(el("div", [el("span", [text("a")]), text("b")]))
            );
        });

        it("parses multiple top-level nodes", () => {
            assert.deepEqual(
                html2json("a<b>x</b>c<i>y</i>"),
                doc(text("a"), el("b", [text("x")]), text("c"), el("i", [text("y")]))
            );
        });

        it("lowercases tag names, including in closing tags", () => {
            assert.deepEqual(html2json("<DiV>x</dIV>"), doc(el("div", [text("x")])));
        });

        it("accepts digits in tag names", () => {
            assert.deepEqual(html2json("<h1>x</h1>"), doc(el("h1", [text("x")])));
        });

        it("tolerates whitespace before the closing bracket", () => {
            assert.deepEqual(html2json("<div >x</div\n>"), doc(el("div", [text("x")])));
        });

        it("preserves whitespace-only text nodes between tags", () => {
            assert.deepEqual(
                html2json("<b>a</b> <i>b</i>"),
                doc(el("b", [text("a")]), text(" "), el("i", [text("b")]))
            );
        });

        it("preserves whitespace inside content", () => {
            assert.deepEqual(html2json("<p>  a \n b  </p>"), doc(el("p", [text("  a \n b  ")])));
        });

        it("handles empty elements", () => {
            assert.deepEqual(html2json("<div></div>"), doc(el("div")));
        });
    });

    describe("void elements", () => {
        it("gives void elements empty children", () => {
            assert.deepEqual(html2json("<br>"), doc(el("br")));
            assert.deepEqual(html2json("<img>"), doc(el("img")));
        });

        it("does not nest following content inside a void element", () => {
            assert.deepEqual(html2json("a<br>b"), doc(text("a"), el("br"), text("b")));
            assert.deepEqual(
                html2json("<p>a<br>b</p>"),
                doc(el("p", [text("a"), el("br"), text("b")]))
            );
        });

        it("accepts the slash form", () => {
            assert.deepEqual(html2json("<br/>"), doc(el("br")));
            assert.deepEqual(html2json("<br />x"), doc(el("br"), text("x")));
        });

        it("ignores closing tags of void elements", () => {
            assert.deepEqual(html2json("<img></img>"), doc(el("img")));
            assert.deepEqual(html2json("a</hr>b"), doc(text("ab")));
        });
    });

    describe("non-void elements with a slash", () => {
        it("treats <div/> as an opening tag", () => {
            assert.deepEqual(html2json("<div/>text</div>"), doc(el("div", [text("text")])));
        });
    });

    describe("closing tags", () => {
        it("closes unclosed elements at EOF", () => {
            assert.deepEqual(html2json("<div><span>a"), doc(el("div", [el("span", [text("a")])])));
        });

        it("implicitly closes elements above a matched closing tag", () => {
            assert.deepEqual(html2json("<div><span></div>"), doc(el("div", [el("span")])));
            assert.deepEqual(
                html2json("<a><b><c></a>x"),
                doc(el("a", [el("b", [el("c")])]), text("x"))
            );
        });

        it("ignores unmatched closing tags", () => {
            assert.deepEqual(html2json("</div>"), doc());
            assert.deepEqual(html2json("<div></span></div>"), doc(el("div")));
        });

        it("ignores extra closing tags", () => {
            assert.deepEqual(html2json("<b>a</b></b>"), doc(el("b", [text("a")])));
        });

        it("merges text split by an ignored closing tag", () => {
            assert.deepEqual(html2json("a</x>b"), doc(text("ab")));
        });

        it("matches the nearest element when names repeat", () => {
            assert.deepEqual(
                html2json("<div><div></div>x</div>y"),
                doc(el("div", [el("div"), text("x")]), text("y"))
            );
        });

        it("keeps counts correct after implicit closes", () => {
            // </div> implicitly closes the span, so the later </span> has nothing to close.
            assert.deepEqual(
                html2json("<div><span></div></span>x"),
                doc(el("div", [el("span")]), text("x"))
            );
            assert.deepEqual(
                html2json("<div><span></div><span>x</span>"),
                doc(el("div", [el("span")]), el("span", [text("x")]))
            );
        });
    });

    describe("stray angle brackets", () => {
        it("treats <<<div>>> as text, a div and text", () => {
            assert.deepEqual(html2json("<<<div>>>"), doc(text("<<"), el("div", [text(">>")])));
        });

        it("treats a lone < as text", () => {
            assert.deepEqual(html2json("a < b"), doc(text("a < b")));
            assert.deepEqual(html2json("<"), doc(text("<")));
            assert.deepEqual(html2json("a<"), doc(text("a<")));
            assert.deepEqual(html2json("<3"), doc(text("<3")));
            assert.deepEqual(html2json("<>"), doc(text("<>")));
            assert.deepEqual(html2json("< div>x"), doc(text("< div>x")));
            assert.deepEqual(html2json("<é>"), doc(text("<é>")));
        });

        it("keeps > in text", () => {
            assert.deepEqual(html2json("a > b"), doc(text("a > b")));
        });

        it("keeps surrounding text together", () => {
            assert.deepEqual(
                html2json("1 < 2 <b>x</b> 3 > 2"),
                doc(text("1 < 2 "), el("b", [text("x")]), text(" 3 > 2"))
            );
        });
    });

    describe("unfinished tags at EOF", () => {
        it("drops an unfinished opening tag but keeps the text before it", () => {
            assert.deepEqual(html2json("<div"), doc());
            assert.deepEqual(html2json("a<div"), doc(text("a")));
            assert.deepEqual(html2json("<p>a<b"), doc(el("p", [text("a")])));
        });

        it("drops an unfinished closing tag and keeps open elements", () => {
            assert.deepEqual(html2json("</div"), doc());
            assert.deepEqual(html2json("<b>x</b"), doc(el("b", [text("x")])));
        });
    });

    describe("scale", () => {
        it("ignores 100k stray closing tags quickly", () => {
            const start = Date.now();
            assert.deepEqual(html2json("</span>".repeat(100_000)), doc());
            assert.ok(Date.now() - start < 1000);
        });

        it("ignores 100k stray closing tags after 100k open elements", () => {
            const start = Date.now();
            const result = html2json("<div>".repeat(100_000) + "</span>".repeat(100_000));
            assert.equal(chainDepth(result), 100_000);
            assert.ok(Date.now() - start < 1000);
        });

        it("builds a 100k-deep tree without recursion", () => {
            const n = 100_000;
            const result = html2json("<div>".repeat(n) + "x" + "</div>".repeat(n));
            assert.equal(chainDepth(result), n + 1); // n elements plus the text node
        });

        it("handles many sibling elements", () => {
            const n = 200_000;
            const result = html2json("<p>x</p>".repeat(n));
            assert.equal(result.children.length, n);
        });

        it("handles a long text run with many stray brackets", () => {
            const result = html2json("a < b ".repeat(300_000));
            assert.equal(result.children.length, 1);
            assert.equal(result.children[0].content.length, 1_800_000);
        });
    });
});

/* ---------------------------------------------------------------------- */
/* Step 3: attributes                                                      */
/* ---------------------------------------------------------------------- */

/** Attributes of the first element in the document. */
const attrsOf = (html) => html2json(html).children[0].attributes;

describe("step 3: attributes", () => {
    describe("value styles", () => {
        it("parses double-quoted, single-quoted and unquoted values", () => {
            assert.deepEqual(attrsOf(`<a href="x" title='y' id=z>`), { href: "x", title: "y", id: "z" });
        });

        it("preserves values exactly", () => {
            assert.deepEqual(attrsOf(`<a title="A &amp; B" data-x='  spaced  '>`), {
                title: "A &amp; B",
                "data-x": "  spaced  ",
            });
            assert.deepEqual(attrsOf(`<a title="line1\nline2">`), { title: "line1\nline2" });
        });

        it("allows the other quote and > inside quoted values", () => {
            assert.deepEqual(attrsOf(`<a x="it's" y='say "hi"' z=">">`), {
                x: "it's",
                y: 'say "hi"',
                z: ">",
            });
        });

        it("keeps the element structure when a value contains >", () => {
            assert.deepEqual(
                html2json(`<a title=">">x</a>`),
                doc(el("a", [text("x")], { title: ">" }))
            );
        });

        it("parses empty quoted values", () => {
            assert.deepEqual(attrsOf(`<a x="" y=''>`), { x: "", y: "" });
        });

        it("ends an unquoted value at whitespace or >", () => {
            assert.deepEqual(html2json("<a b=c>x</a>"), doc(el("a", [text("x")], { b: "c" })));
            assert.deepEqual(attrsOf("<a b=c d=e>"), { b: "c", d: "e" });
            assert.deepEqual(attrsOf("<a b=c\nd=e>"), { b: "c", d: "e" });
        });

        it("allows quotes inside unquoted values", () => {
            assert.deepEqual(attrsOf(`<a b=x"y'z>`), { b: `x"y'z` });
        });

        it("accepts attributes right after a closing quote", () => {
            assert.deepEqual(attrsOf(`<a a="1"b="2">`), { a: "1", b: "2" });
        });
    });

    describe("names", () => {
        it("lowercases names but preserves values", () => {
            assert.deepEqual(attrsOf(`<A HREF="Foo" DataX=Bar>`), { href: "Foo", datax: "Bar" });
        });

        it("keeps odd characters inside a name", () => {
            assert.deepEqual(attrsOf(`<a b"c=1 @click=2 :x=3>`), { 'b"c': "1", "@click": "2", ":x": "3" });
        });
    });

    describe("valueless attributes", () => {
        it("gives valueless attributes an empty string", () => {
            assert.deepEqual(attrsOf("<input disabled>"), { disabled: "" });
            assert.deepEqual(attrsOf("<input disabled checked>"), { disabled: "", checked: "" });
            assert.deepEqual(attrsOf(`<input disabled type=text>`), { disabled: "", type: "text" });
        });

        it("treats a missing value after = as empty", () => {
            assert.deepEqual(attrsOf("<a b=>"), { b: "" });
            assert.deepEqual(attrsOf("<a b= >"), { b: "" });
            assert.deepEqual(attrsOf("<a b= c=d>"), { b: "c=d" });
        });
    });

    describe("duplicates", () => {
        it("keeps the first value", () => {
            assert.deepEqual(attrsOf("<a id=1 id=2>"), { id: "1" });
        });

        it("compares names after lowercasing", () => {
            assert.deepEqual(attrsOf("<a ID=1 id=2 Id=3>"), { id: "1" });
        });

        it("keeps a valueless first occurrence", () => {
            assert.deepEqual(attrsOf("<a x x=1>"), { x: "" });
        });
    });

    describe("prototype safety", () => {
        it("stores __proto__ as an ordinary own property", () => {
            const attrs = attrsOf(`<a __proto__="x" id=1>`);
            assert.equal(Object.hasOwn(attrs, "__proto__"), true);
            assert.equal(Object.getPrototypeOf(attrs), Object.prototype);
            assert.equal(attrs.id, "1");
            assert.deepEqual(attrs, JSON.parse('{"__proto__":"x","id":"1"}'));
            assert.equal(JSON.stringify(attrs), '{"__proto__":"x","id":"1"}');
        });

        it("does not pollute Object.prototype", () => {
            html2json(`<a __proto__="x" constructor="y" polluted=1>`);
            assert.equal({}.polluted, undefined);
            assert.equal(Object.prototype.polluted, undefined);
            assert.equal({}.x, undefined);
        });

        it("treats names that exist on Object.prototype as new attributes", () => {
            assert.deepEqual(attrsOf("<a constructor=1 constructor=2 valueof=3>"), {
                constructor: "1",
                valueof: "3",
            });
        });

        it("applies first-wins to __proto__ too", () => {
            const attrs = attrsOf("<a __proto__=1 __proto__=2>");
            assert.equal(Object.getOwnPropertyDescriptor(attrs, "__proto__").value, "1");
        });
    });

    describe("whitespace around =", () => {
        it("tolerates spaces and newlines around =", () => {
            for (const html of [`<a b = "c">`, `<a b ="c">`, `<a b= "c">`, `<a b\n=\n"c">`, `<a b = c>`]) {
                assert.deepEqual(attrsOf(html), { b: "c" }, html);
            }
        });
    });

    describe("slashes", () => {
        it("accepts the slash form on void elements", () => {
            assert.deepEqual(html2json(`<br class=a />`), doc(el("br", [], { class: "a" })));
            assert.deepEqual(html2json(`<br class="a"/>`), doc(el("br", [], { class: "a" })));
        });

        it("keeps a trailing / inside an unquoted value", () => {
            assert.deepEqual(html2json("<a href=foo/>x"), doc(el("a", [text("x")], { href: "foo/" })));
        });

        it("skips stray slashes between attributes", () => {
            assert.deepEqual(attrsOf("<div / id=1>"), { id: "1" });
            assert.deepEqual(attrsOf("<a b/c>"), { b: "", c: "" });
        });

        it("still treats <div/> as an opening tag", () => {
            assert.deepEqual(html2json(`<div id=a/>x</div>`), doc(el("div", [text("x")], { id: "a/" })));
            assert.deepEqual(html2json(`<div id="a"/>x</div>`), doc(el("div", [text("x")], { id: "a" })));
        });
    });

    describe("garbage", () => {
        it("skips stray quoted strings", () => {
            assert.deepEqual(attrsOf(`<div "x" id=1>`), { id: "1" });
            assert.deepEqual(attrsOf(`<div 'x y' id=1>`), { id: "1" });
        });

        it("skips a leading = together with what follows it", () => {
            assert.deepEqual(attrsOf("<div =foo id=1>"), { id: "1" });
            assert.deepEqual(attrsOf(`<div ="x" id=1>`), { id: "1" });
            assert.deepEqual(attrsOf("<div ==foo id=1>"), { id: "1" });
            assert.deepEqual(attrsOf("<div = id=1>"), { id: "1" });
        });

        it("never invents an empty attribute name", () => {
            assert.deepEqual(attrsOf(`<div ="" "" =>`), {});
        });
    });

    describe("closing tags", () => {
        it("ignores attributes on closing tags", () => {
            assert.deepEqual(html2json("<div>a</div id=1>b"), doc(el("div", [text("a")]), text("b")));
        });

        it("finds the real end of a closing tag with a quoted >", () => {
            assert.deepEqual(html2json(`<div>a</div class=">">x`), doc(el("div", [text("a")]), text("x")));
        });

        it("drops an unfinished closing tag with an open quote", () => {
            assert.deepEqual(html2json(`<b>x</b class="a`), doc(el("b", [text("x")])));
        });
    });

    describe("nesting with attributes", () => {
        it("builds the tree", () => {
            assert.deepEqual(
                html2json(`<div id=a><span class="b">t</span></div>`),
                doc(el("div", [el("span", [text("t")], { class: "b" })], { id: "a" }))
            );
        });
    });

    describe("unfinished tags at EOF", () => {
        it("lets an unclosed quote swallow markup up to the next matching quote, as browsers do", () => {
            assert.deepEqual(
                html2json(`<div id="3647></div><span class="x">hi</span>`),
                doc(el("div", [text("hi")], { id: "3647></div><span class=", 'x"': "" }))
            );
        });

        it("drops the tag and keeps the text before it", () => {
            for (const html of [
                `<div class="a`,
                `<div class='a`,
                `<div class=a`,
                `<div class=`,
                `<div class= `,
                `<div a b`,
                `<div "x`,
                `<div ="x`,
                `<div id=1 `,
                `<div class="a>b`,
            ]) {
                assert.deepEqual(html2json(html), doc(), html);
                assert.deepEqual(html2json("t" + html), doc(text("t")), "t" + html);
            }
        });
    });

    describe("scale", () => {
        it("handles 100k attributes on one tag", () => {
            const n = 100_000;
            let html = "<div";
            for (let i = 0; i < n; i++) html += ` a${i}=${i}`;
            html += ">";
            const start = Date.now();
            const attrs = html2json(html).children[0].attributes;
            assert.equal(Object.keys(attrs).length, n);
            assert.equal(attrs.a99999, "99999");
            assert.ok(Date.now() - start < 1000);
        });

        it("handles 100k duplicate attributes", () => {
            const result = html2json("<div" + " id=x".repeat(100_000) + ">");
            assert.deepEqual(result.children[0].attributes, { id: "x" });
        });

        it("handles a very long attribute value", () => {
            const value = "v".repeat(2_000_000);
            assert.equal(attrsOf(`<a b="${value}">`).b.length, 2_000_000);
        });

        it("handles many garbage tokens", () => {
            const result = html2json("<div" + ' "x"'.repeat(100_000) + " id=1>");
            assert.deepEqual(result.children[0].attributes, { id: "1" });
        });
    });
});

/* ---------------------------------------------------------------------- */
/* Step 4: comments, doctype, CDATA, bogus constructs                      */
/* ---------------------------------------------------------------------- */

const comment = (content) => ({ type: "comment", content });
const doctype = (content) => ({ type: "doctype", content });

describe("step 4: special constructs", () => {
    describe("comments", () => {
        it("parses a comment", () => {
            assert.deepEqual(html2json("<!-- hi -->"), doc(comment(" hi ")));
            assert.deepEqual(html2json("<!--hi-->"), doc(comment("hi")));
        });

        it("parses empty comments, including the degenerate forms", () => {
            for (const html of ["<!---->", "<!-->", "<!--->", "<!----!>"]) {
                assert.deepEqual(html2json(html), doc(comment("")), html);
            }
        });

        it("ends a comment on --!> as well as -->", () => {
            assert.deepEqual(html2json("<!--a--!>b-->"), doc(comment("a"), text("b-->")));
            assert.deepEqual(html2json("<!-- a --!> b -->"), doc(comment(" a "), text(" b -->")));
        });

        it("handles extra dashes before the terminator", () => {
            assert.deepEqual(html2json("<!--a--->"), doc(comment("a-")));
            assert.deepEqual(html2json("<!---a-->"), doc(comment("-a")));
            assert.deepEqual(html2json("<!--a---->"), doc(comment("a--")));
        });

        it("keeps -- that is not a terminator", () => {
            assert.deepEqual(html2json("<!-- a -- b -->"), doc(comment(" a -- b ")));
            assert.deepEqual(html2json("<!--a--!b-->"), doc(comment("a--!b")));
        });

        it("treats markup inside a comment as content", () => {
            assert.deepEqual(html2json("<!-- <div>x</div> -->"), doc(comment(" <div>x</div> ")));
            assert.deepEqual(html2json("<!-- a > b -->"), doc(comment(" a > b ")));
        });

        it("preserves newlines in content", () => {
            assert.deepEqual(html2json("<!--a\nb-->"), doc(comment("a\nb")));
        });

        it("places comments in the tree without merging text across them", () => {
            assert.deepEqual(
                html2json("a<!--c-->b"),
                doc(text("a"), comment("c"), text("b"))
            );
            assert.deepEqual(
                html2json("<div><!--c--></div>"),
                doc(el("div", [comment("c")]))
            );
        });

        it("keeps an unterminated comment with content to EOF", () => {
            assert.deepEqual(html2json("<!-- never closed"), doc(comment(" never closed")));
            assert.deepEqual(html2json("<!--"), doc(comment("")));
            assert.deepEqual(html2json("<!--a--!"), doc(comment("a--!")));
            assert.deepEqual(html2json("x<!--y"), doc(text("x"), comment("y")));
            assert.deepEqual(html2json("<div><!--x"), doc(el("div", [comment("x")])));
        });
    });

    describe("doctype", () => {
        it("parses a doctype", () => {
            assert.deepEqual(html2json("<!DOCTYPE html>"), doc(doctype("html")));
        });

        it("is case-insensitive for the keyword and preserves the content's case", () => {
            assert.deepEqual(html2json("<!doctype html>"), doc(doctype("html")));
            assert.deepEqual(html2json("<!DocType HTML>"), doc(doctype("HTML")));
        });

        it("trims the content", () => {
            assert.deepEqual(html2json("<!DOCTYPE   html   >"), doc(doctype("html")));
            assert.deepEqual(html2json("<!DOCTYPE\nhtml\n>"), doc(doctype("html")));
        });

        it("handles an empty doctype", () => {
            assert.deepEqual(html2json("<!DOCTYPE>"), doc(doctype("")));
        });

        it("keeps legacy doctypes whole", () => {
            const legacy = 'html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd"';
            assert.deepEqual(html2json(`<!DOCTYPE ${legacy}>`), doc(doctype(legacy)));
        });

        it("keeps a doctype wherever it appears", () => {
            assert.deepEqual(
                html2json("<p>a</p><!doctype html>"),
                doc(el("p", [text("a")]), doctype("html"))
            );
            assert.deepEqual(html2json("<div><!doctype x></div>"), doc(el("div", [doctype("x")])));
        });

        it("works in front of the document", () => {
            assert.deepEqual(
                html2json("<!DOCTYPE html>\n<html></html>"),
                doc(doctype("html"), text("\n"), el("html"))
            );
        });

        it("keeps an unterminated doctype with content to EOF", () => {
            assert.deepEqual(html2json("<!DOCTYPE html"), doc(doctype("html")));
            assert.deepEqual(html2json("<!DOCTYPE html\n"), doc(doctype("html")));
            assert.deepEqual(html2json("<!doctype"), doc(doctype("")));
            assert.deepEqual(html2json("a<!doctype x"), doc(text("a"), doctype("x")));
        });
    });

    describe("CDATA", () => {
        it("drops CDATA through ]]> so an inner > does not leak", () => {
            assert.deepEqual(html2json("<![CDATA[ a > b ]]>x"), doc(text("x")));
            assert.deepEqual(html2json("<![CDATA[ <b>x</b> ]]>"), doc());
            assert.deepEqual(html2json("<![CDATA[]]>"), doc());
        });

        it("merges the text on both sides of dropped CDATA", () => {
            assert.deepEqual(html2json("a<![CDATA[x]]>b"), doc(text("ab")));
        });

        it("drops unterminated CDATA to EOF, keeping the text before it", () => {
            assert.deepEqual(html2json("<![CDATA[ a > b"), doc());
            assert.deepEqual(html2json("t<![CDATA[x"), doc(text("t")));
        });

        it("treats a lowercase marker as a bogus construct ending at the first >", () => {
            assert.deepEqual(html2json("<![cdata[a>b]]>y"), doc(text("b]]>y")));
        });
    });

    describe("processing instructions and bogus constructs", () => {
        it("drops <?...>", () => {
            assert.deepEqual(html2json('<?xml version="1.0"?>x'), doc(text("x")));
            assert.deepEqual(html2json("<?php echo 1 ?>x"), doc(text("x")));
            assert.deepEqual(html2json("a<?x>b"), doc(text("ab")));
        });

        it("drops <!foo>", () => {
            assert.deepEqual(html2json("<!foo>x"), doc(text("x")));
            assert.deepEqual(html2json("<!>x"), doc(text("x")));
            assert.deepEqual(html2json("<!->x"), doc(text("x")));
            assert.deepEqual(html2json("<!-x>y"), doc(text("y")));
        });

        it("drops </ followed by a non-letter through the next >", () => {
            assert.deepEqual(html2json("</>x"), doc(text("x")));
            assert.deepEqual(html2json("</3>x"), doc(text("x")));
            assert.deepEqual(html2json("</ div>x"), doc(text("x")));
            assert.deepEqual(html2json("<b>x</>y</b>"), doc(el("b", [text("xy")])));
        });

        it("drops unfinished bogus constructs to EOF, keeping the text before them", () => {
            for (const tail of ["<?xml", "<!foo", "</3", "</ ", "<!", "<!-", "<?"]) {
                assert.deepEqual(html2json(tail), doc(), tail);
                assert.deepEqual(html2json("t" + tail), doc(text("t")), "t" + tail);
            }
        });

        it("keeps a lone </ at EOF as text", () => {
            assert.deepEqual(html2json("</"), doc(text("</")));
            assert.deepEqual(html2json("a</"), doc(text("a</")));
            assert.deepEqual(html2json("<b>x</"), doc(el("b", [text("x</")])));
        });

        it("still treats other uses of < as text", () => {
            assert.deepEqual(html2json("a <b"), doc(text("a ")));
            assert.deepEqual(html2json("a < b"), doc(text("a < b")));
        });
    });

    describe("mixed documents", () => {
        it("parses a typical document head", () => {
            assert.deepEqual(
                html2json("<!DOCTYPE html><html><head><!-- c --><meta charset=utf-8></head></html>"),
                doc(
                    doctype("html"),
                    el("html", [el("head", [comment(" c "), el("meta", [], { charset: "utf-8" })])])
                )
            );
        });
    });

    describe("scale", () => {
        it("handles 100k comments", () => {
            const result = html2json("<!--a-->".repeat(100_000));
            assert.equal(result.children.length, 100_000);
        });

        it("handles a huge comment full of dashes", () => {
            const k = 1_000_000;
            const start = Date.now();
            const result = html2json("<!--" + "-".repeat(k) + "-->");
            assert.equal(result.children[0].content.length, k);
            assert.ok(Date.now() - start < 1000);
        });

        it("handles a huge comment full of dash pairs that are not terminators", () => {
            const start = Date.now();
            const result = html2json("<!--" + "-- ".repeat(300_000) + "-->");
            assert.equal(result.children[0].content.length, 900_000);
            assert.ok(Date.now() - start < 1000);
        });

        it("handles 100k dropped constructs between text", () => {
            const result = html2json("a<!x>b<?y>c<![CDATA[z]]>".repeat(100_000));
            assert.equal(result.children.length, 1);
            assert.equal(result.children[0].content.length, 300_000);
        });

        it("handles a 2 MB unterminated comment", () => {
            const result = html2json("<!--" + "x".repeat(2_000_000));
            assert.equal(result.children[0].content.length, 2_000_000);
        });
    });
});

/* ---------------------------------------------------------------------- */
/* Step 5: raw text and foreign content                                    */
/* ---------------------------------------------------------------------- */

describe("step 5: raw text elements", () => {
    it("keeps script content as a single text node", () => {
        assert.deepEqual(
            html2json("<script>if (a < b) {}</script>"),
            doc(el("script", [text("if (a < b) {}")]))
        );
        assert.deepEqual(
            html2json(`<script>var s = "<div>";</script>`),
            doc(el("script", [text(`var s = "<div>";`)]))
        );
    });

    it("handles style, textarea and title the same way", () => {
        assert.deepEqual(html2json("<style>a > b { }</style>"), doc(el("style", [text("a > b { }")])));
        assert.deepEqual(
            html2json("<textarea><b>x</b></textarea>"),
            doc(el("textarea", [text("<b>x</b>")]))
        );
        assert.deepEqual(html2json("<title>a <b> c</title>"), doc(el("title", [text("a <b> c")])));
    });

    it("keeps attributes on raw text elements", () => {
        assert.deepEqual(
            html2json(`<script src="a.js"></script>`),
            doc(el("script", [], { src: "a.js" }))
        );
        assert.deepEqual(
            html2json(`<script data-x=">">a<b</script>`),
            doc(el("script", [text("a<b")], { "data-x": ">" }))
        );
    });

    it("emits no child for empty content and keeps whitespace-only content", () => {
        assert.deepEqual(html2json("<script></script>"), doc(el("script")));
        assert.deepEqual(html2json("<script> </script>"), doc(el("script", [text(" ")])));
    });

    it("matches the closing tag case-insensitively", () => {
        assert.deepEqual(html2json("<script>x</SCRIPT>y"), doc(el("script", [text("x")]), text("y")));
        assert.deepEqual(html2json("<SCRIPT>x</ScRiPt>"), doc(el("script", [text("x")])));
    });

    it("accepts whitespace, / and > after the closing tag name", () => {
        for (const closer of ["</script>", "</script >", "</script\n>", "</script/>", "</script x=1>"]) {
            assert.deepEqual(
                html2json(`<script>a${closer}b`),
                doc(el("script", [text("a")]), text("b")),
                closer
            );
        }
    });

    it("does not end on a longer name or another element's closing tag", () => {
        assert.deepEqual(
            html2json("<script>a</scriptx>b</script>"),
            doc(el("script", [text("a</scriptx>b")]))
        );
        assert.deepEqual(
            html2json("<script>a</style>b</script>"),
            doc(el("script", [text("a</style>b")]))
        );
        assert.deepEqual(html2json("<script>a</</script>"), doc(el("script", [text("a</")])));
    });

    it("treats comments and nested same-name tags as content", () => {
        assert.deepEqual(
            html2json("<script><!-- x --></script>"),
            doc(el("script", [text("<!-- x -->")]))
        );
        assert.deepEqual(html2json("<title>a<title>b</title>"), doc(el("title", [text("a<title>b")])));
    });

    it("keeps closing tags of ancestors inside the content", () => {
        assert.deepEqual(
            html2json("<div><script>x</div></script>y</div>"),
            doc(el("div", [el("script", [text("x</div>")]), text("y")]))
        );
    });

    it("enters raw text even for <script/>, as the slash is ignored", () => {
        assert.deepEqual(html2json("<script/>x</script>"), doc(el("script", [text("x")])));
    });

    it("returns to normal parsing after the element", () => {
        assert.deepEqual(
            html2json("<script>a</script><b>x</b>"),
            doc(el("script", [text("a")]), el("b", [text("x")]))
        );
    });

    describe("unterminated", () => {
        it("keeps content to EOF as a text child", () => {
            assert.deepEqual(html2json("<script>a<b"), doc(el("script", [text("a<b")])));
            assert.deepEqual(html2json("<script>"), doc(el("script")));
            assert.deepEqual(html2json("<textarea>x</p>"), doc(el("textarea", [text("x</p>")])));
            assert.deepEqual(html2json("<p><title>a"), doc(el("p", [el("title", [text("a")])])));
        });

        it("treats a closing tag cut off at EOF as content", () => {
            assert.deepEqual(html2json("<script>x</script"), doc(el("script", [text("x</script")])));
            assert.deepEqual(html2json("<style>a</style"), doc(el("style", [text("a</style")])));
        });
    });

    describe("scale", () => {
        it("handles 1M < characters inside a script", () => {
            const result = html2json("<script>" + "<".repeat(1_000_000) + "</script>");
            assert.equal(result.children[0].children[0].content.length, 1_000_000);
        });

        it("handles 100k partial terminators", () => {
            const result = html2json("<script>" + "</scrip".repeat(100_000) + "</script>");
            assert.equal(result.children[0].children[0].content.length, 700_000);
        });

        it("handles 100k scripts", () => {
            const result = html2json("<script>x</script>".repeat(100_000));
            assert.equal(result.children.length, 100_000);
        });

        it("handles a 2 MB unterminated script", () => {
            const result = html2json("<script>" + "x".repeat(2_000_000));
            assert.equal(result.children[0].children[0].content.length, 2_000_000);
        });
    });
});

describe("step 5: foreign content", () => {
    it("honors /> on svg and on elements inside it", () => {
        assert.deepEqual(
            html2json(`<svg><path d="M0 0"/><circle/></svg>`),
            doc(el("svg", [el("path", [], { d: "M0 0" }), el("circle")]))
        );
        assert.deepEqual(
            html2json("<svg><g><path/><rect /></g><line/></svg>"),
            doc(el("svg", [el("g", [el("path"), el("rect")]), el("line")]))
        );
    });

    it("honors /> on math and svg themselves", () => {
        assert.deepEqual(html2json("<svg/>x"), doc(el("svg"), text("x")));
        assert.deepEqual(html2json("<math/>x"), doc(el("math"), text("x")));
        assert.deepEqual(
            html2json("<math><mi/><mo/></math>"),
            doc(el("math", [el("mi"), el("mo")]))
        );
    });

    it("is case-insensitive", () => {
        assert.deepEqual(html2json("<SVG><PATH/><Circle/></SVG>"), doc(el("svg", [el("path"), el("circle")])));
    });

    it("does not honor /> once the svg is closed", () => {
        assert.deepEqual(html2json("<svg></svg><div/>x"), doc(el("svg"), el("div", [text("x")])));
        assert.deepEqual(html2json("<svg/><div/>x"), doc(el("svg"), el("div", [text("x")])));
    });

    it("does not treat a / inside an unquoted value as self-closing", () => {
        assert.deepEqual(
            html2json("<svg><circle r=1/><path/></svg>"),
            doc(el("svg", [el("circle", [el("path")], { r: "1/" })]))
        );
    });

    it("parses markup inside svg <title> and <style> instead of treating it as raw text", () => {
        assert.deepEqual(
            html2json("<svg><title>a<b>c</b></title></svg>"),
            doc(el("svg", [el("title", [text("a"), el("b", [text("c")])])]))
        );
        assert.deepEqual(
            html2json("<svg><style>a<b>c</b></style></svg>"),
            doc(el("svg", [el("style", [text("a"), el("b", [text("c")])])]))
        );
    });

    it("self-closes <title/> inside svg", () => {
        assert.deepEqual(html2json("<svg><title/>x</svg>"), doc(el("svg", [el("title"), text("x")])));
    });

    it("restores raw text after the svg is closed", () => {
        assert.deepEqual(
            html2json("<svg></svg><title><b></title>"),
            doc(el("svg"), el("title", [text("<b>")]))
        );
        // </svg> implicitly closes the g, and the counter still goes back to zero.
        assert.deepEqual(
            html2json("<svg><g></svg><script><b></script>"),
            doc(el("svg", [el("g")]), el("script", [text("<b>")]))
        );
    });

    it("keeps svg raw-text-free while any svg/math ancestor is open", () => {
        assert.deepEqual(
            html2json("<svg><svg></svg><title><i></title></svg>"),
            doc(el("svg", [el("svg"), el("title", [el("i")])]))
        );
        assert.deepEqual(
            html2json("<math><svg></svg><script><i></script></math>"),
            doc(el("math", [el("svg"), el("script", [el("i")])]))
        );
    });

    it("does not affect ordinary HTML", () => {
        assert.deepEqual(html2json("<p/>x</p>"), doc(el("p", [text("x")])));
    });
});

/* ---------------------------------------------------------------------- */
/* Step 6: optional end tags, stray </p> and </br>                         */
/* ---------------------------------------------------------------------- */

describe("step 6: optional end tags", () => {
    describe("li", () => {
        it("closes an open li", () => {
            assert.deepEqual(
                html2json("<ul><li>a<li>b</ul>"),
                doc(el("ul", [el("li", [text("a")]), el("li", [text("b")])]))
            );
            assert.deepEqual(
                html2json("<ol><li>a<li>b<li>c</ol>"),
                doc(el("ol", [el("li", [text("a")]), el("li", [text("b")]), el("li", [text("c")])]))
            );
        });

        it("leaves explicitly closed items alone", () => {
            assert.deepEqual(
                html2json("<ul><li>a</li><li>b</li></ul>"),
                doc(el("ul", [el("li", [text("a")]), el("li", [text("b")])]))
            );
        });

        it("keeps legitimate nesting, because only the top of the stack is checked", () => {
            assert.deepEqual(
                html2json("<ul><li>a<ul><li>b</li></ul><li>c</ul>"),
                doc(el("ul", [el("li", [text("a"), el("ul", [el("li", [text("b")])])]), el("li", [text("c")])]))
            );
        });

        it("misses cases where the top of the stack is another element (documented limitation)", () => {
            assert.deepEqual(
                html2json("<li>a<b>bold<li>b"),
                doc(el("li", [text("a"), el("b", [text("bold"), el("li", [text("b")])])]))
            );
        });

        it("keeps the counters right after an implicit close", () => {
            assert.deepEqual(
                html2json("<ul><li>a<li>b</li></li>c</ul>"),
                doc(el("ul", [el("li", [text("a")]), el("li", [text("b")]), text("c")]))
            );
        });

        it("is case-insensitive", () => {
            assert.deepEqual(
                html2json("<UL><LI>a<LI>b</UL>"),
                doc(el("ul", [el("li", [text("a")]), el("li", [text("b")])]))
            );
        });
    });

    describe("dt, dd and option", () => {
        it("lets dt and dd close each other", () => {
            assert.deepEqual(
                html2json("<dl><dt>a<dd>b<dt>c<dd>d</dl>"),
                doc(el("dl", [el("dt", [text("a")]), el("dd", [text("b")]), el("dt", [text("c")]), el("dd", [text("d")])]))
            );
        });

        it("closes an open option", () => {
            assert.deepEqual(
                html2json("<select><option>a<option>b</select>"),
                doc(el("select", [el("option", [text("a")]), el("option", [text("b")])]))
            );
        });
    });

    describe("p", () => {
        it("closes an open p on another p", () => {
            assert.deepEqual(html2json("<p>one<p>two"), doc(el("p", [text("one")]), el("p", [text("two")])));
        });

        it("closes an open p on a block-level tag", () => {
            assert.deepEqual(
                html2json("<p>text<div>block</div>"),
                doc(el("p", [text("text")]), el("div", [text("block")]))
            );
            assert.deepEqual(
                html2json("<p>a<h1>t</h1>"),
                doc(el("p", [text("a")]), el("h1", [text("t")]))
            );
        });

        it("applies to every block-level tag", () => {
            const block = [
                "address", "article", "aside", "blockquote", "div", "dl", "fieldset",
                "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
                "main", "nav", "ol", "pre", "section", "table", "ul",
            ];
            for (const tag of block) {
                const result = html2json(`<p>a<${tag}>`);
                assert.equal(result.children.length, 2, tag);
                assert.deepEqual(result.children[0], el("p", [text("a")]), tag);
                assert.equal(result.children[1].tag, tag);
            }
        });

        it("also applies to void block-level tags", () => {
            assert.deepEqual(html2json("<p>a<hr>b"), doc(el("p", [text("a")]), el("hr"), text("b")));
        });

        it("does not close p for inline content or void inline elements", () => {
            assert.deepEqual(
                html2json("<p>a<span>b</span><br>c</p>"),
                doc(el("p", [text("a"), el("span", [text("b")]), el("br"), text("c")]))
            );
        });

        it("checks only the top of the stack (documented limitation)", () => {
            assert.deepEqual(
                html2json("<p>a<span>b<p>c"),
                doc(el("p", [text("a"), el("span", [text("b"), el("p", [text("c")])])]))
            );
        });
    });

    describe("tables", () => {
        it("closes td/th and tr", () => {
            assert.deepEqual(
                html2json("<table><tr><td>a<td>b<tr><td>c</table>"),
                doc(
                    el("table", [
                        el("tr", [el("td", [text("a")]), el("td", [text("b")])]),
                        el("tr", [el("td", [text("c")])]),
                    ])
                )
            );
        });

        it("lets td and th close each other", () => {
            assert.deepEqual(
                html2json("<tr><th>a<td>b<th>c"),
                doc(el("tr", [el("th", [text("a")]), el("td", [text("b")]), el("th", [text("c")])]))
            );
        });

        it("closes an open tr that has no open cell", () => {
            assert.deepEqual(
                html2json("<table><tr>a<tr>b</table>"),
                doc(el("table", [el("tr", [text("a")]), el("tr", [text("b")])]))
            );
        });

        it("keeps nested tables apart", () => {
            assert.deepEqual(
                html2json("<td><table><tr><td>x<td>y</table><td>z"),
                doc(
                    el("td", [el("table", [el("tr", [el("td", [text("x")]), el("td", [text("y")])])])]),
                    el("td", [text("z")])
                )
            );
        });
    });

    describe("scale", () => {
        it("handles 100k unclosed list items as flat siblings", () => {
            const n = 100_000;
            const start = Date.now();
            const result = html2json("<ul>" + "<li>x".repeat(n) + "</ul>");
            assert.equal(result.children[0].children.length, n);
            assert.equal(chainDepth(result), 3); // ul > li > text
            assert.ok(Date.now() - start < 1000);
        });

        it("handles 100k unclosed paragraphs as flat siblings", () => {
            const result = html2json("<p>y".repeat(100_000));
            assert.equal(result.children.length, 100_000);
        });

        it("handles 100k unclosed table rows and cells", () => {
            const result = html2json("<table>" + "<tr><td>a<td>b".repeat(100_000));
            assert.equal(result.children[0].children.length, 100_000);
        });
    });
});

describe("step 6: stray </p>", () => {
    it("creates an empty p", () => {
        assert.deepEqual(html2json("</p>"), doc(el("p")));
        assert.deepEqual(html2json("</P>"), doc(el("p")));
    });

    it("appends it to the current parent and pushes nothing", () => {
        assert.deepEqual(html2json("a</p>b"), doc(text("a"), el("p"), text("b")));
        assert.deepEqual(html2json("<div></p>x</div>"), doc(el("div", [el("p"), text("x")])));
    });

    it("creates one per stray closing tag", () => {
        assert.deepEqual(html2json("<p>a</p></p>"), doc(el("p", [text("a")]), el("p")));
    });

    it("does nothing when a p is open, and closes everything above it", () => {
        assert.deepEqual(html2json("<p>a</p>"), doc(el("p", [text("a")])));
        assert.deepEqual(html2json("<p><span></p>x"), doc(el("p", [el("span")]), text("x")));
    });

    it("handles 100k stray closing tags", () => {
        const result = html2json("</p>".repeat(100_000));
        assert.equal(result.children.length, 100_000);
    });
});

describe("step 6: stray </br>", () => {
    it("acts as <br>", () => {
        assert.deepEqual(html2json("</br>"), doc(el("br")));
        assert.deepEqual(html2json("a</br>b"), doc(text("a"), el("br"), text("b")));
        assert.deepEqual(html2json("<p>x</br></p>"), doc(el("p", [text("x"), el("br")])));
    });

    it("ignores attributes, slashes and case", () => {
        assert.deepEqual(html2json("</BR >"), doc(el("br")));
        assert.deepEqual(html2json("</br/>"), doc(el("br")));
        assert.deepEqual(html2json("</br class=x>"), doc(el("br")));
    });

    it("creates a second br after a real <br>", () => {
        assert.deepEqual(html2json("<br></br>"), doc(el("br"), el("br")));
    });

    it("still ignores the closing tags of other void elements", () => {
        assert.deepEqual(html2json("a</img>b</hr>c"), doc(text("abc")));
    });
});

/* ---------------------------------------------------------------------- */
/* Step 7: maxDepth                                                        */
/* ---------------------------------------------------------------------- */

describe("step 7: maxDepth", () => {
    const limit = (maxDepth) => ({ maxDepth });

    it("keeps the rest of the input as text once the limit is hit", () => {
        assert.deepEqual(
            html2json("<div><span>x</span></div>", limit(1)),
            doc(el("div", [text("<span>x</span></div>")]))
        );
        assert.deepEqual(
            html2json("<div><span><b>x</b></span></div>", limit(2)),
            doc(el("div", [el("span", [text("<b>x</b></span></div>")])]))
        );
    });

    it("parses normally when the tree fits", () => {
        assert.deepEqual(
            html2json("<div><span>x</span></div>", limit(2)),
            doc(el("div", [el("span", [text("x")])]))
        );
        assert.deepEqual(
            html2json("<div><span>x</span></div>", limit(Infinity)),
            html2json("<div><span>x</span></div>")
        );
    });

    it("merges the remainder with the pending text run", () => {
        assert.deepEqual(
            html2json("<div>abc<span>x</span></div>", limit(1)),
            doc(el("div", [text("abc<span>x</span></div>")]))
        );
    });

    it("works with maxDepth 0", () => {
        assert.deepEqual(html2json("<div>x</div>", limit(0)), doc(text("<div>x</div>")));
        assert.deepEqual(html2json("a<b>c", limit(0)), doc(text("a<b>c")));
        assert.deepEqual(html2json("plain text", limit(0)), doc(text("plain text")));
    });

    it("does not count void elements, and they never trigger the limit", () => {
        assert.deepEqual(html2json("<br>x<img>", limit(0)), doc(el("br"), text("x"), el("img")));
        assert.deepEqual(html2json("<br>x<div>y", limit(0)), doc(el("br"), text("x<div>y")));
    });

    it("does not count self-closed svg/math elements", () => {
        assert.deepEqual(
            html2json("<svg><path/><circle/></svg>", limit(1)),
            doc(el("svg", [el("path"), el("circle")]))
        );
        assert.deepEqual(
            html2json("<svg><g><path/></g></svg>", limit(1)),
            doc(el("svg", [text("<g><path/></g></svg>")]))
        );
    });

    it("does not limit comments, doctype or text", () => {
        assert.deepEqual(
            html2json("<!DOCTYPE html><div><!-- c -->x</div>", limit(1)),
            doc(doctype("html"), el("div", [comment(" c "), text("x")]))
        );
    });

    it("keeps the remainder exactly as written, apart from preprocessing", () => {
        assert.deepEqual(
            html2json(`<div><P CLASS="A">x &amp; y</P><!-- c --></div>`, limit(1)),
            doc(el("div", [text(`<P CLASS="A">x &amp; y</P><!-- c --></div>`)]))
        );
        assert.deepEqual(
            html2json("<div><span>a\r\nb", limit(1)),
            doc(el("div", [text("<span>a\nb")]))
        );
    });

    it("applies optional end tags before the depth check", () => {
        assert.deepEqual(
            html2json("<p>a<div>b", limit(1)),
            doc(el("p", [text("a")]), el("div", [text("b")]))
        );
        assert.deepEqual(
            html2json("<ul><li>a<li>b</ul>", limit(2)),
            doc(el("ul", [el("li", [text("a")]), el("li", [text("b")])]))
        );
    });

    it("stops before entering raw text", () => {
        assert.deepEqual(
            html2json("<div><script>a</script></div>", limit(1)),
            doc(el("div", [text("<script>a</script></div>")]))
        );
    });

    it("drops an unfinished tag at the limit by the truncation rule", () => {
        assert.deepEqual(html2json(`<div><span class="a`, limit(1)), doc(el("div")));
        assert.deepEqual(html2json("<div>x<span", limit(1)), doc(el("div", [text("x")])));
    });

    it("falls back to no limit for invalid values", () => {
        const html = "<a><b><c>x</c></b></a>";
        const expected = doc(el("a", [el("b", [el("c", [text("x")])])]));
        for (const maxDepth of [-1, NaN, "1", null, undefined, {}]) {
            assert.deepEqual(html2json(html, { maxDepth }), expected, String(maxDepth));
        }
    });

    it("allows a fractional limit up to its ceiling", () => {
        assert.deepEqual(
            html2json("<a><b><c>x</c></b></a>", limit(1.5)),
            doc(el("a", [el("b", [text("<c>x</c></b></a>")])]))
        );
    });

    describe("scale", () => {
        it("makes a 100k-deep input safe for JSON.stringify", () => {
            const n = 100_000;
            const limitDepth = 1000;
            const result = html2json("<div>".repeat(n) + "x" + "</div>".repeat(n), limit(limitDepth));

            assert.equal(chainDepth(result), limitDepth + 1); // elements plus the text node
            // JSON.stringify must not overflow the call stack. (assert.deepEqual is
            // recursive too and would, so the round-trip is compared as strings.)
            const json = JSON.stringify(result);
            assert.equal(JSON.stringify(JSON.parse(json)), json);

            let node = result;
            while (node.children[0].type === "element") node = node.children[0];
            assert.equal(node.children[0].content.length, (n - limitDepth) * 5 + 1 + n * 6);
        });

        it("handles a 2 MB remainder", () => {
            const result = html2json("<div><span>" + "x".repeat(2_000_000), limit(1));
            assert.equal(result.children[0].children[0].content.length, 2_000_006);
        });
    });
});